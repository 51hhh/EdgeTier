import { ROOM_NAME_PATTERN } from '../easytier/constants';
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

export async function handleApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/api/health') return json({ ok: true, service: 'edgetier', version: '0.1.1', capabilities: ['wss-relay-skeleton', 'observer-api', 'dashboard'] });
  if (url.pathname === '/api/rooms') return env.DIRECTORY.get(env.DIRECTORY.idFromName('global')).fetch('https://directory/');
  const match = /^\/api\/rooms\/([^/]+)(?:\/(peers|events|traffic))?$/.exec(url.pathname);
  if (!match) return null;
  const roomId = decodeURIComponent(match[1]);
  if (!validRoom(roomId)) return json({ error: 'invalid room name' }, 400);
  const subpath = match[2] ? `/${match[2]}` : '/';
  const response = await roomStub(env, roomId).fetch(`https://room${subpath}?room=${encodeURIComponent(roomId)}`);
  return response;
}
