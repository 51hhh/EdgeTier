import { afterEach, describe, expect, it, vi } from 'vitest';
import { EDGE_PEER_ID, EASYTIER_HEADER_SIZE, EasyTierPacketType, MAX_FRAME_SIZE } from '../easytier/constants';
import { createEasyTierFrame, parseEasyTierHeader } from '../easytier/packet';
import { buildHandshakeRequest, encodeHandshake } from '../easytier/handshake';
import { buildRpcRequestPayloads, decodeEasyTierRpcPacket, decodeRpcPacket, encodeSyncRouteInfoRequest, RpcPacketMerger, type PeerCenterGlobalMap, type RoutePeerInfo, type RpcPacket, type SyncRouteInfoRequest } from '../easytier/rpc';
import { AEAD_TAIL_SIZE, decryptAesGcm, deriveKeys, type DerivedKeys } from '../easytier/crypto';
import type { PeerSnapshot, RelayEvent, RoomSnapshot, TopologyEdge, TrafficSnapshot } from '../observer/types';
import type { Env } from '../worker/env';
import { applyOspfRouteSessionResponse, MAX_PENDING_ROUTE_SYNCS, RELAY_QUEUE_LIMITS, RelayRoom, ROUTE_SYNC_TIMEOUT_MS, type OspfRouteSessionState } from './relay-room';

type FixtureSession = PeerSnapshot & {
  transportKind: 'websocket' | 'tcp-outbound'; handshakeAccepted: boolean; invalidPackets: number;
  messageQueue: Promise<void>; writeQueue: Promise<void>; rpcMergers: Map<string, RpcPacketMerger>;
  sendRawFrame: (frame: Uint8Array) => void | Promise<void>; closeTransport: () => void;
  isTransportOpen: () => boolean; lastPingSent: number; lastPongReceived: number;
  queuedReadFrames?: number; queuedReadBytes?: number; queuedWriteFrames?: number; queuedWriteBytes?: number;
  ospfRouteSession?: OspfRouteSessionState; retired?: boolean;
  keys?: DerivedKeys;
};

// The harness exposes private methods only to run lifecycle regressions with actual class behavior.
interface RoomHarness {
  events: RelayEvent[];
  sessions: Map<string, FixtureSession>; peers: Map<number, string>;
  peerCenter: Map<number, { directPeers: Map<number, { latencyMs: number }>; lastSeen: string }>;
  rawRoutePeerInfos: Map<number, RoutePeerInfo>; connBitmapEdges: TopologyEdge[];
  traffic: Omit<TrafficSnapshot, 'samples' | 'summary'>;
  queuedReadFrames: number; queuedReadBytes: number; queuedWriteFrames: number; queuedWriteBytes: number;
  queueDirectorySync: () => void; queueControlStatePersist: () => void; requestRouteInfoResyncIfNeeded: () => void;
  connectOutboundTcp: (roomId: string, peer: unknown) => Promise<void>;
  createOutboundTcpSession: (roomId: string, uri: string, socket: Socket, writer: WritableStreamDefaultWriter<Uint8Array>) => FixtureSession;
  readOutboundTcp: (session: FixtureSession, reader: ReadableStreamDefaultReader<Uint8Array>) => Promise<void>;
  closeSessionTransport: (session: FixtureSession) => void;
  bootstrapControlPlane: (session: FixtureSession, peerId: number) => Promise<void>;
  bindPeer: (session: FixtureSession, peerId: number) => void;
  disconnect: (session: FixtureSession) => void;
  onEasyTierFrame: (session: FixtureSession, frame: ArrayBuffer) => Promise<void>;
  onMessage: (session: FixtureSession, event: MessageEvent) => Promise<void>;
  enqueueMessage: (session: FixtureSession, event: MessageEvent) => void;
  applySyncRouteInfo: (session: FixtureSession, req: SyncRouteInfoRequest) => boolean;
  buildSyncRouteInfoRequest: (session: FixtureSession, targetPeerId: number, force?: boolean) => SyncRouteInfoRequest;
  buildPeerCenterGlobalMap: () => PeerCenterGlobalMap;
  applyPeerCenterGlobalMap: (session: FixtureSession, map: PeerCenterGlobalMap) => void;
  persistControlState: () => Promise<void>;
  pushRouteUpdateTo: (session: FixtureSession, peerId: number, descriptor: undefined, force?: boolean) => Promise<void>;
  sendRpcRequest: (session: FixtureSession, peerId: number, descriptor: undefined, body: Uint8Array, transactionId?: bigint) => Promise<bigint>;
  runHeartbeatMaintenance: (now?: number) => void;
  mergeRpcPacket: (session: FixtureSession, header: NonNullable<ReturnType<typeof parseEasyTierHeader>>, packet: RpcPacket) => RpcPacket | undefined;
}

describe('isolated test previews', () => {
  it('rejects malformed previews before changing existing preview state', async () => {
    const { room } = await fixture({ name: 'alpha' });
    const seed = (body: unknown) => room.fetch(new Request('https://room/test-seed?room=alpha', { method: 'POST', body: JSON.stringify(body) }));
    await seed({ count: 2 });
    for (const body of [null, [], { count: '3' }, { count: 2.5 }, { count: 17 }, { clear: 'yes' }]) {
      expect((await seed(body)).status).toBe(400);
      const snapshot = await (await room.fetch(new Request('https://room/?room=alpha'))).json() as RoomSnapshot;
      expect(snapshot.testData?.peers).toHaveLength(2);
    }
  });
  it.each([false, true])('clears only preview state with synthetic data present: %s', async (seedFirst) => {
    const { room, relay, saved } = await fixture({ name: 'alpha' });
    const live = session(relay, 'real', 11);
    relay.events.push({ id: 'real-event', roomId: 'alpha', timestamp: new Date().toISOString(), type: 'connected', message: 'real connection' });
    relay.traffic.rxBytes = 4096;
    relay.traffic.txBytes = 2048;
    relay.peerCenter.set(11, { directPeers: new Map([[22, { latencyMs: 1 }]]), lastSeen: new Date().toISOString() });
    await relay.persistControlState();
    const persisted = structuredClone(saved.get('control-state:v1'));
    const read = async () => await (await room.fetch(new Request('https://room/?room=alpha'))).json() as RoomSnapshot;
    const before = await read();
    const seed = (body: unknown) => room.fetch(new Request('https://room/test-seed?room=alpha', { method: 'POST', body: JSON.stringify(body) }));
    if (seedFirst) {
      expect((await seed({ count: 3 })).status).toBe(200);
      const preview = await read();
      expect(preview.testData?.peers).toHaveLength(3);
      expect(preview.testData?.traffic.rxBytes).toBeGreaterThan(0);
      expect(preview.testData?.events.every((event) => event.message.startsWith('[synthetic]'))).toBe(true);
      expect(preview.peerCount).toBe(before.peerCount);
      expect(preview.websocketCount).toBe(before.websocketCount);
      expect(preview.bytes).toBe(before.bytes);
      await seed({ count: 2 });
      expect((await read()).testData?.peers).toHaveLength(2);
    }
    await seed({ clear: true });
    const after = await read();
    expect(after.testData).toBeUndefined();
    expect(after.peers).toEqual(before.peers);
    expect(after.recentEvents).toEqual(before.recentEvents);
    expect(after.traffic).toEqual(before.traffic);
    expect(after.topology).toEqual(before.topology);
    expect(relay.peerCenter.has(11)).toBe(true);
    expect(relay.sessions.get('real')).toBe(live.value);
    expect(saved.get('control-state:v1')).toEqual(persisted);
    expect(relay.queueControlStatePersist).not.toHaveBeenCalled();
  });
});

async function fixture(options: { env?: Partial<Env>; name?: string; stored?: unknown; put?: (key: string, value: unknown) => Promise<void> } = {}) {
  const saved = new Map<string, unknown>();
  if (options.stored) saved.set('control-state:v1', structuredClone(options.stored));
  let ready = Promise.resolve();
  const state = {
    id: { name: options.name },
    storage: { get: async (key: string) => structuredClone(saved.get(key)), put: async (key: string, value: unknown) => { await options.put?.(key, value); saved.set(key, structuredClone(value)); }, getAlarm: async () => Date.now() + 10_000, setAlarm: async () => {} },
    blockConcurrencyWhile: (callback: () => Promise<void>) => { ready = callback(); return ready; },
    waitUntil: (promise: Promise<unknown>) => { void promise.catch(() => undefined); },
  } as unknown as DurableObjectState;
  const env = { ...options.env, DIRECTORY: { idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({ ok: true }) }) } } as unknown as Env;
  const room = new RelayRoom(state, env);
  const relay = room as unknown as RoomHarness;
  await ready;
  relay.queueDirectorySync = vi.fn(); relay.queueControlStatePersist = vi.fn(); relay.requestRouteInfoResyncIfNeeded = vi.fn();
  relay.connectOutboundTcp = vi.fn(async () => {});
  return { room, relay, saved };
}

function session(relay: RoomHarness, id: string, peerId?: number, roomId = 'alpha', accepted = true) {
  let open = true;
  const sent: Uint8Array[] = [];
  const value: FixtureSession = {
    sessionId: id, roomId, connected: true, connectedAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
    rxBytes: 0, txBytes: 0, rxPackets: 0, txPackets: 0, transportKind: 'websocket', handshakeAccepted: accepted,
    invalidPackets: 0, messageQueue: Promise.resolve(), writeQueue: Promise.resolve(), rpcMergers: new Map(),
    sendRawFrame: (frame) => { sent.push(frame); }, closeTransport: () => { open = false; }, isTransportOpen: () => open,
    lastPingSent: 0, lastPongReceived: Date.now(),
  };
  relay.sessions.set(id, value);
  if (peerId !== undefined) relay.bindPeer(value, peerId);
  return { value, sent };
}

function frame(fromPeerId: number, toPeerId: number, packetType: number = EasyTierPacketType.Data, payload: Uint8Array = new Uint8Array([1, 2, 3])) {
  return createEasyTierFrame({ fromPeerId, toPeerId, packetType, flags: 0, reserved: 0, forwardCounter: 0 }, payload).buffer;
}

const networks = {
  EASYTIER_NETWORKS: JSON.stringify({ alpha: { networkName: 'mesh-a', secret: 'fixture-a' }, beta: { networkName: 'mesh-b', secret: 'fixture-b' } }),
  EASYTIER_OUTBOUND_TCP_PEERS: JSON.stringify({ alpha: 'tcp://a.example:11010', beta: 'tcp://b.example:11010' }),
};
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('RelayRoom room ownership', () => {
  it('dials the implicit gateway only in the default object and closes a stale alias TCP session', async () => {
    const env = { EASYTIER_NETWORK_NAME: 'home-mesh', EASYTIER_NETWORK_SECRET: 'fixture-secret', EASYTIER_PUBLIC_PEER_TCP: 'tcp://gateway.example:11010' };
    const home = await fixture({ name: 'home-mesh', env }), alias = await fixture({ name: 'alias-room', env });
    home.relay.runHeartbeatMaintenance = vi.fn(); alias.relay.runHeartbeatMaintenance = vi.fn();
    const client = session(home.relay, 'client', 11, 'home-mesh'), gateway = session(home.relay, 'gateway', 22, 'home-mesh');
    let resolveClosed = () => {};
    const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
    const close = vi.fn(async () => { resolveClosed(); });
    const writer = new WritableStream<Uint8Array>().getWriter(); const abort = vi.spyOn(writer, 'abort');
    const stale = alias.relay.createOutboundTcpSession('alias-room', env.EASYTIER_PUBLIC_PEER_TCP, { closed, close } as unknown as Socket, writer);
    stale.handshakeAccepted = true; alias.relay.sessions.set(stale.sessionId, stale); alias.relay.bindPeer(stale, 22);
    // Requests reach the gateway in home; an alias return path cannot find home's WSS client.
    await home.relay.onEasyTierFrame(client.value, frame(11, 22)); await gateway.value.writeQueue;
    await alias.relay.onEasyTierFrame(stale, frame(22, 11));
    expect(gateway.sent).toHaveLength(1); expect(alias.relay.traffic.unroutablePackets).toBe(1);
    await Promise.all([home.room.alarm(), alias.room.alarm()]); await Promise.resolve();
    expect(vi.mocked(home.relay.connectOutboundTcp).mock.calls.map(([room]) => room)).toEqual(['home-mesh']);
    expect(alias.relay.connectOutboundTcp).not.toHaveBeenCalled(); expect(alias.relay.sessions.has(stale.sessionId)).toBe(false);
    expect(close).toHaveBeenCalledOnce(); expect(abort).toHaveBeenCalledOnce();
    // The surviving default gateway path can return data to that same client.
    await home.relay.onEasyTierFrame(gateway.value, frame(22, 11)); await client.value.writeQueue;
    expect(client.sent).toHaveLength(1);
  });

  it('dials only its named owner on cold start, ignoring polluted legacy room lists', async () => {
    for (const name of ['alpha', 'beta']) {
      const { room, relay } = await fixture({ name, env: networks, stored: { routeVersion: 1, routePeers: [], rawRoutePeerInfos: [], connBitmapEdges: [], peerCenter: [], outboundRoomIds: ['alpha', 'beta'] } });
      await room.alarm();
      expect(vi.mocked(relay.connectOutboundTcp).mock.calls.map(([id]) => id)).toEqual([name]);
      expect((await room.fetch(new Request(`https://room/?room=${name === 'alpha' ? 'beta' : 'alpha'}`))).status).toBe(409);
    }
  });

  it('claims an unnamed legacy object only from a valid request, and persists the owner for restart', async () => {
    const { room, relay, saved } = await fixture({ env: networks, stored: { routeVersion: 1, routePeers: [], rawRoutePeerInfos: [], connBitmapEdges: [], peerCenter: [], outboundRoomIds: ['alpha', 'beta'] } });
    await room.alarm(); expect(relay.connectOutboundTcp).not.toHaveBeenCalled();
    expect((await room.fetch(new Request('https://room/?room=../invalid'))).status).toBe(400);
    expect((await room.fetch(new Request('https://room/?room=beta'))).status).toBe(200);
    const restarted = await fixture({ env: networks, stored: saved.get('control-state:v1') });
    await restarted.room.alarm();
    expect(vi.mocked(restarted.relay.connectOutboundTcp).mock.calls.map(([id]) => id)).toEqual(['beta']);
  });

  it('rejects forwarding across room identities even if a foreign fixture session is inserted', async () => {
    const { relay } = await fixture({ name: 'alpha' });
    const a = session(relay, 'alpha', 11), b = session(relay, 'beta', 22, 'beta');
    await relay.onEasyTierFrame(a.value, frame(11, 22)); await b.value.writeQueue;
    expect(b.sent).toHaveLength(0); expect(relay.traffic.unroutablePackets).toBe(1);
  });
});

describe('RelayRoom overlapping transports and admission', () => {
  it.each(['old', 'new'])('keeps the surviving accepted transport when %s closes', async (closing) => {
    const { relay } = await fixture({ name: 'alpha' });
    const old = session(relay, 'old', 11), newer = session(relay, 'new', 11), other = session(relay, 'other', 22);
    relay.peerCenter.set(11, { directPeers: new Map([[22, { latencyMs: 1 }]]), lastSeen: new Date().toISOString() });
    relay.disconnect(closing === 'old' ? old.value : newer.value);
    const survivor = closing === 'old' ? newer : old;
    expect(relay.peers.get(11)).toBe(survivor.value.sessionId); expect(relay.peerCenter.has(11)).toBe(true);
    await relay.onEasyTierFrame(other.value, frame(22, 11)); await survivor.value.writeQueue;
    await relay.onEasyTierFrame(survivor.value, frame(11, 22)); await other.value.writeQueue;
    expect(survivor.sent).toHaveLength(1); expect(other.sent).toHaveLength(1);
  });

  it('does not bind or forward before a configured-network handshake succeeds', async () => {
    const { relay } = await fixture({ name: 'alpha', env: networks });
    const existing = session(relay, 'existing', 11), target = session(relay, 'target', 22), pending = session(relay, 'pending', undefined, 'alpha', false);
    await relay.onEasyTierFrame(pending.value, frame(11, 22));
    expect(relay.peers.get(11)).toBe(existing.value.sessionId); expect(pending.value.peerId).toBeUndefined(); expect(target.sent).toHaveLength(0);
    const bad = { ...buildHandshakeRequest('mesh-a', 'wrong-secret'), myPeerId: 11 };
    await relay.onEasyTierFrame(pending.value, frame(11, 0, EasyTierPacketType.HandShake, encodeHandshake(bad)));
    expect(relay.peers.get(11)).toBe(existing.value.sessionId); expect(relay.sessions.has('pending')).toBe(false);
  });

  it('binds a matching handshake and forwards data afterward', async () => {
    const { relay } = await fixture({ name: 'alpha', env: networks });
    relay.bootstrapControlPlane = vi.fn(async () => {});
    const pending = session(relay, 'pending', undefined, 'alpha', false), target = session(relay, 'target', 22);
    const handshake = { ...buildHandshakeRequest('mesh-a', 'fixture-a'), myPeerId: 11 };
    await relay.onEasyTierFrame(pending.value, frame(11, 0, EasyTierPacketType.HandShake, encodeHandshake(handshake)));
    await pending.value.writeQueue;
    expect(pending.value.handshakeAccepted).toBe(true); expect(relay.peers.get(11)).toBe('pending');
    expect(pending.sent).toHaveLength(1); expect(relay.bootstrapControlPlane).toHaveBeenCalledOnce();
    await relay.onEasyTierFrame(pending.value, frame(11, 22)); await target.value.writeQueue;
    expect(target.sent).toHaveLength(1);
  });
});

describe('RelayRoom route owner versions', () => {
  it('merges monotonic metadata and connection rows, persists their versions, and preserves partial rows', async () => {
    const { relay, saved } = await fixture({ name: 'alpha' });
    const source = session(relay, 'source', 99);
    const peer = (version: number, hostname: string): RoutePeerInfo => ({ peerId: 33, proxyCidrs: ['10.0.0.0/24'], version, hostname });
    const rows = (versions: Array<[number, number, number[]]>) => ({ peerConnInfos: versions.map(([peerId, version, connectedPeerIds]) => ({ peerId: { peerId, version }, connectedPeerIds })) });
    relay.applySyncRouteInfo(source.value, { myPeerId: 99, peerInfos: [peer(10, 'current')], connPeerList: rows([[11, 10, [22]], [22, 10, [11]]]) });
    relay.applySyncRouteInfo(source.value, { myPeerId: 99, peerInfos: [peer(9, 'older')], connPeerList: rows([[11, 9, []]]) });
    expect(relay.rawRoutePeerInfos.get(33)?.hostname).toBe('current');
    expect(relay.connBitmapEdges.map((edge) => [edge.fromPeerId, edge.toPeerId])).toEqual([[11, 22], [22, 11]]);
    relay.applySyncRouteInfo(source.value, { myPeerId: 99, peerInfos: [], connBitmap: { peerIds: [{ peerId: 11, version: 11 }, { peerId: 22, version: 0 }], bitmap: new Uint8Array([0]) } });
    expect(relay.connBitmapEdges.map((edge) => [edge.fromPeerId, edge.toPeerId])).toEqual([[22, 11]]);
    const outgoing = relay.buildSyncRouteInfoRequest(source.value, 99, true);
    expect(outgoing.connBitmap?.peerIds.find((row) => row.peerId === 11)?.version).toBe(11);
    expect(outgoing.connBitmap?.peerIds.find((row) => row.peerId === 22)?.version).toBe(10);
    expect(outgoing.peerInfos.find((info) => info.peerId === 33)?.version).toBe(10);
    await relay.persistControlState();
    const restarted = await fixture({ name: 'alpha', stored: saved.get('control-state:v1') });
    const reconnected = session(restarted.relay, 'reconnected', 99);
    const afterRestart = restarted.relay.buildSyncRouteInfoRequest(reconnected.value, 99, true);
    expect(afterRestart.connBitmap?.peerIds.find((row) => row.peerId === 11)?.version).toBe(11);
    expect(afterRestart.connBitmap?.peerIds.find((row) => row.peerId === 22)?.version).toBe(10);
    expect(restarted.relay.connBitmapEdges.map((edge) => [edge.fromPeerId, edge.toPeerId])).toEqual([[22, 11]]);
  });

  it('retains legacy observer edges as version zero until a genuine owner update arrives', async () => {
    const { relay } = await fixture({ name: 'alpha', stored: { roomId: 'alpha', routeVersion: 123, topologyUpdatedAt: new Date().toISOString(), routePeers: [], rawRoutePeerInfos: [], connBitmapPeerIds: [11, 22], connBitmapEdges: [{ fromPeerId: 11, toPeerId: 22, source: 'conn_bitmap' }], peerCenter: [] } });
    const source = session(relay, 'source', 11);
    const outgoing = relay.buildSyncRouteInfoRequest(source.value, 11, true);
    expect(outgoing.connBitmap?.peerIds.find((row) => row.peerId === 11)?.version).toBe(0);
    expect(relay.connBitmapEdges).toHaveLength(1);
    relay.applySyncRouteInfo(source.value, { myPeerId: 11, peerInfos: [], connPeerList: { peerConnInfos: [{ peerId: { peerId: 11, version: 1 }, connectedPeerIds: [] }] } });
    expect(relay.connBitmapEdges).toHaveLength(0);
  });
});

describe('RelayRoom bounded queues', () => {
  it('retires the actual TCP writer adapter and releases failed and cancelled frames', async () => {
    const { relay } = await fixture({ name: 'alpha' });
    const source = session(relay, 'source', 11);
    let resolveClosed = () => {}, rejectWrite = (_error: Error) => {};
    const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
    const blocked = new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
    const writes: Uint8Array[] = [];
    const writer = new WritableStream<Uint8Array>({ write: (chunk) => { writes.push(chunk); return blocked; } }).getWriter();
    const abort = vi.spyOn(writer, 'abort');
    const close = vi.fn(async () => { rejectWrite(new Error('fixture socket closed')); resolveClosed(); });
    const socket = { closed, close } as unknown as Socket;
    const tcp = relay.createOutboundTcpSession('alpha', 'tcp://fixture.example:11010', socket, writer);
    tcp.handshakeAccepted = true; relay.sessions.set(tcp.sessionId, tcp); relay.bindPeer(tcp, 22);
    const data = frame(11, 22, EasyTierPacketType.Data, new Uint8Array(1384));
    await relay.onEasyTierFrame(source.value, data); await Promise.resolve();
    const queued: Promise<void>[] = [];
    for (let i = 1; i <= RELAY_QUEUE_LIMITS.sessionFrames; i++) queued.push(relay.onEasyTierFrame(source.value, data));
    expect(tcp.queuedWriteFrames).toBe(RELAY_QUEUE_LIMITS.sessionFrames); expect(relay.sessions.has(tcp.sessionId)).toBe(false);
    await Promise.all(queued); await tcp.writeQueue;
    expect(close).toHaveBeenCalledOnce(); expect(abort).toHaveBeenCalledOnce(); expect(writes).toHaveLength(1);
    expect(new DataView(writes[0].buffer, writes[0].byteOffset).getUint32(0, true)).toBe(1400);
    expect(relay.queuedWriteBytes).toBe(0); expect(relay.queuedWriteFrames).toBe(0);
    expect(relay.traffic.forwardedPackets).toBe(0); expect(relay.traffic.unroutablePackets).toBe(RELAY_QUEUE_LIMITS.sessionFrames + 1);
  });

  it('enforces the byte budget independently of the frame budget', async () => {
    const { relay } = await fixture({ name: 'alpha' });
    const source = session(relay, 'source', 11), slow = session(relay, 'slow', 22);
    let release = () => {};
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    slow.value.sendRawFrame = async () => blocked;
    const large = frame(11, 22, EasyTierPacketType.Data, new Uint8Array(MAX_FRAME_SIZE - EASYTIER_HEADER_SIZE));
    await relay.onEasyTierFrame(source.value, large); await relay.onEasyTierFrame(source.value, large);
    await relay.onEasyTierFrame(source.value, large);
    expect(slow.value.queuedWriteBytes).toBe(RELAY_QUEUE_LIMITS.sessionBytes); expect(slow.value.queuedWriteFrames).toBe(2);
    expect(relay.sessions.has('slow')).toBe(false);
    release(); await slow.value.writeQueue; expect(relay.queuedWriteBytes).toBe(0);
  });

  it('bounds aggregate room bytes across multiple stalled destinations', async () => {
    const { relay } = await fixture({ name: 'alpha' });
    const source = session(relay, 'source', 11);
    const targets = [22, 33, 44, 55, 66].map((id) => session(relay, String(id), id));
    let release = () => {};
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    for (const target of targets) target.value.sendRawFrame = async () => blocked;
    const payload = new Uint8Array(MAX_FRAME_SIZE - EASYTIER_HEADER_SIZE);
    for (const target of targets.slice(0, 4)) {
      await relay.onEasyTierFrame(source.value, frame(11, target.value.peerId!, EasyTierPacketType.Data, payload));
      await relay.onEasyTierFrame(source.value, frame(11, target.value.peerId!, EasyTierPacketType.Data, payload));
    }
    await relay.onEasyTierFrame(source.value, frame(11, 66, EasyTierPacketType.Data, payload));
    expect(relay.queuedWriteBytes).toBe(RELAY_QUEUE_LIMITS.roomBytes); expect(relay.sessions.has('66')).toBe(true);
    release(); await Promise.all(targets.map((target) => target.value.writeQueue));
    expect(relay.queuedWriteBytes).toBe(0); expect(relay.queuedWriteFrames).toBe(0);
    await relay.onEasyTierFrame(source.value, frame(11, 66)); await targets[4].value.writeQueue;
    expect(relay.sessions.has('66')).toBe(true); expect(targets[4].value.txPackets).toBe(1);
  });

  it('bounds a stalled writer, counts only completed forwarding, and lets another peer work', async () => {
    const { relay } = await fixture({ name: 'alpha' });
    const source = session(relay, 'source', 11), slow = session(relay, 'slow', 22), healthy = session(relay, 'healthy', 33);
    let release = () => {};
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const send = vi.fn(async () => blocked); slow.value.sendRawFrame = send;
    await relay.onEasyTierFrame(source.value, frame(11, 22)); await Promise.resolve();
    for (let i = 1; i <= RELAY_QUEUE_LIMITS.sessionFrames; i++) await relay.onEasyTierFrame(source.value, frame(11, 22));
    expect(slow.value.queuedWriteFrames).toBe(RELAY_QUEUE_LIMITS.sessionFrames); expect(send).toHaveBeenCalledTimes(1);
    expect(relay.sessions.has('slow')).toBe(false); expect(relay.traffic.forwardedPackets).toBe(0);
    await relay.onEasyTierFrame(source.value, frame(11, 33)); await healthy.value.writeQueue;
    expect(healthy.sent).toHaveLength(1);
    release(); await slow.value.writeQueue;
    expect(send).toHaveBeenCalledTimes(1); expect(relay.queuedWriteBytes).toBe(0); expect(relay.queuedWriteFrames).toBe(0);
    expect(relay.traffic.forwardedPackets).toBe(2); expect(relay.traffic.unroutablePackets).toBe(RELAY_QUEUE_LIMITS.sessionFrames);
  });

  it('bounds retained inbound events and releases accounting after retirement', async () => {
    const { relay } = await fixture({ name: 'alpha' });
    const incoming = session(relay, 'incoming', 11);
    let release = () => {};
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    relay.onMessage = vi.fn(async () => blocked);
    const event = { data: frame(11, 0) } as MessageEvent;
    relay.enqueueMessage(incoming.value, event); await Promise.resolve();
    for (let i = 1; i <= RELAY_QUEUE_LIMITS.sessionFrames; i++) relay.enqueueMessage(incoming.value, event);
    expect(relay.queuedReadFrames).toBe(RELAY_QUEUE_LIMITS.sessionFrames); expect(relay.sessions.has('incoming')).toBe(false);
    release(); await incoming.value.messageQueue;
    expect(relay.onMessage).toHaveBeenCalledTimes(1); expect(relay.queuedReadBytes).toBe(0); expect(relay.queuedReadFrames).toBe(0);
  });
});

describe('RelayRoom release transition', () => {
  it('withholds unscoped legacy announcements across owner persistence until a genuine room update confirms them', async () => {
    const legacy = { peerId: 33, version: 10, hostname: 'legacy-alpha', proxyCidrs: ['10.1.0.0/16'], networkLength: 16 };
    const { relay, saved, room } = await fixture({ name: 'beta', env: networks, stored: {
      routeVersion: 1, topologyUpdatedAt: new Date().toISOString(), routePeers: [{ peerId: 33, sourcePeerId: 99, lastSeen: new Date().toISOString(), hostname: legacy.hostname, proxyCidrs: legacy.proxyCidrs }], rawRoutePeerInfos: [legacy],
      connBitmapPeerIds: [33, 99], connBitmapEdges: [{ fromPeerId: 33, toPeerId: 99, source: 'conn_bitmap' }], peerCenter: [{ peerId: 33, directPeers: [[44, { latencyMs: 1 }]], lastSeen: new Date().toISOString() }], outboundRoomIds: ['alpha', 'beta'],
    } });
    const source = session(relay, 'beta-source', 99, 'beta');
    const history = await (await room.fetch(new Request('https://room/?room=beta'))).json() as { peers: PeerSnapshot[] };
    expect(history.peers.some((peer) => peer.hostname === 'legacy-alpha')).toBe(true);
    expect(history.peers.find((peer) => peer.peerId === EDGE_PEER_ID)?.networkLength).toBe(24);
    expect(relay.buildSyncRouteInfoRequest(source.value, 99, true).peerInfos.some((peer) => peer.peerId === 33)).toBe(false);
    expect(relay.buildSyncRouteInfoRequest(source.value, 99, true).peerInfos.find((peer) => peer.peerId === EDGE_PEER_ID)?.networkLength).toBe(24);
    expect(relay.buildPeerCenterGlobalMap().has(33)).toBe(false); expect(relay.buildPeerCenterGlobalMap().has(44)).toBe(false);
    await relay.persistControlState();
    const restarted = await fixture({ name: 'beta', env: networks, stored: saved.get('control-state:v1') });
    const current = session(restarted.relay, 'current-beta', 99, 'beta');
    expect(restarted.relay.buildSyncRouteInfoRequest(current.value, 99, true).peerInfos.some((peer) => peer.peerId === 33)).toBe(false);
    expect(restarted.relay.buildPeerCenterGlobalMap().has(33)).toBe(false);
    restarted.relay.applySyncRouteInfo(current.value, { myPeerId: 99, peerInfos: [{ ...legacy, version: 9, hostname: 'confirmed-beta', networkLength: 24 }], connPeerList: { peerConnInfos: [{ peerId: { peerId: 33, version: 2 }, connectedPeerIds: [] }] } });
    expect(restarted.relay.buildSyncRouteInfoRequest(current.value, 99, true).peerInfos.find((peer) => peer.peerId === 33)).toMatchObject({ version: 9, hostname: 'confirmed-beta' });
    restarted.relay.applySyncRouteInfo(current.value, { myPeerId: 99, peerInfos: [{ ...legacy, version: 8, hostname: 'older-beta' }] });
    expect(restarted.relay.rawRoutePeerInfos.get(33)?.hostname).toBe('confirmed-beta');
    restarted.relay.applyPeerCenterGlobalMap(current.value, new Map([[33, { directPeers: new Map([[44, { latencyMs: 1 }]]) }]]));
    expect(restarted.relay.buildPeerCenterGlobalMap().has(44)).toBe(true);
  });

  it('persists unconfirmed markers before constructor cleanup writes the newly scoped state', async () => {
    const now = new Date().toISOString(), old = new Date(Date.now() - 300_000).toISOString();
    const { saved } = await fixture({ name: 'beta', stored: {
      routeVersion: 1, topologyUpdatedAt: now, routePeers: [{ peerId: 33, lastSeen: now, proxyCidrs: [] }, { peerId: 44, lastSeen: old, proxyCidrs: [] }],
      rawRoutePeerInfos: [{ peerId: 33, version: 10, hostname: 'history', proxyCidrs: [] }, { peerId: 44, version: 10, proxyCidrs: [] }], connBitmapEdges: [], peerCenter: [],
    } });
    expect(saved.get('control-state:v1')).toMatchObject({ roomId: 'beta', unconfirmedRoutePeerIds: [33] });
    const restarted = await fixture({ name: 'beta', stored: saved.get('control-state:v1') });
    const current = session(restarted.relay, 'current', 99, 'beta');
    expect(restarted.relay.buildSyncRouteInfoRequest(current.value, 99, true).peerInfos.some((peer) => peer.peerId === 33)).toBe(false);
  });

  it('does not pin unconfirmed legacy history by a newly connected source peer with the same ID', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
    const { relay, room } = await fixture({ name: 'beta', stored: {
      routeVersion: 1, topologyUpdatedAt: new Date().toISOString(), routePeers: [{ peerId: 33, sourcePeerId: 99, lastSeen: new Date().toISOString(), proxyCidrs: [] }],
      rawRoutePeerInfos: [{ peerId: 33, version: 10, proxyCidrs: [] }], connBitmapPeerIds: [33, 99], connBitmapEdges: [{ fromPeerId: 33, toPeerId: 99, source: 'conn_bitmap' }], peerCenter: [],
    } });
    session(relay, 'current-source', 99, 'beta'); vi.advanceTimersByTime(180_001);
    await room.fetch(new Request('https://room/?room=beta'));
    expect(relay.rawRoutePeerInfos.has(33)).toBe(false); expect(relay.connBitmapEdges).toHaveLength(0);
  });

  it('drops a valid RPC whose decryption finishes after its session retires', async () => {
    const { relay } = await fixture({ name: 'alpha' });
    const source = session(relay, 'source', 11); source.value.keys = deriveKeys('fixture-secret');
    const plaintext = buildRpcRequestPayloads({ fromPeer: 11, toPeer: EDGE_PEER_ID, transactionId: 1n, descriptor: { protoName: 'peer_rpc', serviceName: 'OspfRouteRpc', methodIndex: 1 },
      requestBody: encodeSyncRouteInfoRequest({ myPeerId: 11, peerInfos: [{ peerId: 33, version: 1, hostname: 'late-row', proxyCidrs: [] }] }) })[0];
    let entered = () => {}, finish = (_value: ArrayBuffer) => {};
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const decrypted = new Promise<ArrayBuffer>((resolve) => { finish = resolve; });
    vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async () => { entered(); return decrypted; });
    const encrypted = createEasyTierFrame({ fromPeerId: 11, toPeerId: EDGE_PEER_ID, packetType: EasyTierPacketType.RpcReq, flags: 1, reserved: 0, forwardCounter: 0, len: plaintext.length }, new Uint8Array(plaintext.length + AEAD_TAIL_SIZE)).buffer;
    const inflight = relay.onEasyTierFrame(source.value, encrypted);
    await started; relay.disconnect(source.value); finish(new Uint8Array(plaintext).buffer); await inflight;
    expect(relay.rawRoutePeerInfos.has(33)).toBe(false); expect(source.value.ospfRouteSession).toBeUndefined();
  });

  it('waits for durable ownership before serving concurrent first requests', async () => {
    let release = () => {}, entered = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writing = new Promise<void>((resolve) => { entered = resolve; });
    const { room } = await fixture({ put: async () => { entered(); await gate; } });
    const first = room.fetch(new Request('https://room/?room=alpha'));
    await writing;
    let secondDone = false;
    const second = room.fetch(new Request('https://room/?room=alpha')).then((response) => { secondDone = true; return response; });
    try {
      expect((await room.fetch(new Request('https://room/?room=beta'))).status).toBe(409);
      await Promise.resolve(); expect(secondDone).toBe(false);
    } finally { release(); await Promise.all([first, second]); }
    expect(secondDone).toBe(true);
  });

  it('rolls back a failed first owner claim so a later valid request can persist ownership', async () => {
    let fail = true;
    const { room } = await fixture({ put: async () => { if (fail) { fail = false; throw new Error('fixture storage unavailable'); } } });
    await expect(room.fetch(new Request('https://room/?room=alpha'))).rejects.toThrow('fixture storage unavailable');
    expect((await room.fetch(new Request('https://room/?room=beta'))).status).toBe(200);
    expect((await room.fetch(new Request('https://room/?room=alpha'))).status).toBe(409);
  });

  it('clears RPC snapshots and mergers when a connection retires and rejects further RPC sends', async () => {
    const { relay } = await fixture({ name: 'alpha' });
    const source = session(relay, 'source', 11);
    source.value.rpcMergers.set('unfinished', new RpcPacketMerger());
    await relay.pushRouteUpdateTo(source.value, 11, undefined, true); await source.value.writeQueue;
    const state = source.value.ospfRouteSession!;
    expect(state.pendingRouteSyncs.size).toBe(1);
    relay.disconnect(source.value);
    expect(state.pendingRouteSyncs.size).toBe(0); expect(source.value.rpcMergers.size).toBe(0);
    await expect(relay.sendRpcRequest(source.value, 11, undefined, new Uint8Array())).rejects.toThrow('session');
  });

  it('closes the outbound writer/socket when the readable side ends', async () => {
    const { relay } = await fixture({ name: 'alpha' });
    let resolveClosed = () => {};
    const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
    const close = vi.fn(async () => { resolveClosed(); });
    const writer = new WritableStream<Uint8Array>().getWriter(); const abort = vi.spyOn(writer, 'abort');
    const tcp = relay.createOutboundTcpSession('alpha', 'tcp://fixture.example:11010', { closed, close } as unknown as Socket, writer);
    relay.sessions.set(tcp.sessionId, tcp);
    const reader = new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }).getReader();
    await relay.readOutboundTcp(tcp, reader); await Promise.resolve();
    expect(relay.sessions.has(tcp.sessionId)).toBe(false); expect(close).toHaveBeenCalledOnce(); expect(abort).toHaveBeenCalledOnce();
  });

  it('rejects oversized TCP frames before queue reservation and continues with an exact-MTU frame', async () => {
    const { relay } = await fixture({ name: 'alpha' });
    const source = session(relay, 'source', 11); const writes: Uint8Array[] = [];
    let resolveClosed = () => {};
    const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
    const writer = new WritableStream<Uint8Array>({ write: (chunk) => { writes.push(chunk); } }).getWriter();
    const tcp = relay.createOutboundTcpSession('alpha', 'tcp://fixture.example:11010', { closed, close: async () => { resolveClosed(); } } as unknown as Socket, writer);
    tcp.handshakeAccepted = true; relay.sessions.set(tcp.sessionId, tcp); relay.bindPeer(tcp, 22);
    const oversized = frame(11, 22, EasyTierPacketType.Data, new Uint8Array(2001 - EASYTIER_HEADER_SIZE));
    const burst: Promise<void>[] = [];
    for (let i = 0; i <= RELAY_QUEUE_LIMITS.sessionFrames; i++) burst.push(relay.onEasyTierFrame(source.value, oversized));
    expect(tcp.queuedWriteFrames ?? 0).toBe(0); expect(relay.sessions.has(tcp.sessionId)).toBe(true);
    await Promise.all(burst);
    await relay.onEasyTierFrame(source.value, frame(11, 22, EasyTierPacketType.Data, new Uint8Array(2000 - EASYTIER_HEADER_SIZE))); await tcp.writeQueue;
    expect(writes).toHaveLength(1); expect(new DataView(writes[0].buffer, writes[0].byteOffset).getUint32(0, true)).toBe(2000);
    expect(relay.traffic.forwardedPackets).toBe(1); relay.closeSessionTransport(tcp);
  });

  it('splits a real encrypted route RPC through the native TCP adapter within the MTU', async () => {
    const { relay } = await fixture({ name: 'alpha' }); const writes: Uint8Array[] = [];
    let resolveClosed = () => {};
    const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
    const writer = new WritableStream<Uint8Array>({ write: (chunk) => { writes.push(chunk); } }).getWriter();
    const tcp = relay.createOutboundTcpSession('alpha', 'tcp://fixture.example:11010', { closed, close: async () => { resolveClosed(); } } as unknown as Socket, writer);
    tcp.handshakeAccepted = true; tcp.keys = deriveKeys('fixture-network-secret'); relay.sessions.set(tcp.sessionId, tcp); relay.bindPeer(tcp, 22);
    const request = encodeSyncRouteInfoRequest({ myPeerId: EDGE_PEER_ID, peerInfos: Array.from({ length: 100 }, (_, i) => ({ peerId: 100 + i, version: 1, proxyCidrs: ['10.0.0.0/24'], hostname: `fixture-route-node-${i}` })) });
    await relay.sendRpcRequest(tcp, 22, undefined, request); await tcp.writeQueue;
    expect(writes.length).toBeGreaterThan(1);
    const merger = new RpcPacketMerger(); let merged: RpcPacket | undefined;
    for (const chunk of writes) {
      const size = new DataView(chunk.buffer, chunk.byteOffset).getUint32(0, true); expect(size).toBeLessThanOrEqual(2000);
      const plaintext = await decryptAesGcm(chunk.slice(4 + EASYTIER_HEADER_SIZE), tcp.keys.key128);
      merged = merger.feed(decodeRpcPacket(plaintext));
    }
    expect(merged).toBeDefined(); expect(decodeEasyTierRpcPacket(merged!).syncRouteInfo?.peerInfos).toHaveLength(100);
    expect(relay.sessions.has(tcp.sessionId)).toBe(true); relay.closeSessionTransport(tcp);
  });
});

describe('RelayRoom RPC retention', () => {
  it('bounds pending route requests, expires unanswered snapshots, and accepts a timely acknowledgement', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
    const { relay } = await fixture({ name: 'alpha' });
    const source = session(relay, 'source', 11);
    relay.sendRpcRequest = vi.fn(async (_session, _peer, _descriptor, _body, transactionId) => transactionId ?? 0n);
    for (let i = 0; i < 20; i++) await relay.pushRouteUpdateTo(source.value, 11, undefined, true);
    const state = source.value.ospfRouteSession!;
    expect(state.pendingRouteSyncs.size).toBe(MAX_PENDING_ROUTE_SYNCS);
    const timely = state.pendingRouteSyncs.values().next().value;
    expect(applyOspfRouteSessionResponse(state, { isInitiator: false }, timely, 11)).toBe(true);
    vi.advanceTimersByTime(ROUTE_SYNC_TIMEOUT_MS);
    source.value.lastSeen = new Date().toISOString(); relay.runHeartbeatMaintenance();
    expect(state.pendingRouteSyncs.size).toBeLessThanOrEqual(1);
    expect(applyOspfRouteSessionResponse(state, { isInitiator: false }, timely, 11)).toBe(false);
    const renewed = state.pendingRouteSyncs.values().next().value;
    expect(renewed?.sentAt).toBe(Date.now());
    expect(applyOspfRouteSessionResponse(state, { isInitiator: false }, renewed, 11)).toBe(true);
    expect(state.lastSyncSuccessAt).toBe(Date.now());
    for (let i = 0; i < 100; i++) {
      vi.advanceTimersByTime(10_001); source.value.lastSeen = new Date().toISOString();
      await relay.pushRouteUpdateTo(source.value, 11, undefined, true);
      expect(state.pendingRouteSyncs.size).toBeLessThanOrEqual(1);
    }
  });

  it('bounds incomplete RPC mergers and expires them during heartbeat without new traffic', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
    const { relay } = await fixture({ name: 'alpha' });
    const source = session(relay, 'source', 11);
    const header = parseEasyTierHeader(frame(11, EDGE_PEER_ID, EasyTierPacketType.RpcReq))!;
    for (let i = 0; i < 32; i++) relay.mergeRpcPacket(source.value, header, { fromPeer: 11, toPeer: EDGE_PEER_ID, transactionId: BigInt(i), totalPieces: 2, pieceIdx: 1, body: new Uint8Array([1]) });
    expect(() => relay.mergeRpcPacket(source.value, header, { fromPeer: 11, toPeer: EDGE_PEER_ID, transactionId: 33n, totalPieces: 2, pieceIdx: 1, body: new Uint8Array([1]) })).toThrow('limit exceeded');
    vi.advanceTimersByTime(30_001); source.value.lastSeen = new Date().toISOString(); relay.runHeartbeatMaintenance();
    expect(source.value.rpcMergers.size).toBe(0);
  });
});
