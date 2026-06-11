import { describe, expect, it } from 'vitest';
import worker from './index';
import type { Env } from './env';

const configuredEnv = {
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'password',
  SESSION_SECRET: 'test-session-secret',
  RELAY_TOKEN_SECRET: 'test-relay-secret',
} as Env;

describe('worker auth gates', () => {
  it('requires auth configuration before serving protected API routes', async () => {
    const response = await worker.fetch(new Request('https://edge.example/api/health'), {} as Env);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'auth is not configured' });
  });

  it('requires a dashboard session for API routes', async () => {
    const response = await worker.fetch(new Request('https://edge.example/api/health'), configuredEnv);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'authentication required' });
  });

  it('keeps non-websocket /ws rejection behavior before token checks', async () => {
    const response = await worker.fetch(new Request('https://edge.example/ws?room=home-mesh'), configuredEnv);

    expect(response.status).toBe(426);
    await expect(response.text()).resolves.toBe('WebSocket upgrade required');
  });

  it('rejects websocket upgrades that are missing a room-scoped token', async () => {
    const response = await worker.fetch(new Request('https://edge.example/ws?room=home-mesh', { headers: { Upgrade: 'websocket' } }), configuredEnv);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'invalid or missing websocket token' });
  });

  it('keeps room validation before token checks', async () => {
    const response = await worker.fetch(new Request('https://edge.example/ws?room=../secret', { headers: { Upgrade: 'websocket' } }), configuredEnv);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid or missing room name' });
  });
});
