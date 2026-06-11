# Research: WebSocket Auth on Cloudflare Workers

- Query: GitHub projects/examples and common implementation patterns for authenticating WebSocket endpoints on Cloudflare Workers when non-browser clients cannot perform Cloudflare Access login.
- Scope: local + GitHub
- Date: 2026-06-10

## Findings

### Summary

There is no obvious, mature drop-in GitHub project that solves EdgeTier's exact requirement: self-managed auth for a Cloudflare Worker/Durable Object WebSocket relay where EasyTier clients may only provide a WSS URI.

The best fit is a small EdgeTier-owned relay-token layer:

- Browser/dashboard users authenticate with the chosen first-party auth/session system.
- Authenticated users request a short-lived room-scoped WSS join token from an API endpoint.
- EasyTier clients use `wss://<edge-domain>/ws?room=<room>&token=<short-lived-token>`.
- The Worker verifies the token before Durable Object handoff.
- The Durable Object receives only sanitized identity/room metadata, not raw tokens.

### GitHub search results

High-signal searches:

- `cloudflare workers websocket auth` returned no repositories.
- `cloudflare worker websocket jwt` returned no repositories.
- `workers durable object websocket auth` found one directly relevant example:
  - `awthwathje/durable-objects-websocket-auth0-example`
- Broader `cloudflare workers websocket` / `durable object websocket` searches found mostly relay/chat examples without first-party auth.

### Relevant projects

#### `awthwathje/durable-objects-websocket-auth0-example`

- URL: https://github.com/awthwathje/durable-objects-websocket-auth0-example
- License: MIT
- Stars observed: 5
- Updated: 2025-08-03
- Description: Cloudflare Workers, Durable Objects with WebSocket support and Auth0 authentication example project.

Useful pattern:

- Worker has `/api/auth/login`, `/api/auth/logout`, `/api/auth/status`, `/api/auth/callback`.
- Worker stores auth state in Workers KV.
- Worker protects `/api/websocket` by checking auth before `handleWebSocketRequest`.
- Durable Object only receives the WebSocket after the Worker authorizes the request.

Important limitations:

- It is an older Auth0/Next.js example, not a direct fit for EdgeTier's React/Vite Worker.
- The auth implementation decodes JWT payloads manually and stores Auth0 exchange results in KV; EdgeTier should use `jose`/JWKS verification instead.
- It assumes browser/cookie auth. It does not solve URI-only machine clients.

EdgeTier takeaway:

- Keep auth enforcement in `src/worker/index.ts` before `roomStub(...).fetch(request)`.
- Do not bury auth inside `RelayRoom` as the first line of defense.
- Browser cookie sessions work for dashboard/API and browser WebSockets, but EasyTier WSS needs a non-browser token flow.

#### `glowboot/relay`

- URL: https://github.com/glowboot/relay
- License: MIT
- Stars observed: 1
- Updated: 2026-06-08
- Description: Cloudflare Worker WebSocket relay for paired browser clients sharing a room code.

Useful pattern:

- One Durable Object per room code using `idFromName(roomCode)`.
- Worker rejects non-WebSocket requests before Durable Object handoff.
- Worker checks an `Origin` allowlist before Durable Object handoff.
- Worker applies IP rate limiting before Durable Object handoff.
- Durable Object enforces room capacity, message size caps, idle timeout, and hibernating WebSocket handling.

Important limitations:

- `Origin` allowlist is only meaningful for browsers; custom clients can spoof or omit it.
- Room code is not authentication.
- This is a public relay pattern, not private access control.

EdgeTier takeaway:

- Add cheap Worker-boundary checks before Durable Object instantiation.
- Keep message size, idle timeout, and rate-limit controls even after authentication.
- Do not treat origin allowlists or room names as sufficient private auth for EasyTier clients.

#### `acoyfellow/workflow-live`

- URL: https://github.com/acoyfellow/workflow-live
- Stars observed: 66
- Updated: 2026-06-06
- Topics include Cloudflare Workers, Durable Objects, and WebSockets.

Useful pattern:

- Current GitHub search identifies it as an active Durable Objects WebSocket project.
- It may be useful later for DO WebSocket ergonomics, but it did not surface as an auth-specific example in this research pass.

### EdgeTier-specific auth pattern

Recommended MVP route split:

```text
GET  /login                         Browser login UI
POST /api/auth/login                 Create dashboard/API session
POST /api/auth/logout                Destroy session
GET  /api/auth/me                    Current user/session
POST /api/rooms/:roomId/ws-token     Issue short-lived WSS join token
GET  /ws?room=<room>&token=<token>   Verify token, then upgrade
```

Recommended WSS token claims:

```json
{
  "sub": "<user-or-client-id>",
  "typ": "edgetier-ws",
  "room": "home-mesh",
  "iat": 1781100000,
  "exp": 1781100300,
  "jti": "<random-id>"
}
```

Recommended token rules:

- TTL: 1-10 minutes for copied EasyTier config testing; shorter for browser-issued connect buttons.
- Scope token to one room.
- Include `typ` to prevent confusing session JWTs with WSS join tokens.
- Include `jti` so a future D1/KV/DO revocation list or one-time-use list can be added.
- Sign with Web Crypto / `jose`, not ad hoc HMAC string concatenation.
- Reject invalid/expired/mismatched tokens before Durable Object handoff.
- Redact `token` from events, API responses, and validation reports.

### Fit for EasyTier clients

If EasyTier supports custom WebSocket headers:

- Prefer `Authorization: Bearer <relay-token>`.
- This avoids token exposure in URLs.

If EasyTier only supports a WSS URI:

- Use `token=<short-lived-relay-token>` in the query string.
- Keep the token short-lived and room-scoped.
- Consider a two-token model later:
  - Long-lived private client credential stored outside repo.
  - Short-lived WSS join token minted by EdgeTier from that credential.

If neither headers nor rotating URI tokens are practical:

- A static room secret in the URI is still better than a public room, but it is weak:
  - It can leak through logs/config copies.
  - Rotation is manual.
  - It does not identify individual clients.
  - It should be treated as temporary validation-only, not product auth.

### Recommended decision

For this deployment task, do not wait for a large identity platform before making the endpoint safe enough to test.

Recommended staged approach:

1. Implement Worker-native dashboard/API session auth.
2. Implement `jose`-signed short-lived WSS room tokens.
3. Deploy privately with no Cloudflare Access.
4. Later decide whether to replace or augment the local session system with Better Auth or an external OIDC provider such as Authentik.

## External references

- Auth0 Durable Object WebSocket example: https://github.com/awthwathje/durable-objects-websocket-auth0-example
- Auth0 example Worker dispatcher: https://raw.githubusercontent.com/awthwathje/durable-objects-websocket-auth0-example/master/src/workers/index.js
- Auth0 example auth helper: https://raw.githubusercontent.com/awthwathje/durable-objects-websocket-auth0-example/master/src/workers/auth.js
- Auth0 example Durable Object: https://raw.githubusercontent.com/awthwathje/durable-objects-websocket-auth0-example/master/src/workers/list.js
- Glowboot relay: https://github.com/glowboot/relay
- Glowboot relay Worker source: https://raw.githubusercontent.com/glowboot/relay/main/src/index.ts
- Workflow Live: https://github.com/acoyfellow/workflow-live
- `jose`: https://github.com/panva/jose

## Caveats / Not Found

- The `trellis-research` WebSocket sub-agent failed with an external 403, so this file was completed in the main session using bounded GitHub CLI searches and direct source reads.
- GitHub searches did not reveal a maintained, framework-agnostic Cloudflare Workers WebSocket auth package.
- Query-string tokens are a compromise for clients that cannot set headers. They must be short-lived and redacted everywhere.

