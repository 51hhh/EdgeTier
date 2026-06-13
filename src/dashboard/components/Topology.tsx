import React from 'react';
import { Badge, Empty, LayerCard, Table, Text } from '@cloudflare/kumo';
import type { ConnectionMatrixSnapshot, RoutePathSnapshot, RoutePeerSnapshot, TopologyEdge, TopologySnapshot } from '../../observer/types';
import { EDGE_PEER_ID } from '../../easytier/constants';
import { formatPercent } from '../format';
import type { Translator } from '../i18n';
import { peerDisplayName, peerFullLabel, shortPeerId } from '../peer-display';
import { buildTopologyGraphLinks, type TopologyGraphLink } from '../topology-display';

interface TopologyProps {
  topology?: TopologySnapshot | null;
  t: Translator;
}

const GRAPH_WIDTH = 760;
const GRAPH_HEIGHT = 360;

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
  if (nodes.length === 0 || edges.length === 0) {
    return <LayerCard>
      <LayerCard.Secondary>{t('topology.connectionGraph')}</LayerCard.Secondary>
      <LayerCard.Primary><Empty title={t('topology.noGraphTitle')} description={t('topology.noGraphDescription')} /></LayerCard.Primary>
    </LayerCard>;
  }
  const positions = graphPositions(nodes.map((node) => node.peerId));
  const graphLinks = buildTopologyGraphLinks(edges);
  return <LayerCard>
    <LayerCard.Secondary>{t('topology.connectionGraph')} {topology?.updatedAt ? <Badge variant="outline">{topology.updatedAt}</Badge> : null}</LayerCard.Secondary>
    <LayerCard.Primary>
      <div className="stack compact">
        <div className="graph-toolbar">
          <Text as="p" variant="secondary" size="sm">{t('topology.connectionGraphHelp')}</Text>
          <Badge variant="outline">{t('topology.graphStats', { nodes: nodes.length, edges: graphLinks.length })}</Badge>
        </div>
        <div className="topology-graph" role="img" aria-label={t('topology.connectionGraph')}>
          <svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}>
            {graphLinks.map((link) => {
              const from = positions.get(link.fromPeerId);
              const to = positions.get(link.toPeerId);
              if (!from || !to) return null;
              const label = graphLinkLabel(link);
              return <g key={`${link.fromPeerId}-${link.toPeerId}`}>
                <title>{graphLinkTitle(link, nodeByPeerId, t)}</title>
                <line className={`graph-edge ${graphLinkClass(link)}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
                {label && <text className="graph-edge-label" x={(from.x + to.x) / 2} y={(from.y + to.y) / 2}>{label}</text>}
              </g>;
            })}
            {nodes.map((node) => {
              const pos = positions.get(node.peerId);
              if (!pos) return null;
              return <g key={node.peerId}>
                <title>{peerFullLabel(node, t('common.unknownPeer'))}</title>
                <circle className={node.peerId === EDGE_PEER_ID ? 'graph-node edge' : 'graph-node'} cx={pos.x} cy={pos.y} r={node.peerId === EDGE_PEER_ID ? 22 : 18} />
                <text className="graph-node-label" x={pos.x} y={pos.y + 4}>{shortPeerId(node.peerId)}</text>
                <text className="graph-node-host-label" x={pos.x} y={pos.y + 38}>{peerDisplayName(node, t('common.routeDataPending'))}</text>
              </g>;
            })}
          </svg>
        </div>
        <div className="chart-legend">
          <span><i className="legend-swatch bitmap" />{t('topology.source.conn_bitmap')}</span>
          <span><i className="legend-swatch peer-center" />{t('topology.source.peer_center')}</span>
          <span><i className="legend-swatch hybrid" />{`${t('topology.source.conn_bitmap')} + ${t('topology.source.peer_center')}`}</span>
          <span><Badge variant="primary">{shortPeerId(EDGE_PEER_ID)}</Badge> edgetier-worker</span>
        </div>
      </div>
    </LayerCard.Primary>
  </LayerCard>;
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

function graphPositions(peerIds: number[]): Map<number, { x: number; y: number }> {
  const ids = [...peerIds].sort((a, b) => {
    if (a === EDGE_PEER_ID) return -1;
    if (b === EDGE_PEER_ID) return 1;
    return a - b;
  });
  const positions = new Map<number, { x: number; y: number }>();
  const center = { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 };
  positions.set(ids[0], center);
  const outer = ids.slice(1);
  const radiusX = GRAPH_WIDTH * 0.36;
  const radiusY = GRAPH_HEIGHT * 0.30;
  outer.forEach((peerId, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, outer.length) - Math.PI / 2;
    positions.set(peerId, {
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
    });
  });
  return positions;
}

function sourceLabel(source: TopologyEdge['source'], t: Translator): string {
  return source === 'peer_center' ? t('topology.source.peer_center') : t('topology.source.conn_bitmap');
}

function sourceListLabel(sources: Array<TopologyEdge['source']>, t: Translator): string {
  return sources.map((source) => sourceLabel(source, t)).join(' + ');
}

function graphLinkClass(link: TopologyGraphLink): string {
  if (link.sources.includes('conn_bitmap') && link.sources.includes('peer_center')) return 'hybrid';
  return link.sources.includes('peer_center') ? 'peer-center' : 'conn-bitmap';
}

function graphLinkLabel(link: TopologyGraphLink): string {
  if (link.latencyMs !== undefined) return `${link.latencyMs} ms`;
  return link.directedCount > 1 ? `x${link.directedCount}` : '';
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
