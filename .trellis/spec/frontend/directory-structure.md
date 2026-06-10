# Directory Structure

> How frontend code is organized in this project.

---

## Overview

EdgeTier frontend code is a React + Vite dashboard embedded in the same repository as the Cloudflare Worker. The dashboard consumes the read-only observer API and uses Cloudflare Kumo for UI components.

Frontend code must not import Worker/Durable Object runtime code directly. Shared data contracts come from `src/observer/types.ts`.

---

## Directory Layout

```text
src/
├── dashboard/
│   ├── index.html      # Vite dashboard entry HTML
│   ├── main.tsx        # React mount
│   ├── app.tsx         # Dashboard application shell
│   ├── api.ts          # Read-only observer API client
│   ├── styles.css      # Minimal page-level styles
│   └── vite-env.d.ts
└── observer/
    └── types.ts        # Shared API payload contracts imported by dashboard
```

---

## Scenario: Dashboard to Observer API Contract

### 1. Scope / Trigger

- Trigger: Dashboard pages, API client functions, or observer payload fields.
- Applies to `src/dashboard/*` and `src/observer/types.ts`.

### 2. Signatures

Dashboard API functions:

```typescript
getRooms(): Promise<DirectoryRoomSummary[]>
getRoom(roomId: string): Promise<RoomSnapshot>
```

API endpoints consumed:

```text
GET /api/rooms
GET /api/rooms/:roomId
```

### 3. Contracts

The dashboard must use these shared types:

```typescript
interface DirectoryRoomSummary {
  roomId: string;
  peerCount: number;
  websocketCount: number;
  bytes: number;
  lastActivity?: string;
}

interface RoomSnapshot {
  roomId: string;
  peerCount: number;
  websocketCount: number;
  bytes: number;
  lastActivity?: string;
  traffic: TrafficSnapshot;
  peers: PeerSnapshot[];
  recentEvents: RelayEvent[];
}
```

Polling is acceptable for v0.1. Real-time dashboard WebSocket is not required.

### 4. Validation & Error Matrix

| Condition | UI behavior |
|---|---|
| `/api/rooms` fails | Display a visible error card/message |
| No rooms returned | Keep default selected room `test`; room detail may be empty |
| Peer id absent | Display `unknown` |
| Last activity absent | Display `none` |
| Byte count below 1024 | Display `N B` |
| Byte count >= 1024 | Display `N.N KiB` |

### 5. Good/Base/Bad Cases

- Good: dashboard imports `DirectoryRoomSummary` and `RoomSnapshot` from `../observer/types` instead of duplicating interfaces.
- Base: empty room renders zero counters and empty tables.
- Bad: dashboard assumes every peer has `peerId` and crashes on unknown sessions.
- Bad: dashboard fetches or displays full network secret digest.

### 6. Tests Required

- Future component test for empty room and unknown peer display.
- Future API client test for non-OK response handling.
- Build test through `npm run build` after every dashboard change.

### 7. Wrong vs Correct

#### Wrong

```typescript
interface PeerRow { id: number; rx: number; tx: number }
```

#### Correct

```typescript
import type { PeerSnapshot } from '../observer/types';
```

The API contract lives in `src/observer/types.ts`; the dashboard should not redefine it.

---

## Module Organization

- `app.tsx` owns the small v0.1 dashboard shell.
- `api.ts` owns fetch calls and response shape extraction.
- `styles.css` is page-level glue only; prefer Kumo components for UI structure.
- Shared DTOs come from `src/observer/types.ts`.

---

## Naming Conventions

- React components use PascalCase.
- Utility functions use camelCase.
- Dashboard files use concise lowercase names (`app.tsx`, `api.ts`).
- API payload types use backend names directly (`RoomSnapshot`, `DirectoryRoomSummary`).

---

## Examples

- `src/dashboard/app.tsx` shows polling `/api/rooms` and `/api/rooms/:roomId`.
- `src/dashboard/api.ts` centralizes dashboard fetch helpers.
- `src/observer/types.ts` is the shared DTO source.
