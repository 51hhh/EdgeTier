# EdgeTier

EdgeTier is a Cloudflare Worker + Durable Object skeleton for an EasyTier-aware WebSocket relay and read-only observer dashboard.

## Current status: v0.1.1 private testing skeleton

v0.1.1 is intended for private Cloudflare testing only. The Worker, Durable Object bindings, dashboard assets, and Wrangler dry-run deployment path are expected to build, but EdgeTier is not production-ready and should not be exposed publicly without additional access control such as Cloudflare Access.

Current capabilities are intentionally limited:

- WebSocket room relay skeleton at the Cloudflare edge.
- Read-only observer API and dashboard.
- EasyTier packet support limited to 16-byte header parsing, directed forwarding, and heuristic handshake/RPC observation.
- Room summaries are marked recently active/stale by a five-minute recent-activity TTL so stale rooms are not presented as active forever.

EdgeTier does not manage, restart, or push configuration to EasyTier child nodes. It is not a full EasyTier control plane, native UDP relay, TUN/TAP endpoint, or WireGuard server.

Real EasyTier compatibility validation requires the v0.1.2 real-node validation work and v0.1.3 official-protobuf integration described in [docs/roadmap.md](docs/roadmap.md).

## Route surface

```text
GET /ws?room=<room>                  WebSocket upgrade only for a room relay
GET /api/health                      Service health JSON
GET /api/rooms                       Room directory summaries with recent active/stale status
GET /api/rooms/:roomId               Full room snapshot
GET /api/rooms/:roomId/peers         Room peer list
GET /api/rooms/:roomId/events        Recent room relay events
GET /api/rooms/:roomId/traffic       Room traffic counters
GET /dashboard/                      Read-only dashboard assets
```

The observer API is intended for same-origin private testing. It does not add authentication or wildcard CORS; use Cloudflare Access or another private access control before exposing a deployment.

Room names must be 1-64 characters, start with a letter or number, and then contain only letters, numbers, dots, underscores, or dashes.

## Build and deployment checks

`npm run build` runs both the Vite dashboard production build and `wrangler deploy --dry-run --outdir dist/worker`, validating dashboard assets and Worker/Durable Object bindings without deploying.

Recommended private-test command sequence:

```bash
npm install
npm run typecheck
npm run test
npm run build
npm run proto:check
npx wrangler login
npx wrangler deploy
```

Do not run `npx wrangler deploy` until the test instance is intended to be published and access has been restricted appropriately.

## Project docs

```text
docs/
  project-overview.md          Product positioning, boundaries, and overview
  roadmap.md                   Version roadmap and exit criteria
  easytier-home-mesh.md        EasyTier home-mesh configuration notes
  easytier-client-options.md   EasyTier client option notes
```

## Future direction

- v0.1.2: validate real EasyTier node WebSocket behavior and document compatibility results.
- v0.1.3: sync official EasyTier proto files and replace heuristic decode with proto-backed scaffolding.
- v0.2+: route/topology observer, PeerCenter/GlobalPeerMap observation, and optional gateway architecture.
