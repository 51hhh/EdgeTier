import { ROOM_NAME_PATTERN } from '../easytier/constants';
import { resolveDefaultRoomConfig } from '../durable-objects/relay-room';
import { issueRelayToken, type VerifiedSession } from '../worker/auth';
import type { Env } from '../worker/env';

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function validRoom(roomId: string | null): roomId is string {
  return Boolean(roomId && ROOM_NAME_PATTERN.test(roomId));
}

export function roomStub(env: Env, roomId: string): DurableObjectStub {
  const id = env.RELAY_ROOM.idFromName(roomId);
  return env.RELAY_ROOM.get(id);
}

export async function handleApi(request: Request, env: Env, session: VerifiedSession): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/api/health') return json({ ok: true, service: 'edgetier', version: '0.1.1', capabilities: ['wss-relay', 'easytier-outbound-tcp', 'easytier-handshake', 'easytier-rpc-decode', 'easytier-peer-center', 'topology-api', 'observer-api', 'dashboard', 'private-auth'] });
  if (url.pathname === '/api/auth/me') return json({ authenticated: true, user: { username: session.username }, expiresAt: session.expiresAt });
  if (url.pathname === '/api/default-room') return json(resolveDefaultRoomConfig(env));
  if (url.pathname === '/api/rooms') return env.DIRECTORY.get(env.DIRECTORY.idFromName('global')).fetch('https://directory/');
  const match = /^\/api\/rooms\/([^/]+)(?:\/(peers|events|traffic|topology|outbound-tcp|token|test-seed))?$/.exec(url.pathname);
  if (!match) return null;
  const roomId = decodeURIComponent(match[1]);
  if (!validRoom(roomId)) return json({ error: 'invalid room name' }, 400);
  if (match[2] === 'token') {
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    const issued = await issueRelayToken(env, roomId, session.username);
    return json({ room: roomId, token: issued.token, expiresAt: issued.expiresAt, uriPath: `/ws?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(issued.token)}` });
  }
  if (match[2] === 'test-seed') {
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    const body = await request.text();
    return roomStub(env, roomId).fetch(`https://room/test-seed?room=${encodeURIComponent(roomId)}`, { method: 'POST', body: body || '{}', headers: { 'Content-Type': 'application/json' } });
  }
  if (match[2] === 'outbound-tcp') {
    if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    const body = request.method === 'POST' ? await request.text() : undefined;
    return roomStub(env, roomId).fetch(`https://room/outbound-tcp?room=${encodeURIComponent(roomId)}`, { method: request.method, body });
  }
  const subpath = match[2] ? `/${match[2]}` : '/';
  const response = await roomStub(env, roomId).fetch(`https://room${subpath}?room=${encodeURIComponent(roomId)}`);
  return response;
}
