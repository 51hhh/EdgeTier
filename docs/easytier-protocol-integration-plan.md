# EasyTier 协议集成可行性方案

> 目标:让部署在 Cloudflare Workers 上的 EdgeTier 从"被动观测经其中继的包头"升级为
> **实现 EasyTier 协议、作为持有 network_secret 的 shared node 参与控制平面**,从而解出
> 组网的完整信息(虚拟 IP、hostname、NAT 类型、路由拓扑、全局 peer 延迟图)。

日期:2026-06-12

## 1. 结论:可行,且有现成先例

可行性已被现成代码证明,无需从零逆向:

- `research/github/cf-workers-et-ws/`(Teleseon)—— **完整的 JS 版 EasyTier 服务端**,跑在
  Cloudflare Worker + Durable Object 上,实现了握手、加解密、protobuf RPC、路由同步、全局 peer 图。
- `research/github/easytier-ws-relay-IceSoulHanxi/`、`...-NotTropical/` —— 上述项目的上游/同源实现。
- `research/github/easytier-worker/design/ET协议/` —— 协议设计文档(credential_peer、peer_conn_secure_mode_v3、relay_peer_manager_design)。
- `research/github/EasyTier/`(官方 Rust 源,Cargo.lock 已锁版本)—— proto 与算法的权威来源。

CF Worker 做这件事不需要 TUN/WireGuard:**shared node 只转发 + 参与控制平面 RPC,不终结三层流量**。

## 2. 关键技术机制(已在先例中验证)

### 2.1 数据包头(16 字节,小端)
与 EdgeTier 现有 `src/easytier/packet.ts` 完全一致:
```
fromPeerId u32 | toPeerId u32 | packetType u8 | flags u8 | forwardCounter u8 | reserved u8 | len u32
```
- `flags` bit0 = 已加密;bit1 = latency_first。
- `packetType`:握手=2(**不加密**),Data=1,Ping/Pong,RpcReq=8/RpcResp=9(名称以实际常量为准)。

### 2.2 密钥派生(network_secret → AES key)
参考 `cf-workers-et-ws/src/worker/core/crypto.js`:
- EasyTier 用 Rust 默认 `DefaultHasher`(**SipHash-1-3**)做 KDF —— 先例已用纯 JS BigInt 实现 `sipHash13`。
- `deriveKeys(networkSecret)` → `key128`(16B)与 `key256`(32B,带 "easytier-256bit-key" 域分隔)。
- `generateDigestFromStr` → network_secret_digest(握手中用)。

### 2.3 加解密(AES-GCM)
- 载荷格式:`ciphertext || tag(16) || nonce(12)`。
- 算法按密钥长度选 aes-128-gcm / aes-256-gcm。
- 先例用 node:crypto;**EdgeTier 已开启 `nodejs_compat`**,可直接用,或改 WebCrypto `crypto.subtle`(更稳)。SipHash 是纯 JS,两端通用。

### 2.4 RPC 解码与组网全量信息
`cf-workers-et-ws/src/worker/core/rpc_handler.js` 已实现:
- **OspfRouteRpc.SyncRouteInfo** → 解 `SyncRouteInfoRequest`,得到:
  - `RoutePeerInfo[]`:`peer_id / ipv4_addr / ipv6_addr / hostname / udp_stun_info(NAT) / cost / proxy_cidrs / easytier_version / version / peer_route_id` —— **即虚拟组网全部节点信息**。
  - `RouteConnBitmap`:谁连谁的连接位图 —— **即拓扑图边**。
  - `RouteForeignNetworkInfos`:跨网络信息。
- **PeerCenterRpc.ReportPeers / GetGlobalPeerMap** → 维护 `globalPeerMap`(每个 peer 的 directPeers + `latency_ms`)—— **即 P2P 延迟图 / P2P-relay 比例**。
- RPC body 可能 Zstd 压缩(`compressionInfo.algo=2`)—— 需 Worker 兼容的 Zstd 解压;不可按 gzip/node:zlib 处理。

> proto 权威定义见 `cf-workers-et-ws/protos/peer_rpc.proto`(已含 google/common 依赖),
> 应与官方 `research/github/EasyTier` 选定 tag 对齐(EdgeTier 已有 `scripts/check-proto-drift.mjs` 脚手架)。

## 3. 必须先决策的边界(重要)

实现本方案要求 **EdgeTier 持有 network_secret 并派生密钥解密全部控制平面流量**。这与项目最初
"不接管 network secret 生命周期、不解密"的边界**直接冲突**。这是产品定位决策,需你确认:

- EdgeTier 将从"零知识中继 + 包头观测"变为"完整网络成员 / 路由反射器",能看到(并能解密)整网控制信息。
- network_secret 必须作为 Worker secret 按网络存储,绝不进版本库、绝不在 dashboard/API 明文回显。
- 仅用于**你自己拥有的网络**;这是为自有网络做兼容 shared node,不是破解他人网络。

若接受该边界,则可推进;否则只能停留在当前包头观测能力。

## 4. 分阶段实施计划

策略:**移植 `cf-workers-et-ws/src/worker/core/*` 的成熟逻辑到 EdgeTier 的 TS**,适配
WebCrypto + EdgeTier 现有鉴权/观测/面板,而不是从零逆向。EdgeTier 的私有鉴权门禁保持在最前。

- **Phase A — 握手打通(无解密)**
  - vendored proto(对齐官方 tag)→ 生成/引入 protobufjs 类型。
  - 移植 `crypto.ts`(SipHash KDF + AES-GCM)、`packet` 头(已有)、handshake(type=2)解析与应答。
  - 验收:真实 easytier-core/GUI 节点能与 EdgeTier 完成 WSS 握手(`research/github/EasyTier` 自建节点,或你提供的机器)。

- **Phase B — 解密 + RPC 解码(只读观测)**
  - 用派生密钥解 AES-GCM;解 `RpcPacket → RpcRequest`;解 `SyncRouteInfo` / `PeerCenter`。
  - 把解出的 `RoutePeerInfo`(虚拟 IP/hostname/NAT/版本)、conn bitmap、global peer map 汇总进 observer 状态。
  - 验收:dashboard **设备页显示真实虚拟 IP/hostname/NAT/延迟**,替换当前"待 v0.1.3"占位与 seed 假数据。

- **Phase C — 做合格 shared node(让真实节点稳定挂靠)**
  - 正确应答 SyncRouteInfo / PeerCenter,推送/广播路由更新,使节点保持连接、组网收敛。
  - 解决 DO hibernation 与"幽灵节点"(心跳/超时/单调版本号 —— 先例 README 有专门方案)。
  - 验收:节点把 EdgeTier 当 peer 长期在线,断线秒级反映。

- **Phase D — 拓扑与延迟可视化(超出当前)**
  - conn bitmap → 拓扑图;global peer map → 延迟图 + P2P/relay 成功率;路由更新事件流。
  - 新增 `GET /api/rooms/:id/topology`,面板出拓扑页。

## 5. 复用映射(EdgeTier ← 先例)

| EdgeTier 目标模块 | 参考先例文件 | 适配点 |
|---|---|---|
| `src/easytier/crypto.ts` | `cf-workers-et-ws/.../crypto.js` | node:crypto → WebCrypto;SipHash 直接用 |
| `src/easytier/protos/*` | `cf-workers-et-ws/protos/*.proto` + `protos_generated.js` | 对齐官方 tag,proto-drift 校验 |
| `src/easytier/rpc.ts`(重写) | `.../rpc_handler.js` | TS 化;接 EdgeTier observer 聚合 |
| `RelayRoom` 路由状态 | `.../peer_manager.js`、`global_state.js` | 并入 DO;复用现有 directory/事件 |
| 压缩 | `.../compress.js` | Zstd 解压(Worker 兼容 JS/WASM;当前用 `fzstd`) |

## 6. 主要风险

- **协议版本漂移**:EasyTier 各版本 proto/握手可能变化 —— 锁定一个官方 tag,用 proto-drift 校验把关。
- **DO hibernation / 幽灵节点**:控制平面需保活与一致性,先例已踩坑并给出心跳/超时/版本号方案,需照搬验证。
- **加密细节**:nonce/tag 布局、握手不加密、域分隔字符串必须逐字节对齐官方,否则解密失败(有先例做对照)。
- **维护成本**:成为完整网络成员后,跟随 EasyTier 升级的负担显著高于纯包头观测。

## 7. 建议下一步

1. 你确认第 3 节的 secret/边界决策。
2. 我在 `research/github/EasyTier` 选定一个与你 GUI(2.6.4)匹配的 tag,锁定 proto。
3. 跑 Phase A:用本地自建 easytier 节点或你提供的机器,验证与 EdgeTier 握手成功。
4. 逐阶段推进 B/C/D,每阶段以"真实节点 + 面板真实数据"为验收。
