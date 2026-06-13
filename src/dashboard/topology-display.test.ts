import { describe, expect, it } from 'vitest';
import { buildTopologyGraphLinks, buildTopologyGraphNodes, computeEdgeLabelPositions, computeTopologyGraphLayout, detectEdgeCrossings, topologyGraphPeerIds } from './topology-display';

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
      { peerId: 1, degree: 4, radius: 21, collisionRadius: 63 },
      { peerId: 3, degree: 2, radius: 19, collisionRadius: 57 },
      { peerId: 2, degree: 1, radius: 18, collisionRadius: 54 },
      { peerId: 10000001, degree: 1, radius: 18, collisionRadius: 54 },
      { peerId: 4, degree: 0, radius: 17, collisionRadius: 51 },
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
      expect(node.radius).toBeGreaterThanOrEqual(17);
      expect(node.collisionRadius).toBeGreaterThan(node.radius);
      expect(node.x).toBeGreaterThanOrEqual(node.collisionRadius + 16);
      expect(node.x).toBeLessThanOrEqual(760 - node.collisionRadius - 16);
      expect(node.y).toBeGreaterThanOrEqual(node.collisionRadius + 16);
      expect(node.y).toBeLessThanOrEqual(360 - node.collisionRadius - 16);
    }
  });

  it('uses dynamic collision radii so large labels and high degree nodes reserve more space', () => {
    const nodes = buildTopologyGraphNodes([1, 10000001, 42], buildTopologyGraphLinks([
      { fromPeerId: 1, toPeerId: 10000001, source: 'conn_bitmap' },
      { fromPeerId: 1, toPeerId: 42, source: 'conn_bitmap' },
      { fromPeerId: 42, toPeerId: 1, source: 'peer_center', latencyMs: 8 },
    ]));

    const hub = nodes.find((node) => node.peerId === 1);
    const isolatedLabel = buildTopologyGraphNodes([10000001], []);

    expect(hub?.collisionRadius).toBeGreaterThan(hub?.radius ?? 0);
    expect(isolatedLabel[0].collisionRadius).toBeGreaterThan(isolatedLabel[0].radius);
  });

  it('keeps observed edge endpoints in the graph even when route peer details are pending', () => {
    const links = buildTopologyGraphLinks([
      { fromPeerId: 1, toPeerId: 2, source: 'conn_bitmap' },
      { fromPeerId: 2, toPeerId: 3, source: 'peer_center', latencyMs: 12 },
      { fromPeerId: 0, toPeerId: 4, source: 'conn_bitmap' },
    ]);

    expect(topologyGraphPeerIds([1], links)).toEqual([1, 2, 3]);
  });

  it('computes edge label positions to avoid overlaps', () => {
    const links = buildTopologyGraphLinks([
      { fromPeerId: 1, toPeerId: 2, source: 'conn_bitmap' },
      { fromPeerId: 1, toPeerId: 3, source: 'peer_center', latencyMs: 8 },
      { fromPeerId: 2, toPeerId: 3, source: 'conn_bitmap' },
    ]);

    const layout = computeTopologyGraphLayout([1, 2, 3], links, 760, 360);
    const positions = new Map(layout.map((node) => [node.peerId, node]));
    const labelPositions = computeEdgeLabelPositions(links, positions);

    expect(labelPositions).toHaveLength(3);
    for (const label of labelPositions) {
      expect(label).toHaveProperty('x');
      expect(label).toHaveProperty('y');
      expect(label).toHaveProperty('offsetX');
      expect(label).toHaveProperty('offsetY');
    }
  });

  it('detects edge crossings in graph layout', () => {
    const links = buildTopologyGraphLinks([
      { fromPeerId: 1, toPeerId: 3, source: 'conn_bitmap' },
      { fromPeerId: 2, toPeerId: 4, source: 'conn_bitmap' },
    ]);

    const layout = [
      { peerId: 1, degree: 1, radius: 18, collisionRadius: 54, x: 100, y: 100 },
      { peerId: 2, degree: 1, radius: 18, collisionRadius: 54, x: 200, y: 100 },
      { peerId: 3, degree: 1, radius: 18, collisionRadius: 54, x: 200, y: 200 },
      { peerId: 4, degree: 1, radius: 18, collisionRadius: 54, x: 100, y: 200 },
    ];

    const positions = new Map(layout.map((node) => [node.peerId, node]));
    const crossings = detectEdgeCrossings(links, positions);

    expect(crossings).toBe(1);
  });
});
