import { EASYTIER_HEADER_SIZE, EASYTIER_MAGIC, EASYTIER_VERSION, EDGE_PEER_ID, EasyTierPacketType, MAX_FRAME_SIZE, MAX_INVALID_PACKETS_PER_SESSION, MAX_PEERS_PER_ROOM, RECENT_EVENTS_LIMIT, ROOM_NAME_PATTERN } from '../easytier/constants';
import { AEAD_TAIL_SIZE, decryptAesGcm, deriveKeys, encryptAesGcm, type DerivedKeys } from '../easytier/crypto';
import { buildHandshakeRequest, buildHandshakeResponse, decodeHandshake, encodeHandshake } from '../easytier/handshake';
import { createEasyTierFrame, parseEasyTierHeader, payloadLengthMatches, splitEasyTierFrames, type EasyTierPacketHeader } from '../easytier/packet';
import { bytesEqual, hex } from '../easytier/protobuf';
import {
  buildRpcRequestPayload,
  buildRpcResponsePayload,
  decodeEasyTierRpcPayload,
  encodeDirectConnectorGetIpListResponse,
  encodeGetGlobalPeerMapRequest,
  encodeGetGlobalPeerMapResponse,
  encodeReportPeersResponse,
  encodeSyncRouteInfoRequest,
  encodeSyncRouteInfoResponse,
  encodeVoidResponse,
  natTypeName,
  observeHandshake,
  observeRpc,
  type DecodedEasyTierRpc,
  type DirectConnectedPeerInfo,
  type PeerCenterGlobalMap,
  type PeerInfoForGlobalMap,
  type ReportPeersRequest,
  type RouteConnBitmap,
  type RouteConnPeerList,
  type RoutePeerInfo,
  type SyncRouteInfoRequest,
  type SyncRouteInfoResponse,
} from '../easytier/rpc';
import { encodeTcpTunnelFrame, parseTcpPeerUri, TcpTunnelFrameDecoder, type TcpPeerAddress } from '../easytier/tcp-frame';
import type {
  ConnectionMatrixSnapshot,
  PeerSnapshot,
  RelayEvent,
  RoomSnapshot,
  RoutePathSnapshot,
  RoutePeerSnapshot,
  TopologyEdge,
  TopologySnapshot,
  TopologySummary,
  TrafficSample,
  TrafficSnapshot,
  TrafficSummary,
} from '../observer/types';
import type { Env } from '../worker/env';

type SessionTransportKind = 'websocket' | 'tcp-outbound';

type Session = PeerSnapshot & {
  transportKind: SessionTransportKind;
  sendRawFrame: (frame: Uint8Array) => void | Promise<void>;
  closeTransport: (code?: number, reason?: string) => void | Promise<void>;
  isTransportOpen: () => boolean;
  invalidPackets: number;
  messageQueue: Promise<void>;
  writeQueue: Promise<void>;
  keys?: DerivedKeys;
  serverSessionId?: bigint;
  handshakeAccepted?: boolean;
  lastRoutePushAt?: number;
  lastPingSent: number;
  lastPongReceived: number;
  ospfDescriptor?: DecodedEasyTierRpc['descriptor'];
  ospfRouteSession?: OspfRouteSessionState;
  outboundPeerUri?: string;
  outboundHandshakeSent?: boolean;
  routeInfoResyncRequestedAt?: number;
};

export interface NetworkConfig {
  networkName: string;
  secret?: string;
}

export interface DefaultRoomConfig {
  roomId: string;
  networkName: string;
}

interface PersistedPeerCenterEntry {
  peerId: number;
  directPeers: Array<[number, DirectConnectedPeerInfo]>;
  lastSeen: string;
}

interface PersistedControlState {
  routeVersion: number;
  topologyUpdatedAt?: string;
  routePeers: RoutePeerSnapshot[];
  rawRoutePeerInfos: RoutePeerInfo[];
  connBitmapPeerIds?: number[];
  connBitmapEdges: TopologyEdge[];
  peerCenter: PersistedPeerCenterEntry[];
}

export interface PendingRouteSync {
  peerInfos: RoutePeerInfo[];
  connBitmap?: RouteConnBitmap;
  connPeerList?: RouteConnPeerList;
}

export interface OspfRouteSessionState {
  mySessionId: bigint;
  remoteSessionId?: bigint;
  weAreInitiator: boolean;
  remoteIsInitiator: boolean;
  needSyncInitiatorInfo: boolean;
  dstSavedPeerInfoVersions: Map<number, number>;
  dstSavedConnInfoVersions: Map<number, number>;
  pendingRouteSyncs: Map<string, PendingRouteSync>;
  lastSyncSuccessAt?: number;
}

type TrafficCounters = Omit<TrafficSnapshot, 'samples' | 'summary'>;

const DIRECTORY_SYNC_MIN_MS = 5_000;
const CONTROL_STATE_PERSIST_MIN_MS = 2_000;
const ROUTE_PUSH_MIN_MS = 10_000;
const ROUTE_STATE_TTL_MS = 180_000;
const ROUTE_INFO_RESYNC_MIN_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const CONNECTION_TIMEOUT_MS = 25_000;
const MAINTENANCE_ALARM_MS = 5_000;
const TRAFFIC_SAMPLE_INTERVAL_MS = 5_000;
const TRAFFIC_SAMPLES_LIMIT = 120;
const CONTROL_STATE_STORAGE_KEY = 'control-state:v1';
const WS_OPEN = 1;

export class RelayRoom implements DurableObject {
  private sessions = new Map<string, Session>();
  private peers = new Map<number, string>();
  private events: RelayEvent[] = [];
  private seededPeers: PeerSnapshot[] = [];
  private routePeers = new Map<number, RoutePeerSnapshot>();
  private rawRoutePeerInfos = new Map<number, RoutePeerInfo>();
  private connBitmapEdges: TopologyEdge[] = [];
  private peerCenter = new Map<number, { directPeers: Map<number, DirectConnectedPeerInfo>; lastSeen: string }>();
  private peerCenterEdges: TopologyEdge[] = [];
  private topologyUpdatedAt: string | undefined;
  private routeVersion = Math.floor(Date.now() / 1000) % 2_000_000_000;
  private connBitmapPeerIds: number[] = [];
  private traffic: TrafficCounters = emptyTrafficCounters();
  private trafficSamples: TrafficSample[] = [];
  private sessionRateBaselines = new Map<string, { at: number; rxBytes: number; txBytes: number; rxPackets: number; txPackets: number }>();
  private lastDirectorySync = 0;
  private directorySyncQueued = false;
  private lastControlStatePersist = 0;
  private controlStatePersistQueued = false;
  private outboundTcpConnecting = new Set<string>();

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    this.state.blockConcurrencyWhile(async () => {
      await this.loadControlState();
      await this.ensureMaintenanceAlarm();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomId = url.searchParams.get('room') ?? 'default';
    if (url.pathname === '/connect') return this.acceptWebSocket(request, roomId);
    this.state.waitUntil(this.ensureConfiguredOutboundTcp(roomId).catch(() => {
      this.addEvent(roomId, 'decode_error', 'outbound tcp startup failed');
    }));
    if (url.pathname === '/outbound-tcp') return this.outboundTcp(request, roomId);
    if (url.pathname === '/test-seed') return this.seed(request, roomId);
    if (url.pathname === '/peers') return Response.json({ peers: this.snapshot(roomId).peers });
    if (url.pathname === '/events') return Response.json({ events: this.events });
    if (url.pathname === '/traffic') return Response.json(this.snapshotTraffic());
    if (url.pathname === '/topology') return Response.json(this.snapshotTopology(roomId));
    return Response.json(this.snapshot(roomId));
  }

  async alarm(): Promise<void> {
    const roomId = this.currentRoomId();
    const pruned = this.pruneStaleRouteState();
    this.runHeartbeatMaintenance();
    if (roomId) await this.ensureConfiguredOutboundTcp(roomId);
    if (pruned) {
      await this.persistControlState();
      if (roomId) await this.syncDirectory(roomId);
    }
    await this.ensureMaintenanceAlarm();
  }

  private acceptWebSocket(request: Request, roomId: string): Response {
    if (this.sessions.size >= MAX_PEERS_PER_ROOM) {
      this.addEvent(roomId, 'limit_exceeded', 'room peer limit exceeded');
      this.queueDirectorySync(roomId);
      return new Response('room peer limit exceeded', { status: 429 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    server.binaryType = 'arraybuffer';
    const now = new Date().toISOString();
    const nowMs = Date.now();
    const session: Session = {
      sessionId: crypto.randomUUID(),
      roomId,
      connected: true,
      connectedAt: now,
      lastSeen: now,
      rxBytes: 0,
      txBytes: 0,
      rxPackets: 0,
      txPackets: 0,
      invalidPackets: 0,
      transportKind: 'websocket',
      sendRawFrame: (frame) => {
        if (server.readyState !== WS_OPEN) throw new Error('websocket is not open');
        server.send(frame);
      },
      closeTransport: (code, reason) => server.close(code, reason),
      isTransportOpen: () => server.readyState === WS_OPEN,
      messageQueue: Promise.resolve(),
      writeQueue: Promise.resolve(),
      lastPingSent: 0,
      lastPongReceived: nowMs,
    };
    this.sessions.set(session.sessionId, session);
    this.addEvent(roomId, 'connected', 'websocket connected', session);
    this.queueDirectorySync(roomId, true);
    server.addEventListener('message', (event) => this.enqueueMessage(session, event));
    server.addEventListener('close', () => this.disconnect(session));
    server.addEventListener('error', () => this.disconnect(session));
    this.state.waitUntil(this.ensureMaintenanceAlarm());
    return new Response(null, { status: 101, webSocket: client });
  }

  private enqueueMessage(session: Session, event: MessageEvent): void {
    const run = session.messageQueue.then(() => this.onMessage(session, event));
    session.messageQueue = run.catch(() => undefined);
    this.state.waitUntil(run.catch(() => this.invalid(session, 'message handling failed')));
  }

  private async onMessage(session: Session, event: MessageEvent): Promise<void> {
    const message = toArrayBuffer(event.data);
    session.lastSeen = new Date().toISOString();
    if (!message) return this.invalid(session, 'unsupported websocket frame type');
    session.rxBytes += message.byteLength;
    this.traffic.rxBytes += message.byteLength;
    if (message.byteLength > MAX_FRAME_SIZE) return this.invalid(session, 'frame size limit exceeded');
    const frames = splitEasyTierFrames(message);
    if (!frames) return this.invalid(session, `invalid EasyTier packet header or length (${describeFrameSplitFailure(message)})`);
    for (const frame of frames) await this.onEasyTierFrame(session, frame);
  }

  private async onEasyTierFrame(session: Session, frame: ArrayBuffer): Promise<void> {
    const header = parseEasyTierHeader(frame);
    if (!header || !payloadLengthMatches(frame, header)) return this.invalid(session, 'invalid EasyTier packet header or length');
    session.rxPackets += 1;
    this.traffic.rxPackets += 1;
    this.bindPeerFromFrame(session, header);
    const payload = new Uint8Array(frame, EASYTIER_HEADER_SIZE);
    if (header.packetType === EasyTierPacketType.HandShake) {
      await this.handleHandshake(session, header, payload, frame);
      return;
    }
    if (header.packetType === EasyTierPacketType.Ping) {
      session.lastPongReceived = Date.now();
      this.sendFrame(session, header.fromPeerId, EasyTierPacketType.Pong, payload);
      return;
    }
    if (header.packetType === EasyTierPacketType.Pong) {
      session.lastPongReceived = Date.now();
      return;
    }
    if (header.packetType === EasyTierPacketType.RpcReq || header.packetType === EasyTierPacketType.RpcResp) {
      if (await this.handleRpc(session, header, payload, frame)) return;
    }
    this.forwardOrRecordUnroutable(session, header, frame);
  }

  private async handleHandshake(session: Session, header: EasyTierPacketHeader, payload: Uint8Array, frame: ArrayBuffer): Promise<void> {
    let clientReq;
    try {
      clientReq = decodeHandshake(payload);
    } catch {
      const observed = observeHandshake(header, frame);
      session.networkName = observed.networkName ?? session.networkName;
      session.networkSecretDigestPrefix = observed.networkSecretDigestPrefix ?? session.networkSecretDigestPrefix;
      this.addEvent(session.roomId, 'handshake_seen', `handshake observed (${observed.confidence})`, session);
      return;
    }

    if (session.transportKind === 'tcp-outbound' && session.outboundHandshakeSent && !session.handshakeAccepted) {
      await this.handleOutboundHandshake(session, header, clientReq);
      return;
    }

    const clientPeerId = clientReq.myPeerId || header.fromPeerId;
    if (!clientPeerId) {
      this.addEvent(session.roomId, 'decode_error', 'handshake missing peer id', session);
      this.closeSessionTransport(session, 1008, 'missing peer id');
      return;
    }
    if (clientPeerId === EDGE_PEER_ID) {
      this.addEvent(session.roomId, 'decode_error', 'handshake peer id conflicts with EdgeTier peer id', session);
      this.closeSessionTransport(session, 1008, 'peer id conflict');
      return;
    }
    this.bindPeer(session, clientPeerId);
    session.networkName = clientReq.networkName || session.networkName;
    session.networkSecretDigestPrefix = hex(clientReq.networkSecretDigest).slice(0, 12) || undefined;

    if ((clientReq.magic >>> 0) !== EASYTIER_MAGIC || clientReq.version !== EASYTIER_VERSION) {
      this.addEvent(session.roomId, 'decode_error', 'handshake protocol mismatch', session);
      this.closeSessionTransport(session, 1008, 'protocol mismatch');
      return;
    }

    const networkConfig = this.networkConfigFor(session.roomId);
    if (clientReq.networkName !== networkConfig.networkName) {
      this.addEvent(session.roomId, 'decode_error', `handshake network mismatch for ${clientReq.networkName || 'unknown'}`, session);
      this.closeSessionTransport(session, 1008, 'network mismatch');
      return;
    }
    if (!networkConfig.secret) {
      this.addEvent(session.roomId, 'handshake_seen', 'handshake observed; network secret is not configured', session);
      return;
    }

    const response = buildHandshakeResponse(clientReq, networkConfig.networkName, networkConfig.secret);
    if (!bytesEqual(clientReq.networkSecretDigest, response.networkSecretDigest)) {
      this.addEvent(session.roomId, 'decode_error', 'handshake secret digest mismatch', session);
      this.closeSessionTransport(session, 1008, 'network secret mismatch');
      return;
    }

    session.keys = deriveKeys(networkConfig.secret);
    session.handshakeAccepted = true;
    ensureOspfRouteSession(session);
    this.sendFrame(session, clientPeerId, EasyTierPacketType.HandShake, encodeHandshake(response));
    this.addEvent(session.roomId, 'handshake_seen', 'handshake accepted', session);
    this.queueDirectorySync(session.roomId, true);
    this.state.waitUntil(this.bootstrapControlPlane(session, clientPeerId).catch(() => {
      this.addEvent(session.roomId, 'decode_error', 'control-plane bootstrap failed', session);
    }));
  }

  private async handleOutboundHandshake(session: Session, header: EasyTierPacketHeader, response: ReturnType<typeof decodeHandshake>): Promise<void> {
    const remotePeerId = response.myPeerId || header.fromPeerId;
    if (!remotePeerId) {
      this.addEvent(session.roomId, 'decode_error', 'outbound handshake missing peer id', session);
      this.closeSessionTransport(session, 1008, 'missing peer id');
      return;
    }
    if (remotePeerId === EDGE_PEER_ID) {
      this.addEvent(session.roomId, 'decode_error', 'outbound handshake peer id conflicts with EdgeTier peer id', session);
      this.closeSessionTransport(session, 1008, 'peer id conflict');
      return;
    }
    session.networkName = response.networkName || session.networkName;
    session.networkSecretDigestPrefix = hex(response.networkSecretDigest).slice(0, 12) || undefined;

    if ((response.magic >>> 0) !== EASYTIER_MAGIC || response.version !== EASYTIER_VERSION) {
      this.addEvent(session.roomId, 'decode_error', 'outbound handshake protocol mismatch', session);
      this.closeSessionTransport(session, 1008, 'protocol mismatch');
      return;
    }

    const networkConfig = this.networkConfigFor(session.roomId);
    if (response.networkName !== networkConfig.networkName) {
      this.addEvent(session.roomId, 'decode_error', `outbound handshake network mismatch for ${response.networkName || 'unknown'}`, session);
      this.closeSessionTransport(session, 1008, 'network mismatch');
      return;
    }
    if (!networkConfig.secret) {
      this.addEvent(session.roomId, 'handshake_seen', 'outbound handshake observed; network secret is not configured', session);
      return;
    }

    const expected = buildHandshakeRequest(networkConfig.networkName, networkConfig.secret);
    if (!bytesEqual(response.networkSecretDigest, expected.networkSecretDigest)) {
      this.addEvent(session.roomId, 'decode_error', 'outbound handshake secret digest mismatch', session);
      this.closeSessionTransport(session, 1008, 'network secret mismatch');
      return;
    }

    this.bindPeer(session, remotePeerId);
    session.keys = deriveKeys(networkConfig.secret);
    session.handshakeAccepted = true;
    ensureOspfRouteSession(session);
    this.addEvent(session.roomId, 'handshake_seen', 'outbound tcp handshake accepted', session);
    this.queueDirectorySync(session.roomId, true);
    this.state.waitUntil(this.bootstrapControlPlane(session, remotePeerId).catch(() => {
      this.addEvent(session.roomId, 'decode_error', 'outbound control-plane bootstrap failed', session);
    }));
  }

  private async handleRpc(session: Session, header: EasyTierPacketHeader, payload: Uint8Array, frame: ArrayBuffer): Promise<boolean> {
    const targetIsEdge = header.toPeerId === 0 || header.toPeerId === EDGE_PEER_ID;
    let body = payload;
    if ((header.flags & 1) === 1) {
      if (!session.keys) {
        this.addEvent(session.roomId, 'decode_error', 'encrypted RPC received before accepted handshake', session);
        return targetIsEdge;
      }
      try {
        body = await decryptEasyTierPayload(payload, session.keys);
      } catch {
        this.addEvent(session.roomId, 'decode_error', 'encrypted RPC decrypt failed', session);
        return targetIsEdge;
      }
    }

    let decoded: DecodedEasyTierRpc;
    try {
      decoded = decodeEasyTierRpcPayload(body);
    } catch {
      const rpc = observeRpc(header, frame);
      this.addEvent(session.roomId, 'rpc_seen', rpc.message, session);
      return false;
    }

    this.addEvent(session.roomId, 'rpc_seen', decoded.message, session);
    let routeChanged = false;
    if (decoded.syncRouteInfo) {
      session.ospfDescriptor = decoded.descriptor ?? session.ospfDescriptor;
      if (targetIsEdge) updateOspfRouteSessionFromRequest(ensureOspfRouteSession(session), decoded.syncRouteInfo, header.fromPeerId);
      routeChanged = this.applySyncRouteInfo(session, decoded.syncRouteInfo);
    }
    if (targetIsEdge && decoded.syncRouteResponse) {
      const routeSession = ensureOspfRouteSession(session);
      const pending = decoded.packet.transactionId === undefined
        ? undefined
        : routeSession.pendingRouteSyncs.get(decoded.packet.transactionId.toString());
      if (decoded.packet.transactionId !== undefined) routeSession.pendingRouteSyncs.delete(decoded.packet.transactionId.toString());
      const acked = applyOspfRouteSessionResponse(routeSession, decoded.syncRouteResponse, pending, header.fromPeerId);
      if (acked) this.addEvent(session.roomId, 'rpc_seen', `route sync ack accepted from peer ${header.fromPeerId}`, session);
    }
    if (decoded.reportPeers) this.applyPeerCenterReport(session, decoded.reportPeers);
    if (decoded.globalPeerMap) this.applyPeerCenterGlobalMap(session, decoded.globalPeerMap);
    if (decoded.unsupportedCompression) return targetIsEdge;

    const shouldRespond = header.packetType === EasyTierPacketType.RpcReq && targetIsEdge;
    if (shouldRespond && decoded.service === 'OspfRouteRpc.SyncRouteInfo' && decoded.syncRouteInfo) {
      const routeSession = ensureOspfRouteSession(session);
      const response = encodeSyncRouteInfoResponse({ isInitiator: routeSession.weAreInitiator, sessionId: routeSession.mySessionId });
      await this.sendRpcResponse(session, header.fromPeerId, decoded, response);
      await this.pushRouteUpdateTo(session, header.fromPeerId, decoded.descriptor, routeChanged || routeSession.needSyncInitiatorInfo);
      if (routeChanged) await this.broadcastRouteUpdates(session, decoded.descriptor);
      return true;
    }

    if (shouldRespond && decoded.service === 'PeerCenterRpc.ReportPeers') {
      await this.sendRpcResponse(session, header.fromPeerId, decoded, encodeReportPeersResponse());
      return true;
    }

    if (shouldRespond && decoded.service === 'PeerCenterRpc.GetGlobalPeerMap') {
      const globalPeerMap = this.buildPeerCenterGlobalMap();
      const digest = peerCenterDigest(globalPeerMap);
      const requestDigest = decoded.getGlobalPeerMap?.digest ?? 0n;
      const response = requestDigest !== 0n && requestDigest === digest
        ? encodeGetGlobalPeerMapResponse({})
        : encodeGetGlobalPeerMapResponse({ globalPeerMap, digest });
      await this.sendRpcResponse(session, header.fromPeerId, decoded, response);
      return true;
    }

    if (shouldRespond && decoded.service === 'DirectConnectorRpc.GetIpList') {
      await this.sendRpcResponse(session, header.fromPeerId, decoded, encodeDirectConnectorGetIpListResponse());
      return true;
    }

    if (shouldRespond && decoded.service === 'DirectConnectorRpc.SendUdpHolePunchPacket') {
      await this.sendRpcResponse(session, header.fromPeerId, decoded, encodeVoidResponse());
      return true;
    }

    if (shouldRespond && (
      decoded.service === 'UdpHolePunchRpc.SelectPunchListener'
      || decoded.service === 'UdpHolePunchRpc.SendPunchPacketCone'
      || decoded.service === 'UdpHolePunchRpc.SendPunchPacketHardSym'
      || decoded.service === 'UdpHolePunchRpc.SendPunchPacketEasySym'
      || decoded.service === 'UdpHolePunchRpc.SendPunchPacketBothEasySym'
      || decoded.service === 'TcpHolePunchRpc.ExchangeMappedAddr'
    )) {
      await this.sendRpcResponse(session, header.fromPeerId, decoded, encodeVoidResponse());
      return true;
    }

    return targetIsEdge;
  }

  private forwardOrRecordUnroutable(session: Session, header: EasyTierPacketHeader, frame: ArrayBuffer): void {
    const targetSessionId = header.toPeerId ? this.peers.get(header.toPeerId) : undefined;
    const target = targetSessionId ? this.sessions.get(targetSessionId) : undefined;
    if (!target || target.sessionId === session.sessionId) {
      this.traffic.unroutablePackets += 1;
      this.addEvent(session.roomId, 'packet_unroutable', `packet type ${header.packetType} to peer ${header.toPeerId || 'unknown'} was not forwarded`, session);
      this.queueDirectorySync(session.roomId);
      return;
    }
    this.emitFrame(target, frame);
    this.traffic.forwardedPackets += 1;
    this.addEvent(session.roomId, 'packet_forwarded', `packet type ${header.packetType} forwarded to peer ${header.toPeerId}`, session);
    this.queueDirectorySync(session.roomId);
  }

  private async sendRpcResponse(session: Session, toPeerId: number, decoded: DecodedEasyTierRpc, responseBody: Uint8Array): Promise<void> {
    let payload = buildRpcResponsePayload(decoded.packet, responseBody);
    const declaredLen = payload.length;
    let flags = 0;
    if (session.keys) {
      payload = await encryptAesGcm(payload, session.keys.key128);
      flags = 1;
    }
    this.sendFrame(session, toPeerId, EasyTierPacketType.RpcResp, payload, flags, declaredLen);
  }

  private async sendRpcRequest(session: Session, toPeerId: number, descriptor: DecodedEasyTierRpc['descriptor'], requestBody: Uint8Array): Promise<bigint> {
    const transactionId = randomU64();
    const domainName = session.networkName ?? this.expectedNetworkName(session.roomId);
    let payload = buildRpcRequestPayload({
      fromPeer: EDGE_PEER_ID,
      toPeer: toPeerId,
      transactionId,
      descriptor: descriptor ?? normalizeOspfDescriptor(session.ospfDescriptor, domainName),
      requestBody,
      timeoutMs: 5_000,
    });
    const declaredLen = payload.length;
    let flags = 0;
    if (session.keys) {
      payload = await encryptAesGcm(payload, session.keys.key128);
      flags = 1;
    }
    this.sendFrame(session, toPeerId, EasyTierPacketType.RpcReq, payload, flags, declaredLen);
    return transactionId;
  }

  private async bootstrapControlPlane(session: Session, toPeerId: number): Promise<void> {
    if (!session.handshakeAccepted || !session.keys || !toPeerId) return;
    await this.pushRouteUpdateTo(session, toPeerId, undefined, true);
    await this.sendRpcRequest(session, toPeerId, peerCenterDescriptor(2, session.networkName ?? this.expectedNetworkName(session.roomId)), encodeGetGlobalPeerMapRequest(0n));
    this.addEvent(session.roomId, 'rpc_seen', `peer center global map requested from peer ${toPeerId}`, session);
  }

  private sendFrame(session: Session, toPeerId: number, packetType: EasyTierPacketType, payload: Uint8Array, flags = 0, declaredLen = payload.length): void {
    if (!toPeerId) return;
    const frame = createEasyTierFrame({ fromPeerId: EDGE_PEER_ID, toPeerId, packetType, flags, forwardCounter: 1, reserved: 0, len: declaredLen }, payload);
    this.emitFrame(session, frame);
  }

  private emitFrame(session: Session, frame: Uint8Array | ArrayBuffer): void {
    const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
    session.writeQueue = session.writeQueue.then(async () => {
      await session.sendRawFrame(bytes);
      session.txBytes += bytes.byteLength;
      session.txPackets += 1;
      this.traffic.txBytes += bytes.byteLength;
      this.traffic.txPackets += 1;
    }).catch((error) => {
      if (error instanceof RangeError && error.message.includes('too large')) {
        this.addEvent(session.roomId, 'limit_exceeded', `${session.transportKind} send skipped; frame exceeds transport limit`, session);
        return;
      }
      this.addEvent(session.roomId, 'decode_error', `${session.transportKind} send failed`, session);
      this.disconnect(session);
    });
    this.state.waitUntil(session.writeQueue);
  }

  private applySyncRouteInfo(session: Session, req: SyncRouteInfoRequest): boolean {
    const now = new Date().toISOString();
    let changed = false;
    for (const info of req.peerInfos) {
      if (!info.peerId) continue;
      const snapshot = routePeerSnapshot(info, now, req.myPeerId);
      const previous = this.rawRoutePeerInfos.get(info.peerId);
      if (!previous || routePeerInfoSignature(previous) !== routePeerInfoSignature(info)) changed = true;
      this.rawRoutePeerInfos.set(info.peerId, cloneRoutePeerInfo(info));
      this.routePeers.set(info.peerId, snapshot);
      const directSessionId = this.peers.get(info.peerId);
      const directSession = directSessionId ? this.sessions.get(directSessionId) : undefined;
      if (directSession) applyRouteFields(directSession, snapshot);
      if (session.peerId === info.peerId) applyRouteFields(session, snapshot);
    }
    if (req.connBitmap || req.connPeerList) {
      const nextEdges = req.connPeerList ? edgesFromConnPeerList(req.connPeerList) : edgesFromConnBitmap(req.connBitmap!);
      const nextPeerIds = req.connPeerList ? peerIdsFromConnPeerList(req.connPeerList) : peerIdsFromConnBitmap(req.connBitmap!);
      if (topologyEdgeSignature(nextEdges) !== topologyEdgeSignature(this.connBitmapEdges)) changed = true;
      if (peerIdSignature(nextPeerIds) !== peerIdSignature(this.connBitmapPeerIds)) changed = true;
      this.connBitmapEdges = nextEdges;
      this.connBitmapPeerIds = nextPeerIds;
    }
    if (changed) this.routeVersion += 1;
    this.topologyUpdatedAt = now;
    this.requestRouteInfoResyncIfNeeded(session.roomId);
    this.queueDirectorySync(session.roomId);
    this.queueControlStatePersist();
    return changed;
  }

  private async pushRouteUpdateTo(session: Session, toPeerId: number, descriptor: DecodedEasyTierRpc['descriptor'], force = false): Promise<void> {
    const now = Date.now();
    if (!force && session.lastRoutePushAt && now - session.lastRoutePushAt < ROUTE_PUSH_MIN_MS) return;
    const routeSession = ensureOspfRouteSession(session);
    const request = this.buildSyncRouteInfoRequest(session, toPeerId, force);
    const hasConnInfo = Boolean(request.connBitmap || request.connPeerList);
    if (request.peerInfos.length === 0 && !hasConnInfo && !routeSession.needSyncInitiatorInfo) return;
    const transactionId = await this.sendRpcRequest(session, toPeerId, descriptor, encodeSyncRouteInfoRequest(request));
    routeSession.pendingRouteSyncs.set(transactionId.toString(), {
      peerInfos: request.peerInfos.map(cloneRoutePeerInfo),
      connBitmap: request.connBitmap,
      connPeerList: request.connPeerList,
    });
    session.lastRoutePushAt = now;
    this.addEvent(session.roomId, 'rpc_seen', `route update pushed to peer ${toPeerId}`, session);
  }

  private async broadcastRouteUpdates(source: Session, descriptor: DecodedEasyTierRpc['descriptor']): Promise<void> {
    const updates: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      if (session.sessionId === source.sessionId || !session.peerId || !session.handshakeAccepted) continue;
      updates.push(this.pushRouteUpdateTo(session, session.peerId, descriptor, true));
    }
    await Promise.all(updates);
  }

  private buildSyncRouteInfoRequest(session: Session, targetPeerId: number, force = false): SyncRouteInfoRequest {
    const routeSession = ensureOspfRouteSession(session);
    const peerInfos = selectRoutePeerInfosForSync(routeSession, this.routePeerInfosForUpdate(), targetPeerId, force);
    const peerIds = buildRouteUpdatePeerIds(
      targetPeerId,
      this.rawRoutePeerInfos.keys(),
      this.peers.keys(),
      this.peerCenterLastSeen().keys(),
    );
    return {
      myPeerId: EDGE_PEER_ID,
      mySessionId: routeSession.mySessionId,
      isInitiator: routeSession.weAreInitiator,
      peerInfos,
      connBitmap: peerIds.length > 0 ? buildRouteConnBitmapForUpdate(peerIds, this.routeVersion, this.connBitmapEdges, new Set(this.peers.keys())) : undefined,
    };
  }

  private routePeerInfosForUpdate(): RoutePeerInfo[] {
    const infos = new Map<number, RoutePeerInfo>();
    infos.set(EDGE_PEER_ID, {
      peerId: EDGE_PEER_ID,
      cost: 1,
      proxyCidrs: [],
      hostname: 'edgetier-worker',
      version: this.routeVersion,
      easytierVersion: 'edgetier-worker',
      networkLength: firstNetworkLength(this.rawRoutePeerInfos) ?? 24,
    });
    for (const [peerId, info] of this.rawRoutePeerInfos.entries()) {
      infos.set(peerId, cloneRoutePeerInfo({ ...info, version: info.version ?? this.routeVersion }));
    }
    return [...infos.values()].sort((a, b) => a.peerId - b.peerId);
  }

  private applyPeerCenterReport(session: Session, req: ReportPeersRequest): void {
    const sourcePeerId = req.myPeerId ?? session.peerId;
    if (!sourcePeerId) return;
    const now = new Date().toISOString();
    this.peerCenter.set(sourcePeerId, { directPeers: cloneDirectPeers(req.peerInfos), lastSeen: now });
    this.peerCenterEdges = edgesFromPeerCenter(this.peerCenter);
    this.topologyUpdatedAt = now;
    this.requestRouteInfoResyncIfNeeded(session.roomId);
    this.queueDirectorySync(session.roomId);
    this.queueControlStatePersist();
  }

  private applyPeerCenterGlobalMap(session: Session, globalPeerMap: PeerCenterGlobalMap): void {
    const now = new Date().toISOString();
    for (const [peerId, peerInfo] of globalPeerMap.entries()) {
      this.peerCenter.set(peerId, { directPeers: cloneDirectPeers(peerInfo), lastSeen: now });
    }
    this.peerCenterEdges = edgesFromPeerCenter(this.peerCenter);
    this.topologyUpdatedAt = now;
    this.requestRouteInfoResyncIfNeeded(session.roomId);
    this.queueDirectorySync(session.roomId);
    this.queueControlStatePersist();
  }

  private requestRouteInfoResyncIfNeeded(roomId: string, now = Date.now()): void {
    const missingPeerIds = missingRouteInfoPeerIds(
      this.routePeers.keys(),
      this.connBitmapPeerIds,
      this.peerCenterLastSeen().keys(),
      [EDGE_PEER_ID, ...this.peers.keys()],
    );
    if (missingPeerIds.length === 0) return;

    for (const session of this.sessions.values()) {
      if (session.roomId !== roomId || !session.peerId || !session.handshakeAccepted) continue;
      if (session.routeInfoResyncRequestedAt && now - session.routeInfoResyncRequestedAt < ROUTE_INFO_RESYNC_MIN_MS) continue;
      const mySessionId = randomU64();
      session.serverSessionId = mySessionId;
      session.ospfRouteSession = createOspfRouteSessionState(mySessionId);
      session.lastRoutePushAt = 0;
      session.routeInfoResyncRequestedAt = now;
      this.addEvent(roomId, 'rpc_seen', `route info resync requested (${missingPeerIds.length} missing peer record${missingPeerIds.length === 1 ? '' : 's'})`, session);
      this.state.waitUntil(this.pushRouteUpdateTo(session, session.peerId, session.ospfDescriptor, true).catch(() => {
        this.addEvent(roomId, 'decode_error', 'route info resync push failed', session);
      }));
    }
  }

  private buildPeerCenterGlobalMap(): PeerCenterGlobalMap {
    const map: PeerCenterGlobalMap = new Map();
    const ensure = (peerId: number): PeerInfoForGlobalMap => {
      let peerInfo = map.get(peerId);
      if (!peerInfo) {
        peerInfo = { directPeers: new Map() };
        map.set(peerId, peerInfo);
      }
      return peerInfo;
    };

    for (const [peerId, info] of this.peerCenter.entries()) {
      const peerInfo = ensure(peerId);
      for (const [toPeerId, directInfo] of info.directPeers.entries()) {
        peerInfo.directPeers.set(toPeerId, { latencyMs: directInfo.latencyMs });
        ensure(toPeerId);
      }
    }

    for (const peerId of this.routePeers.keys()) ensure(peerId);
    for (const session of this.sessions.values()) {
      if (!session.peerId) continue;
      ensure(session.peerId).directPeers.set(EDGE_PEER_ID, { latencyMs: 0 });
      ensure(EDGE_PEER_ID).directPeers.set(session.peerId, { latencyMs: 0 });
    }

    return sortPeerCenterMap(map);
  }

  private bindPeer(session: Session, peerId: number): void {
    if (session.peerId && session.peerId !== peerId && this.peers.get(session.peerId) === session.sessionId) {
      this.peers.delete(session.peerId);
    }
    session.peerId = peerId;
    this.peers.set(peerId, session.sessionId);
  }

  private bindPeerFromFrame(session: Session, header: EasyTierPacketHeader): void {
    const candidate = framePeerBindingCandidate(session.peerId, header.fromPeerId);
    if (candidate !== undefined) this.bindPeer(session, candidate);
  }

  private invalid(session: Session, message: string): void {
    session.invalidPackets += 1;
    this.traffic.invalidPackets += 1;
    this.addEvent(session.roomId, session.invalidPackets > MAX_INVALID_PACKETS_PER_SESSION ? 'limit_exceeded' : 'decode_error', message, session);
    if (session.invalidPackets > MAX_INVALID_PACKETS_PER_SESSION) this.closeSessionTransport(session, 1008, 'too many invalid packets');
    this.queueDirectorySync(session.roomId);
  }

  private disconnect(session: Session): void {
    if (!this.sessions.has(session.sessionId)) return;
    const peerId = session.peerId;
    this.sessions.delete(session.sessionId);
    if (peerId && this.peers.get(peerId) === session.sessionId) this.peers.delete(peerId);
    const peerCenterChanged = peerId ? this.removePeerCenterPeer(peerId) : false;
    const routeStateChanged = peerId ? this.removeRouteStateForSource(peerId) : false;
    const topologyChanged = peerCenterChanged || routeStateChanged;
    session.connected = false;
    this.addEvent(session.roomId, 'disconnected', `${session.transportKind} disconnected`, session);
    if (topologyChanged) {
      this.routeVersion += 1;
      this.topologyUpdatedAt = new Date().toISOString();
      this.queueControlStatePersist(true);
      this.state.waitUntil(this.broadcastRouteUpdates(session, session.ospfDescriptor).catch(() => {
        this.addEvent(session.roomId, 'decode_error', 'route cleanup broadcast failed', session);
      }));
    }
    this.queueDirectorySync(session.roomId, true);
    if (session.transportKind === 'tcp-outbound') this.queueOutboundTcpReconnect(session.roomId);
    this.state.waitUntil(this.ensureMaintenanceAlarm());
  }

  private addEvent(roomId: string, type: RelayEvent['type'], message: string, session?: Session): void {
    this.events.push({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), roomId, type, sessionId: session?.sessionId, peerId: session?.peerId, message });
    if (this.events.length > RECENT_EVENTS_LIMIT) this.events.splice(0, this.events.length - RECENT_EVENTS_LIMIT);
  }

  private async outboundTcp(request: Request, roomId: string): Promise<Response> {
    if (request.method === 'GET') return Response.json(this.outboundTcpStatus(roomId));
    if (request.method !== 'POST') return Response.json({ error: 'method not allowed' }, { status: 405 });
    await this.ensureConfiguredOutboundTcp(roomId);
    return Response.json(this.outboundTcpStatus(roomId));
  }

  private outboundTcpStatus(roomId: string) {
    const configured = resolveOutboundTcpPeers(this.env, roomId);
    return {
      roomId,
      peers: configured.map((peer) => {
        const session = this.outboundTcpSession(peer.uri);
        return {
          uri: peer.uri,
          configured: true,
          connecting: this.outboundTcpConnecting.has(outboundTcpKey(roomId, peer.uri)),
          connected: Boolean(session?.connected),
          sessionId: session?.sessionId,
          peerId: session?.peerId,
          handshakeAccepted: Boolean(session?.handshakeAccepted),
          lastSeen: session?.lastSeen,
          rxBytes: session?.rxBytes ?? 0,
          txBytes: session?.txBytes ?? 0,
        };
      }),
    };
  }

  private async ensureConfiguredOutboundTcp(roomId: string): Promise<void> {
    const peers = resolveOutboundTcpPeers(this.env, roomId);
    if (peers.length === 0) {
      for (const session of [...this.sessions.values()]) {
        if (session.roomId !== roomId || session.transportKind !== 'tcp-outbound') continue;
        this.closeSessionTransport(session, 1000, 'outbound tcp disabled for room');
        this.disconnect(session);
      }
      return;
    }
    await Promise.all(peers.map((peer) => this.connectOutboundTcp(roomId, peer)));
    await this.ensureMaintenanceAlarm();
  }

  private async connectOutboundTcp(roomId: string, peer: TcpPeerAddress): Promise<void> {
    const key = outboundTcpKey(roomId, peer.uri);
    const existing = this.outboundTcpSession(peer.uri);
    if (existing?.connected || this.outboundTcpConnecting.has(key)) return;

    const networkConfig = this.networkConfigFor(roomId);
    if (!networkConfig.secret) {
      this.addEvent(roomId, 'decode_error', 'outbound tcp skipped; network secret is not configured');
      return;
    }

    this.outboundTcpConnecting.add(key);
    this.addEvent(roomId, 'connected', 'outbound tcp connecting to configured peer');
    try {
      const { connect } = await import('cloudflare:sockets');
      const socket = connect({ hostname: peer.hostname, port: peer.port }, { allowHalfOpen: false });
      await socket.opened;
      const writer = socket.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
      const reader = socket.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      const session = this.createOutboundTcpSession(roomId, peer.uri, socket, writer);
      this.sessions.set(session.sessionId, session);
      this.addEvent(roomId, 'connected', 'outbound tcp connected to configured peer', session);
      this.queueDirectorySync(roomId, true);
      this.state.waitUntil(this.readOutboundTcp(session, reader).catch(() => {
        this.addEvent(roomId, 'disconnected', 'outbound tcp read loop failed', session);
        this.disconnect(session);
      }));
      this.state.waitUntil(socket.closed.catch(() => undefined).then(() => this.disconnect(session)));
      this.sendOutboundHandshake(session, networkConfig.networkName, networkConfig.secret);
    } catch {
      this.addEvent(roomId, 'disconnected', 'outbound tcp connection failed');
    } finally {
      this.outboundTcpConnecting.delete(key);
    }
  }

  private createOutboundTcpSession(roomId: string, peerUri: string, socket: Socket, writer: WritableStreamDefaultWriter<Uint8Array>): Session {
    const now = new Date().toISOString();
    const nowMs = Date.now();
    let open = true;
    socket.closed.finally(() => { open = false; }).catch(() => undefined);
    return {
      sessionId: crypto.randomUUID(),
      roomId,
      connected: true,
      connectedAt: now,
      lastSeen: now,
      rxBytes: 0,
      txBytes: 0,
      rxPackets: 0,
      txPackets: 0,
      transportKind: 'tcp-outbound',
      sendRawFrame: (frame) => writer.write(encodeTcpTunnelFrame(frame)),
      closeTransport: async () => {
        open = false;
        await writer.close().catch(() => undefined);
        await socket.close().catch(() => undefined);
      },
      isTransportOpen: () => open,
      invalidPackets: 0,
      messageQueue: Promise.resolve(),
      writeQueue: Promise.resolve(),
      lastPingSent: 0,
      lastPongReceived: nowMs,
      outboundPeerUri: peerUri,
    };
  }

  private sendOutboundHandshake(session: Session, networkName: string, networkSecret: string): void {
    const request = buildHandshakeRequest(networkName, networkSecret);
    session.networkName = networkName;
    session.networkSecretDigestPrefix = hex(request.networkSecretDigest).slice(0, 12) || undefined;
    session.keys = undefined;
    session.handshakeAccepted = false;
    session.outboundHandshakeSent = true;
    const payload = encodeHandshake(request);
    const frame = createEasyTierFrame({ fromPeerId: EDGE_PEER_ID, toPeerId: 0, packetType: EasyTierPacketType.HandShake, flags: 0, forwardCounter: 1, reserved: 0 }, payload);
    this.emitFrame(session, frame);
    this.addEvent(session.roomId, 'handshake_seen', 'outbound tcp handshake sent', session);
  }

  private async readOutboundTcp(session: Session, reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const decoder = new TcpTunnelFrameDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!this.sessions.has(session.sessionId)) break;
        const message = toArrayBuffer(value);
        if (!message) {
          this.invalid(session, 'unsupported outbound tcp chunk type');
          continue;
        }
        session.lastSeen = new Date().toISOString();
        session.rxBytes += message.byteLength;
        this.traffic.rxBytes += message.byteLength;
        if (message.byteLength > MAX_FRAME_SIZE) {
          this.invalid(session, 'tcp chunk size limit exceeded');
          continue;
        }
        const frames = decoder.push(message);
        if (!frames) {
          this.invalid(session, 'invalid EasyTier TCP tunnel frame');
          this.closeSessionTransport(session, 1008, 'invalid tcp frame');
          break;
        }
        for (const frame of frames) await this.onEasyTierFrame(session, frame);
      }
    } finally {
      this.disconnect(session);
    }
  }

  private outboundTcpSession(peerUri: string): Session | undefined {
    return [...this.sessions.values()].find((session) => session.transportKind === 'tcp-outbound' && session.outboundPeerUri === peerUri);
  }

  private closeSessionTransport(session: Session, code?: number, reason?: string): void {
    this.state.waitUntil(Promise.resolve(session.closeTransport(code, reason)).catch(() => undefined));
  }

  private queueOutboundTcpReconnect(roomId: string): void {
    if (resolveOutboundTcpPeers(this.env, roomId).length === 0) return;
    this.state.waitUntil(new Promise((resolve) => setTimeout(resolve, 5_000)).then(() => this.ensureConfiguredOutboundTcp(roomId)));
  }

  private async seed(request: Request, roomId: string): Promise<Response> {
    const body = await request.json().catch(() => ({})) as { count?: number; clear?: boolean };
    if (body.clear) {
      this.seededPeers = [];
      this.routePeers = new Map();
      this.rawRoutePeerInfos = new Map();
      this.connBitmapPeerIds = [];
      this.connBitmapEdges = [];
      this.peerCenter = new Map();
      this.peerCenterEdges = [];
      this.topologyUpdatedAt = undefined;
      this.events = [];
      this.traffic = emptyTrafficCounters();
      this.trafficSamples = [];
      this.sessionRateBaselines = new Map();
      this.queueControlStatePersist(true);
      this.queueDirectorySync(roomId, true);
      return Response.json({ ok: true, cleared: true });
    }
    const count = Math.min(Math.max(body.count ?? 3, 1), 16);
    const now = Date.now();
    this.seededPeers = [];
    for (let index = 0; index < count; index += 1) {
      const peerId = 1000 + index;
      const connected = index % 4 !== 0;
      const rxBytes = 4096 * (index + 1);
      const txBytes = 2048 * (index + 1);
      this.seededPeers.push({
        sessionId: `seed-${peerId}`,
        roomId,
        peerId,
        networkName: roomId,
        networkSecretDigestPrefix: `seed${index}`,
        connected,
        connectedAt: new Date(now - (index + 1) * 60_000).toISOString(),
        lastSeen: new Date(now - index * 1_000).toISOString(),
        rxBytes,
        txBytes,
        rxPackets: index + 5,
        txPackets: index + 2,
      });
      this.traffic.rxBytes += rxBytes;
      this.traffic.txBytes += txBytes;
      this.traffic.rxPackets += index + 5;
      this.traffic.txPackets += index + 2;
      this.traffic.forwardedPackets += index + 1;
      if (index % 4 === 0) this.traffic.unroutablePackets += 1;
      this.addEvent(roomId, 'connected', `seed peer ${peerId} connected`);
      this.addEvent(roomId, 'handshake_seen', `seed peer ${peerId} handshake observed (synthetic)`);
      if (index % 3 === 0) this.addEvent(roomId, 'packet_forwarded', `seed packet forwarded to peer ${peerId}`);
      if (index % 4 === 0) this.addEvent(roomId, 'packet_unroutable', `seed packet to peer ${peerId} not routable`);
      if (!connected) this.addEvent(roomId, 'disconnected', `seed peer ${peerId} disconnected`);
    }
    this.queueDirectorySync(roomId, true);
    return Response.json({ ok: true, seeded: count });
  }

  private snapshot(roomId: string): RoomSnapshot {
    if (this.pruneStaleRouteState()) this.queueControlStatePersist();
    const traffic = this.snapshotTraffic();
    const peerLatencies = peerLatenciesByPeer(this.peerCenterEdges);
    const livePeers = [...this.sessions.values()].map(({
      sendRawFrame: _sendRawFrame,
      closeTransport: _closeTransport,
      isTransportOpen: _isTransportOpen,
      invalidPackets: _invalidPackets,
      messageQueue: _messageQueue,
      writeQueue: _writeQueue,
      keys: _keys,
      serverSessionId: _serverSessionId,
      handshakeAccepted: _handshakeAccepted,
      lastRoutePushAt: _lastRoutePushAt,
      lastPingSent: _lastPingSent,
      lastPongReceived: _lastPongReceived,
      ospfDescriptor: _ospfDescriptor,
      ospfRouteSession: _ospfRouteSession,
      outboundPeerUri: _outboundPeerUri,
      outboundHandshakeSent: _outboundHandshakeSent,
      routeInfoResyncRequestedAt: _routeInfoResyncRequestedAt,
      ...peer
    }) => ({ ...peer, latencyMs: peer.peerId ? peerLatencies.get(peer.peerId) ?? peer.latencyMs : peer.latencyMs }));
    const livePeerIds = new Set(livePeers.map((peer) => peer.peerId).filter((peerId): peerId is number => peerId !== undefined));
    const peerCenterLastSeen = this.peerCenterLastSeen();
    const routeOnlyPeers: PeerSnapshot[] = [...this.routePeers.values()]
      .filter((peer) => !livePeerIds.has(peer.peerId))
      .map((peer) => ({
        sessionId: `route-${peer.peerId}`,
        roomId,
        peerId: peer.peerId,
        networkName: this.expectedNetworkName(roomId),
        hostname: peer.hostname,
        virtualIpv4: peer.virtualIpv4,
        virtualIpv6: peer.virtualIpv6,
        udpNatType: peer.udpNatType,
        tcpNatType: peer.tcpNatType,
        proxyCidrs: peer.proxyCidrs,
        easytierVersion: peer.easytierVersion,
        routeVersion: peer.routeVersion,
        peerRouteId: peer.peerRouteId,
        networkLength: peer.networkLength,
        cost: peer.cost,
        latencyMs: peerLatencies.get(peer.peerId) ?? peer.latencyMs,
        lossRate: peer.lossRate,
        connected: false,
        connectedAt: peer.lastSeen,
        lastSeen: peer.lastSeen,
        rxBytes: 0,
        txBytes: 0,
        rxPackets: 0,
        txPackets: 0,
      }));
    const peerCenterOnlyPeers: PeerSnapshot[] = [...peerCenterLastSeen.entries()]
      .filter(([peerId]) => peerId !== EDGE_PEER_ID && !livePeerIds.has(peerId) && !this.routePeers.has(peerId))
      .sort(([left], [right]) => left - right)
      .map(([peerId, lastSeen]) => ({
        sessionId: `peer-center-${peerId}`,
        roomId,
        peerId,
        networkName: this.expectedNetworkName(roomId),
        proxyCidrs: [],
        latencyMs: peerLatencies.get(peerId),
        connected: false,
        connectedAt: lastSeen,
        lastSeen,
        rxBytes: 0,
        txBytes: 0,
        rxPackets: 0,
        txPackets: 0,
      }));
    const lastActivity = this.events.at(-1)?.timestamp;
    const includeEdgePeer = this.hasObservedNetworkState();
    const edgePeer: PeerSnapshot[] = includeEdgePeer ? [{
      sessionId: `local-${EDGE_PEER_ID}`,
      roomId,
      peerId: EDGE_PEER_ID,
      networkName: this.expectedNetworkName(roomId),
      hostname: 'edgetier-worker',
      proxyCidrs: [],
      easytierVersion: 'edgetier-worker',
      routeVersion: this.routeVersion,
      networkLength: firstNetworkLength(this.rawRoutePeerInfos) ?? 24,
      latencyMs: 0,
      connected: this.sessions.size > 0,
      connectedAt: this.events[0]?.timestamp ?? lastActivity ?? new Date().toISOString(),
      lastSeen: lastActivity ?? new Date().toISOString(),
      rxBytes: 0,
      txBytes: 0,
      rxPackets: 0,
      txPackets: 0,
    }] : [];
    const peers = [...edgePeer, ...livePeers, ...routeOnlyPeers, ...peerCenterOnlyPeers, ...this.seededPeers];
    const peerIds = new Set<number>();
    if (includeEdgePeer) peerIds.add(EDGE_PEER_ID);
    for (const peerId of this.peers.keys()) peerIds.add(peerId);
    for (const peerId of this.routePeers.keys()) peerIds.add(peerId);
    for (const peerId of peerCenterLastSeen.keys()) peerIds.add(peerId);
    const peerCount = peerIds.size + this.seededPeers.length;
    const websocketCount = [...this.sessions.values()].filter((session) => session.transportKind === 'websocket').length + this.seededPeers.length;
    return { roomId, peerCount, websocketCount, bytes: this.traffic.rxBytes + this.traffic.txBytes, lastActivity, traffic, peers, recentEvents: this.events.slice(-50), topology: this.snapshotTopology(roomId) };
  }

  private snapshotTopology(roomId: string): TopologySnapshot {
    if (this.pruneStaleRouteState()) this.queueControlStatePersist();
    const nodes = new Map<number, RoutePeerSnapshot>();
    for (const peer of this.routePeers.values()) nodes.set(peer.peerId, peer);
    if (this.hasObservedNetworkState()) {
      nodes.set(EDGE_PEER_ID, {
        peerId: EDGE_PEER_ID,
        hostname: 'edgetier-worker',
        proxyCidrs: [],
        easytierVersion: 'edgetier-worker',
        routeVersion: this.routeVersion,
        networkLength: firstNetworkLength(this.rawRoutePeerInfos) ?? 24,
        lastSeen: this.topologyUpdatedAt ?? this.events.at(-1)?.timestamp ?? new Date().toISOString(),
      });
    }
    for (const [peerId, info] of this.peerCenter.entries()) {
      if (!nodes.has(peerId)) nodes.set(peerId, { peerId, proxyCidrs: [], lastSeen: info.lastSeen });
      for (const toPeerId of info.directPeers.keys()) {
        if (!nodes.has(toPeerId)) nodes.set(toPeerId, { peerId: toPeerId, proxyCidrs: [], lastSeen: info.lastSeen });
      }
    }

    const edges = mergeTopologyEdges(this.connBitmapEdges, this.peerCenterEdges);
    const peerLatencies = peerLatenciesByPeer(this.peerCenterEdges);
    const sortedNodes = [...nodes.values()]
      .map((node) => ({ ...node, latencyMs: node.peerId === EDGE_PEER_ID ? 0 : peerLatencies.get(node.peerId) ?? node.latencyMs }))
      .sort((a, b) => a.peerId - b.peerId);
    const connectionMatrix = buildConnectionMatrix(this.connBitmapEdges, this.connBitmapPeerIds);
    const routes = buildRoutePaths(sortedNodes, edges, new Set(this.peers.keys()), EDGE_PEER_ID);

    return {
      roomId,
      nodes: sortedNodes,
      edges,
      routes,
      connectionMatrix,
      summary: buildTopologySummary(sortedNodes, edges, routes, connectionMatrix, relayDropRate(this.traffic)),
      ...(this.topologyUpdatedAt ? { updatedAt: this.topologyUpdatedAt } : {}),
    };
  }

  private snapshotTraffic(): TrafficSnapshot {
    this.recordTrafficSample();
    const latest = this.trafficSamples.at(-1);
    return {
      ...this.traffic,
      samples: [...this.trafficSamples],
      summary: buildTrafficSummary(this.traffic, latest),
    };
  }

  private recordTrafficSample(now = Date.now()): void {
    const previous = this.trafficSamples.at(-1);
    if (previous) {
      const previousAt = Date.parse(previous.timestamp);
      if (Number.isFinite(previousAt) && now - previousAt < TRAFFIC_SAMPLE_INTERVAL_MS) {
        this.updateSessionRates(now, false);
        return;
      }
    }
    this.trafficSamples.push(buildTrafficSample(previous, this.traffic, now));
    if (this.trafficSamples.length > TRAFFIC_SAMPLES_LIMIT) this.trafficSamples.splice(0, this.trafficSamples.length - TRAFFIC_SAMPLES_LIMIT);
    this.updateSessionRates(now, true);
  }

  private updateSessionRates(now: number, force: boolean): void {
    const activeSessionIds = new Set<string>();
    for (const session of this.sessions.values()) {
      activeSessionIds.add(session.sessionId);
      const previous = this.sessionRateBaselines.get(session.sessionId);
      const elapsedSeconds = previous ? Math.max(0, (now - previous.at) / 1000) : 0;
      if (force && previous && elapsedSeconds > 0) {
        session.rxBytesPerSecond = rate(session.rxBytes - previous.rxBytes, elapsedSeconds);
        session.txBytesPerSecond = rate(session.txBytes - previous.txBytes, elapsedSeconds);
        session.rxPacketsPerSecond = rate(session.rxPackets - previous.rxPackets, elapsedSeconds);
        session.txPacketsPerSecond = rate(session.txPackets - previous.txPackets, elapsedSeconds);
      } else {
        session.rxBytesPerSecond ??= 0;
        session.txBytesPerSecond ??= 0;
        session.rxPacketsPerSecond ??= 0;
        session.txPacketsPerSecond ??= 0;
      }
      if (force || !previous) {
        this.sessionRateBaselines.set(session.sessionId, {
          at: now,
          rxBytes: session.rxBytes,
          txBytes: session.txBytes,
          rxPackets: session.rxPackets,
          txPackets: session.txPackets,
        });
      }
    }
    for (const sessionId of this.sessionRateBaselines.keys()) {
      if (!activeSessionIds.has(sessionId)) this.sessionRateBaselines.delete(sessionId);
    }
  }

  private hasObservedNetworkState(): boolean {
    return this.sessions.size > 0 || this.routePeers.size > 0 || this.peerCenter.size > 0;
  }

  private peerCenterLastSeen(): Map<number, string> {
    const out = new Map<number, string>();
    for (const [peerId, info] of this.peerCenter.entries()) {
      out.set(peerId, info.lastSeen);
      for (const toPeerId of info.directPeers.keys()) {
        if (!out.has(toPeerId)) out.set(toPeerId, info.lastSeen);
      }
    }
    return out;
  }

  private networkConfigFor(roomId: string): NetworkConfig {
    return resolveNetworkConfig(this.env, roomId);
  }

  private expectedNetworkName(roomId: string): string {
    return this.networkConfigFor(roomId).networkName;
  }

  private removePeerCenterPeer(peerId: number): boolean {
    let changed = this.peerCenter.delete(peerId);
    for (const info of this.peerCenter.values()) {
      if (info.directPeers.delete(peerId)) changed = true;
    }
    this.peerCenterEdges = edgesFromPeerCenter(this.peerCenter);
    return changed;
  }

  private removeRouteStateForSource(peerId: number): boolean {
    let changed = false;
    for (const [routePeerId, peer] of this.routePeers.entries()) {
      if (this.peers.has(routePeerId)) continue;
      if (routePeerId === peerId || peer.sourcePeerId === peerId) {
        this.routePeers.delete(routePeerId);
        this.rawRoutePeerInfos.delete(routePeerId);
        changed = true;
      }
    }
    if (changed) this.pruneTopologyEdgesToKnownPeers();
    return changed;
  }

  private pruneStaleRouteState(now = Date.now()): boolean {
    let changed = false;
    const livePeerIds = new Set(this.peers.keys());
    for (const [peerId, peer] of this.routePeers.entries()) {
      if (shouldPruneRoutePeer(peer, livePeerIds, now)) {
        this.routePeers.delete(peerId);
        this.rawRoutePeerInfos.delete(peerId);
        changed = true;
      }
    }

    for (const [peerId, info] of this.peerCenter.entries()) {
      if (this.peers.has(peerId)) continue;
      const lastSeen = Date.parse(info.lastSeen);
      if (!Number.isFinite(lastSeen) || now - lastSeen > ROUTE_STATE_TTL_MS) {
        this.peerCenter.delete(peerId);
        changed = true;
      }
    }

    if (changed) {
      for (const peerId of this.rawRoutePeerInfos.keys()) {
        if (!this.routePeers.has(peerId)) this.rawRoutePeerInfos.delete(peerId);
      }
      for (const info of this.peerCenter.values()) {
        for (const peerId of info.directPeers.keys()) {
          if (!this.routePeers.has(peerId) && !this.peers.has(peerId)) info.directPeers.delete(peerId);
        }
      }
      this.peerCenterEdges = edgesFromPeerCenter(this.peerCenter);
      this.pruneTopologyEdgesToKnownPeers();
      this.routeVersion += 1;
      this.topologyUpdatedAt = new Date(now).toISOString();
    }
    return changed;
  }

  private pruneTopologyEdgesToKnownPeers(): void {
    const known = new Set<number>([EDGE_PEER_ID]);
    for (const peerId of this.peers.keys()) known.add(peerId);
    for (const peerId of this.routePeers.keys()) known.add(peerId);
    for (const peerId of this.peerCenter.keys()) known.add(peerId);
    for (const info of this.peerCenter.values()) {
      for (const peerId of info.directPeers.keys()) known.add(peerId);
    }
    this.connBitmapPeerIds = this.connBitmapPeerIds.filter((peerId) => known.has(peerId));
    this.connBitmapEdges = this.connBitmapEdges.filter((edge) => known.has(edge.fromPeerId) && known.has(edge.toPeerId));
    this.peerCenterEdges = this.peerCenterEdges.filter((edge) => known.has(edge.fromPeerId) && known.has(edge.toPeerId));
  }

  private runHeartbeatMaintenance(now = Date.now()): void {
    for (const session of [...this.sessions.values()]) {
      if (!session.isTransportOpen()) {
        this.disconnect(session);
        continue;
      }

      const lastSeen = Date.parse(session.lastSeen);
      if (session.peerId && session.lastPingSent > 0 && Number.isFinite(lastSeen) && now - lastSeen > CONNECTION_TIMEOUT_MS) {
        this.addEvent(session.roomId, 'disconnected', `${session.transportKind} heartbeat timeout`, session);
        this.closeSessionTransport(session, 1001, 'heartbeat timeout');
        this.disconnect(session);
        continue;
      }

      if (session.peerId && now - session.lastPingSent >= HEARTBEAT_INTERVAL_MS) {
        this.sendFrame(session, session.peerId, EasyTierPacketType.Ping, new TextEncoder().encode('ping'));
        session.lastPingSent = now;
      }

      if (session.peerId && session.handshakeAccepted) {
        const routeSession = ensureOspfRouteSession(session);
        const shouldSyncAsInitiator = routeSession.weAreInitiator && (!session.lastRoutePushAt || now - session.lastRoutePushAt >= ROUTE_PUSH_MIN_MS);
        const shouldSyncInitiatorFlag = routeSession.needSyncInitiatorInfo && (!session.lastRoutePushAt || now - session.lastRoutePushAt >= 1_000);
        if (shouldSyncAsInitiator || shouldSyncInitiatorFlag) {
          this.state.waitUntil(this.pushRouteUpdateTo(session, session.peerId, session.ospfDescriptor, shouldSyncInitiatorFlag).catch(() => {
            this.addEvent(session.roomId, 'decode_error', 'periodic route sync failed', session);
          }));
        }
      }
    }
  }

  private async loadControlState(): Promise<void> {
    const stored = await this.state.storage.get<PersistedControlState>(CONTROL_STATE_STORAGE_KEY);
    if (!stored) return;
    this.routeVersion = Math.max(this.routeVersion, safeU32(stored.routeVersion, this.routeVersion));
    this.topologyUpdatedAt = typeof stored.topologyUpdatedAt === 'string' ? stored.topologyUpdatedAt : undefined;
    this.routePeers = new Map((stored.routePeers ?? [])
      .filter((peer) => Number.isInteger(peer.peerId) && peer.peerId > 0)
      .map((peer) => [peer.peerId, { ...peer, proxyCidrs: Array.isArray(peer.proxyCidrs) ? peer.proxyCidrs : [] }]));
    this.rawRoutePeerInfos = new Map((stored.rawRoutePeerInfos ?? [])
      .filter((info) => Number.isInteger(info.peerId) && info.peerId > 0)
      .map((info) => [info.peerId, cloneRoutePeerInfo({ ...info, proxyCidrs: Array.isArray(info.proxyCidrs) ? info.proxyCidrs : [] })]));
    this.connBitmapEdges = sanitizeTopologyEdges(stored.connBitmapEdges ?? []);
    this.connBitmapPeerIds = sanitizePeerIds(stored.connBitmapPeerIds ?? []);
    this.peerCenter = new Map();
    for (const entry of stored.peerCenter ?? []) {
      if (!Number.isInteger(entry.peerId) || entry.peerId <= 0) continue;
      this.peerCenter.set(entry.peerId, {
        lastSeen: typeof entry.lastSeen === 'string' ? entry.lastSeen : new Date().toISOString(),
        directPeers: new Map((entry.directPeers ?? [])
          .filter(([peerId, info]) => Number.isInteger(peerId) && peerId > 0 && Number.isFinite(info?.latencyMs))
          .map(([peerId, info]) => [peerId, { latencyMs: info.latencyMs }])),
      });
    }
    this.peerCenterEdges = edgesFromPeerCenter(this.peerCenter);
    if (this.pruneStaleRouteState()) await this.persistControlState();
  }

  private queueControlStatePersist(immediate = false): void {
    if (immediate) {
      this.state.waitUntil(this.persistControlState());
      return;
    }
    const now = Date.now();
    if (now - this.lastControlStatePersist >= CONTROL_STATE_PERSIST_MIN_MS) {
      this.state.waitUntil(this.persistControlState());
      return;
    }
    if (this.controlStatePersistQueued) return;
    this.controlStatePersistQueued = true;
    const delayMs = CONTROL_STATE_PERSIST_MIN_MS - (now - this.lastControlStatePersist);
    this.state.waitUntil(new Promise((resolve) => setTimeout(resolve, delayMs)).then(() => this.persistControlState()));
  }

  private async persistControlState(): Promise<void> {
    this.controlStatePersistQueued = false;
    this.lastControlStatePersist = Date.now();
    await this.state.storage.put<PersistedControlState>(CONTROL_STATE_STORAGE_KEY, {
      routeVersion: this.routeVersion,
      ...(this.topologyUpdatedAt ? { topologyUpdatedAt: this.topologyUpdatedAt } : {}),
      routePeers: [...this.routePeers.values()],
      rawRoutePeerInfos: [...this.rawRoutePeerInfos.values()].map(cloneRoutePeerInfo),
      connBitmapPeerIds: [...this.connBitmapPeerIds],
      connBitmapEdges: [...this.connBitmapEdges],
      peerCenter: [...this.peerCenter.entries()].map(([peerId, info]) => ({
        peerId,
        lastSeen: info.lastSeen,
        directPeers: [...info.directPeers.entries()].map(([toPeerId, direct]) => [toPeerId, { latencyMs: direct.latencyMs }]),
      })),
    });
  }

  private async ensureMaintenanceAlarm(): Promise<void> {
    const roomId = this.currentRoomId();
    const hasConfiguredOutbound = roomId ? resolveOutboundTcpPeers(this.env, roomId).length > 0 : false;
    if (this.sessions.size === 0 && !this.hasObservedNetworkState() && !hasConfiguredOutbound) return;
    const existing = await this.state.storage.getAlarm();
    const next = Date.now() + MAINTENANCE_ALARM_MS;
    if (existing === null || existing <= Date.now()) await this.state.storage.setAlarm(next);
  }

  private currentRoomId(): string | undefined {
    const session = this.sessions.values().next().value as Session | undefined;
    return session?.roomId ?? this.events.at(-1)?.roomId;
  }

  private queueDirectorySync(roomId: string, immediate = false): void {
    if (immediate) {
      this.state.waitUntil(this.syncDirectory(roomId));
      return;
    }
    const now = Date.now();
    if (now - this.lastDirectorySync >= DIRECTORY_SYNC_MIN_MS) {
      this.state.waitUntil(this.syncDirectory(roomId));
      return;
    }
    if (this.directorySyncQueued) return;
    this.directorySyncQueued = true;
    const delayMs = DIRECTORY_SYNC_MIN_MS - (now - this.lastDirectorySync);
    this.state.waitUntil(new Promise((resolve) => setTimeout(resolve, delayMs)).then(() => this.syncDirectory(roomId)));
  }

  private async syncDirectory(roomId: string): Promise<void> {
    this.directorySyncQueued = false;
    this.lastDirectorySync = Date.now();
    const snapshot = this.snapshot(roomId);
    await this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('global')).fetch('https://directory/', {
      method: 'POST',
      body: JSON.stringify({
        roomId: snapshot.roomId,
        peerCount: snapshot.peerCount,
        websocketCount: snapshot.websocketCount,
        bytes: snapshot.bytes,
        lastActivity: snapshot.lastActivity,
      }),
    });
  }
}

/**
 * Normalize a WebSocket message payload to an ArrayBuffer. Cloudflare Workers
 * delivers binary frames as ArrayBuffer, but text frames and ArrayBufferView
 * inputs (e.g. a Node `ws` client sending a Buffer) must be handled too. A
 * Buffer/TypedArray may have a non-zero byteOffset, so slice the exact range.
 */
export function toArrayBuffer(data: unknown): ArrayBuffer | null {
  if (typeof data === 'string') return new TextEncoder().encode(data).buffer;
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength));
    return copy.buffer;
  }
  return null;
}

function emptyTrafficCounters(): TrafficCounters {
  return { rxBytes: 0, txBytes: 0, rxPackets: 0, txPackets: 0, forwardedPackets: 0, unroutablePackets: 0, invalidPackets: 0 };
}

export function buildTrafficSample(previous: TrafficSample | undefined, counters: TrafficCounters, now: number): TrafficSample {
  const elapsedSeconds = previous ? Math.max(0, (now - Date.parse(previous.timestamp)) / 1000) : 0;
  const previousDrops = previous ? previous.unroutablePackets + previous.invalidPackets : 0;
  const currentDrops = counters.unroutablePackets + counters.invalidPackets;
  const rxPacketDelta = previous ? counters.rxPackets - previous.rxPackets : counters.rxPackets;
  const dropDelta = previous ? currentDrops - previousDrops : currentDrops;

  return {
    timestamp: new Date(now).toISOString(),
    rxBytes: counters.rxBytes,
    txBytes: counters.txBytes,
    rxPackets: counters.rxPackets,
    txPackets: counters.txPackets,
    forwardedPackets: counters.forwardedPackets,
    unroutablePackets: counters.unroutablePackets,
    invalidPackets: counters.invalidPackets,
    rxBytesPerSecond: previous && elapsedSeconds > 0 ? rate(counters.rxBytes - previous.rxBytes, elapsedSeconds) : 0,
    txBytesPerSecond: previous && elapsedSeconds > 0 ? rate(counters.txBytes - previous.txBytes, elapsedSeconds) : 0,
    rxPacketsPerSecond: previous && elapsedSeconds > 0 ? rate(counters.rxPackets - previous.rxPackets, elapsedSeconds) : 0,
    txPacketsPerSecond: previous && elapsedSeconds > 0 ? rate(counters.txPackets - previous.txPackets, elapsedSeconds) : 0,
    relayDropRate: ratio(dropDelta, rxPacketDelta),
  };
}

export function buildTrafficSummary(counters: TrafficCounters, latest: TrafficSample | undefined): TrafficSummary {
  return {
    rxBytesPerSecond: latest?.rxBytesPerSecond ?? 0,
    txBytesPerSecond: latest?.txBytesPerSecond ?? 0,
    rxPacketsPerSecond: latest?.rxPacketsPerSecond ?? 0,
    txPacketsPerSecond: latest?.txPacketsPerSecond ?? 0,
    relayDropRate: relayDropRate(counters),
    totalRelayDropPackets: counters.unroutablePackets + counters.invalidPackets,
    ...(latest ? { sampledAt: latest.timestamp } : {}),
  };
}

async function decryptEasyTierPayload(payload: Uint8Array, keys: DerivedKeys): Promise<Uint8Array> {
  try {
    return await decryptAesGcm(payload, keys.key128);
  } catch {
    return decryptAesGcm(payload, keys.key256);
  }
}

function randomU64(): bigint {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return (BigInt(words[0]) << 32n) | BigInt(words[1]);
}

function ensureOspfRouteSession(session: Session): OspfRouteSessionState {
  if (!session.ospfRouteSession) {
    const mySessionId = session.serverSessionId ?? randomU64();
    session.serverSessionId = mySessionId;
    session.ospfRouteSession = createOspfRouteSessionState(mySessionId);
  }
  return session.ospfRouteSession;
}

export function createOspfRouteSessionState(mySessionId: bigint): OspfRouteSessionState {
  return {
    mySessionId,
    weAreInitiator: true,
    remoteIsInitiator: false,
    needSyncInitiatorInfo: true,
    dstSavedPeerInfoVersions: new Map(),
    dstSavedConnInfoVersions: new Map(),
    pendingRouteSyncs: new Map(),
  };
}

export function updateOspfRouteSessionFromRequest(state: OspfRouteSessionState, request: SyncRouteInfoRequest, remotePeerId: number): void {
  if (request.mySessionId !== undefined) updateRemoteOspfSessionId(state, request.mySessionId);
  const remoteIsInitiator = Boolean(request.isInitiator);
  state.remoteIsInitiator = remoteIsInitiator;
  if (remoteIsInitiator && state.weAreInitiator) {
    state.weAreInitiator = false;
    state.needSyncInitiatorInfo = true;
  } else if (!remoteIsInitiator && !state.weAreInitiator) {
    state.weAreInitiator = true;
    state.needSyncInitiatorInfo = true;
  }
  markRemoteSavedRouteInfo(state, request.peerInfos, remotePeerId);
  markRemoteSavedConnInfo(state, request.connBitmap, request.connPeerList, remotePeerId);
}

export function applyOspfRouteSessionResponse(
  state: OspfRouteSessionState,
  response: SyncRouteInfoResponse,
  pending: PendingRouteSync | undefined,
  remotePeerId: number,
  now = Date.now(),
): boolean {
  if (response.error !== undefined) {
    state.needSyncInitiatorInfo = true;
    return false;
  }
  if (response.isInitiator !== undefined) state.remoteIsInitiator = response.isInitiator;
  if (response.sessionId !== undefined) updateRemoteOspfSessionId(state, response.sessionId);
  if (pending) {
    markRemoteSavedRouteInfo(state, pending.peerInfos, remotePeerId);
    markRemoteSavedConnInfo(state, pending.connBitmap, pending.connPeerList, remotePeerId);
  }
  state.needSyncInitiatorInfo = false;
  state.lastSyncSuccessAt = now;
  return true;
}

export function selectRoutePeerInfosForSync(
  state: OspfRouteSessionState,
  infos: RoutePeerInfo[],
  remotePeerId: number,
  force: boolean,
): RoutePeerInfo[] {
  return infos.filter((info) => {
    if (!info.peerId || info.peerId === remotePeerId) return false;
    const version = info.version ?? 0;
    if (version === 0) return false;
    if (force) return true;
    return (state.dstSavedPeerInfoVersions.get(info.peerId) ?? 0) < version;
  });
}

function updateRemoteOspfSessionId(state: OspfRouteSessionState, sessionId: bigint): void {
  if (state.remoteSessionId === sessionId) return;
  state.remoteSessionId = sessionId;
  state.dstSavedPeerInfoVersions.clear();
  state.dstSavedConnInfoVersions.clear();
  state.pendingRouteSyncs.clear();
  state.lastSyncSuccessAt = undefined;
}

function markRemoteSavedRouteInfo(state: OspfRouteSessionState, infos: RoutePeerInfo[], remotePeerId: number): void {
  for (const info of infos) {
    const version = info.version ?? 0;
    if (!info.peerId || info.peerId === remotePeerId || version === 0) continue;
    const previous = state.dstSavedPeerInfoVersions.get(info.peerId) ?? 0;
    if (version > previous) state.dstSavedPeerInfoVersions.set(info.peerId, version);
  }
}

function markRemoteSavedConnInfo(
  state: OspfRouteSessionState,
  connBitmap: RouteConnBitmap | undefined,
  connPeerList: RouteConnPeerList | undefined,
  remotePeerId: number,
): void {
  for (const item of connBitmap?.peerIds ?? []) markRemoteSavedConnPeerVersion(state, item.peerId, item.version, remotePeerId);
  for (const item of connPeerList?.peerConnInfos ?? []) {
    if (item.peerId) markRemoteSavedConnPeerVersion(state, item.peerId.peerId, item.peerId.version, remotePeerId);
  }
}

function markRemoteSavedConnPeerVersion(state: OspfRouteSessionState, peerId: number, version: number, remotePeerId: number): void {
  if (!peerId || peerId === remotePeerId || version === 0) return;
  const previous = state.dstSavedConnInfoVersions.get(peerId) ?? 0;
  if (version > previous) state.dstSavedConnInfoVersions.set(peerId, version);
}

function routePeerSnapshot(info: RoutePeerInfo, lastSeen: string, sourcePeerId?: number): RoutePeerSnapshot {
  return {
    peerId: info.peerId,
    hostname: info.hostname,
    virtualIpv4: formatIpv4Cidr(info),
    virtualIpv6: info.ipv6,
    udpNatType: natTypeName(info.udpNatType),
    tcpNatType: natTypeName(info.tcpNatType),
    proxyCidrs: info.proxyCidrs,
    easytierVersion: info.easytierVersion,
    routeVersion: info.version,
    peerRouteId: info.peerRouteId,
    networkLength: info.networkLength,
    cost: info.cost,
    sourcePeerId,
    lastSeen,
  };
}

function applyRouteFields(peer: PeerSnapshot, route: RoutePeerSnapshot): void {
  peer.hostname = route.hostname;
  peer.virtualIpv4 = route.virtualIpv4;
  peer.virtualIpv6 = route.virtualIpv6;
  peer.udpNatType = route.udpNatType;
  peer.tcpNatType = route.tcpNatType;
  peer.proxyCidrs = route.proxyCidrs;
  peer.easytierVersion = route.easytierVersion;
  peer.routeVersion = route.routeVersion;
  peer.peerRouteId = route.peerRouteId;
  peer.networkLength = route.networkLength;
  peer.cost = route.cost;
}

function formatIpv4Cidr(info: RoutePeerInfo): string | undefined {
  if (!info.ipv4) return undefined;
  return info.networkLength ? `${info.ipv4}/${info.networkLength}` : info.ipv4;
}

function normalizeOspfDescriptor(descriptor: DecodedEasyTierRpc['descriptor'], domainName: string): NonNullable<DecodedEasyTierRpc['descriptor']> {
  return {
    domainName: descriptor?.domainName ?? domainName,
    protoName: descriptor?.protoName ?? 'OspfRouteRpc',
    serviceName: descriptor?.serviceName ?? 'OspfRouteRpc',
    methodIndex: descriptor?.methodIndex ?? 1,
  };
}

function peerCenterDescriptor(methodIndex: number, domainName: string): NonNullable<DecodedEasyTierRpc['descriptor']> {
  return {
    domainName,
    protoName: 'PeerCenterRpc',
    serviceName: 'PeerCenterRpc',
    methodIndex,
  };
}

function cloneRoutePeerInfo(info: RoutePeerInfo): RoutePeerInfo {
  return {
    peerId: info.peerId,
    cost: info.cost,
    ipv4: info.ipv4,
    ipv6: info.ipv6,
    proxyCidrs: [...info.proxyCidrs],
    hostname: info.hostname,
    udpNatType: info.udpNatType,
    tcpNatType: info.tcpNatType,
    version: info.version,
    easytierVersion: info.easytierVersion,
    peerRouteId: info.peerRouteId,
    networkLength: info.networkLength,
  };
}

function routePeerInfoSignature(info: RoutePeerInfo): string {
  return JSON.stringify([
    info.peerId,
    info.cost,
    info.ipv4,
    info.ipv6,
    info.proxyCidrs,
    info.hostname,
    info.udpNatType,
    info.tcpNatType,
    info.version,
    info.easytierVersion,
    info.peerRouteId,
    info.networkLength,
  ]);
}

function topologyEdgeSignature(edges: TopologyEdge[]): string {
  return JSON.stringify([...edges].sort(compareTopologyEdges).map((edge) => [edge.fromPeerId, edge.toPeerId, edge.source, edge.latencyMs]));
}

function peerIdSignature(peerIds: number[]): string {
  return JSON.stringify([...peerIds].sort((a, b) => a - b));
}

export function shouldPruneRoutePeer(
  peer: Pick<RoutePeerSnapshot, 'peerId' | 'sourcePeerId' | 'lastSeen'>,
  livePeerIds: Set<number>,
  now: number,
): boolean {
  if (livePeerIds.has(peer.peerId)) return false;
  if (peer.sourcePeerId && livePeerIds.has(peer.sourcePeerId)) return false;
  const lastSeen = Date.parse(peer.lastSeen);
  return !Number.isFinite(lastSeen) || now - lastSeen > ROUTE_STATE_TTL_MS;
}

export function missingRouteInfoPeerIds(
  routePeerIds: Iterable<number>,
  connBitmapPeerIds: Iterable<number>,
  peerCenterPeerIds: Iterable<number>,
  excludedPeerIds: Iterable<number> = [],
): number[] {
  const knownRoutes = new Set(routePeerIds);
  const excluded = new Set(excludedPeerIds);
  return [...new Set([...connBitmapPeerIds, ...peerCenterPeerIds])]
    .filter((peerId) => Number.isInteger(peerId) && peerId > 0 && !knownRoutes.has(peerId) && !excluded.has(peerId))
    .sort((a, b) => a - b);
}

function firstNetworkLength(infos: Map<number, RoutePeerInfo>): number | undefined {
  for (const info of infos.values()) {
    if (info.networkLength) return info.networkLength;
  }
  return undefined;
}

export function buildRouteConnBitmapForUpdate(peerIds: number[], version: number, observedEdges: TopologyEdge[], livePeerIds: Set<number>): RouteConnBitmap {
  const orderedPeerIds = [...new Set(peerIds)].filter((peerId) => peerId > 0).sort((a, b) => a - b);
  const size = orderedPeerIds.length;
  const bitmap = new Uint8Array(Math.ceil((size * size) / 8));
  const indexByPeerId = new Map(orderedPeerIds.map((peerId, index) => [peerId, index]));
  const setBit = (fromPeerId: number, toPeerId: number): void => {
    const row = indexByPeerId.get(fromPeerId);
    const col = indexByPeerId.get(toPeerId);
    if (row === undefined || col === undefined) return;
    const bitIndex = row * size + col;
    bitmap[Math.floor(bitIndex / 8)] |= 1 << (bitIndex % 8);
  };

  for (const peerId of orderedPeerIds) setBit(peerId, peerId);
  for (const peerId of livePeerIds) {
    setBit(EDGE_PEER_ID, peerId);
    setBit(peerId, EDGE_PEER_ID);
  }
  for (const edge of observedEdges) setBit(edge.fromPeerId, edge.toPeerId);

  return { peerIds: orderedPeerIds.map((peerId) => ({ peerId, version })), bitmap };
}

export function buildRouteUpdatePeerIds(
  targetPeerId: number,
  routePeerIds: Iterable<number>,
  livePeerIds: Iterable<number>,
  peerCenterPeerIds: Iterable<number>,
): number[] {
  return [...new Set([EDGE_PEER_ID, targetPeerId, ...routePeerIds, ...livePeerIds, ...peerCenterPeerIds])]
    .filter((peerId) => Number.isInteger(peerId) && peerId > 0)
    .sort((a, b) => a - b);
}

function edgesFromConnBitmap(conn: RouteConnBitmap): TopologyEdge[] {
  const peers = conn.peerIds.map((item) => item.peerId);
  const size = peers.length;
  const edges: TopologyEdge[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (row === col) continue;
      const bitIndex = row * size + col;
      const byte = conn.bitmap[Math.floor(bitIndex / 8)] ?? 0;
      if ((byte & (1 << (bitIndex % 8))) !== 0) {
        edges.push({ fromPeerId: peers[row], toPeerId: peers[col], source: 'conn_bitmap' });
      }
    }
  }
  return edges;
}

function edgesFromConnPeerList(conn: RouteConnPeerList): TopologyEdge[] {
  const edges: TopologyEdge[] = [];
  for (const item of conn.peerConnInfos) {
    const fromPeerId = item.peerId?.peerId;
    if (!fromPeerId) continue;
    for (const toPeerId of item.connectedPeerIds) {
      if (!toPeerId || fromPeerId === toPeerId) continue;
      edges.push({ fromPeerId, toPeerId, source: 'conn_bitmap' });
    }
  }
  return edges.sort(compareTopologyEdges);
}

function peerIdsFromConnBitmap(conn: RouteConnBitmap): number[] {
  return sanitizePeerIds(conn.peerIds.map((item) => item.peerId));
}

function peerIdsFromConnPeerList(conn: RouteConnPeerList): number[] {
  const peerIds = new Set<number>();
  for (const item of conn.peerConnInfos) {
    if (item.peerId?.peerId) peerIds.add(item.peerId.peerId);
    for (const peerId of item.connectedPeerIds) peerIds.add(peerId);
  }
  return sanitizePeerIds([...peerIds]);
}

function edgesFromPeerCenter(peerCenter: Map<number, { directPeers: Map<number, DirectConnectedPeerInfo> }>): TopologyEdge[] {
  const edges: TopologyEdge[] = [];
  for (const [fromPeerId, info] of peerCenter.entries()) {
    for (const [toPeerId, directInfo] of info.directPeers.entries()) {
      if (!fromPeerId || !toPeerId || fromPeerId === toPeerId) continue;
      edges.push({ fromPeerId, toPeerId, source: 'peer_center', latencyMs: directInfo.latencyMs });
    }
  }
  return edges.sort(compareTopologyEdges);
}

export function buildConnectionMatrix(edges: TopologyEdge[], peerIds: Iterable<number> = []): ConnectionMatrixSnapshot {
  const connected = new Map<number, Set<number>>();
  const ensure = (peerId: number): Set<number> => {
    let set = connected.get(peerId);
    if (!set) {
      set = new Set();
      connected.set(peerId, set);
    }
    return set;
  };
  for (const peerId of peerIds) {
    if (Number.isInteger(peerId) && peerId > 0) ensure(peerId);
  }
  for (const edge of edges) {
    if (edge.source !== 'conn_bitmap') continue;
    if (!Number.isInteger(edge.fromPeerId) || !Number.isInteger(edge.toPeerId) || edge.fromPeerId <= 0 || edge.toPeerId <= 0) continue;
    ensure(edge.fromPeerId).add(edge.toPeerId);
    ensure(edge.toPeerId);
  }
  const orderedPeerIds = [...connected.keys()].sort((a, b) => a - b);
  return {
    peerIds: orderedPeerIds,
    rows: orderedPeerIds.map((peerId) => ({
      peerId,
      connectedPeerIds: [...(connected.get(peerId) ?? new Set<number>())].sort((a, b) => a - b),
    })),
  };
}

export function buildRoutePaths(
  nodes: RoutePeerSnapshot[],
  edges: TopologyEdge[],
  livePeerIds: Set<number>,
  rootPeerId = EDGE_PEER_ID,
): RoutePathSnapshot[] {
  const adjacency = new Map<number, Set<number>>();
  const edgeKeys = new Set<string>();
  const ensure = (peerId: number): Set<number> => {
    let set = adjacency.get(peerId);
    if (!set) {
      set = new Set();
      adjacency.set(peerId, set);
    }
    return set;
  };
  ensure(rootPeerId);
  for (const edge of edges) {
    if (edge.source !== 'conn_bitmap') continue;
    ensure(edge.fromPeerId).add(edge.toPeerId);
    ensure(edge.toPeerId);
    edgeKeys.add(`${edge.fromPeerId}:${edge.toPeerId}`);
  }
  for (const peerId of livePeerIds) {
    if (!peerId || peerId === rootPeerId) continue;
    ensure(rootPeerId).add(peerId);
    ensure(peerId).add(rootPeerId);
    edgeKeys.add(`${rootPeerId}:${peerId}`);
    edgeKeys.add(`${peerId}:${rootPeerId}`);
  }

  const paths = shortestPathsFrom(adjacency, rootPeerId);
  return nodes
    .filter((node) => node.peerId !== rootPeerId)
    .map((node) => {
      const pathPeerIds = paths.get(node.peerId) ?? [];
      if (pathPeerIds.length === 0) {
        return {
          peerId: node.peerId,
          pathPeerIds: [],
          source: 'unreachable' as const,
          cost: node.cost,
          lossRate: node.lossRate,
        };
      }
      const source: RoutePathSnapshot['source'] = pathPeerIds.length === 2 && livePeerIds.has(node.peerId) && edgeKeys.has(`${rootPeerId}:${node.peerId}`)
        ? 'live_peer'
        : 'conn_bitmap';
      return {
        peerId: node.peerId,
        nextHopPeerId: pathPeerIds[1],
        hopCount: pathPeerIds.length - 1,
        pathPeerIds,
        source,
        latencyMs: pathLatencyMs(pathPeerIds, edges),
        cost: node.cost,
        lossRate: node.lossRate,
      };
    })
    .sort((a, b) => a.peerId - b.peerId);
}

function mergeTopologyEdges(...groups: TopologyEdge[][]): TopologyEdge[] {
  const byKey = new Map<string, TopologyEdge>();
  for (const edge of groups.flat()) {
    const key = `${edge.source}:${edge.fromPeerId}:${edge.toPeerId}`;
    byKey.set(key, edge);
  }
  return [...byKey.values()].sort(compareTopologyEdges);
}

export function buildTopologySummary(
  nodes: RoutePeerSnapshot[],
  edges: TopologyEdge[],
  routes: RoutePathSnapshot[] = buildRoutePaths(nodes, edges, new Set(), EDGE_PEER_ID),
  connectionMatrix: ConnectionMatrixSnapshot = buildConnectionMatrix(edges, nodes.map((node) => node.peerId)),
  currentRelayDropRate = 0,
): TopologySummary {
  const connBitmapEdgeCount = edges.filter((edge) => edge.source === 'conn_bitmap').length;
  const peerCenterEdgeCount = edges.filter((edge) => edge.source === 'peer_center').length;
  const latencyValues = edges
    .map((edge) => edge.latencyMs)
    .filter((latency): latency is number => latency !== undefined && Number.isFinite(latency));
  const latencyTotal = latencyValues.reduce((sum, latency) => sum + latency, 0);
  const reachableRouteCount = routes.filter((route) => route.hopCount !== undefined).length;
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    connBitmapEdgeCount,
    peerCenterEdgeCount,
    latencyEdgeCount: latencyValues.length,
    ...(latencyValues.length > 0 ? { averageLatencyMs: Math.round(latencyTotal / latencyValues.length) } : {}),
    ...(edges.length > 0 ? { peerCenterRatio: peerCenterEdgeCount / edges.length } : {}),
    routeCount: routes.length,
    reachableRouteCount,
    connectionMatrixNodeCount: connectionMatrix.peerIds.length,
    relayDropRate: currentRelayDropRate,
  };
}

export function framePeerBindingCandidate(currentPeerId: number | undefined, fromPeerId: number): number | undefined {
  if (!fromPeerId || fromPeerId === EDGE_PEER_ID) return undefined;
  if (currentPeerId !== undefined) return undefined;
  return fromPeerId;
}

function compareTopologyEdges(a: TopologyEdge, b: TopologyEdge): number {
  return a.fromPeerId - b.fromPeerId || a.toPeerId - b.toPeerId || a.source.localeCompare(b.source);
}

function cloneDirectPeers(peerInfo: PeerInfoForGlobalMap): Map<number, DirectConnectedPeerInfo> {
  const directPeers = new Map<number, DirectConnectedPeerInfo>();
  for (const [peerId, info] of peerInfo.directPeers.entries()) {
    directPeers.set(peerId, { latencyMs: info.latencyMs });
  }
  return directPeers;
}

function sortPeerCenterMap(map: PeerCenterGlobalMap): PeerCenterGlobalMap {
  const sorted: PeerCenterGlobalMap = new Map();
  for (const [peerId, peerInfo] of [...map.entries()].sort(([left], [right]) => left - right)) {
    sorted.set(peerId, {
      directPeers: new Map([...peerInfo.directPeers.entries()].sort(([left], [right]) => left - right)),
    });
  }
  return sorted;
}

function peerCenterDigest(map: PeerCenterGlobalMap): bigint {
  const stable = JSON.stringify([...map.entries()].map(([peerId, peerInfo]) => [
    peerId,
    [...peerInfo.directPeers.entries()].map(([toPeerId, info]) => [toPeerId, info.latencyMs]),
  ]));
  let hash = 0n;
  for (let index = 0; index < stable.length; index += 1) {
    hash = ((hash << 5n) - hash + BigInt(stable.charCodeAt(index))) & 0xffff_ffff_ffff_ffffn;
  }
  return hash;
}

function shortestPathsFrom(adjacency: Map<number, Set<number>>, rootPeerId: number): Map<number, number[]> {
  const paths = new Map<number, number[]>([[rootPeerId, [rootPeerId]]]);
  const queue = [rootPeerId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const peerId = queue[cursor];
    const path = paths.get(peerId)!;
    const nextPeers = [...(adjacency.get(peerId) ?? new Set<number>())].sort((a, b) => a - b);
    for (const nextPeerId of nextPeers) {
      if (paths.has(nextPeerId)) continue;
      paths.set(nextPeerId, [...path, nextPeerId]);
      queue.push(nextPeerId);
    }
  }
  return paths;
}

function pathLatencyMs(pathPeerIds: number[], edges: TopologyEdge[]): number | undefined {
  if (pathPeerIds.length < 2) return 0;
  let total = 0;
  for (let index = 0; index < pathPeerIds.length - 1; index += 1) {
    const latency = latencyBetween(pathPeerIds[index], pathPeerIds[index + 1], edges);
    if (latency === undefined) return undefined;
    total += latency;
  }
  return total;
}

function latencyBetween(fromPeerId: number, toPeerId: number, edges: TopologyEdge[]): number | undefined {
  const values = edges
    .filter((edge) => edge.source === 'peer_center' && edge.latencyMs !== undefined && (
      (edge.fromPeerId === fromPeerId && edge.toPeerId === toPeerId)
      || (edge.fromPeerId === toPeerId && edge.toPeerId === fromPeerId)
    ))
    .map((edge) => edge.latencyMs!)
    .filter(Number.isFinite);
  if (values.length === 0) return undefined;
  return Math.min(...values);
}

function peerLatenciesByPeer(edges: TopologyEdge[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const edge of edges) {
    if (edge.source !== 'peer_center' || edge.latencyMs === undefined || !Number.isFinite(edge.latencyMs)) continue;
    const currentFrom = out.get(edge.fromPeerId);
    const currentTo = out.get(edge.toPeerId);
    if (currentFrom === undefined || edge.latencyMs < currentFrom) out.set(edge.fromPeerId, edge.latencyMs);
    if (currentTo === undefined || edge.latencyMs < currentTo) out.set(edge.toPeerId, edge.latencyMs);
  }
  return out;
}

function rate(delta: number, elapsedSeconds: number): number {
  if (!Number.isFinite(delta) || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
  return Math.max(0, Math.round(delta / elapsedSeconds));
}

function ratio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.max(0, Math.min(1, numerator / denominator));
}

function relayDropRate(counters: TrafficCounters): number {
  return ratio(counters.unroutablePackets + counters.invalidPackets, counters.rxPackets);
}

export function resolveNetworkConfig(env: Pick<Env, 'EASYTIER_NETWORK_NAME' | 'EASYTIER_NETWORK_SECRET' | 'EASYTIER_NETWORK_SECRETS' | 'EASYTIER_NETWORKS'>, roomId: string): NetworkConfig {
  const networkConfigs = parseNetworkConfigMap(env.EASYTIER_NETWORKS);
  const mappedSecrets = parseNetworkSecretMap(env.EASYTIER_NETWORK_SECRETS);
  const mappedConfig = networkConfigs.get(roomId);
  if (mappedConfig) {
    return {
      networkName: mappedConfig.networkName,
      secret: mappedConfig.secret ?? mappedSecrets.get(roomId) ?? mappedSecrets.get(mappedConfig.networkName) ?? env.EASYTIER_NETWORK_SECRET,
    };
  }

  const networkName = env.EASYTIER_NETWORK_NAME || roomId;
  return {
    networkName,
    secret: mappedSecrets.get(roomId) ?? mappedSecrets.get(networkName) ?? env.EASYTIER_NETWORK_SECRET,
  };
}

export function resolveDefaultRoomConfig(env: Pick<Env, 'EASYTIER_NETWORK_NAME' | 'EASYTIER_NETWORK_SECRET' | 'EASYTIER_NETWORK_SECRETS' | 'EASYTIER_NETWORKS'>): DefaultRoomConfig {
  const networkConfigs = parseNetworkConfigMap(env.EASYTIER_NETWORKS);
  for (const [roomId, config] of networkConfigs.entries()) {
    if (ROOM_NAME_PATTERN.test(roomId)) return { roomId, networkName: config.networkName };
  }

  const fallbackRoomId = env.EASYTIER_NETWORK_NAME && ROOM_NAME_PATTERN.test(env.EASYTIER_NETWORK_NAME)
    ? env.EASYTIER_NETWORK_NAME
    : 'default';
  return { roomId: fallbackRoomId, networkName: fallbackRoomId };
}

function parseNetworkConfigMap(raw: string | undefined): Map<string, NetworkConfig> {
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
    const out = new Map<string, NetworkConfig>();
    for (const [roomId, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value) {
        out.set(roomId, { networkName: roomId, secret: value });
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        const networkName = typeof record.networkName === 'string'
          ? record.networkName
          : typeof record.name === 'string'
            ? record.name
            : roomId;
        const secret = typeof record.secret === 'string'
          ? record.secret
          : typeof record.networkSecret === 'string'
            ? record.networkSecret
            : undefined;
        if (networkName) out.set(roomId, { networkName, secret });
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

function parseNetworkSecretMap(raw: string | undefined): Map<string, string> {
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
    const out = new Map<string, string>();
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === 'string' && typeof value === 'string' && value) out.set(key, value);
    }
    return out;
  } catch {
    return new Map();
  }
}

export function resolveOutboundTcpPeers(
  env: Pick<Env, 'EASYTIER_PUBLIC_PEER_TCP' | 'EASYTIER_OUTBOUND_TCP_PEERS'>,
  roomId: string,
): TcpPeerAddress[] {
  if (roomId === 'null' || roomId === 'undefined') return [];
  const candidates = [
    ...parseOutboundTcpPeerConfig(env.EASYTIER_OUTBOUND_TCP_PEERS, roomId),
    ...splitPeerList(env.EASYTIER_PUBLIC_PEER_TCP),
  ];
  const peers = new Map<string, TcpPeerAddress>();
  for (const candidate of candidates) {
    const peer = parseTcpPeerUri(candidate);
    if (peer) peers.set(peer.uri, peer);
  }
  return [...peers.values()];
}

function parseOutboundTcpPeerConfig(raw: string | undefined, roomId: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'string') return splitPeerList(parsed);
    if (Array.isArray(parsed)) return collectOutboundPeerValues(parsed);
    if (!parsed || typeof parsed !== 'object') return [];
    const record = parsed as Record<string, unknown>;
    const roomValue = record[roomId] ?? record.default ?? record['*'];
    return collectOutboundPeerValues(roomValue);
  } catch {
    return splitPeerList(raw);
  }
}

function collectOutboundPeerValues(value: unknown): string[] {
  if (typeof value === 'string') return splitPeerList(value);
  if (Array.isArray(value)) return value.flatMap(collectOutboundPeerValues);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return [
    ...collectOutboundPeerValues(record.uri),
    ...collectOutboundPeerValues(record.uris),
    ...collectOutboundPeerValues(record.peer),
    ...collectOutboundPeerValues(record.peers),
    ...collectOutboundPeerValues(record.tcp),
    ...collectOutboundPeerValues(record.tcpPeers),
  ];
}

function splitPeerList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

function outboundTcpKey(roomId: string, peerUri: string): string {
  return `${roomId}\n${peerUri}`;
}

function safeU32(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffff_ffff ? Number(value) : fallback;
}

function sanitizeTopologyEdges(edges: TopologyEdge[]): TopologyEdge[] {
  return edges.filter((edge) => (
    Number.isInteger(edge.fromPeerId)
    && edge.fromPeerId > 0
    && Number.isInteger(edge.toPeerId)
    && edge.toPeerId > 0
    && (edge.source === 'conn_bitmap' || edge.source === 'peer_center')
    && (edge.latencyMs === undefined || Number.isFinite(edge.latencyMs))
  ));
}

function sanitizePeerIds(peerIds: number[]): number[] {
  return [...new Set(peerIds)]
    .filter((peerId) => Number.isInteger(peerId) && peerId > 0)
    .sort((a, b) => a - b);
}

function describeFrameSplitFailure(message: ArrayBuffer): string {
  if (message.byteLength < EASYTIER_HEADER_SIZE) return `message_len=${message.byteLength}, header=short`;
  const header = parseEasyTierHeader(message);
  if (!header) return `message_len=${message.byteLength}, header=invalid`;
  const expected = EASYTIER_HEADER_SIZE + (header.len + ((header.flags & 1) === 1 ? AEAD_TAIL_SIZE : 0));
  return `message_len=${message.byteLength}, expected_first_frame_len=${expected}, type=${header.packetType}, flags=${header.flags}, from=${header.fromPeerId}, to=${header.toPeerId}`;
}
