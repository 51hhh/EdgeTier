import React, { useMemo, useState } from 'react';
import { Badge, Empty, Select, Table, Text } from '@cloudflare/kumo';
import type { RelayEvent, RelayEventType } from '../../observer/types';
import { eventBadgeVariant } from '../format';

const EVENT_TYPES: RelayEventType[] = [
  'connected',
  'disconnected',
  'handshake_seen',
  'packet_forwarded',
  'packet_unroutable',
  'rpc_seen',
  'decode_error',
  'limit_exceeded',
];

interface LogsProps {
  events: RelayEvent[];
}

export function Logs({ events }: LogsProps) {
  const [filter, setFilter] = useState<'all' | RelayEventType>('all');

  const filtered = useMemo(
    () => (filter === 'all' ? events : events.filter((event) => event.type === filter)),
    [events, filter],
  );

  const ordered = useMemo(() => filtered.slice().reverse(), [filtered]);

  return <div className="stack">
    <div className="logs-controls">
      <Select label="Event type" hideLabel={false} value={filter} onValueChange={(value) => setFilter(value as 'all' | RelayEventType)}>
        <Select.Option value="all">All events</Select.Option>
        {EVENT_TYPES.map((type) => <Select.Option key={type} value={type}>{type}</Select.Option>)}
      </Select>
      <Text as="span" variant="secondary" size="sm">{ordered.length} event(s)</Text>
    </div>
    {ordered.length === 0
      ? <Empty title="No events" description="No relay events match the current filter." />
      : <Table>
        <Table.Header><Table.Row>
          <Table.Head>Time</Table.Head>
          <Table.Head>Type</Table.Head>
          <Table.Head>Peer</Table.Head>
          <Table.Head>Message</Table.Head>
        </Table.Row></Table.Header>
        <Table.Body>
          {ordered.map((event) => (
            <Table.Row key={event.id}>
              <Table.Cell>{event.timestamp}</Table.Cell>
              <Table.Cell><Badge variant={eventBadgeVariant(event.type)}>{event.type}</Badge></Table.Cell>
              <Table.Cell>{event.peerId ?? 'unknown'}</Table.Cell>
              <Table.Cell>{event.message}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>}
  </div>;
}
