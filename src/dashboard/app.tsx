import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Empty, Input, LayerCard, Table, Text, cn } from '@cloudflare/kumo';
import { getRoom, getRoomEvents, getRoomTraffic, getRooms } from './api';
import { eventBadgeVariant, formatBytes } from './format';
import { ROOM_NAME_PATTERN } from '../easytier/constants';
import type { DirectoryRoomSummary, RoomSnapshot } from '../observer/types';
import './styles.css';

export function App() {
  const [rooms, setRooms] = useState<DirectoryRoomSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [lookup, setLookup] = useState('');
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  useEffect(() => {
    const tick = async () => {
      try {
        const list = await getRooms();
        let snapshot: RoomSnapshot | null = null;
        if (selected) {
          const [roomSnapshot, events, traffic] = await Promise.all([
            getRoom(selected),
            getRoomEvents(selected),
            getRoomTraffic(selected),
          ]);
          snapshot = { ...roomSnapshot, recentEvents: events, traffic };
        }
        setRooms(list);
        if (selected) setRoom(snapshot);
        setError(null);
        setLastRefreshed(new Date().toLocaleTimeString());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'dashboard fetch failed');
      }
    };
    void tick();
    const timer = setInterval(tick, 5000);
    return () => clearInterval(timer);
  }, [selected]);

  const totals = useMemo(() => {
    const activeRooms = rooms.filter((item) => item.active);
    return {
      activeRoomCount: activeRooms.length,
      staleRoomCount: rooms.length - activeRooms.length,
      activePeers: activeRooms.reduce((sum, item) => sum + item.peerCount, 0),
      websockets: activeRooms.reduce((sum, item) => sum + item.websocketCount, 0),
      bytes: activeRooms.reduce((sum, item) => sum + item.bytes, 0),
    };
  }, [rooms]);

  const selectRoom = (roomId: string) => {
    setSelected(roomId);
    setLookup(roomId);
    setLookupError(null);
  };

  const submitLookup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const roomId = lookup.trim();
    if (!ROOM_NAME_PATTERN.test(roomId)) {
      setLookupError('Use 1-64 letters, numbers, dots, underscores, or dashes; start with a letter or number.');
      return;
    }
    selectRoom(roomId);
  };

  const selectedListedRoom = selected ? rooms.find((item) => item.roomId === selected) : undefined;

  return <main className="shell bg-kumo-canvas text-kumo-default">
    <header className="hero">
      <Text as="p" variant="secondary" size="sm">Cloudflare edge relay observer skeleton for EasyTier private testing</Text>
      <Text as="h1" variant="heading1">EdgeTier Dashboard</Text>
      <Text as="p" variant="secondary">Read-only v0.1.1 observer. Real EasyTier compatibility remains future validation work.</Text>
    </header>

    {error && <section className="error-banner text-kumo-danger" role="alert">{error}. Previous successful data is still shown when available.</section>}

    <section className="grid cards" aria-label="recent activity overview">
      <Metric label="Recently active rooms" value={totals.activeRoomCount} />
      <Metric label="Stale rooms" value={totals.staleRoomCount} />
      <Metric label="Active peers" value={totals.activePeers} />
      <Metric label="Active relay bytes" value={formatBytes(totals.bytes)} />
    </section>

    <LayerCard>
      <LayerCard.Secondary>Room lookup {lastRefreshed ? `last refreshed ${lastRefreshed}` : 'not refreshed yet'}</LayerCard.Secondary>
      <LayerCard.Primary>
      <form className="lookup" onSubmit={submitLookup}>
        <Input label="Inspect a known room" value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="home-mesh" variant={lookupError ? 'error' : 'default'} />
        <Button type="submit" variant="primary">Open room</Button>
      </form>
      {lookupError && <Text as="p" variant="error" role="alert">{lookupError}</Text>}
      <Text as="p" variant="secondary">Manual lookup is read-only. A valid but unobserved room can be inspected before it appears in the directory.</Text>
      </LayerCard.Primary>
    </LayerCard>

    <LayerCard>
      <LayerCard.Secondary>Rooms <Badge variant="outline">recent activity directory</Badge></LayerCard.Secondary>
      <LayerCard.Primary>
      {rooms.length === 0 ? <Empty title="No rooms observed yet" description="Connect EasyTier WebSocket clients to /ws?room=<room>, or use manual lookup for a known room." /> : <Table layout="auto"><Table.Header><Table.Row><Table.Head>Room</Table.Head><Table.Head>Status</Table.Head><Table.Head>Peers</Table.Head><Table.Head>Bytes</Table.Head><Table.Head>Last activity</Table.Head></Table.Row></Table.Header><Table.Body>{rooms.map((item) => <Table.Row key={item.roomId} variant={item.roomId === selected ? 'selected' : 'default'} className={cn(item.roomId === selected && 'selected-row')}><Table.Cell><Button type="button" variant="ghost" onClick={() => selectRoom(item.roomId)} aria-pressed={item.roomId === selected}><Badge variant="outline">{item.roomId}</Badge></Button></Table.Cell><Table.Cell><Badge variant={item.active ? 'primary' : 'secondary'}>{item.active ? 'recently active' : 'stale'}</Badge></Table.Cell><Table.Cell>{item.peerCount}</Table.Cell><Table.Cell>{formatBytes(item.bytes)}</Table.Cell><Table.Cell>{item.lastActivity ?? 'none'}</Table.Cell></Table.Row>)}</Table.Body></Table>}
      </LayerCard.Primary>
    </LayerCard>

    {selected && !selectedListedRoom && <section className="notice text-kumo-subtle">Room <strong>{selected}</strong> is open from manual lookup but has not appeared in the recent activity directory. If all counters are empty, it may be unobserved or mistyped.</section>}

    {room ? <><LayerCard>
      <LayerCard.Secondary>Peers in {room.roomId} <Badge variant="outline">{room.websocketCount} websockets</Badge></LayerCard.Secondary>
      <LayerCard.Primary>
      {room.peers.length === 0 ? <Empty title="No peers observed" description="No peers are currently connected or identified in this room." /> : <Table><Table.Header><Table.Row><Table.Head>Peer</Table.Head><Table.Head>Status</Table.Head><Table.Head>Connected</Table.Head><Table.Head>Last seen</Table.Head><Table.Head>RX</Table.Head><Table.Head>TX</Table.Head></Table.Row></Table.Header><Table.Body>{room.peers.map((peer) => <Table.Row key={peer.sessionId}><Table.Cell>{peer.peerId ?? 'unknown'}</Table.Cell><Table.Cell><Badge variant={peer.connected ? 'primary' : 'secondary'}>{peer.connected ? 'connected' : 'offline'}</Badge></Table.Cell><Table.Cell>{peer.connectedAt}</Table.Cell><Table.Cell>{peer.lastSeen}</Table.Cell><Table.Cell>{formatBytes(peer.rxBytes)}</Table.Cell><Table.Cell>{formatBytes(peer.txBytes)}</Table.Cell></Table.Row>)}</Table.Body></Table>}
      </LayerCard.Primary>
    </LayerCard>
    <section className="grid"><LayerCard title="Traffic"><Text>RX {formatBytes(room.traffic.rxBytes)} / TX {formatBytes(room.traffic.txBytes)}</Text><Text variant="secondary">Forwarded {room.traffic.forwardedPackets} packets, unroutable {room.traffic.unroutablePackets}, invalid {room.traffic.invalidPackets}</Text></LayerCard><LayerCard title="Recent events">{room.recentEvents.length === 0 ? <Empty title="No events observed" description="No relay events have been observed for this room yet." /> : <Table><Table.Header><Table.Row><Table.Head>Time</Table.Head><Table.Head>Type</Table.Head><Table.Head>Peer</Table.Head><Table.Head>Message</Table.Head></Table.Row></Table.Header><Table.Body>{room.recentEvents.slice().reverse().map((event) => <Table.Row key={event.id}><Table.Cell>{event.timestamp}</Table.Cell><Table.Cell><Badge variant={eventBadgeVariant(event.type)}>{event.type}</Badge></Table.Cell><Table.Cell>{event.peerId ?? 'unknown'}</Table.Cell><Table.Cell>{event.message}</Table.Cell></Table.Row>)}</Table.Body></Table>}</LayerCard></section></> : <section className="notice text-kumo-subtle">No room selected. Choose a directory room or manually look up a known room to fetch its snapshot.</section>}
  </main>;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return <LayerCard><LayerCard.Secondary>{label}</LayerCard.Secondary><LayerCard.Primary><Text as="strong" variant="heading2">{value}</Text></LayerCard.Primary></LayerCard>;
}
