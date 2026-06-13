import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Empty, Input, LayerCard, Tabs, Text } from '@cloudflare/kumo';
import { clearRoomSeed, createRoomRelayToken, getRoom, getRoomEvents, getRoomTopology, getRoomTraffic, getRooms, logout, seedRoom } from './api';
import { ROOM_NAME_PATTERN } from '../easytier/constants';
import type { DirectoryRoomSummary, RoomSnapshot } from '../observer/types';
import { Overview } from './components/Overview';
import { PeerDetail, PeerTable } from './components/Devices';
import { Logs } from './components/Logs';
import { ConfigGenerator } from './components/ConfigGenerator';
import { Topology } from './components/Topology';
import './styles.css';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'devices', label: 'Devices' },
  { value: 'topology', label: 'Topology' },
  { value: 'logs', label: 'Logs' },
  { value: 'config', label: 'Config' },
];

export function App() {
  const [tab, setTab] = useState('overview');
  const [rooms, setRooms] = useState<DirectoryRoomSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [lookup, setLookup] = useState('');
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [relayUri, setRelayUri] = useState<{ room: string; uri: string; expiresAt: string } | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  useEffect(() => {
    const tick = async () => {
      try {
        const list = await getRooms();
        let snapshot: RoomSnapshot | null = null;
        if (selected) {
          const [roomSnapshot, events, traffic, topology] = await Promise.all([
            getRoom(selected),
            getRoomEvents(selected),
            getRoomTraffic(selected),
            getRoomTopology(selected),
          ]);
          snapshot = { ...roomSnapshot, recentEvents: events, traffic, topology };
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

  const selectRoom = (roomId: string) => {
    setSelected(roomId);
    setLookup(roomId);
    setLookupError(null);
    setSelectedSession(null);
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

  const issueRelayToken = async () => {
    if (!selected) {
      setTokenError('Choose or look up a room before issuing a WebSocket token.');
      return;
    }
    try {
      const token = await createRoomRelayToken(selected);
      setRelayUri({ room: token.room, uri: `${window.location.origin.replace(/^http/, 'ws')}${token.uriPath}`, expiresAt: token.expiresAt });
      setTokenError(null);
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : 'failed to issue relay token');
    }
  };

  const seedTest = async () => {
    const target = selected ?? 'home-mesh';
    try {
      await seedRoom(target, 6);
      if (!selected) selectRoom(target);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to seed test data');
    }
  };

  const clearTest = async () => {
    if (!selected) return;
    try {
      await clearRoomSeed(selected);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to clear test data');
    }
  };

  const signOut = async () => {
    await logout();
    window.location.href = '/login';
  };

  const selectedListedRoom = selected ? rooms.find((item) => item.roomId === selected) : undefined;
  const selectedPeer = useMemo(
    () => (room && selectedSession ? room.peers.find((peer) => peer.sessionId === selectedSession) : undefined),
    [room, selectedSession],
  );

  return <main className="shell bg-kumo-canvas text-kumo-default">
    <header className="hero">
      <div className="hero-row">
        <div>
          <Text as="p" variant="secondary" size="sm">Cloudflare edge relay observer for EasyTier private mesh</Text>
          <Text as="h1" variant="heading1">EdgeTier</Text>
        </div>
        <Button type="button" variant="ghost" onClick={signOut}>Sign out</Button>
      </div>
      <Tabs variant="underline" tabs={TABS} value={tab} onValueChange={setTab} />
      <Text as="p" variant="secondary" size="sm">{lastRefreshed ? `Last refreshed ${lastRefreshed}` : 'Loading…'}{selected ? ` · room ${selected}` : ' · no room selected'}</Text>
    </header>

    {error && <section className="error-banner text-kumo-danger" role="alert">{error}. Previous successful data is still shown when available.</section>}

    {tab === 'overview' && <Overview rooms={rooms} room={room} />}

    {tab === 'devices' && <div className="stack">
      <LayerCard>
        <LayerCard.Secondary>Rooms <Badge variant="outline">recent activity directory</Badge></LayerCard.Secondary>
        <LayerCard.Primary>
          <form className="lookup" onSubmit={submitLookup}>
            <Input label="Inspect a known room" value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="home-mesh" variant={lookupError ? 'error' : 'default'} />
            <Button type="submit" variant="primary">Open room</Button>
          </form>
          <div className="switch-row">
            <Button type="button" variant="outline" onClick={seedTest}>Seed test data{selected ? ` into ${selected}` : ' (home-mesh)'}</Button>
            <Button type="button" variant="ghost" onClick={clearTest} disabled={!selected}>Clear test data</Button>
          </div>
          <Text as="p" variant="secondary" size="sm">Test data injects synthetic peers/events/traffic so the dashboard can be verified without a live relay client. Clear it before real-node validation.</Text>
          {lookupError && <Text as="p" variant="error" role="alert">{lookupError}</Text>}
          {rooms.length === 0
            ? <Empty title="No rooms observed yet" description="Connect EasyTier WebSocket clients via the Config tab, or look up a known room above." />
            : <div className="room-chips">
              {rooms.map((item) => (
                <Button key={item.roomId} type="button" variant={item.roomId === selected ? 'primary' : 'outline'} onClick={() => selectRoom(item.roomId)} aria-pressed={item.roomId === selected}>
                  {item.roomId} · {item.peerCount}p {item.active ? '' : '(stale)'}
                </Button>
              ))}
            </div>}
        </LayerCard.Primary>
      </LayerCard>

      {selected && !selectedListedRoom && <section className="notice text-kumo-subtle">Room <strong>{selected}</strong> is open from manual lookup but has not appeared in the directory yet. If all counters are empty, it may be unobserved or mistyped.</section>}

      <LayerCard>
        <LayerCard.Secondary>Devices {room ? <Badge variant="outline">{room.websocketCount} websockets</Badge> : null}</LayerCard.Secondary>
        <LayerCard.Primary>
          {room
            ? <PeerTable peers={room.peers} selectedSession={selectedSession} onSelect={setSelectedSession} />
            : <Empty title="No room selected" description="Choose or look up a room to list its devices." />}
        </LayerCard.Primary>
      </LayerCard>

      {selectedPeer && <PeerDetail peer={selectedPeer} />}

      <LayerCard>
        <LayerCard.Secondary>Relay token <Badge variant="outline">short lived</Badge></LayerCard.Secondary>
        <LayerCard.Primary>
          <div className="stack">
            <Text as="p" variant="secondary">Issue a room-scoped WSS URI for EasyTier clients that can only use a query-string token.</Text>
            <div><Button type="button" variant="outline" onClick={issueRelayToken} disabled={!selected}>Issue token for selected room</Button></div>
            {tokenError && <Text as="p" variant="error" role="alert">{tokenError}</Text>}
            {relayUri && <div className="token-output">
              <Text as="p" variant="secondary" size="sm">Room {relayUri.room}; expires {relayUri.expiresAt}. Treat this URI as a secret.</Text>
              <code>{relayUri.uri}</code>
            </div>}
          </div>
        </LayerCard.Primary>
      </LayerCard>
    </div>}

    {tab === 'topology' && <Topology topology={room?.topology} />}

    {tab === 'logs' && <LayerCard>
      <LayerCard.Secondary>Logs {room ? <Badge variant="outline">{room.roomId}</Badge> : null}</LayerCard.Secondary>
      <LayerCard.Primary>
        {room
          ? <Logs events={room.recentEvents} />
          : <Empty title="No room selected" description="Choose a room in Devices to view its relay logs." />}
      </LayerCard.Primary>
    </LayerCard>}

    {tab === 'config' && <ConfigGenerator />}
  </main>;
}
