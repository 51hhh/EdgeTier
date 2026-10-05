# Full EdgeTier function review

## Goal
Review the current deployed application and local code across networking, DDNS, multiple services, configuration generation and multiple-user/identity boundaries. Produce evidence-based prioritized findings, fix concrete regressions without rebuilding the product, and document verified versus unsupported functionality.

## Scope
- Inventory local code versus the preserved deployed v2 module; distinguish modern and legacy routes/classes.
- Authentication/session/token, room/network/host isolation, EasyTier Web user mapping and service bridge permissions.
- Mesh handshake/forwarding/RPC/peer topology, reconnection, persistent state, multiple rooms/peers, meaningful data-plane evidence.
- DDNS host ingestion/ordering/freshness, fixed command lifecycle, timers/retry/crash behavior, multiple-host/domain limitations.
- UI/service configuration contracts, client export, errors/staleness and secret handling.
- Deployment reproducibility, preservation of bindings/classes/data and recovery.

## Boundaries
Use existing authorization for read-only production/OneCloud inspection, private backups and safe fixes. Do not reset credentials, create permanent public test users, broaden firewall policy, delete DO state, rotate mesh identity, disrupt all services or implement a new multi-tenant product without explicit scope. Preserve user README/assets and existing uncommitted work. No commit/push.

## Acceptance
- [x] Current function and identity matrix includes positive and negative cases.
- [x] Findings have priority, concrete source references and reproducible evidence; existing feature limits are not mislabeled implementation vulnerabilities.
- [x] Multi-user and multi-room isolation assessed against actual deployment, not inferred from one-admin happy path.
- [x] Concrete fixes include meaningful regressions and sufficient checks.
- [x] Production mesh/DDNS/services remain healthy; destructive scenarios use isolated local fixtures.
- [x] Report documents limits and remaining product decisions.

## Context
Previous task .trellis/tasks/10-05-onecloud-ddns-easytier contains release/runbook/evidence. Production0.2.0 preserves v2 legacy RelayRoom/Directory/ConfigServerProbe and old service APIs, while modern handles hosts/profiles. Local Git master9eef078 lacks some legacy source. Root backup remains OneCloud-only. Current private deployment and root SSH are already authorized. Secrets must never be printed or copied into review artifacts.
