export { RelayRoom } from '../durable-objects/relay-room';
export { Directory } from '../durable-objects/directory';

import { handleApi, json, roomStub, validRoom } from '../observer/api';
import type { Env } from './env';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 });
      const roomId = url.searchParams.get('room');
      if (!validRoom(roomId)) return json({ error: 'invalid or missing room name' }, 400);
      return roomStub(env, roomId).fetch(`https://room/connect?room=${encodeURIComponent(roomId)}`, request);
    }
    const api = await handleApi(request, env);
    if (api) return api;
    if (url.pathname === '/dashboard') return Response.redirect(`${url.origin}/dashboard/`, 302);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
