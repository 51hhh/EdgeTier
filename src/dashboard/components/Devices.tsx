import React from 'react';
import { Badge, Empty, LayerCard, Table, Text } from '@cloudflare/kumo';
import type { PeerSnapshot } from '../../observer/types';
import { formatBytes } from '../format';
import type { Translator } from '../i18n';

interface PeerDetailProps {
  peer: PeerSnapshot;
  t: Translator;
}

function Row({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return <div className="detail-row">
    <Text as="span" variant="secondary" size="sm">{label}</Text>
    <Text as="span" variant={muted ? 'secondary' : 'body'}>{value}</Text>
  </div>;
}

function peerIdLabel(peer: PeerSnapshot, t: Translator): string | number {
  return peer.peerId ?? t('common.unknownPeer');
}

function transportLabel(peer: PeerSnapshot, t: Translator): string {
  if (peer.transportKind === 'websocket') return t('common.transport.websocket');
  if (peer.transportKind === 'tcp-outbound') return t('common.transport.tcpOutbound');
  return t('common.routeOnly');
}

function routeField(value: string | undefined, t: Translator): string {
  return value || t('common.routeDataPending');
}

function statusLabel(peer: PeerSnapshot, t: Translator): string {
  if (peer.connected) return t('common.online');
  if (!peer.transportKind) return t('common.observed');
  return t('common.offline');
}

function statusVariant(peer: PeerSnapshot): 'primary' | 'secondary' | 'outline' {
  if (peer.connected) return 'primary';
  if (!peer.transportKind) return 'outline';
  return 'secondary';
}

export function PeerDetail({ peer, t }: PeerDetailProps) {
  return <LayerCard>
    <LayerCard.Secondary>
      {t('devices.device', { peer: String(peerIdLabel(peer, t)) })} <Badge variant={statusVariant(peer)}>{statusLabel(peer, t)}</Badge>
    </LayerCard.Secondary>
    <LayerCard.Primary>
      <div className="detail-grid">
        <Row label={t('devices.peerId')} value={peer.peerId ?? t('devices.peerIdMissing')} muted={peer.peerId === undefined} />
        <Row label={t('devices.sessionId')} value={peer.sessionId} />
        <Row label={t('common.transport')} value={transportLabel(peer, t)} />
        <Row label={t('devices.networkName')} value={peer.networkName ?? t('common.notObserved')} muted={!peer.networkName} />
        <Row label={t('devices.secretDigest')} value={peer.networkSecretDigestPrefix ?? t('common.notObserved')} muted={!peer.networkSecretDigestPrefix} />
        <Row label={t('common.hostname')} value={routeField(peer.hostname, t)} muted={!peer.hostname} />
        <Row label={t('devices.virtualIpv4')} value={routeField(peer.virtualIpv4, t)} muted={!peer.virtualIpv4} />
        <Row label={t('devices.virtualIpv6')} value={routeField(peer.virtualIpv6, t)} muted={!peer.virtualIpv6} />
        <Row label={t('devices.udpNat')} value={peer.udpNatType ?? t('common.notDecoded')} muted={!peer.udpNatType} />
        <Row label={t('devices.tcpNat')} value={peer.tcpNatType ?? t('common.notDecoded')} muted={!peer.tcpNatType} />
        <Row label={t('devices.easytierVersion')} value={routeField(peer.easytierVersion, t)} muted={!peer.easytierVersion} />
        <Row label={t('devices.proxyCidrs')} value={peer.proxyCidrs?.length ? peer.proxyCidrs.join(', ') : t('common.noneObserved')} muted={!peer.proxyCidrs?.length} />
        <Row label={t('devices.connectedAt')} value={peer.connectedAt} />
        <Row label={t('common.lastSeen')} value={peer.lastSeen} />
        <Row label={t('common.rx')} value={`${formatBytes(peer.rxBytes)} / ${peer.rxPackets} ${t('common.packets')}`} />
        <Row label={t('common.tx')} value={`${formatBytes(peer.txBytes)} / ${peer.txPackets} ${t('common.packets')}`} />
      </div>
    </LayerCard.Primary>
  </LayerCard>;
}

interface PeerTableProps {
  peers: PeerSnapshot[];
  selectedSession: string | null;
  onSelect: (sessionId: string) => void;
  t: Translator;
}

export function PeerTable({ peers, selectedSession, onSelect, t }: PeerTableProps) {
  if (peers.length === 0) {
    return <Empty title={t('devices.noPeersTitle')} description={t('devices.noPeersDescription')} />;
  }
  return <Table>
    <Table.Header><Table.Row>
      <Table.Head>{t('common.peer')}</Table.Head>
      <Table.Head>{t('common.transport')}</Table.Head>
      <Table.Head>{t('common.hostname')}</Table.Head>
      <Table.Head>{t('common.virtualIp')}</Table.Head>
      <Table.Head>{t('common.nat')}</Table.Head>
      <Table.Head>{t('common.version')}</Table.Head>
      <Table.Head>{t('common.status')}</Table.Head>
      <Table.Head>{t('common.lastSeen')}</Table.Head>
      <Table.Head>{t('common.rx')}</Table.Head>
      <Table.Head>{t('common.tx')}</Table.Head>
    </Table.Row></Table.Header>
    <Table.Body>
      {peers.map((peer) => (
        <Table.Row key={peer.sessionId} variant={peer.sessionId === selectedSession ? 'selected' : 'default'}>
          <Table.Cell>
            <button type="button" className="row-button" onClick={() => onSelect(peer.sessionId)} aria-pressed={peer.sessionId === selectedSession}>
              <Badge variant="outline">{peerIdLabel(peer, t)}</Badge>
            </button>
          </Table.Cell>
          <Table.Cell>{transportLabel(peer, t)}</Table.Cell>
          <Table.Cell>{routeField(peer.hostname, t)}</Table.Cell>
          <Table.Cell>{peer.virtualIpv4 ?? peer.virtualIpv6 ?? t('common.routeDataPending')}</Table.Cell>
          <Table.Cell>{peer.udpNatType ?? peer.tcpNatType ?? t('common.notDecoded')}</Table.Cell>
          <Table.Cell>{routeField(peer.easytierVersion, t)}</Table.Cell>
          <Table.Cell><Badge variant={statusVariant(peer)}>{statusLabel(peer, t)}</Badge></Table.Cell>
          <Table.Cell>{peer.lastSeen}</Table.Cell>
          <Table.Cell>{formatBytes(peer.rxBytes)}</Table.Cell>
          <Table.Cell>{formatBytes(peer.txBytes)}</Table.Cell>
        </Table.Row>
      ))}
    </Table.Body>
  </Table>;
}
