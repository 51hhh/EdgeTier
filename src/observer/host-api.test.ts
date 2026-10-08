import { describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { createSessionCookie } from '../worker/auth';
import type { Env } from '../worker/env';
import type { HostProfile, HostReport } from './host-types';

const profile: HostProfile = { hostId: 'onecloud', displayName: 'OneCloud', roomId: 'home', networkName: 'mesh', directHostname: 'home.example.com', directPort: 11010 };
const otherProfile = { ...profile, hostId: 'other-host' };
const hostToken = 'host-token-onecloud-32-characters-minimum';
const otherToken = 'host-token-other-32-characters-minimum';
function environment(profiles = [profile]): Env {
  return {
    ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'password', SESSION_SECRET: 'test-session-secret', RELAY_TOKEN_SECRET: 'test-relay-secret',
    HOST_PROFILES: JSON.stringify(profiles), HOST_REPORT_TOKENS: JSON.stringify({ onecloud: hostToken, 'other-host': otherToken }),
    HOST_STATE: {
      idFromName: (id: string) => id,
      get: () => ({ fetch: vi.fn(async (request: string, options?: RequestInit) => request.includes('/report?')
        ? Response.json({ accepted: true })
        : request.includes('/ddns-refresh?') ? Response.json({ command: { id: 'fixed-command', kind: 'ddns-refresh', status: 'pending' } })
          : Response.json({ profile, freshness: 'never', ddnsHistory: [] })) }),
    } as unknown as DurableObjectNamespace,
  } as Env;
}
function report(): HostReport {
  return { schemaVersion: 1, hostId: 'onecloud', reportId: 'report-1', bootId: 'boot-1', sequence: 1, capturedAt: new Date().toISOString(), collectorVersion: '1.0', ddns: { name: profile.directHostname, status: 'unknown' }, services: [], easytier: { status: 'error', peers: [] } };
}
async function cookie(env: Env): Promise<string> { return (await createSessionCookie(env, 'admin')).split(';')[0]; }
function ingest(body: unknown, token = hostToken, host = 'onecloud', headers: Record<string, string> = {}): Request {
  return new Request(`https://edge.example/api/hosts/${host}/report`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

describe('host versus administrator authentication', () => {
  it('allows only the configured per-host bearer for ingest', async () => {
    const env = environment([profile, otherProfile]);
    expect((await worker.fetch(ingest(report()), env)).status).toBe(200);
    expect((await worker.fetch(ingest(report(), otherToken), env)).status).toBe(401);
    expect((await worker.fetch(ingest(report(), hostToken, 'unknown-host'), env)).status).toBe(401);
    expect((await worker.fetch(ingest({ ...report(), hostId: 'other-host' }), env)).status).toBe(400);
    const browserOnly = new Request('https://edge.example/api/hosts/onecloud/report', { method: 'POST', headers: { Cookie: await cookie(env) }, body: JSON.stringify(report()) });
    expect((await worker.fetch(browserOnly, env)).status).toBe(401);
  });
  it('keeps host ingest credentials out of administrator reads and mutation', async () => {
    const env = environment();
    for (const path of ['/api/hosts', '/api/hosts/onecloud', '/api/config-profiles']) {
      expect((await worker.fetch(new Request(`https://edge.example${path}`, { headers: { Authorization: `Bearer ${hostToken}` } }), env)).status).toBe(401);
      expect((await worker.fetch(new Request(`https://edge.example${path}`, { headers: { Cookie: await cookie(env) } }), env)).status).toBe(200);
    }
    expect((await worker.fetch(new Request('https://edge.example/api/hosts/onecloud/ddns-refresh', { method: 'POST', headers: { Origin: 'https://edge.example', Authorization: `Bearer ${hostToken}` } }), env)).status).toBe(401);
  });
  it('requires same-origin for a session-authorized fixed DDNS request', async () => {
    const env = environment();
    const auth = await cookie(env);
    for (const origin of [undefined, 'https://other.example']) {
      expect((await worker.fetch(new Request('https://edge.example/api/hosts/onecloud/ddns-refresh', { method: 'POST', headers: { Cookie: auth, ...(origin ? { Origin: origin } : {}) } }), env)).status).toBe(403);
    }
    const response = await worker.fetch(new Request('https://edge.example/api/hosts/onecloud/ddns-refresh', { method: 'POST', headers: { Cookie: auth, Origin: 'https://edge.example' } }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ command: { kind: 'ddns-refresh' } });
  });
});

describe('host HTTP input limits and empty configuration', () => {
  it('checks stream byte limits independently of Content-Length', async () => {
    const env = environment();
    expect((await worker.fetch(ingest({ ...report(), arbitrary: 'x'.repeat(65536) }), env)).status).toBe(413);
    expect((await worker.fetch(ingest(report(), hostToken, 'onecloud', { 'Content-Length': '999999' }), env)).status).toBe(413);
    expect((await worker.fetch(new Request('https://edge.example/api/hosts/onecloud/report', { method: 'POST', headers: { Authorization: `Bearer ${hostToken}` }, body: '{broken' }), env)).status).toBe(400);
  });
  it('returns controlled errors when host storage transport fails', async () => {
    const env = environment();
    env.HOST_STATE = {
      idFromName: (id: string) => id,
      get: () => ({ fetch: async () => { throw new Error('private storage failure'); } }),
    } as unknown as DurableObjectNamespace;
    const auth = await cookie(env);
    const requests = [
      ingest(report()),
      new Request('https://edge.example/api/hosts/onecloud', { headers: { Cookie: auth } }),
      new Request('https://edge.example/api/hosts/onecloud/ddns-refresh', { method: 'POST', headers: { Cookie: auth, Origin: 'https://edge.example' } }),
    ];
    for (const request of requests) {
      const response = await worker.fetch(request, env);
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain('private storage failure');
    }
    for (const path of ['/api/hosts', '/api/config-profiles']) {
      const response = await worker.fetch(new Request(`https://edge.example${path}`, { headers: { Cookie: auth } }), env);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('host_state_unavailable');
      expect(body).not.toContain('private storage failure');
    }
  });
  it('retains healthy hosts and blocks only the failed profile across transport and body failures', async () => {
    const env = environment([profile, otherProfile]);
    const at = new Date().toISOString();
    const healthy = { profile, report: { ...report(), ddns: { name: profile.directHostname, status: 'unchanged', ipv6: '2409::1', currentIpv6: '2409::1', proxied: false, lastSuccessAt: at } }, receivedAt: at, freshness: 'fresh', ddnsHistory: [] };
    const failures = [
      async () => { throw new Error('private failure'); },
      async () => Response.json({ error: 'private failure' }, { status: 503 }),
      async () => new Response('{bad json'),
      async () => Response.json(null),
      async () => Response.json({ ...healthy, report: { ddns: { status: 'unchanged' } } }),
      async () => Response.json({ ...healthy, freshness: 'invalid' }),
    ];
    const auth = await cookie(env);
    for (const fail of failures) {
      env.HOST_STATE = { idFromName: (id: string) => id, get: (id: unknown) => ({ fetch: id === profile.hostId ? async () => Response.json(healthy) : fail }) } as unknown as DurableObjectNamespace;
      const hostsResponse = await worker.fetch(new Request('https://edge.example/api/hosts', { headers: { Cookie: auth } }), env);
      expect(hostsResponse.status).toBe(200);
      const hosts = (await hostsResponse.json() as { hosts: unknown[] }).hosts;
      expect(hosts[0]).toEqual(healthy);
      expect(hosts[1]).toEqual({ profile: otherProfile, freshness: 'never', ddnsHistory: [], readErrorCode: 'host_state_unavailable' });
      const profilesResponse = await worker.fetch(new Request('https://edge.example/api/config-profiles', { headers: { Cookie: auth } }), env);
      expect(profilesResponse.status).toBe(200);
      const profiles = (await profilesResponse.json() as { profiles: unknown[] }).profiles;
      expect(profiles[0]).toMatchObject({ hostId: profile.hostId, freshness: 'fresh', directPeers: ['udp://home.example.com:11010', 'tcp://home.example.com:11010'] });
      expect(profiles[1]).toMatchObject({ hostId: otherProfile.hostId, freshness: 'never', ddnsStatus: 'unknown', directPeers: [`udp://${otherProfile.directHostname}:${otherProfile.directPort}`, `tcp://${otherProfile.directHostname}:${otherProfile.directPort}`], readErrorCode: 'host_state_unavailable', directVerification: 'unknown' });
      expect(JSON.stringify(hosts)).not.toContain('private failure');
    }
  });
  it('retains correctly stored reports older than the ingestion window', async () => {
    const env = environment();
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const snapshot = { profile, report: { ...report(), capturedAt: old }, receivedAt: old, freshness: 'stale', ddnsHistory: [] };
    env.HOST_STATE = { idFromName: (id: string) => id, get: () => ({ fetch: async () => Response.json(snapshot) }) } as unknown as DurableObjectNamespace;
    const response = await worker.fetch(new Request('https://edge.example/api/hosts', { headers: { Cookie: await cookie(env) } }), env);
    expect(response.status).toBe(200);
    expect((await response.json() as { hosts: unknown[] }).hosts[0]).toEqual(snapshot);
  });
  it('returns empty hosts/profiles and controlled errors for invalid configuration', async () => {
    const env = environment();
    delete env.HOST_PROFILES;
    delete env.HOST_STATE;
    const auth = await cookie(env);
    expect(await (await worker.fetch(new Request('https://edge.example/api/hosts', { headers: { Cookie: auth } }), env)).json()).toEqual({ hosts: [] });
    expect(await (await worker.fetch(new Request('https://edge.example/api/config-profiles', { headers: { Cookie: auth } }), env)).json()).toEqual({ profiles: [] });
    env.HOST_PROFILES = '{broken';
    expect((await worker.fetch(new Request('https://edge.example/api/hosts', { headers: { Cookie: auth } }), env)).status).toBe(503);
  });
});
