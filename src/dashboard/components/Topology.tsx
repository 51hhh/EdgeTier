import React from 'react';
import { Badge, Empty, LayerCard, Table, Text } from '@cloudflare/kumo';
import type { TopologyEdge, TopologySnapshot } from '../../observer/types';

interface TopologyProps {
  topology?: TopologySnapshot | null;
}

function sourceLabel(source: TopologyEdge['source']): string {
  return source === 'peer_center' ? 'PeerCenter' : 'conn bitmap';
}

export function Topology({ topology }: TopologyProps) {
  const nodes = topology?.nodes ?? [];
  const edges = topology?.edges ?? [];
  const latencyEdges = edges.filter((edge) => edge.latencyMs !== undefined);
  const connBitmapEdges = edges.filter((edge) => edge.source === 'conn_bitmap');
  const peerCenterEdges = edges.filter((edge) => edge.source === 'peer_center');
  const p2pRatio = edges.length === 0 ? 'unknown' : `${Math.round((peerCenterEdges.length / edges.length) * 100)}%`;

  return <div className="stack">
    <section className="grid cards" aria-label="topology metrics">
      <LayerCard>
        <LayerCard.Secondary>Nodes</LayerCard.Secondary>
        <LayerCard.Primary><Text as="strong" variant="heading2">{nodes.length}</Text></LayerCard.Primary>
      </LayerCard>
      <LayerCard>
        <LayerCard.Secondary>Edges</LayerCard.Secondary>
        <LayerCard.Primary><Text as="strong" variant="heading2">{edges.length}</Text></LayerCard.Primary>
      </LayerCard>
      <LayerCard>
        <LayerCard.Secondary>Latency edges</LayerCard.Secondary>
        <LayerCard.Primary><Text as="strong" variant="heading2">{latencyEdges.length}</Text></LayerCard.Primary>
      </LayerCard>
      <LayerCard>
        <LayerCard.Secondary>PeerCenter ratio</LayerCard.Secondary>
        <LayerCard.Primary><Text as="strong" variant="heading2">{p2pRatio}</Text></LayerCard.Primary>
      </LayerCard>
    </section>

    <section className="grid">
      <LayerCard>
        <LayerCard.Secondary>conn bitmap</LayerCard.Secondary>
        <LayerCard.Primary><Text as="p" variant="secondary">{connBitmapEdges.length} route topology edge(s)</Text></LayerCard.Primary>
      </LayerCard>
      <LayerCard>
        <LayerCard.Secondary>PeerCenter</LayerCard.Secondary>
        <LayerCard.Primary><Text as="p" variant="secondary">{peerCenterEdges.length} direct latency edge(s)</Text></LayerCard.Primary>
      </LayerCard>
    </section>

    <LayerCard>
      <LayerCard.Secondary>Topology nodes {topology ? <Badge variant="outline">{topology.roomId}</Badge> : null}</LayerCard.Secondary>
      <LayerCard.Primary>
        {nodes.length === 0
          ? <Empty title="No topology nodes" description="No EasyTier route or PeerCenter topology records are available for this room." />
          : <Table>
            <Table.Header><Table.Row>
              <Table.Head>Peer</Table.Head>
              <Table.Head>Hostname</Table.Head>
              <Table.Head>Virtual IP</Table.Head>
              <Table.Head>NAT</Table.Head>
              <Table.Head>Version</Table.Head>
              <Table.Head>Last seen</Table.Head>
            </Table.Row></Table.Header>
            <Table.Body>
              {nodes.map((node) => (
                <Table.Row key={node.peerId}>
                  <Table.Cell><Badge variant="outline">{node.peerId}</Badge></Table.Cell>
                  <Table.Cell>{node.hostname ?? 'unknown'}</Table.Cell>
                  <Table.Cell>{node.virtualIpv4 ?? node.virtualIpv6 ?? 'unknown'}</Table.Cell>
                  <Table.Cell>{node.udpNatType ?? node.tcpNatType ?? 'unknown'}</Table.Cell>
                  <Table.Cell>{node.easytierVersion ?? 'unknown'}</Table.Cell>
                  <Table.Cell>{node.lastSeen}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>}
      </LayerCard.Primary>
    </LayerCard>

    <LayerCard>
      <LayerCard.Secondary>Topology edges {topology?.updatedAt ? <Badge variant="outline">{topology.updatedAt}</Badge> : null}</LayerCard.Secondary>
      <LayerCard.Primary>
        {edges.length === 0
          ? <Empty title="No topology edges" description="No conn-bitmap or PeerCenter edges are available for this room." />
          : <Table>
            <Table.Header><Table.Row>
              <Table.Head>From</Table.Head>
              <Table.Head>To</Table.Head>
              <Table.Head>Source</Table.Head>
              <Table.Head>Latency</Table.Head>
            </Table.Row></Table.Header>
            <Table.Body>
              {edges.map((edge) => (
                <Table.Row key={`${edge.source}-${edge.fromPeerId}-${edge.toPeerId}`}>
                  <Table.Cell>{edge.fromPeerId}</Table.Cell>
                  <Table.Cell>{edge.toPeerId}</Table.Cell>
                  <Table.Cell><Badge variant={edge.source === 'peer_center' ? 'primary' : 'outline'}>{sourceLabel(edge.source)}</Badge></Table.Cell>
                  <Table.Cell>{edge.latencyMs === undefined ? 'unknown' : `${edge.latencyMs} ms`}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>}
      </LayerCard.Primary>
    </LayerCard>
  </div>;
}
