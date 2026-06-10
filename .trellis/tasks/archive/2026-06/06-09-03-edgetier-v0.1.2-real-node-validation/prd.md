# EdgeTier v0.1.2 Real EasyTier Node Validation PRD

## Summary

Validate the v0.1.1 EdgeTier Cloudflare Worker/Durable Object skeleton against real EasyTier nodes. This task is primarily a validation and evidence-gathering task, not a protocol expansion task.

## Context

Current EdgeTier status:

- v0.1.1 private-testing skeleton builds and Wrangler dry-run passes.
- Dashboard uses Kumo and has v0.1.1 empty states/manual room lookup.
- EasyTier protocol support is limited to 16-byte header parsing, directed forwarding, and heuristic handshake/RPC observation.
- Full EasyTier control-plane compatibility is not yet implemented.

Roadmap source: `docs/roadmap.md`.

## Goals

1. Deploy or prepare deployment of EdgeTier to a private Cloudflare test endpoint.
2. Add EdgeTier WSS peer URI to one or more real EasyTier client configs without committing secrets.
3. Validate whether real EasyTier nodes can connect and remain connected.
4. Record dashboard/API observations for room, peer, event, and traffic state.
5. Identify the exact protocol gap before v0.1.3 official proto integration.
6. Produce a validation report that future implementation can follow.

## Non-Goals

- Do not commit real EasyTier secrets or live private config files.
- Do not implement full protobuf decode in this task unless validation proves a tiny unblocker is required.
- Do not implement v0.2 topology.
- Do not implement PeerCenter/GlobalPeerMap.
- Do not implement gateway-agent.
- Do not expose dashboard/API publicly without access control.

## Required Validation Setup

### EdgeTier endpoint

A private Cloudflare deployment should expose:

```text
https://<edge-domain>/api/health
https://<edge-domain>/dashboard/
wss://<edge-domain>/ws?room=home-mesh
```

Before deploy/run:

```bash
npm install
npm run typecheck
npm run test
npm run build
npm run proto:check
npx wrangler login
npx wrangler deploy
```

Do not deploy publicly unless access is restricted appropriately.

### EasyTier client config

Use the existing local config as a private source of truth, but do not copy it into the repo.

Add EdgeTier as an additional peer while keeping existing UDP/TCP public peers during validation:

```toml
[[peer]]
uri = "wss://<edge-domain>/ws?room=home-mesh"
```

Do not publish the real `network_secret`, real public node hostname, or real public IP in repo docs.

## Test Matrix

Minimum matrix:

| Scenario | Expected observation |
|---|---|
| EdgeTier `/api/health` | Returns service health JSON |
| Dashboard loads | `/dashboard/` renders without errors |
| One EasyTier node connects | Room appears or manual lookup shows websocket/session activity |
| Two EasyTier nodes connect | WebSocket count reaches 2, peer ids may appear if headers parse |
| Node disconnects | Event appears and websocket count decreases |
| EasyTier traffic flows | RX/TX counters increase; forwarded/unroutable counters reveal current compatibility |
| Invalid/missing room path | API/WS validation still rejects unsafe room names |

## Observations to Record

Create a validation report under this task, not under general docs unless sanitized.

Suggested file:

```text
.trellis/tasks/06-09-03-edgetier-v0.1.2-real-node-validation/validation-report.md
```

Record:

- EdgeTier deployed URL with domain redacted if needed.
- EasyTier version(s).
- Client OS/platforms.
- Whether WebSocket connection succeeds.
- Whether the connection stays open.
- Whether `peerId` appears.
- Events observed:
  - connected
  - disconnected
  - handshake_seen
  - rpc_seen
  - packet_unroutable
  - packet_forwarded
  - decode_error
  - limit_exceeded
- Traffic counters.
- Any EasyTier client logs relevant to WSS connection.
- Whether existing UDP/TCP peers still provide network connectivity.

## Acceptance Criteria

- A validation report file exists for the real-node test attempt.
- The report does not contain real secrets.
- The report clearly states one of:
  - Real EasyTier nodes connect and baseline observer state works.
  - Real EasyTier nodes connect but protocol compatibility is insufficient.
  - Real EasyTier nodes cannot connect; blockers are listed.
- The report identifies what v0.1.3 needs to implement first.
- Existing checks still pass:
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
  - `npm run proto:check`

## Decision Gate

After validation:

- If real nodes cannot stay connected: prioritize handshake/Ping/Pong/proto envelope work in v0.1.3.
- If real nodes connect but route/RPC state is weak: prioritize official proto decode in v0.1.3.
- If baseline forwarding works: document compatibility and proceed to v0.1.3 proto drift hardening before v0.2 topology.
