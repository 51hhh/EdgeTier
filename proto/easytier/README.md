# EasyTier Proto Tracking

Target source of truth: official EasyTier repository checked out under `research/github/EasyTier`, version 2.6.4-era source used during real-node integration testing.

Tracked files:

```text
common.proto
error.proto
peer_rpc.proto
```

EdgeTier intentionally does not vendor stale community relay protobuf output as source of truth. The current runtime uses a small TypeScript protobuf codec for the EasyTier fields needed by Phase B/C (`RpcPacket`, `RpcRequest`, `SyncRouteInfo`, `RoutePeerInfo`, `RouteConnBitmap`, and handshake). A generated `protobufjs` binding can replace that codec later if dependency and bundle size tradeoffs are acceptable.

Drift check:

```bash
npm run proto:check
```

This compares the tracked local proto files with `research/github/EasyTier/easytier/src/proto/`.

Do not log or expose full network secrets or full secret digests in generated observers.
