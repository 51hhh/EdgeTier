# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

Backend code must be Cloudflare Worker-compatible TypeScript, protocol-aware, and honest about EasyTier compatibility. EdgeTier v0.1 observes and forwards EasyTier-style packets; it does not implement full EasyTier control-plane, native UDP relay, TUN/TAP, or WireGuard server behavior.

---

## Scenario: EasyTier Protocol Scaffolding and Proto Drift

### 1. Scope / Trigger

- Trigger: EasyTier protocol constants, packet parsing, RPC observation, and official proto version tracking.
- Applies whenever adding/changing `src/easytier/*`, relay RPC behavior, or files under `proto/easytier/`.

### 2. Signatures

Core parser signatures:

```typescript
parseEasyTierHeader(frame: ArrayBuffer): EasyTierPacketHeader | null
createEasyTierHeader(header: EasyTierPacketHeader): ArrayBuffer
payloadLengthMatches(frame: ArrayBuffer, header: EasyTierPacketHeader): boolean
observeHandshake(header: EasyTierPacketHeader, frame: ArrayBuffer): HandshakeObservation
observeRpc(header: EasyTierPacketHeader, frame: ArrayBuffer): RpcObservation
```

Command signatures:

```text
npm run typecheck
npm run test
npm run build
npm run proto:check
```

`npm run proto:check` currently verifies that the official EasyTier source candidate exists and documents the drift-check step. Before production releases it must compare `proto/easytier` against the selected official EasyTier release/commit.

### 3. Contracts

EasyTier packet constants are centralized in `src/easytier/constants.ts`:

```typescript
EasyTierPacketType.Invalid = 0
EasyTierPacketType.Data = 1
EasyTierPacketType.HandShake = 2
EasyTierPacketType.Ping = 4
EasyTierPacketType.Pong = 5
EasyTierPacketType.RpcReq = 8
EasyTierPacketType.RpcResp = 9
EASYTIER_HEADER_SIZE = 16
```

Local safety limits:

```typescript
MAX_FRAME_SIZE = 1024 * 1024
MAX_PEERS_PER_ROOM = 256
MAX_INVALID_PACKETS_PER_SESSION = 8
RECENT_EVENTS_LIMIT = 200
```

Official EasyTier proto is authoritative. Community relay repositories are references only. If official proto changes, update generated/scaffolded protocol handling from official EasyTier release/commit first, then adjust tests.

### 4. Validation & Error Matrix

| Condition | Required check |
|---|---|
| Packet parser changed | `npm run test` must include header layout assertions |
| Observer/API type changed | `npm run typecheck` and dashboard build must pass |
| Worker/Durable Object binding changed | `npm run build` must pass Wrangler dry-run |
| EasyTier proto copied/updated | `npm run proto:check` must pass and version note must be updated |
| New RPC compatibility claim | Add proto-backed decode/encode tests; do not rely on heuristic text scanning |

### 5. Good/Base/Bad Cases

- Good: add support for a new EasyTier packet type by updating `constants.ts`, parser tests, event handling, and API docs together.
- Base: record unknown RPC as `rpc_seen` with an explicit message that full decode is reserved for proto-backed work.
- Bad: copy stale `peer_rpc.proto` from community `easytier-ws-relay` and treat it as source of truth.
- Bad: claim `OspfRouteRpc.SyncRouteInfo` is fully implemented when code only observes an RPC envelope.

### 6. Tests Required

- `src/easytier/packet.test.ts` must cover header byte layout and payload length checks.
- Add tests for any new packet/RPC parser before using it in `RelayRoom` forwarding logic.
- Add integration tests around `/ws` and `/api/rooms/:roomId` before declaring real EasyTier node compatibility.
- Build must run Wrangler dry-run to validate Durable Object bindings.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Pull proto from a random relay fork because it is convenient.
import './community-relay/protos_generated';
```

#### Correct

```text
1. Select official EasyTier release/commit.
2. Sync official proto files into proto/easytier or generated sources.
3. Record source release/commit.
4. Run proto drift check and parser/RPC tests.
```

---

## Scenario: Real EasyTier Node Validation Evidence

### 1. Scope / Trigger

- Trigger: validating EdgeTier against real EasyTier nodes, deployed Worker endpoints, or private WSS peer URIs.
- Applies to v0.1.2 validation reports and future compatibility evidence before making stronger EasyTier support claims.

### 2. Signatures

Required local commands:

```text
npm run typecheck
npm run test
npm run build
npm run proto:check
npm run validate:help
```

Validation report path:

```text
.trellis/tasks/<task-id>/validation-report.md
```

### 3. Contracts

- Real deployment URLs, EasyTier client logs, and peer URIs must be redacted unless they are intentionally public test values.
- Never commit `network_secret`, private hostnames, full public IPs, Cloudflare credentials, or unredacted EasyTier logs.
- `.env.validation` is a local helper input only and must remain untracked.
- A missing private EdgeTier domain is an environment/deployment blocker, not evidence of protocol incompatibility.

### 4. Validation & Error Matrix

| Condition | Required report result |
|---|---|
| Local checks pass but no private endpoint exists | Mark real-node validation blocked by deployment environment |
| WebSocket connects but closes quickly | Record sanitized EasyTier logs and dashboard/API events |
| Peer IDs do not appear | Record whether `handshake_seen`, `rpc_seen`, or `decode_error` events appeared |
| Traffic counters do not increase | Record whether packets were `packet_unroutable`, `packet_forwarded`, or absent |
| Wrangler dry-run logs fail only because sandbox cannot write user log files | Re-run `npm run build` with permissions that allow Wrangler logging before recording a clean pass |

### 5. Good/Base/Bad Cases

- Good: report states the exact EasyTier version, OS/platforms, redacted endpoint, observed events, counters, and v0.1.3 implication.
- Base: report records local preflight as passed and explicitly blocks real-node conclusions until a private WSS endpoint and sanitized logs are available.
- Bad: claim protocol incompatibility when no deployed `wss://<edge-domain>/ws?room=<room>` endpoint was tested.
- Bad: paste raw EasyTier config containing `network_secret`.

### 6. Tests Required

- Before or after real-node validation, run the local command set listed above.
- For each new compatibility claim, add or identify tests that cover the parser, relay event, API, or dashboard behavior behind that claim.
- If real-client behavior exposes a protocol gap, capture the smallest reproducible event/log evidence needed for v0.1.3 proto-backed tests.

### 7. Wrong vs Correct

#### Wrong

```text
Real EasyTier is broken; no nodes connected.
```

#### Correct

```text
Real-node validation was blocked before connection attempt: no private EdgeTier WSS endpoint was configured.
Local preflight passed. Protocol compatibility remains unproven.
```

---

## Scenario: EasyTier RPC Request/Response Direction

### 1. Scope / Trigger

- Trigger: adding or changing EasyTier `RpcReq` / `RpcResp` decode, observer handling, or automatic RPC responses in `RelayRoom`.
- Applies to `src/easytier/rpc.ts`, `src/durable-objects/relay-room.ts`, and tests using real RPC vectors.

### 2. Signatures

```typescript
decodeEasyTierRpcPayload(payload: Uint8Array): DecodedEasyTierRpc
buildRpcResponsePayload(requestPacket: RpcPacket, responseBody: Uint8Array): Uint8Array
RelayRoom.handleRpc(session, header, payload, frame): Promise<boolean>
```

### 3. Contracts

- `PacketType.RpcReq` may decode an inner `RpcRequest` and may trigger a response when `toPeerId` targets EdgeTier.
- `PacketType.RpcResp` must be decoded as a response only; it must not be parsed as `SyncRouteInfoRequest`.
- EdgeTier may emit `RpcResp` for supported `RpcReq` services such as `OspfRouteRpc.SyncRouteInfo`.
- EdgeTier must never generate a response to an incoming `RpcResp`.
- `RpcPacket.is_request === false` is the proto-level response signal, even when the descriptor still names the original service.
- EasyTier 2.6.4 Rust RPC method indexes are **1-based**, generated by `build/rpc.rs` as `(i + 1)`.
  - `OspfRouteRpc.SyncRouteInfo = 1`
  - `PeerCenterRpc.ReportPeers = 1`
  - `PeerCenterRpc.GetGlobalPeerMap = 2`
  Do not assume protobuf service method indexes are 0-based when generating `RpcDescriptor.methodIndex`.
- EasyTier 2.6.4 RPC compression uses Zstd when `RpcPacket.compression_info.algo === 2`.
  Decompress `RpcPacket.body` before decoding the inner `RpcRequest`/`RpcResponse`; do not use gzip, `node:zlib`, or `DecompressionStream('gzip')` for this path.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| `RpcReq` target is EdgeTier and service is supported | Decode request body, update observer state, send one `RpcResp` |
| `RpcResp` target is EdgeTier | Decode/record response, do not send another response |
| `RpcResp` descriptor is `OspfRouteRpc` | Do not call `decodeSyncRouteInfoRequest` on the response wrapper |
| EdgeTier pushes `OspfRouteRpc.SyncRouteInfo` as a server-initiated `RpcReq` | Wrap it in `RpcRequest` + `RpcPacket`, encrypt when the session has keys, and throttle pushes per session |
| EdgeTier builds a server-pushed `RouteConnBitmap` | Include observed conn-bitmap edges plus EdgeTier-to-live-peer edges; do not synthesize full-mesh connectivity across route-only peers |
| A session is already bound to a client peer id | Do not rebind it from later packet headers; ignore `header.fromPeerId === EDGE_PEER_ID` to avoid showing the remote session as EdgeTier itself |
| `RpcPacket.compression_info.algo === 2` | Zstd-decompress `RpcPacket.body` with a Worker-compatible implementation before decoding `RpcRequest`; do not treat EasyTier RPC compression as gzip |
| EdgeTier sends active `PeerCenterRpc.GetGlobalPeerMap` | Use `methodIndex = 2`; `methodIndex = 1` is `ReportPeers` in official 2.6.4 |
| Unsupported compressed RPC body | Record unsupported compression; do not claim route-sync decode |
| Decrypt/decode failure | Record `decode_error`/`rpc_seen`; do not throw from the WebSocket handler |

### 5. Good/Base/Bad Cases

- Good: a real `RpcReq` carrying `OspfRouteRpc.SyncRouteInfo` updates route peers and receives one `SyncRouteInfoResponse`.
- Good: server-initiated route sync uses `methodIndex = 1`, and server-initiated PeerCenter global-map requests use `methodIndex = 2`.
- Good: route update pushes are rate-limited so frequent empty client route-sync requests do not create control-plane spam.
- Good: route update bitmaps advertise EdgeTier as connected to live WebSocket peers and preserve observed conn-bitmap edges without inventing direct links between route-only peers.
- Good: session peer identity is established from the handshake / first non-Edge packet and later control packets cannot rebind it to `EDGE_PEER_ID`.
- Good: a Zstd-compressed `RpcPacket.body` is decompressed with a Worker-compatible implementation before service dispatch.
- Base: an `RpcResp` for `OspfRouteRpc` is observed but produces no `syncRouteInfo` object.
- Bad: treating every `OspfRouteRpc` descriptor as a request and responding to an incoming `RpcResp`.
- Bad: using `methodIndex = 0` for official EasyTier 2.6.4 RPC calls because typical protobuf method arrays are 0-based.
- Bad: pushing a route update after every empty route-sync request from a real EasyTier node.
- Bad: broadcasting a full-mesh conn bitmap for all known route peers when those edges were not observed.
- Bad: calling `bindPeer(session, header.fromPeerId)` for every packet after handshake; some real control-plane packets can transiently carry EdgeTier's own peer id.
- Bad: treating EasyTier compressed RPC bodies as gzip or marking `algo === 2` unsupported.

### 6. Tests Required

- Unit test `buildRpcResponsePayload` wraps `SyncRouteInfoResponse` inside `RpcResponse` and `RpcPacket`.
- Unit test server-pushed `SyncRouteInfoRequest` payloads round-trip through `decodeEasyTierRpcPayload`.
- Regression test `decodeEasyTierRpcPayload` does not expose `syncRouteInfo` for `RpcPacket.is_request === false`.
- Regression test `decodeEasyTierRpcPayload` decompresses a Zstd-compressed `RpcRequest` before `SyncRouteInfo` service decode.
- Real traffic tests should assert decoded request peer identity fields from captured `RpcReq` vectors.
- Regression test session peer binding ignores `EDGE_PEER_ID` and later non-matching `fromPeerId` values after the client peer has been established.

### 7. Wrong vs Correct

#### Wrong

```typescript
if (descriptor.serviceName === 'PeerCenterRpc' && descriptor.methodIndex === 1) {
  const req = decodeGetGlobalPeerMapRequest(body);
  await sendRpcRequest(session, peerId, descriptor, encodeGetGlobalPeerMapRequest(req.digest ?? 0n));
}
```

#### Correct

```typescript
await sendRpcRequest(session, peerId, {
  protoName: 'peer_rpc',
  serviceName: 'PeerCenterRpc',
  methodIndex: 2,
}, encodeGetGlobalPeerMapRequest(0n));
```

#### Wrong

```typescript
if (isOspfRouteRpc(descriptor)) {
  const syncRouteInfo = decodeSyncRouteInfoRequest(packet.body);
  await sendRpcResponse(session, header.fromPeerId, decoded, response);
}
```

#### Wrong

```typescript
if (packet.compressionInfo?.algo && packet.compressionInfo.algo > CompressionAlgo.None) {
  return { service: 'unknown', message: 'unsupported compression' };
}
```

#### Correct

```typescript
if (packet.compressionInfo?.algo === CompressionAlgo.Zstd) {
  packet.body = decompressZstdRpcBody(packet.body);
}
```

#### Correct

```typescript
if (packet.isRequest === false) return { service: 'OspfRouteRpc.SyncRouteInfo', message: 'route sync RPC response decoded' };
if (header.packetType === EasyTierPacketType.RpcReq && targetIsEdge && decoded.syncRouteInfo) {
  await sendRpcResponse(session, header.fromPeerId, decoded, response);
}
```

---

## Forbidden Patterns

- Do not implement room-wide packet broadcast for EasyTier data plane packets.
- Do not log or return full network secret digests.
- Do not add Node-only APIs to Worker runtime code unless Cloudflare compatibility is verified.
- Do not mark heuristic RPC/handshake observation as full protocol compatibility.
- Do not commit generated runtime artifacts such as `node_modules/`, `dist/`, or `.wrangler/`.

---

## Required Patterns

- Keep packet offsets and limits centralized in `src/easytier/*`.
- Keep Worker routing thin; stateful WebSocket logic belongs in Durable Objects.
- Keep room registry freshness owned by `RelayRoom` activity, with throttled `Directory` writes for message-driven updates.
- Keep observer payload types in `src/observer/types.ts` and import them from dashboard code.
- When testing base64url HMAC/JWT tampering, mutate a non-tail signature character or rebuild the decoded bytes. Changing only the final base64url character can be non-canonical and may decode to the same bytes.
- Run `npm run typecheck`, `npm run test`, and `npm run build` after backend changes.
- Use `.gitignore` to exclude dependency/build/runtime artifacts.

---

## Testing Requirements

Minimum for protocol/backend changes:

```text
npm run typecheck
npm run test
npm run build
npm run proto:check
```

`npm run build` intentionally runs Vite and Wrangler dry-run so both dashboard assets and Worker bindings are validated.

---

## Code Review Checklist

- [ ] Are Cloudflare binding names aligned between `wrangler.toml` and `src/worker/env.ts`?
- [ ] Are all public API payload changes reflected in `src/observer/types.ts`?
- [ ] Does `/api/rooms` get updates from room activity rather than dashboard detail fetch side effects?
- [ ] Are EasyTier packet parser changes covered by tests?
- [ ] Are secret values truncated or omitted?
- [ ] Does the code avoid false claims of full EasyTier compatibility?
- [ ] Are generated artifacts ignored?
