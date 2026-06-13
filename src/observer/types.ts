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
  transportKind?: 'websocket' | 'tcp-outbound';
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
  latencyMs?: number;
  lossRate?: number;
  connected: boolean;
  connectedAt: string;
  lastSeen: string;
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
  rxBytesPerSecond?: number;
  txBytesPerSecond?: number;
  rxPacketsPerSecond?: number;
  txPacketsPerSecond?: number;
}

export interface TrafficSnapshot {
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
  forwardedPackets: number;
  unroutablePackets: number;
  invalidPackets: number;
  samples: TrafficSample[];
  summary: TrafficSummary;
}

export interface TrafficSample {
  timestamp: string;
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
  forwardedPackets: number;
  unroutablePackets: number;
  invalidPackets: number;
  rxBytesPerSecond: number;
  txBytesPerSecond: number;
  rxPacketsPerSecond: number;
  txPacketsPerSecond: number;
  relayDropRate: number;
}

export interface TrafficSummary {
  rxBytesPerSecond: number;
  txBytesPerSecond: number;
  rxPacketsPerSecond: number;
  txPacketsPerSecond: number;
  relayDropRate: number;
  totalRelayDropPackets: number;
  sampledAt?: string;
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

export interface DefaultRoomResponse {
  roomId: string;
  networkName: string;
}

export interface OutboundTcpPeerStatus {
  uri: string;
  configured: boolean;
  connecting: boolean;
  connected: boolean;
  sessionId?: string;
  peerId?: number;
  handshakeAccepted: boolean;
  lastSeen?: string;
  rxBytes: number;
  txBytes: number;
}

export interface OutboundTcpStatus {
  roomId: string;
  peers: OutboundTcpPeerStatus[];
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
  latencyMs?: number;
  lossRate?: number;
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
  routeCount: number;
  reachableRouteCount: number;
  connectionMatrixNodeCount: number;
  relayDropRate: number;
}

export interface RoutePathSnapshot {
  peerId: number;
  nextHopPeerId?: number;
  hopCount?: number;
  pathPeerIds: number[];
  source: 'conn_bitmap' | 'live_peer' | 'unreachable';
  latencyMs?: number;
  cost?: number;
  lossRate?: number;
}

export interface ConnectionMatrixRow {
  peerId: number;
  connectedPeerIds: number[];
}

export interface ConnectionMatrixSnapshot {
  peerIds: number[];
  rows: ConnectionMatrixRow[];
}

export interface TopologySnapshot {
  roomId: string;
  nodes: RoutePeerSnapshot[];
  edges: TopologyEdge[];
  routes: RoutePathSnapshot[];
  connectionMatrix: ConnectionMatrixSnapshot;
  summary: TopologySummary;
  updatedAt?: string;
}
