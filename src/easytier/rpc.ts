import { EASYTIER_HEADER_SIZE, EDGE_PEER_ID } from './constants';
import {
  finish,
  ProtoReader,
  writeBoolField,
  writeBytesField,
  writeInt32Field,
  writeStringField,
  writeUint32Field,
  writeUint64Field,
} from './protobuf';
import { decodeHandshake } from './handshake';
import type { EasyTierPacketHeader } from './packet';
import type { HandshakeObservation, RpcObservation } from './types';
import { decompressZstdRpcBody } from './zstd';

export const CompressionAlgo = {
  Invalid: 0,
  None: 1,
  Zstd: 2,
} as const;

export const NAT_TYPE_NAMES = [
  'Unknown',
  'OpenInternet',
  'NoPAT',
  'FullCone',
  'Restricted',
  'PortRestricted',
  'Symmetric',
  'SymUdpFirewall',
  'SymmetricEasyInc',
  'SymmetricEasyDec',
] as const;

const MAX_RPC_PIECES = 32 * 1024;

export interface RpcDescriptor {
  domainName?: string;
  protoName?: string;
  serviceName?: string;
  methodIndex?: number;
}

export interface RpcCompressionInfo {
  algo: number;
  acceptedAlgo: number;
}

export interface RpcPacket {
  fromPeer?: number;
  toPeer?: number;
  transactionId?: bigint;
  descriptor?: RpcDescriptor;
  body: Uint8Array;
  isRequest?: boolean;
  totalPieces?: number;
  pieceIdx?: number;
  traceId?: number;
  compressionInfo?: RpcCompressionInfo;
}

export interface RpcRequest {
  descriptor?: RpcDescriptor;
  request: Uint8Array;
  timeoutMs?: number;
}

export interface RoutePeerInfo {
  peerId: number;
  cost?: number;
  ipv4?: string;
  ipv6?: string;
  proxyCidrs: string[];
  hostname?: string;
  udpNatType?: number;
  tcpNatType?: number;
  version?: number;
  easytierVersion?: string;
  peerRouteId?: string;
  networkLength?: number;
  rawUnknownFields?: Uint8Array[];
}

export interface PeerIdVersion {
  peerId: number;
  version: number;
}

export interface RouteConnBitmap {
  peerIds: PeerIdVersion[];
  bitmap: Uint8Array;
}

export interface RouteConnPeerInfo {
  peerId?: PeerIdVersion;
  connectedPeerIds: number[];
}

export interface RouteConnPeerList {
  peerConnInfos: RouteConnPeerInfo[];
}

export interface SyncRouteInfoRequest {
  myPeerId?: number;
  mySessionId?: bigint;
  isInitiator?: boolean;
  peerInfos: RoutePeerInfo[];
  connBitmap?: RouteConnBitmap;
  connPeerList?: RouteConnPeerList;
}

export interface SyncRouteInfoResponse {
  isInitiator?: boolean;
  sessionId?: bigint;
  error?: number;
}

export interface DirectConnectedPeerInfo {
  latencyMs: number;
}

export interface PeerInfoForGlobalMap {
  directPeers: Map<number, DirectConnectedPeerInfo>;
}

export interface ReportPeersRequest {
  myPeerId?: number;
  peerInfos: PeerInfoForGlobalMap;
}

export interface GetGlobalPeerMapRequest {
  digest?: bigint;
}

export type PeerCenterGlobalMap = Map<number, PeerInfoForGlobalMap>;

export interface GetGlobalPeerMapResponse {
  globalPeerMap: PeerCenterGlobalMap;
  digest?: bigint;
}

export type DecodedRpcService =
  | 'OspfRouteRpc.SyncRouteInfo'
  | 'PeerCenterRpc.ReportPeers'
  | 'PeerCenterRpc.GetGlobalPeerMap'
  | 'DirectConnectorRpc.GetIpList'
  | 'DirectConnectorRpc.SendUdpHolePunchPacket'
  | 'DirectConnectorRpc'
  | 'UdpHolePunchRpc.SelectPunchListener'
  | 'UdpHolePunchRpc.SendPunchPacketCone'
  | 'UdpHolePunchRpc.SendPunchPacketHardSym'
  | 'UdpHolePunchRpc.SendPunchPacketEasySym'
  | 'UdpHolePunchRpc.SendPunchPacketBothEasySym'
  | 'UdpHolePunchRpc'
  | 'TcpHolePunchRpc.ExchangeMappedAddr'
  | 'TcpHolePunchRpc'
  | 'unknown';

export interface DecodedEasyTierRpc {
  packet: RpcPacket;
  descriptor?: RpcDescriptor;
  request?: RpcRequest;
  service: DecodedRpcService;
  message: string;
  syncRouteInfo?: SyncRouteInfoRequest;
  syncRouteResponse?: SyncRouteInfoResponse;
  reportPeers?: ReportPeersRequest;
  getGlobalPeerMap?: GetGlobalPeerMapRequest;
  globalPeerMap?: PeerCenterGlobalMap;
  globalPeerMapDigest?: bigint;
  unsupportedCompression?: number;
}

export interface BuildRpcRequestPayloadArgs {
  fromPeer: number;
  toPeer: number;
  transactionId: bigint | number | string;
  descriptor: RpcDescriptor;
  requestBody: Uint8Array;
  timeoutMs?: number;
  traceId?: number;
  maxPayloadSize?: number;
}

export function observeHandshake(header: EasyTierPacketHeader, frame: ArrayBuffer): HandshakeObservation {
  try {
    const req = decodeHandshake(new Uint8Array(frame, EASYTIER_HEADER_SIZE));
    return {
      peerId: req.myPeerId || header.fromPeerId || undefined,
      networkName: req.networkName || undefined,
      networkSecretDigestPrefix: hexPrefix(req.networkSecretDigest),
      confidence: 'heuristic',
    };
  } catch {
    return { peerId: header.fromPeerId || undefined, confidence: 'header' };
  }
}

export function observeRpc(_header: EasyTierPacketHeader, frame: ArrayBuffer): RpcObservation {
  try {
    const decoded = decodeEasyTierRpcPayload(new Uint8Array(frame, EASYTIER_HEADER_SIZE));
    return { service: decoded.service, message: decoded.message };
  } catch {
    const text = safeText(new Uint8Array(frame, EASYTIER_HEADER_SIZE));
    if (/SyncRouteInfo|OspfRouteRpc/i.test(text)) {
      return { service: 'OspfRouteRpc.SyncRouteInfo', message: 'route sync RPC observed' };
    }
    if (/PeerCenterRpc|PeerCenter/i.test(text)) {
      return { service: 'PeerCenterRpc', message: 'peer center RPC observed' };
    }
    return { service: 'unknown', message: 'EasyTier RPC envelope observed; full decode requires decrypted proto payload' };
  }
}

export function decodeEasyTierRpcPayload(payload: Uint8Array): DecodedEasyTierRpc {
  return decodeEasyTierRpcPacket(decodeRpcPacket(payload));
}

export function decodeEasyTierRpcPacket(packet: RpcPacket): DecodedEasyTierRpc {
  const descriptor = packet.descriptor;

  if (packet.compressionInfo?.algo === CompressionAlgo.Zstd) {
    try {
      packet.body = decompressZstdRpcBody(packet.body);
    } catch {
      return {
        packet,
        descriptor,
        service: 'unknown',
        message: 'EasyTier RPC zstd decompression failed',
      };
    }
  } else if (packet.compressionInfo?.algo && packet.compressionInfo.algo > CompressionAlgo.None) {
    return {
      packet,
      descriptor,
      service: 'unknown',
      message: `EasyTier RPC uses unsupported compression algo ${packet.compressionInfo.algo}`,
      unsupportedCompression: packet.compressionInfo.algo,
    };
  }

  let request: RpcRequest | undefined;
  let innerBody = packet.body;
  if (packet.isRequest !== false) {
    try {
      request = decodeRpcRequest(packet.body);
      if (request.request.length > 0) innerBody = request.request;
    } catch {
      request = undefined;
    }
  }

  const effectiveDescriptor = descriptor ?? request?.descriptor;
  if (isOspfRouteRpc(effectiveDescriptor)) {
    if (packet.isRequest === false) {
      const rpcResponse = decodeRpcResponse(packet.body);
      const syncRouteResponse = decodeSyncRouteInfoResponse(rpcResponse.response);
      return {
        packet,
        descriptor: effectiveDescriptor,
        request,
        service: 'OspfRouteRpc.SyncRouteInfo',
        message: syncRouteResponse.error === undefined
          ? 'route sync RPC response decoded'
          : `route sync RPC response decoded with error ${syncRouteResponse.error}`,
        syncRouteResponse,
      };
    }
    const syncRouteInfo = decodeSyncRouteInfoRequest(innerBody);
    return {
      packet,
      descriptor: effectiveDescriptor,
      request,
      service: 'OspfRouteRpc.SyncRouteInfo',
      message: `route sync RPC decoded (${syncRouteInfo.peerInfos.length} peer info item${syncRouteInfo.peerInfos.length === 1 ? '' : 's'})`,
      syncRouteInfo,
    };
  }

  if (isPeerCenterRpc(effectiveDescriptor)) {
    const method = effectiveDescriptor?.methodIndex ?? 0;
    const direction = packet.isRequest === false ? 'response' : 'request';
    if (packet.isRequest === false) {
      if (method === 2) {
        const rpcResponse = decodeRpcResponse(packet.body);
        const response = decodeGetGlobalPeerMapResponse(rpcResponse.response);
        return {
          packet,
          descriptor: effectiveDescriptor,
          request,
          service: 'PeerCenterRpc.GetGlobalPeerMap',
          message: `peer center GetGlobalPeerMap RPC response decoded (${response.globalPeerMap.size} peer item${response.globalPeerMap.size === 1 ? '' : 's'})`,
          globalPeerMap: response.globalPeerMap,
          globalPeerMapDigest: response.digest,
        };
      }
      return {
        packet,
        descriptor: effectiveDescriptor,
        request,
        service: method === 2 ? 'PeerCenterRpc.GetGlobalPeerMap' : 'PeerCenterRpc.ReportPeers',
        message: method === 2 ? 'peer center GetGlobalPeerMap RPC response decoded' : 'peer center ReportPeers RPC response decoded',
      };
    }
    if (method === 0 || method === 1) {
      const reportPeers = decodeReportPeersRequest(innerBody);
      return {
        packet,
        descriptor: effectiveDescriptor,
        request,
        service: 'PeerCenterRpc.ReportPeers',
        message: `peer center ReportPeers RPC ${direction} decoded (${reportPeers.peerInfos.directPeers.size} direct peer item${reportPeers.peerInfos.directPeers.size === 1 ? '' : 's'})`,
        reportPeers,
      };
    }
    if (method === 2) {
      const getGlobalPeerMap = decodeGetGlobalPeerMapRequest(innerBody);
      return {
        packet,
        descriptor: effectiveDescriptor,
        request,
        service: 'PeerCenterRpc.GetGlobalPeerMap',
        message: 'peer center GetGlobalPeerMap RPC request decoded',
        getGlobalPeerMap,
      };
    }
    return {
      packet,
      descriptor: effectiveDescriptor,
      request,
      service: method === 2 ? 'PeerCenterRpc.GetGlobalPeerMap' : 'PeerCenterRpc.ReportPeers',
      message: method === 2 ? `peer center GetGlobalPeerMap RPC ${direction} decoded` : `peer center ReportPeers RPC ${direction} decoded`,
    };
  }

  if (isDirectConnectorRpc(effectiveDescriptor)) {
    const method = effectiveDescriptor?.methodIndex ?? 0;
    const direction = packet.isRequest === false ? 'response' : 'request';
    if (method === 0 || method === 1) {
      return {
        packet,
        descriptor: effectiveDescriptor,
        request,
        service: 'DirectConnectorRpc.GetIpList',
        message: `direct connector GetIpList RPC ${direction} decoded`,
      };
    }
    if (method === 2) {
      return {
        packet,
        descriptor: effectiveDescriptor,
        request,
        service: 'DirectConnectorRpc.SendUdpHolePunchPacket',
        message: `direct connector SendUdpHolePunchPacket RPC ${direction} decoded`,
      };
    }
    return {
      packet,
      descriptor: effectiveDescriptor,
      request,
      service: 'DirectConnectorRpc',
      message: `direct connector RPC ${direction} decoded`,
    };
  }

  if (isUdpHolePunchRpc(effectiveDescriptor)) {
    const method = effectiveDescriptor?.methodIndex ?? 0;
    const direction = packet.isRequest === false ? 'response' : 'request';
    const service = udpHolePunchService(method);
    return {
      packet,
      descriptor: effectiveDescriptor,
      request,
      service,
      message: `${service} RPC ${direction} decoded`,
    };
  }

  if (isTcpHolePunchRpc(effectiveDescriptor)) {
    const direction = packet.isRequest === false ? 'response' : 'request';
    const service = (effectiveDescriptor?.methodIndex ?? 0) === 1 ? 'TcpHolePunchRpc.ExchangeMappedAddr' : 'TcpHolePunchRpc';
    return {
      packet,
      descriptor: effectiveDescriptor,
      request,
      service,
      message: `${service} RPC ${direction} decoded`,
    };
  }

  return {
    packet,
    descriptor: effectiveDescriptor,
    request,
    service: 'unknown',
    message: `EasyTier RPC decoded (${effectiveDescriptor?.serviceName ?? 'unknown service'})`,
  };
}

export function decodeRpcPacket(payload: Uint8Array): RpcPacket {
  const r = new ProtoReader(payload);
  const packet: RpcPacket = { body: new Uint8Array(0) };
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 0) packet.fromPeer = r.uint32();
    else if (tag.field === 2 && tag.wire === 0) packet.toPeer = r.uint32();
    else if (tag.field === 3 && tag.wire === 0) packet.transactionId = r.uint64();
    else if (tag.field === 4 && tag.wire === 2) packet.descriptor = decodeRpcDescriptor(r.bytes());
    else if (tag.field === 5 && tag.wire === 2) packet.body = new Uint8Array(r.bytes());
    else if (tag.field === 6 && tag.wire === 0) packet.isRequest = r.bool();
    else if (tag.field === 7 && tag.wire === 0) packet.totalPieces = r.uint32();
    else if (tag.field === 8 && tag.wire === 0) packet.pieceIdx = r.uint32();
    else if (tag.field === 9 && tag.wire === 0) packet.traceId = r.int32();
    else if (tag.field === 10 && tag.wire === 2) packet.compressionInfo = decodeRpcCompressionInfo(r.bytes());
    else r.skip(tag.wire);
  }
  return packet;
}

export class RpcPacketMerger {
  private firstPiece: RpcPacket | undefined;
  private pieces: Array<RpcPacket | undefined> = [];
  private currentKey: string | undefined;
  lastUpdated = Date.now();

  feed(packet: RpcPacket): RpcPacket | undefined {
    const totalPieces = packet.totalPieces ?? 0;
    const pieceIdx = packet.pieceIdx ?? 0;

    // Compatibility with older EasyTier packets that did not set piece fields.
    if (totalPieces === 0 && pieceIdx === 0) return packet;
    if (pieceIdx === 0 && !packet.descriptor) throw new Error('RPC first piece is missing descriptor');
    if (totalPieces === 0 || totalPieces > MAX_RPC_PIECES) throw new Error('RPC totalPieces is invalid');
    if (pieceIdx >= totalPieces) throw new Error('RPC pieceIdx is out of range');
    if (totalPieces === 1 && pieceIdx === 0) return { ...packet, totalPieces: 1, pieceIdx: 0 };

    const key = rpcPacketStreamKey(packet);
    if (this.currentKey !== key) {
      this.currentKey = key;
      this.firstPiece = undefined;
      this.pieces = [];
    }

    if (pieceIdx === 0) this.firstPiece = packet;
    this.pieces.length = Math.max(this.pieces.length, totalPieces);
    this.pieces[pieceIdx] = packet;
    this.lastUpdated = Date.now();

    if (!this.firstPiece) return undefined;
    if (this.pieces.length < totalPieces) return undefined;
    for (let index = 0; index < totalPieces; index += 1) {
      if (!this.pieces[index]) return undefined;
    }

    const bodyLength = this.pieces.reduce((sum, piece) => sum + (piece?.body.length ?? 0), 0);
    const body = new Uint8Array(bodyLength);
    let offset = 0;
    for (const piece of this.pieces) {
      if (!piece) continue;
      body.set(piece.body, offset);
      offset += piece.body.length;
    }

    return {
      ...this.firstPiece,
      body,
      totalPieces: 1,
      pieceIdx: 0,
    };
  }
}

export function rpcPacketMergerKey(direction: string, packet: RpcPacket): string {
  return `${direction}:${packet.fromPeer ?? 0}:${packet.toPeer ?? 0}:${packet.transactionId?.toString() ?? ''}`;
}

function rpcPacketStreamKey(packet: RpcPacket): string {
  return `${packet.fromPeer ?? 0}:${packet.transactionId?.toString() ?? ''}`;
}

export function decodeRpcRequest(payload: Uint8Array): RpcRequest {
  const r = new ProtoReader(payload);
  const request: RpcRequest = { request: new Uint8Array(0) };
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 2) request.descriptor = decodeRpcDescriptor(r.bytes());
    else if (tag.field === 2 && tag.wire === 2) request.request = new Uint8Array(r.bytes());
    else if (tag.field === 3 && tag.wire === 0) request.timeoutMs = r.int32();
    else r.skip(tag.wire);
  }
  return request;
}

export function decodeRpcResponse(payload: Uint8Array): { response: Uint8Array } {
  const r = new ProtoReader(payload);
  const response = { response: new Uint8Array(0) };
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 2) response.response = new Uint8Array(r.bytes());
    else r.skip(tag.wire);
  }
  return response;
}

export function decodeSyncRouteInfoRequest(payload: Uint8Array): SyncRouteInfoRequest {
  const r = new ProtoReader(payload);
  const req: SyncRouteInfoRequest = { peerInfos: [] };
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 0) req.myPeerId = r.uint32();
    else if (tag.field === 2 && tag.wire === 0) req.mySessionId = r.uint64();
    else if (tag.field === 3 && tag.wire === 0) req.isInitiator = r.bool();
    else if (tag.field === 4 && tag.wire === 2) req.peerInfos = decodeRoutePeerInfos(r.bytes());
    else if (tag.field === 5 && tag.wire === 2) req.connBitmap = decodeRouteConnBitmap(r.bytes());
    else if (tag.field === 7 && tag.wire === 2) req.connPeerList = decodeRouteConnPeerList(r.bytes());
    else r.skip(tag.wire);
  }
  return req;
}

export function decodeSyncRouteInfoResponse(payload: Uint8Array): SyncRouteInfoResponse {
  const r = new ProtoReader(payload);
  const response: SyncRouteInfoResponse = {};
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 0) response.isInitiator = r.bool();
    else if (tag.field === 2 && tag.wire === 0) response.sessionId = r.uint64();
    else if (tag.field === 3 && tag.wire === 0) response.error = r.int32();
    else r.skip(tag.wire);
  }
  return response;
}

export function encodeSyncRouteInfoResponse(response: { isInitiator: boolean; sessionId: bigint | number | string }): Uint8Array {
  const out: number[] = [];
  writeBoolField(out, 1, response.isInitiator);
  writeUint64Field(out, 2, response.sessionId);
  return finish(out);
}

export function encodeSyncRouteInfoRequest(request: SyncRouteInfoRequest): Uint8Array {
  const out: number[] = [];
  writeUint32Field(out, 1, request.myPeerId);
  writeUint64Field(out, 2, request.mySessionId);
  writeBoolField(out, 3, request.isInitiator);
  if (request.peerInfos.length > 0) writeBytesField(out, 4, encodeRoutePeerInfos(request.peerInfos));
  if (request.connPeerList) writeBytesField(out, 7, encodeRouteConnPeerList(request.connPeerList));
  else if (request.connBitmap) writeBytesField(out, 5, encodeRouteConnBitmap(request.connBitmap));
  return finish(out);
}

export function buildRpcRequestPayload(request: BuildRpcRequestPayloadArgs): Uint8Array {
  return buildRpcRequestPayloads(request)[0];
}

export function buildRpcRequestPayloads(request: BuildRpcRequestPayloadArgs): Uint8Array[] {
  const rpcRequest = encodeRpcRequest({ request: request.requestBody, timeoutMs: request.timeoutMs });
  return buildRpcPacketPayloads({
    fromPeer: request.fromPeer,
    toPeer: request.toPeer,
    transactionId: BigInt(request.transactionId),
    descriptor: request.descriptor,
    content: rpcRequest,
    isRequest: true,
    traceId: request.traceId ?? 0,
    compressionInfo: { algo: CompressionAlgo.None, acceptedAlgo: CompressionAlgo.None },
    maxPayloadSize: request.maxPayloadSize,
  });
}

export function encodeReportPeersResponse(): Uint8Array {
  return new Uint8Array(0);
}

export function encodeDirectConnectorGetIpListResponse(): Uint8Array {
  return new Uint8Array(0);
}

export function encodeVoidResponse(): Uint8Array {
  return new Uint8Array(0);
}

export function encodeGetGlobalPeerMapResponse(response: { globalPeerMap?: PeerCenterGlobalMap; digest?: bigint | number | string }): Uint8Array {
  const out: number[] = [];
  if (response.globalPeerMap) {
    for (const [peerId, peerInfo] of response.globalPeerMap.entries()) {
      writeBytesField(out, 1, encodeGlobalPeerMapEntry(peerId, peerInfo));
    }
  }
  writeUint64Field(out, 2, response.digest);
  return finish(out);
}

export function encodeRpcResponse(responseBody: Uint8Array): Uint8Array {
  const out: number[] = [];
  writeBytesField(out, 1, responseBody);
  return finish(out);
}

export function encodeRpcRequest(request: { descriptor?: RpcDescriptor; request: Uint8Array; timeoutMs?: number }): Uint8Array {
  const out: number[] = [];
  if (request.descriptor) writeBytesField(out, 1, encodeRpcDescriptor(request.descriptor));
  writeBytesField(out, 2, request.request);
  writeInt32Field(out, 3, request.timeoutMs);
  return finish(out);
}

export function encodeRpcPacket(packet: RpcPacket): Uint8Array {
  const out: number[] = [];
  writeUint32Field(out, 1, packet.fromPeer);
  writeUint32Field(out, 2, packet.toPeer);
  writeUint64Field(out, 3, packet.transactionId);
  if (packet.descriptor) writeBytesField(out, 4, encodeRpcDescriptor(packet.descriptor));
  writeBytesField(out, 5, packet.body);
  if (packet.isRequest !== undefined) writeBoolField(out, 6, packet.isRequest);
  writeUint32Field(out, 7, packet.totalPieces);
  writeUint32Field(out, 8, packet.pieceIdx);
  writeInt32Field(out, 9, packet.traceId);
  if (packet.compressionInfo) writeBytesField(out, 10, encodeRpcCompressionInfo(packet.compressionInfo));
  return finish(out);
}

export function buildRpcResponsePayload(requestPacket: RpcPacket, responseBody: Uint8Array): Uint8Array {
  return buildRpcResponsePayloads(requestPacket, responseBody)[0];
}

export function buildRpcResponsePayloads(requestPacket: RpcPacket, responseBody: Uint8Array, maxPayloadSize?: number): Uint8Array[] {
  const rpcResponse = encodeRpcResponse(responseBody);
  return buildRpcPacketPayloads({
    fromPeer: EDGE_PEER_ID,
    toPeer: requestPacket.fromPeer,
    transactionId: requestPacket.transactionId,
    descriptor: requestPacket.descriptor,
    content: rpcResponse,
    isRequest: false,
    traceId: requestPacket.traceId ?? 0,
    compressionInfo: { algo: CompressionAlgo.None, acceptedAlgo: CompressionAlgo.None },
    maxPayloadSize,
  });
}

function buildRpcPacketPayloads(args: {
  fromPeer?: number;
  toPeer?: number;
  transactionId?: bigint;
  descriptor?: RpcDescriptor;
  content: Uint8Array;
  isRequest: boolean;
  traceId?: number;
  compressionInfo?: RpcCompressionInfo;
  maxPayloadSize?: number;
}): Uint8Array[] {
  const single = encodeRpcPacket(buildRpcPiece(args, 1, 0, args.content));
  if (!Number.isFinite(args.maxPayloadSize) || args.maxPayloadSize === undefined || single.length <= args.maxPayloadSize) {
    return [single];
  }
  const maxPayloadSize = Math.floor(args.maxPayloadSize);
  if (maxPayloadSize <= 0) throw new RangeError('RPC payload size budget is invalid');
  if (args.content.length === 0) throw new RangeError('RPC metadata exceeds payload budget');

  const chunks: Array<[number, number]> = [];
  let offset = 0;
  while (offset < args.content.length) {
    const pieceIdxForSizing = chunks.length === 0 ? 0 : MAX_RPC_PIECES - 1;
    const len = pickRpcPieceLength(args, offset, args.content.length - offset, pieceIdxForSizing, maxPayloadSize);
    chunks.push([offset, len]);
    offset += len;
    if (chunks.length > MAX_RPC_PIECES) throw new RangeError('RPC packet would require too many pieces');
  }

  const totalPieces = chunks.length;
  return chunks.map(([start, len], pieceIdx) => encodeRpcPacket(buildRpcPiece(
    args,
    totalPieces,
    pieceIdx,
    args.content.subarray(start, start + len),
  )));
}

function buildRpcPiece(
  args: {
    fromPeer?: number;
    toPeer?: number;
    transactionId?: bigint;
    descriptor?: RpcDescriptor;
    isRequest: boolean;
    traceId?: number;
    compressionInfo?: RpcCompressionInfo;
  },
  totalPieces: number,
  pieceIdx: number,
  body: Uint8Array,
): RpcPacket {
  const compressionAlgo = args.compressionInfo?.algo ?? CompressionAlgo.None;
  return {
    fromPeer: args.fromPeer,
    toPeer: args.toPeer,
    transactionId: args.transactionId,
    descriptor: pieceIdx === 0 || compressionAlgo === CompressionAlgo.None ? args.descriptor : undefined,
    body,
    isRequest: args.isRequest,
    totalPieces,
    pieceIdx,
    traceId: args.traceId,
    compressionInfo: pieceIdx === 0 ? args.compressionInfo : undefined,
  };
}

function pickRpcPieceLength(
  args: Parameters<typeof buildRpcPacketPayloads>[0],
  offset: number,
  remaining: number,
  pieceIdxForSizing: number,
  maxPayloadSize: number,
): number {
  let low = 1;
  let high = remaining;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = encodeRpcPacket(buildRpcPiece(
      args,
      MAX_RPC_PIECES,
      pieceIdxForSizing,
      args.content.subarray(offset, offset + mid),
    ));
    if (candidate.length <= maxPayloadSize) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (best === 0) throw new RangeError('RPC metadata exceeds payload budget');
  return best;
}

export function natTypeName(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return NAT_TYPE_NAMES[value] ?? `NatType(${value})`;
}

function decodeRpcDescriptor(payload: Uint8Array): RpcDescriptor {
  const r = new ProtoReader(payload);
  const descriptor: RpcDescriptor = {};
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 2) descriptor.domainName = r.string();
    else if (tag.field === 2 && tag.wire === 2) descriptor.protoName = r.string();
    else if (tag.field === 3 && tag.wire === 2) descriptor.serviceName = r.string();
    else if (tag.field === 4 && tag.wire === 0) descriptor.methodIndex = r.uint32();
    else r.skip(tag.wire);
  }
  return descriptor;
}

function encodeRpcDescriptor(descriptor: RpcDescriptor): Uint8Array {
  const out: number[] = [];
  writeStringField(out, 1, descriptor.domainName);
  writeStringField(out, 2, descriptor.protoName);
  writeStringField(out, 3, descriptor.serviceName);
  writeUint32Field(out, 4, descriptor.methodIndex);
  return finish(out);
}

function decodeRpcCompressionInfo(payload: Uint8Array): RpcCompressionInfo {
  const r = new ProtoReader(payload);
  const info: RpcCompressionInfo = { algo: CompressionAlgo.Invalid, acceptedAlgo: CompressionAlgo.Invalid };
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 0) info.algo = r.uint32();
    else if (tag.field === 2 && tag.wire === 0) info.acceptedAlgo = r.uint32();
    else r.skip(tag.wire);
  }
  return info;
}

function encodeRpcCompressionInfo(info: RpcCompressionInfo): Uint8Array {
  const out: number[] = [];
  writeUint32Field(out, 1, info.algo);
  writeUint32Field(out, 2, info.acceptedAlgo);
  return finish(out);
}

function decodeRoutePeerInfos(payload: Uint8Array): RoutePeerInfo[] {
  const r = new ProtoReader(payload);
  const items: RoutePeerInfo[] = [];
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 2) items.push(decodeRoutePeerInfo(r.bytes()));
    else r.skip(tag.wire);
  }
  return items;
}

function encodeRoutePeerInfos(items: RoutePeerInfo[]): Uint8Array {
  const out: number[] = [];
  for (const item of items) writeBytesField(out, 1, encodeRoutePeerInfo(item));
  return finish(out);
}

function decodeRoutePeerInfo(payload: Uint8Array): RoutePeerInfo {
  const r = new ProtoReader(payload);
  const info: RoutePeerInfo = { peerId: 0, proxyCidrs: [] };
  while (!r.done) {
    const start = r.offset;
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 0) info.peerId = r.uint32();
    else if (tag.field === 3 && tag.wire === 0) info.cost = r.uint32();
    else if (tag.field === 4 && tag.wire === 2) info.ipv4 = decodeIpv4Addr(r.bytes());
    else if (tag.field === 5 && tag.wire === 2) info.proxyCidrs.push(r.string());
    else if (tag.field === 6 && tag.wire === 2) info.hostname = r.string();
    else if (tag.field === 7 && tag.wire === 0) info.udpNatType = r.uint32();
    else if (tag.field === 9 && tag.wire === 0) info.version = r.uint32();
    else if (tag.field === 10 && tag.wire === 2) info.easytierVersion = r.string();
    else if (tag.field === 12 && tag.wire === 0) info.peerRouteId = r.uint64().toString();
    else if (tag.field === 13 && tag.wire === 0) info.networkLength = r.uint32();
    else if (tag.field === 15 && tag.wire === 2) {
      info.ipv6 = decodeIpv6Inet(r.bytes());
      (info.rawUnknownFields ??= []).push(r.rawFrom(start));
    }
    else if (tag.field === 17 && tag.wire === 0) info.tcpNatType = r.uint32();
    else {
      r.skip(tag.wire);
      (info.rawUnknownFields ??= []).push(r.rawFrom(start));
    }
  }
  return info;
}

function encodeRoutePeerInfo(info: RoutePeerInfo): Uint8Array {
  const out: number[] = [];
  writeUint32Field(out, 1, info.peerId);
  writeUint32Field(out, 3, info.cost);
  if (info.ipv4) writeBytesField(out, 4, encodeIpv4Addr(info.ipv4));
  for (const cidr of info.proxyCidrs) writeStringField(out, 5, cidr);
  writeStringField(out, 6, info.hostname);
  writeUint32Field(out, 7, info.udpNatType);
  writeUint32Field(out, 9, info.version);
  writeStringField(out, 10, info.easytierVersion);
  writeUint64Field(out, 12, info.peerRouteId);
  writeUint32Field(out, 13, info.networkLength);
  writeUint32Field(out, 17, info.tcpNatType);
  for (const raw of info.rawUnknownFields ?? []) {
    for (const byte of raw) out.push(byte);
  }
  return finish(out);
}

function decodeRouteConnBitmap(payload: Uint8Array): RouteConnBitmap {
  const r = new ProtoReader(payload);
  const conn: RouteConnBitmap = { peerIds: [], bitmap: new Uint8Array(0) };
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 2) conn.peerIds.push(decodePeerIdVersion(r.bytes()));
    else if (tag.field === 2 && tag.wire === 2) conn.bitmap = new Uint8Array(r.bytes());
    else r.skip(tag.wire);
  }
  return conn;
}

function encodeRouteConnBitmap(conn: RouteConnBitmap): Uint8Array {
  const out: number[] = [];
  for (const item of conn.peerIds) writeBytesField(out, 1, encodePeerIdVersion(item));
  writeBytesField(out, 2, conn.bitmap);
  return finish(out);
}

function decodeRouteConnPeerList(payload: Uint8Array): RouteConnPeerList {
  const r = new ProtoReader(payload);
  const list: RouteConnPeerList = { peerConnInfos: [] };
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 2) list.peerConnInfos.push(decodeRouteConnPeerInfo(r.bytes()));
    else r.skip(tag.wire);
  }
  return list;
}

function encodeRouteConnPeerList(list: RouteConnPeerList): Uint8Array {
  const out: number[] = [];
  for (const item of list.peerConnInfos) writeBytesField(out, 1, encodeRouteConnPeerInfo(item));
  return finish(out);
}

function decodeRouteConnPeerInfo(payload: Uint8Array): RouteConnPeerInfo {
  const r = new ProtoReader(payload);
  const info: RouteConnPeerInfo = { connectedPeerIds: [] };
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 2) info.peerId = decodePeerIdVersion(r.bytes());
    else if (tag.field === 2 && tag.wire === 0) info.connectedPeerIds.push(r.uint32());
    else r.skip(tag.wire);
  }
  return info;
}

function encodeRouteConnPeerInfo(info: RouteConnPeerInfo): Uint8Array {
  const out: number[] = [];
  if (info.peerId) writeBytesField(out, 1, encodePeerIdVersion(info.peerId));
  for (const peerId of info.connectedPeerIds) writeUint32Field(out, 2, peerId);
  return finish(out);
}

function decodeReportPeersRequest(payload: Uint8Array): ReportPeersRequest {
  const r = new ProtoReader(payload);
  const req: ReportPeersRequest = { peerInfos: { directPeers: new Map() } };
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 0) req.myPeerId = r.uint32();
    else if (tag.field === 2 && tag.wire === 2) req.peerInfos = decodePeerInfoForGlobalMap(r.bytes());
    else r.skip(tag.wire);
  }
  return req;
}

function decodeGetGlobalPeerMapRequest(payload: Uint8Array): GetGlobalPeerMapRequest {
  const r = new ProtoReader(payload);
  const req: GetGlobalPeerMapRequest = {};
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 0) req.digest = r.uint64();
    else r.skip(tag.wire);
  }
  return req;
}

function decodeGetGlobalPeerMapResponse(payload: Uint8Array): GetGlobalPeerMapResponse {
  const r = new ProtoReader(payload);
  const response: GetGlobalPeerMapResponse = { globalPeerMap: new Map() };
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 2) {
      const entry = decodeGlobalPeerMapEntryForResponse(r.bytes());
      response.globalPeerMap.set(entry.peerId, entry.peerInfo);
    } else if (tag.field === 2 && tag.wire === 0) {
      response.digest = r.uint64();
    } else {
      r.skip(tag.wire);
    }
  }
  return response;
}

export function encodeGetGlobalPeerMapRequest(digest: bigint | number | string = 0n): Uint8Array {
  const out: number[] = [];
  writeUint64Field(out, 1, digest);
  return finish(out);
}

function decodePeerInfoForGlobalMap(payload: Uint8Array): PeerInfoForGlobalMap {
  const r = new ProtoReader(payload);
  const peerInfo: PeerInfoForGlobalMap = { directPeers: new Map() };
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 2) {
      const entry = decodeDirectPeersEntry(r.bytes());
      peerInfo.directPeers.set(entry.key, entry.value);
    } else {
      r.skip(tag.wire);
    }
  }
  return peerInfo;
}

function decodeDirectPeersEntry(payload: Uint8Array): { key: number; value: DirectConnectedPeerInfo } {
  const r = new ProtoReader(payload);
  let key = 0;
  let value: DirectConnectedPeerInfo = { latencyMs: 0 };
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 0) key = r.uint32();
    else if (tag.field === 2 && tag.wire === 2) value = decodeDirectConnectedPeerInfo(r.bytes());
    else r.skip(tag.wire);
  }
  return { key, value };
}

function decodeDirectConnectedPeerInfo(payload: Uint8Array): DirectConnectedPeerInfo {
  const r = new ProtoReader(payload);
  const info: DirectConnectedPeerInfo = { latencyMs: 0 };
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 0) info.latencyMs = r.int32();
    else r.skip(tag.wire);
  }
  return info;
}

function encodeGlobalPeerMapEntry(peerId: number, peerInfo: PeerInfoForGlobalMap): Uint8Array {
  const out: number[] = [];
  writeUint32Field(out, 1, peerId);
  writeBytesField(out, 2, encodePeerInfoForGlobalMap(peerInfo));
  return finish(out);
}

function decodeGlobalPeerMapEntryForResponse(payload: Uint8Array): { peerId: number; peerInfo: PeerInfoForGlobalMap } {
  const r = new ProtoReader(payload);
  let peerId = 0;
  let peerInfo: PeerInfoForGlobalMap = { directPeers: new Map() };
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 0) peerId = r.uint32();
    else if (tag.field === 2 && tag.wire === 2) peerInfo = decodePeerInfoForGlobalMap(r.bytes());
    else r.skip(tag.wire);
  }
  return { peerId, peerInfo };
}

function encodePeerInfoForGlobalMap(peerInfo: PeerInfoForGlobalMap): Uint8Array {
  const out: number[] = [];
  for (const [peerId, info] of peerInfo.directPeers.entries()) {
    writeBytesField(out, 1, encodeDirectPeersEntry(peerId, info));
  }
  return finish(out);
}

function encodeDirectPeersEntry(peerId: number, info: DirectConnectedPeerInfo): Uint8Array {
  const out: number[] = [];
  writeUint32Field(out, 1, peerId);
  writeBytesField(out, 2, encodeDirectConnectedPeerInfo(info));
  return finish(out);
}

function encodeDirectConnectedPeerInfo(info: DirectConnectedPeerInfo): Uint8Array {
  const out: number[] = [];
  writeInt32Field(out, 1, info.latencyMs);
  return finish(out);
}

function decodePeerIdVersion(payload: Uint8Array): PeerIdVersion {
  const r = new ProtoReader(payload);
  const item: PeerIdVersion = { peerId: 0, version: 0 };
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 0) item.peerId = r.uint32();
    else if (tag.field === 2 && tag.wire === 0) item.version = r.uint32();
    else r.skip(tag.wire);
  }
  return item;
}

function encodePeerIdVersion(item: PeerIdVersion): Uint8Array {
  const out: number[] = [];
  writeUint32Field(out, 1, item.peerId);
  writeUint32Field(out, 2, item.version);
  return finish(out);
}

function decodeIpv4Addr(payload: Uint8Array): string {
  const r = new ProtoReader(payload);
  let addr = 0;
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 0) addr = r.uint32();
    else r.skip(tag.wire);
  }
  return ipv4FromU32(addr);
}

function encodeIpv4Addr(value: string): Uint8Array {
  const out: number[] = [];
  writeUint32Field(out, 1, ipv4ToU32(value));
  return finish(out);
}

function decodeIpv6Inet(payload: Uint8Array): string {
  const r = new ProtoReader(payload);
  let address: Uint32Array | undefined;
  let networkLength: number | undefined;
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 2) address = decodeIpv6Addr(r.bytes());
    else if (tag.field === 2 && tag.wire === 0) networkLength = r.uint32();
    else r.skip(tag.wire);
  }
  const text = address ? ipv6FromParts(address) : '::';
  return networkLength === undefined ? text : `${text}/${networkLength}`;
}

function decodeIpv6Addr(payload: Uint8Array): Uint32Array {
  const r = new ProtoReader(payload);
  const parts = new Uint32Array(4);
  while (!r.done) {
    const tag = r.tag();
    if (tag.field >= 1 && tag.field <= 4 && tag.wire === 0) parts[tag.field - 1] = r.uint32();
    else r.skip(tag.wire);
  }
  return parts;
}

function isOspfRouteRpc(descriptor: RpcDescriptor | undefined): boolean {
  if (!descriptor) return false;
  const service = descriptor.serviceName ?? '';
  return service === 'OspfRouteRpc' || service === 'peer_rpc.OspfRouteRpc';
}

function isPeerCenterRpc(descriptor: RpcDescriptor | undefined): boolean {
  if (!descriptor) return false;
  const service = descriptor.serviceName ?? '';
  return service === 'PeerCenterRpc' || service === 'peer_rpc.PeerCenterRpc';
}

function isDirectConnectorRpc(descriptor: RpcDescriptor | undefined): boolean {
  if (!descriptor) return false;
  const service = descriptor.serviceName ?? '';
  return service === 'DirectConnectorRpc' || service === 'peer_rpc.DirectConnectorRpc';
}

function isUdpHolePunchRpc(descriptor: RpcDescriptor | undefined): boolean {
  if (!descriptor) return false;
  const service = descriptor.serviceName ?? '';
  return service === 'UdpHolePunchRpc' || service === 'peer_rpc.UdpHolePunchRpc';
}

function isTcpHolePunchRpc(descriptor: RpcDescriptor | undefined): boolean {
  if (!descriptor) return false;
  const service = descriptor.serviceName ?? '';
  return service === 'TcpHolePunchRpc' || service === 'peer_rpc.TcpHolePunchRpc';
}

function udpHolePunchService(methodIndex: number): DecodedRpcService {
  if (methodIndex === 1) return 'UdpHolePunchRpc.SelectPunchListener';
  if (methodIndex === 2) return 'UdpHolePunchRpc.SendPunchPacketCone';
  if (methodIndex === 3) return 'UdpHolePunchRpc.SendPunchPacketHardSym';
  if (methodIndex === 4) return 'UdpHolePunchRpc.SendPunchPacketEasySym';
  if (methodIndex === 5) return 'UdpHolePunchRpc.SendPunchPacketBothEasySym';
  return 'UdpHolePunchRpc';
}

function safeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, Math.min(bytes.byteLength, 4096)));
  } catch {
    return '';
  }
}

function hexPrefix(bytes: Uint8Array): string | undefined {
  if (bytes.length === 0) return undefined;
  return Array.from(bytes.slice(0, 6), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function ipv4FromU32(addr: number): string {
  const value = addr >>> 0;
  return `${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`;
}

function ipv4ToU32(addr: string): number {
  const [host] = addr.split('/');
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return 0;
  return (((parts[0] << 24) >>> 0) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv6FromParts(parts: Uint32Array): string {
  const groups: string[] = [];
  for (const part of parts) {
    groups.push(((part >>> 16) & 0xffff).toString(16));
    groups.push((part & 0xffff).toString(16));
  }
  return groups.join(':');
}
