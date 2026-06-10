# EdgeTier v0.1.2 Real Node Validation Report

## Status

Local pre-deployment checks completed on 2026-06-10. Cloudflare deployment and real EasyTier node validation could not be completed from this environment because no private EdgeTier deployment domain is configured, Cloudflare credentials/access are not available here, and no real EasyTier node runtime/logs were provided.

Decision statement: real EasyTier nodes cannot connect in this validation environment because there is no configured private `wss://<edge-domain>/ws?room=home-mesh` endpoint for them to connect to. This is an environment/deployment blocker, not evidence of EasyTier protocol incompatibility.

## Test Environment

- Date: 2026-06-10
- EdgeTier deployment URL: `<redacted-or-private-test-url>`
- EasyTier version: pending real-node validation
- Node A platform: pending real-node validation
- Node B platform: pending real-node validation
- Room/network name: `home-mesh`
- Secrets included in this report: No
- Local sensitive values file: `.env.validation` (gitignored; present locally, but `EDGETIER_EDGE_DOMAIN` is not set according to `npm run validate:help`; do not commit real values)

## EdgeTier Checks

| Check | Result | Notes |
|---|---|---|
| `npm run typecheck` | Passed | `tsc --noEmit` completed successfully on 2026-06-10 |
| `npm run test` | Passed | 4 test files / 11 tests passed on 2026-06-10 |
| `npm run build` | Passed | Vite build and Wrangler dry-run passed on 2026-06-10; initial sandboxed run hit Wrangler log-write `EROFS`, approved rerun exited cleanly |
| `npm run proto:check` | Passed | Scaffold check found local EasyTier source candidate at `research/github/EasyTier` |
| `npm run validate:help` | Passed | `.env.validation` exists, room defaults to `home-mesh`, edge domain is missing |
| `/api/health` | Not tested | Requires deployed or local Worker runtime |
| `/dashboard/` | Not tested | Requires deployed or local Worker runtime |
| `/ws?room=home-mesh` | Not tested | Requires deployed Worker and EasyTier client |

## EasyTier Config Change

Add this peer to local/private EasyTier configs only:

```toml
[[peer]]
uri = "wss://<edge-domain>/ws?room=home-mesh"
```

Existing UDP/TCP peers should remain during validation.

## Runtime Observations

| Observation | Result | Notes |
|---|---|---|
| Node A WebSocket connects | Not tested | |
| Node B WebSocket connects | Not tested | |
| Connections stay open | Not tested | |
| Room appears in dashboard | Not tested | |
| Peer IDs appear | Not tested | |
| `connected` event appears | Not tested | |
| `handshake_seen` event appears | Not tested | |
| `rpc_seen` event appears | Not tested | |
| `packet_forwarded` appears | Not tested | |
| `packet_unroutable` appears | Not tested | |
| Traffic counters increase | Not tested | |
| Disconnect cleanup works | Not tested | |

## EasyTier Client Logs

Paste sanitized excerpts only. Do not include network secret or private endpoints.

```text
<sanitized logs>
```

## Findings

- Local preflight confirms the v0.1.1 skeleton is ready for private deployment validation: typecheck, tests, Vite build, Wrangler dry-run, proto scaffold check, and validation helper all pass.
- No real EasyTier node compatibility conclusion can be made yet because no private deployment endpoint or sanitized real-node observations have been recorded.
- The local `.env.validation` file is present, but the helper reports that `EDGETIER_EDGE_DOMAIN` is missing. The file was not copied into this report and should remain uncommitted.
- Real deployment was not attempted from this environment because `npx wrangler login`/`npx wrangler deploy` require private Cloudflare account credentials and the PRD requires access control before public exposure.
- Real node testing was not attempted because no deployed WSS URI, EasyTier version, node platforms, or sanitized EasyTier logs are available in this workspace.
- The current implementation still only parses the 16-byte EasyTier packet header and observes handshake/RPC payloads heuristically; it must not be described as full EasyTier control-plane compatibility.

## v0.1.3 Implications

Current recommendation before another real-node attempt:

- [x] Need official proto-backed handshake/RPC envelope inspection first or in parallel with the next validation pass so real client failures can be classified precisely.
- [ ] Need handshake decode/response first.
- [ ] Need Ping/Pong behavior first.
- [ ] Need RpcPacket/RpcRequest/RpcResponse proto decode first.
- [ ] Need OspfRouteRpc.SyncRouteInfo response first.
- [ ] Need PeerCenterRpc support first.
- [ ] Baseline works; proceed to official proto drift hardening.

## Decision

Blocked before real EasyTier connection attempt. Local build/test/proto preflight passes, but private Cloudflare deployment and real EasyTier node validation remain manual because this environment lacks the private deployment endpoint, Cloudflare credentials/access-control confirmation, and real node runtimes/logs.

## Next Manual Steps

1. Fill the local gitignored `.env.validation` with a private `EDGETIER_EDGE_DOMAIN` after confirming access control. Do not add secrets or private hostnames to tracked files.
2. Deploy to a private Cloudflare test endpoint only after access is restricted appropriately:

```bash
npx wrangler login
npx wrangler deploy
```

3. Verify deployed routes with the real private domain:

```text
https://<edge-domain>/api/health
https://<edge-domain>/dashboard/
wss://<edge-domain>/ws?room=home-mesh
```

4. Run `npm run validate:help` and use its generated peer URI in private EasyTier configs only.
5. Add the WSS peer URI to local/private EasyTier configs without committing secrets, while keeping existing UDP/TCP peers enabled.
6. Start one node, then two nodes, and record sanitized dashboard/API observations in this report.
7. Paste only redacted EasyTier client logs that show WSS connection behavior and protocol errors, if any.
