import { describe, expect, it, vi } from 'vitest';
import { handleApi, validRoom } from './api';
import type { Env } from '../worker/env';

describe('validRoom', () => {
  it('accepts supported room names', () => {
    expect(validRoom('test')).toBe(true);
    expect(validRoom('home-mesh_01.prod')).toBe(true);
    expect(validRoom('A'.repeat(64))).toBe(true);
  });

  it('rejects missing, unsafe, and too-long room names', () => {
    expect(validRoom(null)).toBe(false);
    expect(validRoom('')).toBe(false);
    expect(validRoom('-starts-with-dash')).toBe(false);
    expect(validRoom('../secret')).toBe(false);
    expect(validRoom('has space')).toBe(false);
    expect(validRoom('A'.repeat(65))).toBe(false);
  });
});

describe('release health', () => {
  it('reports patch version and the existing host, configuration and relay capabilities', async () => {
    const response = await handleApi(new Request('https://edge.example/api/health'), {} as Env,
      { username: 'fixture-admin', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      ok: true, service: 'edgetier', version: '0.2.1',
      capabilities: expect.arrayContaining(['wss-relay', 'easytier-outbound-tcp', 'host-status', 'ddns-management', 'config-profiles']),
    });
  });
});

describe('encoded room paths', () => {
  const session = { username: 'fixture-admin', expiresAt: new Date(Date.now() + 60_000).toISOString() };

  it.each(['%ZZ', '%E0%A4%A'])('returns a controlled400 for malformed encoding %s before accessing storage', async (path) => {
    const get = vi.fn(() => { throw new Error('storage must not be called'); });
    const env = { RELAY_ROOM: { idFromName: get, get } } as unknown as Env;
    const response = await handleApi(new Request(`https://edge.example/api/rooms/${path}`), env, session);
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({ error: 'invalid room name' });
    expect(get).not.toHaveBeenCalled();
  });

  it('decodes a correctly encoded supported room and routes its request', async () => {
    const idFromName = vi.fn((name: string) => name);
    const fetch = vi.fn(async () => Response.json({ roomId: 'home-mesh' }));
    const env = { RELAY_ROOM: { idFromName, get: () => ({ fetch }) } } as unknown as Env;
    const response = await handleApi(new Request('https://edge.example/api/rooms/%68ome-mesh'), env, session);
    expect(response?.status).toBe(200);
    expect(idFromName).toHaveBeenCalledWith('home-mesh');
    expect(fetch).toHaveBeenCalledWith('https://room/?room=home-mesh');
  });
});
