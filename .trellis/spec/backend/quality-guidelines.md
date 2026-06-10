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
