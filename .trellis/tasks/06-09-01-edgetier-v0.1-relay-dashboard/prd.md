# EdgeTier v0.1 Relay Dashboard PRD

## Summary

Build the first runnable EdgeTier application: a Cloudflare Worker + Durable Object EasyTier-aware WSS shared-node relay with a read-only observer API and a small React dashboard using Cloudflare Kumo.

EdgeTier is not an EasyTier node manager. It must not restart child nodes, push EasyTier configuration, execute commands, manage network secrets, or pretend Cloudflare Workers can provide TUN/TAP, WireGuard server, native UDP relay, or full L3 VPN behavior.

## Product Positioning

EdgeTier is a Cloudflare edge relay, observer, and future gateway for EasyTier.

v0.1 focuses on:

1. EasyTier-aware WSS relay/shared-node endpoint.
2. Read-only observer API.
3. Minimal Kumo-based dashboard.

Future gateway-agent functionality is out of scope for v0.1.

## Background and Research Inputs

Use these project docs and cloned reference repos as context:

- `README.md`
- `docs/research-positioning-and-notes.md`
- `archive/easytier-home-mesh.md`
- `archive/easytier-home-mesh-options.md`
- `research/github/EasyTier/`
- `research/github/easytier-ws-relay-NotTropical/`
- `research/github/cf-workers-et-ws/`
- `research/github/easytier-ws-relay-IceSoulHanxi/`
- `research/github/hellgate-ws/`
- `research/github/kumo/`

Important research conclusions:

- Existing EasyTier Worker relay repos are useful references but must not be treated as an authoritative base.
- Official EasyTier proto is the source of truth. Relay repos currently drift from official EasyTier master/v2.6.4-era schemas.
- EdgeTier v0.1 must be EasyTier-aware, not a generic WebSocket broadcast room.
- Worker cannot perform native UDP/TCP hole punching; it can only relay/respond to EasyTier control-plane messages and forward WSS packets.
- Dashboard should use Kumo for Cloudflare-style accessible components.

## Technical Direction

Implement a TypeScript monorepo-like single app with:

- Cloudflare Worker entrypoint.
- Durable Object `RelayRoom` for room/group-local WebSocket state.
- Durable Object `Directory` for room registry/index if useful.
- EasyTier packet/header parser.
- Minimal EasyTier RPC envelope decoding for handshake/route sync/peer center scaffolding.
- React + Vite dashboard using `@cloudflare/kumo`.

Do not fork or vendor an entire reference relay implementation. Reuse ideas, not code wholesale.

## Required v0.1 Backend Capabilities

### Worker Routes

Implement routes:

- `GET /api/health`
- `GET /api/rooms`
- `GET /api/rooms/:roomId`
- `GET /api/rooms/:roomId/peers`
- `GET /api/rooms/:roomId/events`
- `GET /api/rooms/:roomId/traffic`
- `GET /dashboard` or static asset fallback for dashboard
- `GET /ws?room=<room>` for EasyTier WSS upgrade

`/ws` must reject non-WebSocket requests.

### Durable Object RelayRoom

`RelayRoom` must support:

- Accept WebSocket sessions.
- Parse EasyTier 16-byte packet header:
  - `fromPeerId: uint32 LE`
  - `toPeerId: uint32 LE`
  - `packetType: uint8`
  - `flags: uint8`
  - `forwardCounter: uint8`
  - `reserved: uint8`
  - `len: uint32 LE`
- Track WebSocket session metadata:
  - internal session id
  - URL room hint
  - peer id when known
  - network name when known
  - network secret digest prefix/hash when known
  - connectedAt
  - lastSeen
  - rxBytes/txBytes/rxPackets/txPackets
- Bind `peerId -> WebSocket` after successful/parseable EasyTier handshake.
- Forward messages by `toPeerId` when the target peer is connected in the same group.
- Count unknown/unforwarded packets separately.
- Record recent events in memory/DO storage:
  - connected
  - disconnected
  - handshake_seen
  - packet_forwarded
  - packet_unroutable
  - rpc_seen
  - decode_error
  - limit_exceeded

### Protocol Handling

Minimum handling:

- Header parse/create utility.
- Constants for known EasyTier packet types:
  - `Invalid = 0`
  - `Data = 1`
  - `HandShake = 2`
  - `Ping = 4`
  - `Pong = 5`
  - `RpcReq = 8`
  - `RpcResp = 9`
- Handshake best-effort decode based on generated or lightweight protobuf schema.
- If protobuf decode is not fully wired yet, still extract peer id from header and keep a safe fallback event path.
- Ping/Pong handling if enough information is available.
- RPC envelope scaffolding for `OspfRouteRpc.SyncRouteInfo` and `PeerCenterRpc`; v0.1 may log/observe these if full response compatibility is too large, but implementation should be structured so full route sync can be added in v0.2 without rewrites.

Important: do not claim full EasyTier control-plane compatibility unless implemented and tested with EasyTier.

### Room/Group Isolation

Use URL `room` as a Durable Object routing hint for v0.1. Prepare types and state so the real isolation key can evolve to EasyTier handshake identity:

```text
networkName + networkSecretDigest
```

Do not expose full network secret digest in public dashboard/API. Use a short digest prefix or opaque id.

### Limits and Safety

Implement basic local limits:

- Max frame size.
- Max peers per room.
- Invalid packet count per session.
- Recent events ring buffer size.
- Reject invalid room names.

No destructive actions. No remote command execution. No secret logging.

## Required v0.1 Frontend Capabilities

Use React + Vite + `@cloudflare/kumo`.

Dashboard pages/sections:

- Overview
  - room count
  - active peer count
  - WebSocket count
  - relay bytes
  - recent events
- Rooms
  - room id
  - peer count
  - bytes
  - last activity
- Peers
  - peer id
  - connected status
  - connectedAt
  - lastSeen
  - rxBytes
  - txBytes
- Events
  - timestamp
  - room
  - type
  - peer id
  - short message
- Traffic
  - current counters, basic visualization if practical

Kumo components to use where practical:

- Table
- Badge
- Surface/LayerCard or equivalent card component
- Tabs/Sidebar if useful
- Chart/Timeseries only if it does not overcomplicate v0.1

The dashboard can poll API endpoints; real-time dashboard WebSocket is not required for v0.1.

## Proto Follow-Up Requirement

Add project scaffolding or documentation for official EasyTier proto tracking:

- Record target EasyTier version/release.
- Store official proto files or a note/script path for syncing them.
- Include a drift-check plan or script if practical.

The goal is to avoid depending on stale community relay proto definitions.

## Suggested File Layout

A reasonable layout is:

```text
package.json
wrangler.toml
tsconfig.json
vite.config.ts
src/
  worker/
    index.ts
    env.ts
  durable-objects/
    relay-room.ts
    directory.ts
  easytier/
    packet.ts
    constants.ts
    types.ts
    rpc.ts
  observer/
    api.ts
    types.ts
  dashboard/
    main.tsx
    app.tsx
    api.ts
    components/
```

Adjust if a cleaner Worker/Vite layout is needed.

## Acceptance Criteria

- Project has a runnable TypeScript/Cloudflare Worker skeleton.
- `wrangler.toml` declares the Durable Object binding(s).
- `/api/health` returns JSON.
- `/ws?room=test` accepts WebSocket upgrades and routes to `RelayRoom`.
- `RelayRoom` tracks sessions, parses EasyTier-style headers, records events, and exposes room state through API routes.
- Dashboard builds and calls API endpoints.
- Kumo is included and used in the dashboard where practical.
- EasyTier proto drift risk is documented or scripted.
- `npm`/`pnpm` scripts exist for build/typecheck/test where practical.
- Quality check passes or reports specific blockers.

## Non-Goals

- Do not implement full EasyTier NAT traversal.
- Do not implement native UDP relay.
- Do not implement TUN/TAP or WireGuard server.
- Do not implement gateway-agent yet.
- Do not implement child-node management.
- Do not log or display network secrets.
- Do not promise production-grade relay compatibility until tested with real EasyTier nodes.
