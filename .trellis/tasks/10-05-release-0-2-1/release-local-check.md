# 0.2.1 local release checks

## Owned changes

- `package.json`, root `package-lock.json` version and root lock package now read 0.2.1.
- Modern `/api/health` reports 0.2.1, with a regression retaining relay/host/DDNS/profile capabilities.
- Added `test:assembly` invoking `node --test deploy/onecloud/test_edge_extension.mjs` and exact devDependency `esbuild:0.27.3`, matching the installed compiler. An offline lock-only update changed no existing dependency versions and added no new package entries; it did not reinstall dependencies.
- Added `docs/releases/0.2.1.md` describing accumulated fixes, upgrade/recovery requirements, verification boundaries and retained product limits.

## Focused verification

Eleven files / 65 tests passed across the health/auth gate, host report validation/API/state, independent host availability, service rendering, client configuration/download and room selection guards. Typecheck and `git diff --check` passed. No additional concrete host/export regression was found; no new host changes were needed for this release pass. The assembled-entry package gate passed all 10 tests with the actual modern module and a synthetic legacy fixture, covering class/namespace preservation, legacy management and Access gates, cookie compatibility, report bearer separation, bridge/fallback routes and combined 0.2.1 health. The full release build remains coordinated by the parent; this reviewer did not repeat it.

Partial failure was inspected end to end: unreadable host placeholders carry explicit errors, cached matching-host reports stay visibly stale, controls/direct exports are blocked, healthy hosts still update and recovery clears errors. WSS-only export remains an explicit choice using independently scoped/expiring credentials. Provider confirmation, IPv6 direct peers and token room/network/expiry checks are retained at export.

## Credential scan

A values-suppressed scan covered 131 intentional source/spec/task files. Environment files, private research/backups, runtime/build directories and dependencies were excluded without reading them. It checked credential-key literals, credential-bearing/tokenized URIs, Bearer literals, private-key markers and common access-token/JWT shapes. No unresolved credential candidates were found. The candidate in `src/dashboard/i18n.ts` was classified as a translated UI label. Only filenames/types were printed or saved; no candidate values were printed or persisted.

This records the inspected local snapshot; the parent reviews the final staged source and assembly before publishing.

## Staging recommendation

Use the explicit path list under the release task's ignored research directory, regenerating it after adapter/assembly changes. It includes intentional package/Worker/dashboard/host/collector/relay changes, related specs/task records and the release note. Include the assembled-entry fixture once its owner has completed it. Exclude original user work: `README.md`, `README.zh-CN.md`, `assets/banner.png`. Those remain unstaged/untracked at this check point. Do not stage environment files, ignored research/private backups, build outputs, installed dependencies or Python caches.

No source was committed/pushed and no Cloudflare, SSH, live DNS or systemd operation was performed by this reviewer. The collector remains version 1.0.1 as documented; EdgeTier package/API/adapter release version is 0.2.1.
