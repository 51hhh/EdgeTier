# EdgeTier

<div align="center">

**EdgeTier** - A private mesh network relay and monitoring dashboard for EasyTier

English | [简体中文](README.zh-CN.md)

[Features](#features) • [Quick Start](#quick-start) • [Dashboard](#dashboard) • [Deployment](#deployment) • [Development](#development)

</div>

---

## Overview

EdgeTier is a **private relay server and web-based monitoring dashboard** for [EasyTier](https://github.com/EasyTier/EasyTier) mesh networks. It provides centralized relay functionality, real-time network topology visualization, and comprehensive network monitoring — all deployable on Cloudflare Workers for global edge distribution.

### Key Features

- 🌐 **Private Relay Server** - WebSocket-based relay with Durable Objects for persistent connections
- 📊 **Real-time Dashboard** - Interactive topology visualization with force-directed graph layout
- 🔍 **Network Monitoring** - Traffic statistics, peer connections, NAT traversal status
- ⚡ **Edge Deployment** - Runs on Cloudflare Workers + Durable Objects (zero-server architecture)
- 🔐 **Authentication** - Built-in session-based authentication for secure access
- 🌍 **Global Distribution** - Deploy once, run globally on Cloudflare's edge network

---

## Features

### Relay Server

- **WebSocket Relay**: Persistent bidirectional communication for mesh network coordination
- **Durable Objects**: Stateful relay rooms with automatic hibernation and migration
- **RPC Protocol**: Structured message framing with fragmentation support for large payloads
- **Connection Matrix**: Real-time peer connectivity tracking and synchronization
- **Directory Service**: Centralized peer discovery and relay room management

### Dashboard

#### 📈 Overview
- Real-time traffic statistics (inbound/outbound bandwidth)
- Active peer count and connection status
- Network health indicators
- Relay room management

#### 🗺️ Topology Visualization
- **Interactive Graph**: Force-directed layout with zoom and pan
  - Mouse wheel zoom (0.5x - 3x)
  - Click-and-drag panning
  - Double-click to reset view
- **Node Details**: Click any node to view:
  - Peer identification
  - NAT type (UDP/TCP) with Chinese descriptions
  - Virtual IP address
  - EasyTier version
  - Latency metrics
- **Connection Edges**: Visual links showing peer relationships
- **NAT Type Indicators**: 
  - 开放型互联网 (Open Internet)
  - 对称型防火墙 (Symmetric Firewall)
  - 完全圆锥型 NAT (Full Cone NAT)
  - 受限圆锥型 NAT (Restricted NAT)
  - 端口受限圆锥型 NAT (Port Restricted NAT)
  - 对称型 NAT (Symmetric NAT)

#### 📡 Network Details
- Peer table with hostname, IP, NAT type, version, latency
- Edge table with connection sources and latency
- Route table showing network paths
- Connection matrix for comprehensive connectivity view

### Technical Highlights

- **Frontend**: React 18 + TypeScript + Vite
- **UI Framework**: Cloudflare Kumo Design System
- **Backend**: Cloudflare Workers + Durable Objects
- **WebSocket**: Native WebSocket API with custom RPC protocol
- **Deployment**: Wrangler CLI for one-command deployment
- **Testing**: Vitest with 100+ tests

---

## Quick Start

### Prerequisites

- Node.js 18+ 
- npm or pnpm
- Cloudflare account (for deployment)
- Wrangler CLI: `npm install -g wrangler`

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/EdgeTier.git
cd EdgeTier

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env and set your admin credentials:
# ADMIN_USERNAME=your_username
# ADMIN_PASSWORD=your_password
```

### Development

```bash
# Start development server
npm run dev

# The dashboard will be available at http://localhost:8787
# The relay server runs in the same process (via Wrangler)
```

### Build

```bash
# Build for production
npm run build

# Run tests
npm test

# Type check
npm run typecheck
```

---

## Dashboard

### Access

1. Navigate to your deployed URL (e.g., `https://edgetier.your-domain.workers.dev`)
2. Log in with your admin credentials
3. View the dashboard at `/dashboard/`

### Features

#### Overview Page
- **Traffic Chart**: Real-time bandwidth visualization with inbound/outbound metrics
- **Peer Status**: Connected peer count and network health
- **Room Management**: View and manage active relay rooms

#### Topology Page
- **Interactive Graph**: 
  - Zoom: Scroll mouse wheel on the graph
  - Pan: Click and drag the canvas
  - Reset: Double-click or use the ⟲ button
  - Controls: +/− buttons in bottom-right corner
- **Node Information**:
  - Click any node to view detailed information
  - Selected nodes highlighted with yellow border
  - Info panel shows NAT type, IP, version, latency
  - Close with × button or click background

#### Network Tables
- **Peers**: All connected nodes with detailed metrics
- **Edges**: Connection relationships and sources
- **Routes**: Network routing paths
- **Connection Matrix**: Full connectivity grid

---

## Deployment

### Deploy to Cloudflare Workers

```bash
# Login to Cloudflare
wrangler login

# Deploy
npm run deploy

# Or manual deploy
wrangler deploy
```

### Configuration

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

#### Environment Variables

Set via Wrangler secrets:

```bash
# Set admin credentials
wrangler secret put ADMIN_USERNAME
wrangler secret put ADMIN_PASSWORD
```

### Custom Domain

```bash
# Add custom domain in Cloudflare dashboard
# Workers & Pages → edgetier → Settings → Triggers → Custom Domains
# Add: edgetier.yourdomain.com
```

---

## Development

### Project Structure

```
EdgeTier/
├── src/
│   ├── dashboard/          # React dashboard application
│   │   ├── components/     # React components
│   │   ├── i18n/          # Internationalization
│   │   └── styles.css     # Global styles
│   ├── easytier/          # EasyTier protocol implementation
│   │   ├── rpc.ts         # RPC protocol with fragmentation
│   │   └── constants.ts   # Protocol constants
│   ├── observer/          # Network state observation
│   │   ├── engine.ts      # Topology computation engine
│   │   └── types.ts       # Type definitions
│   └── worker/            # Cloudflare Workers backend
│       ├── index.ts       # Worker entry point
│       ├── relay-room.ts  # Durable Object for relay
│       └── directory.ts   # Durable Object for discovery
├── wrangler.toml          # Cloudflare Workers configuration
├── package.json           # Dependencies and scripts
└── vite.config.ts         # Vite build configuration
```

### Scripts

```bash
npm run dev          # Development server
npm run build        # Production build
npm run deploy       # Deploy to Cloudflare
npm test             # Run tests
npm run typecheck    # TypeScript type checking
```

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test src/dashboard/peer-display.test.ts
```

Current test coverage: **102 tests across 18 test files** ✅

### Code Quality

- **TypeScript**: Strict mode enabled
- **ESLint**: Code linting (inherited from Cloudflare Kumo)
- **Prettier**: Code formatting
- **Vitest**: Fast unit testing

---

## Architecture

### Relay Protocol

EdgeTier implements a custom WebSocket-based relay protocol:

1. **Connection**: Client connects via WebSocket
2. **Registration**: Client sends peer ID and room information
3. **Routing**: Server forwards messages between peers in the same room
4. **Fragmentation**: Large messages automatically split into chunks
5. **Heartbeat**: Periodic ping/pong for connection health

### Durable Objects

- **RelayRoom**: Manages a single relay room with connected peers
- **Directory**: Global peer directory and room listing

### Dashboard Architecture

- **State Management**: React hooks (useState, useEffect)
- **Real-time Updates**: Polling-based data refresh
- **Graph Rendering**: SVG-based force-directed layout
- **Responsive Design**: Cloudflare Kumo design system

---

## Configuration

### Client Configuration Generator

The dashboard includes a built-in EasyTier client configuration generator:

1. Navigate to **Config** page
2. Set network name, secret, and flags
3. Generate edge peer token (for private relay)
4. Download `.toml` configuration file

### Network Setup

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

## Security

### Authentication

- Session-based authentication with HTTP-only cookies
- Username/password credentials stored as Wrangler secrets
- CSRF protection via SameSite cookie policy

### Best Practices

1. **Change Default Credentials**: Set strong `ADMIN_USERNAME` and `ADMIN_PASSWORD`
2. **Use HTTPS**: Always deploy with custom domain + SSL
3. **Network Secrets**: Use strong, unique secrets for each mesh network
4. **Token Expiration**: Edge peer tokens expire after 24 hours
5. **Private Mode**: Enable `private_mode` flag in EasyTier clients

---

## Performance

### Metrics

- **Latency**: Sub-100ms relay latency on Cloudflare edge
- **Throughput**: Supports 100+ concurrent connections per relay room
- **Scalability**: Automatic scaling via Cloudflare Workers
- **Cold Start**: <50ms on Durable Object wake-up

### Optimization

- **Hibernation**: Durable Objects auto-hibernate when idle
- **Edge Caching**: Static assets cached at edge locations
- **Bundle Size**: ~180KB gzipped JavaScript bundle

---

## Troubleshooting

### Common Issues

**Dashboard shows no data**
- Verify EasyTier clients are connected to the relay
- Check network name matches in client config
- Ensure `private_mode` is enabled in clients

**WebSocket connection failed**
- Verify custom domain SSL certificate is valid
- Check firewall rules allow WebSocket connections
- Ensure token hasn't expired (24-hour limit)

**Topology graph not rendering**
- Clear browser cache (Ctrl+Shift+R)
- Check browser console for errors
- Verify at least 2 peers are connected

### Debug Mode

```bash
# View Wrangler logs
wrangler tail

# Check Durable Object state
wrangler durable-objects list
```

---

## Roadmap

- [ ] Mobile-responsive dashboard
- [ ] Historical metrics and charts
- [ ] Alert system for network issues
- [ ] Multi-admin user management
- [ ] API for programmatic access
- [ ] Docker deployment option

---

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow the existing code style
- Add tests for new features
- Update documentation as needed
- Ensure all tests pass before submitting

---

## License

MIT License - see [LICENSE](LICENSE) file for details

---

## Acknowledgments

- [EasyTier](https://github.com/EasyTier/EasyTier) - The mesh network software that EdgeTier extends
- [Cloudflare Workers](https://workers.cloudflare.com/) - Serverless platform powering EdgeTier
- [Cloudflare Kumo](https://github.com/cloudflare/kumo) - Design system for the dashboard UI

---

## Links

- **EasyTier Project**: https://github.com/EasyTier/EasyTier
- **Cloudflare Workers Docs**: https://developers.cloudflare.com/workers/
- **Durable Objects Docs**: https://developers.cloudflare.com/durable-objects/

---

<div align="center">

Made with ❤️ for the EasyTier community

[⬆ Back to Top](#edgetier)

</div>
