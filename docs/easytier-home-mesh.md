# EasyTier 异地组网配置记录

## 家庭节点

- 运行位置：家庭 Kwrt/OpenWrt 容器软路由
- 公网域名：`relay.example.net`
- 公网 IPv4：`203.0.113.10`
- EasyTier 版本：`2.6.4-8428a89d`
- 网络名：`home-mesh`
- 网络密钥：`REPLACE_WITH_EASYTIER_NETWORK_SECRET`
- 家庭节点虚拟 IP：`10.144.1.1/24`
- 家庭节点名：`home-kwrt`
- 家庭 LAN 网段：`192.168.1.0/24`
- 家庭节点监听：
  - `udp://0.0.0.0:11010`
  - `tcp://0.0.0.0:11010`
- 公网映射：
  - `udp://relay.example.net:11010`
  - `tcp://relay.example.net:11010`
- 管理 RPC：`127.0.0.1:15888`
- OpenWrt 服务文件：`/etc/init.d/easytier`
- 密钥文件：`/etc/easytier/example.env`

## 家庭节点当前验证结果

已验证：

```text
service: running
tun0: 10.144.1.1/24
proxy_cidrs: 192.168.1.0/24
public ipv4: 203.0.113.10
NAT type: NoPAT
listener: 11010/udp, 11010/tcp
```

## 异地 LAN 网关接入模板

假设异地 LAN 是 `192.168.2.0/24`，异地节点虚拟 IP 是 `10.144.1.2`：

```sh
easytier-core \
  --network-name home-mesh \
  --network-secret 'REPLACE_WITH_EASYTIER_NETWORK_SECRET' \
  --ipv4 10.144.1.2 \
  --hostname remote-site-1 \
  -n 192.168.2.0/24 \
  -p udp://relay.example.net:11010 \
  -p tcp://relay.example.net:11010 \
  --private-mode true
```

## 单设备测试接入模板

```sh
easytier-core \
  --network-name home-mesh \
  --network-secret 'REPLACE_WITH_EASYTIER_NETWORK_SECRET' \
  --ipv4 10.144.1.10 \
  --hostname local-test \
  -p udp://relay.example.net:11010 \
  -p tcp://relay.example.net:11010 \
  --private-mode true
```

## 验证命令

```sh
easytier-cli node
easytier-cli peer
easytier-cli route
ping 10.144.1.1
ping 192.168.1.30
```

重点检查：

- `easytier-cli peer` 中是否出现 `home-kwrt`
- `easytier-cli route` 中是否出现 `192.168.1.0/24`
- `tunnel` 是否优先为 P2P/直连路径

## 后续建议

当前密钥已在会话和本文档中明文记录。异地节点全部接入后，建议轮换密钥并更新本文档。
