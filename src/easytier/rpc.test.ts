import { describe, expect, it } from 'vitest';
import { EDGE_PEER_ID } from './constants';
import { finish, ProtoReader, writeBytesField, writeInt32Field, writeUint32Field, writeUint64Field } from './protobuf';
import {
  buildRpcRequestPayloads,
  buildRpcResponsePayload,
  buildRpcRequestPayload,
  CompressionAlgo,
  decodeEasyTierRpcPayload,
  decodeEasyTierRpcPacket,
  decodeRpcPacket,
  encodeGetGlobalPeerMapRequest,
  encodeGetGlobalPeerMapResponse,
  encodeRpcPacket,
  encodeSyncRouteInfoRequest,
  encodeSyncRouteInfoResponse,
  natTypeName,
  RpcPacketMerger,
  type PeerCenterGlobalMap,
  type RpcDescriptor,
  type RpcPacket,
} from './rpc';

function decodeRpcResponseBody(payload: Uint8Array): Uint8Array {
  const r = new ProtoReader(payload);
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 2) return new Uint8Array(r.bytes());
    r.skip(tag.wire);
  }
  return new Uint8Array(0);
}

function decodeSyncRouteInfoResponse(payload: Uint8Array): { isInitiator?: boolean; sessionId?: bigint } {
  const r = new ProtoReader(payload);
  const response: { isInitiator?: boolean; sessionId?: bigint } = {};
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 0) response.isInitiator = r.bool();
    else if (tag.field === 2 && tag.wire === 0) response.sessionId = r.uint64();
    else r.skip(tag.wire);
  }
  return response;
}

function encodeRpcRequestBody(request: Uint8Array): Uint8Array {
  const out: number[] = [];
  writeBytesField(out, 2, request);
  return finish(out);
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeReportPeersRequest(myPeerId: number, directPeerId: number, latencyMs: number): Uint8Array {
  const directInfo: number[] = [];
  writeInt32Field(directInfo, 1, latencyMs);

  const directEntry: number[] = [];
  writeUint32Field(directEntry, 1, directPeerId);
  writeBytesField(directEntry, 2, finish(directInfo));

  const peerInfo: number[] = [];
  writeBytesField(peerInfo, 1, finish(directEntry));

  const report: number[] = [];
  writeUint32Field(report, 1, myPeerId);
  writeBytesField(report, 2, finish(peerInfo));
  return finish(report);
}

function peerCenterPacket(methodIndex: number, request: Uint8Array): Uint8Array {
  const descriptor: RpcDescriptor = { protoName: 'peer_rpc', serviceName: 'PeerCenterRpc', methodIndex };
  return encodeRpcPacket({
    fromPeer: 42,
    toPeer: EDGE_PEER_ID,
    transactionId: 777n,
    descriptor,
    body: encodeRpcRequestBody(request),
    isRequest: true,
    traceId: 3,
  });
}

function decodeGetGlobalPeerMapResponse(payload: Uint8Array): { entries: Array<{ peerId: number; directPeerId: number; latencyMs: number }>; digest?: bigint } {
  const r = new ProtoReader(payload);
  const decoded: { entries: Array<{ peerId: number; directPeerId: number; latencyMs: number }>; digest?: bigint } = { entries: [] };
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 2) decoded.entries.push(decodeGlobalPeerMapEntry(r.bytes()));
    else if (tag.field === 2 && tag.wire === 0) decoded.digest = r.uint64();
    else r.skip(tag.wire);
  }
  return decoded;
}

function decodeGlobalPeerMapEntry(payload: Uint8Array): { peerId: number; directPeerId: number; latencyMs: number } {
  const r = new ProtoReader(payload);
  let peerId = 0;
  let peerInfo = new Uint8Array(0);
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 0) peerId = r.uint32();
    else if (tag.field === 2 && tag.wire === 2) peerInfo = new Uint8Array(r.bytes());
    else r.skip(tag.wire);
  }
  const direct = decodePeerInfoForGlobalMap(peerInfo);
  return { peerId, ...direct };
}

function decodePeerInfoForGlobalMap(payload: Uint8Array): { directPeerId: number; latencyMs: number } {
  const r = new ProtoReader(payload);
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 2) return decodeDirectPeersEntry(r.bytes());
    r.skip(tag.wire);
  }
  return { directPeerId: 0, latencyMs: 0 };
}

function decodeDirectPeersEntry(payload: Uint8Array): { directPeerId: number; latencyMs: number } {
  const r = new ProtoReader(payload);
  let directPeerId = 0;
  let directInfo = new Uint8Array(0);
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 0) directPeerId = r.uint32();
    else if (tag.field === 2 && tag.wire === 2) directInfo = new Uint8Array(r.bytes());
    else r.skip(tag.wire);
  }
  return { directPeerId, latencyMs: decodeDirectConnectedPeerInfo(directInfo) };
}

function decodeDirectConnectedPeerInfo(payload: Uint8Array): number {
  const r = new ProtoReader(payload);
  while (!r.done) {
    const tag = r.tag();
    if (tag.field === 1 && tag.wire === 0) return r.int32();
    r.skip(tag.wire);
  }
  return 0;
}

describe('EasyTier RPC codec', () => {
  it('wraps SyncRouteInfoResponse in RpcResponse and RpcPacket', () => {
    const request: RpcPacket = {
      fromPeer: 42,
      toPeer: EDGE_PEER_ID,
      transactionId: 123456789n,
      descriptor: { protoName: 'peer_rpc', serviceName: 'OspfRouteRpc', methodIndex: 0 },
      body: new Uint8Array(0),
      isRequest: true,
      traceId: 7,
    };

    const syncResponse = encodeSyncRouteInfoResponse({ isInitiator: true, sessionId: 0x1122334455667788n });
    const responsePacket = decodeRpcPacket(buildRpcResponsePayload(request, syncResponse));

    expect(responsePacket.fromPeer).toBe(EDGE_PEER_ID);
    expect(responsePacket.toPeer).toBe(42);
    expect(responsePacket.transactionId).toBe(123456789n);
    expect(responsePacket.isRequest).toBe(false);
    expect(responsePacket.traceId).toBe(7);
    expect(responsePacket.descriptor).toEqual(request.descriptor);
    expect(responsePacket.compressionInfo).toEqual({ algo: CompressionAlgo.None, acceptedAlgo: CompressionAlgo.None });

    const rpcResponseBody = decodeRpcResponseBody(responsePacket.body);
    expect(decodeSyncRouteInfoResponse(rpcResponseBody)).toEqual({ isInitiator: true, sessionId: 0x1122334455667788n });
  });

  it('does not decode RpcResp bodies as SyncRouteInfo requests', () => {
    const request: RpcPacket = {
      fromPeer: 42,
      toPeer: EDGE_PEER_ID,
      transactionId: 9n,
      descriptor: { protoName: 'peer_rpc', serviceName: 'OspfRouteRpc', methodIndex: 0 },
      body: new Uint8Array(0),
      isRequest: true,
    };

    const syncResponse = encodeSyncRouteInfoResponse({ isInitiator: false, sessionId: 10n });
    const decoded = decodeEasyTierRpcPayload(buildRpcResponsePayload(request, syncResponse));

    expect(decoded.service).toBe('OspfRouteRpc.SyncRouteInfo');
    expect(decoded.message).toBe('route sync RPC response decoded');
    expect(decoded.syncRouteInfo).toBeUndefined();
    expect(decoded.syncRouteResponse).toEqual({ isInitiator: false, sessionId: 10n });
  });

  it('maps known and unknown NAT enum values', () => {
    expect(natTypeName(undefined)).toBeUndefined();
    expect(natTypeName(3)).toBe('FullCone');
    expect(natTypeName(99)).toBe('NatType(99)');
  });

  it('decodes PeerCenter ReportPeers direct peer latency', () => {
    const decoded = decodeEasyTierRpcPayload(peerCenterPacket(1, encodeReportPeersRequest(42, 100, 25)));

    expect(decoded.service).toBe('PeerCenterRpc.ReportPeers');
    expect(decoded.reportPeers?.myPeerId).toBe(42);
    expect(decoded.reportPeers?.peerInfos.directPeers.get(100)).toEqual({ latencyMs: 25 });
  });

  it('decodes PeerCenter GetGlobalPeerMap request digests', () => {
    const decoded = decodeEasyTierRpcPayload(peerCenterPacket(2, encodeGetGlobalPeerMapRequest(123n)));

    expect(decoded.service).toBe('PeerCenterRpc.GetGlobalPeerMap');
    expect(decoded.getGlobalPeerMap?.digest).toBe(123n);
  });

  it('decompresses zstd-compressed RpcRequest bodies before service decode', () => {
    const compressedRpcRequest = base64Bytes('KLUv/SQtaQEAEisIKhBjGAEiIwohCCoiBQiDgsBUMgZub2RlLWE4BVIKMi42LjQtdGVzdGgY4F88Lw==');
    const decoded = decodeEasyTierRpcPayload(encodeRpcPacket({
      fromPeer: 42,
      toPeer: EDGE_PEER_ID,
      transactionId: 88n,
      descriptor: { protoName: 'peer_rpc', serviceName: 'OspfRouteRpc', methodIndex: 1 },
      body: compressedRpcRequest,
      isRequest: true,
      traceId: 9,
      compressionInfo: { algo: CompressionAlgo.Zstd, acceptedAlgo: CompressionAlgo.Zstd },
    }));

    expect(decoded.service).toBe('OspfRouteRpc.SyncRouteInfo');
    expect(decoded.syncRouteInfo?.myPeerId).toBe(42);
    expect(decoded.syncRouteInfo?.peerInfos[0]).toMatchObject({
      peerId: 42,
      hostname: 'node-a',
      ipv4: '10.144.1.3',
      udpNatType: 5,
      easytierVersion: '2.6.4-test',
      networkLength: 24,
    });
  });

  it('encodes PeerCenter GetGlobalPeerMap responses with latency map and digest', () => {
    const map: PeerCenterGlobalMap = new Map([
      [42, { directPeers: new Map([[100, { latencyMs: 25 }]]) }],
    ]);

    const decoded = decodeGetGlobalPeerMapResponse(encodeGetGlobalPeerMapResponse({ globalPeerMap: map, digest: 456n }));

    expect(decoded.digest).toBe(456n);
    expect(decoded.entries).toEqual([{ peerId: 42, directPeerId: 100, latencyMs: 25 }]);
  });

  it('decodes PeerCenter GetGlobalPeerMap RPC responses into a global map', () => {
    const request: RpcPacket = {
      fromPeer: 42,
      toPeer: EDGE_PEER_ID,
      transactionId: 11n,
      descriptor: { protoName: 'peer_rpc', serviceName: 'PeerCenterRpc', methodIndex: 2 },
      body: new Uint8Array(0),
      isRequest: true,
    };
    const map: PeerCenterGlobalMap = new Map([
      [42, { directPeers: new Map([[100, { latencyMs: 25 }]]) }],
      [100, { directPeers: new Map([[42, { latencyMs: 26 }]]) }],
    ]);

    const decoded = decodeEasyTierRpcPayload(buildRpcResponsePayload(
      request,
      encodeGetGlobalPeerMapResponse({ globalPeerMap: map, digest: 99n }),
    ));

    expect(decoded.service).toBe('PeerCenterRpc.GetGlobalPeerMap');
    expect(decoded.globalPeerMapDigest).toBe(99n);
    expect(decoded.globalPeerMap?.get(42)?.directPeers.get(100)).toEqual({ latencyMs: 25 });
    expect(decoded.globalPeerMap?.get(100)?.directPeers.get(42)).toEqual({ latencyMs: 26 });
  });

  it('encodes server-pushed SyncRouteInfo RpcReq updates', () => {
    const requestBody = encodeSyncRouteInfoRequest({
      myPeerId: EDGE_PEER_ID,
      mySessionId: 99n,
      isInitiator: false,
      peerInfos: [
        {
          peerId: EDGE_PEER_ID,
          cost: 1,
          ipv4: '10.144.0.1',
          proxyCidrs: [],
          hostname: 'edgetier-worker',
          udpNatType: 0,
          version: 7,
          easytierVersion: 'edgetier-worker',
          networkLength: 24,
        },
      ],
      connBitmap: {
        peerIds: [
          { peerId: EDGE_PEER_ID, version: 7 },
          { peerId: 42, version: 7 },
        ],
        bitmap: new Uint8Array([0b00001111]),
      },
    });

    const decoded = decodeEasyTierRpcPayload(buildRpcRequestPayload({
      fromPeer: EDGE_PEER_ID,
      toPeer: 42,
      transactionId: 123n,
      descriptor: { protoName: 'peer_rpc', serviceName: 'OspfRouteRpc', methodIndex: 0 },
      requestBody,
    }));

    expect(decoded.service).toBe('OspfRouteRpc.SyncRouteInfo');
    expect(decoded.syncRouteInfo?.myPeerId).toBe(EDGE_PEER_ID);
    expect(decoded.syncRouteInfo?.peerInfos[0]).toMatchObject({
      peerId: EDGE_PEER_ID,
      hostname: 'edgetier-worker',
      ipv4: '10.144.0.1',
      networkLength: 24,
    });
    expect(decoded.syncRouteInfo?.connBitmap?.peerIds.map((item) => item.peerId)).toEqual([EDGE_PEER_ID, 42]);
  });

  it('splits and merges fragmented RpcRequest payloads', () => {
    const requestBody = encodeSyncRouteInfoRequest({
      myPeerId: EDGE_PEER_ID,
      mySessionId: 99n,
      isInitiator: true,
      peerInfos: Array.from({ length: 24 }, (_, index) => ({
        peerId: 10_000 + index,
        cost: 1,
        ipv4: `10.144.1.${index + 1}`,
        proxyCidrs: [],
        hostname: `node-${index}`,
        udpNatType: 3,
        version: 100 + index,
        easytierVersion: '2.6.4-test',
        networkLength: 24,
      })),
    });

    const payloads = buildRpcRequestPayloads({
      fromPeer: EDGE_PEER_ID,
      toPeer: 42,
      transactionId: 987n,
      descriptor: { protoName: 'peer_rpc', serviceName: 'OspfRouteRpc', methodIndex: 1 },
      requestBody,
      maxPayloadSize: 180,
    });

    expect(payloads.length).toBeGreaterThan(1);
    expect(payloads.every((payload) => payload.length <= 180)).toBe(true);

    const merger = new RpcPacketMerger();
    let merged: RpcPacket | undefined;
    for (const payload of [...payloads].reverse()) {
      merged = merger.feed(decodeRpcPacket(payload)) ?? merged;
    }

    expect(merged).toBeDefined();
    expect(merged?.totalPieces).toBe(1);
    expect(merged?.pieceIdx).toBe(0);
    const decoded = decodeEasyTierRpcPacket(merged!);
    expect(decoded.service).toBe('OspfRouteRpc.SyncRouteInfo');
    expect(decoded.syncRouteInfo?.peerInfos).toHaveLength(24);
    expect(decoded.syncRouteInfo?.peerInfos[23].hostname).toBe('node-23');
  });

  it('preserves raw RoutePeerInfo fields that EdgeTier does not model yet', () => {
    const routePeerInfo: number[] = [];
    writeUint32Field(routePeerInfo, 1, 42);
    writeUint32Field(routePeerInfo, 3, 1);
    writeBytesField(routePeerInfo, 6, new TextEncoder().encode('node-with-extra'));
    writeBytesField(routePeerInfo, 18, new Uint8Array([1, 2, 3]));

    const routePeerInfos: number[] = [];
    writeBytesField(routePeerInfos, 1, finish(routePeerInfo));

    const syncRouteInfo: number[] = [];
    writeUint32Field(syncRouteInfo, 1, 42);
    writeUint64Field(syncRouteInfo, 2, 10n);
    writeBytesField(syncRouteInfo, 4, finish(routePeerInfos));

    const decoded = decodeEasyTierRpcPayload(buildRpcRequestPayload({
      fromPeer: 42,
      toPeer: EDGE_PEER_ID,
      transactionId: 222n,
      descriptor: { protoName: 'peer_rpc', serviceName: 'OspfRouteRpc', methodIndex: 1 },
      requestBody: finish(syncRouteInfo),
    }));

    const peerInfo = decoded.syncRouteInfo?.peerInfos[0];
    expect(peerInfo).toMatchObject({ peerId: 42, hostname: 'node-with-extra' });
    expect(peerInfo?.rawUnknownFields?.[0]).toEqual(new Uint8Array([0x92, 0x01, 0x03, 0x01, 0x02, 0x03]));

    const roundTrip = decodeEasyTierRpcPayload(buildRpcRequestPayload({
      fromPeer: 42,
      toPeer: EDGE_PEER_ID,
      transactionId: 223n,
      descriptor: { protoName: 'peer_rpc', serviceName: 'OspfRouteRpc', methodIndex: 1 },
      requestBody: encodeSyncRouteInfoRequest(decoded.syncRouteInfo!),
    }));

    expect(roundTrip.syncRouteInfo?.peerInfos[0].rawUnknownFields?.[0]).toEqual(new Uint8Array([0x92, 0x01, 0x03, 0x01, 0x02, 0x03]));
  });

  it('decodes SyncRouteInfo RouteConnPeerList oneof field 7', () => {
    const requestBody = encodeSyncRouteInfoRequest({
      myPeerId: 42,
      mySessionId: 111n,
      isInitiator: true,
      peerInfos: [],
      connPeerList: {
        peerConnInfos: [
          { peerId: { peerId: 42, version: 8 }, connectedPeerIds: [100, 200] },
          { peerId: { peerId: 100, version: 9 }, connectedPeerIds: [42] },
        ],
      },
    });

    const decoded = decodeEasyTierRpcPayload(buildRpcRequestPayload({
      fromPeer: 42,
      toPeer: EDGE_PEER_ID,
      transactionId: 222n,
      descriptor: { protoName: 'peer_rpc', serviceName: 'OspfRouteRpc', methodIndex: 1 },
      requestBody,
    }));

    expect(decoded.service).toBe('OspfRouteRpc.SyncRouteInfo');
    expect(decoded.syncRouteInfo?.connBitmap).toBeUndefined();
    expect(decoded.syncRouteInfo?.connPeerList?.peerConnInfos).toEqual([
      { peerId: { peerId: 42, version: 8 }, connectedPeerIds: [100, 200] },
      { peerId: { peerId: 100, version: 9 }, connectedPeerIds: [42] },
    ]);
  });

  it('decodes DirectConnector RPC requests so Worker can no-op unsupported UDP paths', () => {
    const getIpList = decodeEasyTierRpcPayload(buildRpcRequestPayload({
      fromPeer: 42,
      toPeer: EDGE_PEER_ID,
      transactionId: 333n,
      descriptor: { protoName: 'peer_rpc', serviceName: 'DirectConnectorRpc', methodIndex: 1 },
      requestBody: new Uint8Array(0),
    }));
    const holePunch = decodeEasyTierRpcPayload(buildRpcRequestPayload({
      fromPeer: 42,
      toPeer: EDGE_PEER_ID,
      transactionId: 334n,
      descriptor: { protoName: 'peer_rpc', serviceName: 'DirectConnectorRpc', methodIndex: 2 },
      requestBody: new Uint8Array(0),
    }));

    expect(getIpList.service).toBe('DirectConnectorRpc.GetIpList');
    expect(holePunch.service).toBe('DirectConnectorRpc.SendUdpHolePunchPacket');
  });

  it('decodes UDP/TCP hole-punch RPC requests as explicit no-op services', () => {
    const udp = decodeEasyTierRpcPayload(buildRpcRequestPayload({
      fromPeer: 42,
      toPeer: EDGE_PEER_ID,
      transactionId: 335n,
      descriptor: { protoName: 'peer_rpc', serviceName: 'UdpHolePunchRpc', methodIndex: 3 },
      requestBody: new Uint8Array(0),
    }));
    const tcp = decodeEasyTierRpcPayload(buildRpcRequestPayload({
      fromPeer: 42,
      toPeer: EDGE_PEER_ID,
      transactionId: 336n,
      descriptor: { protoName: 'peer_rpc', serviceName: 'TcpHolePunchRpc', methodIndex: 1 },
      requestBody: new Uint8Array(0),
    }));

    expect(udp.service).toBe('UdpHolePunchRpc.SendPunchPacketHardSym');
    expect(tcp.service).toBe('TcpHolePunchRpc.ExchangeMappedAddr');
  });
});
