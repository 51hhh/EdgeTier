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
