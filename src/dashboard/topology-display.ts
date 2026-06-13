import type { TopologyEdge } from '../observer/types';

export interface TopologyGraphLink {
  fromPeerId: number;
  toPeerId: number;
  sources: Array<TopologyEdge['source']>;
  directedCount: number;
  latencyMs?: number;
}

export function buildTopologyGraphLinks(edges: TopologyEdge[]): TopologyGraphLink[] {
  const links = new Map<string, {
    fromPeerId: number;
    toPeerId: number;
    sources: Set<TopologyEdge['source']>;
    directedCount: number;
    latencies: number[];
  }>();

  for (const edge of edges) {
    if (!Number.isInteger(edge.fromPeerId) || !Number.isInteger(edge.toPeerId) || edge.fromPeerId <= 0 || edge.toPeerId <= 0 || edge.fromPeerId === edge.toPeerId) continue;
    const fromPeerId = Math.min(edge.fromPeerId, edge.toPeerId);
    const toPeerId = Math.max(edge.fromPeerId, edge.toPeerId);
    const key = `${fromPeerId}:${toPeerId}`;
    let link = links.get(key);
    if (!link) {
      link = { fromPeerId, toPeerId, sources: new Set(), directedCount: 0, latencies: [] };
      links.set(key, link);
    }
    link.sources.add(edge.source);
    link.directedCount += 1;
    if (edge.latencyMs !== undefined && Number.isFinite(edge.latencyMs)) link.latencies.push(edge.latencyMs);
  }

  return [...links.values()]
    .map((link) => ({
      fromPeerId: link.fromPeerId,
      toPeerId: link.toPeerId,
      sources: [...link.sources].sort(),
      directedCount: link.directedCount,
      latencyMs: link.latencies.length ? Math.round(link.latencies.reduce((sum, latency) => sum + latency, 0) / link.latencies.length) : undefined,
    }))
    .sort((a, b) => a.fromPeerId - b.fromPeerId || a.toPeerId - b.toPeerId);
}
