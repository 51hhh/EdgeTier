# EdgeTier

<div align="center">

**EdgeTier** - 基于 EasyTier 的私有网状网络中继和监控面板

[English](README.md) | 简体中文

[功能特性](#功能特性) • [快速开始](#快速开始) • [控制面板](#控制面板) • [部署指南](#部署指南) • [开发指南](#开发指南)

</div>

---

## 项目简介

EdgeTier 是一个为 [EasyTier](https://github.com/EasyTier/EasyTier) 网状网络设计的**私有中继服务器和网页监控面板**。它提供集中式中继功能、实时网络拓扑可视化和全面的网络监控 —— 全部可部署在 Cloudflare Workers 上实现全球边缘分发。

### 核心特性

- 🌐 **私有中继服务器** - 基于 WebSocket 的中继服务，使用 Durable Objects 实现持久连接
- 📊 **实时监控面板** - 交互式拓扑可视化，采用力导向图布局算法
- 🔍 **网络监控** - 流量统计、节点连接、NAT 穿透状态
- ⚡ **边缘部署** - 运行在 Cloudflare Workers + Durable Objects（零服务器架构）
- 🔐 **身份验证** - 内置基于会话的身份验证，安全访问
- 🌍 **全球分发** - 一次部署，在 Cloudflare 边缘网络全球运行

---

## 功能特性

### 中继服务器

- **WebSocket 中继**：持久双向通信，用于网状网络协调
- **Durable Objects**：有状态的中继房间，支持自动休眠和迁移
- **RPC 协议**：结构化消息帧，支持大负载分片
- **连接矩阵**：实时节点连接跟踪和同步
- **目录服务**：集中式节点发现和中继房间管理

### 控制面板

#### 📈 概览页面
- 实时流量统计（入站/出站带宽）
- 活动节点数量和连接状态
- 网络健康指标
- 中继房间管理

#### 🗺️ 拓扑可视化
- **交互式图形**：力导向布局，支持缩放和平移
  - 鼠标滚轮缩放（0.5x - 3x）
  - 点击拖拽平移
  - 双击重置视图
- **节点详情**：点击任意节点查看：
  - 节点标识信息
  - NAT 类型（UDP/TCP）+ 中文说明
  - 虚拟 IP 地址
  - EasyTier 版本
  - 延迟指标
- **连接边**：可视化显示节点之间的连接关系
- **NAT 类型指示**：
  - 开放型互联网（Open Internet）
  - 对称型防火墙（Symmetric Firewall）
  - 完全圆锥型 NAT（Full Cone NAT）
  - 受限圆锥型 NAT（Restricted NAT）
  - 端口受限圆锥型 NAT（Port Restricted NAT）
  - 对称型 NAT（Symmetric NAT）

#### 📡 网络详情
- 节点表格：显示主机名、IP、NAT 类型、版本、延迟
- 边表格：显示连接来源和延迟
- 路由表：显示网络路径
- 连接矩阵：全面的连接性视图

### 技术亮点

- **前端**：React 18 + TypeScript + Vite
- **UI 框架**：Cloudflare Kumo 设计系统
- **后端**：Cloudflare Workers + Durable Objects
- **WebSocket**：原生 WebSocket API 配合自定义 RPC 协议
- **部署**：Wrangler CLI 一键部署
- **测试**：Vitest，包含 100+ 测试用例

---

## 快速开始

### 环境要求

- Node.js 18+
- npm 或 pnpm
- Cloudflare 账号（用于部署）
- Wrangler CLI：`npm install -g wrangler`

### 安装

```bash
# 克隆仓库
git clone https://github.com/yourusername/EdgeTier.git
cd EdgeTier

# 安装依赖
npm install

# 设置环境变量
cp .env.example .env
# 编辑 .env 并设置管理员凭据：
# ADMIN_USERNAME=你的用户名
# ADMIN_PASSWORD=你的密码
```

### 开发

```bash
# 启动开发服务器
npm run dev

# 控制面板将在 http://localhost:8787 可用
# 中继服务器在同一进程中运行（通过 Wrangler）
```

### 构建

```bash
# 生产构建
npm run build

# 运行测试
npm test

# 类型检查
npm run typecheck
```

---

## 控制面板

### 访问

1. 访问你的部署 URL（例如：`https://edgetier.your-domain.workers.dev`）
2. 使用管理员凭据登录
3. 在 `/dashboard/` 查看控制面板

### 功能说明

#### 概览页面
- **流量图表**：实时带宽可视化，显示入站/出站指标
- **节点状态**：已连接节点数量和网络健康状况
- **房间管理**：查看和管理活动中继房间

#### 拓扑页面
- **交互式图形**：
  - 缩放：在图形上滚动鼠标滚轮
  - 平移：点击并拖动画布
  - 重置：双击或使用 ⟲ 按钮
  - 控制：右下角的 +/− 按钮
- **节点信息**：
  - 点击任意节点查看详细信息
  - 选中的节点以黄色边框高亮显示
  - 信息面板显示 NAT 类型、IP、版本、延迟
  - 使用 × 按钮或点击背景关闭

#### 网络表格
- **节点**：所有已连接节点及详细指标
- **边**：连接关系和来源
- **路由**：网络路由路径
- **连接矩阵**：完整的连接性网格

---

## 部署指南

### 部署到 Cloudflare Workers

```bash
# 登录 Cloudflare
wrangler login

# 部署
npm run deploy

# 或手动部署
wrangler deploy
```

### 配置

#### wrangler.toml

```toml
name = "edgetier"
main = "src/worker/index.ts"
compatibility_date = "2024-01-01"

[[durable_objects.bindings]]
name = "RELAY_ROOM"
class_name = "RelayRoom"
script_name = "edgetier"

[[durable_objects.bindings]]
name = "DIRECTORY"
class_name = "Directory"
script_name = "edgetier"
```

#### 环境变量

通过 Wrangler secrets 设置：

```bash
# 设置管理员凭据
wrangler secret put ADMIN_USERNAME
wrangler secret put ADMIN_PASSWORD
```

### 自定义域名

```bash
# 在 Cloudflare 控制台添加自定义域名
# Workers & Pages → edgetier → Settings → Triggers → Custom Domains
# 添加：edgetier.yourdomain.com
```

---

## 开发指南

### 项目结构

```
EdgeTier/
├── src/
│   ├── dashboard/          # React 控制面板应用
│   │   ├── components/     # React 组件
│   │   ├── i18n/          # 国际化
│   │   └── styles.css     # 全局样式
│   ├── easytier/          # EasyTier 协议实现
│   │   ├── rpc.ts         # 支持分片的 RPC 协议
│   │   └── constants.ts   # 协议常量
│   ├── observer/          # 网络状态观察
│   │   ├── engine.ts      # 拓扑计算引擎
│   │   └── types.ts       # 类型定义
│   └── worker/            # Cloudflare Workers 后端
│       ├── index.ts       # Worker 入口点
│       ├── relay-room.ts  # 中继的 Durable Object
│       └── directory.ts   # 发现的 Durable Object
├── wrangler.toml          # Cloudflare Workers 配置
├── package.json           # 依赖和脚本
└── vite.config.ts         # Vite 构建配置
```

### 脚本命令

```bash
npm run dev          # 开发服务器
npm run build        # 生产构建
npm run deploy       # 部署到 Cloudflare
npm test             # 运行测试
npm run typecheck    # TypeScript 类型检查
```

### 测试

```bash
# 运行所有测试
npm test

# 监听模式运行测试
npm test -- --watch

# 运行特定测试文件
npm test src/dashboard/peer-display.test.ts
```

当前测试覆盖：**18 个测试文件中的 102 个测试** ✅

### 代码质量

- **TypeScript**：启用严格模式
- **ESLint**：代码检查（继承自 Cloudflare Kumo）
- **Prettier**：代码格式化
- **Vitest**：快速单元测试

---

## 架构说明

### 中继协议

EdgeTier 实现了一个自定义的基于 WebSocket 的中继协议：

1. **连接**：客户端通过 WebSocket 连接
2. **注册**：客户端发送节点 ID 和房间信息
3. **路由**：服务器在同一房间内的节点之间转发消息
4. **分片**：大消息自动分割成块
5. **心跳**：定期 ping/pong 检查连接健康

### Durable Objects

- **RelayRoom**：管理单个中继房间及其连接的节点
- **Directory**：全局节点目录和房间列表

### 控制面板架构

- **状态管理**：React hooks（useState、useEffect）
- **实时更新**：基于轮询的数据刷新
- **图形渲染**：基于 SVG 的力导向布局
- **响应式设计**：Cloudflare Kumo 设计系统

---

## 配置说明

### 客户端配置生成器

控制面板包含内置的 EasyTier 客户端配置生成器：

1. 导航到 **Config** 页面
2. 设置网络名称、密钥和标志
3. 生成边缘节点令牌（用于私有中继）
4. 下载 `.toml` 配置文件

### 网络设置

```toml
[network_identity]
instance_name = "my-client"
network_name = "my-network"
network_secret = "your-secret-here"

[flags]
latency_first = true
private_mode = true
enable_exit_node = false

[peers]
[[peers.peer]]
uri = "wss://edgetier.yourdomain.workers.dev/relay/ws?room=my-network&token=..."
```

---

## 安全说明

### 身份验证

- 基于会话的身份验证，使用 HTTP-only cookies
- 用户名/密码凭据存储为 Wrangler secrets
- 通过 SameSite cookie 策略进行 CSRF 保护

### 最佳实践

1. **更改默认凭据**：设置强 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD`
2. **使用 HTTPS**：始终使用自定义域名 + SSL 部署
3. **网络密钥**：为每个网状网络使用强且唯一的密钥
4. **令牌过期**：边缘节点令牌在 24 小时后过期
5. **私有模式**：在 EasyTier 客户端中启用 `private_mode` 标志

---

## 性能指标

### 指标

- **延迟**：Cloudflare 边缘上的中继延迟低于 100ms
- **吞吐量**：每个中继房间支持 100+ 并发连接
- **可扩展性**：通过 Cloudflare Workers 自动扩展
- **冷启动**：Durable Object 唤醒时间 <50ms

### 优化

- **休眠**：Durable Objects 空闲时自动休眠
- **边缘缓存**：静态资源在边缘位置缓存
- **打包大小**：约 180KB 的 gzipped JavaScript 包

---

## 故障排除

### 常见问题

**控制面板没有数据**
- 验证 EasyTier 客户端已连接到中继
- 检查客户端配置中的网络名称是否匹配
- 确保客户端中启用了 `private_mode`

**WebSocket 连接失败**
- 验证自定义域名的 SSL 证书有效
- 检查防火墙规则是否允许 WebSocket 连接
- 确保令牌未过期（24 小时限制）

**拓扑图不渲染**
- 清除浏览器缓存（Ctrl+Shift+R）
- 检查浏览器控制台是否有错误
- 验证至少有 2 个节点已连接

### 调试模式

```bash
# 查看 Wrangler 日志
wrangler tail

# 检查 Durable Object 状态
wrangler durable-objects list
```

---

## 开发路线图

- [ ] 移动端响应式面板
- [ ] 历史指标和图表
- [ ] 网络问题告警系统
- [ ] 多管理员用户管理
- [ ] 程序化访问 API
- [ ] Docker 部署选项

---

## 贡献指南

欢迎贡献！请遵循以下指南：

1. Fork 本仓库
2. 创建功能分支（`git checkout -b feature/amazing-feature`）
3. 提交你的更改（`git commit -m 'feat: add amazing feature'`）
4. 推送到分支（`git push origin feature/amazing-feature`）
5. 开启 Pull Request

### 开发规范

- 遵循现有的代码风格
- 为新功能添加测试
- 根据需要更新文档
- 提交前确保所有测试通过

---

## 开源协议

MIT License - 详见 [LICENSE](LICENSE) 文件

---

## 致谢

- [EasyTier](https://github.com/EasyTier/EasyTier) - EdgeTier 扩展的网状网络软件
- [Cloudflare Workers](https://workers.cloudflare.com/) - 驱动 EdgeTier 的无服务器平台
- [Cloudflare Kumo](https://github.com/cloudflare/kumo) - 控制面板 UI 的设计系统

---

## 相关链接

- **EasyTier 项目**：https://github.com/EasyTier/EasyTier
- **Cloudflare Workers 文档**：https://developers.cloudflare.com/workers/
- **Durable Objects 文档**：https://developers.cloudflare.com/durable-objects/

---

<div align="center">

为 EasyTier 社区精心打造 ❤️

[⬆ 返回顶部](#edgetier)

</div>
