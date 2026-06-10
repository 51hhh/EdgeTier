# EdgeTier Roadmap

This roadmap records the current implementation path after v0.1 skeleton delivery.

## Current Status

v0.1 is a deployable Cloudflare Worker/Durable Object skeleton:

- Worker and Durable Object bindings build successfully.
- Dashboard assets build successfully.
- Wrangler dry-run deployment succeeds.
- EasyTier packet handling is limited to 16-byte header parsing, peer-directed forwarding, and heuristic handshake/RPC observation.
- The implementation must not be described as full EasyTier control-plane compatibility yet.

## v0.1.1: Deployment Hardening

Goal: make the skeleton safe and clear enough for private Cloudflare testing.

Required work:

1. Document current status and deployment steps.
2. Add or document minimal observer API access control.
3. Add room directory TTL or active-room filtering to avoid stale room summaries.
4. Improve dashboard empty states, selected-room affordance, and manual room lookup.
5. Add integration-oriented tests for Worker and Durable Object behavior where practical.
6. Keep full EasyTier compatibility claims out of UI/docs until verified.

Exit criteria:

- A developer can deploy a private test instance to Cloudflare using documented commands.
- Dashboard clearly distinguishes no rooms, no peers, no events, errors, and selected room.
- Directory does not present stale rooms as active indefinitely.
- Tests cover the most important route/protocol skeleton contracts.

## v0.1.2: Real EasyTier Node Validation

Goal: verify real EasyTier nodes can connect through EdgeTier and produce useful observer state.

Required work:

1. Create a real-node test matrix with two or more EasyTier nodes and one EdgeTier WSS endpoint.
2. Verify WebSocket connect/disconnect lifecycle.
3. Verify peer id discovery and cleanup.
4. Verify `toPeerId` directed forwarding behavior with real packets.
5. Record which handshake/RPC packets are only observed vs decoded.
6. Document exact compatibility results and limitations.

Exit criteria:

- Real EasyTier nodes can connect to `wss://<edge-domain>/ws?room=<network>`.
- Dashboard shows baseline connection, peer, event, and traffic state.
- Known failures or missing control-plane pieces are documented.

## v0.1.3: Official Proto Integration

Goal: replace heuristic protocol observation with official-proto-backed decode/encode scaffolding.

Required work:

1. Select an official EasyTier release/commit as the compatibility target.
2. Sync official `.proto` files into `proto/easytier/`.
3. Generate TypeScript protobuf bindings in a dedicated step.
4. Expand `scripts/check-proto-drift.mjs` so it compares local proto against the selected official target.
5. Decode EasyTier handshake and RPC envelopes using generated types.
6. Add decode tests before making stronger compatibility claims.

Exit criteria:

- EasyTier handshake/RPC envelopes are decoded with official proto bindings.
- Proto drift check is meaningful and fails on unexpected drift.
- Compatibility target is recorded in docs and proto metadata.

## v0.2: Route and Topology Observer

Goal: derive network topology from EasyTier route sync data.

Required work:

1. Parse `SyncRouteInfo`.
2. Parse `RoutePeerInfo`.
3. Parse `RouteConnBitmap` and `RouteConnPeerList`.
4. Add topology API:

```text
GET /api/rooms/:roomId/topology
```

5. Display topology in the dashboard with direct, relay, unknown, and foreign edges.
6. Record route update events.

Exit criteria:

- Dashboard can show observed peer nodes and route-derived edges.
- P2P success is not claimed unless the data source supports it.

## v0.3: PeerCenter and GlobalPeerMap

Goal: support EasyTier PeerCenter-style direct-peer and latency observation.

Required work:

1. Implement `PeerCenterRpc.ReportPeers`.
2. Implement `PeerCenterRpc.GetGlobalPeerMap`.
3. Maintain a room-local global peer map with latency.
4. Add digest handling.
5. Display peer-to-peer latency graph and P2P/relay observation ratio.
6. Add stale peer cleanup.

Exit criteria:

- Dashboard shows GlobalPeerMap direct peers and latency.
- Digest behavior and stale cleanup are tested.

## v0.4: Domain Gateway

Goal: provide application-layer domain access through an optional gateway agent.

Recommended route: gateway-agent, not direct Worker access to EasyTier virtual IPs.

Architecture:

```text
Cloudflare Worker
  -> WebSocket
  -> gateway-agent
  -> localhost / LAN HTTP or WebSocket service
```

Required work:

1. Gateway-agent that runs on the service host.
2. Domain route configuration.
3. Worker HTTP/WebSocket gateway routing.
4. Access control and audit logs.
5. Dashboard Gateway page.

Exit criteria:

- A Cloudflare hostname can proxy HTTP/WebSocket traffic to a gateway-agent target service.
- The agent does not manage EasyTier nodes.

## v1.0: Production Productization

Goal: public beta or production-quality EdgeTier service.

Required work:

1. Cloudflare Access/OAuth or equivalent auth.
2. Multi-user and room permissions.
3. D1/KV/R2/Analytics Engine persistence where appropriate.
4. Long-term traffic/event storage.
5. Alerts and usage limits.
6. Abuse protection and bandwidth quotas.
7. Stale room cleanup and operational monitoring.
8. Compatibility matrix across EasyTier versions and platforms.

Exit criteria:

- EdgeTier can be operated as a secure, documented, observable Cloudflare-hosted EasyTier edge relay/observer/gateway product.
