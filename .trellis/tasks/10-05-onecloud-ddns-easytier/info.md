# Implementation contract

## Ownership
Backend agent owns src/observer/host-types.ts, host validation/API, a new per-host Durable Object, Worker routing/env, wrangler migration and backend tests/specs. Frontend agent owns dashboard API, host pages, config generator, i18n/styles and frontend tests/specs. Parent owns deploy/ Python collector, systemd integration, live validation, operational notes and rollout. Do not commit or overwrite existing README/assets changes.

## Fixed API contract
Shared types are in src/observer/host-types.ts. Do not rename agreed fields without messaging the parent and frontend agent.

- POST /api/hosts/:hostId/report is outside session auth, protected with Bearer token selected from secret HOST_REPORT_TOKENS JSON map. Host ID must be configured and body match it. No browser/admin cookies accepted in place of host token. Max report 64 KiB, reject credential/config/unknown fields and unsafe URL userinfo/query.
- GET /api/hosts -> {hosts: HostSnapshot[]}; GET /api/hosts/:id -> HostSnapshot. Admin session only.
- POST /api/hosts/:id/ddns-refresh -> {command: HostCommand}. Admin session plus same-origin Origin required. One pending command at a time, duplicate requests return it; expire after ten minutes. Only fixed ddns-refresh kind, no arbitrary commands. Ack accepted only for current command and sane times. Responses to later reports deliver pending commands, not expired ones. Host adapter persists acknowledgement so successful DNS update cannot be rerun on HTTP retry.
- GET /api/config-profiles -> {profiles: ConfigProfile[]}. Admin only; directPeers empty unless fresh report and provider confirmation no older than five minutes, successful DDNS status, DNS-only AAAA at expected hostname. Stale data remains visible but cannot imply reliable config. Allow fresh lastSuccessAt after a current attempt fails? For this task block direct export on current error and show it.

HOST_PROFILES is an optional nonsecret env JSON array of HostProfile entries. Production intended entry: {hostId:'onecloud',displayName:'OneCloud',roomId:'home-mesh',networkName:'home-mesh',directHostname:'ip.ziyourufeng.eu.org',directPort:11010}. No hardcoded fallback in generated config. Empty env produces empty host list; invalid env reports controlled503. Reports cannot create/rename profiles. Preserve all existing room routing and r720 services.

New HOST_STATE DO binding, class HostState, migration new_sqlite_classes with a new unique tag. Per-host state keyed by configured hostId, small bounded DDNS history (32 entries). Validate before persistence, serialize mutation/order decisions. Duplicate report id or sequence cannot overwrite state. Boot changes require newer capturedAt, sequence monotonic within boot; reject timestamps more than five minutes in future or a day old. Freshness based on server receivedAt <=five minutes. Never accept raw node.config, full service env/commandline, network secrets, relay tokens or CF response headers. No event log secret values.

Collector uses fixed OneCloud service allowlist and fixed local EasyTier CLI RPC127.0.0.1:15888 with stable instanceName (recommended, -n home-kwrt) or exclusive legacy instanceId (-i UUID). A core restart can change an unnamed instance UUID; never silently fall back to another instance. Envelope filtering uses instance_name or instance_id according to the explicit selector and requires exactly one matching result. Sanitizes raw node/peer output; never forwards node.config or URL query/userinfo. Systemd active status and successful RPC/peer status are separate. DDNS writer will atomically persist credential-free state at /var/lib/onecloud-ddns/status.json; error updates retain last successful address/time but status is error. Agent supplies currentIpv6 only if one unambiguous current stable eth0 GUA. Collector reports every60seconds, outbound HTTPS, token root0600, no new incoming port. Commands run only the fixed /bin/systemctl start onecloud-ddns.service. systemd coalesces a request with an already-running timer update; directly running the writer would fail its nonblocking lock during overlap. No arbitrary unit name or credentials are transmitted.

UI adds DDNS and Host services tabs, bilingual text. Preserve last successful reports when polling fails; show fresh/stale/never and server receipt plus DDNS success/error times, pending/completed/failed refresh. Host peer metrics explicitly local EasyTier observations, Worker topology remains separate. New unknown host states produce a useful install empty state.

Config generator selects returned ConfigProfile; roomId is separate from networkName. User enters network secret browser-side only, never submitted. Direct URI choices from profile, label IPv6-only and stale/no confirmation. Fix no_listener to listeners=[], disable_ipv6 UI to flags.enable_ipv6 inversion. Provide valid static virtual IPv4 if DHCP disabled or block export; no duplicate gateway/proxy defaults. Use current EasyTier2.6.4 flags only. Optional WSS token remains five-minute temporary; invalidate on room/network changes, remove/disable expired tokens, prominently explain unattended reconnect requires renewed credential. No quiet TTL expansion. Don't claim LAN-local acceptance verifies outside WAN ingress.

## Verification
Meaningful boundary tests: auth isolation, size/field validation, ordered/duplicate reports, persistence/restart, stale status, command expiry/ack idempotence and profile verification. Config unit tests cover IPv6/listener semantics, room/token mismatch/expiration, direct profile selection and static IPv4 validation. Parent runs all gates and real EasyTier2.6.4 config/client acceptance plus browser verification. Live Cloudflare export/rollout currently requires explicit authorization because automatic approval review rejected metadata/source export; do not retrieve CF keys or exports.

## Collector configuration sample

Save root0600 at /etc/edgetier-host/config.json. Prefer a configured persistent core instance name (ET_INSTANCE_NAME=home-kwrt in the current service adapter). Do not include both selector fields.

```json
{
  "hostId": "onecloud",
  "endpoint": "https://edgetier.example.org",
  "directHostname": "ip.example.org",
  "instanceName": "home-kwrt",
  "reportToken": "<host-scoped-report-token>"
}
```

A legacy stable-ID deployment may replace instanceName with instanceId containing the actual UUID. Names are strict identifiers; no arbitrary CLI arguments are accepted.
