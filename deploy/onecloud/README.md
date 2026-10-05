# OneCloud host adapter and production extension

The adapter reports sanitized DDNS, systemd and EasyTier2.6.4 observations to the private EdgeTier dashboard. The existing DDNS writer remains the only DNS writer. Neither the browser, Worker nor host report contains Cloudflare credentials or the mesh secret.

## Runtime files

| Path | Purpose |
|---|---|
| /usr/local/libexec/onecloud-ddns | Existing writer, extended with atomic credential-free status |
| /var/lib/onecloud-ddns/status.json | Last attempt, provider confirmation and controlled failure; root0600 |
| /usr/local/libexec/edgetier-host-agent | Fixed service/CLI collector and fixed refresh operation |
| /etc/edgetier-host/config.json | Endpoint, host identity, explicit instance selector and scoped report token; root0600 |
| /var/lib/edgetier-host/state.json | Boot sequence, execution intent and acknowledgement retry journal; root0600 |
| edgetier-host.timer | OnUnitInactiveSec60s plus up to5s jitter and AccuracySec1s, so execution time adds to the interval |

Collector 1.0.1 preserves DDNS, service observations and command acknowledgement within the exact compact JSON 64 KiB upload budget. Optional topology is bounded to 256 peers, 16 connections/listeners and 32 proxy CIDRs. Whole excess peers are omitted with `easytier.truncated:true` and a positive `omittedPeers` count; list-only reduction uses the flag alone. Peer counts are the displayed subset when truncation is present. Raw systemd `unitFileState` is retained; `enabled` means permanently enabled, while static/runtime units do not guarantee persistent startup.

The oneshot limit is 600 seconds, covering the 500-second permitted collection/upload/refresh/follow-up path. The ten-minute command lifetime remains independent and is enforced by the Worker. Deploy the modern Worker validation before collector 1.0.1; the added fields are optional so previous reports continue to work. No HostState migration is required.

Use exactly one instanceName or instanceId. Prefer a stable name set through the existing core's ET_INSTANCE_NAME. An unnamed instance UUID changes after a core restart. RPC is fixed to loopback127.0.0.1:15888; the report agent adds no inbound port. Host identifiers use `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`, including dotted names supported by Worker profiles.

```json
{"hostId":"onecloud","instanceName":"home-kwrt","endpoint":"https://edgetier.example.org","directHostname":"ip.example.org","reportToken":"<host-scoped-token>"}
```

## Core gateway settings

For the tested gateway, the existing core service has this drop-in:

```ini
[Service]
Environment=ET_USE_SMOLTCP=true
Environment=ET_INSTANCE_NAME=home-kwrt
```

smoltcp restored LAN Web access while keeping the host firewall's routed-deny policy. Preserve the original network identity, static overlay address and LAN proxy CIDR. A joining client must not copy the gateway's virtual IP or proxy advertisement.

## Refresh operation

The only remotely queued operation is ddns-refresh. It calls exactly /bin/systemctl start onecloud-ddns.service; systemd waits for/coalesces an already-running timer update. Calling a second writer directly would fail the writer's nonblocking lock during timer overlap. No arbitrary unit, shell command, file path or EasyTier child configuration is accepted.

The agent persists execution intent before dispatch and completion before acknowledgement upload. After an interrupted process it reports execution_interrupted rather than blindly executing twice. HTTP retry acknowledges the same completed command. Backend commands expire after10minutes; one pending command is retained per host. A failed host read in an aggregate response carries `readErrorCode:host_state_unavailable` while healthy hosts remain available; the failed profile has no direct peers. Reports older than5minutes are stale, and stale/provider-failed/address-mismatched profiles cannot generate verified direct peers.

## Production source and adapter ownership

The GitHub baseline predates the deployed v2 official EasyTier Web/VPC bridge and ConfigServerProbe. The root-private legacy module remains necessary; never copy it or resident credentials into Git. Release 0.2.1 exports the repaired modern RelayRoom under the same existing class/binding name, plus modern HostState. Directory and ConfigServerProbe remain legacy exports. There is no namespace replacement or migration in this code-only release.

Legacy retains public /ws and /config-server/ws admission, management hostname and Cloudflare Access validation, login/logout/cookies, room/default-room handlers, dashboard assets, official Web bridge and unknown/extended routes. Its room/WS handlers reach the repaired class through the unchanged RELAY_ROOM binding. The adapter turns only URIError on legacy room paths into a controlled 400. Protected modern host/profile handlers first call authoritative legacy /api/auth/me with the same origin and headers, then apply their existing cookie validation. Only the fixed, host-scoped bearer report route is exempt. Do not replace the legacy management gate with a cookie-only handler or guess its Access internals.

Do not run a bare wrangler deploy against this production deployment until the legacy source/history is reconciled. npm run build is a local build/dry-run. Assemble legacy.js from the verified root-private backup, modern.js from the tested public source, and edge-extension.js as the upload entry. Health preserves legacy capabilities and reports the exact release and relayImplementation; recovery never claims relay-lifecycle active.

## Rollout and recovery contract

### 1. Scope

rollout-edgetier.py is a OneCloud-local adapter for this deployment. The initial installation requires migration v2 and creates HostState with tag host-management-v1. Subsequent releases inherit the existing classes/bindings/data. Existing Cloudflare credentials remain on OneCloud.

### 2. Signatures

```text
python3 rollout-edgetier.py --backup <root-private-baseline> --bundle <release-bundle> --release-version 0.2.1 --code-only
python3 rollout-edgetier.py --backup <root-private-baseline> --bundle <recovery-bundle> --release-version 0.2.1 --code-only --forward-recovery
```

A normal bundle contains client/, modern.js, edge-extension.js and release.json:

```json
{"version":"0.2.1","target":"edgetier","relayImplementation":"modern"}
```

### 3. Contracts

- Release version, manifest mode, exported RELEASE_VERSION/RELAY_IMPLEMENTATION and actual class import/export ownership must agree before any credentials or provider API are read. Normal mode requires modern RelayRoom; explicit forward recovery requires legacy-recovery and --code-only.
- Script PUT inherits version_id latest. Verify latest equals the active recorded baseline immediately before upload. This check is not an atomic deployment lock; avoid concurrent releases.
- --code-only inherits every current binding except replaced ASSETS, including HOST_PROFILES/HOST_REPORT_TOKENS/HOST_STATE, and omits migrations. Its output has newBindings=[] and the actual release/mode. It never reads/reconstructs/replaces/chmods /etc/edgetier-host/config.json: customized bytes, mode, modification time, instance/host/domain/token remain unchanged; a missing config stays absent. Bootstrap is separate.
- Only built public assets/modules are shipped from the workstation. Private legacy source stays in the host backup; .env, .dev.vars, source maps and credentials are excluded. Root-only release-manifest.json records the baseline and mode.
- The script generates recovery-index.js and recovery-release.json. They retain the full tested adapter routing, authoritative host/Access gate, host ingestion/status and all class exports. Only RelayRoom import and mode change to the preserved legacy implementation. Prepare a recovery bundle with those files renamed edge-extension.js/release.json, the retained modern.js and compatible client assets; run the explicit recovery command. Do not delete namespaces, reset data or replay migrations.
- As a second option, the recorded immediately prior 0.2.0 deployment can be restored by Cloudflare version rollback: it has the same host-management-v1 lifecycle and 19 bindings as 0.2.1. Resolve the exact baseline version from the root-private release snapshot, verify it remains the intended prior version, and retain the existing namespace/data. This restores that older version's routing/mesh behavior. Crossing back to the pre-HostState lifecycle remains unsupported by ordinary rollback.

### 4. Validation / Errors

| Condition | Behavior |
| --- | --- |
| Missing/invalid/mismatched manifest or version | Reject before credential/API access |
| Mode disagrees with imported core class or exported marker | Reject before credential/API access |
| Recovery without --code-only, or normal bundle in recovery mode | Reject before credential/API access |
| Active/latest deployment changed | Stop before upload |
| Required binding missing after deployment | Controlled rollout failure; use recorded snapshots for recovery |
| Wrong management hostname/Access/session | Return unchanged authoritative legacy denial |
| Legacy room URI decoding throws | 400 invalid room name; unrelated errors are not hidden |

### 5. Good / Base / Bad Cases

Good: release 0.2.1 runs modern core in the existing namespace while official bridge/login continue to use legacy behavior. Base: an unchanged configured collector stays byte-for-byte untouched through code-only deployment. Bad: exporting default legacy as recovery would silently remove modern host ingestion/status; the generated recovery keeps the full adapter.

### 6. Tests

Node assembled-entry tests use a contract-only legacy fixture plus the real compiled modern Worker; no private source or live network is involved. Assert modern/legacy class ownership, existing storage/binding identity, hostname/Access/cookie negative cases, cookie preservation, report exemption, WS/default/bridge/unknown routing, controlled room errors and normal/recovery health. These mocks do not verify Cloudflare Access JWT cryptography or an actual socket upgrade; production acceptance remains separate.

Python main() tests mock all provider requests/root paths and assert config bytes/mode/mtime/inode preservation, missing config absence, current binding inheritance without migrations, release metadata, positive recovery and wrong-mode rejection before privileged I/O.

### 7. Wrong / Correct

```text
Wrong: recovery exports default legacy and creates another RelayRoom namespace.
Correct: recovery changes only the RelayRoom import in the tested adapter, keeps its existing binding/data, and uses explicit code-only recovery mode.
```

## Verification commands

```text
python3 -B -m unittest discover -s deploy/onecloud -p 'test_*.py'
node --test deploy/onecloud/test_edge_extension.mjs
npm run typecheck
npm test
npm run build
npm run proto:check
```

On the host, systemctl status edgetier-host.timer and journalctl -u edgetier-host.service show small status messages. edgetier-host-agent --dry-run prints only sanitized telemetry and performs no upload or command. Never print the token config, raw EasyTier node.config, service environment or commandline.
