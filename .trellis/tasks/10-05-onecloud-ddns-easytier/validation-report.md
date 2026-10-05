# Deployment and live acceptance

Date:2026-10-05. Feature version0.2.0. GitHub master9eef078 was fetched twice and fast-forward verified; existing user README/assets edits were preserved. No commit or push was performed.

## Passed

- Typecheck,23Vitestfiles131tests,Python22tests,proto drift,production build+Worker dry-run,diff whitespace check.
- Real EasyTier2.6.4 generated client joined the existing gateway with IPv6 TCP/UDP; listeners=[] produced only the internal ring, virtual address was the chosen distinct test address.
- Overlay Web returnedHTTP200 and5463bytes. Original LAN Web failed; gateway ET_USE_SMOLTCP=true restored gateway LAN serviceHTTP200 and routerHTTP200/9742bytes. Restarted client passed both again. Host UFW policy was not broadened.
- Stable ET_INSTANCE_NAME=home-kwrt works with collector -n after restart; raw protobuf peer IPv4 now renders correctly.
- Deployed extension preserves existing v2 RelayRoom/Directory/ConfigServerProbe and16existing bindings. NewHostState was the only lifecycle creation; subsequent code-only release retained19bindings and omitted migrations.
- Host timer enabled, live report acknowledged, persistent private DDNS/service pages displayed real fresh observations after authenticating with the user's supplied existing admin credentials. Secrets are not in reports or this file.
- First direct-writer refresh collided with the existing timer lock and correctly showedfailed. Corrected fixed systemctl start onecloud-ddns.service coalesces concurrency; real request completed at11:33:43UTC and completion survived later reports and code-only redeployment.
- Browser generated valid profile-based TOML; explicit clipboard fallback reported success and clipboard was restored. Download link creation/30second lifetime has meaningful regression tests.
- Temporary client, private test config/logs were removed. Cloudflare key never copied from OneCloud. Backup/source/settings are root-only on that host.

## Bounds

- IAB did not emit a download event or provide a downloaded path. Do not claim downloaded file persistence from this tool. Generated TOML and manual copy are verified; normal browser download handler remains a separate UI limitation.
- The generated client test was local to the host. External Cloudflare Worker IPv6 TCP was observed, but independent WAN UDP and every historical client were not validated.
- Git checkout still predates the deployed official web bridge. Root-local legacy module assembly is intentional; a bare old-source deployment would drop those integrations. Documented safe adapter is required until source/history is reconciled.
- DO lifecycle creation prevents ordinary pre-migration version rollback. Forward recovery must retain HostState and its data; recovery source/snapshots are available remotely. No destructive rollback was attempted on the healthy release.

## Operational records

Updated Obsidian EdgeTier/DDNS/home-mesh/OneCloud notes and network MOC. User-facing report and screenshots reside in this task outputs. Root backup path and recovery boundaries are documented there; no auth credentials are included.
