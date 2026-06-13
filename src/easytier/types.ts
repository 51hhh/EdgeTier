export interface HandshakeObservation {
  peerId?: number;
  networkName?: string;
  networkSecretDigestPrefix?: string;
  confidence: 'header' | 'heuristic';
}

export interface RpcObservation {
  service: 'OspfRouteRpc.SyncRouteInfo' | 'PeerCenterRpc' | 'PeerCenterRpc.ReportPeers' | 'PeerCenterRpc.GetGlobalPeerMap' | 'unknown';
  message: string;
}
