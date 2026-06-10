# EdgeTier 项目概览

日期：2026-06-09

## 1. 项目名称

**EdgeTier**

含义：

```text
Edge + EasyTier
```

它表达的是：部署在边缘平台上的 EasyTier 辅助节点、观测节点和访问网关。当前优先部署目标是 Cloudflare Workers / Durable Objects，但名称本身不强绑定 Cloudflare，未来也可扩展到其它边缘运行环境。

推荐英文副标题：

```text
Cloudflare edge relay, observer, and gateway for EasyTier.
```

推荐中文描述：

```text
部署在 Cloudflare 上的 EasyTier 辅助组网节点、只读观测面板与域名访问网关。
```

## 2. 背景

当前已经存在 EasyTier 组网实践，并已有相关记录：

- `docs/easytier-home-mesh.md`
- `docs/easytier-client-options.md`

已有目标包括：

- 多设备之间通过 EasyTier 实现 P2P 组网
- 已有一台公网设备可用于组网辅助，但性能较弱
- 不希望所有流量集中经过弱公网设备
- 希望有云端/边缘面板查看组网状态、连接信息、数据流和日志
- 希望通过域名访问组网机器中的服务

经过沟通后，项目目标从“EasyTier 云管理平台”修正为“只读观测 + 辅助组网 + 域名入口”。

## 3. 关键边界

EdgeTier **不是** EasyTier 控制器，也不是子节点管理平台。

### 允许做

- 提供 Cloudflare 上的 EasyTier WSS relay / shared node
- 辅助 peer discovery / route sync / P2P 打洞信息交换
- 记录连接状态、事件、流量统计
- 解析 EasyTier route/peer 信息
- 展示只读 dashboard
- 提供只读 API
- 后续提供域名 HTTP/WebSocket 网关
- 可选提供轻量 gateway-agent，用于应用层反向代理

### 不做

- 不修改已部署 EasyTier 子节点
- 不重启子节点 EasyTier
- 不下发子节点配置
- 不远程执行命令
- 不接管 network secret 生命周期
- 不做完整 EasyTier 管理平台
- 不在 Cloudflare Workers 内硬做 TUN/TAP、WireGuard server、完整三层 VPN

必要前提：如果希望 EdgeTier 参与组网，已有 EasyTier 节点至少需要把 EdgeTier 的 WSS 地址加入 peer/shared-node 入口，例如：

```text
wss://edge.example.com/ws?room=<network>
```

这不等于管理子节点，只是让子节点连接一个新的辅助入口。

## 4. EasyTier 机制调研结论

### 4.1 EasyTier 项目定位

EasyTier 官方定位是：

```text
A simple, decentralized mesh VPN with WireGuard support.
```

中文定位接近：

```text
一个由 Rust 和 Tokio 驱动的简单、安全、去中心化的异地组网方案。
```

核心特征：

- 去中心化 Mesh VPN / SD-WAN
- 节点平等独立
- 不强依赖中心化服务
- NAT traversal / P2P 优先
- P2P 失败时通过 shared node relay
- 支持 TCP / UDP / WSS / WireGuard 等能力

官方 README 中的关键机制：

```text
Nodes will automatically attempt NAT traversal and establish P2P connections.
When P2P fails, data will be relayed through shared nodes.
```

### 4.2 是否存在广播或较广信息同步机制

调研发现 EasyTier 协议/源码中存在多种信息同步机制，适合 EdgeTier 做观测。

#### OspfRouteRpc / route sync

`peer_rpc.proto` 中存在：

```proto
service OspfRouteRpc {
  rpc SyncRouteInfo(SyncRouteInfoRequest) returns (SyncRouteInfoResponse);
}
```

相关结构包含：

```proto
message SyncRouteInfoRequest {
  uint32 my_peer_id = 1;
  RoutePeerInfos peer_infos = 4;
  RouteConnBitmap conn_bitmap = 5;
  RouteForeignNetworkInfos foreign_network_infos = 6;
}
```

这说明 EasyTier 节点之间会同步 peer/route/连接位图等信息，辅助节点如果兼容该过程，可以获取比单个连接更广的组网信息。

#### PeerCenterRpc / GlobalPeerMap

`peer_rpc.proto` 中存在：

```proto
service PeerCenterRpc {
  rpc ReportPeers(ReportPeersRequest) returns (ReportPeersResponse);
  rpc GetGlobalPeerMap(GetGlobalPeerMapRequest) returns (GetGlobalPeerMapResponse);
}
```

核心数据结构：

```proto
message ReportPeersRequest {
  uint32 my_peer_id = 1;
  PeerInfoForGlobalMap peer_infos = 2;
}

message PeerInfoForGlobalMap {
  map<uint32, DirectConnectedPeerInfo> direct_peers = 1;
}

message DirectConnectedPeerInfo {
  int32 latency_ms = 1;
}

message GlobalPeerMap {
  map<uint32, PeerInfoForGlobalMap> map = 1;
}
```

这意味着如果 EdgeTier 实现/兼容 PeerCenterRpc，可以获得类似：

```json
{
  "peerA": {
    "direct_peers": {
      "peerB": { "latency_ms": 12 },
      "peerC": { "latency_ms": 30 }
    }
  }
}
```

这非常适合构建 P2P 拓扑图和延迟图。

## 5. Cloudflare 运行环境边界

Cloudflare Workers / Durable Objects 适合：

- WebSocket relay
- Durable Object room/session 状态
- HTTP API
- 静态 dashboard
- 应用层 HTTP/WebSocket 网关
- 轻量观测、统计、鉴权

不适合：

- TUN/TAP 虚拟网卡
- WireGuard server
- 原生 UDP relay
- 任意 L3 IP 包转发
- 长期大流量 VPN 数据面

因此 EdgeTier 的定位应是：

```text
Cloudflare = 边缘 relay / 观测 / 域名入口
EasyTier 真实节点 = VPN / P2P / 三层数据面
```

如果需要系统级 VPN 入口，应由真实服务器、弱公网设备或其它可运行 EasyTier Core/WireGuard portal 的节点承担；EdgeTier 可以展示和辅助，但不在 Worker 内硬做完整 VPN 内核。

## 6. 最终产品定位

EdgeTier 是：

```text
EasyTier 的 Cloudflare 边缘辅助节点。
```

包含三类能力：

### 6.1 辅助组网节点

- WSS relay endpoint
- public shared node 类能力
- room/network 隔离
- peer discovery 辅助
- route update broadcast
- P2P 打洞信息交换
- P2P 失败时 WebSocket relay fallback

### 6.2 只读观测面板

- peer 在线状态
- peer 连接/断开事件
- relay 流量统计
- route/peer 信息
- conn bitmap / P2P edges
- GlobalPeerMap
- P2P/relay 占比
- 延迟、连接质量
- 日志和事件查询

### 6.3 域名入口网关

后续通过域名访问组网内机器的服务，例如：

```text
https://camera.example.com -> robot-001:8080
https://api.example.com    -> robot-002:3000
wss://term.example.com     -> robot-003:7681
```

注意：如果不在目标机器运行任何额外 agent，Cloudflare Worker 不能直接访问 EasyTier 虚拟 IP 或本机服务。域名访问网关有两条路线：

1. 深度复用/封装 EasyTier 数据面协议，难度高。
2. 在需要暴露服务的机器上运行轻量 `gateway-agent`，通过反向 WebSocket 连接 Cloudflare，再由 Worker 转发 HTTP/WebSocket 请求。该 agent 不管理 EasyTier，只做应用层代理。

推荐先做第 2 条路线。

## 7. MVP 范围

### v0.1：WSS relay + 基础面板

目标：先让 EdgeTier 作为可用的 Cloudflare EasyTier WSS relay/shared node。

能力：

- `wss://domain/ws?room=<network>`
- Worker 处理 WebSocket upgrade
- Durable Object 以 room 管理连接
- peer_id -> WebSocket 映射
- 基础 packet relay
- peer connected/disconnected 事件
- rx/tx/relay bytes 统计
- 只读 `/api/rooms`、`/api/peers`、`/api/events`
- 简单 dashboard

### v0.2：Route/Topology 观测

能力：

- 解析 `RoutePeerInfo`
- 解析 `SyncRouteInfo`
- 解析/生成 `connBitmap`
- 推导 direct/relay/unknown edges
- 拓扑图展示
- route update 事件记录

### v0.3：PeerCenter/GlobalPeerMap

能力：

- 兼容 `PeerCenterRpc`
- 实现 `ReportPeers`
- 实现 `GetGlobalPeerMap`
- 保存 direct peers + latency
- 展示 P2P 拓扑和延迟
- 统计 P2P 成功率

### v0.4：域名网关

能力：

- domain route 配置
- HTTP/WebSocket application gateway
- 用户鉴权和访问日志
- 可选 gateway-agent

### v1.0：产品化

能力：

- 多 room/network
- 多用户/权限
- Cloudflare Access/OAuth 集成
- D1/KV/R2/Analytics Engine 存储
- 历史拓扑回放
- 告警
- 流量限制
- 多区域/多 Edge 节点调度

## 8. 推荐 Cloudflare 架构

```text
Cloudflare Worker
  ├─ /ws
  │   └─ EasyTier WebSocket relay endpoint
  │
  ├─ /api
  │   ├─ /rooms
  │   ├─ /peers
  │   ├─ /topology
  │   ├─ /events
  │   └─ /traffic
  │
  └─ /dashboard
      └─ 静态前端页面

Durable Objects
  └─ RelayRoom(room_id)
      ├─ peer_id -> websocket
      ├─ peer_id -> peer state
      ├─ route info
      ├─ conn bitmap
      ├─ global peer map
      ├─ relay counters
      ├─ recent events
      └─ topology snapshot

D1 / KV / R2 / Analytics Engine
  ├─ room 配置
  ├─ domain gateway 配置
  ├─ 用户/权限
  ├─ 历史事件
  ├─ 流量指标
  └─ 长期日志归档
```

## 9. Dashboard 页面设计

### Overview

- 在线 peer 数
- room/network 数
- WebSocket 连接数
- relay 流量
- P2P/relay 比例
- 最近异常

### Peers

- peer_id
- room/network
- hostname / virtual IP，如果能解析
- connected_at
- last_seen
- rx_bytes
- tx_bytes
- relay_in/out
- connection_state

### Topology

- 节点图
- direct 边
- relay 边
- unknown 边
- latency_ms
- 边流量

### Traffic

- 每 peer 流量
- 每 room 流量
- relay 流量趋势
- 热点连接

### Events

- peer connected
- peer disconnected
- route updated
- relay fallback
- decode error
- auth failed

### Gateway

- 域名转发规则
- 目标 peer
- 目标端口
- 协议类型
- 访问日志
- 权限状态

## 10. 参考项目

### 10.1 IceSoulHanxi/easytier-ws-relay

地址：`https://github.com/IceSoulHanxi/easytier-ws-relay`

定位：JavaScript Cloudflare Workers + Durable Objects EasyTier WebSocket relay。

可借鉴点：

- Worker relay 基础结构
- Durable Object room 管理
- `WS_PATH`
- `EASYTIER_DISABLE_RELAY`
- `EASYTIER_COMPRESS_RPC`
- `LOCATION_HINT`
- `peerInfosByGroup`
- `routeSessions`
- `connBitmap`
- `broadcastRouteUpdate`

适合用于 v0.1 的 JS MVP 基础。

### 10.2 Teleseon/cf-workers-et-ws

地址：`https://github.com/Teleseon/cf-workers-et-ws`

定位：Cloudflare Workers 上的 EasyTier WS 服务。

可借鉴点：

- 部署到 Cloudflare Workers
- Durable Object relay room
- `EASYTIER_NETWORK_NAME`
- `EASYTIER_LATENCY_FIRST`
- `EASYTIER_HEARTBEAT_INTERVAL`
- `EASYTIER_CONNECTION_TIMEOUT`
- `EASYTIER_SESSION_TTL_MS`
- heartbeat / timeout / cleanup
- 网络名过滤或私有网络模式
- 延迟优先思路

适合用于 MVP 稳定性和运行参数设计。

### 10.3 21paradox/easytier-wsrelay

地址：`https://github.com/21paradox/easytier-wsrelay`

定位：Rust 版 EasyTier Cloudflare Worker relay 实现。

可借鉴点最重要：

- `peer_center.rs`
- `route_state.rs`
- `rpc_handler.rs`
- `PeerCenterRpc`
- `ReportPeers`
- `GetGlobalPeerMap`
- `GlobalPeerMap`
- `SyncRouteInfo`
- `RoutePeerInfo`
- P2P conn bitmap 解析
- P2P 拓扑传播
- stale peer cleanup
- route refresh

这是后续实现拓扑观测和 PeerCenter 的最重要参考项目。

### 10.4 PIKACHUIM/easytier-worker

地址：`https://github.com/PIKACHUIM/easytier-worker`

定位：EasyTier public server aggregation and distribution API，基于 Cloudflare Workers/Hono/D1 的节点管理/聚合平台。

可借鉴点：

- Hono + D1 API 结构
- Dashboard 实现
- 用户/权限模型
- `nodes` 表
- `node_peers` 表
- `node_routes` 表
- 节点状态、流量、连接数、延迟字段
- `/api/report`
- `/api/query`
- `/api/public`
- 健康检查和负载评分

注意：该项目偏节点管理平台，而 EdgeTier 不做子节点管理，只借鉴 API、DB、Dashboard、统计模型。

## 11. 当前沟通记录摘要

### 初始需求

用户希望调研：

- `cloudflare/kumo`
- `NotTropical/easytier-ws-relay`
- `EasyTier/EasyTier`

背景是已经实现多个设备组网，希望设备间 P2P；已有公网设备可以建立服务，但公网设备性能弱；希望构建云端服务支持日志、组网状态、数据流、后台管理等。

### 第一轮理解

初始建议偏向：

```text
EasyTier Cloud Manager
```

即云端控制面 + 观测面 + 后台管理。

### 用户纠正

用户明确：

```text
不要修改部署的 EasyTier 节点。
希望使用组网信息，有一个面板。
不需要对子节点进行管理。
```

因此项目定位修正为：

```text
EasyTier Observer / Dashboard
```

### 第二轮需求澄清

用户进一步说明：

```text
希望 CF 上部署一个可以辅助组网的节点。
该节点应能作为连接节点。
希望使用域名访问。
希望控制连接到组网机器中的转发功能和 VPN 功能等。
```

因此定位从单纯 Observer 扩展为：

```text
Cloudflare EasyTier Edge Gateway
```

即：

- relay/shared node
- observer dashboard
- domain gateway
- 可能的应用层转发
- 但不做子节点管理

### 项目命名

最终选定名称：

```text
EdgeTier
```

原因：

- 简洁
- 表达 Edge + EasyTier
- 适合 Cloudflare edge relay/observer/gateway
- 不强绑定 Cloudflare，未来可扩展

## 12. 当前建议优先级

实现优先级：

```text
1. 基于 Teleseon/IceSoulHanxi 的 JS Worker relay 做可用 WSS shared node
2. 借鉴 21paradox 的 route_state/peer_center 做拓扑观测
3. 借鉴 PIKACHUIM 的 D1/API/Dashboard 做面板和历史统计
4. 再做域名 HTTP/WebSocket gateway
```

参考项目优先级：

```text
1. 21paradox/easytier-wsrelay：协议、PeerCenter、拓扑
2. Teleseon/cf-workers-et-ws：Workers 稳定性和运行参数
3. IceSoulHanxi/easytier-ws-relay：JS relay 基础
4. PIKACHUIM/easytier-worker：后台、数据库、统计面板
```

## 13. 下一步建议

建议下一步进入实现规划：

1. 选定代码基线：JS Worker 还是 Rust Worker。
2. 如果追求最快 MVP，先 JS：基于 Teleseon/IceSoulHanxi。
3. 如果追求协议正确和长期维护，深入研究 21paradox Rust 版。
4. 定义 EdgeTier v0.1 API 和 Durable Object state。
5. 创建实际项目代码结构。
6. 本地 `wrangler dev` 验证 WSS relay。
7. 接入一个测试 EasyTier 节点验证连接。
8. 加 `/api/peers` 和最小 dashboard。
