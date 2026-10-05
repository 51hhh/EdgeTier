import { ROOM_NAME_PATTERN } from '../easytier/constants';
import type { ConfigProfile, HostProfile, HostReport, HostSnapshot } from './host-types';

export const HOST_FRESHNESS_MS = 5 * 60 * 1000;
export const MAX_HOST_REPORT_BYTES = 64 * 1024;
export const HOST_COMMAND_TTL_MS = 10 * 60 * 1000;
export const HOST_SERVICE_UNITS = new Set([
  'easytier-core-home.service', 'easytier-web.service',
  'edgetier-home-cloudflared.service', 'onecloud-ddns.timer',
]);

type ObjectValue = Record<string, unknown>;
function object(value: unknown, keys: string[]): value is ObjectValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key)));
}
function text(value: unknown, max = 128): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function optional(value: unknown, validate: (v: unknown) => boolean): boolean {
  return value === undefined || validate(value);
}
function number(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return number(value, max) && Number.isSafeInteger(value);
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}
function code(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
}
export function validHostname(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 253 && value.includes('.')
    && value.split('.').every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}
function date(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
function timelyDate(value: unknown, now: number): boolean {
  return date(value) && Date.parse(value) <= now + HOST_FRESHNESS_MS;
}
export function validIpv6(value: unknown, globalOnly = false): value is string {
  if (typeof value !== 'string' || !/^[0-9a-f:]+$/i.test(value) || !value.includes(':')) return false;
  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    const firstHextet = parseInt(hostname.slice(1).split(':')[0], 16);
    return Boolean(hostname) && (!globalOnly || firstHextet >= 0x2000 && firstHextet <= 0x3fff);
  } catch { return false; }
}
function ipv4Cidr(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(value);
  return Boolean(match && match.slice(1, 5).every((octet) => Number(octet) <= 255) && (!match[5] || Number(match[5]) <= 32));
}
function ipv6Cidr(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const [ip, prefix, extra] = value.split('/');
  return extra === undefined && validIpv6(ip) && (prefix === undefined || /^\d{1,3}$/.test(prefix) && Number(prefix) <= 128);
}
function cidr(value: unknown): boolean { return ipv4Cidr(value) || ipv6Cidr(value); }
function array(value: unknown, max: number, validate: (v: unknown) => boolean): value is unknown[] {
  return Array.isArray(value) && value.length <= max && value.every(validate);
}

/** Reports never contain credentials in URI userinfo, query or fragments. */
export function safeTransportUri(value: unknown): boolean {
  if (!text(value, 512) || !/^(?:tcp|udp|ws|wss|wg|quic):\/\//.test(value)) return false;
  try {
    const uri = new URL(value);
    // WHATWG URL removes an explicitly written default ws/wss port.
    const port = uri.port ? Number(uri.port) : uri.protocol === 'wss:' ? 443 : uri.protocol === 'ws:' ? 80 : 0;
    return Boolean(uri.hostname && port >= 1 && port <= 65535
      && !uri.username && !uri.password && !uri.search && !uri.hash && (!uri.pathname || uri.pathname === '/'));
  } catch { return false; }
}
function remoteAddress(value: unknown): boolean {
  if (safeTransportUri(value)) return true;
  if (!text(value, 512)) return false;
  return safeTransportUri(`tcp://${value}`);
}

export function parseHostProfiles(raw: string | undefined): HostProfile[] | null {
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!array(value, 16, (entry) => object(entry, ['hostId', 'displayName', 'roomId', 'networkName', 'directHostname', 'directPort'])
    && typeof entry.hostId === 'string' && ROOM_NAME_PATTERN.test(entry.hostId)
    && text(entry.displayName, 80) && typeof entry.roomId === 'string' && ROOM_NAME_PATTERN.test(entry.roomId)
    && typeof entry.networkName === 'string' && ROOM_NAME_PATTERN.test(entry.networkName)
    && validHostname(entry.directHostname) && integer(entry.directPort, 65535) && entry.directPort > 0)) return null;
  const profiles = value as unknown as HostProfile[];
  return new Set(profiles.map((profile) => profile.hostId)).size === profiles.length ? profiles : null;
}

export function validateHostReport(value: unknown, hostId: string, now = Date.now()): HostReport | null {
  if (!object(value, ['schemaVersion', 'hostId', 'reportId', 'bootId', 'sequence', 'capturedAt', 'collectorVersion', 'ddns', 'services', 'easytier', 'commandAck'])
    || value.schemaVersion !== 1 || value.hostId !== hostId || !identifier(value.reportId) || !identifier(value.bootId)
    || !integer(value.sequence) || !text(value.collectorVersion, 40) || !timelyDate(value.capturedAt, now)
    || Date.parse(value.capturedAt as string) < now - 24 * 60 * 60 * 1000) return null;
  const ddns = value.ddns;
  if (!object(ddns, ['name', 'status', 'ipv6', 'currentIpv6', 'ttl', 'proxied', 'lastAttemptAt', 'lastSuccessAt', 'errorCode'])
    || !validHostname(ddns.name) || !['updated', 'unchanged', 'check_ok', 'error', 'unknown'].includes(String(ddns.status))
    || !optional(ddns.ipv6, (v) => validIpv6(v, true)) || !optional(ddns.currentIpv6, (v) => validIpv6(v, true))
    || !optional(ddns.ttl, (v) => integer(v, 86400) && (v === 1 || (v as number) >= 30))
    || !optional(ddns.proxied, (v) => typeof v === 'boolean')
    || !optional(ddns.lastAttemptAt, (v) => timelyDate(v, now)) || !optional(ddns.lastSuccessAt, (v) => timelyDate(v, now))
    || !optional(ddns.errorCode, code)) return null;
  if (!array(value.services, 4, (service) => object(service, ['unit', 'activeState', 'subState', 'enabled', 'unitFileState'])
    && typeof service.unit === 'string' && HOST_SERVICE_UNITS.has(service.unit)
    && code(service.activeState) && code(service.subState) && typeof service.enabled === 'boolean'
    && optional(service.unitFileState, code)
    && (service.unitFileState === undefined || service.enabled === (service.unitFileState === 'enabled')))) return null;
  const units = (value.services as ObjectValue[]).map((service) => service.unit);
  if (new Set(units).size !== units.length) return null;
  const easytier = value.easytier;
  if (!object(easytier, ['status', 'node', 'peers', 'errorCode', 'truncated', 'omittedPeers']) || !['ok', 'error'].includes(String(easytier.status))
    || !optional(easytier.errorCode, code) || !optional(easytier.node, validateNode)
    || !optional(easytier.truncated, (v) => typeof v === 'boolean')
    || !optional(easytier.omittedPeers, (v) => integer(v) && v > 0)
    || easytier.omittedPeers !== undefined && easytier.truncated !== true
    || !array(easytier.peers, 256, validatePeer) || easytier.status === 'ok' && easytier.node === undefined) return null;
  if (!optional(value.commandAck, (ack) => object(ack, ['id', 'status', 'completedAt', 'errorCode'])
    && identifier(ack.id) && ['completed', 'failed'].includes(String(ack.status)) && timelyDate(ack.completedAt, now)
    && optional(ack.errorCode, code))) return null;
  // All objects are field-whitelisted; cloning severs references without dropping unsafe fields silently.
  return structuredClone(value) as unknown as HostReport;
}

function validateNode(node: unknown): boolean {
  return object(node, ['peerId', 'hostname', 'version', 'virtualIpv4', 'virtualIpv6', 'listeners', 'proxyCidrs'])
    && integer(node.peerId, 0xffffffff) && text(node.hostname, 128) && text(node.version, 40)
    && optional(node.virtualIpv4, ipv4Cidr) && optional(node.virtualIpv6, ipv6Cidr)
    && array(node.listeners, 16, safeTransportUri) && array(node.proxyCidrs, 32, cidr);
}
function validatePeer(peer: unknown): boolean {
  return object(peer, ['peerId', 'hostname', 'version', 'virtualIpv4', 'proxyCidrs', 'nextHopPeerId', 'cost', 'connections'])
    && integer(peer.peerId, 0xffffffff) && optional(peer.hostname, (v) => text(v, 128)) && optional(peer.version, (v) => text(v, 40))
    && optional(peer.virtualIpv4, ipv4Cidr) && array(peer.proxyCidrs, 32, cidr)
    && optional(peer.nextHopPeerId, (v) => integer(v, 0xffffffff)) && optional(peer.cost, (v) => number(v, 1e9))
    && array(peer.connections, 16, (conn) => object(conn, ['transport', 'remoteAddress', 'latencyMs', 'lossRate', 'rxBytes', 'txBytes'])
      && code(conn.transport) && optional(conn.remoteAddress, remoteAddress) && optional(conn.latencyMs, (v) => number(v, 1e9))
      && optional(conn.lossRate, (v) => number(v, 1)) && integer(conn.rxBytes) && integer(conn.txBytes));
}

export function snapshotFreshness(receivedAt: string | undefined, now = Date.now()): HostSnapshot['freshness'] {
  if (!receivedAt) return 'never';
  const age = now - Date.parse(receivedAt);
  return Number.isFinite(age) && age >= 0 && age <= HOST_FRESHNESS_MS ? 'fresh' : 'stale';
}

export function configProfile(snapshot: HostSnapshot, now = Date.now()): ConfigProfile {
  const ddns = snapshot.readErrorCode ? undefined : snapshot.report?.ddns;
  const verifiedAge = ddns?.lastSuccessAt ? now - Date.parse(ddns.lastSuccessAt) : Infinity;
  const confirmed = snapshotFreshness(snapshot.receivedAt, now) === 'fresh'
    && ddns && ['updated', 'unchanged', 'check_ok'].includes(ddns.status)
    && ddns.name.toLowerCase() === snapshot.profile.directHostname.toLowerCase()
    && ddns.proxied === false && ddns.ipv6 && validIpv6(ddns.ipv6, true)
    && ddns.currentIpv6 && canonicalIpv6(ddns.ipv6) === canonicalIpv6(ddns.currentIpv6)
    && verifiedAge >= 0 && verifiedAge <= HOST_FRESHNESS_MS;
  return {
    ...snapshot.profile,
    freshness: snapshot.readErrorCode ? 'never' : snapshotFreshness(snapshot.receivedAt, now),
    ...(snapshot.readErrorCode ? { readErrorCode: snapshot.readErrorCode } : {}),
    ddnsStatus: ddns?.status ?? 'unknown',
    ...(confirmed ? { confirmedIpv6: ddns.ipv6, verifiedAt: ddns.lastSuccessAt } : {}),
    directPeers: confirmed ? [`udp://${snapshot.profile.directHostname}:${snapshot.profile.directPort}`, `tcp://${snapshot.profile.directHostname}:${snapshot.profile.directPort}`] : [],
    ipv6Only: true,
  };
}

function canonicalIpv6(value: string): string { return new URL(`http://[${value}]/`).hostname; }
