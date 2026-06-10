import type { DirectoryRoomSummary, RelayEvent, RoomSnapshot, TrafficSnapshot } from '../observer/types';

export async function getRooms(): Promise<DirectoryRoomSummary[]> {
  const data = await fetchJson<{ rooms: DirectoryRoomSummary[] }>('/api/rooms');
  return data.rooms;
}

export async function getRoom(roomId: string): Promise<RoomSnapshot> {
  return fetchJson<RoomSnapshot>(`/api/rooms/${encodeURIComponent(roomId)}`);
}

export async function getRoomEvents(roomId: string): Promise<RelayEvent[]> {
  const data = await fetchJson<{ events: RelayEvent[] }>(`/api/rooms/${encodeURIComponent(roomId)}/events`);
  return data.events;
}

export async function getRoomTraffic(roomId: string): Promise<TrafficSnapshot> {
  return fetchJson<TrafficSnapshot>(`/api/rooms/${encodeURIComponent(roomId)}/traffic`);
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}
