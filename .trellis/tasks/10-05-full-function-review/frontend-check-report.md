# Frontend self-check and corrections

Date: 2026-10-05. Scope: dashboard room selection, asynchronous token/profile operations, partial host availability, peer truncation and systemd display. No production, SSH, credential or relay-source operations were performed by this agent.

## Fixed

- U1 room identity: `App` clears previous room snapshot/URI/error when selection changes and every consumer uses `roomForSelection`. Same-room failures retain useful cached data. Room, topology and outbound response IDs must match the selected request before installation.
- Late token responses: reusable selection revision tickets reject requests that cross a selection change, including A -> B -> A. Devices token issuance and ConfigGenerator token/clipboard completions use the guard. Cleanup invalidates tickets, setup restores identity through React effect replay.
- Partial host reads: an unavailable placeholder can reuse prior observations only for an unchanged host/room/network/hostname/port identity. Availability takes precedence over fresh/never labels. Host controls are disabled and direct export is blocked. Successful hosts/profiles keep updating independently. Entire endpoint failures mark cached results unavailable immediately; recovery removes the error marker.
- Truthful truncation: `easytier.truncated` produces a partial-details notice. Positive `omittedPeers` shows the exact omitted count; a truncated empty list no longer says there are no mesh peers.
- Service enablement: label is `持久启用` / `Persistently enabled` and optional raw `unitFileState` appears separately. The collector/backend owns permanent-enable boolean semantics.
- Relevant frontend executable contracts were updated. Static IPv4 uniqueness is explicitly an operator responsibility; the parser validates syntax/prefix.

## Verification

- Focused Vitest: 4 files, 23 tests passed, including 15 new regressions. Tests cover deferred late responses, A -> B -> A, effect cleanup/replay, cross-room snapshot rejection, partial-host failure/recovery/identity changes, direct-profile blocking and rendered control disabled attributes/truncation notices.
- TypeScript `npm run typecheck`: passed.
- `npm run build`: passed Vite and Wrangler dry-run. Existing >500kB chunk warnings remain nonfatal.
- `git diff --check`: passed.

## Remaining verification boundary

The parent performs complete merged gates, actual browser QA and production release. SSR component tests confirm output/control semantics but do not replace browser event/polling validation. Mesh P1/P2 findings remain separate; no RelayRoom fix was attempted in this frontend-only check.
