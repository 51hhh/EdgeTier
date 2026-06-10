# Research Summary: EdgeTier v0.1

## Reviewed repositories

- `EasyTier/EasyTier`: official source of truth for proto and EasyTier behavior.
- `NotTropical/easytier-ws-relay`, `Teleseon/cf-workers-et-ws`, `IceSoulHanxi/easytier-ws-relay`: reference Worker relay implementations.
- `JohnImril/hellgate-ws`: useful Cloudflare Durable Object WebSocket room/rate-limit patterns.
- `cloudflare/kumo`: Cloudflare React component library for dashboard UI.

## Key decisions

1. Build EdgeTier as a custom TypeScript Cloudflare Worker + Durable Object implementation.
2. Treat community EasyTier Worker relay repos as implementation references only, not as the base/fork.
3. Use official EasyTier proto release/master as the protocol source of truth.
4. Use React + Vite + `@cloudflare/kumo` for the read-only dashboard.
5. Keep gateway-agent out of v0.1.

## EasyTier protocol drift findings

Community relay proto definitions differ from official EasyTier proto. Examples observed:

- Official `RoutePeerInfo` uses `udp_nat_type`; relay repos use older `udp_stun_info`.
- Official `SyncRouteInfoRequest` has `oneof conn_info` with `RouteConnBitmap` and `RouteConnPeerList`; relay repos only model `RouteConnBitmap`.
- Official proto includes newer secure/credential/IPv6/QUIC fields such as `noise_static_pubkey`, `trusted_credential_pubkeys`, public IPv6 lease RPCs, secure mode config, relay noise messages, and feature flags.

Implication: EdgeTier must include proto version tracking and should not depend on stale generated proto from community relay projects.

## Kumo findings

`@cloudflare/kumo` is an active React UI component library using Base UI and Tailwind v4. It is suitable for dashboard UI, not backend Worker runtime logic.

Useful components:

- Table for rooms/peers/events.
- Badge/Meter/Surface/LayerCard for status and summary cards.
- TimeseriesChart/SankeyChart for traffic/topology when needed.
- Flow for simple network/process visualization.
- Sidebar/Tabs for navigation.

## Cloudflare Worker constraints

Cloudflare Workers/Durable Objects are suitable for:

- WebSocket edge entry.
- Room/session state.
- Read-only APIs.
- Dashboard static assets.
- Application-layer gateway in future.

They are not suitable for:

- TUN/TAP.
- WireGuard server.
- Native UDP relay.
- Full EasyTier P2P hole punching implementation.
- Long-running high-bandwidth VPN relay commitments.

## v0.1 implementation priority

1. Worker route skeleton.
2. Durable Object WebSocket acceptance and session tracking.
3. EasyTier header parser and peer-id directed forwarding.
4. Observer API snapshots.
5. Minimal dashboard.
6. Proto tracking documentation/scaffold.
