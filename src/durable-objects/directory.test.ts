import { describe, expect, it } from 'vitest';
import type { DirectoryRoomSummary } from '../observer/types';
import { markRoomActivity, ROOM_ACTIVE_TTL_MS, validateDirectoryRoomSummary } from './directory';

const now = Date.parse('2026-06-09T12:00:00.000Z');

describe('Directory room activity freshness', () => {
  it('marks recent room summaries active', () => {
    const rooms: DirectoryRoomSummary[] = [{
      roomId: 'active-room',
      peerCount: 1,
      websocketCount: 1,
      bytes: 128,
      lastActivity: new Date(now - ROOM_ACTIVE_TTL_MS + 1000).toISOString(),
    }];

    expect(markRoomActivity(rooms, now)[0]).toMatchObject({ roomId: 'active-room', active: true });
  });

  it('marks old and missing activity room summaries inactive', () => {
    const rooms: DirectoryRoomSummary[] = [
      {
        roomId: 'stale-room',
        peerCount: 0,
        websocketCount: 0,
        bytes: 128,
        lastActivity: new Date(now - ROOM_ACTIVE_TTL_MS - 1).toISOString(),
      },
      { roomId: 'unknown-room', peerCount: 0, websocketCount: 0, bytes: 0 },
    ];

    expect(markRoomActivity(rooms, now).map((room) => room.active)).toEqual([false, false]);
  });

  it('rejects future activity timestamps as inactive', () => {
    const rooms: DirectoryRoomSummary[] = [{
      roomId: 'future-room',
      peerCount: 1,
      websocketCount: 1,
      bytes: 128,
      lastActivity: new Date(now + 1000).toISOString(),
    }];

    expect(markRoomActivity(rooms, now)[0].active).toBe(false);
  });
});

describe('Directory room summary validation', () => {
  it('accepts valid summaries and drops caller supplied active flags', () => {
    expect(validateDirectoryRoomSummary({
      roomId: 'home-mesh',
      peerCount: 1,
      websocketCount: 2,
      bytes: 1024,
      lastActivity: new Date(now).toISOString(),
      active: true,
    })).toEqual({
      roomId: 'home-mesh',
      peerCount: 1,
      websocketCount: 2,
      bytes: 1024,
      lastActivity: new Date(now).toISOString(),
    });
  });

  it('rejects invalid summary payloads', () => {
    expect(validateDirectoryRoomSummary({ roomId: '../secret', peerCount: 0, websocketCount: 0, bytes: 0 })).toBeNull();
    expect(validateDirectoryRoomSummary({ roomId: 'room', peerCount: -1, websocketCount: 0, bytes: 0 })).toBeNull();
    expect(validateDirectoryRoomSummary({ roomId: 'room', peerCount: 0, websocketCount: Number.NaN, bytes: 0 })).toBeNull();
    expect(validateDirectoryRoomSummary({ roomId: 'room', peerCount: 0, websocketCount: 0, bytes: Infinity })).toBeNull();
    expect(validateDirectoryRoomSummary({ roomId: 'room', peerCount: 0, websocketCount: 0, bytes: 0, lastActivity: 'not-a-date' })).toBeNull();
  });
});
