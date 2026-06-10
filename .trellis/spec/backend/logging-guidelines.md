# Logging Guidelines

> How logging is done in this project.

---

## Overview

EdgeTier v0.1 primarily exposes operational information through read-only observer events, not console logging. Durable Object relay behavior should record structured `RelayEvent` entries that the API/dashboard can display.

Console logs are acceptable for local debugging but should not be the main product telemetry surface.

---

## Scenario: Relay Events as Product Logs

### 1. Scope / Trigger

- Trigger: WebSocket lifecycle, EasyTier packet observation, forwarding failures, and rate/limit events.
- Applies to `RelayRoom.addEvent` and any future event persistence or Analytics Engine integration.

### 2. Signatures

```typescript
type RelayEventType =
  | 'connected'
  | 'disconnected'
  | 'handshake_seen'
  | 'packet_forwarded'
  | 'packet_unroutable'
  | 'rpc_seen'
  | 'decode_error'
  | 'limit_exceeded';

interface RelayEvent {
  id: string;
  timestamp: string; // ISO string
  roomId: string;
  type: RelayEventType;
  sessionId?: string;
  peerId?: number;
  message: string;
}
```

### 3. Contracts

- Events are append-only within the room's recent ring buffer.
- `RECENT_EVENTS_LIMIT` controls in-memory event retention.
- Event timestamps are ISO strings.
- Event messages must be short and safe for dashboard display.
- Do not put raw packet bytes, full network secret digests, stack traces, cookies, authorization tokens, or full request headers in events.

### 4. Validation & Error Matrix

| Condition | Event |
|---|---|
| WebSocket accepted | `connected` |
| WebSocket closed/error | `disconnected` |
| Handshake packet observed | `handshake_seen` |
| RPC packet observed | `rpc_seen` |
| Packet forwarded to target peer | `packet_forwarded` |
| Target peer unavailable | `packet_unroutable` |
| Header/length/frame validation failure | `decode_error` |
| Invalid packet or peer limit exceeded | `limit_exceeded` |

### 5. Good/Base/Bad Cases

- Good: `packet type 8 forwarded to peer 12345`.
- Base: `EasyTier RPC envelope observed; full decode is reserved for proto-backed v0.2 work`.
- Bad: `secret digest abcdef...full...value failed`.
- Bad: dumping raw binary payload hex into the dashboard event list.

### 6. Tests Required

- Future Durable Object tests should assert event type and counter updates for invalid and unroutable packets.
- Future security tests should assert no event includes full secret digest fields.

### 7. Wrong vs Correct

#### Wrong

```typescript
console.log('handshake', rawPayload, fullSecretDigest);
```

#### Correct

```typescript
addEvent(roomId, 'handshake_seen', `handshake observed (${confidence})`, sessionWithDigestPrefixOnly);
```

---

## Log Levels

No logging library is established yet. If console logging is added later:

- `console.debug`: local protocol debugging only; remove before production paths.
- `console.info`: startup/deployment-level information only.
- `console.warn`: recoverable environment/configuration issue.
- `console.error`: unexpected internal failure; never include secrets.

---

## Structured Logging

Prefer `RelayEvent` and typed observer payloads over free-form console logs. Add fields to `RelayEvent` only when they are safe for public read-only dashboard use.

---

## What to Log

- WebSocket connect/disconnect.
- Handshake/RPC observation state.
- Forwarded/unroutable packet summaries.
- Decode/limit errors.
- Traffic counters through `TrafficSnapshot`.

---

## What NOT to Log

- Full EasyTier network secret digest.
- Raw binary packets.
- Cookies, authorization headers, API tokens.
- Stack traces in public API responses.
- Private LAN service URLs for future gateway-agent unless access-controlled.
