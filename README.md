# EdgeTier

EdgeTier is a Cloudflare Worker + Durable Object skeleton for an EasyTier-aware WebSocket relay and read-only observer dashboard.

## Current status: v0.1.1 private testing skeleton

v0.1.1 is intended for private Cloudflare testing only. The Worker, Durable Object bindings, dashboard assets, and Wrangler dry-run deployment path are expected to build. EdgeTier now includes a pragmatic Worker-native private auth gate for test deployments, but it is not a full production identity platform.

Current capabilities are intentionally limited:

- WebSocket room relay skeleton at the Cloudflare edge, protected by short-lived room-scoped relay tokens.
- Read-only observer API and dashboard behind an HTTP-only secure session cookie.
- EasyTier packet support limited to 16-byte header parsing, directed forwarding, and heuristic handshake/RPC observation.
- Room summaries are marked recently active/stale by a five-minute recent-activity TTL so stale rooms are not presented as active forever.

EdgeTier does not manage, restart, or push configuration to EasyTier child nodes. It is not a full EasyTier control plane, native UDP relay, TUN/TAP endpoint, or WireGuard server.

Real EasyTier compatibility validation requires the v0.1.2 real-node validation work and v0.1.3 official-protobuf integration described in [docs/roadmap.md](docs/roadmap.md).

## Route surface

```text
GET  /login                         Built-in private deployment login page
POST /api/auth/login                 Create HTTP-only dashboard/API session
POST /api/auth/logout                Clear dashboard/API session
GET  /ws?room=<room>&token=<token>   WebSocket upgrade only for a room relay
GET  /api/health                     Service health JSON
GET  /api/rooms                      Room directory summaries with recent active/stale status
GET  /api/rooms/:roomId              Full room snapshot
GET  /api/rooms/:roomId/peers        Room peer list
GET  /api/rooms/:roomId/events       Recent room relay events
GET  /api/rooms/:roomId/traffic      Room traffic counters
POST /api/rooms/:roomId/token        Issue a short-lived room-scoped WSS token
GET  /dashboard/                     Read-only dashboard assets
```

The observer API and dashboard are same-origin and require the EdgeTier session cookie. `/ws` requires a short-lived room-scoped query-string token because EasyTier clients may not be able to send custom WebSocket headers. Do not share tokenized WSS URIs outside the private validation context.

Room names must be 1-64 characters, start with a letter or number, and then contain only letters, numbers, dots, underscores, or dashes.

## Private auth setup

This deployment MVP uses EdgeTier-owned Worker-native auth rather than Cloudflare Access:

- `ADMIN_USERNAME` and `ADMIN_PASSWORD` are checked by `/api/auth/login`.
- `SESSION_SECRET` signs the HTTP-only secure session cookie for `/dashboard/` and `/api/*`.
- `RELAY_TOKEN_SECRET` signs short-lived room-scoped `/ws` join tokens.

Configure these as Cloudflare secrets before a real deployment. Use strong unique values and do not commit them:

```bash
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put RELAY_TOKEN_SECRET
```

After signing in to `/login`, use the dashboard token panel or `POST /api/rooms/:roomId/token` with the session cookie to issue a URI shaped like:

```text
wss://<edge-domain>/ws?room=home-mesh&token=<short-lived-relay-token>
```

The token is intentionally short-lived and scoped to one room. Treat the full URI as a secret and keep it out of tracked files, logs, and validation reports.

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
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put RELAY_TOKEN_SECRET
npx wrangler deploy
```

Do not run `npx wrangler deploy` until the Wrangler secrets above are configured for the target environment. Real EasyTier secrets, relay tokens, private domains, and tokenized WSS URIs must stay in local ignored files only.

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
