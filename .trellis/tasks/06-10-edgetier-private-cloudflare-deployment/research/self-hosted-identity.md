# Research: Self-hosted identity for EdgeTier private Cloudflare deployment

- Query: Research GitHub projects for self-hosted identity/user management that could replace Cloudflare Access for EdgeTier private deployment.
- Scope: mixed
- Date: 2026-06-10

## Findings

### Recommendation

Use Authentik as the default self-hosted identity provider for this task, then enforce access inside the Cloudflare Worker rather than trying to place a traditional reverse proxy in front of the Worker.

Recommended EdgeTier shape:

- Browser users: EdgeTier uses OIDC authorization code with PKCE against Authentik, then sets its own Secure/HttpOnly session cookie for `/dashboard/` and `/api/*`.
- Worker/API authorization: validate EdgeTier sessions and/or OIDC JWTs at the Worker boundary before `handleApi()` and before dashboard assets are served.
- WebSocket clients: require auth before `roomStub(...).fetch(...)` on `/ws`. Prefer `Authorization: Bearer <access_token>` for clients that can set headers. If EasyTier can only consume a WSS URI, mint short-lived, room-scoped EdgeTier relay tokens and pass those in the query string; do not put OIDC client secrets, refresh tokens, or EasyTier network secrets in the URL.
- Machine clients: use Authentik `client_credentials` or device code flow where possible, then exchange or bind those tokens to short-lived EdgeTier relay tokens.

Why Authentik:

- It is self-host-oriented, with Docker Compose explicitly recommended for small/test setups.
- It has a built-in admin/user/group/policy model, not just a headless API.
- It supports OAuth2/OIDC provider mode, standard flows, `client_credentials`, device code, JWKS, token introspection, and refresh-token handling.
- It also has a proxy provider/outpost model for apps without native auth, which is useful later, but EdgeTier should still enforce auth in Worker code because the protected resource is itself a Cloudflare Worker.
- Tradeoff: heavier than Authelia and Logto, but much less custom glue than Ory Kratos/Hydra and less operationally heavy than Keycloak for a small private deployment.

### Candidate comparison

| Candidate | Fit for EdgeTier private test | Setup complexity | User/admin UI | OIDC/OAuth | Machine/WebSocket story | License / signals |
|---|---:|---:|---|---|---|---|
| Authentik | Best default | Medium | Strong built-in admin, users, groups, flows | Strong; OIDC OP/RP modes, standard flows, `client_credentials`, device code | Good: M2M via client credentials; Worker can validate JWT/JWKS; can mint EdgeTier relay tokens | GitHub: 21.9k stars, latest release 2026.5.2 on 2026-05-28, Docker Compose recommended for small/test installs |
| Zitadel | Strong alternative | Medium | Strong management console | Strong OIDC/OAuth endpoints | Good: service users, client credentials, token introspection/JWT options | GitHub: 14k stars, AGPL-3.0, latest v3.4.11 on 2026-06-10 |
| Logto | Good app-auth alternative | Low-medium | Good console and sign-in experience | Built on OIDC/OAuth 2.1 | Good: M2M/API/CLI support in README; less reverse-proxy/access-portal oriented | GitHub: 12.1k stars, MPL-2.0, latest v1.40.1 on 2026-05-29 |
| Keycloak | Most mature, likely overkill | High | Strong admin/account consoles | Very strong OIDC/OAuth/SAML | Good: service accounts and client credentials | GitHub: 34.8k stars, Apache-2.0, latest 26.6.3 on 2026-06-04 |
| Authelia | Good reverse-proxy portal, weaker for EdgeTier-owned user management | Low-medium | Login portal; user data commonly file/LDAP/config driven | OIDC provider exists, documented as beta | Possible, but more config/proxy-centric; less ideal for Cloudflare Worker auth ownership | GitHub: 28k stars, Apache-2.0 |
| Ory Kratos + Hydra | Powerful but too custom for this task | High | Headless unless Ory Network/own UI; more components | Hydra is strong OAuth2/OIDC; Kratos handles identity | Good in principle with Hydra client credentials; likely needs Oathkeeper/custom UI/glue | Kratos: 13.7k stars, Apache-2.0, latest v26.2.0 on 2026-03-20. Hydra: 17.2k stars, Apache-2.0 |
| Supabase Auth | Not a primary fit | Medium-high if self-hosting full stack | Supabase Studio, but self-host is single-project/env-var heavy | JWT auth and OAuth/OIDC provider integrations; OAuth 2.1 server docs exist | Less direct as standalone IdP for Cloudflare Worker/WebSocket clients | GitHub: 2.5k stars, MIT, latest v2.189.0 on 2026-04-28 |

### Files found

- `README.md` - documents EdgeTier as a private testing skeleton and warns not to expose it without Cloudflare Access or equivalent private access control.
- `src/worker/index.ts` - Worker route dispatcher for `/ws`, `/api/*`, `/dashboard`, and assets.
- `src/observer/api.ts` - read-only observer API routes with no auth checks today.
- `src/durable-objects/relay-room.ts` - WebSocket room accept/relay logic with no identity or token validation.
- `docs/roadmap.md` - roadmap includes access control/audit logs for gateway work and Cloudflare Access/OAuth or equivalent auth for production.
- `docs/project-overview.md` - future direction includes user auth, access logs, multi-user permissions, and Cloudflare Access/OAuth integration.
- `.trellis/tasks/06-10-edgetier-private-cloudflare-deployment/prd.md` - records the user decision not to use Cloudflare Access and requires self-managed authentication before deployment.

### Code patterns

- Public `/ws` currently validates only WebSocket upgrade and room name, then forwards the request into the room Durable Object: `src/worker/index.ts:10`, `src/worker/index.ts:11`, `src/worker/index.ts:13`, `src/worker/index.ts:14`.
- Public API routing is called before dashboard/assets and has no auth guard: `src/worker/index.ts:16`, `src/worker/index.ts:17`.
- `/api/health`, `/api/rooms`, and room snapshot APIs are directly available from `handleApi()`: `src/observer/api.ts:17`, `src/observer/api.ts:19`, `src/observer/api.ts:20`, `src/observer/api.ts:21`.
- `RelayRoom.acceptWebSocket()` creates a session immediately after the internal `/connect` route and does not receive authenticated user/client identity: `src/durable-objects/relay-room.ts:24`, `src/durable-objects/relay-room.ts:31`, `src/durable-objects/relay-room.ts:41`, `src/durable-objects/relay-room.ts:48`.
- README explicitly states the observer API has no authentication or wildcard CORS and needs Cloudflare Access or another private access control before exposure: `README.md:33`.
- PRD requires the deployed endpoint to be private or access-restricted by EdgeTier-owned authentication and calls out the unresolved question for non-browser EasyTier WebSocket clients: `.trellis/tasks/06-10-edgetier-private-cloudflare-deployment/prd.md:14`, `.trellis/tasks/06-10-edgetier-private-cloudflare-deployment/prd.md:29`, `.trellis/tasks/06-10-edgetier-private-cloudflare-deployment/prd.md:40`, `.trellis/tasks/06-10-edgetier-private-cloudflare-deployment/prd.md:52`.

### External references

Authentik:

- GitHub: https://github.com/goauthentik/authentik
  - Repo describes Authentik as an open-source IdP for modern SSO with SAML, OAuth2/OIDC, LDAP, RADIUS, and self-hosting from small labs to production.
  - Docker Compose is recommended for small/test setups.
  - Observed GitHub signals: 21.9k stars, 1.6k forks, latest release 2026.5.2 on 2026-05-28.
- OAuth2/OIDC docs: https://docs.goauthentik.io/add-secure-apps/providers/oauth2/
  - Docs version 2026.5.
  - Authentik can act as an OpenID Provider or Relying Party.
  - Supports authorization code, client credentials, implicit, hybrid, device code, PKCE, JWKS, discovery, introspection, revocation, and refresh-token related behavior.
- Proxy provider docs: https://docs.goauthentik.io/add-secure-apps/providers/proxy/
  - Proxy provider protects apps without native OIDC/SAML/LDAP.
  - Supports outpost proxy mode and forward-auth modes, with user/group/email headers to upstream applications.

Authelia:

- GitHub: https://github.com/authelia/authelia
  - Repo describes Authelia as an SSO/MFA portal for web apps, OpenID Certified, with Apache-2.0 license.
  - Observed GitHub signals: 28k stars, 1.4k forks.
- Feature summary: https://github.com/authelia/authelia
  - Supports OpenID Connect 1.0 / OAuth 2.0, MFA, access-control rules, basic auth for one-factor endpoints, and compatibility with reverse proxies such as Traefik/Caddy.
- OIDC provider docs: https://www.authelia.com/configuration/identity-providers/openid-connect/provider/
  - Authelia supports the OpenID Connect Provider role as an open beta feature and does not support OIDC Relying Party role.
  - Docs include JWT access token/introspection, PKCE enforcement, access-token lifespans, and custom lifespan entries for `client_credentials`.
- File backend docs: https://www.authelia.com/configuration/first-factor/file/
  - File-backed users are configured in YAML, which is simple but not the same as a rich admin-user-management UI.
- Proxy docs: https://www.authelia.com/integration/proxies/introduction/
  - Authelia is explicitly designed to collaborate with reverse proxies and requires forwarded headers for correct auth decisions.

Ory:

- Kratos GitHub: https://github.com/ory/kratos
  - Headless cloud-native auth and identity management in Go.
  - Observed GitHub signals: 13.7k stars, 1.1k forks, Apache-2.0 license, latest v26.2.0 on 2026-03-20.
- Hydra GitHub: https://github.com/ory/hydra
  - OpenID Certified OAuth2/OIDC provider; standalone OAuth/OIDC server without user management, designed to connect to an identity provider through a login/consent app.
  - Observed GitHub signals: 17.2k stars, 1.6k forks, Apache-2.0 license.
  - README quickstart demonstrates `client_credentials` and authorization-code flows.
- Hydra docs: https://www.ory.com/docs/hydra
  - Linked from the repository for install, config, HTTP API, security architecture, and benchmarks.

Zitadel:

- GitHub: https://github.com/zitadel/zitadel
  - Repo describes Zitadel as open-source IAM with SSO, MFA, passkeys, OIDC, SAML, SCIM, and multi-tenancy.
  - Observed GitHub signals: 14k stars, 1.1k forks, AGPL-3.0 license, latest v3.4.11 on 2026-06-10.
- Self-hosting docs: https://zitadel.com/docs/self-hosting/deploy/overview
  - Minimal test environment can run with 1 CPU / 512 MB and PostgreSQL; Docker Compose and Kubernetes guides are available.
- Service-user client credentials docs: https://zitadel.com/docs/guides/integrate/service-users/client-credentials
  - Supports non-interactive service users via client credentials and token endpoint calls.
  - Documents token introspection requirements and JWT/opaque token behavior.
- OIDC endpoints docs: https://zitadel.com/docs/apis/openidoauth/endpoints
  - Documents discovery, authorize, token endpoints, code flow, PKCE, and token response behavior.

Logto:

- GitHub: https://github.com/logto-io/logto
  - Repo describes Logto as auth and authorization infrastructure for SaaS and AI apps, built on OIDC and OAuth 2.1 with multi-tenancy, SSO, and RBAC.
  - Observed GitHub signals: 12.1k stars, 819 forks, MPL-2.0 license, latest v1.40.1 on 2026-05-29.
  - README shows Docker Compose local startup and Node/PostgreSQL startup.
  - README states support for SPAs, web apps, mobile apps, APIs, M2M, and CLI tools.

Keycloak:

- GitHub: https://github.com/keycloak/keycloak
  - Repo describes Keycloak as open-source IAM for modern apps and services.
  - Observed GitHub signals: 34.8k stars, 8.5k forks, Apache-2.0 license, latest 26.6.3 on 2026-06-04.
- Server Admin docs: https://www.keycloak.org/docs/latest/server_admin/
  - Version 26.6.3.
  - Features include OIDC, OAuth 2.0, SAML, identity brokering, social login, LDAP/AD federation, admin console, account console, themes, 2FA, and token mappers.
  - Service accounts and client credentials are documented for REST clients and machine tokens.
- Container docs: https://www.keycloak.org/server/containers
  - Official container deployment path.
- OIDC layers docs: https://www.keycloak.org/securing-apps/oidc-layers
  - Official OIDC integration reference.

Supabase Auth:

- GitHub: https://github.com/supabase/auth
  - Repo describes Auth as a JWT-based API for managing users and issuing JWT tokens.
  - Observed GitHub signals: 2.5k stars, 673 forks, MIT license, latest v2.189.0 on 2026-04-28.
  - README says production self-hosting an auth server requires prompt security updates.
- Auth docs: https://supabase.com/docs/guides/auth
  - Supabase Auth provides client SDKs/API endpoints for user management and supports password, magic link, OTP, social login, SSO, and JWT-based auth.
  - Docs also list OAuth 2.1 Server pages.
- JWT docs: https://supabase.com/docs/guides/auth/jwts
  - JWTs include issuer, expiry, subject, role, and can be verified using keys at the issuer JWKS URL.
- Self-hosting docs: https://supabase.com/docs/guides/self-hosting
  - Recommended self-host path is Docker.
  - Self-hosting is single-project oriented, mostly configured through environment variables, community-supported, and shifts security/maintenance/HA/backups to the operator.

### Related specs

- `.trellis/spec/backend/directory-structure.md`
  - Worker routing should stay thin.
  - Public routes include `/ws`, `/api/*`, and `/dashboard/`.
  - Input validation belongs at the Worker boundary.
- `.trellis/spec/backend/error-handling.md`
  - Public API errors use small JSON responses with explicit status.
  - WebSocket auth failures should be rejected before Durable Object upgrade with a clear HTTP status where possible.
- `.trellis/spec/backend/quality-guidelines.md`
  - Worker-compatible TypeScript only; avoid Node-only APIs.
  - Do not log or return secret values.
  - Private deployment evidence must redact hostnames/secrets/logs unless intentionally public.
- `.trellis/spec/frontend/directory-structure.md`
  - Dashboard consumes same-origin observer APIs and shared DTOs.
  - Auth UI/session work should preserve shared API contract boundaries.
- `.trellis/spec/guides/cross-layer-thinking-guide.md`
  - Auth spans Worker routes, API, dashboard, Durable Object identity context, and deployment validation; define exact token/session contracts before implementation.

## Caveats / Not Found

- I did not find any current EdgeTier code path that enforces authentication for `/ws`, `/api/*`, or `/dashboard/`.
- Reverse-proxy-centric products such as Authelia and Authentik proxy outposts are useful for conventional upstream apps, but they do not naturally protect a public Cloudflare Worker unless traffic is routed through an additional proxy layer. That would weaken EdgeTier's edge deployment goal. Worker-native auth checks are the cleaner fit.
- OIDC client-credentials tokens do not solve every EasyTier client constraint. If EasyTier can only take a URI and cannot set headers or refresh tokens, EdgeTier still needs a small relay-token format or token-exchange endpoint.
- Query-string tokens can leak through logs, browser history, dashboards, and copied URIs. If they are unavoidable for EasyTier, make them short-lived, scoped to a room/client, revocable, and redact them in all logs and validation notes.
- Supabase Auth is relevant only if EdgeTier intentionally adopts Supabase/Postgres as an app platform. It is not the best standalone replacement for Cloudflare Access for this small Worker/Durable Object deployment.
- Zitadel's AGPL-3.0 license is a project/legal decision point before embedding or modifying it. Running it as a separate service may still be acceptable, but it should be reviewed before adoption.
