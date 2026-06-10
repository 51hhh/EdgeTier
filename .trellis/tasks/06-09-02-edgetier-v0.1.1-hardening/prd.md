# EdgeTier v0.1.1 Deployment Hardening PRD

## Summary

Harden the v0.1 deployable skeleton so it is clear, safer, and more usable for private Cloudflare testing. This task does not implement full EasyTier control-plane compatibility; it prepares the skeleton for deployment and real-node validation.

## Context

Current v0.1 state:

- Cloudflare Worker + Durable Object skeleton builds.
- Wrangler dry-run deploy passes.
- Dashboard uses React + Kumo, but only minimally.
- EasyTier protocol support is header parsing plus heuristic handshake/RPC observation.
- No production-readiness claim is allowed yet.

Roadmap source: `docs/roadmap.md`.

## Goals

1. Record deployment status and route expectations in stable docs.
2. Improve dashboard usability for empty/no-room/no-peer/no-event states.
3. Improve selected-room interaction and keyboard accessibility.
4. Add manual room lookup so users can inspect a known room before it appears in the directory.
5. Avoid stale room summaries being treated as active indefinitely.
6. Strengthen tests around current skeleton behavior where practical.
7. Preserve the boundary that EdgeTier is observer/relay skeleton, not child-node manager or full EasyTier control plane.

## Non-Goals

- Do not implement official protobuf decode yet.
- Do not implement full `OspfRouteRpc` or `PeerCenterRpc` yet.
- Do not add gateway-agent.
- Do not add child-node management UI.
- Do not implement production OAuth/multi-user system in this task.
- Do not deploy to Cloudflare from this task.

## Required Work

### Documentation

Update docs/README to make the current status explicit:

- v0.1.1 is for private Cloudflare testing.
- `npm run build` performs Vite build and Wrangler dry-run.
- Basic deployment command sequence is documented:
  - `npm install`
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
  - `npx wrangler login`
  - `npx wrangler deploy`
- Document the route surface:
  - `/ws?room=<room>`
  - `/api/health`
  - `/api/rooms`
  - `/api/rooms/:roomId`
  - `/dashboard/`
- Explicitly state that real EasyTier compatibility requires v0.1.2/v0.1.3 work.

### Observer API and Directory

Improve stale directory handling:

- Add a TTL or active-room filter for `Directory` summaries.
- `/api/rooms` should not present old room summaries as active indefinitely.
- If inactive rooms remain available, mark them clearly as stale/inactive.

Possible contract:

```typescript
interface DirectoryRoomSummary {
  roomId: string;
  peerCount: number;
  websocketCount: number;
  bytes: number;
  lastActivity?: string;
  active?: boolean;
}
```

Do not expose secrets.

### Dashboard UX

Improve `src/dashboard/app.tsx` and CSS while keeping the dashboard read-only.

Required UX changes:

1. No rooms state:
   - Display a visible empty state explaining no rooms have been observed yet.
   - Keep allowing manual lookup for a known room.
2. Manual room lookup:
   - Add input + button for room id.
   - Validate/use server response safely.
3. Selected room affordance:
   - Room selection should be keyboard-accessible.
   - Avoid `onClick` directly on `<tr>`; use a button or Kumo primitive inside the row.
   - Add selected styling.
4. No peers/events states:
   - Render explicit empty messages instead of silent empty tables.
5. Event readability:
   - Use Kumo `Badge` for event types.
   - Distinguish error/limit/unroutable visually enough for v0.1.1.
6. Error behavior:
   - API errors should display without clearing previous successful data.
7. Preserve Kumo usage and improve it where practical without overcomplicating.

### Tests

Add meaningful tests for current behavior where practical.

Minimum:

- Keep existing packet tests passing.
- Add tests for room name validation if not already covered.
- Add tests for stale/active room summary logic.
- Add tests for dashboard helper utilities if extracted.

Integration tests for full WebSocket Durable Object behavior are desirable but not required if the local test harness is not ready.

## Acceptance Criteria

- `docs/roadmap.md` exists and is linked from README.
- Documentation describes current deployability and limitations honestly.
- `/api/rooms` no longer presents stale room summaries as active indefinitely.
- Dashboard has explicit no rooms/no peers/no events states.
- Dashboard has manual room lookup.
- Room selection is keyboard-accessible and visually selected.
- Event types use Kumo badges or equivalent accessible labeling.
- No mutation/management controls are added.
- `npm run typecheck` passes.
- `npm run test` passes.
- `npm run build` passes.
- `npm run proto:check` passes.

## Risks and Notes

- Authentication is a product/security decision. If not implemented in this task, docs must clearly recommend Cloudflare Access or private testing before public exposure.
- Real EasyTier protocol compatibility remains future work.
- Directory TTL behavior must not delete useful historical information silently unless the design says so; v0.1.1 can simply filter/mark active summaries.
