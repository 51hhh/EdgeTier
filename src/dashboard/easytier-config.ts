import type { ConfigProfile } from '../observer/host-types';

export interface ConfigRelayPeer {
  uri: string;
  roomId: string;
  networkName: string;
  expiresAt: string;
}

export interface EasyTierConfigOptions {
  instanceName: string;
  networkName: string;
  networkSecret: string;
  hostname?: string;
  dhcp: boolean;
  staticIpv4: string;
  noListener: boolean;
  flags: Partial<Record<EasyTierFlag, boolean>>;
  profile?: ConfigProfile;
  edgePeer?: ConfigRelayPeer;
  includePublicUdpPeer: boolean;
  includePublicTcpPeer: boolean;
}

export type EasyTierFlag =
  | 'latency_first' | 'private_mode' | 'enable_exit_node' | 'no_tun'
  | 'use_smoltcp' | 'disable_ipv6' | 'enable_kcp_proxy' | 'enable_quic_proxy'
  | 'disable_p2p' | 'p2p_only' | 'multi_thread' | 'accept_dns';

export const EASYTIER_FLAG_ORDER: EasyTierFlag[] = [
  'latency_first', 'private_mode', 'enable_exit_node', 'no_tun', 'use_smoltcp',
  'disable_ipv6', 'enable_kcp_proxy', 'enable_quic_proxy', 'disable_p2p',
  'p2p_only', 'multi_thread', 'accept_dns',
];

export type ConfigErrorCode = 'identity' | 'secret' | 'staticIpv4' | 'profile'
  | 'directUnavailable' | 'ipv6Disabled' | 'tokenExpired' | 'tokenMismatch' | 'noPeers' | 'flags' | 'unsafeValue';

export class ConfigValidationError extends Error {
  constructor(readonly code: ConfigErrorCode) {
    super(code);
    this.name = 'ConfigValidationError';
  }
}

const FRESH_MS = 5 * 60 * 1000;

/** Server verification is also checked against the browser clock between polls. */
export function directProfileAvailable(profile: ConfigProfile | undefined, now = Date.now()): boolean {
  if (!profile || profile.readErrorCode || profile.freshness !== 'fresh' || !profile.confirmedIpv6 || !profile.verifiedAt
    || !['updated', 'unchanged', 'check_ok'].includes(profile.ddnsStatus)) return false;
  const age = now - Date.parse(profile.verifiedAt);
  return Number.isFinite(age) && age >= -FRESH_MS && age <= FRESH_MS && profile.directPeers.length > 0;
}

export function relayPeerValid(peer: ConfigRelayPeer | undefined, profile: ConfigProfile | undefined, networkName: string, now = Date.now()): boolean {
  return Boolean(peer && profile && peer.roomId === profile.roomId && peer.networkName === networkName
    && profile.networkName === networkName && Date.parse(peer.expiresAt) > now);
}

export function validStaticIpv4(value: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(value);
  if (!match) return false;
  if (match.slice(1, 5).some((part) => part.length > 1 && part.startsWith('0'))) return false;
  const octets = match.slice(1, 5).map(Number);
  const prefix = Number(match[5]);
  if (octets.some((part) => part > 255) || octets[0] === 0 || octets[0] === 127 || octets[0] >= 224
    || prefix < 1 || prefix > 32) return false;
  const address = octets.reduce((result, part) => result * 256 + part, 0);
  const block = 2 ** (32 - prefix);
  return prefix >= 31 || (address % block !== 0 && address % block !== block - 1);
}

function tomlString(value: string): string {
  // Keep a basic TOML string; JSON's ASCII control escapes are not all valid TOML escapes.
  if (/[\x00-\x1f\x7f]/.test(value)) throw new ConfigValidationError('unsafeValue');
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function directPeerAllowed(uri: string, profile: ConfigProfile): boolean {
  try {
    const url = new URL(uri);
    return ['tcp:', 'udp:'].includes(url.protocol) && url.hostname === profile.directHostname
      && Number(url.port) === profile.directPort && !url.username && !url.password
      && !url.search && !url.hash && (url.pathname === '' || url.pathname === '/');
  } catch { return false; }
}

/** Pure browser-side export. It never uploads the network secret or rendered TOML. */
export function buildEasyTierConfig(options: EasyTierConfigOptions, now = Date.now()): string {
  if (!options.instanceName.trim() || !options.networkName.trim()) throw new ConfigValidationError('identity');
  if (!options.networkSecret) throw new ConfigValidationError('secret');
  if (!options.profile || options.profile.networkName !== options.networkName) throw new ConfigValidationError('profile');
  if (!options.dhcp && !validStaticIpv4(options.staticIpv4)) throw new ConfigValidationError('staticIpv4');
  if (options.flags.disable_p2p && options.flags.p2p_only) throw new ConfigValidationError('flags');

  const wantsDirect = options.includePublicUdpPeer || options.includePublicTcpPeer;
  if (wantsDirect && !directProfileAvailable(options.profile, now)) throw new ConfigValidationError('directUnavailable');
  if (wantsDirect && options.flags.disable_ipv6) throw new ConfigValidationError('ipv6Disabled');
  const peers = options.profile.directPeers.filter((uri) => (
    (options.includePublicUdpPeer && uri.startsWith('udp://'))
    || (options.includePublicTcpPeer && uri.startsWith('tcp://'))
  ));
  if (peers.some((uri) => !directPeerAllowed(uri, options.profile!))) throw new ConfigValidationError('directUnavailable');
  if (wantsDirect && !peers.length) throw new ConfigValidationError('directUnavailable');
  if (options.edgePeer) {
    if (Date.parse(options.edgePeer.expiresAt) <= now || !Number.isFinite(Date.parse(options.edgePeer.expiresAt))) throw new ConfigValidationError('tokenExpired');
    if (!relayPeerValid(options.edgePeer, options.profile, options.networkName, now)) throw new ConfigValidationError('tokenMismatch');
    let uri: URL;
    try { uri = new URL(options.edgePeer.uri); } catch { throw new ConfigValidationError('tokenMismatch'); }
    if (!['wss:', 'ws:'].includes(uri.protocol) || uri.username || uri.password || uri.hash
      || uri.pathname !== '/ws' || uri.searchParams.get('room') !== options.profile.roomId
      || !uri.searchParams.get('token')) throw new ConfigValidationError('tokenMismatch');
    peers.push(options.edgePeer.uri);
  }
  if (!peers.length) throw new ConfigValidationError('noPeers');

  const lines = [
    '# EasyTier 2.6.4 client config generated by EdgeTier',
    '# Contains network_secret. Keep this file private.',
    ...(options.edgePeer ? [`# Temporary WSS credential expires at ${options.edgePeer.expiresAt}; renew before reconnecting.`] : []),
    '', `instance_name = ${tomlString(options.instanceName)}`, `dhcp = ${options.dhcp}`,
    `hostname = ${tomlString(options.hostname ?? '')}`,
    ...(!options.dhcp ? [`ipv4 = ${tomlString(options.staticIpv4)}`] : []),
    ...(options.noListener ? ['listeners = []'] : []),
    '', '[network_identity]', `network_name = ${tomlString(options.networkName)}`,
    `network_secret = ${tomlString(options.networkSecret)}`, '',
  ];
  for (const uri of [...new Set(peers)]) lines.push('[[peer]]', `uri = ${tomlString(uri)}`, '');
  lines.push('[flags]', 'enable_encryption = true', `enable_ipv6 = ${!options.flags.disable_ipv6}`);
  for (const flag of EASYTIER_FLAG_ORDER) {
    if (flag !== 'disable_ipv6' && options.flags[flag] !== undefined) lines.push(`${flag} = ${Boolean(options.flags[flag])}`);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function defaultConfigOptions(networkName = 'home-mesh'): EasyTierConfigOptions {
  return {
    instanceName: `${networkName}-client`, networkName, networkSecret: '', hostname: '',
    dhcp: true, staticIpv4: '', noListener: true,
    flags: { latency_first: true, private_mode: true, multi_thread: true, enable_exit_node: false,
      no_tun: false, disable_ipv6: false, disable_p2p: false },
    includePublicUdpPeer: true, includePublicTcpPeer: true,
  };
}
