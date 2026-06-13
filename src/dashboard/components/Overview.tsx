import React from 'react';
import { Badge, Empty, LayerCard, Table, Text } from '@cloudflare/kumo';
import type { DirectoryRoomSummary, OutboundTcpStatus, RoomSnapshot } from '../../observer/types';
import { eventBadgeVariant, formatBytes } from '../format';
import type { Translator } from '../i18n';

interface OverviewProps {
  rooms: DirectoryRoomSummary[];
  room: RoomSnapshot | null;
  outboundTcp: OutboundTcpStatus | null;
  t: Translator;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return <LayerCard>
    <LayerCard.Secondary>{label}</LayerCard.Secondary>
    <LayerCard.Primary><Text as="strong" variant="heading2">{value}</Text></LayerCard.Primary>
  </LayerCard>;
}

export function Overview({ rooms, room, outboundTcp, t }: OverviewProps) {
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
  const outboundPeers = outboundTcp?.peers ?? [];
  const outboundConnected = outboundPeers.filter((peer) => peer.connected).length;
  const outboundAccepted = outboundPeers.filter((peer) => peer.handshakeAccepted).length;

  return <div className="stack">
    <section className="grid cards" aria-label="overview metrics">
      <Metric label={t('overview.activeRooms')} value={totals.activeRooms} />
      <Metric label={t('overview.staleRooms')} value={totals.staleRooms} />
      <Metric label={t('overview.activePeers')} value={totals.activePeers} />
      <Metric label={t('overview.websockets')} value={totals.websockets} />
      <Metric label={t('overview.relayBytes')} value={formatBytes(totals.bytes)} />
    </section>

    <section className="grid">
      <LayerCard>
        <LayerCard.Secondary>{t('overview.routePeers')} <Badge variant={topology?.nodes.length ? 'primary' : 'beta'}>{topology?.nodes.length ?? 0}</Badge></LayerCard.Secondary>
        <LayerCard.Primary>
          <Text as="p" variant="secondary">{topology?.nodes.length ? t('overview.routePeersReady') : t('overview.routePeersEmpty')}</Text>
        </LayerCard.Primary>
      </LayerCard>
      <LayerCard>
        <LayerCard.Secondary>{t('overview.edges')} <Badge variant={topology?.edges.length ? 'primary' : 'beta'}>{topology?.edges.length ?? 0}</Badge></LayerCard.Secondary>
        <LayerCard.Primary>
          <Text as="p" variant="secondary">{topology?.edges.length ? t('overview.edgesReady', { updatedAt: topology.updatedAt ?? t('common.notObserved') }) : t('overview.edgesEmpty')}</Text>
        </LayerCard.Primary>
      </LayerCard>
      <LayerCard>
        <LayerCard.Secondary>{t('overview.outboundTcp')} <Badge variant={outboundAccepted ? 'primary' : outboundPeers.length ? 'beta' : 'outline'}>{outboundPeers.length}</Badge></LayerCard.Secondary>
        <LayerCard.Primary>
          {outboundPeers.length
            ? <div className="stack compact">
              <Text as="p" variant="secondary">{t('overview.outboundConnected', { connected: outboundConnected, count: outboundPeers.length })}</Text>
              <Text as="p" variant="secondary">{t('overview.outboundHandshake', { accepted: outboundAccepted, count: outboundPeers.length })}</Text>
            </div>
            : <Text as="p" variant="secondary">{t('overview.outboundEmpty')}</Text>}
        </LayerCard.Primary>
      </LayerCard>
    </section>

    <LayerCard>
      <LayerCard.Secondary>{t('overview.recentEvents')} {room ? <Badge variant="outline">{room.roomId}</Badge> : null}</LayerCard.Secondary>
      <LayerCard.Primary>
        {recent.length === 0
          ? <Empty title={t('overview.noEventsTitle')} description={t('overview.noEventsDescription')} />
          : <Table>
            <Table.Header><Table.Row>
              <Table.Head>{t('common.time')}</Table.Head>
              <Table.Head>{t('common.type')}</Table.Head>
              <Table.Head>{t('common.peer')}</Table.Head>
              <Table.Head>{t('common.message')}</Table.Head>
            </Table.Row></Table.Header>
            <Table.Body>
              {recent.map((event) => (
                <Table.Row key={event.id}>
                  <Table.Cell>{event.timestamp}</Table.Cell>
                  <Table.Cell><Badge variant={eventBadgeVariant(event.type)}>{event.type}</Badge></Table.Cell>
                  <Table.Cell>{event.peerId ?? t('common.unknownPeer')}</Table.Cell>
                  <Table.Cell>{event.message}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>}
      </LayerCard.Primary>
    </LayerCard>
  </div>;
}
