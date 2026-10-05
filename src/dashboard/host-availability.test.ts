import { describe, expect, it } from 'vitest';
import type { ConfigProfile, HostSnapshot } from '../observer/host-types';
import { directProfileAvailable } from './easytier-config';
import { mergeHostSnapshots, observedFreshness, unavailableConfigProfiles, unavailableHostSnapshots } from './host-display';

const NOW = Date.parse('2026-10-05T12:00:00Z');
function host(id = 'onecloud'): HostSnapshot {
  return { profile: { hostId: id, displayName: id, roomId: 'home', networkName: 'mesh', directHostname: 'ip.example.org', directPort: 11010 },
    freshness: 'fresh', receivedAt: new Date(NOW).toISOString(), ddnsHistory: [],
    report: { schemaVersion: 1, hostId: id, reportId: 'report', bootId: 'boot', sequence: 1, capturedAt: new Date(NOW).toISOString(), collectorVersion: '1',
      ddns: { name: 'ip.example.org', status: 'check_ok', ipv6: '2001:db8::1' }, services: [], easytier: { status: 'error', peers: [] } } };
}
function unavailable(previous: HostSnapshot): HostSnapshot { return { profile: previous.profile, freshness: 'never', ddnsHistory: [], readErrorCode: 'host_state_unavailable' }; }
function profile(): ConfigProfile {
  return { ...host().profile, freshness: 'fresh', ddnsStatus: 'check_ok', ipv6Only: true,
    confirmedIpv6: '2001:db8::1', verifiedAt: new Date(NOW).toISOString(), directPeers: ['tcp://ip.example.org:11010'] };
}

describe('independent host read availability', () => {
  it('preserves the failed host as stale while another host receives a newer report', () => {
    const first = host();
    const second = host('other');
    const newer = { ...second, report: { ...second.report!, sequence: 2 } };
    const merged = mergeHostSnapshots([first, second], [unavailable(first), newer]);
    expect(merged[0].report).toBe(first.report);
    expect(merged[0].readErrorCode).toBe('host_state_unavailable');
    expect(observedFreshness(merged[0], NOW)).toBe('stale');
    expect(merged[1]).toBe(newer);
    expect(observedFreshness(merged[1], NOW)).toBe('fresh');
  });
  it('does not attach a prior mesh report to a changed identity or keep removed hosts', () => {
    const previous = host();
    const changed = { ...unavailable(previous), profile: { ...previous.profile, networkName: 'new-mesh' } };
    const merged = mergeHostSnapshots([previous, host('removed')], [changed]);
    expect(merged).toEqual([changed]);
    expect(merged[0].report).toBeUndefined();
    expect(observedFreshness(merged[0], NOW)).toBe('never');
  });
  it('clears an unavailable marker after a successful fresh read', () => {
    const fresh = host();
    const failed = mergeHostSnapshots([fresh], [unavailable(fresh)]);
    const recovered = mergeHostSnapshots(failed, [fresh]);
    expect(recovered[0].readErrorCode).toBeUndefined();
    expect(observedFreshness(recovered[0], NOW)).toBe('fresh');
  });
  it('marks a whole endpoint failure unavailable immediately without dropping last data', () => {
    const previous = host();
    const failed = unavailableHostSnapshots([previous]);
    expect(failed[0].report).toBe(previous.report);
    expect(failed[0].freshness).toBe('stale');
    expect(observedFreshness(failed[0], NOW)).toBe('stale');
  });
});

describe('unavailable direct configuration profiles', () => {
  it('blocks cached direct exports on profile read failure and accepts recovery', () => {
    const fresh = profile();
    expect(directProfileAvailable(fresh, NOW)).toBe(true);
    const failed = unavailableConfigProfiles([fresh])[0];
    expect(failed.directPeers).toEqual([]);
    expect(failed.confirmedIpv6).toBeUndefined();
    expect(directProfileAvailable(failed, NOW)).toBe(false);
    expect(directProfileAvailable(fresh, NOW)).toBe(true);
  });
  it('gives an explicit read error precedence over otherwise fresh data', () => {
    expect(directProfileAvailable({ ...profile(), readErrorCode: 'host_state_unavailable' }, NOW)).toBe(false);
  });
});
