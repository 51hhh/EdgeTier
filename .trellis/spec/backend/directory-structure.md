# Directory Structure

> How backend code is organized in this project.

---

## Overview

EdgeTier backend code is a TypeScript Cloudflare Worker application. Runtime code is organized by Cloudflare boundary first, then by EasyTier protocol and observer API responsibilities.

The backend is not a generic Node server. Code must run in the Cloudflare Workers runtime and should assume Durable Object boundaries for WebSocket room state.

---

## Directory Layout

```text
src/
├── worker/
│   ├── index.ts        # Worker fetch entrypoint and top-level route dispatch
│   └── env.ts          # Cloudflare binding types
├── durable-objects/
│   ├── relay-room.ts   # Per-room EasyTier-aware WebSocket relay state
│   └── directory.ts    # Durable room registry used by /api/rooms
├── easytier/
│   ├── constants.ts    # Packet types, limits, room validation regex
│   ├── packet.ts       # 16-byte EasyTier packet header parse/create helpers
│   ├── rpc.ts          # Best-effort protocol observation scaffolding
│   └── types.ts        # Protocol observation types
└── observer/
    ├── api.ts          # Read-only API routing helpers
    └── types.ts        # API payload contracts shared with dashboard

proto/
└── easytier/           # Official EasyTier proto tracking notes/files

scripts/
└── check-proto-drift.mjs
```

---

## Scenario: Worker/Durable Object Relay and Observer API

### 1. Scope / Trigger

- Trigger: New Cloudflare Worker route signatures, Durable Object bindings, API response contracts, and cross-layer dashboard payloads.
- Applies when adding or changing `/ws`, `/api/*`, `RelayRoom`, `Directory`, EasyTier packet parsing, or observer snapshot fields.

### 2. Signatures

Public Worker routes:

```text
GET /ws?room=<room>                         # WebSocket upgrade only
GET /api/health                             # service health JSON
GET /api/rooms                              # directory summary list
GET /api/rooms/:roomId                      # full room snapshot
GET /api/rooms/:roomId/peers                # peer list
GET /api/rooms/:roomId/events               # recent event list
GET /api/rooms/:roomId/traffic              # room traffic counters
GET /api/rooms/:roomId/topology             # route/PeerCenter topology snapshot
POST /api/rooms/:roomId/token               # issue short-lived room-scoped WSS token
POST /api/rooms/:roomId/test-seed           # auth-guarded synthetic observer data for dashboard verification
GET /dashboard                              # redirects to /dashboard/
```

Durable Object internal routes:

```text
RelayRoom.fetch("/connect?room=<room>")     # accepts WebSocket
RelayRoom.fetch("/?room=<room>")            # RoomSnapshot JSON
RelayRoom.fetch("/peers?room=<room>")       # { peers }
RelayRoom.fetch("/events?room=<room>")      # { events }
RelayRoom.fetch("/traffic?room=<room>")     # TrafficSnapshot JSON
RelayRoom.fetch("/topology?room=<room>")    # TopologySnapshot JSON
RelayRoom.fetch("/test-seed?room=<room>")   # synthetic observer data mutation, auth guarded upstream

Directory.fetch("/", GET)                   # { rooms }
Directory.fetch("/", POST RoomSummary)      # persists/upserts summary
```

Wrangler bindings:

```toml
[[durable_objects.bindings]]
name = "RELAY_ROOM"
class_name = "RelayRoom"

[[durable_objects.bindings]]
name = "DIRECTORY"
class_name = "Directory"

[assets]
directory = "dist/client"
binding = "ASSETS"
```

### 3. Contracts

Room names:

```typescript
ROOM_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
```

Room names are URL routing hints in v0.1. Future protocol-backed isolation must derive from EasyTier handshake identity:

```text
networkName + networkSecretDigest
```

Never expose the full network secret digest. Use an opaque room id or short digest prefix only.

EasyTier network secret configuration:

```text
EASYTIER_NETWORK_SECRET                      # fallback single-network secret
EASYTIER_NETWORK_NAME                        # fallback expected network name; defaults to room id
EASYTIER_NETWORK_SECRETS                     # JSON object keyed by room id or network name, value is secret
EASYTIER_NETWORKS                            # JSON object keyed by room id; value is secret string or { networkName, secret }
```

`EASYTIER_NETWORKS` takes precedence for network name selection. If its room entry omits `secret`, the relay falls back to
`EASYTIER_NETWORK_SECRETS[roomId]`, then `EASYTIER_NETWORK_SECRETS[networkName]`, then `EASYTIER_NETWORK_SECRET`.
Secrets must be configured as Worker secrets or gitignored local env values; never commit real values.

EasyTier packet header contract:

```typescript
interface EasyTierPacketHeader {
  fromPeerId: number;      // uint32 little-endian at offset 0
  toPeerId: number;        // uint32 little-endian at offset 4
  packetType: number;      // uint8 at offset 8
  flags: number;           // uint8 at offset 9
  forwardCounter: number;  // uint8 at offset 10
  reserved: number;        // uint8 at offset 11
  len: number;             // uint32 little-endian at offset 12
}
```

Observer payloads are defined in `src/observer/types.ts` and must remain the shared contract between Worker APIs and dashboard code.

### 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| `/ws` without `Upgrade: websocket` | Return `426 WebSocket upgrade required` |
| Missing/invalid room query | Return JSON `400 { error: "invalid or missing room name" }` |
| Invalid `/api/rooms/:roomId` | Return JSON `400 { error: "invalid room name" }` |
| Frame larger than `MAX_FRAME_SIZE` | Record `decode_error`/`limit_exceeded`; close after invalid threshold |
| Frame shorter than 16-byte EasyTier header | Record `decode_error` |
| Header payload length inconsistent | Record `decode_error` |
| Target peer not connected | Record `packet_unroutable`, do not broadcast across the room |
| Room peer limit exceeded | Return `429 room peer limit exceeded` |

### 5. Good/Base/Bad Cases

- Good: `/ws?room=home-mesh` with WebSocket upgrade creates a `RelayRoom` session, records `connected`, syncs a room summary to `Directory`, parses later EasyTier headers, and forwards only to the requested `toPeerId`.
- Base: `/api/rooms/test` returns an empty `RoomSnapshot` when no peers are connected.
- Bad: `/api/rooms` only learns a room after a dashboard client first calls `/api/rooms/:roomId`; room registry freshness must originate from room activity.
- Bad: `/ws?room=../../secret` is rejected by `ROOM_NAME_PATTERN`.
- Bad: A packet with `len` larger or smaller than the actual payload is counted as invalid and is not forwarded.

### 6. Tests Required

- Unit test `parseEasyTierHeader` with little-endian round trip assertions for all 16 header bytes.
- Unit test `payloadLengthMatches` for exact, larger, and too-short payloads.
- API test or Worker integration test for `/api/health`, invalid room rejection, and non-WebSocket `/ws` rejection.
- Durable Object integration test before production for peer binding and directed forwarding.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Broadcasts every packet to every socket in the room.
for (const peer of sessions.values()) peer.ws.send(frame);
```

#### Correct

```typescript
const targetSessionId = header.toPeerId ? peers.get(header.toPeerId) : undefined;
const target = targetSessionId ? sessions.get(targetSessionId) : undefined;
if (!target) recordUnroutable();
else target.ws.send(frame);
```

Directed forwarding prevents cross-peer leakage and keeps relay accounting meaningful.

---

## Module Organization

- `src/worker/` owns Cloudflare entrypoint concerns only: URL routing, binding access, WebSocket upgrade checks, and asset fallback.
- `src/durable-objects/` owns stateful Cloudflare objects. WebSocket session maps and per-room counters belong here.
- `RelayRoom` owns live room activity and pushes bounded summaries to `Directory`; `/api/rooms` must not depend on clients first fetching `/api/rooms/:roomId`.
- `Directory` owns the global room registry for summaries only. Add TTL/stale pruning before treating it as an authoritative live registry.
- `src/easytier/` owns protocol constants/parsing. Do not duplicate packet offsets in Durable Object or API code.
- `src/observer/` owns JSON API contracts shared by the Worker and dashboard.
- `proto/easytier/` owns official EasyTier proto tracking; community relay proto files are not authoritative.

---

## Naming Conventions

- Durable Object classes use PascalCase: `RelayRoom`, `Directory`.
- Runtime modules use kebab-case file names: `relay-room.ts`, `check-proto-drift.mjs`.
- Observer DTOs use `Snapshot`, `Summary`, or `Event` suffixes.
- Cloudflare binding names are uppercase snake case: `RELAY_ROOM`, `DIRECTORY`, `ASSETS`.

---

## Examples

- `src/worker/index.ts` shows public Worker route dispatch.
- `src/durable-objects/relay-room.ts` shows room-local WebSocket state and EasyTier packet routing.
- `src/observer/api.ts` shows API-to-Durable Object routing.
- `src/easytier/packet.ts` is the single source of truth for the 16-byte header layout.
