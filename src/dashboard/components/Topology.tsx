import React from 'react';
import { Badge, Empty, LayerCard, Table, Text } from '@cloudflare/kumo';
import type { ConnectionMatrixSnapshot, RoutePathSnapshot, TopologyEdge, TopologySnapshot } from '../../observer/types';
import { EDGE_PEER_ID } from '../../easytier/constants';
import { formatPercent } from '../format';
import type { Translator } from '../i18n';

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

    <ConnectionGraph topology={topology} t={t} />
    <RouteTable routes={routes} t={t} />
    <ConnectionMatrix matrix={matrix} t={t} />

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
                  <Table.Cell><Badge variant={node.peerId === EDGE_PEER_ID ? 'primary' : 'outline'}>{node.peerId}</Badge></Table.Cell>
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
                  <Table.Cell>{edge.fromPeerId}</Table.Cell>
                  <Table.Cell>{edge.toPeerId}</Table.Cell>
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

function ConnectionGraph({ topology, t }: { topology?: TopologySnapshot | null; t: Translator }) {
  const nodes = topology?.nodes ?? [];
  const edges = topology?.edges ?? [];
  if (nodes.length === 0 || edges.length === 0) {
    return <LayerCard>
      <LayerCard.Secondary>{t('topology.connectionGraph')}</LayerCard.Secondary>
      <LayerCard.Primary><Empty title={t('topology.noGraphTitle')} description={t('topology.noGraphDescription')} /></LayerCard.Primary>
    </LayerCard>;
  }
  const positions = graphPositions(nodes.map((node) => node.peerId));
  return <LayerCard>
    <LayerCard.Secondary>{t('topology.connectionGraph')} {topology?.updatedAt ? <Badge variant="outline">{topology.updatedAt}</Badge> : null}</LayerCard.Secondary>
    <LayerCard.Primary>
      <div className="stack compact">
        <Text as="p" variant="secondary" size="sm">{t('topology.connectionGraphHelp')}</Text>
        <div className="topology-graph" role="img" aria-label={t('topology.connectionGraph')}>
          <svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}>
            {edges.map((edge) => {
              const from = positions.get(edge.fromPeerId);
              const to = positions.get(edge.toPeerId);
              if (!from || !to) return null;
              return <g key={`${edge.source}-${edge.fromPeerId}-${edge.toPeerId}`}>
                <line className={`graph-edge ${edge.source === 'peer_center' ? 'peer-center' : 'conn-bitmap'}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
                {edge.latencyMs !== undefined && <text className="graph-edge-label" x={(from.x + to.x) / 2} y={(from.y + to.y) / 2}>{edge.latencyMs} ms</text>}
              </g>;
            })}
            {nodes.map((node) => {
              const pos = positions.get(node.peerId);
              if (!pos) return null;
              return <g key={node.peerId}>
                <circle className={node.peerId === EDGE_PEER_ID ? 'graph-node edge' : 'graph-node'} cx={pos.x} cy={pos.y} r={node.peerId === EDGE_PEER_ID ? 18 : 14} />
                <text className="graph-node-label" x={pos.x} y={pos.y + 4}>{shortPeerId(node.peerId)}</text>
              </g>;
            })}
          </svg>
        </div>
        <div className="chart-legend">
          <span><i className="legend-swatch bitmap" />{t('topology.source.conn_bitmap')}</span>
          <span><i className="legend-swatch peer-center" />{t('topology.source.peer_center')}</span>
          <span><Badge variant="primary">{EDGE_PEER_ID}</Badge> edgetier-worker</span>
        </div>
      </div>
    </LayerCard.Primary>
  </LayerCard>;
}

function RouteTable({ routes, t }: { routes: RoutePathSnapshot[]; t: Translator }) {
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
                <Table.Cell><Badge variant="outline">{route.peerId}</Badge></Table.Cell>
                <Table.Cell><Badge variant={route.hopCount === undefined ? 'secondary' : 'primary'}>{route.hopCount === undefined ? t('common.unreachable') : t('common.reachable')}</Badge></Table.Cell>
                <Table.Cell>{route.nextHopPeerId ?? t('common.notObserved')}</Table.Cell>
                <Table.Cell>{route.pathPeerIds.length ? route.pathPeerIds.join(' -> ') : t('common.notObserved')}</Table.Cell>
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

function ConnectionMatrix({ matrix, t }: { matrix: ConnectionMatrixSnapshot; t: Translator }) {
  return <LayerCard>
    <LayerCard.Secondary>{t('topology.connectionMatrix')} <Badge variant="outline">{matrix.peerIds.length}</Badge></LayerCard.Secondary>
    <LayerCard.Primary>
      {matrix.peerIds.length === 0
        ? <Empty title={t('topology.noMatrixTitle')} description={t('topology.noMatrixDescription')} />
        : <div className="matrix-scroll">
          <Table>
            <Table.Header><Table.Row>
              <Table.Head>{t('common.from')}</Table.Head>
              {matrix.peerIds.map((peerId) => <Table.Head key={peerId}>{shortPeerId(peerId)}</Table.Head>)}
            </Table.Row></Table.Header>
            <Table.Body>
              {matrix.rows.map((row) => (
                <Table.Row key={row.peerId}>
                  <Table.Cell><Badge variant="outline">{shortPeerId(row.peerId)}</Badge></Table.Cell>
                  {matrix.peerIds.map((peerId) => (
                    <Table.Cell key={peerId} className={row.connectedPeerIds.includes(peerId) ? 'matrix-on' : 'matrix-off'}>
                      {row.peerId === peerId ? '-' : row.connectedPeerIds.includes(peerId) ? '1' : '0'}
                    </Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>}
    </LayerCard.Primary>
  </LayerCard>;
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
  const radiusX = GRAPH_WIDTH * 0.38;
  const radiusY = GRAPH_HEIGHT * 0.34;
  outer.forEach((peerId, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, outer.length) - Math.PI / 2;
    positions.set(peerId, {
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
    });
  });
  return positions;
}

function shortPeerId(peerId: number): string {
  const text = String(peerId);
  return text.length <= 6 ? text : text.slice(-6);
}

function sourceLabel(source: TopologyEdge['source'], t: Translator): string {
  return source === 'peer_center' ? t('topology.source.peer_center') : t('topology.source.conn_bitmap');
}

function routeSourceLabel(source: RoutePathSnapshot['source'], t: Translator): string {
  if (source === 'live_peer') return t('topology.source.live_peer');
  if (source === 'unreachable') return t('topology.source.unreachable');
  return t('topology.source.conn_bitmap');
}
