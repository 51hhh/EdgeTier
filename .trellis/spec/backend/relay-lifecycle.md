# Relay lifecycle and route convergence

## Scope

Apply to `src/durable-objects/relay-room.ts`, its class-level regressions and relay control-state storage. The assembled deployment adapter determines which RelayRoom implementation runs in production. Verify that export and runtime before interpreting local checks as live evidence.

## Room ownership

- One RelayRoom owns exactly one validated room ID. Resolve the named object ID first, otherwise use the explicitly persisted `roomId`, otherwise durably claim the first valid internal room request. Await storage initialization and any pending first claim before fetch or alarm processing. A failed first claim rolls back; concurrent same-owner requests wait for that write.
- Persist the owner in `control-state:v1`; reject an internal query for another room with 409. Only the owner's configured peers can be dialed by that object's alarm.
- Legacy `outboundRoomIds` may contain every configured room. Never use that list or the global configuration enumeration as ownership evidence. An old unnamed object without an explicit owner waits for a valid room request before dialing.
- Preserve unscoped or mismatched-owner legacy observations as unconfirmed history. Persist `unconfirmedRoutePeerIds`, `unconfirmedConnPeerIds` and `unconfirmedPeerCenterIds` before constructor pruning can write a new owner. Withhold that history from route/PeerCenter announcements and own-prefix projections until fresh room updates confirm it. Ordinary TTL expiry can prune unconfirmed history even if a new live source reuses an old source ID; do not reset storage or rotate mesh identity.
- Keep defensive same-room checks on directed forwarding and control-plane broadcasts.
- `EASYTIER_PUBLIC_PEER_TCP` is an implicit single-network bridge for `resolveDefaultRoomConfig(env).roomId` only. It must not be appended to unmapped alias rooms: native EasyTier treats same-peer connections as interchangeable, while separate objects have different return-path session maps. Preserve explicit `EASYTIER_OUTBOUND_TCP_PEERS` mappings for other configured rooms.
- An owning object alarm must ensure its peer configuration even when empty, so removed/disabled outbound connections are closed rather than left active until an API read.

## Live peer connections

- Configured networks establish peer identity only after a matching handshake. Pre-handshake Data/RPC/Ping must not replace a valid routing entry. Retain the deliberate secretless observer mode separately.
- Multiple accepted transports for one peer may overlap. Route through the current mapped transport; when it leaves, select an accepted, open survivor in the same room. Preserve peer topology and source-route state while that peer still has an accepted live transport.
- Retire a session synchronously before closing its transport, clearing pending RPC state/mergers and the session key reference. Recheck activity after asynchronous crypto before sending or applying an RPC. Queued work checks that it is still registered, open and not retired. Late close/error callbacks are idempotent.
- TCP retirement and read termination abort the writer and close the socket together through an idempotent close path. Reject TCP frames above the native 2000-byte payload limit before queue reservation; encrypted multipart RPC sends must still fit that limit.

## Owner versions and storage

Store connection information by owner:

```typescript
interface ConnectionRow {
  peerId: number;
  version: number;
  connectedPeerIds: number[];
  lastSeen: string;
  sourcePeerId?: number;
}
```

- The first fresh room update can replace an unconfirmed legacy record even with a lower genuine version. For confirmed RoutePeerInfo and connection rows, merge only when the incoming owner version is greater than the stored version. A partial update preserves other owners' rows. A greater owner version with no connections removes that owner's previous connections.
- Preserve imported protobuf fields and owner versions through persistence and re-encoding. EdgeTier authors the version and adjacency for its own row only; it does not manufacture newer foreign rows or reverse foreign links.
- Store optional `roomId` and `connRows` alongside existing `control-state:v1` fields. No new Durable Object binding/migration is required for these additive fields.
- Old edge-only records remain visible with owner version zero until a genuine owner update arrives. Do not stamp them with EdgeTier's version. Keep prior observer edges even if an old record omitted `connBitmapPeerIds`.
- Keep owner rows while the owner or source peer is live; otherwise apply relay TTL cleanup and persist the resulting state.

The merge rule follows the official [EasyTier 2.6.4 OSPF implementation](https://raw.githubusercontent.com/EasyTier/EasyTier/v2.6.4/easytier/src/peers/peer_ospf_route.rs).

## Queued frames and RPC retention

- Reserve frame count and byte count before retaining an inbound event or outbound frame. Limits apply independently to read/write queues: 64 frames / 2 MiB per session and 512 frames / 8 MiB per room.
- Exceeding a per-session budget retires that overloaded session. Exceeding an aggregate room budget drops the current frame with a limit event and preserves an otherwise healthy connection. Pending jobs release accounting in `finally`, and jobs after retirement do not send. Other peers continue when their queues fit the remaining room budget.
- A directed packet increments `forwardedPackets` only after the transport write succeeds. Failed/rejected/cancelled directed writes count as unroutable; successful transport write does not imply end-to-end delivery acknowledgement.
- Route RPC snapshots carry `sentAt`, expire after 5 seconds, and are capped at 8 per session. Reserve the pending entry before awaiting transmission to bound simultaneous pushes. Late or unmatched acknowledgements do not commit saved versions; timely acknowledgements after cleanup still work.
- Incomplete fragment mergers are capped at 32 per session and expire after 30 seconds. Heartbeat maintenance prunes them even when no new fragments arrive.

## Required regressions and gates

`relay-room-lifecycle.test.ts` exercises actual class behavior with mock Durable Object storage and transports. Required cases are named owner/first-request owner/restart, polluted legacy room lists, negative cross-room forwarding, oldest/newest overlap disconnects, failed and matching handshakes, stale and partial owner rows in list/bitmap encodings, valid edge removal, row-version restart persistence, frame/byte/room queue budgets, TCP writer retirement and accounting release, timeout cleanup followed by a timely RPC acknowledgement, and idle fragment expiry.

Run `npm run typecheck`, the complete test suite, the Vite/Worker dry-run build and `npm run proto:check`. Before applying these changes to preserved legacy production, adapt and test that actual assembled runtime, including its transport error and MTU behavior. Local fixture and build checks are release preparation, not live data-plane evidence.
