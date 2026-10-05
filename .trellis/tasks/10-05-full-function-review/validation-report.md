# Full function review completion

Date: 2026-10-05. User focus: networking, DDNS, multiple services and multiple users.

## Findings and local corrections

The review reproduced per-room all-room dialing, cross-room forwarding attempts, lost mappings after one of two accepted connections closes, stale route metadata/whole-matrix replacement, incorrect foreign-owner versions, unbounded queues/RPC snapshots and early configured-network peer binding. Local RelayRoom now has a durable owner, room-scoped maintenance/forwarding, survivor selection, monotonic owner-version rows, bounded queues and pending/fragment cleanup, and binds configured peers after accepted handshake.16 new actual-class regressions cover these failures. Parent also corrected URI decode exceptions with3 API regressions.

Host/UI corrections include exact64KiB upload budgeting and explicit truncation, DEL/UTF-16 parity, dotted identifiers, partial-host fault isolation, selection revision and profile/token guards, truthful systemd UnitFileState,600-second collector service coverage and timerAccuracySec1s. Code-only deployment preserves local collector config and inherits current cloud bindings;2 intercepted main() regressions verify custom and missing configs.

## Merged validation

-171 tests across27 TypeScript files passed;42 targeted relay tests.
-30 Python unittest cases passed.
-TypeScript, proto drift, Vite build and Wrangler dry-run passed. Existing large chunk warnings are nonfatal.
-Focused API suite5 tests and final git diff --check passed.

## Live release and acceptance

Modern host API and dashboard/collector fixes released at version10fe67c5-c35b-433c-aee1-be32051fe160,100% traffic.19 existing bindings inherited;no new migration. Collector1.0.1 installed after the new Worker. Existing config bytes,mode andmtime match the root-private pre-release snapshot. Backup:/var/backups/edgetier-rollout/20261005T111251Z/functional-review-20261005T123131Z.

Core/Web/cloudflared/DDNS timer/host timer all active. Real browser shows fresh reports and raw enabled unit states. DDNS request12:33:37.179Z completed12:34:03Z,received12:34:05.452Z. Provider-confirmed AAAA equals the stable host IPv6;DNS-only/TTL120. Placeholder-secret form check generated UDP/TCP IPv6 peers,listeners=[] andenable_ipv6=true,with export controls enabled. Placeholder cleared afterward. No placeholder client joined.

Internal official Web sessions API returned200 with2 sessions,both user_id2. Read-only database counts:2 users,0 persistent running-network configurations. EdgeTier remains one static administrator and a fixed official-Web user mapping;no dual-user isolation or arbitrary multi-service/multi-instance management was claimed.

## Explicit remaining boundaries

Preserved production legacy RelayRoom remains unchanged. Nine affected methods matched locally before repairs butemitFrame differs;local mesh fixes require careful adaptation and assembled-runtime/data-plane acceptance before deployment. Existing mixed historical observations are preserved. Independent WAN UDP/all historical clients,multiple live hosts,two distinct production network secrets and two real accounts were not tested this round. Standalone HTTP login returned403;main pages used the existing authenticated browser and official Web was checked internally.

The earlier successful generated-client IPv6 TCP/UDP,overlay HTTP andLAN HTTP acceptance remains prior evidence,not a new independent remote-client test. No firewall/OpenWrt change,credential rotation,new permanent test user,DO deletion,commit orpush occurred.

User report:/home/rick/Documents/Codex/2026-10-05/jie/outputs/EdgeTier全部功能Review报告.md. Screenshots in the same outputs directory. Per-reviewer reports and reproductions remain inresearch/ andfrontend-check-report.md.
