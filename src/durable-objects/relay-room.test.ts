import { describe, expect, it } from 'vitest';
import { EDGE_PEER_ID } from '../easytier/constants';
import {
  applyOspfRouteSessionResponse,
  buildConnectionMatrix,
  buildRouteConnBitmapForUpdate,
  buildRoutePaths,
  buildRouteUpdatePeerIds,
  buildTrafficSample,
  buildTrafficSummary,
  buildTopologySummary,
  createOspfRouteSessionState,
  framePeerBindingCandidate,
  resolveDefaultRoomConfig,
  resolveNetworkConfig,
  resolveOutboundTcpPeers,
  selectRoutePeerInfosForSync,
  toArrayBuffer,
  updateOspfRouteSessionFromRequest,
} from './relay-room';

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

describe('resolveDefaultRoomConfig', () => {
  it('uses the first valid EASYTIER_NETWORKS room without exposing secrets', () => {
    expect(resolveDefaultRoomConfig({
      EASYTIER_NETWORK_NAME: 'global-mesh',
      EASYTIER_NETWORK_SECRET: 'global-secret',
      EASYTIER_NETWORKS: JSON.stringify({
        '../unsafe': { networkName: 'unsafe-mesh', secret: 'unsafe-secret' },
        home: { networkName: 'home-mesh', secret: 'home-secret' },
      }),
    })).toEqual({ roomId: 'home', networkName: 'home-mesh' });
  });

  it('falls back to EASYTIER_NETWORK_NAME as the default room id', () => {
    expect(resolveDefaultRoomConfig({
      EASYTIER_NETWORK_NAME: 'home-mesh',
      EASYTIER_NETWORK_SECRET: 'global-secret',
    })).toEqual({ roomId: 'home-mesh', networkName: 'home-mesh' });
  });

  it('uses default when no valid configured room exists', () => {
    expect(resolveDefaultRoomConfig({
      EASYTIER_NETWORK_NAME: '../unsafe',
      EASYTIER_NETWORKS: JSON.stringify({ '../unsafe': 'secret' }),
    })).toEqual({ roomId: 'default', networkName: 'default' });
  });
});

describe('resolveOutboundTcpPeers', () => {
  it('uses global public TCP peer fallback', () => {
    expect(resolveOutboundTcpPeers({ EASYTIER_PUBLIC_PEER_TCP: 'tcp://example.com:11010' }, 'home-mesh')).toEqual([
      { uri: 'tcp://example.com:11010', hostname: 'example.com', port: 11010 },
    ]);
  });

  it('supports per-room outbound TCP peer maps', () => {
    expect(resolveOutboundTcpPeers({
      EASYTIER_OUTBOUND_TCP_PEERS: JSON.stringify({
        home: ['tcp://home.example:11010', { uri: 'tcp://backup.example:11011' }],
        lab: { peers: 'tcp://lab.example:11010' },
      }),
      EASYTIER_PUBLIC_PEER_TCP: 'tcp://global.example:11010',
    }, 'home')).toEqual([
      { uri: 'tcp://home.example:11010', hostname: 'home.example', port: 11010 },
      { uri: 'tcp://backup.example:11011', hostname: 'backup.example', port: 11011 },
      { uri: 'tcp://global.example:11010', hostname: 'global.example', port: 11010 },
    ]);
  });

  it('ignores invalid and duplicate outbound TCP peers', () => {
    expect(resolveOutboundTcpPeers({
      EASYTIER_OUTBOUND_TCP_PEERS: 'tcp://example.com:11010,udp://example.com:11010,tcp://example.com:11010',
    }, 'home')).toEqual([
      { uri: 'tcp://example.com:11010', hostname: 'example.com', port: 11010 },
    ]);
  });

  it('does not start outbound TCP for script-error room ids', () => {
    expect(resolveOutboundTcpPeers({ EASYTIER_PUBLIC_PEER_TCP: 'tcp://example.com:11010' }, 'null')).toEqual([]);
    expect(resolveOutboundTcpPeers({ EASYTIER_PUBLIC_PEER_TCP: 'tcp://example.com:11010' }, 'undefined')).toEqual([]);
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

describe('buildRouteUpdatePeerIds', () => {
  it('includes live, route, and PeerCenter-only peers in route pushes', () => {
    expect(buildRouteUpdatePeerIds(
      42,
      [42, 100, 0],
      [42],
      [200, 300, 200, -1],
    )).toEqual([42, 100, 200, 300, EDGE_PEER_ID]);
  });
});

describe('OSPF route session state', () => {
  it('tracks remote session changes, initiator state, and saved versions from requests', () => {
    const state = createOspfRouteSessionState(1n);
    updateOspfRouteSessionFromRequest(state, {
      myPeerId: 42,
      mySessionId: 2n,
      isInitiator: true,
      peerInfos: [
        { peerId: 42, proxyCidrs: [], version: 3 },
        { peerId: 100, proxyCidrs: [], version: 4 },
      ],
      connPeerList: {
        peerConnInfos: [
          { peerId: { peerId: 42, version: 5 }, connectedPeerIds: [100] },
          { peerId: { peerId: 100, version: 6 }, connectedPeerIds: [42] },
        ],
      },
    }, 42);

    expect(state.remoteSessionId).toBe(2n);
    expect(state.remoteIsInitiator).toBe(true);
    expect(state.weAreInitiator).toBe(false);
    expect(state.dstSavedPeerInfoVersions.get(42)).toBeUndefined();
    expect(state.dstSavedPeerInfoVersions.get(100)).toBe(4);
    expect(state.dstSavedConnInfoVersions.get(42)).toBeUndefined();
    expect(state.dstSavedConnInfoVersions.get(100)).toBe(6);
  });

  it('acks pending route sync versions only after SyncRouteInfoResponse', () => {
    const state = createOspfRouteSessionState(10n);
    const pending = {
      peerInfos: [
        { peerId: EDGE_PEER_ID, proxyCidrs: [], version: 7 },
        { peerId: 42, proxyCidrs: [], version: 8 },
        { peerId: 100, proxyCidrs: [], version: 9 },
      ],
      connBitmap: {
        peerIds: [
          { peerId: EDGE_PEER_ID, version: 7 },
          { peerId: 42, version: 8 },
          { peerId: 100, version: 9 },
        ],
        bitmap: new Uint8Array([0xff, 0x01]),
      },
    };

    expect(selectRoutePeerInfosForSync(state, pending.peerInfos, 42, false).map((info) => info.peerId)).toEqual([EDGE_PEER_ID, 100]);
    expect(applyOspfRouteSessionResponse(state, { isInitiator: false, sessionId: 20n }, pending, 42, 1234)).toBe(true);
    expect(state.remoteSessionId).toBe(20n);
    expect(state.remoteIsInitiator).toBe(false);
    expect(state.needSyncInitiatorInfo).toBe(false);
    expect(state.lastSyncSuccessAt).toBe(1234);
    expect(state.dstSavedPeerInfoVersions.get(EDGE_PEER_ID)).toBe(7);
    expect(state.dstSavedPeerInfoVersions.get(42)).toBeUndefined();
    expect(state.dstSavedPeerInfoVersions.get(100)).toBe(9);
    expect(selectRoutePeerInfosForSync(state, pending.peerInfos, 42, false)).toEqual([]);
  });
});

describe('buildTopologySummary', () => {
  it('counts topology sources and latency fields', () => {
    const nodes = [
      { peerId: EDGE_PEER_ID, proxyCidrs: [], lastSeen: '2026-06-13T00:00:00.000Z' },
      { peerId: 1, proxyCidrs: [], lastSeen: '2026-06-13T00:00:00.000Z' },
      { peerId: 2, proxyCidrs: [], lastSeen: '2026-06-13T00:00:00.000Z' },
    ];
    const edges = [
      { fromPeerId: EDGE_PEER_ID, toPeerId: 1, source: 'conn_bitmap' as const },
      { fromPeerId: 1, toPeerId: 2, source: 'conn_bitmap' as const },
      { fromPeerId: 1, toPeerId: 2, source: 'peer_center' as const, latencyMs: 20 },
      { fromPeerId: 2, toPeerId: 1, source: 'peer_center' as const, latencyMs: 30 },
    ];
    const matrix = buildConnectionMatrix(edges, nodes.map((node) => node.peerId));
    const routes = buildRoutePaths(nodes, edges, new Set([1]));

    const summary = buildTopologySummary(
      nodes,
      edges,
      routes,
      matrix,
      0.25,
    );

    expect(summary).toEqual({
      nodeCount: 3,
      edgeCount: 4,
      connBitmapEdgeCount: 2,
      peerCenterEdgeCount: 2,
      latencyEdgeCount: 2,
      averageLatencyMs: 25,
      peerCenterRatio: 2 / 4,
      routeCount: 2,
      reachableRouteCount: 2,
      connectionMatrixNodeCount: 3,
      relayDropRate: 0.25,
    });
  });
});

describe('traffic samples', () => {
  it('derives rates and relay drop ratio from cumulative counters', () => {
    const first = buildTrafficSample(undefined, {
      rxBytes: 100,
      txBytes: 40,
      rxPackets: 10,
      txPackets: 4,
      forwardedPackets: 3,
      unroutablePackets: 1,
      invalidPackets: 0,
    }, Date.parse('2026-06-13T00:00:00.000Z'));
    const second = buildTrafficSample(first, {
      rxBytes: 600,
      txBytes: 240,
      rxPackets: 20,
      txPackets: 8,
      forwardedPackets: 6,
      unroutablePackets: 2,
      invalidPackets: 1,
    }, Date.parse('2026-06-13T00:00:05.000Z'));

    expect(first.rxBytesPerSecond).toBe(0);
    expect(first.relayDropRate).toBe(0.1);
    expect(second.rxBytesPerSecond).toBe(100);
    expect(second.txBytesPerSecond).toBe(40);
    expect(second.rxPacketsPerSecond).toBe(2);
    expect(second.relayDropRate).toBe(0.2);
    expect(buildTrafficSummary({
      rxBytes: 600,
      txBytes: 240,
      rxPackets: 20,
      txPackets: 8,
      forwardedPackets: 6,
      unroutablePackets: 2,
      invalidPackets: 1,
    }, second)).toMatchObject({
      rxBytesPerSecond: 100,
      txBytesPerSecond: 40,
      totalRelayDropPackets: 3,
      relayDropRate: 0.15,
      sampledAt: '2026-06-13T00:00:05.000Z',
    });
  });
});

describe('connection matrix and route paths', () => {
  it('builds conn-bitmap rows and shortest Worker-rooted paths', () => {
    const nodes = [
      { peerId: EDGE_PEER_ID, proxyCidrs: [], lastSeen: '2026-06-13T00:00:00.000Z' },
      { peerId: 10, proxyCidrs: [], lastSeen: '2026-06-13T00:00:00.000Z' },
      { peerId: 20, proxyCidrs: [], lastSeen: '2026-06-13T00:00:00.000Z' },
      { peerId: 30, proxyCidrs: [], lastSeen: '2026-06-13T00:00:00.000Z' },
    ];
    const edges = [
      { fromPeerId: EDGE_PEER_ID, toPeerId: 10, source: 'conn_bitmap' as const },
      { fromPeerId: 10, toPeerId: 20, source: 'conn_bitmap' as const },
      { fromPeerId: 10, toPeerId: EDGE_PEER_ID, source: 'peer_center' as const, latencyMs: 12 },
      { fromPeerId: 10, toPeerId: 20, source: 'peer_center' as const, latencyMs: 34 },
    ];

    expect(buildConnectionMatrix(edges, nodes.map((node) => node.peerId))).toEqual({
      peerIds: [10, 20, 30, EDGE_PEER_ID].sort((a, b) => a - b),
      rows: [
        { peerId: 10, connectedPeerIds: [20] },
        { peerId: 20, connectedPeerIds: [] },
        { peerId: 30, connectedPeerIds: [] },
        { peerId: EDGE_PEER_ID, connectedPeerIds: [10] },
      ].sort((a, b) => a.peerId - b.peerId),
    });

    expect(buildRoutePaths(nodes, edges, new Set([10]))).toEqual([
      { peerId: 10, nextHopPeerId: 10, hopCount: 1, pathPeerIds: [EDGE_PEER_ID, 10], source: 'live_peer', latencyMs: 12, cost: undefined, lossRate: undefined },
      { peerId: 20, nextHopPeerId: 10, hopCount: 2, pathPeerIds: [EDGE_PEER_ID, 10, 20], source: 'conn_bitmap', latencyMs: 46, cost: undefined, lossRate: undefined },
      { peerId: 30, pathPeerIds: [], source: 'unreachable', cost: undefined, lossRate: undefined },
    ]);
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
