import { describe, expect, it } from 'vitest';
import { buildTopologyGraphLinks } from './topology-display';

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
});
