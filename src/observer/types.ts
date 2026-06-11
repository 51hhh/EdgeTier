export type RelayEventType = 'connected' | 'disconnected' | 'handshake_seen' | 'packet_forwarded' | 'packet_unroutable' | 'rpc_seen' | 'decode_error' | 'limit_exceeded';

export interface RelayEvent {
  id: string;
  timestamp: string;
  roomId: string;
  type: RelayEventType;
  sessionId?: string;
  peerId?: number;
  message: string;
}

export interface PeerSnapshot {
  sessionId: string;
  roomId: string;
  peerId?: number;
  networkName?: string;
  networkSecretDigestPrefix?: string;
  connected: boolean;
  connectedAt: string;
  lastSeen: string;
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
}

export interface TrafficSnapshot {
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
  forwardedPackets: number;
  unroutablePackets: number;
  invalidPackets: number;
}

export interface RoomSnapshot {
  roomId: string;
  peerCount: number;
  websocketCount: number;
  bytes: number;
  lastActivity?: string;
  traffic: TrafficSnapshot;
  peers: PeerSnapshot[];
  recentEvents: RelayEvent[];
}

export interface DirectoryRoomSummary {
  roomId: string;
  peerCount: number;
  websocketCount: number;
  bytes: number;
  lastActivity?: string;
  active?: boolean;
}

export interface RelayTokenResponse {
  room: string;
  token: string;
  expiresAt: string;
  uriPath: string;
}
