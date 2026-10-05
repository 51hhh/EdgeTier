# OneCloud DDNS and EasyTier dashboard integration

## Goal
Integrate the running OneCloud IPv6 DDNS into the existing private EdgeTier dashboard, expose fresh host/service and mesh information, generate valid EasyTier configurations for the current mesh, and validate the live deployment and connectivity.

## Confirmed requirements
- Sync the latest published repository revision while preserving user README/assets changes.
- Add an authenticated DDNS page with current/confirmed IPv6, record settings, heartbeat age, failure history and an explicit refresh request with acknowledgement.
- Keep the OneCloud DDNS client as the only DNS writer for ip.ziyourufeng.eu.org; credentials remain on the host. Preserve the independent r720 DDNS service.
- Report fixed allowlisted OneCloud EasyTier core/web/config-server/tunnel/DDNS service status, node information and peers without reporting credentials.
- Use the actual current DDNS hostname and mesh profile in generated configurations; distinguish IPv6 direct reachability and tokenized WSS expiry.
- Verify a generated config against EasyTier 2.6.4 and live peer traffic; preserve the existing mesh identity and public service access.
- Deploy the verified dashboard/agent integration to the current private application.

## Current evidence
- GitHub master and local HEAD are 9eef078; HTTPS fetch completed, already up to date. SSH remote authentication fails.
- Local README files have user changes and assets/banner.png is untracked; do not overwrite or stage these.
- Current app is https://edgetier.ziyourufeng.eu.org/ with authenticated Worker assets and a live edgetier-worker peer seen from OneCloud.
- OneCloud is 192.168.1.45:2005, IPv6 2409:8a38:1a44:5630:9391:fe36:28e0:966b, direct hostname ip.ziyourufeng.eu.org AAAA only, TTL 120, DNS-only.
- Host DDNS writes locally through /usr/local/libexec/onecloud-ddns every two minutes; existing Cloudflare key is root-only. Domain ingress was confirmed by the user after disabling CPE IPv6 SPI.
- EasyTier home-mesh core is 2.6.4, virtual 10.144.1.1/24, LAN proxy 192.168.1.0/24, listening TCP/UDP 11010 IPv4/IPv6.
- Wrangler OAuth is expired and refresh fails. Obtain an authorized deployment path from existing host credentials without exposing them.

## Acceptance criteria
- [x] Authenticated DDNS/service read endpoints reject unauthenticated access; per-host ingest credentials cannot cross host identities or mutate DNS.
- [x] Reports are validated, persisted and ordered; stale/offline/error states are displayed honestly.
- [x] Refresh command is idempotent and only executes fixed host DDNS update, with pending/completed/failed state.
- [x] OneCloud live report is visible on the deployed page, and the independent r720 state is preserved.
- [x] Config generation uses live profile data and valid TOML without leaking credentials in logs or reports.
- [x] Real generated client joins mesh and transfers traffic; edge/host services and peers agree with live observations.
- [x] Typecheck, meaningful tests, build, proto drift checks, and browser UI verification pass.
- [x] Deployment and host rollback snapshots exist; operational notes and relevant specs are updated.

## Scope boundaries
The task does not rebuild OpenWrt, change the mesh network secret, open unrelated management ports, rewrite the official easytier-web config-server protocol, or repair the offline r720 server without access.

## Research references
See research/ for current official EasyTier and safe host-report/control patterns.
