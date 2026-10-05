# Host status and DDNS management

## 1. Scope / Trigger

Apply when changing OneCloud heartbeat ingestion, host status pages, DDNS refresh control or DDNS-backed config profiles. The original relay observer remains read-only. This feature authorizes one fixed `ddns-refresh` operation; it does not authorize arbitrary root commands, remote config replacement or an additional DNS writer.

## 2. Signatures

```text
POST /api/hosts/:hostId/report          # per-host Bearer authentication
GET  /api/hosts                        # administrator session; { hosts: HostSnapshot[] }
GET  /api/hosts/:hostId                 # administrator session; HostSnapshot
POST /api/hosts/:hostId/ddns-refresh    # administrator session + same-origin Origin
GET  /api/config-profiles              # administrator session; { profiles: ConfigProfile[] }

HostState.fetch("/?hostId=...")
HostState.fetch("/report?hostId=...", POST HostReport)
HostState.fetch("/ddns-refresh?hostId=...", POST)
```

Shared DTOs: `src/observer/host-types.ts`. Runtime validation: `src/observer/host-validation.ts`. Public adapter: `src/observer/host-api.ts`. Per-host DO: `src/durable-objects/host-state.ts`.

Binding and migration:

```toml
[[durable_objects.bindings]]
name = "HOST_STATE"
class_name = "HostState"

[[migrations]]
tag = "host-management-v1"
new_sqlite_classes = ["HostState"]
```

DO storage key: `host-state:v1`. An explicit promise queue serializes the entire validation/order/write decision. Default Cloudflare storage input/output gates also protect storage operations; failed confirmed writes reset the object rather than allowing phantom in-memory success. Do not opt into `allowUnconfirmed` for host state.

## 3. Contracts

- `HOST_PROFILES` is a nonsecret JSON array of at most 16 exact `HostProfile` objects: `hostId`, `displayName`, `roomId`, `networkName`, `directHostname`, `directPort`. Empty configuration returns empty hosts/profiles. Reports cannot create or rename a profile.
- `HOST_REPORT_TOKENS` is a Worker secret JSON map keyed by configured `hostId`. Each token is 32–256 characters. Host bearer authentication is independent of administrator cookies. A host token cannot read the dashboard or request commands.
- `HostReport` is at most 64 KiB, including streamed bytes regardless of `Content-Length`. Every nested object is field-whitelisted. `capturedAt` must be an ISO timestamp within the past day and no more than five minutes ahead.
- The only service units are `easytier-core-home.service`, `easytier-web.service`, `edgetier-home-cloudflared.service`, and `onecloud-ddns.timer`. Optional `HostService.unitFileState` preserves the raw safe systemd state. `enabled` means persistently enabled, and must equal `unitFileState === "enabled"` when that field is present; `static` and `enabled-runtime` do not establish persistent enablement or boot startup.
- Never accept `node.config`, service environment/command lines, Cloudflare responses/headers, cookies, network secrets, relay tokens or credential-bearing URLs. Transport URLs have a known protocol, host and port (including default WS80/WSS443 canonicalization), with no userinfo, query, fragment or non-root path. Error codes contain lowercase code characters only.
- The latest report, receipt time, 32 DDNS history entries, 64 recent report IDs, and current command are persisted. A duplicate report in this retry window or duplicate current-boot sequence cannot refresh receipt time. Backwards sequence/capture time is rejected. A boot change requires strictly newer capture time.
- Freshness is calculated from server `receivedAt`, never caller claims: missing=`never`, age up to five minutes=`fresh`, otherwise=`stale`. Stale reports remain visible.
- One pending fixed command exists at a time. Repeated admin requests return that pending command. It expires after ten minutes; expiry is materialized during reads/reports/requests. No expired command is delivered to the collector.
- A current pending command acknowledgement requires completion within command lifetime, with up to five seconds for clock/whole-second skew around request time and report capture. The acknowledgement cannot be more than five seconds ahead of server time. A prior command acknowledgement is ignored and cannot overwrite or block delivery of a newer command. Duplicate reports do not reapply acknowledgements.
- Direct config peers are returned only when receipt is fresh, provider confirmation is at most five minutes old and not future, status is successful, the record hostname matches the configured hostname, `proxied=false`, and global IPv6 equals the current stable host IPv6 after canonicalization. Current errors block direct export even when a previous success exists. Profiles never contain network secrets.
- Individual host reads, ingestion and refresh transport failures return controlled 503 JSON. Aggregate hosts/profiles retain healthy hosts and return a failed host placeholder with its configured profile, `freshness:"never"`, empty history, and optional `readErrorCode:"host_state_unavailable"`. Failed profiles carry the same code, unknown DDNS and no direct peers. Missing global storage binding/invalid profiles still return 503. Never forward a rejected Durable Object exception or its private message.
- Collector report encoding is exact compact JSON with an inclusive 64 KiB UTF-8 byte bound, including commands and metadata. Preserve DDNS, services, node and commandAck; omit whole optional peer records until the body fits. Optional `easytier.truncated:true` marks schema/list/byte reductions; optional positive integer `omittedPeers` counts wholly omitted peers and requires `truncated:true`. List-only reductions may set `truncated:true` without inventing an omitted-peer count. Limits are 256 peers, 16 connections/listeners, and 32 proxy CIDRs.
- Collector hostId follows the same strict 1–64-character `[A-Za-z0-9][A-Za-z0-9._-]*` contract as profiles/routes. Collector text excludes both ASCII controls and U+007F, and enforces the same UTF-16 code-unit lengths as the TypeScript receiver.
- The collector oneshot has `TimeoutStartSec=600` to cover the 500-second permitted collection/upload/refresh/follow-up budget. Its timer uses `OnUnitInactiveSec=60s`, `RandomizedDelaySec=5s`, `AccuracySec=1s`; execution duration is added to the interval.
- Collector config must contain exactly one explicit `instanceName` or legacy `instanceId`. Prefer a persistent core name such as `home-kwrt` with CLI `-n`; an unnamed core UUID can change across service restart. Names are strict 1–64-character identifiers (`[A-Za-z0-9][A-Za-z0-9._-]*`), IDs are valid UUIDs selected with `-i`. If CLI emits multi-instance result envelopes, require one matching `instance_name` or `instance_id`; do not select the first result or merge instances.
- EasyTier 2.6.4 node IPv4 is a string, but verbose route IPv4 uses `common.Ipv4Inet`: `{address:{addr:uint32},network_length:uint32}`. Decode the integer in network byte order. `common.Ipv6Inet` uses four network-order uint32 words (`part1` through `part4`). Require an exact complete shape, integer bounds and valid prefix; reject wrong-family values and incomplete/malformed objects rather than inventing addresses.
- Collector transport sanitization preserves default WS port 80 and WSS port 443 when omitted, and strips userinfo, paths and queries before reporting. Other transport protocols require an explicit valid port.
- Profiles keep `roomId` distinct from `networkName`; no fixed public peer fallback is added. Direct peers are `udp://<configured-host>:<port>` and `tcp://<configured-host>:<port>` and are IPv6-only.

Recommended collector config (root0600; placeholders only):

```json
{"hostId":"onecloud","endpoint":"https://edgetier.example.org","directHostname":"ip.example.org","instanceName":"home-kwrt","reportToken":"<host-scoped-report-token>"}
```

A legacy `instanceId` may replace `instanceName`, but both fields together are invalid.

## 4. Validation & Error Matrix

| Condition | Response |
| --- | --- |
| Administrator route without valid session | 401 `{error}` |
| Ingest missing/wrong/cross-host bearer | 401 `{error: "invalid host credentials"}` |
| Body host differs from path, extra fields, invalid metrics/time/URLs | 400 `{error: "invalid host report"}` |
| Oversized report header or stream | 413 `{error: "host report too large"}` |
| Report sequence/time moves backwards | 409 `{error: "out of order host report"}` |
| Duplicate report/current sequence | 200 `{accepted:false, duplicate:true}` plus pending command if any |
| Invalid current-command completion time | 400 `{error: "invalid command acknowledgement time"}` |
| Admin DDNS request missing/wrong Origin | 403 `{error: "same origin required"}` |
| Unknown admin host | 404 `{error: "host not found"}` |
| Invalid profiles or missing configured storage | controlled 503 `{error}` without private exception details |
| Individual storage transport failure | controlled 503 `{error}` |
| One host read fails in aggregate | 200 with healthy snapshots and failed configured host `readErrorCode`; failed profile has `directPeers:[]` |
| Truncation count nonpositive/without true flag or raw service state contradicts enabled | 400 `{error:"invalid host report"}` |
| Expired command | snapshot `status:"failed", errorCode:"command_expired"` |
| Stale or unverified DDNS | visible snapshot; profile `directPeers:[]` |

## 5. Good / Base / Bad Cases

- Good: OneCloud sends a sanitized actual EasyTier CLI report with RPC status independent of systemd service status, and the dashboard can show local peer loss/latency observations without calling them Worker relay metrics.
- Good: a temporary HTTP retry returns `duplicate:true` while leaving `receivedAt` unchanged, and still delivers the same pending command.
- Base: no configured host gives an install empty state, not a fabricated OneCloud heartbeat.
- Bad: forwarding `easytier-cli node info` JSON unchanged, since its `config` field contains network secrets and tokenized URIs.
- Bad: using an administrator session as a substitute for the collector bearer, or deriving direct peers from stale DDNS success.

## 6. Tests Required

- `host-validation.test.ts`: exact field rejection at nested boundaries, size/list/time limits, URL credential rejection, profile parsing, canonical IPv6 equality and stale/error/provider gating.
- `host-api.test.ts`: admin versus host auth isolation, cross-host token rejection, cookie-only ingest rejection, same-origin control, actual streamed byte limit, empty/invalid configuration, individual controlled transport failure, and mixed-host transport/non-OK/malformed JSON isolation.
- `host-state.test.ts`: restart persistence, stale receipt recomputation, duplicate/backwards reports, new boot ordering, simultaneous report serialization, 32-entry history, pending request deduplication, ack retry isolation and ten-minute expiry.
- Python collector regressions: actual encoded/uploaded large report stays<=65536 bytes while retaining commandAck/DDNS/services; omitted count plus visible peers equals observed total; list-only reductions do not invent omitted peers; DEL names are omitted/fallback safe; dotted identifiers install; static/runtime state remains raw and not persistently enabled; the allowed 500-second execution path completes within the unit deadline.
- Run TypeScript, complete Vitest suite, build including Wrangler dry-run and proto check. Live host/report/config/mesh evidence is separately required before calling deployment complete.

## 7. Wrong vs Correct

Wrong:

```typescript
await storage.put('node', await request.json()); // raw config and credentials may persist
return { directPeers: [hardcodedPeer] };         // hides stale or failed DDNS
```

Correct:

```typescript
const report = validateHostReport(body, configuredHost.hostId);
if (!report) return Response.json({ error: 'invalid host report' }, { status: 400 });
// HostState serializes ordering, acknowledgement and persistence decisions.
const profile = configProfile(snapshot); // verified DDNS only, otherwise directPeers=[]
```

## Live contention correction

DDNS refresh must invoke the fixed systemd onecloud-ddns.service, not a second direct writer process. The timer and a dashboard request can overlap; systemd start waits for/coalesces the existing oneshot. This preserves the sole DNS writer and avoids false command failures on its nonblocking lock. The command allowlist remains exactly one fixed unit; no user-supplied executable, argument or unit is accepted.
