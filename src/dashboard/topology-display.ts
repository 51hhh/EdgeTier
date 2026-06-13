import type { TopologyEdge } from '../observer/types';

export interface TopologyGraphNode {
  peerId: number;
  degree: number;
  radius: number;
  collisionRadius: number;
}

export interface TopologyGraphLink {
  fromPeerId: number;
  toPeerId: number;
  sources: Array<TopologyEdge['source']>;
  directedCount: number;
  latencyMs?: number;
}

export interface TopologyGraphPosition extends TopologyGraphNode {
  x: number;
  y: number;
}

type SimulationNode = TopologyGraphPosition & {
  vx: number;
  vy: number;
};

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

export function buildTopologyGraphNodes(peerIds: number[], links: TopologyGraphLink[]): TopologyGraphNode[] {
  const degrees = new Map<number, number>();
  for (const peerId of peerIds) {
    if (Number.isInteger(peerId) && peerId > 0) degrees.set(peerId, 0);
  }

  for (const link of links) {
    if (!degrees.has(link.fromPeerId) || !degrees.has(link.toPeerId)) continue;
    const weight = Math.max(1, link.sources.length);
    degrees.set(link.fromPeerId, (degrees.get(link.fromPeerId) ?? 0) + weight);
    degrees.set(link.toPeerId, (degrees.get(link.toPeerId) ?? 0) + weight);
  }

  return [...degrees.entries()]
    .map(([peerId, degree]) => ({
      peerId,
      degree,
      radius: nodeRadiusForDegree(degree),
      collisionRadius: nodeCollisionRadius(peerId, degree),
    }))
    .sort((a, b) => b.degree - a.degree || a.peerId - b.peerId);
}

export function topologyGraphPeerIds(peerIds: number[], links: TopologyGraphLink[]): number[] {
  const graphPeerIds = new Set<number>();
  for (const peerId of peerIds) {
    if (Number.isInteger(peerId) && peerId > 0) graphPeerIds.add(peerId);
  }
  for (const link of links) {
    if (Number.isInteger(link.fromPeerId) && link.fromPeerId > 0) graphPeerIds.add(link.fromPeerId);
    if (Number.isInteger(link.toPeerId) && link.toPeerId > 0) graphPeerIds.add(link.toPeerId);
  }
  return [...graphPeerIds].sort((a, b) => a - b);
}

export function computeTopologyGraphLayout(
  peerIds: number[],
  links: TopologyGraphLink[],
  width: number,
  height: number,
  iterations = 180,
): TopologyGraphPosition[] {
  const nodes = buildTopologyGraphNodes(peerIds, links);
  if (nodes.length === 0) return [];

  const maxCollisionRadius = Math.max(...nodes.map((node) => node.collisionRadius));
  const margin = Math.max(58, maxCollisionRadius + 16);
  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = Math.max(1, (width - margin * 2) / 2);
  const radiusY = Math.max(1, (height - margin * 2) / 2);
  const maxDegree = Math.max(1, ...nodes.map((node) => node.degree));
  const state = nodes.map((node, index) => {
    if (nodes.length === 1) return { ...node, x: centerX, y: centerY, vx: 0, vy: 0 };
    const rank = index / Math.max(1, nodes.length - 1);
    const centrality = node.degree / maxDegree;
    const orbit = 0.18 + rank * 0.62 - centrality * 0.12;
    const angle = goldenAngle(index) + stablePeerAngle(node.peerId);
    return {
      ...node,
      x: centerX + Math.cos(angle) * radiusX * orbit,
      y: centerY + Math.sin(angle) * radiusY * orbit,
      vx: 0,
      vy: 0,
    };
  });

  const byPeerId = new Map(state.map((node) => [node.peerId, node]));
  const validLinks = links
    .map((link) => ({ ...link, from: byPeerId.get(link.fromPeerId), to: byPeerId.get(link.toPeerId) }))
    .filter((link): link is TopologyGraphLink & { from: SimulationNode; to: SimulationNode } => !!link.from && !!link.to);

  for (let tick = 0; tick < iterations; tick += 1) {
    const alpha = 1 - tick / Math.max(1, iterations);
    applyCenterForce(state, centerX, centerY, alpha);
    applyChargeForce(state, alpha);
    applyLinkForce(validLinks, alpha);
    applyCollisionForce(state, alpha);

    for (const node of state) {
      node.vx *= 0.72;
      node.vy *= 0.72;
      node.x = clamp(node.x + node.vx, margin, width - margin);
      node.y = clamp(node.y + node.vy, margin, height - margin);
    }
  }

  return state
    .map(({ peerId, degree, radius, collisionRadius, x, y }) => ({
      peerId,
      degree,
      radius,
      collisionRadius,
      x: Math.round(x),
      y: Math.round(y),
    }))
    .sort((a, b) => a.peerId - b.peerId);
}

function applyCenterForce(nodes: SimulationNode[], centerX: number, centerY: number, alpha: number): void {
  for (const node of nodes) {
    const strength = (0.008 + Math.min(6, node.degree) * 0.003) * alpha;
    node.vx += (centerX - node.x) * strength;
    node.vy += (centerY - node.y) * strength;
  }
}

function applyChargeForce(nodes: SimulationNode[], alpha: number): void {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distanceSq = dx * dx + dy * dy;
      if (distanceSq < 0.01) {
        dx = stableOffset(a.peerId, b.peerId);
        dy = stableOffset(b.peerId, a.peerId);
        distanceSq = dx * dx + dy * dy;
      }
      const distance = Math.sqrt(distanceSq);
      const charge = 3200 + (a.collisionRadius + b.collisionRadius) * 20;
      const force = (charge * alpha) / Math.max(900, distanceSq);
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }
}

function applyLinkForce(links: Array<TopologyGraphLink & { from: SimulationNode; to: SimulationNode }>, alpha: number): void {
  for (const link of links) {
    const dx = link.to.x - link.from.x;
    const dy = link.to.y - link.from.y;
    const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const strongerPeer = Math.max(link.from.degree, link.to.degree);
    const sourceBonus = link.sources.length > 1 ? 18 : 0;
    const labelAllowance = link.latencyMs !== undefined || link.directedCount > 1 ? 14 : 0;
    const desired = Math.max(118, 178 - Math.min(42, strongerPeer * 8) + sourceBonus + labelAllowance);
    const strength = (0.022 + Math.min(0.034, link.directedCount * 0.003)) * alpha;
    const force = (distance - desired) * strength;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    link.from.vx += fx;
    link.from.vy += fy;
    link.to.vx -= fx;
    link.to.vy -= fy;
  }
}

function applyCollisionForce(nodes: SimulationNode[], alpha: number): void {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const minDistance = a.collisionRadius + b.collisionRadius;
      if (distance >= minDistance) continue;
      const push = (minDistance - distance) * (0.03 + alpha * 0.012);
      const fx = (dx / distance) * push;
      const fy = (dy / distance) * push;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }
}

function nodeRadiusForDegree(degree: number): number {
  return 17 + Math.min(7, Math.max(0, degree));
}

function nodeCollisionRadius(peerId: number, degree: number): number {
  const radius = nodeRadiusForDegree(degree);
  const labelWidth = Math.min(96, Math.max(48, String(peerId).length * 7));
  const degreeAllowance = Math.min(14, Math.max(0, degree) * 2);
  return Math.ceil(Math.max(radius + 34 + degreeAllowance, labelWidth / 2 + radius * 0.8));
}

function goldenAngle(index: number): number {
  return index * Math.PI * (3 - Math.sqrt(5));
}

function stablePeerAngle(peerId: number): number {
  return ((peerIdHash(peerId) % 360) / 360) * Math.PI * 2;
}

function stableOffset(a: number, b: number): number {
  return ((peerIdHash(a ^ b) % 200) - 100) / 100;
}

function peerIdHash(peerId: number): number {
  let value = peerId >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
