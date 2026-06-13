# Type Safety

> Type safety patterns in this project.

---

## Overview

EdgeTier uses TypeScript across Worker, Durable Object, protocol parsing, observer API, and dashboard code. Cross-layer API payload types are centralized in `src/observer/types.ts`.

Avoid duplicating payload interfaces in dashboard components. Avoid `any` for API data and protocol headers.

---

## Scenario: Shared Observer API Types

### 1. Scope / Trigger

- Trigger: Adding/changing observer API fields, dashboard API clients, directory summaries, active/stale state, or relay event payloads.
- Applies to `src/observer/types.ts`, `src/observer/api.ts`, `src/durable-objects/directory.ts`, `src/dashboard/api.ts`, and `src/dashboard/app.tsx`.

### 2. Signatures

Shared types:

```typescript
RelayEvent
PeerSnapshot
TrafficSnapshot
RoomSnapshot
DirectoryRoomSummary
TopologySnapshot
TopologySummary
```

Dashboard API helpers:

```typescript
getRooms(): Promise<DirectoryRoomSummary[]>
getRoom(roomId: string): Promise<RoomSnapshot>
getRoomEvents(roomId: string): Promise<RelayEvent[]>
getRoomTraffic(roomId: string): Promise<TrafficSnapshot>
```

Directory validation helpers:

```typescript
validateDirectoryRoomSummary(value: unknown): DirectoryRoomSummary | null
markRoomActivity(rooms: DirectoryRoomSummary[], now?: number): DirectoryRoomSummary[]
```

### 3. Contracts

- `timestamp`, `connectedAt`, `lastSeen`, and `lastActivity` are ISO strings when present.
- `peerId` is optional because sessions may be connected before a parseable packet identifies a peer.
- `networkSecretDigestPrefix` is optional and must never become a full digest.
- `DirectoryRoomSummary.active` is optional at rest/input and computed on directory GET.
- Caller-supplied `active` must not be trusted or stored as truth.
- `RoomSnapshot.recentEvents` is the recent ring-buffer view, not an audit log.
- `TrafficSnapshot` counters are numbers and monotonically increase for the current room object lifetime.
- `TrafficSnapshot.samples` is a bounded room-local time series of Worker-observed relay frame rates. Dashboard charts must read `rxBytesPerSecond`/`txBytesPerSecond` from samples and must not infer direct EasyTier P2P data-plane traffic between other nodes.
- `TrafficSnapshot.summary.relayDropRate` is a Worker relay drop ratio from invalid/unroutable frames. It is not official EasyTier per-connection `loss_rate`; render official loss rate as `not observed` unless a typed payload field explicitly provides it.
- `TopologySnapshot.summary` is the API-owned aggregate for topology metrics. Dashboard components may render fallback values for older responses, but new API code must populate it.
- `TopologySummary.peerCenterRatio` is a number from 0 to 1 when edges exist; render it as a percentage in the dashboard.
- `TopologySnapshot.routes` is a Worker-rooted derived path list from conn bitmap/live peer sessions. Render `source: "unreachable"` as unavailable instead of inventing a next hop.
- `TopologySnapshot.connectionMatrix` is the decoded conn-bitmap adjacency matrix; render matrix cells from `connectedPeerIds` rather than recalculating from graph SVG state.

### 4. Validation & Error Matrix

| Type condition | Required behavior |
|---|---|
| Optional field missing | UI must render fallback text |
| New API field added | Add to `src/observer/types.ts` first |
| API response shape changed | Update dashboard helper return type and usage together |
| Topology DTO changed | Update `TopologySnapshot`, `TopologySummary`, `/api/rooms/:roomId/topology`, and `Topology` component usage together |
| Traffic DTO changed | Update `TrafficSnapshot`, `/api/rooms/:roomId/traffic`, `RoomSnapshot.traffic`, and overview chart/rate usage together |
| Directory POST body unknown | Runtime-validate with `validateDirectoryRoomSummary` |
| Directory POST body has caller-supplied `active` | Drop `active`; recompute on GET |
| Protocol header parse fails | Return `null`, not a partially typed object |

### 5. Good/Base/Bad Cases

- Good: `import type { RoomSnapshot } from '../observer/types';`
- Good: `formatPercent(room.traffic.summary.relayDropRate)` with text that identifies it as Worker relay drop rate.
- Good: `route.lossRate === undefined ? t('common.notObserved') : formatPercent(route.lossRate)` for official EasyTier loss fields.
- Good: `parseEasyTierHeader(frame): EasyTierPacketHeader | null` for invalid input.
- Good: `validateDirectoryRoomSummary(value): DirectoryRoomSummary | null` at the storage boundary.
- Base: `peerId?: number` remains optional.
- Base: `active?: boolean` is present in API output but not trusted on input.
- Bad: dashboard defines its own `Room` type with different field names.
- Bad: dashboard labels Worker `relayDropRate` as EasyTier packet loss.
- Bad: using `as any` to silence API contract mismatches.
- Bad: storing an unvalidated `request.json()` object into DO storage.

### 6. Tests Required

- `npm run typecheck` after any DTO/API/dashboard change.
- Unit test pure topology/traffic aggregators when adding fields to `TopologySummary`, `RoutePathSnapshot`, `ConnectionMatrixSnapshot`, `TrafficSample`, or `TrafficSummary`.
- Parser tests for typed protocol helpers.
- Directory validation tests for valid/invalid summaries and active flag sanitization.
- Future API contract tests for `/api/rooms/:roomId` response shape.

### 7. Wrong vs Correct

#### Wrong

```typescript
const summary = await request.json() as DirectoryRoomSummary;
await state.storage.put(`room:${summary.roomId}`, summary);
```

#### Correct

```typescript
const body: unknown = await request.json();
const summary = validateDirectoryRoomSummary(body);
if (!summary) return Response.json({ error: 'invalid room summary' }, { status: 400 });
await state.storage.put(`room:${summary.roomId}`, summary);
```

---

## Type Organization

- Worker environment/bindings: `src/worker/env.ts`.
- Observer API DTOs: `src/observer/types.ts`.
- EasyTier packet and protocol observations: `src/easytier/types.ts` and `src/easytier/packet.ts`.
- Directory validation helpers: `src/durable-objects/directory.ts`.
- Dashboard formatting helpers: `src/dashboard/format.ts`.
- Component props: local to component unless reused.

---

## Validation

Runtime validation currently exists for:

- Room names via `ROOM_NAME_PATTERN`.
- Directory summary POST bodies via `validateDirectoryRoomSummary`.
- EasyTier frame/header length via `parseEasyTierHeader` and `payloadLengthMatches`.

If API payloads become user-submitted beyond internal DO summary upserts, add explicit runtime validation before storage.

---

## Common Patterns

- Use `import type` for DTO imports in dashboard code.
- Return `null` for invalid protocol parse attempts.
- Keep optional fields optional through all layers.
- Treat `unknown` from `request.json()` as untrusted until validated.

---

## Forbidden Patterns

- Do not use `any` for observer API payloads.
- Do not duplicate DTOs in dashboard files.
- Do not type assert protocol parsing success without checking for `null`.
- Do not store unvalidated request bodies.
- Do not model full EasyTier proto fields manually unless synced from official proto.
