# Release EdgeTier 0.2.1

## Goal
Publish the accumulated DDNS/status and networking fixes to Git and the existing Cloudflare deployment, then validate actual networking, DDNS and service/config pages and correct any additional concrete failures.

## User authorization
The user explicitly requested pushing the new version to Git and cloud and testing for additional issues. This authorizes the necessary commit/push and production update; earlier root-private backup and resident Cloudflare credential authorization continues. Preserve the existing administrator credentials, mesh identity, official EasyTier Web bridge, namespace data and host configuration. No multi-user product redesign is requested.

## Requirements
- Patch version0.2.1, with a release note and consistent build/API/adapter version.
- Export the repaired modern RelayRoom while retaining legacy Directory/ConfigServerProbe and the official Web bridge. Compare the legacy emitFrame behavior in place; do not export preserved production source or credentials.
- Export the modern repaired room Durable Object, while retaining legacy authenticated public room/relay/default/login/bridge handlers. Protected host/profile routes first call authoritative legacy management authorization; bearer reports remain exempt. Convert authenticated room URI decoding failures to400 in the adapter.
- Keep current bindings/classes/migration state and collector configuration. Build a root-private release snapshot and a forward recovery option.
- Commit only intentional feature/review/release files, inspect the staged diff and prevent credentials or private source from entering Git. Preserve original user README/banner work.
- Push the current feature branch and patch tag to the existing repository; provide a reviewable PR if appropriate.
- Test real TCP/UDP joins and overlay/LAN HTTP, browser room/config/service flows, DDNS command acknowledgement, and bounded local multi-room/reconnect/queue regressions. Fix concrete additional failures.

## Acceptance
- [ ] Merged local tests/typecheck/proto/build and deployment assembly checks pass.
- [ ] Cloud0.2.1 runs repaired RelayRoom and preserves official bridge/host data/config.
- [ ] Actual live mesh and DDNS acceptance succeeds after release.
- [ ] Intentional source committed and pushed; remote branch/tag verified.
- [ ] Remaining capability limits and test bounds documented.

## Evidence
Previous review:.trellis/tasks/10-05-full-function-review. Current active Worker10fe67c5-c35b-433c-aee1-be32051fe160. Root legacy source:/var/backups/edgetier-rollout/20261005T111251Z/modules/index.js. Current19bindings and host-management-v1 migration. Nine legacy methods matched previous local source;emitFrame differed. Current171 TS and30 Python tests pass. EdgeTier single-admin and fixed official-Web UID2 remain declared product limits.
