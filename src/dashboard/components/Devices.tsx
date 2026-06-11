import React from 'react';
import { Badge, Empty, LayerCard, Table, Text } from '@cloudflare/kumo';
import type { PeerSnapshot } from '../../observer/types';
import { formatBytes } from '../format';

interface PeerDetailProps {
  peer: PeerSnapshot;
}

function Row({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return <div className="detail-row">
    <Text as="span" variant="secondary" size="sm">{label}</Text>
    <Text as="span" variant={muted ? 'secondary' : 'body'}>{value}</Text>
  </div>;
}

export function PeerDetail({ peer }: PeerDetailProps) {
  return <LayerCard>
    <LayerCard.Secondary>
      Device {peer.peerId ?? 'unknown'} <Badge variant={peer.connected ? 'primary' : 'secondary'}>{peer.connected ? 'online' : 'offline'}</Badge>
    </LayerCard.Secondary>
    <LayerCard.Primary>
      <div className="detail-grid">
        <Row label="Peer ID" value={peer.peerId ?? 'unknown (no parseable header yet)'} muted={peer.peerId === undefined} />
        <Row label="Session ID" value={peer.sessionId} />
        <Row label="Network name" value={peer.networkName ?? 'not observed'} muted={!peer.networkName} />
        <Row label="Secret digest" value={peer.networkSecretDigestPrefix ?? 'not observed'} muted={!peer.networkSecretDigestPrefix} />
        <Row label="Connected at" value={peer.connectedAt} />
        <Row label="Last seen" value={peer.lastSeen} />
        <Row label="RX" value={`${formatBytes(peer.rxBytes)} / ${peer.rxPackets} pkts`} />
        <Row label="TX" value={`${formatBytes(peer.txBytes)} / ${peer.txPackets} pkts`} />
      </div>
      <Text as="p" variant="secondary" size="sm">Virtual IP, route table, and exit-node role are not observable until official EasyTier proto decode (v0.1.3).</Text>
    </LayerCard.Primary>
  </LayerCard>;
}

interface PeerTableProps {
  peers: PeerSnapshot[];
  selectedSession: string | null;
  onSelect: (sessionId: string) => void;
}

export function PeerTable({ peers, selectedSession, onSelect }: PeerTableProps) {
  if (peers.length === 0) {
    return <Empty title="No peers observed" description="No peers are currently connected or identified in this room." />;
  }
  return <Table>
    <Table.Header><Table.Row>
      <Table.Head>Peer</Table.Head>
      <Table.Head>Status</Table.Head>
      <Table.Head>Last seen</Table.Head>
      <Table.Head>RX</Table.Head>
      <Table.Head>TX</Table.Head>
    </Table.Row></Table.Header>
    <Table.Body>
      {peers.map((peer) => (
        <Table.Row key={peer.sessionId} variant={peer.sessionId === selectedSession ? 'selected' : 'default'}>
          <Table.Cell>
            <button type="button" className="row-button" onClick={() => onSelect(peer.sessionId)} aria-pressed={peer.sessionId === selectedSession}>
              <Badge variant="outline">{peer.peerId ?? 'unknown'}</Badge>
            </button>
          </Table.Cell>
          <Table.Cell><Badge variant={peer.connected ? 'primary' : 'secondary'}>{peer.connected ? 'online' : 'offline'}</Badge></Table.Cell>
          <Table.Cell>{peer.lastSeen}</Table.Cell>
          <Table.Cell>{formatBytes(peer.rxBytes)}</Table.Cell>
          <Table.Cell>{formatBytes(peer.txBytes)}</Table.Cell>
        </Table.Row>
      ))}
    </Table.Body>
  </Table>;
}
