import React, { useMemo, useState } from 'react';
import { Badge, Empty, Select, Table, Text } from '@cloudflare/kumo';
import type { RelayEvent, RelayEventType } from '../../observer/types';
import { eventBadgeVariant } from '../format';
import type { Translator } from '../i18n';

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
  t: Translator;
}

export function Logs({ events, t }: LogsProps) {
  const [filter, setFilter] = useState<'all' | RelayEventType>('all');

  const filtered = useMemo(
    () => (filter === 'all' ? events : events.filter((event) => event.type === filter)),
    [events, filter],
  );

  const ordered = useMemo(() => filtered.slice().reverse(), [filtered]);

  return <div className="stack">
    <div className="logs-controls">
      <Select label={t('logs.eventType')} hideLabel={false} value={filter} onValueChange={(value) => setFilter(value as 'all' | RelayEventType)}>
        <Select.Option value="all">{t('logs.allEvents')}</Select.Option>
        {EVENT_TYPES.map((type) => <Select.Option key={type} value={type}>{type}</Select.Option>)}
      </Select>
      <Text as="span" variant="secondary" size="sm">{ordered.length} {t('common.events')}</Text>
    </div>
    {ordered.length === 0
      ? <Empty title={t('logs.noEventsTitle')} description={t('logs.noEventsDescription')} />
      : <Table>
        <Table.Header><Table.Row>
          <Table.Head>{t('common.time')}</Table.Head>
          <Table.Head>{t('common.type')}</Table.Head>
          <Table.Head>{t('common.peer')}</Table.Head>
          <Table.Head>{t('common.message')}</Table.Head>
        </Table.Row></Table.Header>
        <Table.Body>
          {ordered.map((event) => (
            <Table.Row key={event.id}>
              <Table.Cell>{event.timestamp}</Table.Cell>
              <Table.Cell><Badge variant={eventBadgeVariant(event.type)}>{event.type}</Badge></Table.Cell>
              <Table.Cell>{event.peerId ?? t('common.unknownPeer')}</Table.Cell>
              <Table.Cell>{event.message}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>}
  </div>;
}
