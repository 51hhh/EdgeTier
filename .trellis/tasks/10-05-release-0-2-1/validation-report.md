# EdgeTier 0.2.1 release validation

## Scope and authorization

The user requested publishing the new version to Git and cloud and checking for additional functional failures. Existing authorization covers OneCloud root-private snapshots and resident Cloudflare credentials. The release preserves administrator credentials, mesh identity, host configuration, namespace data, the official EasyTier Web bridge and all 19 existing bindings. Original user README/banner work is excluded from the release commit.

## Local verification

The final source passed 185 Vitest tests in 27 files, 11 assembled-entry tests, 38 Python tests, TypeScript checking, protocol drift checking and Vite/Worker build with Wrangler dry-run. The compiled production adapter exports the modern repaired RelayRoom and HostState while retaining the preserved Directory, ConfigServerProbe and public/login/official-Web handlers. The existing frontend chunk-size warning remains nonfatal.

Credential scans printed no values. The final staged files were compared in memory with long credential values from local environment files; no matches were found. Production legacy source and Cloudflare credentials stayed on OneCloud. Ignored research, environment files, installed dependencies, build output and private acceptance configuration were not staged.

## Additional issue discovered and fixed

A real WSS-only join initially failed the overlay HTTP probe despite successful LAN HTTP. Paired room logs showed a packet forwarded through home-mesh and its reply sent through atm10-game. Both rooms had inherited the implicit public TCP gateway and the same edge peer identity. This let the gateway select a connection belonging to the wrong room.

The implicit EASYTIER_PUBLIC_PEER_TCP now applies only to the resolved default room; explicit per-room peer mappings retain their configured scope. Room alarms close obsolete implicit TCP connections even when the resulting peer list is empty. Regression fixtures reproduce the actual named-object arrangement. Gateway-to-Worker TCP connections settled at one, and the WSS client passed all HTTP probes twice after deployment.

## Production release

- Active Cloudflare version: b627f4e1-f07d-40bf-9d05-dd6e9feb7dd0, with 100% traffic.
- Release/API/adapter version: 0.2.1; relay implementation: modern.
- Modern bundle SHA-256: 4b8e74a33686f5fc4c495f3e73e3b3bba8eb4b906dd3ad44d2a347873409353b.
- Entry SHA-256: 0e8c3cdc397f0a88a5e620c4d94116386f2c29ca90645f969522f49f88e1c4c6.
- Root-private pre-release snapshot: /var/backups/edgetier-rollout/20261005T111251Z/release-0.2.1-20261005T131331Z.
- All 19 bindings and the existing lifecycle migration are preserved; no additional migration was introduced.
- Collector configuration bytes, file mode and modification time match the snapshot.
- Code-only deployment and the explicit forward-recovery adapter were validated; recovery preserves all required classes and namespace ownership.

## Live acceptance

Native EasyTier 2.6.4 clients with separate TCP, UDP and WSS configurations tested HTTP at 10.144.1.1:8123, 192.168.1.45:8123 and 192.168.1.1:80. Each transport returned HTTP 200 for all three targets. The WSS client had only a Cloudflare IPv4 WSS connection and repeated all three probes successfully after the fix. Temporary clients advertised no LAN subnet and used no TUN.

The DDNS refresh request was created at 2026-10-05T13:51:14.481Z, completed at 13:51:49Z and acknowledged to the dashboard at 13:51:52.986Z. The DNS-only AAAA for ip.ziyourufeng.eu.org matched the current global IPv6 address, with TTL 120. The browser showed the completed acknowledgement and current service observations.

Temporary clients, their private configuration, logs and process state were removed. A final check after cleanup confirmed five active units/timers: easytier-core-home.service, easytier-web.service, edgetier-home-cloudflared.service, onecloud-ddns.timer and edgetier-host.timer. The official EasyTier Web internal sessions endpoint returned HTTP 200 with two sessions.

## Verification bounds and retained capability limits

The native test clients ran on OneCloud; an independent external WAN UDP path was not tested. The WSS data path was actually relayed through Cloudflare, with no direct P2P client connection. Local multi-room/reconnect/queue/fragment regressions were tested, but two separately provisioned production accounts and distinct-secret production meshes were not created.

The product retains one administrator, official-Web UID 2, up to 16 configured hosts, one selected EasyTier instance per collector and four fixed monitored service units. This release does not implement account/role isolation or arbitrary service management. Temporary WSS credentials expire after five minutes and must be renewed for later reconnects.

## Git publication

The release source is ready for an intentional-files-only commit, followed by non-force publication to codex/onecloud-ddns-easytier and master and an annotated v0.2.1 tag. Remote publication and release links will be recorded after Git confirms them.
