import { describe, expect, it } from 'vitest';
import type { ConfigProfile } from '../observer/host-types';
import { buildEasyTierConfig, defaultConfigOptions, directProfileAvailable, relayPeerValid, validStaticIpv4 } from './easytier-config';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const profile: ConfigProfile = {
  hostId: 'onecloud', displayName: 'OneCloud', roomId: 'room-home', networkName: 'home-mesh',
  directHostname: 'ip.example.org', directPort: 11010, freshness: 'fresh', ddnsStatus: 'unchanged',
  confirmedIpv6: '2409:1234::1', verifiedAt: new Date(NOW - 60_000).toISOString(), ipv6Only: true,
  directPeers: ['udp://ip.example.org:11010', 'tcp://ip.example.org:11010'],
};
const base = () => ({ ...defaultConfigOptions('home-mesh'), profile, networkSecret: 'test-secret' });
const relay = () => ({ uri: 'wss://edge.example/ws?room=room-home&token=test-token', roomId: 'room-home',
  networkName: 'home-mesh', expiresAt: new Date(NOW + 300_000).toISOString() });

describe('EasyTier 2.6.4 client config', () => {
  it('uses actual profile endpoints and effective listener / IPv6 fields', () => {
    const toml = buildEasyTierConfig(base(), NOW);
    expect(toml).toContain('listeners = []');
    expect(toml).not.toContain('no_listener');
    expect(toml).toContain('enable_ipv6 = true');
    expect(toml).not.toContain('disable_ipv6');
    expect(toml).toContain('enable_encryption = true');
    expect(toml).toContain('uri = "udp://ip.example.org:11010"');
    expect(toml).toContain('uri = "tcp://ip.example.org:11010"');
    expect(toml).not.toContain('ziyourufeng');
    expect(toml).not.toContain('proxy_network');
  });

  it('does not invent peers if a profile has no verified endpoints', () => {
    expect(() => buildEasyTierConfig({ ...base(), profile: { ...profile, directPeers: [] } }, NOW)).toThrow('directUnavailable');
    expect(() => buildEasyTierConfig({ ...base(), profile: undefined }, NOW)).toThrow('profile');
    expect(() => buildEasyTierConfig({ ...base(), includePublicUdpPeer: false, includePublicTcpPeer: false }, NOW)).toThrow('noPeers');
  });

  it('invalidates saved direct profiles after verification ages out or current status fails', () => {
    expect(directProfileAvailable(profile, NOW + 300_000)).toBe(false);
    expect(directProfileAvailable({ ...profile, ddnsStatus: 'error' }, NOW)).toBe(false);
    expect(() => buildEasyTierConfig({ ...base(), profile: { ...profile, freshness: 'stale' } }, NOW)).toThrow('directUnavailable');
    expect(() => buildEasyTierConfig(base(), NOW + 300_000)).toThrow('directUnavailable');
  });

  it('checks the direct endpoint host, port and credentials and requires IPv6', () => {
    for (const uri of ['udp://other.example:11010', 'tcp://user:secret@ip.example.org:11010', 'tcp://ip.example.org:2005', 'tcp://ip.example.org:11010?token=private']) {
      expect(() => buildEasyTierConfig({ ...base(), profile: { ...profile, directPeers: [uri] } }, NOW)).toThrow('directUnavailable');
    }
    expect(() => buildEasyTierConfig({ ...base(), flags: { disable_ipv6: true } }, NOW)).toThrow('ipv6Disabled');
  });

  it('checks separate room identity and WSS expiry on export', () => {
    const edgePeer = relay();
    const options = { ...base(), edgePeer, includePublicUdpPeer: false, includePublicTcpPeer: false };
    expect(relayPeerValid(edgePeer, profile, 'home-mesh', NOW)).toBe(true);
    expect(buildEasyTierConfig(options, NOW)).toContain('room=room-home&token=test-token');
    expect(buildEasyTierConfig(options, NOW)).toContain('Temporary WSS credential expires');
    expect(() => buildEasyTierConfig({ ...options, edgePeer: { ...edgePeer, roomId: 'home-mesh' } }, NOW)).toThrow('tokenMismatch');
    expect(() => buildEasyTierConfig({ ...options, edgePeer: { ...edgePeer, uri: edgePeer.uri.replace('room-home', 'other-room') } }, NOW)).toThrow('tokenMismatch');
    expect(() => buildEasyTierConfig(options, NOW + 300_000)).toThrow('tokenExpired');
    expect(relayPeerValid(edgePeer, profile, 'different-network', NOW)).toBe(false);
  });

  it('supports WSS only on an IPv4-only client without silently adding direct peers', () => {
    const toml = buildEasyTierConfig({ ...base(), profile: { ...profile, directPeers: [], freshness: 'stale' },
      edgePeer: relay(), includePublicUdpPeer: false, includePublicTcpPeer: false, flags: { disable_ipv6: true } }, NOW);
    expect(toml).toContain('enable_ipv6 = false');
    expect(toml).not.toContain('ip.example.org');
  });

  it('requires a valid static address when DHCP is disabled and never emits ipv4 alongside DHCP', () => {
    expect(() => buildEasyTierConfig({ ...base(), dhcp: false }, NOW)).toThrow('staticIpv4');
    expect(buildEasyTierConfig({ ...base(), dhcp: false, staticIpv4: '10.144.1.20/24' }, NOW)).toContain('ipv4 = "10.144.1.20/24"');
    expect(buildEasyTierConfig({ ...base(), staticIpv4: '10.144.1.20/24' }, NOW)).not.toContain('\nipv4 =');
    for (const value of ['10.144.1.0/24', '10.144.1.255/24', '10.144.1.2', '010.144.1.2/24', '300.1.1.1/24', '127.0.0.1/8', '10.1.1.1/33']) expect(validStaticIpv4(value)).toBe(false);
    expect(validStaticIpv4('10.144.1.20/24')).toBe(true);
  });

  it('quotes secrets without TOML injection and rejects control characters and contradictory flags', () => {
    const toml = buildEasyTierConfig({ ...base(), networkSecret: 's"\\key' }, NOW);
    expect(toml).toContain('network_secret = "s\\"\\\\key"');
    expect(() => buildEasyTierConfig({ ...base(), networkSecret: 'secret\n[[peer]]' }, NOW)).toThrow('unsafeValue');
    expect(() => buildEasyTierConfig({ ...base(), flags: { p2p_only: true, disable_p2p: true } }, NOW)).toThrow('flags');
  });
});
