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
  const topology = room?.topology;

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
        <LayerCard.Secondary>Decoded route peers <Badge variant={topology?.nodes.length ? 'primary' : 'beta'}>{topology?.nodes.length ?? 0}</Badge></LayerCard.Secondary>
        <LayerCard.Primary>
          <Text as="p" variant="secondary">{topology?.nodes.length ? 'EasyTier route-sync data has been decoded from control-plane RPC.' : 'No route-sync peer records decoded yet.'}</Text>
        </LayerCard.Primary>
      </LayerCard>
      <LayerCard>
        <LayerCard.Secondary>Topology edges <Badge variant={topology?.edges.length ? 'primary' : 'beta'}>{topology?.edges.length ?? 0}</Badge></LayerCard.Secondary>
        <LayerCard.Primary>
          <Text as="p" variant="secondary">{topology?.edges.length ? `Latest topology update ${topology.updatedAt ?? 'observed'}.` : 'No conn-bitmap or peer-center edges decoded yet.'}</Text>
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
