# State Management

> How state is managed in this project.

---

## Overview

EdgeTier v0.1.1 dashboard uses local React state and polling for server state. There is no global client state library yet.

Server state remains authoritative in Worker/Durable Object APIs. The dashboard caches only the latest successful poll results in component state and keeps those results visible through transient API errors.

---

## Scenario: Polling Observer API State

### 1. Scope / Trigger

- Trigger: Dashboard data fetching, polling cadence, selected room state, manual room lookup, or API response caching.
- Applies to `src/dashboard/app.tsx` and `src/dashboard/api.ts`.

### 2. Signatures

State variables in `App`:

```typescript
const [rooms, setRooms] = useState<DirectoryRoomSummary[]>([]);
const [defaultRoom, setDefaultRoom] = useState<DefaultRoomResponse | null>(null);
const [selected, setSelected] = useState<string | null>(null);
const [lookup, setLookup] = useState('');
const [room, setRoom] = useState<RoomSnapshot | null>(null);
const [outboundTcp, setOutboundTcp] = useState<OutboundTcpStatus | null>(null);
const [error, setError] = useState<string | null>(null);
const [lookupError, setLookupError] = useState<string | null>(null);
const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
```

Polling interval and API calls:

```typescript
getDefaultRoom();
setInterval(tick, 5000);
Promise.all([getRoom(roomId), getRoomEvents(roomId), getRoomTraffic(roomId), getRoomTopology(roomId), getOutboundTcpStatus(roomId)]);
```

Selection/lookup helpers:

```typescript
selectRoom(roomId: string): void
submitLookup(event: FormEvent<HTMLFormElement>): void
```

### 3. Contracts

- `rooms` is the latest successful `/api/rooms` response.
- `defaultRoom` is the safe, secret-free `/api/default-room` response used to select the configured room on first dashboard load.
- `selected` is local UI state for the room id to inspect; `null` means no room is selected.
- `lookup` is the manual room lookup input value.
- `lookupError` is client-side validation feedback for manual lookup.
- `room` is the merged result of `/api/rooms/:roomId`, `/api/rooms/:roomId/events`, and `/api/rooms/:roomId/traffic`, or `null` while unavailable.
- `outboundTcp` is the latest room-scoped outbound TCP status. Polling it is read-only from the dashboard perspective, but it reaches the room Durable Object and may trigger configured TCP dialing.
- `error` is display-only and cleared after a successful poll.
- Poll failures must not clear previous successful `rooms` or `room` state.
- Polling must be cleaned up in the `useEffect` cleanup function.
- Keep the polling cadence coarse enough for read-only observation; v0.1.x uses 5 seconds.
- Manual lookup must validate `ROOM_NAME_PATTERN` before changing `selected`.

### 4. Validation & Error Matrix

| Condition | State behavior |
|---|---|
| Poll succeeds with no selected room | Update `rooms`, leave `room` unchanged/null, clear `error`, update `lastRefreshed` |
| Poll succeeds with selected room | Update `rooms`, merge room snapshot/events/traffic, clear `error`, update `lastRefreshed` |
| Default room load succeeds and no room is selected | Set `selected` and `lookup` to the default `roomId` |
| Poll fails | Keep previous data, set `error` message |
| Lookup room name invalid | Set `lookupError`, do not change `selected` |
| Lookup room name valid | Set `selected`, copy room id into `lookup`, clear `lookupError` |
| `rooms.length === 0` | Render no-rooms empty state; manual lookup remains available |
| Component unmounts | Clear polling timer |

### 5. Good/Base/Bad Cases

- Good: local polling state for the small v0.1 dashboard.
- Good: display stale previous data with an error banner when a poll fails.
- Good: manually inspect a known room even if it has not appeared in `Directory` yet.
- Base: no rooms yet, `selected` remains `null`, and the dashboard prompts room lookup.
- Bad: adding Redux/Zustand/React Query before there are multiple independent data consumers.
- Bad: clearing all dashboard data on a transient API error.
- Bad: storing mutable server state in browser localStorage.

### 6. Tests Required

- Future component test: failed API call sets visible error without clearing previous data.
- Future component test: manual lookup rejects invalid room names.
- Future test: polling cleanup occurs on unmount when component testing is introduced.

### 7. Wrong vs Correct

#### Wrong

```typescript
catch (err) {
  setRooms([]);
  setRoom(null);
  setError(String(err));
}
```

#### Correct

```typescript
catch (err) {
  setError(err instanceof Error ? err.message : 'dashboard fetch failed');
}
```

Observer API state is transient and should be refreshed from the Worker, but the UI should preserve the last known good snapshot through temporary errors.

---

## State Categories

- Local UI state: selected room, lookup input, lookup error, visible API error, last refresh timestamp.
- Server state: rooms, room snapshots, peer lists, events, traffic.
- URL state: not used yet.
- Global state: not used yet.

---

## When to Use Global State

Do not add a global state library until at least two independently mounted dashboard areas need shared cache or coordination.

---

## Server State

Use typed fetch helpers in `src/dashboard/api.ts`. Polling is acceptable for v0.1.x; WebSocket dashboard updates are future work.

---

## Common Mistakes

### Common Mistake: Introducing global state too early

**Symptom**: More client architecture than product UI.

**Cause**: Treating the dashboard like a complex app before there are multiple views with shared mutation flows.

**Fix**: Keep state local and typed. Extract only when the dashboard grows.

**Prevention**: Add a state library only when a PRD identifies the cross-component cache problem it solves.

### Common Mistake: Clearing useful data on transient errors

**Symptom**: Dashboard goes blank when one poll fails.

**Cause**: Error handler resets `rooms` and `room` state.

**Fix**: Keep previous successful state and show an error banner.

**Prevention**: Treat polling errors as temporary unless the user explicitly changes selection or refreshes.
