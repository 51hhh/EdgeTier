# EdgeTier Private Cloudflare Deployment

## Goal

Deploy the current EdgeTier Worker/Durable Object skeleton to a private Cloudflare test endpoint, verify the deployed health/dashboard/WebSocket routes, and prepare the private WSS URI needed for the next real EasyTier node validation pass.

## What I Already Know

- User requested a real private Cloudflare deployment.
- The project already has `wrangler.toml` for Worker name `edgetier`.
- Worker entrypoint is `src/worker/index.ts`.
- Dashboard assets are built from Vite into `dist/client`.
- Durable Object bindings are configured:
  - `RELAY_ROOM` -> `RelayRoom`
  - `DIRECTORY` -> `Directory`
- Migration `v1` creates SQLite Durable Object classes `RelayRoom` and `Directory`.
- Existing preflight commands are:
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
  - `npm run proto:check`
- `npm run build` runs `vite build && wrangler deploy --dry-run --outdir dist/worker`.
- `npm run validate:help` reports `.env.validation` exists but `EDGETIER_EDGE_DOMAIN` is missing.
- v0.1.2 validation was previously blocked because no private deployed endpoint was available.
- The observer API/dashboard must not be exposed publicly without access control such as Cloudflare Access.
- User decided not to use Cloudflare Access for this project; private access should be enforced by EdgeTier's own login/user management.
- GitHub research is required before selecting the self-managed authentication approach.

## Assumptions

- The deployment should stay private and not become a public unauthenticated dashboard/API/WebSocket relay.
- Real EasyTier secrets and private hostnames must stay out of tracked files.
- Cloudflare login/deploy may require user interaction in a browser or an API token configured outside the repo.
- If a custom route/domain is not ready, a temporary `workers.dev` deployment may be acceptable only after EdgeTier has its own access control in place.

## Open Questions

- Confirm whether the deployment MVP should use the small Worker-native session + WSS token approach, or adopt a larger auth platform immediately.
- Confirm whether EasyTier clients can send custom WebSocket headers; if not, use query-string WSS join tokens as the validation MVP.

## Requirements

- Run local preflight before deploy:
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
  - `npm run proto:check`
- Authenticate Wrangler without committing credentials.
- Deploy EdgeTier to Cloudflare using the existing Worker/Durable Object configuration.
- Ensure the deployed endpoint is protected by EdgeTier-owned auth before sharing it with EasyTier clients.
- Research and choose a self-managed authentication approach before real private deployment.
- Verify deployed routes:
  - `https://<edge-domain>/api/health`
  - `https://<edge-domain>/dashboard/`
  - `wss://<edge-domain>/ws?room=home-mesh`
- Update local `.env.validation` with the private deployment domain if needed, keeping it gitignored.
- Record sanitized deployment evidence in this task.

## Acceptance Criteria

- [ ] Cloudflare deployment command completes successfully.
- [ ] Deployed `/api/health` returns service health JSON.
- [ ] Deployed `/dashboard/` loads.
- [ ] Deployment is private or access-restricted by EdgeTier-owned authentication.
- [ ] A sanitized deployed endpoint reference is recorded without secrets.
- [ ] `npm run validate:help` generates the expected WSS URI from local gitignored env values.
- [ ] No Cloudflare credentials, EasyTier secrets, or private logs are committed.

## Definition of Done

- Local preflight passes.
- Cloudflare deploy succeeds or blocker is explicitly documented.
- Deployed route checks pass or blocker is explicitly documented.
- Deployment notes are recorded in this task directory.
- Any repo changes are reviewed and committed only after verification.

## Out of Scope

- Implementing full EasyTier protocol compatibility.
- Using Cloudflare Access as the authentication layer.
- Building a full production identity platform beyond what is required to keep this test endpoint private.
- Real EasyTier node traffic validation; this deployment task only unblocks that follow-up.
- Committing `.env.validation`, Cloudflare tokens, network secrets, or private endpoint logs.

## Technical Notes

- `wrangler.toml` currently has no custom route configured.
- `README.md` says not to run `npx wrangler deploy` until access is restricted appropriately.
- v0.1.2 validation report records the desired WSS peer URI shape:

```text
wss://<edge-domain>/ws?room=home-mesh
```

- Validation helper command:

```bash
npm run validate:help
```

## Research References

- [`research/edge-worker-auth.md`](research/edge-worker-auth.md) - Better Auth is the strongest full first-party auth candidate; a smaller D1/session + `jose` WSS token layer is the pragmatic private-deployment MVP.
- [`research/self-hosted-identity.md`](research/self-hosted-identity.md) - Authentik is the best default self-hosted IdP if EdgeTier wants external identity management; Worker-native enforcement is still required for this Cloudflare Worker deployment.
- [`research/websocket-auth.md`](research/websocket-auth.md) - No mature drop-in Worker WebSocket auth package was found; EdgeTier should verify auth before Durable Object handoff and issue short-lived room-scoped relay tokens for `/ws`.

## Feasible Auth Approaches

### Approach A: Worker-native MVP (recommended for private deployment)

- Add EdgeTier-owned dashboard/API session auth.
- Store users/sessions in a dedicated auth store, likely D1 for user/session source of truth.
- Use HTTP-only secure cookies for `/dashboard/` and `/api/*`.
- Add an endpoint that issues short-lived, room-scoped WSS join tokens.
- Verify `/ws?room=<room>&token=<token>` before `RelayRoom` Durable Object handoff.

Why this fits:

- Lowest operational dependency count.
- Works without Cloudflare Access.
- Fits clients that can only provide a WSS URI.
- Keeps future migration path open to Better Auth or Authentik.

### Approach B: Better Auth product path

- Use Better Auth for first-party user accounts, sessions, and future 2FA/passkeys.
- Still add a custom WSS token issuer/verifier for EasyTier clients.
- Likely requires D1/Drizzle spike before implementation.

Why this fits:

- Better long-term account management than a custom auth layer.
- More implementation surface than required just to deploy a private test endpoint.

### Approach C: Authentik-backed OIDC

- Run Authentik as the user/admin/group system.
- EdgeTier performs OIDC login and validates tokens/JWKS at the Worker boundary.
- Still add short-lived EdgeTier relay tokens for URI-only WebSocket clients.

Why this fits:

- Strong self-hosted identity/admin story.
- Adds an external service dependency before the first private Cloudflare deployment.

## Recommended MVP Decision

Use Approach A for this deployment task:

```text
Worker-native session auth + short-lived room-scoped WSS relay tokens.
```

Defer Better Auth/Authenik selection until after the private endpoint is deployed and the EasyTier client WSS constraints are confirmed.
