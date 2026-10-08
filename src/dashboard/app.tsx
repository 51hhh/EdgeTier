import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Empty, Input, LayerCard, Tabs, Text } from '@cloudflare/kumo';
import { clearRoomSeed, createRoomRelayToken, getConfigProfiles, getDefaultRoom, getHosts, getOutboundTcpStatus, getRoom, getRoomEvents, getRoomTopology, getRoomTraffic, getRooms, logout, refreshHostDdns, seedRoom } from './api';
import { ROOM_NAME_PATTERN } from '../easytier/constants';
import type { DefaultRoomResponse, DirectoryRoomSummary, OutboundTcpStatus, RoomSnapshot } from '../observer/types';
import type { ConfigProfile, HostSnapshot } from '../observer/host-types';
import { DdnsDashboard, HostServices } from './components/Hosts';
import { Overview } from './components/Overview';
import { PeerDetail, PeerTable } from './components/Devices';
import { Logs } from './components/Logs';
import { ConfigGenerator } from './components/ConfigGenerator';
import { Topology } from './components/Topology';
import { createTranslator, detectLocale, persistLocale, type Locale } from './i18n';
import { mergeHostSnapshots, unavailableHostSnapshots, unavailableConfigProfiles } from './host-display';
import { createSelectionGuard, roomForSelection } from './room-state';
import './styles.css';

const TABS = [
  { value: 'overview', labelKey: 'tabs.overview' },
  { value: 'devices', labelKey: 'tabs.devices' },
  { value: 'topology', labelKey: 'tabs.topology' },
  { value: 'logs', labelKey: 'tabs.logs' },
  { value: 'ddns', labelKey: 'tabs.ddns' },
  { value: 'services', labelKey: 'tabs.services' },
  { value: 'config', labelKey: 'tabs.config' },
] as const;

export function App() {
  const [locale, setLocale] = useState<Locale>(() => detectLocale());
  const t = useMemo(() => createTranslator(locale), [locale]);
  const tabs = useMemo(() => TABS.map((item) => ({ value: item.value, label: t(item.labelKey) })), [t]);
  const [tab, setTab] = useState('overview');
  const [defaultRoom, setDefaultRoom] = useState<DefaultRoomResponse | null>(null);
  const [rooms, setRooms] = useState<DirectoryRoomSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [lookup, setLookup] = useState('');
  const [roomSnapshot, setRoom] = useState<RoomSnapshot | null>(null);
  const room = roomForSelection(roomSnapshot, selected);
  const roomRequests = useRef(createSelectionGuard());
  roomRequests.current.select(selected);
  const [outboundTcp, setOutboundTcp] = useState<OutboundTcpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [relayUri, setRelayUri] = useState<{ room: string; uri: string; expiresAt: string } | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [hosts, setHosts] = useState<HostSnapshot[]>([]);
  const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
  const [hostError, setHostError] = useState<string | null>(null);
  const [hostLoading, setHostLoading] = useState(true);
  const [hostNow, setHostNow] = useState(Date.now());
  const [requesting, setRequesting] = useState<Record<string, boolean>>({});
  const [refreshErrors, setRefreshErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    roomRequests.current.select(selected);
    return () => roomRequests.current.select(null);
  }, [selected]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let running = false;
    const tick = async () => {
      setHostNow(Date.now());
      if (running) return;
      running = true;
      try {
        const [hostResult, profileResult] = await Promise.allSettled([
          getHosts(controller.signal), getConfigProfiles(controller.signal),
        ]);
        if (cancelled) return;
        setHosts((previous) => hostResult.status === 'fulfilled' ? mergeHostSnapshots(previous, hostResult.value) : unavailableHostSnapshots(previous));
        setProfiles((previous) => profileResult.status === 'fulfilled' ? profileResult.value : unavailableConfigProfiles(previous));
        setHostError(hostResult.status === 'rejected' || profileResult.status === 'rejected' ? t('hosts.fetchError') : null);
        setHostLoading(false);
      } finally { running = false; }
    };
    void tick();
    const timer = setInterval(tick, 5000);
    return () => { cancelled = true; controller.abort(); clearInterval(timer); };
  }, [t]);

  const refreshDdns = async (hostId: string) => {
    setRequesting((current) => ({ ...current, [hostId]: true }));
    setRefreshErrors((current) => ({ ...current, [hostId]: '' }));
    try {
      const command = await refreshHostDdns(hostId);
      setHosts((current) => current.map((host) => host.profile.hostId === hostId ? { ...host, command } : host));
    } catch (err) {
      setRefreshErrors((current) => ({ ...current, [hostId]: `${t('ddns.refreshError')} ${err instanceof Error ? err.message : ''}` }));
    } finally { setRequesting((current) => ({ ...current, [hostId]: false })); }
  };

  useEffect(() => {
    let cancelled = false;
    getDefaultRoom()
      .then((value) => {
        if (cancelled) return;
        setDefaultRoom(value);
        setSelected((current) => current ?? value.roomId);
        setLookup((current) => current || value.roomId);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('errors.dashboardFetch'));
      });
    return () => { cancelled = true; };
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const list = await getRooms();
        let snapshot: RoomSnapshot | null = null;
        let tcpStatus: OutboundTcpStatus | null = null;
        if (selected) {
          const [roomSnapshot, events, traffic, topology, outbound] = await Promise.all([
            getRoom(selected),
            getRoomEvents(selected),
            getRoomTraffic(selected),
            getRoomTopology(selected),
            getOutboundTcpStatus(selected),
          ]);
          if (roomSnapshot.roomId !== selected || topology.roomId !== selected || outbound.roomId !== selected) throw new Error(t('errors.roomResponseMismatch'));
          snapshot = { ...roomSnapshot, recentEvents: events, traffic, topology };
          tcpStatus = outbound;
        }
        if (cancelled) return;
        setRooms(list);
        if (selected) setRoom(snapshot);
        setOutboundTcp(tcpStatus);
        setError(null);
        setLastRefreshed(new Date().toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US'));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('errors.dashboardFetch'));
      } finally { running = false; }
    };
    void tick();
    const timer = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [locale, selected, t]);

  const selectRoom = (roomId: string) => {
    roomRequests.current.select(roomId);
    setSelected(roomId);
    if (roomId !== selected) {
      setRoom(null);
      setRelayUri(null);
      setTokenError(null);
      setError(null);
    }
    setLookup(roomId);
    setLookupError(null);
    setSelectedSession(null);
    setOutboundTcp(null);
  };

  const submitLookup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const roomId = lookup.trim();
    if (!ROOM_NAME_PATTERN.test(roomId)) {
      setLookupError(t('errors.lookupRoom'));
      return;
    }
    selectRoom(roomId);
  };

  const issueRelayToken = async () => {
    if (!selected) {
      setTokenError(t('errors.tokenChooseRoom'));
      return;
    }
    const ticket = roomRequests.current.capture();
    try {
      const token = await createRoomRelayToken(selected);
      if (!roomRequests.current.isCurrent(ticket)) return;
      if (token.room !== ticket.selection) throw new Error(t('errors.roomResponseMismatch'));
      setRelayUri({ room: token.room, uri: `${window.location.origin.replace(/^http/, 'ws')}${token.uriPath}`, expiresAt: token.expiresAt });
      setTokenError(null);
    } catch (err) {
      if (roomRequests.current.isCurrent(ticket)) setTokenError(err instanceof Error ? err.message : t('errors.issueToken'));
    }
  };

  const seedTest = async () => {
    const target = selected ?? defaultRoom?.roomId ?? 'default';
    try {
      await seedRoom(target, 6);
      if (!selected) selectRoom(target);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.seed'));
    }
  };

  const clearTest = async () => {
    if (!selected) return;
    try {
      await clearRoomSeed(selected);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.clearSeed'));
    }
  };

  const signOut = async () => {
    await logout();
    window.location.href = '/login';
  };

  const changeLocale = (next: Locale) => {
    setLocale(next);
    persistLocale(next);
  };

  const selectedListedRoom = selected ? rooms.find((item) => item.roomId === selected) : undefined;
  const defaultRoomId = defaultRoom?.roomId ?? 'default';
  const defaultNetworkName = defaultRoom?.networkName ?? defaultRoomId;
  const selectedPeer = useMemo(
    () => (room && selectedSession ? [...room.peers, ...(room.testData?.peers ?? [])].find((peer) => peer.sessionId === selectedSession) : undefined),
    [room, selectedSession],
  );

  return <main className="shell bg-kumo-canvas text-kumo-default">
    <header className="hero">
      <div className="hero-row">
        <div>
          <Text as="p" variant="secondary" size="sm">{t('app.subtitle')}</Text>
          <Text as="h1" variant="heading1">EdgeTier</Text>
        </div>
        <div className="header-actions" aria-label={t('app.language')}>
          <Button type="button" variant={locale === 'zh' ? 'primary' : 'outline'} onClick={() => changeLocale('zh')} aria-pressed={locale === 'zh'}>{t('app.language.zh')}</Button>
          <Button type="button" variant={locale === 'en' ? 'primary' : 'outline'} onClick={() => changeLocale('en')} aria-pressed={locale === 'en'}>{t('app.language.en')}</Button>
          <Button type="button" variant="ghost" onClick={signOut}>{t('app.signOut')}</Button>
        </div>
      </div>
      <div className="dashboard-tabs"><Tabs variant="underline" tabs={tabs} value={tab} onValueChange={setTab} /></div>
      <div className="hero-meta">
        <Badge variant="outline">{lastRefreshed ? t('app.lastRefreshed', { time: lastRefreshed }) : t('app.loading')}</Badge>
        <Badge variant={selected ? 'primary' : 'secondary'}>{selected ? t('app.room', { room: selected }) : t('app.noRoom')}</Badge>
        <Badge variant="outline">{defaultNetworkName}</Badge>
      </div>
    </header>

    {error && <section className="error-banner text-kumo-danger" role="alert">{error}. {t('app.errorSuffix')}</section>}

    {tab === 'overview' && <Overview rooms={rooms} room={room} outboundTcp={outboundTcp} t={t} />}

    {tab === 'devices' && <div className="stack">
      <LayerCard>
        <LayerCard.Secondary>{t('devices.rooms')} <Badge variant="outline">{t('devices.directory')}</Badge></LayerCard.Secondary>
        <LayerCard.Primary>
          <form className="lookup" onSubmit={submitLookup}>
            <Input label={t('devices.inspectRoom')} value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder={defaultRoomId} variant={lookupError ? 'error' : 'default'} />
            <Button type="submit" variant="primary">{t('devices.openRoom')}</Button>
          </form>
          <div className="switch-row">
            <Button type="button" variant="outline" onClick={seedTest}>{selected ? t('devices.seedInto', { room: selected }) : t('devices.seedDefault', { room: defaultRoomId })}</Button>
            <Button type="button" variant="ghost" onClick={clearTest} disabled={!selected}>{t('devices.clearSeed')}</Button>
          </div>
          <Text as="p" variant="secondary" size="sm">{t('devices.seedHelp')}</Text>
          {lookupError && <Text as="p" variant="error" role="alert">{lookupError}</Text>}
          {rooms.length === 0
            ? <Empty title={t('devices.noRoomsTitle')} description={t('devices.noRoomsDescription')} />
            : <div className="room-chips">
              {rooms.map((item) => (
                <Button key={item.roomId} type="button" variant={item.roomId === selected ? 'primary' : 'outline'} onClick={() => selectRoom(item.roomId)} aria-pressed={item.roomId === selected}>
                  {item.roomId} · {item.peerCount}p {item.active ? '' : `(${t('common.stale')})`}
                </Button>
              ))}
            </div>}
        </LayerCard.Primary>
      </LayerCard>

      {selected && !selectedListedRoom && <section className="notice text-kumo-subtle">{t('devices.manualRoom', { room: selected })}</section>}

      {room?.testData && <LayerCard>
        <LayerCard.Secondary>{t('devices.testPreview')} <Badge variant="outline">{t('devices.synthetic')}</Badge></LayerCard.Secondary>
        <LayerCard.Primary><div className="stack">
          <Text as="p" variant="secondary">{t('devices.previewHelp')}</Text>
          <PeerTable peers={room.testData.peers} selectedSession={selectedSession} onSelect={setSelectedSession} t={t} />
          <Text as="p" variant="secondary">{t('common.rx')}: {room.testData.traffic.rxBytes} B · {t('common.tx')}: {room.testData.traffic.txBytes} B</Text>
          <Logs events={room.testData.events} t={t} />
        </div></LayerCard.Primary>
      </LayerCard>}

      <LayerCard>
        <LayerCard.Secondary>{t('devices.title')} {room ? <Badge variant="outline">{room.websocketCount} {t('common.websockets')}</Badge> : null}</LayerCard.Secondary>
        <LayerCard.Primary>
          {room
            ? <PeerTable peers={room.peers} selectedSession={selectedSession} onSelect={setSelectedSession} t={t} />
            : <Empty title={t('devices.noRoomTitle')} description={t('devices.noRoomDescription')} />}
        </LayerCard.Primary>
      </LayerCard>

      {selectedPeer && <PeerDetail peer={selectedPeer} t={t} />}

      <LayerCard>
        <LayerCard.Secondary>{t('devices.relayToken')} <Badge variant="outline">{t('devices.shortLived')}</Badge></LayerCard.Secondary>
        <LayerCard.Primary>
          <div className="stack">
            <Text as="p" variant="secondary">{t('devices.tokenHelp')}</Text>
            <div><Button type="button" variant="outline" onClick={issueRelayToken} disabled={!selected}>{t('devices.issueToken')}</Button></div>
            {tokenError && <Text as="p" variant="error" role="alert">{tokenError}</Text>}
            {relayUri && <div className="token-output">
              <Text as="p" variant="secondary" size="sm">{t('devices.tokenMeta', { room: relayUri.room, expiresAt: relayUri.expiresAt })}</Text>
              <code>{relayUri.uri}</code>
            </div>}
          </div>
        </LayerCard.Primary>
      </LayerCard>
    </div>}

    {tab === 'topology' && <Topology topology={room?.topology} t={t} />}

    {tab === 'logs' && <LayerCard>
      <LayerCard.Secondary>{t('logs.title')} {room ? <Badge variant="outline">{room.roomId}</Badge> : null}</LayerCard.Secondary>
      <LayerCard.Primary>
        {room
          ? <Logs events={room.recentEvents} t={t} />
          : <Empty title={t('devices.noRoomTitle')} description={t('logs.noRoomDescription')} />}
      </LayerCard.Primary>
    </LayerCard>}

    {['ddns', 'services', 'config'].includes(tab) && hostError && <section className="error-banner text-kumo-danger" role="alert">{hostError}</section>}
    {['ddns', 'services', 'config'].includes(tab) && hostLoading && <Text as="p" variant="secondary" role="status">{t('app.loading')}</Text>}
    {tab === 'ddns' && !hostLoading && <DdnsDashboard hosts={hosts} now={hostNow} t={t} requesting={requesting} refreshErrors={refreshErrors} onRefresh={refreshDdns} />}
    {tab === 'services' && !hostLoading && <HostServices hosts={hosts} now={hostNow} t={t} />}
    {tab === 'config' && !hostLoading && <ConfigGenerator profiles={profiles} t={t} />}
  </main>;
}
