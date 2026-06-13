# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

EdgeTier v0.1.1 does not use a traditional database or ORM. It uses Cloudflare Durable Object state for active room/session state and a small `Directory` Durable Object with DO storage for room summaries.

Future versions may add D1, KV, R2, or Analytics Engine, but those are not part of the v0.1.x storage contract.

---

## Scenario: Durable Object Storage for Room Directory

### 1. Scope / Trigger

- Trigger: Any persisted room summary, room directory freshness, room summary validation, or storage integration change.
- Applies to `src/durable-objects/directory.ts` and future D1/KV/Analytics additions.

### 2. Signatures

```typescript
interface DirectoryRoomSummary {
  roomId: string;
  peerCount: number;
  websocketCount: number;
  bytes: number;
  lastActivity?: string;
  active?: boolean;
}

const ROOM_RECENT_ACTIVITY_TTL_MS = 5 * 60 * 1000;
const ROOM_ACTIVE_TTL_MS = ROOM_RECENT_ACTIVITY_TTL_MS;

markRoomActivity(rooms: DirectoryRoomSummary[], now?: number): DirectoryRoomSummary[]
validateDirectoryRoomSummary(value: unknown): DirectoryRoomSummary | null
Directory.fetch(request: Request): Promise<Response>
```

Directory internal API:

```text
GET  https://directory/                  -> { rooms: DirectoryRoomSummary[] }
POST https://directory/ body Summary      -> { ok: true }
POST https://directory/ invalid body      -> 400 { error: "invalid room summary" }
```

Storage key format:

```text
room:<roomId>
```

### 3. Contracts

- `Directory` stores only summary metadata, not live WebSocket handles or raw packet/event payloads.
- `RelayRoom` owns live session state and recent events.
- `RelayRoom` pushes bounded summaries to `Directory` from room activity; `/api/rooms` must not depend on a dashboard client first fetching `/api/rooms/:roomId`.
- `Directory` validates POST bodies before storage.
- Caller-supplied `active` flags are dropped on write. Activity is recomputed on read from `lastActivity`.
- A room is active only when `lastActivity` parses as a finite timestamp, is not in the future, and is within `ROOM_RECENT_ACTIVITY_TTL_MS`.
- Stale rooms remain visible but are marked `active: false` rather than silently deleted.
- Room summaries are sorted by `roomId` in the directory response.

### 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| Directory GET | Return all stored room summaries as `{ rooms }`, each with computed `active` |
| Directory POST valid summary | Store sanitized summary under `room:<roomId>`, return `{ ok: true }` |
| Directory POST invalid JSON | Return `400 { error: "invalid room summary" }` |
| Directory POST invalid room id | Return `400 { error: "invalid room summary" }` |
| Directory POST negative/NaN/Infinity counters | Return `400 { error: "invalid room summary" }` |
| Directory POST invalid `lastActivity` | Return `400 { error: "invalid room summary" }` |
| Stored summary has missing/old/future `lastActivity` | Return with `active: false` |
| Stored summary has recent `lastActivity` | Return with `active: true` |

### 5. Good/Base/Bad Cases

- Good: store `{ roomId: "home-mesh", peerCount: 2, websocketCount: 2, bytes: 1024, lastActivity: "2026-06-09T12:00:00.000Z" }` under `room:home-mesh`.
- Good: recompute `active` during GET with `markRoomActivity`, not during POST.
- Base: `/api/rooms` returns an empty array before any room summary has been upserted.
- Base: old rooms stay listed as stale/inactive so users can still see historical room names during private testing.
- Bad: accept `active: true` from a caller and store it as truth.
- Bad: store full per-packet event logs in `Directory`; that belongs in a future event storage/Analytics design.
- Bad: store WebSocket/session objects in Durable Object storage; they are runtime-only.

### 6. Tests Required

- Unit test recent room summaries are marked `active: true`.
- Unit test old, missing, and future `lastActivity` values are marked `active: false`.
- Unit test valid summaries are sanitized and caller-supplied `active` is dropped.
- Unit test invalid payloads are rejected: unsafe room id, negative counters, NaN/Infinity counters, invalid date.
- Future integration test: `RelayRoom` activity upserts `Directory` summaries without requiring dashboard detail fetch side effects.
- Future migration test before adding D1/KV/Analytics Engine.

### 7. Wrong vs Correct

#### Wrong

```typescript
await state.storage.put(`room:${summary.roomId}`, summary); // trusts caller-supplied active
```

#### Correct

```typescript
const summary = validateDirectoryRoomSummary(body);
if (!summary) return Response.json({ error: 'invalid room summary' }, { status: 400 });
await state.storage.put(`room:${summary.roomId}`, summary);

const summaries = markRoomActivity([...rooms.values()]);
```

`Directory` is an index with computed freshness, not the source of truth for live WebSockets.

---

## Scenario: Durable Object Storage for Relay Control-Plane Observer State

### 1. Scope / Trigger

- Trigger: Persisting EasyTier route/topology/PeerCenter observer state or adding Durable Object alarms for relay cleanup.
- Applies to `src/durable-objects/relay-room.ts`, `src/observer/types.ts`, and dashboard topology consumers.

### 2. Signatures

Storage key:

```text
control-state:v1
```

RelayRoom methods:

```typescript
RelayRoom.alarm(): Promise<void>
loadControlState(): Promise<void>
persistControlState(): Promise<void>
ensureMaintenanceAlarm(): Promise<void>
```

Persisted shape:

```typescript
interface PersistedControlState {
  routeVersion: number;
  topologyUpdatedAt?: string;
  routePeers: RoutePeerSnapshot[];
  rawRoutePeerInfos: RoutePeerInfo[];
  connBitmapEdges: TopologyEdge[];
  peerCenter: Array<{
    peerId: number;
    directPeers: Array<[number, { latencyMs: number }]>;
    lastSeen: string;
  }>;
}
```

### 3. Contracts

- Persist only observer/control-plane state that is safe for the private dashboard: route peers, route proto fields, topology edges, PeerCenter latency data, and route version.
- Do not persist WebSocket objects, session runtime queues, AES keys, network secrets, cookies, relay tokens, raw packet bytes, or full network secret digests.
- WebSocket sessions are runtime-only unless the code is explicitly migrated to Cloudflare WebSocket Hibernation API.
- Durable Object alarms may send EasyTier Ping frames, close timed-out sockets, prune stale route/PeerCenter entries, and persist the pruned state.
- Route cleanup should remove route state sourced from a disconnected peer when no live session still owns that peer.

### 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| Stored control state missing | Start with empty in-memory route/topology state |
| Stored route peer has invalid `peerId` | Drop that entry during load |
| Stored PeerCenter latency is non-finite | Drop that direct-peer entry during load |
| Route/PeerCenter entry is older than relay TTL and has no live session | Prune it and persist the pruned state |
| WebSocket is open but silent beyond heartbeat timeout after EdgeTier sent Ping | Close the socket and run normal disconnect cleanup |
| Test seed clear is requested | Clear in-memory observer state and persist the empty control state |

### 5. Good/Base/Bad Cases

- Good: persist `routePeers`, `rawRoutePeerInfos`, `connBitmapEdges`, and PeerCenter latency maps under `control-state:v1`.
- Good: rehydrate route/PeerCenter observer state after Durable Object eviction, then prune stale entries before serving snapshots.
- Base: after a cold start with no persisted state, `/api/rooms/:id/topology` returns empty nodes/edges plus a zero summary.
- Bad: storing `DerivedKeys`, `networkSecret`, WebSocket handles, raw packet payloads, or full digests in Durable Object storage.
- Bad: treating persisted route state as proof of live WebSocket connectivity.

### 6. Tests Required

- Unit test config/storage helper behavior when exposed as pure functions.
- Unit test topology summary fields when DTO shape changes.
- Regression test route bitmap builders do not synthesize full-mesh edges unless observed.
- Future integration test: persisted control state reloads after Durable Object restart and stale entries are pruned.
- Future live validation: real node disconnect removes route/PeerCenter entries from the dashboard within the heartbeat/TTL window.

### 7. Wrong vs Correct

#### Wrong

```typescript
await state.storage.put('session', { ws, keys, networkSecret });
```

#### Correct

```typescript
await state.storage.put('control-state:v1', {
  routeVersion,
  routePeers: [...routePeers.values()],
  rawRoutePeerInfos: [...rawRoutePeerInfos.values()],
  connBitmapEdges,
  peerCenter: serializePeerCenter(peerCenter),
});
```

Durable Object storage keeps safe observer state only. Live sockets and secrets remain runtime-only.

---

## Query Patterns

No ORM/query library is used. Durable Object storage calls should stay local and simple:

```typescript
await state.storage.put(`room:${summary.roomId}`, summary);
const rooms = await state.storage.list<DirectoryRoomSummary>({ prefix: 'room:' });
const summaries = markRoomActivity([...rooms.values()]).sort((a, b) => a.roomId.localeCompare(b.roomId));
```

---

## Migrations

Cloudflare Durable Object migrations are declared in `wrangler.toml`:

```toml
[[migrations]]
tag = "v1"
new_sqlite_classes = ["RelayRoom", "Directory"]
```

When adding/removing Durable Object classes, update both bindings and migrations.

---

## Naming Conventions

- DO storage keys use lowercase prefixes and colon separators: `room:<roomId>`.
- Summary interfaces use the `Summary` suffix.
- Snapshot interfaces use the `Snapshot` suffix and are served directly through read-only APIs.
- TTL constants use `_MS` suffix.

---

## Common Mistakes

### Common Mistake: Treating stored room summaries as live state

**Symptom**: `/api/rooms` shows old disconnected rooms as active forever.

**Cause**: Directory summaries are persisted and do not expire by themselves.

**Fix**: Recompute `active` from `lastActivity` using `markRoomActivity` on read.

**Prevention**: Any room registry UI must display active/stale state and must not assume directory entries are live WebSocket sessions.
