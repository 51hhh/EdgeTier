import React, { Suspense } from 'react';
import { Badge, ChartLegend, ChartPalette, Empty, Grid, GridItem, LayerCard, Meter, SkeletonLine, Table, Text } from '@cloudflare/kumo';
import type { DirectoryRoomSummary, OutboundTcpStatus, RoomSnapshot } from '../../observer/types';
import { eventBadgeVariant, formatByteRate, formatBytes, formatPercent } from '../format';
import type { Translator } from '../i18n';

interface OverviewProps {
  rooms: DirectoryRoomSummary[];
  room: RoomSnapshot | null;
  outboundTcp: OutboundTcpStatus | null;
  t: Translator;
}

const TrafficChart = React.lazy(() => import('./TrafficChart').then((module) => ({ default: module.TrafficChart })));

const METRIC_COLORS = {
  active: ChartPalette.semantic('Success'),
  attention: ChartPalette.semantic('Attention'),
  neutral: ChartPalette.semantic('Neutral'),
  rx: ChartPalette.categorical(0),
  tx: ChartPalette.semantic('Success'),
  topology: ChartPalette.categorical(3),
  transport: ChartPalette.categorical(4),
} as const;

function Metric({ label, value, color = METRIC_COLORS.neutral, inactive = false }: { label: string; value: string | number; color?: string; inactive?: boolean }) {
  const displayValue = String(value);
  return <LayerCard className="metric-card" title={`${label}: ${displayValue}`}>
    <div className="metric-card-inner">
      <ChartLegend.LargeItem name={label} value={displayValue} color={color} inactive={inactive} />
    </div>
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
    <section className="overview-metric-strip" aria-label="overview metrics">
      <Metric label={t('overview.activeRooms')} value={totals.activeRooms} color={METRIC_COLORS.active} inactive={totals.activeRooms === 0} />
      <Metric label={t('overview.staleRooms')} value={totals.staleRooms} color={totals.staleRooms ? METRIC_COLORS.attention : METRIC_COLORS.neutral} inactive={totals.staleRooms === 0} />
      <Metric label={t('overview.activePeers')} value={totals.activePeers} color={METRIC_COLORS.active} inactive={totals.activePeers === 0} />
      <Metric label={t('overview.websockets')} value={totals.websockets} color={METRIC_COLORS.transport} inactive={totals.websockets === 0} />
      <Metric label={t('overview.relayBytes')} value={formatBytes(totals.bytes)} color={METRIC_COLORS.topology} inactive={totals.bytes === 0} />
      <Metric label={t('overview.rxRate')} value={formatByteRate(room?.traffic.summary.rxBytesPerSecond ?? 0)} color={METRIC_COLORS.rx} inactive={!room?.traffic.summary.rxBytesPerSecond} />
      <Metric label={t('overview.txRate')} value={formatByteRate(room?.traffic.summary.txBytesPerSecond ?? 0)} color={METRIC_COLORS.tx} inactive={!room?.traffic.summary.txBytesPerSecond} />
      <Metric label={t('overview.relayDropRate')} value={formatPercent(room?.traffic.summary.relayDropRate)} color={(room?.traffic.summary.relayDropRate ?? 0) > 0 ? METRIC_COLORS.attention : METRIC_COLORS.neutral} inactive={!room?.traffic.summary.relayDropRate} />
    </section>

    <Grid variant="3up" gap="sm">
      <GridItem><LayerCard>
        <LayerCard.Secondary>{t('overview.routePeers')}</LayerCard.Secondary>
        <LayerCard.Primary>
          <div className="overview-status-card">
            <ChartLegend.LargeItem name={t('overview.routePeers')} color={METRIC_COLORS.topology} value={String(topology?.nodes.length ?? 0)} inactive={!topology?.nodes.length} />
            <Text as="p" variant="secondary">{topology?.nodes.length ? t('overview.routePeersReady') : t('overview.routePeersEmpty')}</Text>
          </div>
        </LayerCard.Primary>
      </LayerCard></GridItem>
      <GridItem><LayerCard>
        <LayerCard.Secondary>{t('overview.edges')}</LayerCard.Secondary>
        <LayerCard.Primary>
          <div className="overview-status-card">
            <ChartLegend.LargeItem name={t('overview.edges')} color={METRIC_COLORS.topology} value={String(topology?.edges.length ?? 0)} inactive={!topology?.edges.length} />
            <Text as="p" variant="secondary">{topology?.edges.length ? t('overview.edgesReady', { updatedAt: topology.updatedAt ?? t('common.notObserved') }) : t('overview.edgesEmpty')}</Text>
          </div>
        </LayerCard.Primary>
      </LayerCard></GridItem>
      <GridItem><LayerCard>
        <LayerCard.Secondary>{t('overview.outboundTcp')}</LayerCard.Secondary>
        <LayerCard.Primary>
          <div className="overview-status-card">
            <ChartLegend.LargeItem name={t('overview.outboundTcp')} color={outboundAccepted ? METRIC_COLORS.active : METRIC_COLORS.transport} value={String(outboundPeers.length)} inactive={!outboundPeers.length} />
            {outboundPeers.length
              ? <div className="stack compact">
                <Meter label={t('overview.outboundConnected', { connected: outboundConnected, count: outboundPeers.length })} value={percent(outboundConnected, outboundPeers.length)} customValue={`${outboundConnected}/${outboundPeers.length}`} />
                <Meter label={t('overview.outboundHandshake', { accepted: outboundAccepted, count: outboundPeers.length })} value={percent(outboundAccepted, outboundPeers.length)} customValue={`${outboundAccepted}/${outboundPeers.length}`} />
              </div>
              : <Text as="p" variant="secondary">{t('overview.outboundEmpty')}</Text>}
          </div>
        </LayerCard.Primary>
      </LayerCard></GridItem>
    </Grid>

    <Suspense fallback={<TrafficChartFallback title={t('overview.trafficChart')} />}>
      <TrafficChart traffic={room?.traffic} t={t} />
    </Suspense>

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

function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function TrafficChartFallback({ title }: { title: string }) {
  return <LayerCard>
    <LayerCard.Secondary>{title}</LayerCard.Secondary>
    <LayerCard.Primary>
      <div className="stack">
        <SkeletonLine blockHeight={24} minWidth={70} maxWidth={96} />
        <SkeletonLine blockHeight={220} minWidth={100} maxWidth={100} />
      </div>
    </LayerCard.Primary>
  </LayerCard>;
}
