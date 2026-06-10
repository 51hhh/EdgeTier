export enum EasyTierPacketType {
  Invalid = 0,
  Data = 1,
  HandShake = 2,
  Ping = 4,
  Pong = 5,
  RpcReq = 8,
  RpcResp = 9,
}

export const EASYTIER_HEADER_SIZE = 16;
export const MAX_FRAME_SIZE = 1024 * 1024;
export const MAX_PEERS_PER_ROOM = 256;
export const MAX_INVALID_PACKETS_PER_SESSION = 8;
export const RECENT_EVENTS_LIMIT = 200;
export const ROOM_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
