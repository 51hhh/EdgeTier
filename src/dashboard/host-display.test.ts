import { describe, expect, it } from 'vitest';
import type { HostSnapshot } from '../observer/host-types';
import { commandPending, observedFreshness, reportAgeSeconds } from './host-display';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const host: HostSnapshot = {
  profile: { hostId: 'onecloud', displayName: 'OneCloud', roomId: 'room-home', networkName: 'home-mesh', directHostname: 'ip.example.org', directPort: 11010 },
  freshness: 'fresh', receivedAt: new Date(NOW - 60_000).toISOString(), ddnsHistory: [],
  report: { schemaVersion: 1, hostId: 'onecloud', reportId: 'report', bootId: 'boot', sequence: 1,
    capturedAt: new Date(NOW - 60_000).toISOString(), collectorVersion: '1',
    ddns: { name: 'ip.example.org', status: 'unchanged' }, services: [], easytier: { status: 'ok', peers: [] } },
};

describe('host freshness display', () => {
  it('ages preserved data after a failed poll without discarding the report', () => {
    expect(observedFreshness(host, NOW)).toBe('fresh');
    expect(observedFreshness(host, NOW + 300_000)).toBe('stale');
    expect(host.report?.easytier.status).toBe('ok');
    expect(reportAgeSeconds(host, NOW)).toBe(60);
  });
  it('keeps server stale state and handles absent/malformed receipt times', () => {
    expect(observedFreshness({ ...host, freshness: 'stale' }, NOW)).toBe('stale');
    expect(observedFreshness({ ...host, report: undefined, receivedAt: undefined, freshness: 'never' }, NOW)).toBe('never');
    expect(observedFreshness({ ...host, receivedAt: 'bad' }, NOW)).toBe('stale');
    expect(reportAgeSeconds({ ...host, receivedAt: 'bad' }, NOW)).toBeUndefined();
  });
  it('allows a new refresh after a pending command expires', () => {
    const command = { id: 'request', kind: 'ddns-refresh' as const, status: 'pending' as const,
      requestedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 600_000).toISOString() };
    expect(commandPending(command, NOW)).toBe(true);
    expect(commandPending(command, NOW + 600_000)).toBe(false);
    expect(commandPending({ ...command, status: 'completed' }, NOW)).toBe(false);
  });
});
