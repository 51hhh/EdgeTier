export enum EasyTierPacketType {
  Invalid = 0,
  Data = 1,
  HandShake = 2,
  RoutePacket = 3,
  Ping = 4,
  Pong = 5,
  TaRpc = 6,
  Route = 7,
  RpcReq = 8,
  RpcResp = 9,
  ForeignNetworkPacket = 10,
  KcpSrc = 11,
  KcpDst = 12,
}

// EasyTier handshake magic/version (easytier 2.6.4: peer_rpc.proto HandshakeRequest,
// constants confirmed against a real easytier-core 2.6.4 handshake capture).
export const EASYTIER_MAGIC = 0xd1e1a5e1;
export const EASYTIER_VERSION = 1;
// EdgeTier's own peer id as a shared node / route reflector.
export const EDGE_PEER_ID = 10000001;

export const EASYTIER_HEADER_SIZE = 16;
export const MAX_FRAME_SIZE = 1024 * 1024;
export const MAX_PEERS_PER_ROOM = 256;
export const MAX_INVALID_PACKETS_PER_SESSION = 8;
export const RECENT_EVENTS_LIMIT = 200;
export const ROOM_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
