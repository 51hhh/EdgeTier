import { ROOM_NAME_PATTERN } from '../easytier/constants';
import type { DirectoryRoomSummary } from '../observer/types';

export const ROOM_RECENT_ACTIVITY_TTL_MS = 5 * 60 * 1000;
export const ROOM_ACTIVE_TTL_MS = ROOM_RECENT_ACTIVITY_TTL_MS;

export function markRoomActivity(rooms: DirectoryRoomSummary[], now = Date.now()): DirectoryRoomSummary[] {
  return rooms.map((room) => {
    const lastActivityMs = room.lastActivity ? Date.parse(room.lastActivity) : Number.NaN;
    return {
      ...room,
      active: Number.isFinite(lastActivityMs) && now - lastActivityMs >= 0 && now - lastActivityMs <= ROOM_RECENT_ACTIVITY_TTL_MS,
    };
  });
}

export function validateDirectoryRoomSummary(value: unknown): DirectoryRoomSummary | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<DirectoryRoomSummary>;
  if (typeof candidate.roomId !== 'string' || !ROOM_NAME_PATTERN.test(candidate.roomId)) return null;
  if (!isFiniteNonnegative(candidate.peerCount)) return null;
  if (!isFiniteNonnegative(candidate.websocketCount)) return null;
  if (!isFiniteNonnegative(candidate.bytes)) return null;
  if (candidate.lastActivity !== undefined && (typeof candidate.lastActivity !== 'string' || !Number.isFinite(Date.parse(candidate.lastActivity)))) return null;
  return {
    roomId: candidate.roomId,
    peerCount: candidate.peerCount,
    websocketCount: candidate.websocketCount,
    bytes: candidate.bytes,
    ...(candidate.lastActivity ? { lastActivity: candidate.lastActivity } : {}),
  };
}

function isFiniteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export class Directory implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'POST') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: 'invalid room summary' }, { status: 400 });
      }
      const summary = validateDirectoryRoomSummary(body);
      if (!summary) return Response.json({ error: 'invalid room summary' }, { status: 400 });
      await this.state.storage.put(`room:${summary.roomId}`, summary);
      return Response.json({ ok: true });
    }
    const rooms = await this.state.storage.list<DirectoryRoomSummary>({ prefix: 'room:' });
    const summaries = markRoomActivity([...rooms.values()]).sort((a, b) => a.roomId.localeCompare(b.roomId));
    return Response.json({ rooms: summaries });
  }
}
