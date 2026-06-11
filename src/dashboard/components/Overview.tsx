import React from 'react';
import { Badge, Empty, LayerCard, Table, Text } from '@cloudflare/kumo';
import type { DirectoryRoomSummary, RoomSnapshot } from '../../observer/types';
import { eventBadgeVariant, formatBytes } from '../format';

interface OverviewProps {
  rooms: DirectoryRoomSummary[];
  room: RoomSnapshot | null;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return <LayerCard>
    <LayerCard.Secondary>{label}</LayerCard.Secondary>
    <LayerCard.Primary><Text as="strong" variant="heading2">{value}</Text></LayerCard.Primary>
  </LayerCard>;
}

export function Overview({ rooms, room }: OverviewProps) {
  const active = rooms.filter((item) => item.active);
  const totals = {
    activeRooms: active.length,
    staleRooms: rooms.length - active.length,
    activePeers: active.reduce((sum, item) => sum + item.peerCount, 0),
    websockets: active.reduce((sum, item) => sum + item.websocketCount, 0),
    bytes: active.reduce((sum, item) => sum + item.bytes, 0),
  };
  const recent = room ? room.recentEvents.slice(-8).reverse() : [];

  return <div className="stack">
    <section className="grid cards" aria-label="overview metrics">
      <Metric label="Recently active rooms" value={totals.activeRooms} />
      <Metric label="Stale rooms" value={totals.staleRooms} />
      <Metric label="Active peers" value={totals.activePeers} />
      <Metric label="WebSockets" value={totals.websockets} />
      <Metric label="Relay bytes" value={formatBytes(totals.bytes)} />
    </section>

    <section className="grid">
      <LayerCard>
        <LayerCard.Secondary>Exit / VPN egress <Badge variant="beta">not available</Badge></LayerCard.Secondary>
        <LayerCard.Primary>
          <Text as="p" variant="secondary">Exit-node and VPN traffic-egress state is not observable from relay headers alone. It requires official EasyTier proto decode (roadmap v0.1.3) and is intentionally not fabricated here.</Text>
        </LayerCard.Primary>
      </LayerCard>
      <LayerCard>
        <LayerCard.Secondary>Topology <Badge variant="beta">not available</Badge></LayerCard.Secondary>
        <LayerCard.Primary>
          <Text as="p" variant="secondary">Global peer map and P2P/relay edges need route-sync decode (roadmap v0.2). EdgeTier currently observes only per-connection relay activity.</Text>
        </LayerCard.Primary>
      </LayerCard>
    </section>

    <LayerCard>
      <LayerCard.Secondary>Recent events {room ? <Badge variant="outline">{room.roomId}</Badge> : null}</LayerCard.Secondary>
      <LayerCard.Primary>
        {recent.length === 0
          ? <Empty title="No recent events" description="Select a room in Devices to stream its relay events here." />
          : <Table>
            <Table.Header><Table.Row>
              <Table.Head>Time</Table.Head>
              <Table.Head>Type</Table.Head>
              <Table.Head>Peer</Table.Head>
              <Table.Head>Message</Table.Head>
            </Table.Row></Table.Header>
            <Table.Body>
              {recent.map((event) => (
                <Table.Row key={event.id}>
                  <Table.Cell>{event.timestamp}</Table.Cell>
                  <Table.Cell><Badge variant={eventBadgeVariant(event.type)}>{event.type}</Badge></Table.Cell>
                  <Table.Cell>{event.peerId ?? 'unknown'}</Table.Cell>
                  <Table.Cell>{event.message}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>}
      </LayerCard.Primary>
    </LayerCard>
  </div>;
}
