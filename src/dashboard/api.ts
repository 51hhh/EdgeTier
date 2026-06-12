import type { DirectoryRoomSummary, RelayEvent, RelayTokenResponse, RoomSnapshot, TrafficSnapshot } from '../observer/types';

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

export async function createRoomRelayToken(roomId: string): Promise<RelayTokenResponse> {
  return fetchJson<RelayTokenResponse>(`/api/rooms/${encodeURIComponent(roomId)}/token`, { method: 'POST' });
}

export async function seedRoom(roomId: string, count: number): Promise<void> {
  await fetchJson(`/api/rooms/${encodeURIComponent(roomId)}/test-seed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count }) });
}

export async function clearRoomSeed(roomId: string): Promise<void> {
  await fetchJson(`/api/rooms/${encodeURIComponent(roomId)}/test-seed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: true }) });
}

export async function logout(): Promise<void> {
  await fetchJson<{ ok: true }>('/api/auth/logout', { method: 'POST' });
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('Authentication required');
  }
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}
