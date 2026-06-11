import { describe, expect, it } from 'vitest';
import { createSessionCookie, issueRelayToken, sessionCookieName, signRelayTokenForTest, verifyRelayToken, verifySessionRequest, type AuthEnv } from './auth';

const env: AuthEnv = {
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'password',
  SESSION_SECRET: 'test-session-secret',
  RELAY_TOKEN_SECRET: 'test-relay-secret',
};

describe('auth helpers', () => {
  it('creates and verifies an HTTP-only session cookie', async () => {
    const cookie = await createSessionCookie(env, 'admin', 1_000);

    expect(cookie).toContain(`${sessionCookieName()}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');

    const request = new Request('https://edge.example/dashboard/', { headers: { Cookie: cookie.split(';')[0] } });
    await expect(verifySessionRequest(request, env, 1_001)).resolves.toMatchObject({ username: 'admin' });
  });

  it('issues room-scoped relay tokens', async () => {
    const issued = await issueRelayToken(env, 'home-mesh', 'admin', 2_000);

    const verified = await verifyRelayToken(env, issued.token, 'home-mesh', 2_001);

    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.claims.room).toBe('home-mesh');
      expect(verified.claims.typ).toBe('edgetier-ws');
      expect(verified.claims.sub).toBe('admin');
    }
  });

  it('rejects missing, mismatched, expired, and tampered relay tokens', async () => {
    const issued = await issueRelayToken(env, 'home-mesh', 'admin', 3_000);

    await expect(verifyRelayToken(env, null, 'home-mesh', 3_001)).resolves.toEqual({ ok: false, reason: 'missing' });
    await expect(verifyRelayToken(env, issued.token, 'other-room', 3_001)).resolves.toEqual({ ok: false, reason: 'room_mismatch' });
    await expect(verifyRelayToken(env, issued.token, 'home-mesh', 3_301)).resolves.toEqual({ ok: false, reason: 'expired' });
    await expect(verifyRelayToken(env, `${issued.token.slice(0, -1)}x`, 'home-mesh', 3_001)).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects malformed relay token claims', async () => {
    const malformed = await signRelayTokenForTest(env, {
      sub: 'admin',
      typ: 'edgetier-ws',
      room: 'home-mesh',
      iat: 4_000,
      exp: 4_300,
      jti: 'not-random-in-test',
    });
    const parts = malformed.split('.');
    const payload = btoa(JSON.stringify({ sub: 'admin', typ: 'other', room: 'home-mesh', iat: 4_000, exp: 4_300, jti: 'x' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

    await expect(verifyRelayToken(env, `v1.${payload}.${parts[2]}`, 'home-mesh', 4_001)).resolves.toEqual({ ok: false, reason: 'bad_signature' });
  });
});
