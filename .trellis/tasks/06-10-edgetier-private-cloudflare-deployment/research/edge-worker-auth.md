# Research: Edge Worker Auth

- Query: GitHub projects/libraries for implementing first-party authentication directly in Cloudflare Workers or edge TypeScript apps for EdgeTier private Cloudflare deployment; Cloudflare Access explicitly excluded.
- Scope: mixed
- Date: 2026-06-10

## Findings

### Local EdgeTier context

Files found:

- `.trellis/tasks/06-10-edgetier-private-cloudflare-deployment/prd.md` - deployment task requires `/api/health`, `/dashboard/`, and `wss://<edge-domain>/ws?room=home-mesh` verification, while keeping dashboard/API private.
- `package.json` - current app is a small TypeScript/React/Vite/Worker project with no auth dependency yet; scripts include `typecheck`, `test`, `build`, `proto:check`.
- `wrangler.toml` - Worker entrypoint is `src/worker/index.ts`, assets are bound as `ASSETS`, and `nodejs_compat` is already enabled at `wrangler.toml:4`, which matters for Better Auth's Worker guidance.
- `src/worker/index.ts` - central Worker `fetch` dispatch; `/ws` is handled before API/assets at `src/worker/index.ts:10`, and dashboard asset fallback happens at `src/worker/index.ts:18` through `src/worker/index.ts:19`.
- `src/observer/api.ts` - observer API routes are centralized in `handleApi`; `/api/health` and `/api/rooms*` dispatch is at `src/observer/api.ts:17` through `src/observer/api.ts:27`.
- `src/dashboard/api.ts` - dashboard calls same-origin `/api/*` endpoints via browser fetch at `src/dashboard/api.ts:21` through `src/dashboard/api.ts:24`.
- `src/worker/env.ts` - current Worker bindings are only `RELAY_ROOM`, `DIRECTORY`, and optional `ASSETS` at `src/worker/env.ts:1` through `src/worker/env.ts:4`; auth storage would need new bindings.
- `src/durable-objects/directory.ts` - the only persisted local storage today is room summary metadata in a Durable Object at `src/durable-objects/directory.ts:38` through `src/durable-objects/directory.ts:57`.

Code patterns:

- The least invasive auth hook is a pre-route guard in `src/worker/index.ts` before `/ws`, `handleApi`, and `ASSETS.fetch`; this can protect `/dashboard/`, `/api/*`, and `/ws` without rewriting observer or Durable Object internals.
- For browser dashboard/API, same-origin HTTP-only cookies fit the existing fetch client because calls go to relative `/api/*` URLs.
- For `/ws`, auth must happen before `roomStub(...).fetch(...)` at `src/worker/index.ts:14`. Browser WebSocket clients can send same-origin cookies, but non-browser EasyTier clients likely need an `Authorization` header or short-lived signed join token in the WSS URI. Query tokens should be room-scoped, short-lived, and never logged raw.
- Existing `Directory` Durable Object storage is not a user/session store. Reusing it for auth would mix ownership and conflict with the backend storage spec's room-directory boundary.

Related specs:

- `.trellis/spec/backend/directory-structure.md` - `src/worker/` owns top-level route dispatch and WebSocket upgrade checks; `src/observer/` owns JSON observer API contracts.
- `.trellis/spec/backend/database-guidelines.md` - current storage contract is Durable Object room summaries only; future D1/KV/Analytics additions require explicit boundary design.
- `.trellis/spec/backend/error-handling.md` - public JSON errors are small and should not leak secrets; WebSocket errors happen after upgrade, so auth failure must be before upgrade.
- `.trellis/spec/frontend/directory-structure.md` - dashboard consumes shared observer DTOs and should not import Worker runtime code.

### Candidate comparison

| Candidate | Source status | Storage requirements | Integration effort | Fit for EdgeTier |
|---|---:|---|---|---|
| Better Auth | Active TypeScript repo `better-auth/better-auth`, MIT; GitHub API shows pushed `2026-06-10`, not archived, 28k+ stars. Docs include Cloudflare Workers mounting, Hono integration, React client, email/password, sessions, plugins. | Better Auth docs say a database is required to store user data, with stateless sessions possible but most plugins requiring DB. It supports SQLite and Drizzle adapter patterns. I found documented Cloudflare Worker handler support, but did not find an official Better Auth D1-specific docs page in the fetched docs tree. D1 via Drizzle SQLite is plausible but should be spike-tested. | Moderate. Add `better-auth`, probably D1 plus Drizzle or another Worker-compatible DB adapter, `/api/auth/*` routes, auth config, dashboard login UI, and Worker guard calling `auth.api.getSession`. Existing `nodejs_compat` flag is already present. | Best full product fit if EdgeTier wants first-party user accounts, email/password, session APIs, React client hooks, and a path to 2FA/passkeys later. For `/ws`, use Better Auth session to issue a short room-scoped join token rather than requiring an interactive login flow from EasyTier clients. |
| Auth.js / NextAuth / `@auth/core` / `@hono/auth-js` | Active TypeScript monorepo `nextauthjs/next-auth`, ISC; GitHub API shows pushed `2026-06-09`, not archived, 28k+ stars. `@auth/core` version found in repo is `0.41.2`; `@auth/d1-adapter` version is `1.11.2`. Hono middleware repo `honojs/middleware` includes `packages/auth-js`. | Cookie sessions are default and DB is optional for basic session use. Official `@auth/d1-adapter` exists for Cloudflare D1 when persistent users/sessions are needed. Edge compatibility docs say core Auth.js works on edge, but database adapters and DB clients can break if they need unavailable Node/TCP features. | Moderate to high. Works best with OAuth/passwordless flows; first-party password user management still needs custom credential storage, password hashing, registration policy, and account admin UI unless constrained to OAuth. Hono middleware would add Hono routing/context to a hand-rolled Worker. | Good for OAuth/OIDC-style auth on Workers and D1, less direct for "our own login/user management" than Better Auth. It is viable if EdgeTier chooses OAuth or wants mature session/provider plumbing, but it is not the lowest-effort path for local users/passwords. |
| Hono core auth middleware and `@hono/session` | Active Hono repo `honojs/hono`, MIT; GitHub API shows pushed `2026-06-09`, not archived, 30k+ stars. Hono middleware repo pushed `2026-06-10`; `packages/session` docs say encrypted JWT session middleware depends on `jose`, supports optional session storage, and includes a Cloudflare KV storage example. | Stateless encrypted cookie sessions by default, optional external storage via a `delete/get/set` session storage interface. Cloudflare KV example stores session data in `SESSION_KV`. D1/DO storage could be implemented manually via the same interface. | Low for route gating if adopting Hono as the router; medium if keeping current hand-rolled dispatch because the middleware expects Hono context. User management, password hashing, registration, and admin UX remain custom. | Good foundation for a minimal private test gate or custom login implementation. It avoids a large auth framework but shifts more security design to EdgeTier. For `/ws`, Hono JWT/cookie helpers or `jose` can verify a signed join token before upgrade. |
| Lucia, Copenhagen Book, Oslo, Arctic | `lucia-auth/lucia` repo is not archived, but README says Lucia v3 would be deprecated by March 2025 and is now a learning resource. `pilcrowonpaper/oslo` and `pilcrowonpaper/copenhagen` are archived. `pilcrowonpaper/arctic` is active-ish, MIT, pushed `2025-05-21`, OAuth clients only. | No drop-in auth storage. Lucia now teaches custom session implementation; Arctic helps OAuth only. | High. You implement sessions, users, password hashing, cookies, CSRF, recovery, and admin operations yourself. | Useful as conceptual guidance for a custom Worker/D1 session layer. Not recommended as the primary library because the former library path is deprecated/archived. |
| `jose` | Active `panva/jose`, MIT; GitHub API shows pushed `2026-06-03`, not archived. README explicitly lists Cloudflare Workers among supported runtimes and says the package has zero dependencies. | No storage. Signs/verifies/encrypts JWT/JWE using Web APIs. | Low as a helper, high as a complete auth system because all user/session flows are custom. | Strong helper for short-lived `/ws` join tokens or stateless API cookies. Prefer `jose` over smaller Worker-only JWT libraries when standards coverage and maintenance matter. |
| `@tsndr/cloudflare-worker-jwt` | Active enough but smaller `tsndr/cloudflare-worker-jwt`, MIT; GitHub API shows pushed `2025-12-13`, not archived, 871 stars. README describes a zero-dependency JWT library for Cloudflare Workers. | No storage. JWT helper only. | Low helper effort, but complete auth remains custom. | Acceptable for simple HS256/ES256 token verification, but `jose` is broader and more actively maintained. Not a full first-party auth solution. |

### Storage pattern notes

- D1 is the cleanest user database fit for first-party users, password hashes, accounts, sessions, audit fields, and future admin UI. It requires adding a D1 binding and migrations; this is outside the current room-summary Durable Object boundary.
- KV is acceptable for session lookup/cache or revocation lists when eventual consistency is tolerable. It is not ideal as the source of truth for user records or password state.
- Durable Objects are good for strongly consistent per-key coordination and already host room state, but a global user database in one DO can become an artificial bottleneck. A dedicated Auth DO can work for small private deployments, but it is a bespoke design.
- JWT-only/stateless cookies are fast and simple but make revocation, logout-all, device management, and compromised-token handling harder. For private test deployment, stateless is fine if token TTL is short; for product accounts, pair with D1-backed sessions.
- `/ws` should not rely only on a dashboard browser session unless all clients are browsers. For EasyTier-style clients, issue a short-lived signed join token tied to `room`, `sub`, `iat`, `exp`, and maybe deployment/domain, then verify it at the Worker before `WebSocketPair`/DO handoff.

### Recommendation

For EdgeTier's stated decision ("our own login/user management") and current React/Vite + Worker shape, prefer Better Auth if this task is allowed to introduce a real auth subsystem. It has the most direct first-party account story, React client support, Worker mounting via standard `Request`/`Response`, and future features like 2FA/passkeys.

If the immediate goal is only to make the private Cloudflare test endpoint safe enough for deployment, the pragmatic MVP is a small custom auth layer: D1 `users` + `sessions`, HTTP-only `__Host-edgetier_session` cookie for `/dashboard/` and `/api/*`, and `jose`-signed short-lived join tokens for `/ws`. This keeps the change smaller than Better Auth while avoiding Cloudflare Access and preserving a path to Better Auth later.

Use Auth.js primarily if OAuth/D1 sessions are preferred over first-party password management. Use Lucia/Copenhagen only as implementation guidance, not as a dependency.

### External references

- Better Auth repo metadata: `https://api.github.com/repos/better-auth/better-auth`
- Better Auth Worker mounting and `nodejs_compat` guidance: `https://raw.githubusercontent.com/better-auth/better-auth/main/docs/content/docs/installation.mdx`
- Better Auth Hono integration and session middleware pattern: `https://raw.githubusercontent.com/better-auth/better-auth/main/docs/content/docs/integrations/hono.mdx`
- Better Auth SQLite adapter docs: `https://raw.githubusercontent.com/better-auth/better-auth/main/docs/content/docs/adapters/sqlite.mdx`
- Better Auth Drizzle adapter docs: `https://raw.githubusercontent.com/better-auth/better-auth/main/docs/content/docs/adapters/drizzle.mdx`
- Auth.js repo metadata: `https://api.github.com/repos/nextauthjs/next-auth`
- Auth.js edge compatibility guide: `https://raw.githubusercontent.com/nextauthjs/next-auth/main/docs/pages/guides/edge-compatibility.mdx`
- Auth.js database/session docs: `https://raw.githubusercontent.com/nextauthjs/next-auth/main/docs/pages/getting-started/database.mdx`
- Auth.js D1 adapter package: `https://raw.githubusercontent.com/nextauthjs/next-auth/main/packages/adapter-d1/package.json`
- Hono repo metadata: `https://api.github.com/repos/honojs/hono`
- Hono middleware repo metadata: `https://api.github.com/repos/honojs/middleware`
- Hono `@hono/auth-js` README: `https://raw.githubusercontent.com/honojs/middleware/main/packages/auth-js/README.md`
- Hono `@hono/session` README: `https://raw.githubusercontent.com/honojs/middleware/main/packages/session/README.md`
- Hono Cloudflare KV session example: `https://raw.githubusercontent.com/honojs/middleware/main/packages/session/examples/cloudflare-kv.ts`
- Lucia README deprecation notice: `https://raw.githubusercontent.com/lucia-auth/lucia/main/README.md`
- `jose` repo metadata and README: `https://api.github.com/repos/panva/jose`, `https://raw.githubusercontent.com/panva/jose/main/README.md`
- `@tsndr/cloudflare-worker-jwt` repo metadata and README: `https://api.github.com/repos/tsndr/cloudflare-worker-jwt`, `https://raw.githubusercontent.com/tsndr/cloudflare-worker-jwt/main/README.md`

## Caveats / Not Found

- I did not edit code; this research file is the only file written.
- GitHub code search for Better Auth D1 references returned `401 Requires authentication`, so I could not confirm repo-wide D1 examples that way.
- Better Auth docs fetched here document Cloudflare Worker mounting and SQLite/Drizzle adapters, but I did not find an official D1 adapter/package equivalent to Auth.js `@auth/d1-adapter`.
- I did not verify npm latest versions directly; maintenance status is based on GitHub API metadata and package files fetched on 2026-06-10.
- Security implementation details still need a separate design before coding: password hashing choice on Workers, CSRF policy for login/logout, session rotation, admin bootstrap, rate limiting, and how WSS join tokens are issued and revoked.
