# Error Handling

> How errors are handled in this project.

---

## Overview

EdgeTier backend errors are boundary-oriented. Public HTTP routes return small JSON or text responses with explicit status codes. Durable Object packet processing records observer events instead of throwing for malformed EasyTier traffic.

The relay should stay available when a single packet is malformed. Protocol decode errors are counted and surfaced through read-only events.

---

## Scenario: Worker API and Relay Packet Errors

### 1. Scope / Trigger

- Trigger: Public API and WebSocket route error responses, malformed packet handling, and cross-layer error display in the dashboard.
- Applies to `src/worker/index.ts`, `src/observer/api.ts`, and `src/durable-objects/relay-room.ts`.

### 2. Signatures

```typescript
json(data: unknown, status = 200): Response
validRoom(roomId: string | null): roomId is string
handleApi(request: Request, env: Env): Promise<Response | null>
```

Public error responses:

```json
{ "error": "invalid or missing room name" }
{ "error": "invalid room name" }
```

Relay event error types:

```typescript
type RelayEventType =
  | 'decode_error'
  | 'limit_exceeded'
  | 'packet_unroutable'
  | 'rpc_seen'
  | 'connected'
  | 'disconnected'
  | 'handshake_seen'
  | 'packet_forwarded';
```

### 3. Contracts

- API validation errors return JSON and status `400`.
- Non-WebSocket `/ws` requests return status `426` with text `WebSocket upgrade required`.
- Room peer limit returns status `429` with text `room peer limit exceeded`.
- Packet-level errors do not become HTTP errors because they happen after WebSocket upgrade. They become `RelayEvent` entries and traffic counters.
- Full network secret digest values must never appear in error responses or event messages.

### 4. Validation & Error Matrix

| Condition | Status/Event | Notes |
|---|---|---|
| `/ws` missing upgrade | `426` | Reject before Durable Object fetch |
| `/ws` missing room | `400 { error }` | Room is required for v0.1 routing |
| Invalid room path/query | `400 { error }` | Use `ROOM_NAME_PATTERN` |
| Room over peer limit | `429` + `limit_exceeded` | Durable Object-local limit |
| Too-large frame | `decode_error` then `limit_exceeded` after threshold | Close with WebSocket code `1008` after too many invalid packets |
| Header payload length is not exactly `header.len` | `decode_error` | Reject both short and trailing-byte frames; do not forward |
| Target peer absent | `packet_unroutable` | Do not broadcast |

### 5. Good/Base/Bad Cases

- Good: malformed frame records `decode_error`, increments `invalidPackets`, and leaves the connection open until the configured threshold is exceeded.
- Base: unknown `RpcReq` records `rpc_seen` with a message that full proto decode is reserved for later work.
- Bad: throwing from the WebSocket `message` event for malformed client bytes; this can kill the room object path and lose observability.
- Bad: returning or logging a full EasyTier network secret digest.

### 6. Tests Required

- Unit test invalid packet length handling through `payloadLengthMatches`.
- Worker/API test invalid room response shape and status.
- Future Durable Object test: repeated invalid packets close the socket after `MAX_INVALID_PACKETS_PER_SESSION`.
- Future security test: event payloads only include `networkSecretDigestPrefix`, never full digest.

### 7. Wrong vs Correct

#### Wrong

```typescript
if (!header) throw new Error('invalid EasyTier packet');
```

#### Correct

```typescript
if (!header || !payloadLengthMatches(frame, header)) {
  return invalid(session, 'invalid EasyTier packet header or length');
}
```

Protocol errors are expected at the network boundary and should be observable, counted, and rate-limited.

---

## Error Types

There are no custom error classes yet. Prefer explicit response helpers and typed event names before adding an error hierarchy.

---

## Error Handling Patterns

- Validate user/API inputs at the Worker boundary.
- Validate packet framing at the Durable Object boundary.
- Record recoverable relay errors as events.
- Close WebSockets only after configured abuse/invalid thresholds.

---

## API Error Responses

All JSON API errors use:

```json
{ "error": "short lowercase message" }
```

Do not include stack traces, secret values, or raw binary payloads.

---

## Common Mistakes

### Common Mistake: Treating EasyTier decode failures as fatal Worker errors

**Symptom**: A malformed or unsupported packet tears down useful relay state.

**Cause**: Throwing inside WebSocket message handlers instead of recording observer events.

**Fix**: Increment `invalidPackets`, add `decode_error`, and close only after the threshold.

**Prevention**: Keep packet parsing helpers pure and handle `null`/false results at the Durable Object boundary.
