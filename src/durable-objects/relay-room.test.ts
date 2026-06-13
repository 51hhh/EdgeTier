import { describe, expect, it } from 'vitest';
import { EDGE_PEER_ID } from '../easytier/constants';
import { buildRouteConnBitmapForUpdate, buildTopologySummary, framePeerBindingCandidate, resolveNetworkConfig, toArrayBuffer } from './relay-room';

function bitmapHas(bitmap: Uint8Array, size: number, row: number, col: number): boolean {
  const bitIndex = row * size + col;
  return (bitmap[Math.floor(bitIndex / 8)] & (1 << (bitIndex % 8))) !== 0;
}

describe('toArrayBuffer', () => {
  it('encodes strings to UTF-8 buffers', () => {
    const buf = toArrayBuffer('hi');
    expect(buf).not.toBeNull();
    expect(new Uint8Array(buf!)).toEqual(new Uint8Array([0x68, 0x69]));
  });

  it('returns ArrayBuffer inputs unchanged in content', () => {
    const src = new Uint8Array([1, 2, 3]).buffer;
    expect(toArrayBuffer(src)).toBe(src);
  });

  it('copies a TypedArray view honoring byteOffset', () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = backing.subarray(2, 5); // [1,2,3] at byteOffset 2
    const buf = toArrayBuffer(view);
    expect(buf).not.toBeNull();
    expect(new Uint8Array(buf!)).toEqual(new Uint8Array([1, 2, 3]));
    expect(buf!.byteLength).toBe(3);
  });

  it('returns null for unsupported payloads', () => {
    expect(toArrayBuffer(undefined)).toBeNull();
    expect(toArrayBuffer(42 as unknown)).toBeNull();
  });
});

describe('resolveNetworkConfig', () => {
  it('uses EASYTIER_NETWORKS room entries before global fallback', () => {
    expect(resolveNetworkConfig({
      EASYTIER_NETWORK_NAME: 'global-mesh',
      EASYTIER_NETWORK_SECRET: 'global-secret',
      EASYTIER_NETWORKS: JSON.stringify({
        home: { networkName: 'home-mesh', secret: 'home-secret' },
        lab: 'lab-secret',
      }),
    }, 'home')).toEqual({ networkName: 'home-mesh', secret: 'home-secret' });

    expect(resolveNetworkConfig({
      EASYTIER_NETWORK_NAME: 'global-mesh',
      EASYTIER_NETWORK_SECRET: 'global-secret',
      EASYTIER_NETWORKS: JSON.stringify({ lab: 'lab-secret' }),
    }, 'lab')).toEqual({ networkName: 'lab', secret: 'lab-secret' });

    expect(resolveNetworkConfig({
      EASYTIER_NETWORK_SECRET: 'global-secret',
      EASYTIER_NETWORK_SECRETS: JSON.stringify({ 'office-mesh': 'office-secret' }),
      EASYTIER_NETWORKS: JSON.stringify({ office: { networkName: 'office-mesh' } }),
    }, 'office')).toEqual({ networkName: 'office-mesh', secret: 'office-secret' });
  });

  it('falls back to legacy room/network secret maps and global network name', () => {
    expect(resolveNetworkConfig({
      EASYTIER_NETWORK_NAME: 'global-mesh',
      EASYTIER_NETWORK_SECRET: 'global-secret',
      EASYTIER_NETWORK_SECRETS: JSON.stringify({ 'room-a': 'room-secret', 'global-mesh': 'mapped-global-secret' }),
    }, 'room-a')).toEqual({ networkName: 'global-mesh', secret: 'room-secret' });

    expect(resolveNetworkConfig({
      EASYTIER_NETWORK_NAME: 'global-mesh',
      EASYTIER_NETWORK_SECRET: 'global-secret',
      EASYTIER_NETWORK_SECRETS: JSON.stringify({ 'global-mesh': 'mapped-global-secret' }),
    }, 'room-b')).toEqual({ networkName: 'global-mesh', secret: 'mapped-global-secret' });
  });
});

describe('buildRouteConnBitmapForUpdate', () => {
  it('includes EdgeTier live links and observed edges without inventing a full mesh', () => {
    const bitmap = buildRouteConnBitmapForUpdate(
      [EDGE_PEER_ID, 42, 100],
      7,
      [{ fromPeerId: 42, toPeerId: 100, source: 'conn_bitmap' }],
      new Set([42]),
    );
    const peerIds = bitmap.peerIds.map((item) => item.peerId);
    const edgeIndex = peerIds.indexOf(EDGE_PEER_ID);
    const peer42Index = peerIds.indexOf(42);
    const peer100Index = peerIds.indexOf(100);

    expect(bitmap.peerIds.every((item) => item.version === 7)).toBe(true);
    expect(bitmapHas(bitmap.bitmap, peerIds.length, edgeIndex, peer42Index)).toBe(true);
    expect(bitmapHas(bitmap.bitmap, peerIds.length, peer42Index, edgeIndex)).toBe(true);
    expect(bitmapHas(bitmap.bitmap, peerIds.length, peer42Index, peer100Index)).toBe(true);
    expect(bitmapHas(bitmap.bitmap, peerIds.length, edgeIndex, peer100Index)).toBe(false);
    expect(bitmapHas(bitmap.bitmap, peerIds.length, peer100Index, peer42Index)).toBe(false);
  });
});

describe('buildTopologySummary', () => {
  it('counts topology sources and latency fields', () => {
    const summary = buildTopologySummary(
      [
        { peerId: 1, proxyCidrs: [], lastSeen: '2026-06-13T00:00:00.000Z' },
        { peerId: 2, proxyCidrs: [], lastSeen: '2026-06-13T00:00:00.000Z' },
      ],
      [
        { fromPeerId: 1, toPeerId: 2, source: 'conn_bitmap' },
        { fromPeerId: 1, toPeerId: 2, source: 'peer_center', latencyMs: 20 },
        { fromPeerId: 2, toPeerId: 1, source: 'peer_center', latencyMs: 30 },
      ],
    );

    expect(summary).toEqual({
      nodeCount: 2,
      edgeCount: 3,
      connBitmapEdgeCount: 1,
      peerCenterEdgeCount: 2,
      latencyEdgeCount: 2,
      averageLatencyMs: 25,
      peerCenterRatio: 2 / 3,
    });
  });
});

describe('framePeerBindingCandidate', () => {
  it('binds the first non-Edge peer id and ignores later rebinding attempts', () => {
    expect(framePeerBindingCandidate(undefined, 4018890303)).toBe(4018890303);
    expect(framePeerBindingCandidate(undefined, EDGE_PEER_ID)).toBeUndefined();
    expect(framePeerBindingCandidate(4018890303, EDGE_PEER_ID)).toBeUndefined();
    expect(framePeerBindingCandidate(4018890303, 496372248)).toBeUndefined();
  });
});
