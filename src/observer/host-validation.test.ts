import { describe, expect, it } from 'vitest';
import type { HostProfile, HostReport, HostSnapshot } from './host-types';
import { configProfile, HOST_FRESHNESS_MS, parseHostProfiles, safeTransportUri, validateHostReport } from './host-validation';

const now = Date.parse('2026-10-05T12:00:00Z');
const at = new Date(now).toISOString();
const ipv6 = '2001:db8::1';
const profile: HostProfile = { hostId: 'onecloud', displayName: 'OneCloud', roomId: 'room-home', networkName: 'home-mesh', directHostname: 'home.example.com', directPort: 11010 };
function report(): HostReport {
  return {
    schemaVersion: 1, hostId: 'onecloud', reportId: 'report-1', bootId: 'boot-1', sequence: 1, capturedAt: at, collectorVersion: '1.0',
    ddns: { name: profile.directHostname, status: 'unchanged', ipv6, currentIpv6: ipv6, ttl: 120, proxied: false, lastAttemptAt: at, lastSuccessAt: at },
    services: [{ unit: 'easytier-core-home.service', activeState: 'active', subState: 'running', enabled: true }],
    easytier: { status: 'ok', node: { peerId: 1, hostname: 'test-host', version: '2.6.4', virtualIpv4: '10.144.1.1/24', listeners: ['udp://[::]:11010'], proxyCidrs: ['192.168.1.0/24'] }, peers: [{ peerId: 2, proxyCidrs: [], connections: [{ transport: 'tcp', remoteAddress: 'tcp://[2001:db8::2]:11010', rxBytes: 123, txBytes: 456, lossRate: 0, latencyMs: 12.5 }] }] },
  };
}

describe('configured host profiles', () => {
  it('supports empty configuration without inventing a host', () => {
    expect(parseHostProfiles(undefined)).toEqual([]);
    expect(parseHostProfiles(JSON.stringify([profile]))).toEqual([profile]);
  });
  it('accepts dotted host identifiers supported by the collector', () => {
    expect(parseHostProfiles(JSON.stringify([{ ...profile, hostId: 'edge.office' }]))?.[0].hostId).toBe('edge.office');
  });
  it('rejects malformed, duplicate and credential-bearing profiles', () => {
    expect(parseHostProfiles('{')).toBeNull();
    expect(parseHostProfiles(JSON.stringify([profile, profile]))).toBeNull();
    expect(parseHostProfiles(JSON.stringify([{ ...profile, directHostname: 'admin:secret@home.example.com' }]))).toBeNull();
    expect(parseHostProfiles(JSON.stringify([{ ...profile, secret: 'must-not-persist' }]))).toBeNull();
    expect(parseHostProfiles(JSON.stringify([{ ...profile, directPort: 0 }]))).toBeNull();
  });
});

describe('credential-free host report boundary', () => {
  it('accepts the allowlisted real-node shape', () => {
    expect(validateHostReport(report(), 'onecloud', now)).toEqual(report());
  });
  it('accepts explicit topology truncation and permanent unit-file enablement', () => {
    const candidate = report();
    candidate.easytier.truncated = true;
    candidate.easytier.omittedPeers = 12;
    candidate.services[0].unitFileState = 'enabled';
    expect(validateHostReport(candidate, 'onecloud', now)).toEqual(candidate);
    candidate.services[0] = { ...candidate.services[0], unitFileState: 'static', enabled: false };
    delete candidate.easytier.omittedPeers;
    expect(validateHostReport(candidate, 'onecloud', now)).toEqual(candidate);
    for (const metadata of [{ truncated: false, omittedPeers: 1 }, { omittedPeers: 1 }, { truncated: true, omittedPeers: 0 }, { truncated: true, omittedPeers: -1 }, { truncated: 'yes' }]) {
      expect(validateHostReport({ ...report(), easytier: { ...report().easytier, ...metadata } }, 'onecloud', now)).toBeNull();
    }
    for (const unitFileState of ['static', 'enabled-runtime', 'unknown', 'credential state']) {
      expect(validateHostReport({ ...report(), services: [{ ...report().services[0], unitFileState }] }, 'onecloud', now)).toBeNull();
    }
  });
  it('rejects DEL in peer names while allowing its sanitized omission', () => {
    const candidate = report();
    candidate.easytier.peers[0].hostname = 'peer\u007f';
    expect(validateHostReport(candidate, 'onecloud', now)).toBeNull();
    delete candidate.easytier.peers[0].hostname;
    expect(validateHostReport(candidate, 'onecloud', now)).not.toBeNull();
  });
  it('rejects unsafe or extra fields at every nested boundary', () => {
    const original = report();
    const badReports = [
      { ...original, hostId: 'other-host' },
      { ...original, config: 'secret' },
      { ...original, easytier: { ...original.easytier, node: { ...original.easytier.node, config: '[network_identity] secret' } } },
      { ...original, services: [{ ...original.services[0], env: 'token' }] },
      { ...original, services: [{ ...original.services[0], unit: 'arbitrary-root-command.service' }] },
      { ...original, ddns: { ...original.ddns, api_key: 'secret' } },
      { ...original, ddns: { ...original.ddns, errorCode: 'request failed with key=secret' } },
      { ...original, easytier: { ...original.easytier, peers: [{ ...original.easytier.peers[0], connections: [{ transport: 'tcp', remoteAddress: 'wss://home.example.com:443?token=secret', rxBytes: 0, txBytes: 0 }] }] } },
      { ...original, easytier: { ...original.easytier, peers: [{ ...original.easytier.peers[0], connections: [{ transport: 'tcp', rxBytes: -1, txBytes: 0 }] }] } },
    ];
    for (const candidate of badReports) expect(validateHostReport(candidate, 'onecloud', now)).toBeNull();
  });
  it('bounds lists and timestamps and rejects malformed IPv6', () => {
    expect(validateHostReport({ ...report(), services: Array(5).fill(report().services[0]) }, 'onecloud', now)).toBeNull();
    expect(validateHostReport({ ...report(), capturedAt: new Date(now + HOST_FRESHNESS_MS + 1).toISOString() }, 'onecloud', now)).toBeNull();
    expect(validateHostReport({ ...report(), capturedAt: new Date(now - 86400001).toISOString() }, 'onecloud', now)).toBeNull();
    expect(validateHostReport({ ...report(), ddns: { ...report().ddns, ipv6: '2001:db8::xyz' } }, 'onecloud', now)).toBeNull();
    expect(validateHostReport({ ...report(), ddns: { ...report().ddns, ipv6: 'fe80::1' } }, 'onecloud', now)).toBeNull();
    expect(validateHostReport({ ...report(), ddns: { ...report().ddns, ipv6: '2::1' } }, 'onecloud', now)).toBeNull();
  });
  it('rejects query, userinfo, paths and internal listeners', () => {
    for (const uri of ['wss://home.example.com:443/?token=secret', 'tcp://user:secret@home.example.com:11010', 'ring://uuid', 'tcp://home.example.com:11010/config']) expect(safeTransportUri(uri)).toBe(false);
    expect(safeTransportUri('udp://[::]:11010')).toBe(true);
    expect(safeTransportUri('wss://home.example.com:443')).toBe(true);
    expect(safeTransportUri('ws://home.example.com:80')).toBe(true);
    expect(safeTransportUri('wss://home.example.com:443?token=secret')).toBe(false);
  });
});

describe('DDNS-backed config profiles', () => {
  function snapshot(): HostSnapshot { return { profile, report: report(), receivedAt: at, freshness: 'fresh', ddnsHistory: [] }; }
  it('uses the profile room and network separately and canonicalizes the confirmed address', () => {
    const state = snapshot();
    state.report!.ddns.currentIpv6 = '2001:db8:0:0:0:0:0:1';
    expect(configProfile(state, now)).toMatchObject({ roomId: 'room-home', networkName: 'home-mesh', directPeers: ['udp://home.example.com:11010', 'tcp://home.example.com:11010'], confirmedIpv6: ipv6, ipv6Only: true });
  });
  it('blocks a read-failed profile even when a prior successful report is retained', () => {
    expect(configProfile({ ...snapshot(), readErrorCode: 'host_state_unavailable' }, now)).toMatchObject({ readErrorCode: 'host_state_unavailable', freshness: 'never', ddnsStatus: 'unknown', directPeers: [] });
  });
  it('blocks direct peers for stale, failed, unconfirmed or mismatched records', () => {
    const bad: HostSnapshot[] = [
      { ...snapshot(), receivedAt: new Date(now - HOST_FRESHNESS_MS - 1).toISOString() },
      { ...snapshot(), report: { ...report(), ddns: { ...report().ddns, status: 'error' } } },
      { ...snapshot(), report: { ...report(), ddns: { ...report().ddns, lastSuccessAt: new Date(now - HOST_FRESHNESS_MS - 1).toISOString() } } },
      { ...snapshot(), report: { ...report(), ddns: { ...report().ddns, proxied: true } } },
      { ...snapshot(), report: { ...report(), ddns: { ...report().ddns, currentIpv6: '2001:db8::2' } } },
      { ...snapshot(), report: { ...report(), ddns: { ...report().ddns, name: 'other.example.com' } } },
      { ...snapshot(), report: { ...report(), ddns: { ...report().ddns, currentIpv6: undefined } } },
    ];
    for (const state of bad) expect(configProfile(state, now).directPeers).toEqual([]);
    expect(configProfile({ profile, freshness: 'never', ddnsHistory: [] }, now)).toMatchObject({ freshness: 'never', ddnsStatus: 'unknown', directPeers: [] });
  });
});
