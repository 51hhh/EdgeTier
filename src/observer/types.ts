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
  hostname?: string;
  virtualIpv4?: string;
  virtualIpv6?: string;
  udpNatType?: string;
  tcpNatType?: string;
  proxyCidrs?: string[];
  easytierVersion?: string;
  routeVersion?: number;
  peerRouteId?: string;
  networkLength?: number;
  cost?: number;
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
  topology?: TopologySnapshot;
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

export interface RoutePeerSnapshot {
  peerId: number;
  hostname?: string;
  virtualIpv4?: string;
  virtualIpv6?: string;
  udpNatType?: string;
  tcpNatType?: string;
  proxyCidrs: string[];
  easytierVersion?: string;
  routeVersion?: number;
  peerRouteId?: string;
  networkLength?: number;
  cost?: number;
  sourcePeerId?: number;
  lastSeen: string;
}

export interface TopologyEdge {
  fromPeerId: number;
  toPeerId: number;
  source: 'conn_bitmap' | 'peer_center';
  latencyMs?: number;
}

export interface TopologySummary {
  nodeCount: number;
  edgeCount: number;
  connBitmapEdgeCount: number;
  peerCenterEdgeCount: number;
  latencyEdgeCount: number;
  averageLatencyMs?: number;
  peerCenterRatio?: number;
}

export interface TopologySnapshot {
  roomId: string;
  nodes: RoutePeerSnapshot[];
  edges: TopologyEdge[];
  summary: TopologySummary;
  updatedAt?: string;
}
