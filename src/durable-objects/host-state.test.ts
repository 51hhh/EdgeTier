import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostState } from './host-state';
import type { HostCommand, HostProfile, HostReport, HostSnapshot } from '../observer/host-types';
import type { Env } from '../worker/env';
import { HOST_COMMAND_TTL_MS, HOST_FRESHNESS_MS } from '../observer/host-validation';

const now = Date.parse('2026-10-05T12:00:00.123Z');
const profile: HostProfile = { hostId: 'onecloud', displayName: 'OneCloud', roomId: 'home', networkName: 'mesh', directHostname: 'home.example.com', directPort: 11010 };
const env = { HOST_PROFILES: JSON.stringify([profile]) } as Env;
function hostStore() {
  const values = new Map<string, unknown>();
  const state = {
    storage: { async get(key: string) { return structuredClone(values.get(key)); }, async put(key: string, value: unknown) { values.set(key, structuredClone(value)); } },
    blockConcurrencyWhile: async (callback: () => Promise<void>) => callback(),
  } as unknown as DurableObjectState;
  return { state, values };
}
function report(sequence = 1, changes: Partial<HostReport> = {}): HostReport {
  return { schemaVersion: 1, hostId: 'onecloud', reportId: `report-${sequence}`, bootId: 'boot-1', sequence, capturedAt: new Date(Date.now()).toISOString(), collectorVersion: '1.0', ddns: { name: profile.directHostname, status: 'unknown' }, services: [], easytier: { status: 'error', peers: [], errorCode: 'rpc_unavailable' }, ...changes };
}
function request(path = '/', body?: unknown): Request {
  return new Request(`https://host${path}?hostId=onecloud`, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) });
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());

describe('persisted and ordered host heartbeat', () => {
  it('keeps reports and history through eviction and recomputes freshness on read', async () => {
    const { state } = hostStore();
    const first = new HostState(state, env);
    expect(await (await first.fetch(request())).json()).toMatchObject({ freshness: 'never', ddnsHistory: [] });
    expect((await first.fetch(request('/report', report()))).status).toBe(200);
    const restarted = new HostState(state, env);
    expect(await (await restarted.fetch(request())).json()).toMatchObject({ freshness: 'fresh', report: { reportId: 'report-1' }, ddnsHistory: [{ observation: { status: 'unknown' } }] });
    vi.setSystemTime(now + HOST_FRESHNESS_MS + 1);
    expect(await (await restarted.fetch(request())).json()).toMatchObject({ freshness: 'stale', report: { reportId: 'report-1' } });
  });
  it('rejects backwards sequence/time and boot changes that are not newer, without refreshing duplicates', async () => {
    const host = new HostState(hostStore().state, env);
    await host.fetch(request('/report', report(2)));
    vi.setSystemTime(now + 60000);
    expect(await (await host.fetch(request('/report', report(2)))).json()).toMatchObject({ accepted: false, duplicate: true });
    expect((await host.fetch(request('/report', report(1)))).status).toBe(409);
    expect((await host.fetch(request('/report', report(3, { capturedAt: new Date(now - 1).toISOString() })))).status).toBe(409);
    expect((await host.fetch(request('/report', report(1, { reportId: 'new-boot-report', bootId: 'boot-2', capturedAt: new Date(now).toISOString() })))).status).toBe(409);
    expect((await host.fetch(request('/report', report(1, { reportId: 'new-boot-report', bootId: 'boot-2' })))).status).toBe(200);
    const snapshot = await (await host.fetch(request())).json() as HostSnapshot;
    expect(snapshot.ddnsHistory).toHaveLength(1);
    expect(snapshot.ddnsHistory[0].count).toBe(2);
  });
  it('serializes simultaneous reports and bounds history', async () => {
    const host = new HostState(hostStore().state, env);
    const responses = await Promise.all(Array.from({ length: 40 }, (_, index) => host.fetch(request('/report', report(index + 1)))));
    expect(responses.every((response) => response.ok)).toBe(true);
    const snapshot = await (await host.fetch(request())).json() as HostSnapshot;
    expect(snapshot.report?.sequence).toBe(40);
    expect(snapshot.ddnsHistory).toHaveLength(1);
    expect(snapshot.ddnsHistory[0].count).toBe(40);
  });
  it('migrates old failure windows without refreshing the host and preserves the last successful checkpoint', async () => {
    const { state, values } = hostStore();
    const successAt = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const receivedAt = new Date(now - HOST_FRESHNESS_MS - 60_000).toISOString();
    const prior = report(10, { ddns: { name: profile.directHostname, status: 'error', errorCode: 'ipv6_probe_failed',
      ipv6: '2409::1', currentIpv6: '2409::1', proxied: false, lastSuccessAt: successAt } });
    values.set('host-state:v1', { report: prior, receivedAt, recentReportIds: [prior.reportId],
      ddnsHistory: Array.from({ length: 32 }, () => ({ receivedAt, observation: prior.ddns })) });
    const host = new HostState(state, env);
    const snapshot = await (await host.fetch(request())).json() as HostSnapshot;
    expect(snapshot.freshness).toBe('stale');
    expect(snapshot.receivedAt).toBe(receivedAt);
    expect(snapshot.report?.sequence).toBe(10);
    expect(snapshot.ddnsHistory).toHaveLength(2);
    expect(snapshot.ddnsHistory[0].recovered).toBe(true);
    expect(snapshot.ddnsAddressHistory?.[0]).toMatchObject({ ipv6: '2409::1', lastSuccessAt: successAt });
    const restarted = new HostState(state, env);
    expect(await (await restarted.fetch(request())).json()).toEqual(snapshot);
  });
});

describe('fixed DDNS request and acknowledgements', () => {
  async function command(host: HostState): Promise<HostCommand> { return ((await (await host.fetch(request('/ddns-refresh', {}))).json()) as { command: HostCommand }).command; }
  it('deduplicates requests, delivers pending commands, and persists successful acknowledgement across restart', async () => {
    const { state } = hostStore();
    const host = new HostState(state, env);
    const pending = await command(host);
    expect((await command(host)).id).toBe(pending.id);
    expect(await (await host.fetch(request('/report', report()))).json()).toMatchObject({ accepted: true, command: { id: pending.id, kind: 'ddns-refresh' } });
    const acknowledged = report(2, { commandAck: { id: pending.id, status: 'completed', completedAt: new Date(now - 123).toISOString() } });
    expect(await (await host.fetch(request('/report', acknowledged))).json()).toEqual({ accepted: true });
    expect(await (await host.fetch(request('/report', acknowledged))).json()).toEqual({ accepted: false, duplicate: true });
    const restarted = new HostState(state, env);
    expect(await (await restarted.fetch(request())).json()).toMatchObject({ command: { id: pending.id, status: 'completed' } });
  });
  it('does not let old acknowledgements overwrite or block delivery of the next command', async () => {
    const host = new HostState(hostStore().state, env);
    const prior = await command(host);
    const ack = { id: prior.id, status: 'completed' as const, completedAt: new Date(now).toISOString() };
    await host.fetch(request('/report', report(1, { commandAck: ack })));
    const next = await command(host);
    expect(next.id).not.toBe(prior.id);
    const heartbeat = await host.fetch(request('/report', report(2, { commandAck: ack })));
    expect(await heartbeat.json()).toMatchObject({ accepted: true, command: { id: next.id } });
    expect(await (await host.fetch(request())).json()).toMatchObject({ command: { id: next.id, status: 'pending' } });
  });
  it('expires commands after ten minutes and rejects impossible completion times', async () => {
    const host = new HostState(hostStore().state, env);
    const pending = await command(host);
    expect((await host.fetch(request('/report', report(1, { commandAck: { id: pending.id, status: 'completed', completedAt: new Date(now - 6000).toISOString() } })))).status).toBe(400);
    vi.setSystemTime(now + HOST_COMMAND_TTL_MS + 1);
    expect(await (await host.fetch(request('/report', report(2)))).json()).toEqual({ accepted: true });
    expect(await (await host.fetch(request())).json()).toMatchObject({ command: { status: 'failed', errorCode: 'command_expired' } });
  });
});
