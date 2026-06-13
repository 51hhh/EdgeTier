export interface HandshakeObservation {
  peerId?: number;
  networkName?: string;
  networkSecretDigestPrefix?: string;
  confidence: 'header' | 'heuristic';
}

export interface RpcObservation {
  service:
    | 'OspfRouteRpc.SyncRouteInfo'
    | 'PeerCenterRpc'
    | 'PeerCenterRpc.ReportPeers'
    | 'PeerCenterRpc.GetGlobalPeerMap'
    | 'DirectConnectorRpc'
    | 'DirectConnectorRpc.GetIpList'
    | 'DirectConnectorRpc.SendUdpHolePunchPacket'
    | 'UdpHolePunchRpc'
    | 'UdpHolePunchRpc.SelectPunchListener'
    | 'UdpHolePunchRpc.SendPunchPacketCone'
    | 'UdpHolePunchRpc.SendPunchPacketHardSym'
    | 'UdpHolePunchRpc.SendPunchPacketEasySym'
    | 'UdpHolePunchRpc.SendPunchPacketBothEasySym'
    | 'TcpHolePunchRpc'
    | 'TcpHolePunchRpc.ExchangeMappedAddr'
    | 'unknown';
  message: string;
}
