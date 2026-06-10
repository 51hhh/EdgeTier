# EasyTier Proto Tracking

Target source of truth: official EasyTier repository, master/v2.6.4-era or later release selected during integration testing.

v0.1 intentionally ships only lightweight packet-header parsing plus RPC/handshake observation scaffolding. It does not vendor stale community relay protobuf output and does not claim full EasyTier control-plane compatibility.

Sync plan:

1. Select an official EasyTier release tag for compatibility testing.
2. Copy official `.proto` files from `research/github/EasyTier/` into this directory, preserving paths.
3. Generate TypeScript protobuf bindings in a dedicated build step.
4. Add a drift check comparing this directory against the selected official EasyTier tag before releases.

Do not log or expose full network secrets or full secret digests in generated observers.
