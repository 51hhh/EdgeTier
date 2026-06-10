# Hook Guidelines

> How hooks are used in this project.

---

## Overview

EdgeTier v0.1 uses built-in React hooks only. Data fetching currently lives in `App` via `useEffect`, `useState`, and `useMemo` because the dashboard is small.

Extract custom hooks only when multiple components need the same stateful data-fetching behavior.

---

## Scenario: Dashboard Polling Hook Pattern

### 1. Scope / Trigger

- Trigger: Adding custom dashboard hooks or changing polling/data-fetching lifecycle.
- Applies to future `src/dashboard/hooks/*` and current `src/dashboard/app.tsx` polling logic.

### 2. Signatures

Current built-in hook pattern:

```typescript
useEffect(() => {
  const tick = async () => { /* fetch rooms and selected room */ };
  void tick();
  const timer = setInterval(tick, 5000);
  return () => clearInterval(timer);
}, [selected]);
```

Future custom hook shape, if extracted:

```typescript
function useRoomSnapshot(selectedRoomId: string): {
  rooms: DirectoryRoomSummary[];
  room: RoomSnapshot | null;
  error: string | null;
}
```

### 3. Contracts

- Polling hooks must clear intervals on cleanup.
- Fetch errors become displayable strings, not thrown render errors.
- Hooks must use shared observer DTOs from `src/observer/types.ts`.
- Hooks must not mutate server state; dashboard is read-only.

### 4. Validation & Error Matrix

| Condition | Hook behavior |
|---|---|
| Fetch succeeds | Update state and clear error |
| Fetch fails | Set error string |
| Dependency changes | Refetch selected room and reset interval |
| Component unmounts | Clear interval |

### 5. Good/Base/Bad Cases

- Good: keep polling inline while only `App` consumes it.
- Base: extract `useRoomSnapshot` when dashboard sections become separate components.
- Bad: custom hook with hidden writes to server state.
- Bad: hook that starts intervals without cleanup.

### 6. Tests Required

- Future hook test with fake timers when a custom polling hook is introduced.
- Assert cleanup clears interval.
- Assert failed fetch sets `error`.

### 7. Wrong vs Correct

#### Wrong

```typescript
useEffect(() => {
  setInterval(fetchRooms, 5000);
}, []);
```

#### Correct

```typescript
useEffect(() => {
  const timer = setInterval(tick, 5000);
  return () => clearInterval(timer);
}, [selected]);
```

---

## Custom Hook Patterns

Do not create custom hooks for one-off state. When introduced, place them under `src/dashboard/hooks/` and return typed data objects.

---

## Data Fetching

Use `src/dashboard/api.ts` for fetch helpers. Hooks/components should not repeat endpoint string parsing logic.

---

## Naming Conventions

Custom hooks use `use*` names and return explicit typed objects.

---

## Common Mistakes

### Common Mistake: Polling without cleanup

**Symptom**: Multiple dashboard intervals keep running after view changes or hot reload.

**Cause**: Missing cleanup function in `useEffect`.

**Fix**: Return `() => clearInterval(timer)`.

**Prevention**: Any polling hook must have a cleanup assertion in tests once extracted.
