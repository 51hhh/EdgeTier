import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Empty, LayerCard, Table, Text } from '@cloudflare/kumo';
import type { ConnectionMatrixSnapshot, RoutePathSnapshot, RoutePeerSnapshot, TopologyEdge, TopologySnapshot } from '../../observer/types';
import { EDGE_PEER_ID } from '../../easytier/constants';
import { formatPercent } from '../format';
import type { Translator } from '../i18n';
import { nodeColorForPeerId, natStyleFor } from '../nat-styles';
import { compactPeerDisplayName, peerDisplayName, peerFullLabel, shortPeerId } from '../peer-display';
import { buildTopologyGraphLinks, computeEdgeLabelPositions, computeTopologyGraphLayout, detectEdgeCrossings, topologyGraphPeerIds, type TopologyGraphLink, type TopologyGraphPosition } from '../topology-display';

interface TopologyProps {
  topology?: TopologySnapshot | null;
  t: Translator;
}

const GRAPH_WIDTH = 920;
const GRAPH_HEIGHT = 460;

export function Topology({ topology, t }: TopologyProps) {
  const nodes = topology?.nodes ?? [];
  const edges = topology?.edges ?? [];
  const routes = topology?.routes ?? [];
  const matrix = topology?.connectionMatrix ?? { peerIds: [], rows: [] };
  const nodeByPeerId = nodeMap(nodes);
  const summary = topology?.summary ?? {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    connBitmapEdgeCount: edges.filter((edge) => edge.source === 'conn_bitmap').length,
    peerCenterEdgeCount: edges.filter((edge) => edge.source === 'peer_center').length,
    latencyEdgeCount: edges.filter((edge) => edge.latencyMs !== undefined).length,
    routeCount: routes.length,
    reachableRouteCount: routes.filter((route) => route.hopCount !== undefined).length,
    connectionMatrixNodeCount: matrix.peerIds.length,
    relayDropRate: 0,
  };
  const p2pRatio = summary.peerCenterRatio === undefined ? t('common.notDecoded') : formatPercent(summary.peerCenterRatio);

  return <div className="stack">
    <section className="grid cards" aria-label="topology metrics">
      <Metric label={t('topology.nodes')} value={summary.nodeCount} />
      <Metric label={t('topology.edges')} value={summary.edgeCount} />
      <Metric label={t('topology.latencyEdges')} value={summary.latencyEdgeCount} />
      <Metric label={t('topology.peerCenterRatio')} value={p2pRatio} />
      <Metric label={t('topology.routes')} value={summary.routeCount} />
      <Metric label={t('topology.reachableRoutes')} value={`${summary.reachableRouteCount}/${summary.routeCount}`} />
      <Metric label={t('topology.connectionMatrixNodes')} value={summary.connectionMatrixNodeCount} />
      <Metric label={t('common.relayDropRate')} value={formatPercent(summary.relayDropRate)} />
    </section>

    <section className="grid">
      <LayerCard>
        <LayerCard.Secondary>{t('topology.connBitmap')}</LayerCard.Secondary>
        <LayerCard.Primary><Text as="p" variant="secondary">{t('topology.connBitmapSummary', { count: summary.connBitmapEdgeCount })}</Text></LayerCard.Primary>
      </LayerCard>
      <LayerCard>
        <LayerCard.Secondary>{t('topology.peerCenter')}</LayerCard.Secondary>
        <LayerCard.Primary><Text as="p" variant="secondary">{t('topology.peerCenterSummary', { count: summary.peerCenterEdgeCount, average: summary.averageLatencyMs === undefined ? '' : t('topology.averageLatency', { latency: summary.averageLatencyMs }) })}</Text></LayerCard.Primary>
      </LayerCard>
    </section>

    <ConnectionGraph topology={topology} nodeByPeerId={nodeByPeerId} t={t} />
    <RouteTable routes={routes} nodeByPeerId={nodeByPeerId} t={t} />
    <ConnectionMatrix matrix={matrix} nodeByPeerId={nodeByPeerId} t={t} />

    <LayerCard>
      <LayerCard.Secondary>{t('topology.nodesTitle')} {topology ? <Badge variant="outline">{topology.roomId}</Badge> : null}</LayerCard.Secondary>
      <LayerCard.Primary>
        {nodes.length === 0
          ? <Empty title={t('topology.noNodesTitle')} description={t('topology.noNodesDescription')} />
          : <Table>
            <Table.Header><Table.Row>
              <Table.Head>{t('common.peer')}</Table.Head>
              <Table.Head>{t('common.hostname')}</Table.Head>
              <Table.Head>{t('common.virtualIp')}</Table.Head>
              <Table.Head>{t('common.nat')}</Table.Head>
              <Table.Head>{t('common.version')}</Table.Head>
              <Table.Head>{t('common.latency')}</Table.Head>
              <Table.Head>{t('common.lastSeen')}</Table.Head>
            </Table.Row></Table.Header>
            <Table.Body>
              {nodes.map((node) => (
                <Table.Row key={node.peerId}>
                  <Table.Cell><PeerIdentity peer={node} t={t} variant={node.peerId === EDGE_PEER_ID ? 'primary' : 'outline'} /></Table.Cell>
                  <Table.Cell>{node.hostname ?? t('common.routeDataPending')}</Table.Cell>
                  <Table.Cell>{node.virtualIpv4 ?? node.virtualIpv6 ?? t('common.routeDataPending')}</Table.Cell>
                  <Table.Cell>{node.udpNatType ?? node.tcpNatType ?? t('common.notDecoded')}</Table.Cell>
                  <Table.Cell>{node.easytierVersion ?? t('common.routeDataPending')}</Table.Cell>
                  <Table.Cell>{node.latencyMs === undefined ? t('common.notObserved') : `${node.latencyMs} ms`}</Table.Cell>
                  <Table.Cell>{node.lastSeen}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>}
      </LayerCard.Primary>
    </LayerCard>

    <LayerCard>
      <LayerCard.Secondary>{t('topology.edgesTitle')} {topology?.updatedAt ? <Badge variant="outline">{topology.updatedAt}</Badge> : null}</LayerCard.Secondary>
      <LayerCard.Primary>
        {edges.length === 0
          ? <Empty title={t('topology.noEdgesTitle')} description={t('topology.noEdgesDescription')} />
          : <Table>
            <Table.Header><Table.Row>
              <Table.Head>{t('common.from')}</Table.Head>
              <Table.Head>{t('common.to')}</Table.Head>
              <Table.Head>{t('common.source')}</Table.Head>
              <Table.Head>{t('common.latency')}</Table.Head>
            </Table.Row></Table.Header>
            <Table.Body>
              {edges.map((edge) => (
                <Table.Row key={`${edge.source}-${edge.fromPeerId}-${edge.toPeerId}`}>
                  <Table.Cell><PeerIdentity peer={peerFor(edge.fromPeerId, nodeByPeerId)} t={t} /></Table.Cell>
                  <Table.Cell><PeerIdentity peer={peerFor(edge.toPeerId, nodeByPeerId)} t={t} /></Table.Cell>
                  <Table.Cell><Badge variant={edge.source === 'peer_center' ? 'primary' : 'outline'}>{sourceLabel(edge.source, t)}</Badge></Table.Cell>
                  <Table.Cell>{edge.latencyMs === undefined ? t('common.notDecoded') : `${edge.latencyMs} ms`}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>}
      </LayerCard.Primary>
    </LayerCard>
  </div>;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return <LayerCard>
    <LayerCard.Secondary>{label}</LayerCard.Secondary>
    <LayerCard.Primary><Text as="strong" variant="heading2">{value}</Text></LayerCard.Primary>
  </LayerCard>;
}

function ConnectionGraph({ topology, nodeByPeerId, t }: { topology?: TopologySnapshot | null; nodeByPeerId: Map<number, RoutePeerSnapshot>; t: Translator }) {
  const nodes = topology?.nodes ?? [];
  const edges = topology?.edges ?? [];
  const graphLinks = useMemo(() => buildTopologyGraphLinks(edges), [edges]);
  const graphPeerIds = useMemo(() => topologyGraphPeerIds(nodes.map((node) => node.peerId), graphLinks), [nodes, graphLinks]);
  const layoutSignature = useMemo(() => graphLayoutSignature(graphPeerIds, graphLinks), [graphPeerIds, graphLinks]);
  const targetLayout = useMemo(() => computeTopologyGraphLayout(graphPeerIds, graphLinks, GRAPH_WIDTH, GRAPH_HEIGHT), [layoutSignature]);
  const animatedLayout = useAnimatedGraphLayout(targetLayout, graphLinks);
  const positions = useMemo(() => new Map(animatedLayout.map((position) => [position.peerId, position])), [animatedLayout]);
  const labelPositions = useMemo(() => {
    const edgeLabels = computeEdgeLabelPositions(graphLinks, positions);
    return new Map(edgeLabels.map((label) => [label.linkKey, label]));
  }, [graphLinks, positions]);
  const crossingCount = useMemo(() => detectEdgeCrossings(graphLinks, positions), [graphLinks, positions]);

  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.5, Math.min(3, transform.scale * delta));
    setTransform(prev => ({ ...prev, scale: newScale }));
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 0) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isPanning) {
      setTransform(prev => ({
        ...prev,
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      }));
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleDoubleClick = () => {
    setTransform({ x: 0, y: 0, scale: 1 });
  };
  if (graphPeerIds.length === 0) {
    return <LayerCard>
      <LayerCard.Secondary>{t('topology.connectionGraph')}</LayerCard.Secondary>
      <LayerCard.Primary><Empty title={t('topology.noGraphTitle')} description={t('topology.noGraphDescription')} /></LayerCard.Primary>
    </LayerCard>;
  }
  return <LayerCard>
    <LayerCard.Secondary>{t('topology.connectionGraph')} {topology?.updatedAt ? <Badge variant="outline">{topology.updatedAt}</Badge> : null}</LayerCard.Secondary>
    <LayerCard.Primary>
      <div className="stack compact">
        <div className="graph-toolbar">
          <Text as="p" variant="secondary" size="sm">{t('topology.connectionGraphHelp')}</Text>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Badge variant="outline">{t('topology.graphStats', { nodes: graphPeerIds.length, edges: graphLinks.length })}</Badge>
            {crossingCount > 0 && <Badge variant="beta">{crossingCount} crossings</Badge>}
          </div>
        </div>
        <div className="topology-graph" role="img" aria-label={t('topology.connectionGraph')}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
            style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDoubleClick={handleDoubleClick}
          >
            <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`} className="topology-content">
              {graphLinks.map((link) => {
                const from = positions.get(link.fromPeerId);
                const to = positions.get(link.toPeerId);
                if (!from || !to) return null;
                const label = graphLinkLabel(link, graphLinks.length);
                const linkKey = `${link.fromPeerId}-${link.toPeerId}`;
                const labelPos = labelPositions.get(linkKey);
                const labelX = labelPos ? Math.round(labelPos.x + labelPos.offsetX) : Math.round((from.x + to.x) / 2);
                const labelY = labelPos ? Math.round(labelPos.y + labelPos.offsetY) : Math.round((from.y + to.y) / 2);
                return <g key={linkKey}>
                  <title>{graphLinkTitle(link, nodeByPeerId, t)}</title>
                  <line className="graph-edge" x1={from.x} y1={from.y} x2={to.x} y2={to.y} strokeWidth={2} />
                  {label && <g className="graph-edge-label-group" transform={`translate(${labelX} ${labelY})`}>
                    <rect className="graph-edge-label-bg" x={edgeLabelBgX(label)} y={-9} width={edgeLabelBgWidth(label)} height={16} rx={4} />
                    <text className="graph-edge-label" x={0} y={3}>{label}</text>
                  </g>}
                </g>;
              })}
              {graphPeerIds.map((peerId) => {
                const pos = positions.get(peerId);
                if (!pos) return null;
                const node = peerFor(peerId, nodeByPeerId);
                const nodeColor = nodeColorForPeerId(node.peerId);
                const natStyle = natStyleFor(node.udpNatType, node.tcpNatType);
                const r = nodeRadius(pos);
                return <g key={node.peerId} className="graph-node-group" transform={`translate(${pos.x} ${pos.y})`}>
                  <title>{peerFullLabel(node, t('common.unknownPeer')) + (node.udpNatType ? ` | NAT: ${node.udpNatType}` : '')}</title>
                  {renderNodeShape(natStyle.shape, r, nodeColor)}
                  <text className="graph-node-label" x={0} y={4}>{shortPeerId(node.peerId)}</text>
                  <text className="graph-node-host-label" x={0} y={r + 16}>{compactPeerDisplayName(node, t('common.routeDataPending'))}</text>
                  <text className="graph-node-nat-icon" x={r - 6} y={-r + 8}>{natStyle.icon}</text>
                </g>;
              })}
            </g>
          </svg>
          <div className="graph-controls">
            <button type="button" onClick={() => setTransform(prev => ({ ...prev, scale: Math.min(3, prev.scale * 1.2) }))} title="Zoom In">+</button>
            <button type="button" onClick={() => setTransform(prev => ({ ...prev, scale: Math.max(0.5, prev.scale / 1.2) }))} title="Zoom Out">−</button>
            <button type="button" onClick={handleDoubleClick} title="Reset View">⟲</button>
          </div>
        </div>
        <div className="chart-legend">
          <span><i className="legend-swatch bitmap" />{t('topology.source.conn_bitmap')}</span>
          <span><i className="legend-swatch peer-center" />{t('topology.source.peer_center')}</span>
          <span><i className="legend-swatch hybrid" />{`${t('topology.source.conn_bitmap')} + ${t('topology.source.peer_center')}`}</span>
        </div>
      </div>
    </LayerCard.Primary>
  </LayerCard>;
}

function useAnimatedGraphLayout(targetLayout: TopologyGraphPosition[], links: TopologyGraphLink[]): TopologyGraphPosition[] {
  const [layout, setLayout] = useState<TopologyGraphPosition[]>(targetLayout);
  const layoutRef = useRef<Map<number, TopologyGraphPosition>>(new Map(targetLayout.map((position) => [position.peerId, position])));
  const animationSignature = useMemo(() => {
    const nodeKey = targetLayout.map((position) => `${position.peerId}:${position.x}:${position.y}:${position.degree}`).join('|');
    const linkKey = links.map((link) => `${link.fromPeerId}:${link.toPeerId}:${link.directedCount}`).join('|');
    return `${nodeKey}#${linkKey}`;
  }, [targetLayout, links]);

  useEffect(() => {
    const current = layoutRef.current;
    if (targetLayout.length === 0 || current.size === 0 || typeof requestAnimationFrame === 'undefined') {
      layoutRef.current = new Map(targetLayout.map((position) => [position.peerId, position]));
      setLayout(targetLayout);
      return;
    }

    const starts = new Map(targetLayout.map((target) => [target.peerId, current.get(target.peerId) ?? newNodeStartPosition(target, current, links)]));
    const durationMs = 720;
    let startTime = 0;
    let frame = 0;

    const step = (now: number) => {
      if (!startTime) startTime = now;
      const progress = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = targetLayout.map((target) => {
        const start = starts.get(target.peerId) ?? target;
        return {
          ...target,
          x: Math.round(start.x + (target.x - start.x) * eased),
          y: Math.round(start.y + (target.y - start.y) * eased),
        };
      });
      layoutRef.current = new Map(next.map((position) => [position.peerId, position]));
      setLayout(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [animationSignature]);

  return layout.length ? layout : targetLayout;
}

function newNodeStartPosition(target: TopologyGraphPosition, current: Map<number, TopologyGraphPosition>, links: TopologyGraphLink[]): TopologyGraphPosition {
  const neighbors = links
    .map((link) => {
      if (link.fromPeerId === target.peerId) return current.get(link.toPeerId);
      if (link.toPeerId === target.peerId) return current.get(link.fromPeerId);
      return undefined;
    })
    .filter((position): position is TopologyGraphPosition => !!position);
  if (neighbors.length === 0) return { ...target, x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 };
  const x = neighbors.reduce((sum, position) => sum + position.x, 0) / neighbors.length;
  const y = neighbors.reduce((sum, position) => sum + position.y, 0) / neighbors.length;
  return { ...target, x: Math.round(x), y: Math.round(y) };
}

function RouteTable({ routes, nodeByPeerId, t }: { routes: RoutePathSnapshot[]; nodeByPeerId: Map<number, RoutePeerSnapshot>; t: Translator }) {
  return <LayerCard>
    <LayerCard.Secondary>{t('topology.routeTable')} <Badge variant="outline">{routes.length}</Badge></LayerCard.Secondary>
    <LayerCard.Primary>
      {routes.length === 0
        ? <Empty title={t('topology.noRoutesTitle')} description={t('topology.noRoutesDescription')} />
        : <Table>
          <Table.Header><Table.Row>
            <Table.Head>{t('common.peer')}</Table.Head>
            <Table.Head>{t('common.status')}</Table.Head>
            <Table.Head>{t('common.nextHop')}</Table.Head>
            <Table.Head>{t('common.path')}</Table.Head>
            <Table.Head>{t('common.hops')}</Table.Head>
            <Table.Head>{t('common.latency')}</Table.Head>
            <Table.Head>{t('common.lossRate')}</Table.Head>
            <Table.Head>{t('common.source')}</Table.Head>
          </Table.Row></Table.Header>
          <Table.Body>
            {routes.map((route) => (
              <Table.Row key={route.peerId}>
                <Table.Cell><PeerIdentity peer={peerFor(route.peerId, nodeByPeerId)} t={t} /></Table.Cell>
                <Table.Cell><Badge variant={route.hopCount === undefined ? 'secondary' : 'primary'}>{route.hopCount === undefined ? t('common.unreachable') : t('common.reachable')}</Badge></Table.Cell>
                <Table.Cell>{route.nextHopPeerId === undefined ? t('common.notObserved') : <PeerIdentity peer={peerFor(route.nextHopPeerId, nodeByPeerId)} t={t} />}</Table.Cell>
                <Table.Cell>{route.pathPeerIds.length ? <PathLabel peerIds={route.pathPeerIds} nodeByPeerId={nodeByPeerId} t={t} /> : t('common.notObserved')}</Table.Cell>
                <Table.Cell>{route.hopCount ?? t('common.notObserved')}</Table.Cell>
                <Table.Cell>{route.latencyMs === undefined ? t('common.notObserved') : `${route.latencyMs} ms`}</Table.Cell>
                <Table.Cell>{route.lossRate === undefined ? t('common.notObserved') : formatPercent(route.lossRate)}</Table.Cell>
                <Table.Cell><Badge variant={route.source === 'unreachable' ? 'secondary' : 'outline'}>{routeSourceLabel(route.source, t)}</Badge></Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>}
    </LayerCard.Primary>
  </LayerCard>;
}

function ConnectionMatrix({ matrix, nodeByPeerId, t }: { matrix: ConnectionMatrixSnapshot; nodeByPeerId: Map<number, RoutePeerSnapshot>; t: Translator }) {
  return <LayerCard>
    <LayerCard.Secondary>{t('topology.connectionMatrix')} <Badge variant="outline">{matrix.peerIds.length}</Badge></LayerCard.Secondary>
    <LayerCard.Primary>
      {matrix.peerIds.length === 0
        ? <Empty title={t('topology.noMatrixTitle')} description={t('topology.noMatrixDescription')} />
        : <div className="matrix-scroll">
          <Table>
            <Table.Header><Table.Row>
              <Table.Head>{t('common.from')}</Table.Head>
              {matrix.peerIds.map((peerId) => (
                <Table.Head key={peerId}>
                  <span className="matrix-peer-head" title={peerFullLabel(peerFor(peerId, nodeByPeerId), t('common.unknownPeer'))}>
                    <span>{shortPeerId(peerId)}</span>
                    <span>{peerDisplayName(peerFor(peerId, nodeByPeerId), t('common.routeDataPending'))}</span>
                  </span>
                </Table.Head>
              ))}
            </Table.Row></Table.Header>
            <Table.Body>
              {matrix.rows.map((row) => (
                <Table.Row key={row.peerId}>
                  <Table.Cell><PeerIdentity peer={peerFor(row.peerId, nodeByPeerId)} t={t} /></Table.Cell>
                  {matrix.peerIds.map((peerId) => {
                    const connected = row.connectedPeerIds.includes(peerId);
                    return <Table.Cell
                      key={peerId}
                      className={connected ? 'matrix-on' : 'matrix-off'}
                      title={`${peerFullLabel(peerFor(row.peerId, nodeByPeerId), t('common.unknownPeer'))} -> ${peerFullLabel(peerFor(peerId, nodeByPeerId), t('common.unknownPeer'))}: ${connected ? t('topology.connected') : t('topology.notConnected')}`}
                    >
                      {row.peerId === peerId ? '-' : connected ? '1' : '0'}
                    </Table.Cell>;
                  })}
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>}
    </LayerCard.Primary>
  </LayerCard>;
}

function PeerIdentity({ peer, t, variant = 'outline' }: { peer: { peerId?: number; hostname?: string }; t: Translator; variant?: 'primary' | 'outline' | 'secondary' }) {
  return <span className="peer-identity" title={peerFullLabel(peer, t('common.unknownPeer'))}>
    <Badge variant={variant}>{shortPeerId(peer.peerId, t('common.unknownPeer'))}</Badge>
    <span className="peer-hostname">{peerDisplayName(peer, t('common.routeDataPending'))}</span>
  </span>;
}

function PathLabel({ peerIds, nodeByPeerId, t }: { peerIds: number[]; nodeByPeerId: Map<number, RoutePeerSnapshot>; t: Translator }) {
  return <span className="route-path-label">
    {peerIds.map((peerId, index) => (
      <React.Fragment key={`${peerId}-${index}`}>
        {index > 0 ? <span className="route-path-arrow">-&gt;</span> : null}
        <span title={peerFullLabel(peerFor(peerId, nodeByPeerId), t('common.unknownPeer'))}>
          {peerDisplayName(peerFor(peerId, nodeByPeerId), shortPeerId(peerId))}
        </span>
      </React.Fragment>
    ))}
  </span>;
}

function nodeMap(nodes: RoutePeerSnapshot[]): Map<number, RoutePeerSnapshot> {
  return new Map(nodes.map((node) => [node.peerId, node]));
}

function peerFor(peerId: number, nodeByPeerId: Map<number, RoutePeerSnapshot>): RoutePeerSnapshot {
  return nodeByPeerId.get(peerId) ?? {
    peerId,
    proxyCidrs: [],
    hostname: peerId === EDGE_PEER_ID ? 'edgetier-worker' : undefined,
    lastSeen: '',
  };
}

function sourceLabel(source: TopologyEdge['source'], t: Translator): string {
  return source === 'peer_center' ? t('topology.source.peer_center') : t('topology.source.conn_bitmap');
}

function sourceListLabel(sources: Array<TopologyEdge['source']>, t: Translator): string {
  return sources.map((source) => sourceLabel(source, t)).join(' + ');
}

function graphLayoutSignature(peerIds: number[], links: TopologyGraphLink[]): string {
  const peerKey = [...peerIds].sort((a, b) => a - b).join(',');
  const linkKey = links
    .map((link) => `${link.fromPeerId}:${link.toPeerId}:${link.sources.join('+')}:${link.directedCount}:${link.latencyMs ?? ''}`)
    .join('|');
  return `${peerKey}#${linkKey}`;
}

function nodeRadius(node: TopologyGraphPosition): number {
  return node.radius;
}

function graphLinkLabel(link: TopologyGraphLink, linkCount: number): string {
  if (link.latencyMs !== undefined) return `${link.latencyMs} ms`;
  if (link.sources.length > 1) return link.directedCount > 1 ? `x${link.directedCount}` : '';
  if (linkCount <= 8 && link.directedCount > 1) return `x${link.directedCount}`;
  return '';
}

function edgeLabelBgWidth(label: string): number {
  return Math.max(28, label.length * 7 + 12);
}

function edgeLabelBgX(label: string): number {
  return -edgeLabelBgWidth(label) / 2;
}

function graphLinkTitle(link: TopologyGraphLink, nodeByPeerId: Map<number, RoutePeerSnapshot>, t: Translator): string {
  const from = peerFullLabel(peerFor(link.fromPeerId, nodeByPeerId), t('common.unknownPeer'));
  const to = peerFullLabel(peerFor(link.toPeerId, nodeByPeerId), t('common.unknownPeer'));
  const latency = link.latencyMs === undefined ? t('common.notObserved') : `${link.latencyMs} ms`;
  return `${from} <-> ${to}; ${sourceListLabel(link.sources, t)}; ${t('topology.directedEdges', { count: link.directedCount })}; ${latency}`;
}

function routeSourceLabel(source: RoutePathSnapshot['source'], t: Translator): string {
  if (source === 'live_peer') return t('topology.source.live_peer');
  if (source === 'unreachable') return t('topology.source.unreachable');
  return t('topology.source.conn_bitmap');
}

function renderNodeShape(shape: 'circle' | 'square' | 'diamond' | 'hexagon', radius: number, fillColor: string): React.ReactNode {
  const strokeColor = 'var(--color-kumo-base)';
  const strokeWidth = 2.5;

  switch (shape) {
    case 'circle':
      return <circle className="graph-node" cx={0} cy={0} r={radius} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />;

    case 'square': {
      const size = radius * 1.6;
      const offset = size / 2;
      return <rect className="graph-node" x={-offset} y={-offset} width={size} height={size} rx={3} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />;
    }

    case 'diamond': {
      const size = radius * 1.8;
      const points = `0,${-size} ${size},0 0,${size} ${-size},0`;
      return <polygon className="graph-node" points={points} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />;
    }

    case 'hexagon': {
      const size = radius;
      const h = size * Math.sqrt(3) / 2;
      const points = `${size},0 ${size/2},${h} ${-size/2},${h} ${-size},0 ${-size/2},${-h} ${size/2},${-h}`;
      return <polygon className="graph-node" points={points} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />;
    }
  }
}
