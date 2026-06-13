# EdgeTier Worker Deployment Validation

Date: 2026-06-13

## Deployment

- Worker URL: `https://edgetier.zzhhh2005.workers.dev`
- Version ID: `6626fa34-4cad-419f-b7dd-b9be07b01fe3`
- Access model: EdgeTier-native admin session plus room-scoped short-lived WSS token.

## Local Gate

- `npm run typecheck`: passed
- `npm test`: passed, 51 tests
- `npm run proto:check`: passed against vendored EasyTier 2.6.4 proto
- `npm run build`: passed; Vite chunk-size warning only, Wrangler dry-run passed

## Local Max-Scope Addendum

After reconciling the three progressive EasyTier docs, the remaining safe Worker-side gap was Zstd-compressed RPC body decode. Cloudflare Worker still cannot implement TUN, UDP/P2P hole punching, native `easytier-core`, or a real L3 VPN data plane.

Local implementation added Zstd decompression for EasyTier `CompressionAlgo.Zstd` RPC bodies before `RpcRequest`/`RpcResponse` protobuf decode.

Post-change local gates:

- `npm run typecheck`: passed
- `npm test`: passed, 53 tests
- `npm run proto:check`: passed against vendored EasyTier 2.6.4 proto
- `npm run build`: passed; Vite chunk-size warning only, Wrangler dry-run passed

Additional dependency check:

- `npm audit --omit=dev`: failed on transitive `esbuild@0.27.3` from Vite/Wrangler advisories. This was not fixed in this protocol pass to avoid unrelated dependency churn.

Deployment note:

- This Zstd addendum was verified locally and by Wrangler dry-run, not redeployed during this pass. The live validation evidence below applies to the earlier deployed Worker versions.

## Online Route Checks

- `POST /api/auth/login`: `200`, session cookie issued
- `GET /api/health`: `200`, reports `easytier-peer-center` and `topology-api`
- `GET /dashboard/`: `200`
- `POST /api/rooms/<room>/token`: `200`, tokenized URI issued
- `GET /ws?room=<room>&token=<redacted>` WebSocket upgrade: opened successfully

## Real EasyTier Node Check

Test node:

- Host: `toe2-ubuntu24`
- EasyTier: `2.6.4-8428a89d`
- Config: temporary `/tmp/et-worker-test.toml`, redacted WSS URI and network secret

Observed at `t+15s`:

- `peerCount`: 1
- `websocketCount`: 1
- topology nodes: 1
- topology edges: 1
- decoded peer hostname: `toe2-ubuntu24`
- decoded NAT: `PortRestricted`
- decoded EasyTier version: `2.6.4-8428a89d`
- events included `handshake accepted` and `route sync RPC decoded`

Observed at `t+60s`:

- `peerCount`: 1
- `websocketCount`: 1
- topology nodes: 1
- topology edges: 1
- peer remained `connected: true`
- route sync RPC events continued without disconnect

Notes:

- Single-node validation did not emit PeerCenter `ReportPeers`; `peer_center` edge count stayed 0. The PeerCenter codec/response path is covered by unit tests and needs a two-node or PeerCenter-emitting scenario for end-to-end evidence.
- Temporary remote process was stopped after validation.

## Real Mesh Check

Source config:

- File: `/home/rick/下载/c0e49967-06d0-4c53-8c78-99099e2f6e65.toml`
- Network: `easytier`
- Worker secrets updated from this config: `EASYTIER_NETWORK_NAME`, `EASYTIER_NETWORK_SECRET`
- The original config was not modified. A temporary redacted test config was generated at `/tmp/et-real-worker.toml`.

Observed against deployed Worker version `6626fa34-4cad-419f-b7dd-b9be07b01fe3`:

- `room`: `easytier`
- `peerCount`: 1
- `websocketCount`: 1 at the `t+70s` API snapshot
- topology nodes: 1
- topology conn-bitmap edges: 2
- decoded peer hostname: `toe2-ubuntu24`
- decoded NAT: `PortRestricted`
- decoded EasyTier version: `2.6.4-8428a89d`
- `PeerCenterRpc.GetGlobalPeerMap` requests were decoded and answered.
- server-pushed `OspfRouteRpc.SyncRouteInfo` route updates were observed and throttled to avoid control-plane spam.

Notes:

- Local DNS/proxy resolved the workers.dev hostname to `198.18.0.42`, causing TLS EOF from local Node/curl. Online validation used `curl --resolve` with a Cloudflare edge IP. The EasyTier test node was still able to connect through the normal WSS hostname.
- The real mesh config's public tcp/udp peers repeatedly connected and dropped on the test machine. Worker WSS stayed online during the validation window.
- Temporary local and remote `/tmp` configs/logs containing the real network secret were removed after validation.

## Real `home-mesh` Full-Member Check

Source config:

- File: `/home/rick/下载/easytier-home-mesh-generic.toml`
- Network: `home-mesh`
- Worker secrets updated from this config: `EASYTIER_NETWORK_NAME`, `EASYTIER_NETWORK_SECRET`
- Temporary test config preserved the public TCP/UDP peers and added the Worker WSS peer with a short-lived room token. `no_tun = true` was used on the test machine.

Deployment versions validated:

- `5140f9c4-f5ec-4002-ac3a-0900bbf006b1`: active control-plane bootstrap added.
- `0af69cb8-63a5-4e1b-9a1d-d64557006011`: official RPC method indexes fixed (`OspfRouteRpc.SyncRouteInfo = 1`, `PeerCenterRpc.ReportPeers = 1`, `PeerCenterRpc.GetGlobalPeerMap = 2`).
- `dd8c357a-7a2a-4074-bd46-4b1bafa5aac9`: API snapshot includes the local `edgetier-worker` member so peer count matches EasyTier CLI's view.

Observed baseline from the test node before Worker route exchange completed:

- Existing `home-mesh` devices visible from `easytier-cli peer`: 4
- Devices: `toe2-ubuntu24`, `home-kwrt`, `rick-MRGF-XX`, `Xiaomi K80`
- The Worker WSS handshake was accepted as peer id `10000001`.

Observed after method-index fix against deployed Worker:

- Worker decoded `OspfRouteRpc.SyncRouteInfo` carrying 4 peer info items.
- Worker decoded `PeerCenterRpc.ReportPeers` and `GetGlobalPeerMap` requests and responded.
- Worker `/api/rooms/home-mesh` showed the real route peers with hostname, virtual IPv4, NAT type, and EasyTier version.
- Worker `/api/rooms/home-mesh/topology` showed 5 topology nodes including `edgetier-worker` and 11 edges during the clean validation window.
- Test node `easytier-cli peer` showed 5 peers including `10000001 edgetier-worker`.

Clean validation peer set:

- `10000001` `edgetier-worker`
- `496372248` `toe2-ubuntu24` `10.144.1.3/24`
- `1651819573` `home-kwrt` `10.144.1.1/24`
- `3924764032` `rick-MRGF-XX` `10.144.1.2/24`
- `577145542` `Xiaomi K80` `10.144.1.5/24`

Notes:

- Superseded by the later outbound TCP validation below: at this point Worker could not yet actively dial EasyTier peers. After `6a15c4e3`, Worker can actively dial normal `tcp://` peers, but still cannot dial `udp://`, do TCP/UDP hole punching, or run TUN/native `easytier-core`.
- Once a real node connects over WSS with the matching `home-mesh` secret, Worker is accepted as an EasyTier control-plane peer and can decode route/topology information from that bridged node.
- Repeated smoke tests with the generic config generated multiple temporary peer ids for `toe2-ubuntu24`; EasyTier retained a short-lived stale route entry, so a later smoke snapshot temporarily showed 6 peers. This was test churn, not a Worker decode issue. A persistent node should use a stable `instance_id`.
- Temporary local and remote `/tmp` configs/logs/tokens containing the real network secret or WSS token were removed after validation.

## Worker-Feasible B/C/D Follow-Up Check

Deployment version validated:

- `8e2be8b0-7244-47b5-852f-dbd0b4ce36a3`: route bitmap no longer fabricates full mesh, control state is persisted to DO storage, DO alarm heartbeat/TTL cleanup is enabled, topology API includes summary, `EASYTIER_NETWORKS` per-room config is supported, and session peer binding ignores post-handshake `EDGE_PEER_ID` rebinding attempts.

Online route checks after deployment:

- `POST /api/auth/login`: `200`
- `GET /api/health`: `200`
- `GET /dashboard/`: `200`
- `POST /api/rooms/home-mesh/token`: `200`

`no_tun=true` validation window:

- Test node connected to Worker WSS and remained online for 70s.
- Worker decoded PeerCenter requests/reports; topology summary reached 4 nodes / 3 PeerCenter latency edges.
- Worker received `OspfRouteRpc.SyncRouteInfo` with 0 peer info items. This validates WSS control-plane stability but not full RoutePeerInfo extraction; `no_tun=true` is not a reliable full-route validation mode for this mesh.
- No duplicate peer ids appeared after the session binding fix.

Full route validation window:

- Test node connected to Worker WSS and public TCP/UDP peers with the same `home-mesh` secret.
- At `t+45s`, `/api/rooms/home-mesh` reported `websocketCount=1` and no duplicate peer ids.
- `/api/rooms/home-mesh/topology` reported 9 nodes / 27 edges: 25 conn-bitmap edges and 2 PeerCenter latency edges, average latency about 174 ms.
- Real route peers included `home-kwrt`, `rick-MRGF-XX`, `Xiaomi K80`, and multiple `toe2-worker-validation`/`toe2-ubuntu24` entries from repeated validation runs.
- The extra `toe2` entries are EasyTier route-table residue from repeated temporary test instances, not a Worker decode or peer-binding error.

Security / cleanup notes:

- WSS token and network secret were only used from gitignored local files and temporary `/tmp` configs.
- The remote test process was stopped after evidence capture; temporary local and remote `/tmp` configs/logs/tokens containing secret material were removed.
- Cloudflare Workers still cannot run TUN/L3 data plane or dial UDP peers. Worker membership is achieved when a real EasyTier node initiates the WSS peer connection.

## Current HEAD Redeploy Smoke Check

Deployment version validated:

- `32b69a73-6004-4598-9f30-003582158b5e`: redeployed from clean `master` at commit `d0b9d73`.

Local/deploy gate:

- `npm run build`: passed; Vite chunk-size warning only, Wrangler dry-run passed.
- `npx wrangler deploy`: passed; no updated asset files, Worker deployed successfully.

Online route checks:

- `POST /api/auth/login`: `200`
- `GET /api/health`: `200`
- `GET /dashboard/`: `200`
- `POST /api/rooms/home-mesh/token`: `200`

Real `home-mesh` smoke window:

- Test node: easytier-core 2.6.4 on `toe2`, temporary WSS token and config.
- At `t+45s`, `/api/rooms/home-mesh` reported `peerCount=6`, `websocketCount=1`, and no duplicate peer ids.
- `/api/rooms/home-mesh/topology` reported 6 nodes / 16 edges: 14 conn-bitmap edges and 2 PeerCenter latency edges, average latency about 151 ms.
- Test node log showed Worker accepted as `dst_peer_id: 10000001` over WSS.
- Temporary local and remote `/tmp` configs/logs/tokens were removed after evidence capture.

## Outbound TCP Active Dial Validation

Deployment version validated:

- `6a15c4e3-3582-472d-9019-73b8147ed2ed`: Worker outbound TCP active dial implementation.

Local/deploy gate:

- `npm run typecheck`: passed.
- `npm test`: passed, 66 tests.
- `npm run build`: passed; Vite chunk-size warning only, Wrangler dry-run passed.
- `npm run proto:check`: passed.
- `npx wrangler deploy`: passed.

Configuration:

- Added Worker secret `EASYTIER_PUBLIC_PEER_TCP` from gitignored local env.
- Existing `EASYTIER_NETWORK_NAME` / `EASYTIER_NETWORK_SECRET` secrets were reused. Secret values were not printed or committed.

Online route checks:

- `POST /api/auth/login`: `200`
- `GET /api/health`: `200`, capabilities included `easytier-outbound-tcp`.
- `GET /api/rooms/home-mesh/outbound-tcp`: `200`
- `POST /api/rooms/home-mesh/outbound-tcp`: `200`

Outbound TCP evidence:

- Worker actively connected to the configured `tcp://` EasyTier public peer from Cloudflare using `cloudflare:sockets`.
- `/api/rooms/home-mesh/outbound-tcp` reported one configured peer with `connected=true`, `handshakeAccepted=true`, remote `peerId=1651819573`, and increasing rx/tx counters.
- Recent events showed decoded EasyTier RPC traffic after the outbound handshake, including `DirectConnectorRpc` and `UdpHolePunchRpc` control-plane packets.
- `/api/rooms/home-mesh` reported `peerCount=6`, `websocketCount=0`; the live session was `transportKind=tcp-outbound`.
- Worker appeared as `10000001 edgetier-worker` and the TCP outbound remote decoded as `home-kwrt` with virtual IPv4 `10.144.1.1/24`.
- `/api/rooms/home-mesh/topology` reported 6 nodes / 16 edges: 13 conn-bitmap edges and 3 PeerCenter latency edges, average latency about 199 ms.
- Decoded route peers included `home-kwrt`, `rick-MRGF-XX`, `Xiaomi K80`, and stale `toe2` validation entries from earlier test runs.

Updated conclusion:

- Cloudflare Worker can now join the EasyTier control plane by actively dialing a normal `tcp://` EasyTier peer.
- Cloudflare Worker still cannot dial `udp://`, perform TCP/UDP hole punching, run TUN, or carry L3 data plane traffic.

## UI Optimization Redeploy Smoke Check

Deployment version validated:

- `1f222bd7-bc86-4781-8983-aa3d3d79fde0`: redeployed from clean `master` at commit `c9c814b`.

Local/deploy gate:

- `npx vite build && npx wrangler deploy`: passed; three updated dashboard assets uploaded.
- `npm run typecheck`: passed.
- `npm test`: passed, 90 tests.
- `npm run build`: passed; Vite chunk-size warning only, Wrangler dry-run passed.
- `npm run proto:check`: passed.

Online route checks:

- `POST /api/auth/login`: `200`
- `GET /api/health`: `200`, capabilities included `easytier-outbound-tcp`, `topology-api`, `observer-api`, and `dashboard`.
- `GET /dashboard/`: `200`
- `GET /api/default-room`: `200`, default room/network `home-mesh`.
- `GET /api/rooms/home-mesh/outbound-tcp`: `200`
- `POST /api/rooms/home-mesh/outbound-tcp`: `200`
- `GET /api/rooms/home-mesh`: `200`
- `GET /api/rooms/home-mesh/topology`: `200`

Real `home-mesh` smoke window:

- Outbound TCP reported one configured peer with `connected=true` and `handshakeAccepted=true`.
- `/api/rooms/home-mesh` reported `peerCount=4`, `websocketCount=0`, and 50 recent events retained.
- `/api/rooms/home-mesh/topology` reported 4 nodes / 14 edges / 3 routes.
- Decoded hostnames included `edgetier-worker`, `home-kwrt`, `rick-MRGF-XX`, and `Xiaomi K80`.

Security notes:

- Admin credentials, relay tokens, and EasyTier secrets were read only from gitignored local env files.
- Validation output recorded only status codes and aggregate topology fields; no secret values or full tokens were printed or committed.

## Topology Graph Aggregation And Permanent `toe2` Node

Deployment version validated:

- `aa33f866-e03e-4ad7-956f-8750589430a8`: dashboard topology graph aggregation deployed to Cloudflare.

Local/deploy gate:

- `npm run typecheck`: passed.
- `npm test`: passed, 91 tests.
- `npm run proto:check`: passed.
- `npm run build`: passed; Vite chunk-size warning only, Wrangler dry-run passed.
- `npx wrangler deploy`: passed; three updated dashboard assets uploaded.

Dashboard/UI changes:

- The SVG topology graph now aggregates directed EasyTier edges into undirected display links by peer pair.
- Link display preserves source metadata (`conn_bitmap`, `PeerCenter`, or both), directed edge count, and averaged latency when present.
- The raw topology edge table remains unchanged and still shows the API's original directed edge records.
- A Vitest regression covers the graph-link aggregation helper.

Permanent `toe2` node setup:

- Installed `easytier-core` and `easytier-cli` 2.6.4 to `/usr/local/bin` on `toe2-ubuntu24`.
- Wrote `/etc/easytier/home-mesh.toml` with root ownership and mode `600`.
- Created and enabled `/etc/systemd/system/easytier-home-mesh.service`.
- Service status: `enabled` and `active`.
- Runtime evidence: `tun0` received `10.144.1.3/24`; EasyTier logged public-peer TCP/UDP connectivity and an additional UDP peer.

Online route checks:

- `POST /api/auth/login`: `200`
- `GET /api/health` with session cookie: `200`
- `GET /dashboard/`: `200`
- `GET /api/rooms/home-mesh`: `200`
- `GET /api/rooms/home-mesh/topology`: `200`

Real `home-mesh` smoke window:

- `/api/rooms/home-mesh` reported `peerCount=5`, `websocketCount=0`.
- Decoded hostnames included `edgetier-worker`, `home-kwrt`, `rick-MRGF-XX`, `Xiaomi K80`, and `toe2-ubuntu24`.
- `toe2-ubuntu24` decoded as peer `1311292540` with virtual IPv4 `10.144.1.3/24`.
- `/api/rooms/home-mesh/topology` reported 5 nodes / 23 directed edges / 4 reachable routes.
- The deployed graph aggregation reduces those live directed edges to 6 displayed peer-pair links.

Security notes:

- The EasyTier network secret and public peer URIs were read from gitignored local env files and written only to the remote root-owned EasyTier config.
- Validation output and this report omit secret values, relay tokens, and unredacted config contents.
