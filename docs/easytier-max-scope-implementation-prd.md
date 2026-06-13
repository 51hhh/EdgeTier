# EdgeTier 最大面实现 PRD（Cloudflare Worker 能力天花板）

> 实现交接文档。定义 EdgeTier 在 Cloudflare Workers 上**能做到的最大能力面**,并给出达到该天花板的实现工作流。
> 面向没有此前对话上下文的实现 agent。
> 协议字节级细节见 `docs/easytier-full-member-prd.md`;可行性背景见 `docs/easytier-protocol-integration-plan.md`。

最后更新:2026-06-13 · 当前 commit `3c89744` + 本轮 Worker-feasible W2/W3/W4/W6 改动(未提交,已部署验证版本 `8e2be8b0-7244-47b5-852f-dbd0b4ce36a3`)

---

## 1. 目标与"最大面"定性（已确认）

EdgeTier 在 Cloudflare Workers 上作为 **EasyTier 一等 SharedNode + 路由反射器 + 全网观测者**,
持有 network_secret、解密控制平面、解出整网信息,并尽可能深地参与组网 —— **除 L3/UDP 数据面以外的全部能力**。

### 1.1 能力天花板（CAN / CANNOT,附原因）

| 能力 | 可行 | 依据 |
|---|---|---|
| 完整网络成员(控制平面),有 peer_id,协议认可的 `PeerIdentityType.SharedNode` | ✅ | 握手 + 加密 + 路由同步已真机验证 |
| 解出整网节点信息(虚拟 IP/hostname/NAT/版本/cost/proxy_cidrs) | ✅ | OSPF 路由同步泛洪整网 `RoutePeerInfos`;连一个真实节点即得全网 |
| 拓扑(RouteConnBitmap)、P2P 延迟图(PeerCenter GlobalPeerMap) | ✅ | proto 已解码;PeerCenter 聚合与 topology summary DTO 已接入 |
| 节点间中继 / 路由反射器(转发 + 应答路由同步 + 保活) | ✅ | directed forwarding + Pong + RPC 响应 + route push/broadcast + alarm heartbeat |
| 入站接入:节点把 `wss://edge/ws` 加为 peer 拨入 | ✅ | 当前方案,已验证 |
| 出站接入:`connect()` 主动拨现有 `tcp://` 公共节点并入组网 | ✅(需 TCP 帧) | Workers 支持出站 TCP(`cloudflare:sockets`);仅限 tcp:// |
| 应用层网关(域名 → 内网 HTTP/WS 服务) | ✅(经 gateway-agent) | Worker 做入口,真实主机跑 agent |
| **L3 数据面端点**(虚拟网卡、可被 ping、承载真实 IP 流量、运行服务) | ❌ | **无 TUN** |
| **UDP / P2P 打洞 / 连 `udp://` peer** | ❌ | **Workers 无出站 UDP** |
| 长期大流量 VPN 数据面 | ❌ | 非 Worker 职责 |

gh 调研佐证:所有 EasyTier+Cloudflare 项目(`Teleseon/cf-workers-et-ws`、`NotTropical/easytier-ws-relay`、
`21paradox/easytier-wsrelay`、`PIKACHUIM/easytier-worker` 等)均为 WS relay/shared-node;
全网无 WireGuard/VPN/L3-over-Workers 实现 —— 印证天花板。Workers 出站 TCP 真实存在(`Brand-Boosting-GmbH/workerd-ftp`)。

### 1.2 架构定位一句话
```
Cloudflare Worker = EasyTier SharedNode + 路由反射器 + 全网观测/面板 + (可选)出站并网 + 应用层网关入口
真实主机 = L3 数据面 / P2P / TUN / 承载流量(gateway-agent)
```

### 1.3 已确认的边界决策
EdgeTier 持有 network_secret 并解密整网控制流量(从零知识中继升级为完整成员)。
secret 仅作 Worker secret;dashboard/API **绝不**明文回显 secret/完整 digest;仅服务所有者自有网络。

---

## 2. 协议要点（速查,细节见 full-member PRD）

- 16 字节小端包头;`flags` bit0=加密、bit1=latency_first;PacketType:HandShake=2(不加密)、Ping=4、Pong=5、RpcReq=8、RpcResp=9。
- **加密帧 `len` 字段 = 明文长度;实际 wire payload = len + 28(AEAD tail)**。AES-GCM tail = `tag(16)||nonce(12)`,空 AAD,默认 key128。
- KDF:SipHash-1-3 keys(0,0) → key128/key256(`crypto.ts` 已实现并对齐真机)。
- 握手:HandshakeRequest(magic=0xd1e1a5e1, version=1, network_name, network_secret_digest);互认 digest。
- RPC:加密 body 解密 → `common.RpcPacket` →(可能 **Zstd** 压缩,algo=2)→ `RpcRequest` → 按 `descriptor.serviceName` 分派:
  - `OspfRouteRpc.SyncRouteInfo` → `RoutePeerInfo[]`(虚拟 IP/hostname/NAT/版本)+ `RouteConnBitmap`(拓扑)
  - `PeerCenterRpc.ReportPeers`/`GetGlobalPeerMap` → `GlobalPeerMap`(directPeers + latency_ms)
- 权威 proto:`research/github/EasyTier/easytier/src/proto/{peer_rpc,common,error}.proto`(2.6.4),已 vendored 到 `proto/easytier/`。
- 参考实现:`research/github/cf-workers-et-ws/src/worker/core/*`(crypto/packet/rpc_handler/peer_manager/global_state/compress)。

---

## 3. 当前状态

**已提交至 `3c89744`**:私有部署 + Worker 鉴权、Kumo 面板 + 配置生成器、二进制帧修复、测试注入接口、
crypto 移植+验证、握手编解码+真机验证、Worker 控制面接入与拓扑观测。

**已落地的 Phase B / W1 主体**:
- vendored 官方 proto(`proto/easytier/{common,error,peer_rpc}.proto`) + 手写 protobuf reader/writer。
- `src/easytier/rpc.ts`:RpcPacket/RpcRequest/RpcResponse、SyncRouteInfo、RoutePeerInfo、PeerCenter ReportPeers/GetGlobalPeerMap 解码与响应编码。
- `src/easytier/packet.ts`:加密帧 `actualPayloadLength`、`createEasyTierFrame`、`splitEasyTierFrames`。
- `RelayRoom`:握手应答、解密、RPC 解码、observer 聚合、Pong、有序异步处理、routePeers/topology、route push/broadcast。
- `observer`/dashboard:`/api/rooms/:id/topology`、RoutePeer/Topology DTO、Topology 页、Devices/Overview 真实字段。
- W1 Zstd RPC body 解压已接入:`src/easytier/zstd.ts` 使用 Worker-compatible `fzstd`, `decodeEasyTierRpcPayload` 在 `CompressionAlgo.Zstd` 时先解压再解 `RpcRequest`/`RpcResponse`。
- `src/easytier/rpc.test.ts` 增加压缩 `SyncRouteInfo` fixture 回归。
- 尚未用真实多节点压缩 route 表重新部署验证;该项仍需后续 live evidence。

**本轮工作区新增(未提交)**:
- W2:route push 使用"观测到的 conn bitmap + EdgeTier 到 live peer"的有向 bitmap,不再对所有已知 peer 合成全连接;断连后清理该来源 route/PeerCenter 状态并向存活节点广播更新。
- W3:routePeers/rawRoutePeerInfos/connBitmapEdges/PeerCenter 关键观测状态写入 DO storage;DO alarm 做 10s Ping、25s 超时、TTL stale cleanup。WebSocket 会话本身仍是运行时态;尚未迁移到 Cloudflare WebSocket Hibernation API。
- W4:Topology DTO 增加 `summary`(节点/边/latency/PeerCenter ratio),面板直接消费 summary。
- W6:新增 `EASYTIER_NETWORKS` per-room network map,并兼容 `EASYTIER_NETWORK_SECRETS`/`EASYTIER_NETWORK_SECRET` fallback。
- W5:本轮未实现 outbound TCP;官方 TCP 帧/lifecycle 未形成足够清晰且可测试的 Worker 方案,保留 future work。

**本轮部署验证(2026-06-13,Worker `8e2be8b0-7244-47b5-852f-dbd0b4ce36a3`)**:
- `/api/health`、`/dashboard/`、room-scoped WSS token issuance 均返回 200。
- 测试机 easytier-core 2.6.4 以 `home-mesh` 配置拨入 Worker WSS;Worker 被接受为 peer `10000001 edgetier-worker`。
- 完整 route 场景下 `/api/rooms/home-mesh` 显示 9 个 peer(含历史测试残留),`websocketCount=1`,无重复 peer id;`/topology` 显示 9 nodes / 27 edges,其中 conn bitmap 25 edges、PeerCenter latency 2 edges。
- `no_tun=true` 场景下 WSS 长连和 PeerCenter 正常,但真实节点发给 Worker 的 `SyncRouteInfo` 为 0 个 peer info;要拿完整 RoutePeerInfo,测试节点需要正常路由/TUN 视图或已有完整路由泛洪。
- 新增防护:握手后 session 不再被后续控制包的 `header.fromPeerId` 重绑到 `EDGE_PEER_ID`;回归测试覆盖该场景。

---

## 4. 实现工作流（达到最大面;按优先级）

> 策略:接 EdgeTier 现有鉴权/observer/面板;EdgeTier 私有鉴权门禁保持最前。每项以"真机 + 面板真实数据"验收。

### W1 — Zstd 解压（✅ 本地已实现,仍需真实压缩向量验证）
现状:`rpc.ts` 已在 `compressionInfo.algo === 2` 时通过 `fzstd` 解压 RPC body,再继续解
`RpcRequest`/`RpcResponse`。本地新增压缩 `SyncRouteInfo` fixture 回归测试。
真机单节点 route(223B,未压缩)能解;EasyTier 对 **>256 字节**的 RPC body 可能 Zstd 压缩,
所以真实多节点 route 表仍需 live evidence。
- 已完成:引入可在 Workers 跑的 **Zstd 解码**(`fzstd`,纯 JS/browser-compatible;未使用 node:zlib)。
- 已完成:在 `decodeEasyTierRpcPayload` 中 `algo===2` 时先 zstd-decompress 再解 `RpcRequest`/`RpcResponse`。
- 待验证:多节点(≥2 真实节点)组网下,EdgeTier 解出**全部**节点的 RoutePeerInfo;补"压缩 route 表"真机向量回归测试。

### W2 — 路由反射器正确性与组网收敛
现状:已回 SyncRouteInfoResponse / Pong;已主动 route push/broadcast,EdgeTier 自身会进入 RoutePeerInfos。
本轮修正:route push 的 conn bitmap 不再伪造成全 mesh,只包含已观测边和 EdgeTier↔live peer 边。
- 任务(参考 `cf-workers-et-ws/rpc_handler.js` + `peer_manager.js`):
  - 维护房间级路由表 + 单调递增版本号;新 peer 接入/路由变化时 `pushRouteUpdateTo` + `broadcastRouteUpdate`。
  - EdgeTier 以自身 peer_id 出现在 RoutePeerInfos(可选标注虚拟 IP 或不分配)。
  - PeerCenter:维护 `globalPeerMap`,正确响应 `GetGlobalPeerMap`(带 digest)。
- 验收:真实节点把 EdgeTier 当 peer **长期在线**(不再 ~6s 断);两节点经 EdgeTier 互相可见;断线秒级反映。本轮已验证单 WSS 节点长连、route push/PeerCenter/topology;仍需断线 cleanup 与多节点稳定长测。

### W3 — DO hibernation / 幽灵节点 / 持久化
现状:route/PeerCenter 关键观测状态已持久化到 DO storage;DO alarm 做心跳/超时/TTL cleanup;WebSocket sessions 仍为运行时态。
- 任务:真实 DO 重启/休眠验证;如确需恢复 socket attachment,再评估迁移到 Cloudflare WebSocket Hibernation API。
- 验收:DO 重启/休眠后路由/PeerCenter 观测状态可恢复或可重建;断线设备秒级从面板消失,无幽灵节点。仍需 live evidence。

### W4 — 全量观测/面板真实数据
现状:Devices/Overview/Topology 已消费真实 RoutePeerInfo/PeerCenter DTO;Topology API 带 summary。
- 任务:真实 GUI/多节点接入后核对节点、边、latency、PeerCenter ratio;测试 seed 路径保留为显式开关,真实验收前必须 clear。
- 验收:你的 GUI/真实节点接入后,面板显示**真实组网设备与拓扑**(非 seed)。本轮已在 `home-mesh` 真实 route 场景验证 RoutePeerInfo + conn bitmap + PeerCenter summary;仍需压缩 route 表真机向量。

### W5 —（可选增强）出站并网:`connect()` 拨现有公共节点
现状:仅入站(节点拨入);本轮未实现。
- 任务:用 `cloudflare:sockets` `connect()` 主动拨 `tcp://` 公共节点(如 `tcp://ip.ziyourufeng.eu.org:11010`),
  实现 EasyTier **TCP 帧格式**(与 WS 帧不同,需核对长度前缀);DO 持有该出站 socket 生命周期;同样走握手+解密+路由同步。
- 限制:仅 `tcp://`(udp:// 够不着);连接保活与重连。
- 验收:不改任何节点配置,EdgeTier 主动并入组网并解出全网信息。
- 说明:非必须;入站方案已能拿全网信息。本轮未实现,原因是官方 TCP tunnel 帧格式、连接生命周期与 Worker `connect()` 测试闭环尚未清晰到可以安全落地。

### W6 — 多网络 / per-room secret
现状:支持 `EASYTIER_NETWORKS` JSON room map,并 fallback 到 `EASYTIER_NETWORK_SECRETS` / `EASYTIER_NETWORK_SECRET`。
- 配置形态:`{"room-a":{"networkName":"home-mesh","secret":"..."}, "room-b":"room-b-secret"}`。对象可只给 `networkName`,secret 从旧 map/global secret 取。
- 验收:多个网络各自握手/解密互不串。仍需部署 secrets 后 live evidence。

### W7 — 部署 + 真机端到端验收
- 任务:配 Worker secret(`EASYTIER_NETWORK_SECRET`[+`EASYTIER_NETWORK_NAME`]);`wrangler deploy`;
  用测试机真实节点(见 §6)把 `wss://edge/ws?room=&token=` 加为 peer,验证握手→路由同步→面板真实数据→长连。
- 验收:写脱敏 validation report(`.trellis/tasks/<id>/validation-report.md`),记录版本/事件/计数/结论。

### W8 —（路线图,本 PRD 范围外标注）应用层网关
gateway-agent 跑在真实主机,Worker 做 HTTP/WS 入口反代到内网服务。**不在本 PRD 实现范围**,仅标记天花板内的未来项。

---

## 5. 文件落点

```
src/easytier/
  crypto.ts/handshake.ts/constants.ts/packet.ts   # 已完成/已验证
  protobuf.ts                                       # 手写 protobuf [工作区已加]
  rpc.ts (+rpc.test.ts)                             # RPC 解码/编码 [工作区已加];W1 加 zstd 分支
  zstd.ts                                           # [W1 新增] WASM zstd 解码封装
  protos/ 或 proto/easytier/*.proto                 # vendored 官方 proto(2.6.4)
src/durable-objects/relay-room.ts                   # 握手/解密/RPC/Pong/route push/PeerCenter/持久化/alarms
src/durable-objects/                                # [W5 可选] 出站 TCP 连接管理(DO 持有 socket)
src/observer/{api,types}.ts                         # topology API + RoutePeer/Topology/Summary DTO
src/dashboard/*                                     # Devices/Topology/Overview 真实数据
src/worker/env.ts                                   # EASYTIER_NETWORK_SECRET/NAME/SECRETS/NETWORKS
proto/easytier/ + scripts/check-proto-drift.mjs     # proto 漂移校验
```

---

## 6. 测试与验证

- **真机**:`ssh toe2@192.168.31.50`(Ubuntu24 x86_64;凭据只保留在本地/会话,不写入 repo),`/tmp/easytier-core`(2.6.4)+ `/tmp/et-test.toml`(含真实 secret)。该机 **DNS 坏**(下载走本机 scp)。本机 LAN IP `192.168.31.72`。
- **验证环(已验证可行)**:本机 `ws` 应答服务器(从 EdgeTier 目录跑)或 `wrangler dev`(`.dev.vars` 提供鉴权 secret);测试机 easytier-core `[[peer]] uri="ws://192.168.31.72:<port>/ws"` 拨入。
- **真机向量已固化**:`handshake.test.ts`(真实 HandshakeRequest)、`realtraffic.test.ts`(真实加密 RpcReq 解密+结构化解码)。W1 需补**压缩 route 表**真机向量。
- **多节点**:在测试机或追加机器跑 ≥2 个 easytier-core 实例(可 `no_tun=true` 免 root),验证 W1/W2。
- 全门禁:`npm run typecheck && npm test && npm run build && npm run proto:check`。后端协议改动按 Trellis 走 `trellis-implement`→`trellis-check`。
- 密钥/凭据在 gitignored `.env` 与 Worker secret;**不得提交**。

---

## 7. 非目标 / 硬天花板（不要尝试）
- 不在 Worker 内做 TUN/虚拟网卡、UDP、P2P 打洞、WireGuard、完整三层 VPN、承载真实 IP 流量。
- 不把 EdgeTier 当作可 ping 的 L3 端点(可选地在包级合成 ICMP 应答属"装样子",默认不做)。
- 承载内网服务流量 = gateway-agent(W8,本 PRD 外)。
- dashboard/API 不暴露 network_secret / 完整 digest;不伪造不可得数据(用明确占位)。

---

## 8. 风险
- **Zstd(W1)**:本地压缩 RPC 回归已打通;下一次真实多节点验收需补线上压缩 route 表证据。
- 协议版本漂移:锁 2.6.4 + `proto:check`;字段号(如 tcp NAT)核对 vendored proto。
- DO hibernation 与控制平面一致性(W3):照搬参考方案并验证。
- 出站 TCP(W5):TCP 帧与 WS 帧不同;`connect()` 端口/目标限制;连接保活。
- 加密算法假设:默认 key128(真机实证);若网络协商 256 需按协商选 key。
- 成为完整成员后跟随 EasyTier 升级的维护成本。

---

## 9. 给接手 agent 的起步清单
1. review 并提交工作区 Phase B 改动(§3);读 `crypto/handshake/protobuf/rpc.ts` 与其测试 + 本 PRD + full-member PRD。
2. 通读 `research/github/cf-workers-et-ws/src/worker/core/{rpc_handler,peer_manager,global_state,compress}.js`。
3. W1(Zstd) 已本地实现;下一步补真实多节点压缩 route 表验收向量。
4. 继续真实多节点验证 W1/W2/W3/W4/W6:压缩 route 表、长连、断线清理、DO 重启/休眠、per-room secret 隔离。
5. W7 部署 + 真机端到端;W5 outbound TCP 仅在官方帧格式/lifecycle 可安全测试后再做。
6. 每步全门禁绿后再 commit;真机验收写脱敏 report。
```
