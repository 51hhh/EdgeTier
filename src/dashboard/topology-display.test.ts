import { describe, expect, it } from 'vitest';
import { buildTopologyGraphLinks, buildTopologyGraphNodes, computeTopologyGraphLayout } from './topology-display';

describe('dashboard topology display helpers', () => {
  it('aggregates directed topology edges into readable graph links', () => {
    expect(buildTopologyGraphLinks([
      { fromPeerId: 3, toPeerId: 1, source: 'conn_bitmap' },
      { fromPeerId: 1, toPeerId: 3, source: 'conn_bitmap' },
      { fromPeerId: 3, toPeerId: 1, source: 'peer_center', latencyMs: 20 },
      { fromPeerId: 1, toPeerId: 3, source: 'peer_center', latencyMs: 30 },
      { fromPeerId: 2, toPeerId: 3, source: 'conn_bitmap' },
    ])).toEqual([
      { fromPeerId: 1, toPeerId: 3, sources: ['conn_bitmap', 'peer_center'], directedCount: 4, latencyMs: 25 },
      { fromPeerId: 2, toPeerId: 3, sources: ['conn_bitmap'], directedCount: 1, latencyMs: undefined },
    ]);
  });

  it('computes node degree from graph links without privileging a fixed peer', () => {
    const links = buildTopologyGraphLinks([
      { fromPeerId: 10000001, toPeerId: 1, source: 'conn_bitmap' },
      { fromPeerId: 2, toPeerId: 1, source: 'conn_bitmap' },
      { fromPeerId: 3, toPeerId: 1, source: 'peer_center', latencyMs: 12 },
      { fromPeerId: 3, toPeerId: 1, source: 'conn_bitmap' },
    ]);

    expect(buildTopologyGraphNodes([10000001, 1, 2, 3, 4], links)).toEqual([
      { peerId: 1, degree: 4 },
      { peerId: 3, degree: 2 },
      { peerId: 2, degree: 1 },
      { peerId: 10000001, degree: 1 },
      { peerId: 4, degree: 0 },
    ]);
  });

  it('produces deterministic force-directed positions inside the graph bounds', () => {
    const links = buildTopologyGraphLinks([
      { fromPeerId: 1, toPeerId: 2, source: 'conn_bitmap' },
      { fromPeerId: 1, toPeerId: 3, source: 'conn_bitmap' },
      { fromPeerId: 1, toPeerId: 4, source: 'peer_center', latencyMs: 18 },
      { fromPeerId: 4, toPeerId: 5, source: 'conn_bitmap' },
    ]);
    const first = computeTopologyGraphLayout([1, 2, 3, 4, 5], links, 760, 360, 80);
    const second = computeTopologyGraphLayout([1, 2, 3, 4, 5], links, 760, 360, 80);

    expect(second).toEqual(first);
    expect(first.map((node) => node.peerId).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    for (const node of first) {
      expect(node.x).toBeGreaterThanOrEqual(54);
      expect(node.x).toBeLessThanOrEqual(706);
      expect(node.y).toBeGreaterThanOrEqual(54);
      expect(node.y).toBeLessThanOrEqual(306);
    }
  });
});
