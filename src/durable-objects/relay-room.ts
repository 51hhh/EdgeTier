import { EasyTierPacketType, MAX_FRAME_SIZE, MAX_INVALID_PACKETS_PER_SESSION, MAX_PEERS_PER_ROOM, RECENT_EVENTS_LIMIT } from '../easytier/constants';
import { parseEasyTierHeader, payloadLengthMatches } from '../easytier/packet';
import { observeHandshake, observeRpc } from '../easytier/rpc';
import type { PeerSnapshot, RelayEvent, RoomSnapshot, TrafficSnapshot } from '../observer/types';
import type { Env } from '../worker/env';

type Session = PeerSnapshot & { ws: WebSocket; invalidPackets: number };

const DIRECTORY_SYNC_MIN_MS = 5_000;

export class RelayRoom implements DurableObject {
  private sessions = new Map<string, Session>();
  private peers = new Map<number, string>();
  private events: RelayEvent[] = [];
  private traffic: TrafficSnapshot = { rxBytes: 0, txBytes: 0, rxPackets: 0, txPackets: 0, forwardedPackets: 0, unroutablePackets: 0, invalidPackets: 0 };
  private lastDirectorySync = 0;
  private directorySyncQueued = false;

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomId = url.searchParams.get('room') ?? 'default';
    if (url.pathname === '/connect') return this.acceptWebSocket(request, roomId);
    if (url.pathname === '/peers') return Response.json({ peers: this.snapshot(roomId).peers });
    if (url.pathname === '/events') return Response.json({ events: this.events });
    if (url.pathname === '/traffic') return Response.json(this.traffic);
    return Response.json(this.snapshot(roomId));
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
    const session: Session = { sessionId: crypto.randomUUID(), roomId, connected: true, connectedAt: now, lastSeen: now, rxBytes: 0, txBytes: 0, rxPackets: 0, txPackets: 0, invalidPackets: 0, ws: server };
    this.sessions.set(session.sessionId, session);
    this.addEvent(roomId, 'connected', 'websocket connected', session);
    this.queueDirectorySync(roomId, true);
    server.addEventListener('message', (event) => this.onMessage(session, event));
    server.addEventListener('close', () => this.disconnect(session));
    server.addEventListener('error', () => this.disconnect(session));
    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(session: Session, event: MessageEvent): void {
    const frame = toArrayBuffer(event.data);
    session.lastSeen = new Date().toISOString();
    if (!frame) return this.invalid(session, 'unsupported websocket frame type');
    session.rxBytes += frame.byteLength;
    session.rxPackets += 1;
    this.traffic.rxBytes += frame.byteLength;
    this.traffic.rxPackets += 1;
    if (frame.byteLength > MAX_FRAME_SIZE) return this.invalid(session, 'frame size limit exceeded');
    const header = parseEasyTierHeader(frame);
    if (!header || !payloadLengthMatches(frame, header)) return this.invalid(session, 'invalid EasyTier packet header or length');
    if (header.fromPeerId) this.bindPeer(session, header.fromPeerId);
    if (header.packetType === EasyTierPacketType.HandShake) {
      const observed = observeHandshake(header, frame);
      session.networkName = observed.networkName ?? session.networkName;
      session.networkSecretDigestPrefix = observed.networkSecretDigestPrefix ?? session.networkSecretDigestPrefix;
      this.addEvent(session.roomId, 'handshake_seen', `handshake observed (${observed.confidence})`, session);
    }
    if (header.packetType === EasyTierPacketType.RpcReq || header.packetType === EasyTierPacketType.RpcResp) {
      const rpc = observeRpc(header, frame);
      this.addEvent(session.roomId, 'rpc_seen', rpc.message, session);
    }
    const targetSessionId = header.toPeerId ? this.peers.get(header.toPeerId) : undefined;
    const target = targetSessionId ? this.sessions.get(targetSessionId) : undefined;
    if (!target || target.sessionId === session.sessionId) {
      this.traffic.unroutablePackets += 1;
      this.addEvent(session.roomId, 'packet_unroutable', `packet type ${header.packetType} to peer ${header.toPeerId || 'unknown'} was not forwarded`, session);
      this.queueDirectorySync(session.roomId);
      return;
    }
    target.ws.send(frame);
    target.txBytes += frame.byteLength;
    target.txPackets += 1;
    this.traffic.txBytes += frame.byteLength;
    this.traffic.txPackets += 1;
    this.traffic.forwardedPackets += 1;
    this.addEvent(session.roomId, 'packet_forwarded', `packet type ${header.packetType} forwarded to peer ${header.toPeerId}`, session);
    this.queueDirectorySync(session.roomId);
  }

  private bindPeer(session: Session, peerId: number): void {
    session.peerId = peerId;
    this.peers.set(peerId, session.sessionId);
  }

  private invalid(session: Session, message: string): void {
    session.invalidPackets += 1;
    this.traffic.invalidPackets += 1;
    this.addEvent(session.roomId, session.invalidPackets > MAX_INVALID_PACKETS_PER_SESSION ? 'limit_exceeded' : 'decode_error', message, session);
    if (session.invalidPackets > MAX_INVALID_PACKETS_PER_SESSION) session.ws.close(1008, 'too many invalid packets');
    this.queueDirectorySync(session.roomId);
  }

  private disconnect(session: Session): void {
    if (!this.sessions.has(session.sessionId)) return;
    this.sessions.delete(session.sessionId);
    if (session.peerId) this.peers.delete(session.peerId);
    session.connected = false;
    this.addEvent(session.roomId, 'disconnected', 'websocket disconnected', session);
    this.queueDirectorySync(session.roomId, true);
  }

  private addEvent(roomId: string, type: RelayEvent['type'], message: string, session?: Session): void {
    this.events.push({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), roomId, type, sessionId: session?.sessionId, peerId: session?.peerId, message });
    if (this.events.length > RECENT_EVENTS_LIMIT) this.events.splice(0, this.events.length - RECENT_EVENTS_LIMIT);
  }

  private snapshot(roomId: string): RoomSnapshot {
    const peers = [...this.sessions.values()].map(({ ws: _ws, invalidPackets: _invalidPackets, ...peer }) => peer);
    const lastActivity = this.events.at(-1)?.timestamp;
    return { roomId, peerCount: this.peers.size, websocketCount: this.sessions.size, bytes: this.traffic.rxBytes + this.traffic.txBytes, lastActivity, traffic: this.traffic, peers, recentEvents: this.events.slice(-50) };
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
