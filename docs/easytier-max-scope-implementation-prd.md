# EdgeTier 最大面实现 PRD（Cloudflare Worker 能力天花板）

> 实现交接文档。定义 EdgeTier 在 Cloudflare Workers 上**能做到的最大能力面**,并给出达到该天花板的实现工作流。
> 面向没有此前对话上下文的实现 agent。
> 协议字节级细节见 `docs/easytier-full-member-prd.md`;可行性背景见 `docs/easytier-protocol-integration-plan.md`。

最后更新:2026-06-13 · 基线 commit `e71f92b` + 工作区 Phase B 改动(见 §3)

---

## 1. 目标与"最大面"定性（已确认）

EdgeTier 在 Cloudflare Workers 上作为 **EasyTier 一等 SharedNode + 路由反射器 + 全网观测者**,
持有 network_secret、解密控制平面、解出整网信息,并尽可能深地参与组网 —— **除 L3/UDP 数据面以外的全部能力**。

### 1.1 能力天花板（CAN / CANNOT,附原因）

| 能力 | 可行 | 依据 |
|---|---|---|
| 完整网络成员(控制平面),有 peer_id,协议认可的 `PeerIdentityType.SharedNode` | ✅ | 握手 + 加密 + 路由同步已真机验证 |
| 解出整网节点信息(虚拟 IP/hostname/NAT/版本/cost/proxy_cidrs) | ✅ | OSPF 路由同步泛洪整网 `RoutePeerInfos`;连一个真实节点即得全网 |
| 拓扑(RouteConnBitmap)、P2P 延迟图(PeerCenter GlobalPeerMap) | ✅ | proto 已解码;需补 PeerCenter 聚合 |
| 节点间中继 / 路由反射器(转发 + 应答路由同步 + 保活) | ✅ | directed forwarding + Pong + RPC 响应 |
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

**已提交(基线 `e71f92b` 及之前)**:私有部署 + Worker 鉴权(`c083117`)、多页面 Kumo 面板 + 配置生成器(`01a0837`)、
二进制帧修复(`b7608b7`)、测试注入接口(`bae780e`)、crypto 移植+验证(`c405173`)、握手编解码+真机验证(`9d02622`)。

**工作区(另一 agent 的 Phase B,尚未提交,已过 typecheck/47 tests/build/proto:check)**:
- vendored proto(`proto/easytier/{common,error,peer_rpc}.proto`)
- `src/easytier/protobuf.ts`(手写 protobuf reader/writer,边界检查完整)
- `src/easytier/rpc.ts` 重写(RpcPacket/RpcRequest/SyncRouteInfo/RoutePeerInfo/PeerCenter 解码 + 响应编码)+ `rpc.test.ts`
- `src/easytier/packet.ts`:`actualPayloadLength`(修正加密帧 len 语义)、`createEasyTierFrame`、`splitEasyTierFrames`
- `src/durable-objects/relay-room.ts`:握手应答 + 解密 + RPC 解码 + observer 聚合 + **Pong** + 有序异步处理 + 路由表/拓扑
- `src/observer/{api,types}.ts`:`/api/rooms/:id/topology` + RoutePeer/Topology DTO;`src/worker/env.ts`:`EASYTIER_NETWORK_SECRET/NAME`
- 面板新增 Topology 页;`realtraffic.test.ts` 强化为结构化解码断言(真机向量)
- `.trellis/spec/backend/quality-guidelines.md` 增补 RPC 方向 / 真机验证场景

→ **接手前先 review 并提交工作区改动**(或基于其继续)。Phase B 主体已落地;勿重复造。

**本轮新增(2026-06-13,本地验证)**:
- W1 Zstd RPC body 解压已接入:`src/easytier/zstd.ts` 使用 Worker-compatible `fzstd`, `decodeEasyTierRpcPayload` 在 `CompressionAlgo.Zstd` 时先解压再解 `RpcRequest`/`RpcResponse`。
- `src/easytier/rpc.test.ts` 增加压缩 `SyncRouteInfo` fixture 回归;全门禁通过(typecheck/53 tests/proto:check/build dry-run)。
- 尚未用真实多节点压缩 route 表重新部署验证;该项仍需后续 live evidence。

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
现状:已回 SyncRouteInfoResponse / Pong;但未主动**推送/广播**路由更新,EdgeTier 自身未必出现在其它节点视图。
- 任务(参考 `cf-workers-et-ws/rpc_handler.js` + `peer_manager.js`):
  - 维护房间级路由表 + 单调递增版本号;新 peer 接入/路由变化时 `pushRouteUpdateTo` + `broadcastRouteUpdate`。
  - EdgeTier 以自身 peer_id 出现在 RoutePeerInfos(可选标注虚拟 IP 或不分配)。
  - PeerCenter:维护 `globalPeerMap`,正确响应 `GetGlobalPeerMap`(带 digest)。
- 验收:真实节点把 EdgeTier 当 peer **长期在线**(不再 ~6s 断);两节点经 EdgeTier 互相可见;断线秒级反映。

### W3 — DO hibernation / 幽灵节点 / 持久化
现状:`routePeers`/`sessions` 为内存态,DO 休眠/驱逐丢失。
- 任务:心跳间隔/连接超时/单调版本号(照搬 `cf-workers-et-ws` 方案);评估 WebSocket Hibernation API 或 DO storage 持久关键状态;断线主动清理 + 防抖。
- 验收:DO 重启/休眠后路由/会话状态一致或可重建;断线设备秒级从面板消失,无幽灵节点。

### W4 — 全量观测/面板真实数据
现状:已有 routePeers + topology DTO 与 Topology 页骨架。
- 任务:Devices 显示真实虚拟 IP/hostname/NAT/版本/cost;去掉"待 proto 解码"占位;
  Overview 出真实在线/离线/出口;Topology 用 connBitmap 画边 + GlobalPeerMap 出延迟/P2P-relay 比例;清理 seed 假数据路径(保留为显式测试开关)。
- 验收:你的 GUI/真实节点接入后,面板显示**真实组网设备与拓扑**(非 seed)。

### W5 —（可选增强）出站并网:`connect()` 拨现有公共节点
现状:仅入站(节点拨入)。
- 任务:用 `cloudflare:sockets` `connect()` 主动拨 `tcp://` 公共节点(如 `tcp://ip.ziyourufeng.eu.org:11010`),
  实现 EasyTier **TCP 帧格式**(与 WS 帧不同,需核对长度前缀);DO 持有该出站 socket 生命周期;同样走握手+解密+路由同步。
- 限制:仅 `tcp://`(udp:// 够不着);连接保活与重连。
- 验收:不改任何节点配置,EdgeTier 主动并入组网并解出全网信息。
- 说明:非必须;入站方案已能拿全网信息。仅当需要"零节点改动并网"时做。

### W6 — 多网络 / per-room secret
现状:单一全局 `EASYTIER_NETWORK_SECRET`。
- 任务:按 room 映射 network_name + secret(Worker secret 或 KV/DO 存储);多网络隔离。
- 验收:多个网络各自握手/解密互不串。

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
src/durable-objects/relay-room.ts                   # 握手/解密/RPC/Pong/路由表 [工作区已改];W2/W3 收敛+保活
src/durable-objects/                                # [W5 可选] 出站 TCP 连接管理(DO 持有 socket)
src/observer/{api,types}.ts                         # topology API + DTO [工作区已改];W4 扩展
src/dashboard/*                                     # Devices/Topology/Overview 真实数据 [工作区已加 Topology]
src/worker/env.ts                                   # EASYTIER_NETWORK_SECRET/NAME [工作区已加];W6 多网络
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
4. 继续验证 W2(收敛/保活)+ W3(hibernation),让真节点长连且全网可见。
5. W4 面板真实数据;W7 部署 + 真机端到端;W5/W6 视需要。
6. 每步全门禁绿后再 commit;真机验收写脱敏 report。
```
