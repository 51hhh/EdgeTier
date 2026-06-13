# EdgeTier 完整网络成员 / 路由反射器 PRD

> 交接文档。面向没有此前对话上下文的实现 agent。读完即可独立接手 Phase B/C/D。
> 配套阅读:`docs/easytier-protocol-integration-plan.md`(可行性与复用映射)。

最后更新:2026-06-13 · 当前 commit:`3c89744` + 本轮 Worker-feasible 改动(未提交,已部署验证版本 `8e2be8b0-7244-47b5-852f-dbd0b4ce36a3`) · package version `0.1.1`

---

## 0. 一句话目标

让部署在 Cloudflare Workers 上的 EdgeTier **作为持有 network_secret 的 EasyTier 网络成员 / 路由反射器**,
解密控制平面,解出整网信息(设备、虚拟 IP、NAT、拓扑、延迟),在只读面板上展示。
**不需要 TUN**(shared node 只参与控制平面 + 转发,不终结三层流量)。

**边界决策(已由项目所有者确认)**:EdgeTier 会持有 network_secret 并解密整网控制流量,
从"零知识中继"升级为"完整网络成员"。network_secret 必须按网络存为 Worker secret,
绝不进版本库、绝不在 dashboard/API 明文回显;仅用于所有者自有的网络。

---

## 1. 当前状态(已完成且已验证)

部署地址:`https://edgetier.zzhhh2005.workers.dev`(Cloudflare account zzhhh2005@gmail.com)。
质量门禁命令:`npm run typecheck` / `npm test`(40 tests)/ `npm run build`(Vite + wrangler dry-run)/ `npm run proto:check`。

| 能力 | 状态 | 提交 | 关键文件 |
|---|---|---|---|
| 私有部署 + Worker 原生鉴权(session cookie + room-scoped WSS token) | 已部署 | `c083117` | `src/worker/auth.ts`, `src/worker/index.ts` |
| 多页面 Kumo 面板(Overview/Devices/Logs/Config)+ EasyTier 配置生成器 | 已部署 | `01a0837` | `src/dashboard/app.tsx`, `src/dashboard/components/*`, `src/dashboard/easytier-config.ts` |
| 二进制帧解析修复(`server.binaryType='arraybuffer'`) | 已部署 | `b7608b7` | `src/durable-objects/relay-room.ts` |
| 测试数据注入接口(`POST /api/rooms/:id/test-seed`,session 守护) | 已部署 | `bae780e` | `src/durable-objects/relay-room.ts`, `src/observer/api.ts` |
| **EasyTier 加密原语**(SipHash KDF + AES-GCM/WebCrypto)对齐 Rust 2.6.4 + 真机 | 已验证 | `c405173` | `src/easytier/crypto.ts` (+`crypto.test.ts`) |
| **握手编解码** + 真机端到端验证(握手成功 + 解密真实 RPC) | 已验证 | `9d02622` | `src/easytier/handshake.ts` (+`handshake.test.ts`, `realtraffic.test.ts`) |
| **RPC/route/PeerCenter decode + topology observer** | 本地已实现 | `3c89744` | `src/easytier/rpc.ts`, `src/durable-objects/relay-room.ts`, `src/observer/types.ts`, `src/dashboard/components/Topology.tsx` |
| **W2/W3/W4/W6 Worker-feasible hardening** | 已部署验证 | 工作区 / Worker `8e2be8b0` | route push/broadcast bitmap 修正、DO storage/alarms、topology summary DTO、`EASYTIER_NETWORKS`、peer-id rebind 防护 |

### 1.1 真机端到端已验证的事实(Phase A 打通)

用真实 easytier-core 2.6.4 节点验证(测试机 + 本机 LAN 应答服务器):
1. 真节点发 HandshakeRequest;其 `network_secret_digest` 与 `generateDigestFromStr(network_name, secret)` **字节一致**。
2. EdgeTier 风格握手响应被真节点**接受**(`new peer added peer_id=10000001`)。
3. 真节点随后发加密 RpcReq(`flags=1`)。
4. `deriveKeys(secret).key128` + WebCrypto AES-GCM **成功解密**,明文为 `OspfRouteRpc.SyncRouteInfo`,
   含 `home-mesh` / hostname `toe2-ubuntu24` / 版本 `2.6.4-8428a89d` / peerId / 路由信息。

→ "EdgeTier 能解出组网全部信息"已是被真实节点验证的事实,不再是猜想。

### 1.2 当前 EdgeTier 运行模型

- `/ws?room=<room>&token=<jwt>`:WSS 接入,token 由 `RelayRoom` 上游的 worker 鉴权。
- `RelayRoom`(Durable Object):维护 WS 会话、按 16 字节包头 `toPeerId` 定向转发、记录事件/流量,
  解析握手、解密 RPC、解码 SyncRouteInfo/PeerCenter,响应 RPC,主动 route push/broadcast,并用 DO storage/alarms 持久化和清理 route/PeerCenter 观测状态。
- `Directory`(DO):房间目录,带 recent-activity TTL(active/stale)。
- observer API(`src/observer/api.ts`):`/api/health` `/api/rooms` `/api/rooms/:id[/peers|events|traffic|topology|token|test-seed]`。
- 面板:Devices/Overview/Topology 显示真实 RoutePeerInfo、conn bitmap、PeerCenter latency summary;seed 数据仅作显式测试开关。

**剩余局限**:Worker 仍不能主动拨 UDP、不能 TUN/L3、不能做 EasyTier TCP/UDP 打洞;但已可用 `cloudflare:sockets`
主动拨普通 `tcp://` 公共 peer 并作为控制面成员入网;部署版 `6a15c4e3-3582-472d-9019-73b8147ed2ed`
已完成 `home-mesh` live evidence。尚缺压缩 route 表真机向量、断线 cleanup 长测、DO 重启/休眠、per-room secret 隔离验证。

### 1.3 本轮部署验证补充(2026-06-13)

部署版本:`8e2be8b0-7244-47b5-852f-dbd0b4ce36a3`。

- 线上 `/api/health`、`/dashboard/`、`POST /api/rooms/home-mesh/token` 均返回 200。
- 测试机 easytier-core 2.6.4 使用 `home-mesh` 配置拨入 Worker WSS;真实节点日志显示 `dst_peer_id: 10000001`,Worker 作为 `edgetier-worker` peer 被接受。
- 非 `no_tun` 完整 route 场景下,Worker API 显示 `websocketCount=1`,无重复 peer id;Topology summary 为 9 nodes / 27 edges,其中 conn bitmap 25 edges、PeerCenter latency 2 edges。9 个节点里包含多次测试产生的短期 stale `toe2-worker-validation` peer,不是 Worker 解码错误。
- `no_tun=true` 场景可验证 WSS 长连和 PeerCenter,但收到的 `OspfRouteRpc.SyncRouteInfo` 为 0 个 peer info;该模式不适合作为"全量 RoutePeerInfo"验收。
- 修复了真实验证暴露的 session 绑定问题:握手后不再用后续控制包的 `header.fromPeerId` 重绑 session,避免临时显示为 `EDGE_PEER_ID`。

---

## 2. 已知协议信息(无需重新调研)

### 2.1 包头(16 字节,小端) — `src/easytier/packet.ts` 已实现
```
fromPeerId u32 | toPeerId u32 | packetType u8 | flags u8 | forwardCounter u8 | reserved u8 | len u32
```
- `flags` bit0 = 已加密(1=加密);bit1 = latency_first。
- PacketType(`src/easytier/constants.ts` 已定义):Invalid=0, Data=1, **HandShake=2(不加密)**, RoutePacket=3,
  **Ping=4, Pong=5**, TaRpc=6, Route=7, **RpcReq=8, RpcResp=9**, ForeignNetworkPacket=10, KcpSrc=11, KcpDst=12。

### 2.2 握手 — `src/easytier/handshake.ts` 已实现并验证
proto(权威:`research/github/EasyTier/easytier/src/proto/peer_rpc.proto:310`):
```proto
message HandshakeRequest {
  uint32 magic = 1;            // EASYTIER_MAGIC = 0xd1e1a5e1
  uint32 my_peer_id = 2;
  uint32 version = 3;          // EASYTIER_VERSION = 1
  repeated string features = 4;  // 真节点 2.6.4 不带此字段
  string network_name = 5;
  bytes network_secret_digest = 6;  // = generateDigestFromStr(network_name, secret, 32)
}
```
流程:client→server HandshakeRequest(type 2)→ server→client HandshakeRequest 响应 → 之后加密 RPC。
响应构建见 `buildHandshakeResponse()`。EDGE_PEER_ID = 10000001。

### 2.3 加密 — `src/easytier/crypto.ts` 已实现并验证
- KDF:Rust std `DefaultHasher` = **SipHash-1-3 keys(0,0)**,增量 write + big-endian finish。
  `get_128_key`/`get_256_key` 见 `research/github/EasyTier/easytier/src/common/global_ctx.rs:548`。
  256 位加盐 `"easytier-256bit-key"` + 索引。`deriveKeys(secret) → {key128, key256}`。
- AES-GCM:payload tail = `tag(16) || nonce(12)` 追加在密文后,**空 AAD**。
  见 `research/github/EasyTier/easytier/src/peers/encrypt/aes_gcm.rs`(StandardAeadTail)。
- **默认密钥是 key128**(真机加密 RpcReq 用 key128 解开)。WebCrypto `crypto.subtle` AES-GCM 与之互通(已证)。
- `generateDigestFromStr(s1, s2, len=32)`:握手 digest。

### 2.4 RPC 与"组网全部信息"(Phase B 要解的)
RpcReq=8 / RpcResp=9 的 body(加密)解密后是 `common.RpcPacket` → 内含 `RpcRequest`/`RpcResponse` → 按
`descriptor.serviceName` 分派。proto 在 `research/github/EasyTier/easytier/src/proto/peer_rpc.proto` 与 `common.proto`。

- **OspfRouteRpc.SyncRouteInfo**(`SyncRouteInfoRequest`):
  - `RoutePeerInfo[]`:`peer_id / ipv4_addr / ipv6_addr / hostname / udp_stun_info(NatType) / cost /
    proxy_cidrs / version / easytier_version / peer_route_id / network_length` —— **整网节点信息(含虚拟 IP)**。
  - `RouteConnBitmap`:peer 连接位图 —— **拓扑边**。
  - `RouteForeignNetworkInfos`:跨网络信息。
- **PeerCenterRpc**:`ReportPeers`(上报 directPeers+latency)/ `GetGlobalPeerMap`(`GlobalPeerMap`,含 `DirectConnectedPeerInfo.latency_ms`)—— **P2P 延迟图**。
- RPC body 可能 Zstd 压缩(`compressionInfo.algo = 2`)—— 需用 Worker 兼容的 Zstd 解压;不可按 gzip/node:zlib 处理。

### 2.5 参考实现(research/github,已克隆)
- **`cf-workers-et-ws/`** —— 最完整的 JS 版 EasyTier CF Worker 服务端。直接参考/移植:
  `src/worker/core/`: `crypto.js`(已移植)、`packet.js`、`constants.js`、`basic_handlers.js`(握手/Ping/转发)、
  `rpc_handler.js`(**SyncRouteInfo + PeerCenter 完整处理**)、`peer_manager.js`、`global_state.js`、
  `protos.js` + `protos_generated.js`(protobufjs 静态代码)、`compress.js`。`protos/*.proto`。
- `easytier-worker/`(含 `design/ET协议/` 协议文档)、`easytier-ws-relay-IceSoulHanxi|NotTropical/`(同源上游)。
- 官方源 `EasyTier/`(2.6.4,`Cargo.toml` version=2.6.4)。`scripts/check-proto-drift.mjs` 已是 proto 漂移校验脚手架。

### 2.6 实测 gotcha(必须处理)
- **不回 Pong 会断连**:真节点发 Ping(type 4),若 server 不回 Pong(type 5),约 6 秒后判死并重连。
  → 保活必须实现 Pong + 正确 RPC 响应。
- **DO hibernation / 幽灵节点**:控制平面要保活与一致性。`cf-workers-et-ws` README 有心跳/超时/单调版本号方案,照搬验证。
- **协议版本漂移**:锁定 2.6.4;proto 变化用 `proto:check` 把关。

---

## 3. 后续要完成的内容(Phase B/C/D)

总策略:**移植 `cf-workers-et-ws/src/worker/core/*` 的成熟逻辑到 EdgeTier TS**,接 EdgeTier 现有
鉴权/observer/面板;EdgeTier 私有鉴权门禁保持在最前。每阶段以"真机 + 面板真实数据"验收。

### Phase B — 解密 + RPC 解码(只读观测)（✅ 本地已实现;待真实多节点验证）
目标:`RelayRoom` 解密加密帧、解 RPC、把整网信息灌进 observer,面板显示真实组网。

任务:
1. **引入 protobuf 运行时**:`protobufjs/minimal` + `long`(纯 JS,可在 Workers 跑;`cf-workers-et-ws` 已证)。
   vendored 官方 proto 到 `proto/easytier/`(对齐 2.6.4),用 pbjs 生成静态代码或运行时 loadSync 打包文本。
2. **per-room network_secret**:`Env` 加 secret 来源(按 room 映射;MVP 可单网络 `EASYTIER_NETWORK_SECRET` Worker secret)。
   `RelayRoom` 持有该 secret,`deriveKeys` 缓存 key128/key256。
3. **解密路径**:`onMessage` 中 `flags & 1` 时用 `decryptAesGcm` 解 body(异步;注意 WS 消息处理改 async + 顺序)。
4. **RPC 解码**:type 8/9 → 解 `RpcPacket`→(可能 Zstd 解压)→ `RpcRequest`/`RpcResponse`→ 按 service 分派:
   - `OspfRouteRpc.SyncRouteInfo`:解 `RoutePeerInfo[]` + `RouteConnBitmap` → 存入房间路由表。
   - `PeerCenterRpc.GetGlobalPeerMap`/`ReportPeers`:维护 `globalPeerMap`(latency)。
5. **observer 聚合**:扩展 `src/observer/types.ts`,把 RoutePeerInfo(虚拟 IP/hostname/NAT/版本/cost)、
   conn bitmap、global peer map 映射成 DTO;新增 `GET /api/rooms/:id/topology`。
6. **面板**:Devices 显示真实虚拟 IP/hostname/NAT/版本;去掉"待 proto 解码"占位;Overview 出真实在线/离线/出口。

验收:真机连入 → 面板显示该节点真实虚拟 IP/hostname/NAT/版本(非 seed)。本地真机向量已覆盖单节点 SyncRouteInfo;本轮部署已覆盖真实 `home-mesh` 多节点 RoutePeerInfo/conn bitmap;压缩 route 表仍需真机向量。

### Phase C — 做合格 shared node(真节点稳定长连)（🟡 Worker-feasible 本地实现;待 live evidence）
1. **Ping→Pong**:收到 type 4 回 type 5(payload 回显)。
2. **正确 RPC 响应**:`SyncRouteInfo` 回 `SyncRouteInfoResponse`(参考 `rpc_handler.js` 的 session/isInitiator);
   `PeerCenter` 回对应响应。维护并推送/广播路由更新使组网收敛。
3. **保活与幽灵节点**:DO alarm 发送 Ping、连接超时清理、单调递增 routeVersion、断连时清理该来源 route/PeerCenter 状态并广播更新。
4. **多节点中继**:两个真节点经 EdgeTier 互通,directed forwarding 保持正确(现有逻辑已验证转发)。

验收:真节点把 EdgeTier 当 peer **长期在线**(不再 6 秒断);两节点经 EdgeTier 形成组网;断线秒级反映到面板。本轮已验证长于 45 秒的真实 WSS 控制面与 PeerCenter/route 响应;断线 cleanup 与长测仍需补证据。

### Phase D — 拓扑与延迟可视化（✅ DTO/API/页面已实现;待真实数据验证）
1. conn bitmap → 拓扑边;global peer map → latency edges + PeerCenter ratio summary。
2. 路由更新事件流;面板 Topology 页展示节点、边、latency、summary。

验收:面板展示组网拓扑与节点间延迟,P2P/relay 状态如实标注。本轮已验证 topology summary 输出真实 conn bitmap + PeerCenter latency edges。

---

## 4. 架构与文件落点

```
src/easytier/
  constants.ts     # 包类型、MAGIC/VERSION/EDGE_PEER_ID、limits、room 正则  [已完成]
  packet.ts        # 16 字节头 parse/create                                [已完成]
  crypto.ts        # SipHash KDF + AES-GCM(WebCrypto)                      [已完成/已验证]
  handshake.ts     # HandshakeRequest 编解码 + 响应构建                     [已完成/已验证]
  rpc.ts           # protobuf 解码/编码 + Zstd + SyncRouteInfo/PeerCenter    [已实现]
  protobuf.ts      # 手写 protobuf reader/writer                            [已实现]
  zstd.ts          # Worker-compatible Zstd 解压                             [已实现]
  types.ts         # 协议观测类型                                          [扩展]
src/durable-objects/
  relay-room.ts    # 握手/解密/RPC/Pong/route push/PeerCenter/storage/alarms [Phase B/C/D]
  directory.ts     # 房间目录(沿用)
src/observer/
  api.ts           # 新增 /api/rooms/:id/topology;路由/peer DTO            [Phase B 扩展]
  types.ts         # RoutePeer/Topology/Summary DTO                         [Phase B/D 扩展]
src/dashboard/     # Devices/Overview/Topology 接真实数据                    [Phase B/D]
src/worker/
  env.ts           # EASYTIER_NETWORK_SECRET/NAME/SECRETS/NETWORKS          [Phase B/W6]
proto/easytier/    # proto 漂移校验目标(scripts/check-proto-drift.mjs)
```

---

## 5. 测试与验证方法(真机回归环)

- **测试机**:`ssh toe2@192.168.31.50`(Ubuntu 24.04 x86_64;凭据只保留在本地/会话,不写入 repo)。
  已放 `/tmp/easytier-core`、`/tmp/easytier-cli`(2.6.4)、`/tmp/et-test.toml`(含真实 secret)。
  注意:该机 **DNS 坏**(`ping 1.1.1.1` 通但解析失败)→ 下载走本机 scp。
- **本机 LAN IP** `192.168.31.72`;测试机能反连本机端口。
- **验证环(已验证可行)**:本机起一个 WS 应答服务器(node + `ws`,从 EdgeTier 目录跑以解析 `ws`),
  测试机 easytier-core 用 `[[peer]] uri="ws://192.168.31.72:<port>/ws"` 连入 → 捕获/应答 → 解密分析。
  也可直接 `wrangler dev` 跑 EdgeTier 本体(`.dev.vars` 提供鉴权 secret)再连。
- **真机向量已固化**:`handshake.test.ts`(真实 HandshakeRequest 字节)、`realtraffic.test.ts`(真实加密 RpcReq)。
  Phase B 解码应复用这些向量做离线回归。
- **凭据/密钥**:均在 gitignored `.env`(`EASYTIER_NETWORK_SECRET` 等)与 CF Worker secret;**不得提交**。
- **outbound TCP 验证**:Worker secret/vars 配置 `EASYTIER_PUBLIC_PEER_TCP` 或 `EASYTIER_OUTBOUND_TCP_PEERS`;
  访问 `/api/rooms/<room>` 或面板会触发主动拨号,`GET /api/rooms/<room>/outbound-tcp` 查看 configured/connecting/connected/handshake 状态。
- 每次改动跑全门禁;后端协议改动按 Trellis 走 `trellis-implement` → `trellis-check`。

---

## 6. 约束 / 非目标 / 安全

- **Cloudflare Workers 硬约束**:无 TUN、不能跑 easytier-core、不能主动拨 UDP 或做 TCP/UDP 打洞;EdgeTier 可做
  WSS/TCP shared node / 路由反射器 / 观测 / 网关,**不承担三层数据面**。
- 不在 Worker 内做完整 VPN 内核;真实 VPN 由真节点承担。
- network_secret 等仅作 Worker secret;dashboard/API **绝不**明文回显 secret/完整 digest(可显 digest 前缀)。
- 仅服务所有者自有网络;这是为自有网络实现兼容 shared node。
- 面板对尚不可得的数据用明确占位,**不伪造**。
- 不提交任何真实 secret、tokenized WSS URI、未脱敏日志。

---

## 7. 风险

- 协议版本漂移(锁 2.6.4 + proto:check)。
- DO hibernation 与控制平面保活/一致性(照搬 `cf-workers-et-ws` 心跳/超时/版本号方案并验证)。
- 加密/压缩字节布局必须逐字节对齐(有真机向量与参考实现对照)。
- 成为完整网络成员后,跟随 EasyTier 升级的维护成本显著上升。
- 异步解密在 WS 消息处理中的顺序与背压(`onMessage` 改 async 时注意有序处理)。

---

## 8. 给接手 agent 的起步清单

1. 读本 PRD + `docs/easytier-protocol-integration-plan.md` + `src/easytier/{crypto,handshake,constants,packet}.ts` 与其测试。
2. 通读 `research/github/cf-workers-et-ws/src/worker/core/{rpc_handler,peer_manager,global_state,protos,compress}.js`。
3. 继续真实多节点验证:压缩 route 表、长连、断线清理、PeerCenter latency、DO 重启/休眠、`EASYTIER_NETWORKS` 多网络隔离。
4. `.dev.vars`/Worker secret 提供 network_secret;不得提交真实 secret、tokenized WSS URI 或未脱敏日志。
5. 用第 5 节真机环验收;每步全门禁绿后再 commit。
