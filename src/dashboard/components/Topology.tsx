import React from 'react';
import { Badge, Empty, LayerCard, Table, Text } from '@cloudflare/kumo';
import type { TopologyEdge, TopologySnapshot } from '../../observer/types';
import type { Translator } from '../i18n';

interface TopologyProps {
  topology?: TopologySnapshot | null;
  t: Translator;
}

function sourceLabel(source: TopologyEdge['source']): string {
  return source === 'peer_center' ? 'PeerCenter' : 'conn bitmap';
}

export function Topology({ topology, t }: TopologyProps) {
  const nodes = topology?.nodes ?? [];
  const edges = topology?.edges ?? [];
  const summary = topology?.summary ?? {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    connBitmapEdgeCount: edges.filter((edge) => edge.source === 'conn_bitmap').length,
    peerCenterEdgeCount: edges.filter((edge) => edge.source === 'peer_center').length,
    latencyEdgeCount: edges.filter((edge) => edge.latencyMs !== undefined).length,
  };
  const p2pRatio = summary.peerCenterRatio === undefined ? t('common.notDecoded') : `${Math.round(summary.peerCenterRatio * 100)}%`;

  return <div className="stack">
    <section className="grid cards" aria-label="topology metrics">
      <LayerCard>
        <LayerCard.Secondary>{t('topology.nodes')}</LayerCard.Secondary>
        <LayerCard.Primary><Text as="strong" variant="heading2">{summary.nodeCount}</Text></LayerCard.Primary>
      </LayerCard>
      <LayerCard>
        <LayerCard.Secondary>{t('topology.edges')}</LayerCard.Secondary>
        <LayerCard.Primary><Text as="strong" variant="heading2">{summary.edgeCount}</Text></LayerCard.Primary>
      </LayerCard>
      <LayerCard>
        <LayerCard.Secondary>{t('topology.latencyEdges')}</LayerCard.Secondary>
        <LayerCard.Primary><Text as="strong" variant="heading2">{summary.latencyEdgeCount}</Text></LayerCard.Primary>
      </LayerCard>
      <LayerCard>
        <LayerCard.Secondary>{t('topology.peerCenterRatio')}</LayerCard.Secondary>
        <LayerCard.Primary><Text as="strong" variant="heading2">{p2pRatio}</Text></LayerCard.Primary>
      </LayerCard>
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
              <Table.Head>{t('common.lastSeen')}</Table.Head>
            </Table.Row></Table.Header>
            <Table.Body>
              {nodes.map((node) => (
                <Table.Row key={node.peerId}>
                  <Table.Cell><Badge variant="outline">{node.peerId}</Badge></Table.Cell>
                  <Table.Cell>{node.hostname ?? t('common.routeDataPending')}</Table.Cell>
                  <Table.Cell>{node.virtualIpv4 ?? node.virtualIpv6 ?? t('common.routeDataPending')}</Table.Cell>
                  <Table.Cell>{node.udpNatType ?? node.tcpNatType ?? t('common.notDecoded')}</Table.Cell>
                  <Table.Cell>{node.easytierVersion ?? t('common.routeDataPending')}</Table.Cell>
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
                  <Table.Cell><Badge variant={edge.source === 'peer_center' ? 'primary' : 'outline'}>{sourceLabel(edge.source)}</Badge></Table.Cell>
                  <Table.Cell>{edge.latencyMs === undefined ? t('common.notDecoded') : `${edge.latencyMs} ms`}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>}
      </LayerCard.Primary>
    </LayerCard>
  </div>;
}
