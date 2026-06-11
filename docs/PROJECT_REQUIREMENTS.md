# Cloudflare Tunnel Subscription Manager Requirements

本文档是第一版的产品需求和技术设计基线，目标是把原始想法整理成可以实现、测试和交付的规格。

## 1. 背景和目标

你有多组 Docker Swarm stack compose 服务，需要通过 Cloudflare Tunnel 把容器内服务暴露到公网。

隧道分两类：

1. 固定隧道：使用 Cloudflare Dashboard / Zero Trust 已配置好的固定 Tunnel Token 和域名路由。
2. 临时隧道：使用 TryCloudflare / quick tunnel，每次重启会生成新的随机 `*.trycloudflare.com` 域名。

当前痛点主要集中在临时隧道：

- 临时隧道域名重启后会变化，需要自动记录和上报。
- 多个 Docker Swarm 节点、多个 stack、多个服务会同时存在，需要知道每个临时隧道属于哪个服务、哪个目标地址、部署在哪个节点。
- 隧道健康状态需要持续上报，服务端也要能探测公网可用性。
- 服务端发现隧道不可用后，应能下发“重启隧道”的指令。
- 服务端需要基于这些隧道和代理节点配置，生成 V2Ray/Xray 类客户端、PassWall2 和 sing-box 客户端可消费的订阅地址。
- 管理页面需要能维护代理节点、隧道绑定、优选 IP/域名、分组、订阅 token 和状态。

## 2. 系统边界

项目建议拆成两个可交付程序：

1. `tunnel-agent`
   - 运行在 Docker Swarm 服务里。
   - 基于你提供的 compose 片段改造。
   - 镜像内固定包含 `cloudflared`，运行时不再联网下载二进制。
   - 负责启动固定隧道和多个临时隧道。
   - 负责解析临时隧道公网 URL。
   - 负责向 Cloudflare Worker 上报注册信息、心跳、隧道变更、健康状态和事件。
   - 负责轮询 Worker 端命令并执行重启。
   - 保留本地 `/temp-tunnel/history.log` 和 `/temp-tunnel/tunnels.list` 文件，作为本地兼容输出。

2. `worker-control-plane`
   - 部署在 Cloudflare Workers。
   - 提供 Agent 上报 API。
   - 使用持久化存储保存 agent、tunnel、节点配置、优选 endpoint、分组和订阅配置。
   - 提供简单管理 UI。
   - 提供订阅输出接口。
   - 每 5 分钟执行健康探测，必要时写入重启命令，等待 agent 轮询领取。

## 3. 明确非目标

当前第一版不建议做这些：

- 不把 Quick Tunnel 当成生产级 SLA 通道。固定域名和长期稳定访问优先使用固定隧道。
- 不实现复杂用户系统，管理端先用单个 `ADMIN_TOKEN`。
- 不做多租户隔离。
- 不在 Worker 直接主动连接内网 agent。Worker 无法可靠“推送”到 Swarm 内部容器，第一版采用 agent 主动轮询命令。
- 不自研完整订阅转换器。第一版只实现本项目必须的 tunnel host 覆盖、endpoint 派生、分组过滤和输出编排；协议解析/格式转换优先复用成熟开源项目或抽象成可替换 adapter。
- 不支持所有代理协议的无损解析。第一版优先支持 Cloudflare/CDN 友好的主流代理协议和传输组合，其他格式保留原文或标记为 unsupported。
- 不把 TCP 类目标的公网健康检查做成第一版强保证。第一版 quick tunnel 公网探测按 HTTP/HTTPS 服务实现；TCP 目标可先显示和依赖 agent 侧状态。

## 4. 关键设计判断

### 4.1 Worker 到 agent 的指令通道

Worker 不能假设可以从公网直接访问 Docker Swarm 内部的 agent 控制端口。即使 agent 所在 stack 有隧道，对 agent 自己暴露控制 API 也会增加安全风险。

因此第一版采用：

- Worker 写入 `commands` 表。
- Agent 默认每 120 秒调用 `/api/agent/commands` 拉取待执行命令；收到命令后短暂使用 5 秒快速轮询，避免常态高频请求。
- Agent 执行后调用 `/api/agent/commands/:id/ack` 确认结果。

这样能穿透各种 NAT、Swarm overlay 网络和防火墙环境。

### 4.2 持久化存储

建议使用 Cloudflare D1 作为主数据库：

- 隧道、代理节点、分组、命令、事件日志都是结构化数据。
- 后续需要筛选、排序、关联和审计，D1 比纯 KV 更适合。

KV 可选用于缓存订阅输出：

- 订阅内容是读多写少的派生结果。
- 但 KV 有最终一致性特征，不能作为命令队列或实时状态的唯一数据源。

MVP 默认方案：

- D1：主状态和配置。
- KV：可选缓存，不作为必需依赖。

### 4.3 固定 cloudflared 版本

原 compose 在容器启动时安装依赖并下载 `cloudflared`。这会造成：

- 启动慢。
- 网络不稳定时容器无法启动。
- 每次可能下载到不同版本。
- 供应链和可复现性较弱。

第一版应交付一个自定义镜像：

- 构建时通过 `CLOUDFLARED_VERSION` 固定版本，第一版默认 `2026.6.0`。
- Runtime 镜像包含 `cloudflared`、`sh`、`curl`、`grep`、`sed`、`jq` 或等价工具。
- 运行时只启动和管理隧道，不安装软件、不下载二进制。

### 4.4 健康检查模型

健康状态分三层：

1. Agent 在线状态
   - 根据 agent 心跳判断。
   - 超过 6 分钟未上报为 `stale`，避免默认 120 秒心跳下误判。

2. Tunnel 进程状态
   - Agent 记录 cloudflared 进程是否运行、是否输出了公网 URL、metrics ready 是否可用。

3. 公网可达状态
   - Worker Cron 每 5 分钟探测 HTTP/HTTPS 公网 URL。
   - 默认用 `GET /` 或配置的 `health_path`。
   - 对需要认证的服务，`200/204/301/302/401/403` 可视为“服务可达”，具体可配置。
   - 非 HTTP/HTTPS 目标第一版不做 Worker 公网探测，只展示 agent 上报的本地状态。

重启策略：

### 4.5 后续低请求量状态通道 TODO

当前第一版通过 Worker API 接收 agent 心跳、命令轮询和事件上报。它实现简单、可审计，但当 agent 数量增加或订阅客户端频繁拉取时，Worker 每日请求数会明显增长。

后续可以评估一个低请求量状态通道：

1. Agent 负责本地健康探测
   - Agent 自己探测 `cloudflared` 进程、metrics、quick tunnel URL、目标服务本地可达性和公网 HTTP/HTTPS 可达性。
   - Agent 只把聚合后的状态、最近错误、当前 public host、更新时间写入外部状态通道。
   - 状态变化时立即写；无变化时按较低频率续租。

2. 外部状态通道只保存短期 lease/status
   - 可选方案：Redis/Valkey/Upstash 这类带 TTL 的外部状态存储。
   - Key 建议按 `agent:{agentId}`、`tunnel:{swarmNode}:{targetUrl}`、`command-ack:{id}` 组织。
   - Value 保存精简 JSON：`agentId`、`swarmNodeName`、`targetUrl`、`publicHostname`、`healthStatus`、`probeStatus`、`updatedAt`、`expiresAt`。
   - TTL 到期即视为 stale/offline，不需要 Worker 高频写数据库。

3. Worker 读取方式
   - Worker 不应设计成每 10 秒常驻轮询；Cloudflare Workers 是请求/事件驱动，不适合 sub-minute 常驻调度。
   - Admin UI、订阅生成、手动刷新、低频 Cron 可以按需读取状态通道。
   - D1 仍然保存配置、绑定、分组、命令、审计事件；外部状态通道只保存临时活动状态。

4. Cloudflare KV 评估边界
   - KV 可用于状态缓存或订阅输出缓存，但有最终一致性，不适合作为强实时命令队列或唯一 liveness 来源。
   - 如果让 agent 直接写 KV，需要在 agent 侧保存 Cloudflare API token，安全边界比当前 `AGENT_TOKEN` 更重，应谨慎。
   - 如果 agent 仍通过 Worker 写 KV，则 Worker 请求数不会明显下降，只是减少 D1 写入，不解决本次请求量问题。

5. 更推荐的落地顺序
   - 先保留当前 Worker API 作为控制面和兜底。
   - 新增可选 `STATE_BACKEND=redis` agent 模式，agent 直接写外部 Redis/Upstash TTL key。
   - Worker 新增只读状态适配器，在 `/api/admin/tunnels` 和订阅生成时优先读取 Redis 状态，D1 仅保存稳定配置和历史审计。
   - 验证成熟后，再降低或关闭常规 heartbeat/command poll，仅保留低频兜底上报。

- 单次探测失败只标记 `degraded`。
- 连续失败达到阈值后标记 `unhealthy`。
- 如果距离上次重启超过 cooldown，Worker 写入 `restart_tunnel` 命令。
- Agent 收到命令后只重启对应 target 的 quick tunnel，不影响其他 tunnel。
- 默认保留你现有的 610 秒退避，避免 Cloudflare 429。

### 4.5 Agent 实现语言

原始 compose 片段中的 shell 逻辑可以保留为行为参考，但不建议继续把大段 shell 放进 `CMDSTR`。

第一版建议：

- Agent 主程序默认使用 Go 实现。
- Shell 只保留很薄的 entrypoint 包装，或完全不用 shell。
- Rust 可作为备选，但当前任务主要是进程管理、日志解析、HTTP 上报、命令轮询和本地文件输出，Go 的交付速度和二进制体积更均衡。
- Agent 镜像仍然保持低资源占用：单个静态/近静态二进制 + 固定版本 `cloudflared`。

### 4.6 订阅转换策略

订阅转换不从零手搓完整生态。后续编码阶段先做一个依赖 spike，目标是把“解析/转换”和“本项目业务规则”拆开：

本项目自己负责：

- 从 D1 读取节点、tunnel、优选 endpoint、分组。
- 对节点应用 tunnel host 覆盖。
- 按全局/节点级 endpoint 选择生成派生节点。
- 控制启用状态、分组过滤、命名规则、token 鉴权和缓存。

优先复用或参考的开源项目：

| 项目 | 角色判断 |
| --- | --- |
| `7Sageer/sublink-worker` | 优先候选。它是轻量订阅转换和管理项目，可部署在 Cloudflare Workers/Node/Docker，支持 Shadowsocks、VMess、VLESS、Trojan 等输入和 sing-box、Xray/V2Ray 等客户端输出。许可证 MIT，更适合在本项目中复用或改造 adapter。 |
| `sub-store-org/Sub-Store` | 功能更完整，适合作为格式兼容和管理能力参考；但许可证 AGPL-3.0，且项目较重，直接嵌入要谨慎。 |
| `tindy2013/subconverter` | 很成熟的通用转换服务，适合作为可选外部 converter 后端；但它是独立 C++ 服务/GPL-3.0，不适合直接塞进 Cloudflare Worker。 |

实现决策：

- 第一版 Worker 内置一个 `subscription-adapter` 接口。
- 默认参考 `sublink-worker` 的协议模型，实现本项目需要的 CDN 友好最小 adapter。
- 如果后续 Worker bundle/许可证/可测试性合适，再替换为直接复用 `sublink-worker` 解析/转换能力。
- Worker 保留外部 `SUBCONVERTER_URL` 扩展点，但第一版部署不依赖外部转换服务。
- 任何手写 parser 都必须被限制在明确协议子集内，并配单元测试样例，不能扩展成无边界的转换器。

## 5. Agent 需求

### 5.1 输入环境变量

保留并整理原 compose 的配置：

| 变量 | 必填 | 用途 |
| --- | --- | --- |
| `TUNNEL_TOKEN` | 否 | 固定隧道 token。为空时不启动固定隧道。 |
| `QUICK_TUNNELS` | 否 | 临时隧道目标列表，空格或逗号分隔。 |
| `FIXED_METRICS_PORT_BASE` | 否 | 固定隧道 metrics 端口，默认 `2000`。 |
| `QUICK_METRICS_PORT_BASE` | 否 | 临时隧道 metrics 起始端口，默认 `2100`。 |
| `LOG_FILE` | 否 | 本地历史日志，默认 `/temp-tunnel/history.log`。 |
| `MAP_FILE` | 否 | 本地聚合映射文件，默认 `/temp-tunnel/tunnels.list`。 |
| `WORKER_BASE_URL` | 是 | Worker API 地址。 |
| `AGENT_TOKEN` | 是 | Agent 上报和拉取命令用的共享密钥。 |
| `AGENT_ID` | 否 | 稳定 agent ID；为空时由节点名、stack 名、hostname 派生。 |
| `SWARM_NODE_NAME` | 建议 | Docker Swarm 节点名。可由 `${DEPLOY_NODE}` 注入。 |
| `STACK_NAME` | 建议 | stack 名，用于定位来源。 |
| `SERVICE_NAME` | 建议 | 服务名，用于定位来源。 |
| `HEARTBEAT_INTERVAL` | 否 | 心跳间隔，默认 `120s`。 |
| `COMMAND_POLL_INTERVAL` | 否 | 命令轮询常规间隔，默认 `120s`；收到命令后短暂使用 5 秒快速轮询。 |
| `RESTART_COOLDOWN_SECONDS` | 否 | quick tunnel 自动重启退避，默认 `610`。 |
| `EDGE_IP_VERSION` | 否 | 传给 `cloudflared --edge-ip-version`，支持 `auto`、`4`、`6`；Docker Swarm overlay 网络建议用 `auto`。 |

### 5.2 Agent 注册信息

Agent 启动后向 Worker 注册：

```json
{
  "agentId": "wawo01-main-cloudflared",
  "instanceId": "container-start-uuid",
  "hostname": "cloudflared",
  "swarmNodeName": "wawo01",
  "stackName": "edge",
  "serviceName": "cloudflared",
  "imageVersion": "ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.4",
  "cloudflaredVersion": "2026.x.x",
  "capabilities": {
    "fixedTunnel": true,
    "quickTunnel": true,
    "commandPolling": true
  }
}
```

### 5.3 临时隧道状态

每个 quick target 形成一个独立 tunnel record：

```json
{
  "tunnelKey": "http_s1_2095",
  "type": "quick",
  "targetUrl": "http://s1:2095",
  "publicUrl": "https://example.trycloudflare.com",
  "publicHostname": "example.trycloudflare.com",
  "metricsPort": 2101,
  "status": "running",
  "health": "healthy",
  "lastError": null,
  "restartCount": 2,
  "startedAt": "2026-06-09T12:00:00Z",
  "lastSeenAt": "2026-06-09T12:05:00Z"
}
```

### 5.4 本地文件兼容

继续保留：

- `/temp-tunnel/history.log`
- `/temp-tunnel/tunnels.list`
- `/temp-tunnel/.status_cache/*`

`tunnels.list` 格式保留为：

```text
http://s1:2095 https://example.trycloudflare.com
http://s2:2096 https://another.trycloudflare.com
```

建议修正点：

- `history.log` 应追加写入 `>>`，不应每次覆盖。
- quick tunnel metrics 端口变量应使用 `QUICK_METRICS_PORT_BASE` 派生，原片段中 `METRICS_PORT_BASE` 未定义。
- 每个 quick tunnel 需要独立端口，不应并发争用同一个变量。
- `container_name` 在 Docker Swarm stack 中通常不可依赖，服务定位应使用 `stack/service/node` 元数据。
- healthcheck 不应只检查固定隧道的 `2000` 端口，否则只启用 quick tunnel 时会误报不健康。

## 6. Worker 需求

### 6.1 Worker 环境变量和绑定

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `ADMIN_TOKEN` | Secret | 管理 UI 和 admin API 鉴权。 |
| `AGENT_TOKEN` | Secret | Agent API 鉴权。 |
| `SUBSCRIPTION_TOKEN` | Secret | 订阅地址鉴权。也可后续改成多 token 表。 |
| `DB` | D1 binding | 主数据库。 |
| `SUB_CACHE` | KV binding，可选 | 订阅输出缓存。 |
| `PUBLIC_BASE_URL` | Env | Worker 对外 URL，用于页面展示订阅地址。 |

### 6.2 数据模型草案

`agents`

| 字段 | 说明 |
| --- | --- |
| `id` | 稳定 agent ID。 |
| `instance_id` | 本次容器启动实例 ID。 |
| `hostname` | 容器 hostname。 |
| `swarm_node_name` | Swarm 节点名。 |
| `stack_name` | Stack 名。 |
| `service_name` | 服务名。 |
| `image_version` | agent 镜像版本。 |
| `cloudflared_version` | cloudflared 版本。 |
| `status` | `online/stale/offline`。 |
| `last_seen_at` | 最近心跳时间。 |
| `created_at/updated_at` | 审计时间。 |

`tunnels`

| 字段 | 说明 |
| --- | --- |
| `id` | Worker 端 tunnel ID。 |
| `agent_id` | 所属 agent。 |
| `tunnel_key` | agent 内稳定 key。 |
| `type` | `fixed/quick`。 |
| `target_url` | 容器内目标地址。 |
| `public_url` | 当前公网 URL。 |
| `public_hostname` | 当前公网 host。 |
| `swarm_node_name` | 冗余保存，方便展示。 |
| `metrics_port` | agent 内 metrics 端口。 |
| `process_status` | `starting/running/restarting/stopped/error`。 |
| `health_status` | `unknown/healthy/degraded/unhealthy`。 |
| `last_probe_status` | 最近公网探测结果。 |
| `failure_count` | 连续失败次数。 |
| `restart_count` | 重启次数。 |
| `last_seen_at` | 最近 agent 上报时间。 |
| `last_url_changed_at` | URL 变化时间。 |

`commands`

| 字段 | 说明 |
| --- | --- |
| `id` | 命令 ID。 |
| `agent_id` | 目标 agent。 |
| `tunnel_id` | 可选，目标 tunnel。 |
| `type` | `restart_tunnel/refresh_status/restart_agent`。 |
| `payload_json` | 命令参数。 |
| `status` | `pending/running/succeeded/failed/expired`。 |
| `created_by` | `cron/admin/system`。 |
| `created_at/claimed_at/finished_at` | 生命周期时间。 |
| `result_json` | 执行结果。 |

`proxy_nodes`

| 字段 | 说明 |
| --- | --- |
| `id` | 节点 ID。 |
| `name` | 节点名称，页面第一列展示。 |
| `remark` | 备注。 |
| `source_type` | `v2ray_uri/sing_box_outbound/json/raw`。 |
| `raw_config` | 原始节点信息。 |
| `protocol` | `vless/vmess/trojan/shadowsocks/http/unknown`。 |
| `enabled` | 是否启用。 |
| `use_tunnel` | 是否通过 Cloudflare tunnel 连接。 |
| `selected_tunnel_id` | 选中的 tunnel。 |
| `created_at/updated_at` | 审计时间。 |

`preferred_endpoints`

| 字段 | 说明 |
| --- | --- |
| `id` | endpoint ID。 |
| `type` | `ip/domain`。 |
| `value` | 优选 IP 或优选域名。 |
| `label` | 展示名。 |
| `enabled` | 是否启用。 |
| `scope` | `global/node`。`global` 对所有节点可见，`node` 只对指定节点可见。 |
| `default_selected` | 新节点是否默认选用该 endpoint。 |
| `sort_order` | 排序。 |

`preferred_endpoint_node_scopes`

| 字段 | 说明 |
| --- | --- |
| `endpoint_id` | endpoint ID。 |
| `proxy_node_id` | 被授权可见的代理节点 ID。 |

`proxy_node_endpoint_selections`

| 字段 | 说明 |
| --- | --- |
| `proxy_node_id` | 代理节点 ID。 |
| `endpoint_id` | 被该节点选中的 endpoint。 |
| `enabled` | 是否参与该节点的订阅派生。 |

说明：

- 全局 endpoint 对所有代理节点可见。
- 节点级 endpoint 只对被映射的代理节点可见。
- 每个代理节点在配置页里可以从“全局可见 + 本节点可见”的 endpoint 中多选。
- 未选择任何 endpoint 时，该节点只输出原始/隧道 host 节点，不做优选 IP/域名派生，具体行为可在 UI 上提示。

`groups` / `group_members`

- 用于把原始节点或派生节点规则放进订阅分组。
- 第一版必须支持原始节点级分组：一个 `proxy_node` 属于一个或多个 group，派生出来的 endpoint 节点默认继承这些 group。
- 第一版同时预留 endpoint 过滤规则：group 可选择只包含某些 endpoint 类型或 endpoint ID，例如只包含优选 IP、不包含优选域名。
- 第一版实现分组级 `endpoint_mode`：当订阅 URL 使用 `group=` 且没有显式传 `endpointMode` 时，使用分组保存的模式。
- 如果后续需要精细到每一个生成节点单独分组，再增加 generated-node 级别记录。

`tunnel_events`

- 记录 URL 变化、进程退出、健康探测失败、命令执行、重启、上报错误等。

### 6.3 Agent API

所有 agent API 使用：

```http
Authorization: Bearer <AGENT_TOKEN>
Content-Type: application/json
```

建议接口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/agent/register` | 注册或更新 agent 元数据。 |
| `POST` | `/api/agent/heartbeat` | 上报 agent 和所有 tunnel 当前状态。 |
| `POST` | `/api/agent/events` | 上报事件。 |
| `GET` | `/api/agent/commands?agentId=...&instanceId=...` | 拉取待执行命令。 |
| `POST` | `/api/agent/commands/:id/ack` | 确认命令结果。 |

### 6.4 Admin API

所有 admin API 使用：

```http
Authorization: Bearer <ADMIN_TOKEN>
```

建议接口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/admin/overview` | 总览状态。 |
| `GET` | `/api/admin/agents` | agent 列表。 |
| `GET` | `/api/admin/tunnels` | tunnel 列表。 |
| `POST` | `/api/admin/tunnels/:id/restart` | 手动下发重启命令。 |
| `GET/POST/PATCH/DELETE` | `/api/admin/proxy-nodes` | 管理代理节点。 |
| `GET/POST/PATCH/DELETE` | `/api/admin/preferred-endpoints` | 管理优选 IP/域名。 |
| `GET/POST/PATCH/DELETE` | `/api/admin/groups` | 管理分组。 |
| `GET` | `/api/admin/subscriptions/preview` | 预览订阅结果。 |
| `POST` | `/api/admin/subscriptions/rotate-token` | 轮换订阅 token。 |
| `GET` | `/api/admin/events` | 查看事件日志。 |

### 6.5 订阅 API

订阅地址建议独立于管理 token：

```text
GET /sub/v2ray/:token
GET /sub/passwall2/:token
GET /sub/sing-box/:token
```

可选查询参数：

| 参数 | 用途 |
| --- | --- |
| `group` | 只输出指定分组。 |
| `includeDisabled` | 默认 false。 |
| `endpointMode` | `selected/ip/domain/all/none`，默认 `selected`。`selected` 表示按每个代理节点的多选配置输出。 |

如果指定了 `group` 且 URL 没有显式传 `endpointMode`，订阅生成使用该分组保存的 `endpoint_mode`。

第一版输出规则：

- `v2ray`：输出 base64 编码的 URI 列表，每行一个节点。
- `passwall2`：输出 PassWall2 兼容的 base64 URI 列表，默认使用 Xray/PassWall2 支持度高的协议和字段组合。
- `sing-box`：输出 JSON 配置片段，至少包含 `outbounds`。

## 7. 订阅生成规则

### 7.1 基础概念

`proxy_node` 是用户输入的代理节点原始信息。

`tunnel` 是 agent 上报的公网入口，例如：

```text
https://abc.trycloudflare.com -> http://s1:2095
```

`preferred_endpoint` 是客户端最终连接的优选地址，例如：

```text
优选 IP: 162.159.x.x
优选域名: cf.example.com
```

当某个 `proxy_node.use_tunnel = true` 且选择了某个 tunnel：

- 真实服务入口 host 使用 `tunnel.public_hostname` 作为 TLS SNI / HTTP Host / WebSocket Host 等“Cloudflare 需要转发到的 host”。
- 客户端连接地址可以派生为多个被该节点选中的优选 IP 或优选域名。
- 每个 `proxy_node x selected preferred_endpoint` 生成一个派生节点。
- endpoint 来源可以是全局 endpoint，也可以是只分配给该代理节点的节点级 endpoint。

### 7.2 示例派生逻辑

假设：

- 节点名：`s1-vless`
- 原目标：`http://s1:2095`
- quick tunnel：`abc.trycloudflare.com`
- 优选 IP：`162.159.1.1`, `162.159.1.2`
- 优选域名：`cf-a.example.com`

生成：

```text
s1-vless | 162.159.1.1 | host=abc.trycloudflare.com
s1-vless | 162.159.1.2 | host=abc.trycloudflare.com
s1-vless | cf-a.example.com | host=abc.trycloudflare.com
```

具体映射到 VLESS/VMess/Trojan/sing-box 字段时，应按协议 adapter 实现。

### 7.3 MVP 协议支持建议

第一版支持 Cloudflare/CDN 友好的主流代理协议：

1. `vless://...`
2. `vmess://...`
3. `trojan://...`
4. `ss://...` / Shadowsocks
5. sing-box outbound JSON

第一版优先支持这些传输形态：

- WebSocket over TLS/HTTP。
- HTTP/2 / gRPC 类可被 Cloudflare 路径承载的 HTTP 传输。
- 普通 HTTP/HTTPS 服务入口。

第一版不把这些作为主要目标：

- 依赖直连 TCP/UDP 的 Reality、XTLS Vision、Hysteria、TUIC 等非 HTTP/CDN 友好形态。
- 需要客户端额外运行 `cloudflared access tcp` 的 TCP 私有应用模式。

处理策略：

- 能解析的字段：更新 `server/address`、`sni/server_name`、`host/headers.Host`、节点名称。
- 不能识别的字段：尽量保留。
- 完全不能解析的节点：管理 UI 标记 `unsupported`，不进入订阅或仅原样输出，由用户决定。

### 7.4 PassWall2 兼容策略

PassWall2 第一版按 Xray/PassWall2 常见订阅导入方式处理：

- 提供 `/sub/passwall2/:token` 独立入口。
- 输出 base64 编码的分享 URI 列表。
- 默认包含 `vless/vmess/trojan/shadowsocks`，并优先使用 WebSocket/TLS/HTTP Host/SNI 字段组合。
- 对 sing-box 专属 JSON 字段不输出到 PassWall2 订阅。
- 订阅预览页要能显示“PassWall2 输出节点数”和“被跳过节点数/原因”。

## 8. 管理 UI 需求

UI 目标是“运维控制台”，不是营销页。信息应紧凑、可扫视、可批量管理。

### 8.1 页面结构

建议使用 5 个主页面：

1. Dashboard
   - 在线 agent 数
   - 健康/异常 tunnel 数
   - 最近 URL 变化
   - 最近重启命令
   - 订阅地址复制入口

2. Tunnels
   - 展示固定隧道和临时隧道。
   - 可查看 target、当前公网域名、所属节点、健康状态、最后上报、失败次数。
   - 可手动重启 quick tunnel。

3. Proxy Nodes
   - 管理代理节点原始信息。
   - 每行选择是否使用 tunnel。
   - 通过下拉菜单选择具体 tunnel。
   - 配置备注、分组和该节点选用的优选 IP/域名。

4. Preferred Endpoints
   - 管理全局优选 IP/域名。
   - 管理只分配给特定节点或多个节点的优选 IP/域名。
   - 支持新增、禁用、排序、批量分配给节点。

5. Subscriptions
   - 展示 V2Ray、PassWall2 和 sing-box 订阅地址。
   - 支持复制链接、预览输出、按分组过滤。
   - 支持轮换订阅 token。

### 8.2 Dashboard 草图

```text
+----------------------------------------------------------------+
| Cloudflare Tunnel Subscription Manager      Last sync 12:05:02 |
+----------------------------------------------------------------+
| Agents Online  3 | Healthy Tunnels  8 | Unhealthy 1 | Commands |
+----------------------------------------------------------------+
| Recent Tunnel Changes                                          |
| ----------------------------------------------------------------
| Status | Node   | Target         | Public Host          | Seen  |
| OK     | wawo01 | http://s1:2095 | abc.trycloudflare... | 30s   |
| FAIL   | wawo02 | http://s3:80   | old.trycloudflare... | 7m    |
+----------------------------------------------------------------+
| Subscription Links                                             |
| [V2Ray URL] [Copy] [PassWall2 URL] [Copy] [sing-box URL] [Copy]|
+----------------------------------------------------------------+
```

### 8.3 Tunnels 表格草图

```text
+------------------------------------------------------------------------------------+
| Type  | Health | Node   | Stack | Target         | Public Host        | Actions     |
| quick | OK     | wawo01 | edge  | http://s1:2095 | abc.trycloud...    | Copy Restart |
| quick | FAIL   | wawo02 | edge  | http://s3:80   | def.trycloud...    | Copy Restart |
| fixed | OK     | wawo01 | edge  | token tunnel   | configured in CF   | Copy         |
+------------------------------------------------------------------------------------+
```

### 8.4 Proxy Nodes 表格草图

```text
+---------------------------------------------------------------------------------------------------------------------+
| Node / Remark | Source Summary   | Use Tunnel | Tunnel            | Preferred Endpoints      | Groups   | Generated |
| s1-vless      | vless ws tls ... | on         | wawo01 / s1:2095 | 2 global, 1 node-specific | home,hk  | 6         |
| s2-trojan     | trojan tls ...   | off        | -                 | 1 global                  | backup   | 1         |
+---------------------------------------------------------------------------------------------------------------------+
```

交互规则：

- `Use Tunnel` 是开关。
- `Tunnel` 是下拉菜单，只显示当前已知 tunnel；可按 node/target/health 搜索。
- `Preferred Endpoints` 是多选控件，可选择全局 endpoint 和分配给该节点的 endpoint。
- tunnel unhealthy 时下拉项仍可选，但用状态标识提示。
- `Generated` 点击后打开派生节点预览。

### 8.5 Preferred Endpoints 草图

```text
+--------------------------------------------------------------------------------+
| Preferred Endpoints                                                            |
| Tabs: [Global] [Node-specific]                                                  |
|                                                                                |
| Global                                                                         |
| Type | Value            | Label     | Default | Enabled | Actions             |
| IP   | 162.159.1.1      | CF IP A   | on      | on      | Edit Disable        |
| DNS  | cf-a.example.com | CF DNS A  | off     | on      | Edit Disable        |
|                                                                                |
| Node-specific                                                                  |
| Value            | Type | Visible To                 | Enabled | Actions       |
| 162.159.1.2      | IP   | s1-vless, s3-vmess         | on      | Assign Edit   |
+--------------------------------------------------------------------------------+
```

交互规则：

- `Global` 标签页录入全局 endpoint，对所有代理节点可见。
- `Node-specific` 标签页录入节点级 endpoint，并可批量分配给一个或多个代理节点。
- 代理节点配置页最终决定“该节点实际选用哪些 endpoint”。
- 新节点默认选中 `default_selected = true` 的全局 endpoint。

### 8.6 Subscriptions 草图

```text
+----------------------------------------------------------------+
| Subscriptions                                                  |
| V2Ray     /sub/v2ray/********        [Copy] [Preview]          |
| PassWall2 /sub/passwall2/********    [Copy] [Preview]          |
| sing-box  /sub/sing-box/********     [Copy] [Preview]          |
| Group     [All v]                                              |
| Prefer    [Node selections v]                                  |
+----------------------------------------------------------------+
| Preview                                                        |
| Generated nodes: 24                                            |
| Groups: home, hk, backup                                       |
+----------------------------------------------------------------+
```

## 9. Compose 改造方向

原始结构保留：

- 一个 `cloudflared` 服务。
- 同时支持固定隧道和多个 quick tunnel。
- 使用 volume `/temp-tunnel` 保存本地日志和映射。
- Swarm placement 通过 `${DEPLOY_NODE}` 限制节点。
- quick tunnel 启动间隔和失败后 610 秒退避。

建议改造：

```yaml
cloudflared:
  image: ghcr.io/loongel/cf-tunnel-subscription-manager:v0.1.4
  hostname: cloudflared
  networks:
    - aa_host_bridge
    - cf-net
  volumes:
    - tunnels:/temp-tunnel
  deploy:
    replicas: 1
    placement:
      constraints:
        - node.hostname == ${DEPLOY_NODE}
    restart_policy:
      condition: any
      window: 5m
  environment:
    TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    QUICK_TUNNELS: ${QUICK_TUNNELS}
    FIXED_METRICS_PORT_BASE: 2000
    QUICK_METRICS_PORT_BASE: 2100
    LOG_FILE: /temp-tunnel/history.log
    MAP_FILE: /temp-tunnel/tunnels.list
    WORKER_BASE_URL: ${WORKER_BASE_URL}
    AGENT_TOKEN: ${AGENT_TOKEN}
    SWARM_NODE_NAME: ${DEPLOY_NODE}
    STACK_NAME: ${STACK_NAME}
    SERVICE_NAME: cloudflared
```

注意：

- 后续实现时不再用 `CMDSTR` 塞大段 shell 到 compose 环境变量里。
- compose 应只传配置，启动逻辑放进镜像内的 entrypoint 脚本或小程序。
- Agent 默认用 Go 实现；如果后续发现 Rust 更适合镜像体积或资源占用，可在 Phase 1 spike 后调整。
- Shell 只作为兼容包装，不承载复杂并发、HTTP 上报和命令轮询逻辑。

## 10. 安全需求

- `ADMIN_TOKEN`、`AGENT_TOKEN`、`SUBSCRIPTION_TOKEN` 必须分离。
- Agent API 不接受 admin token。
- Admin API 不接受 agent token。
- 订阅 API 只读，不能调用管理接口。
- 页面登录后 token 只保存在浏览器本地会话，不写入 D1。
- 订阅 token 初始值来自 Worker Secret，轮换后的当前 token 写入 D1 `settings` 表。
- 日志中不输出 `TUNNEL_TOKEN`、`ADMIN_TOKEN`、`AGENT_TOKEN`、订阅 token。
- Worker 对 agent 上报做 schema 校验，拒绝过大的 payload。
- `restart_tunnel` 命令只允许重启已注册 tunnel，不允许任意执行 shell。

## 11. 验收标准

### Agent

- 容器启动时不下载 cloudflared。
- `TUNNEL_TOKEN` 存在时能启动固定隧道。
- `QUICK_TUNNELS` 包含多个目标时，每个目标启动独立 quick tunnel。
- 每个 quick tunnel 生成 URL 后，本地 `tunnels.list` 和 Worker 状态都能更新。
- quick tunnel 重启后，新 URL 能覆盖旧 URL，并保留事件历史。
- Agent 每 30 秒左右上报心跳。
- Agent 能领取 Worker 下发的 restart 命令，并只重启指定 tunnel。
- 没有配置任何 tunnel 时，容器明确失败并输出错误。

### Worker

- 能接收多个 agent 上报并持久化。
- 能展示 agent/tunnel 在线、健康、异常状态。
- Cron 每 5 分钟执行健康探测。
- 连续失败后能创建 restart 命令。
- 管理页面能维护代理节点、全局/节点级优选 endpoint、分组。
- 订阅接口能输出 V2Ray、PassWall2 和 sing-box 三种格式。
- 订阅输出能按分组过滤。
- 订阅转换优先复用成熟开源项目或 adapter，不把完整转换生态手写进本项目。
- token 错误时所有敏感 API 返回 401/403。

### UI

- 首页能一眼看到异常 tunnel。
- Tunnels 页面能复制公网 host、手动重启 quick tunnel。
- Proxy Nodes 页面能为每个节点选择是否使用 tunnel 和选择哪个 tunnel。
- Proxy Nodes 页面能为每个节点多选实际使用的优选 IP/域名。
- Preferred Endpoints 页面能维护全局优选 IP/域名，也能维护只分配给特定节点的优选 IP/域名。
- Subscriptions 页面能复制订阅地址并预览生成数量。

## 12. 建议实施阶段

### Phase 0: 需求确认

- 确认本需求文档。
- 锁定第一版协议支持范围。
- 锁定 D1 作为 Worker 必需存储。
- 确认部署方式和镜像仓库。

### Phase 1: 项目骨架

- Worker 项目初始化。
- Agent 项目初始化。
- Dockerfile 和 compose 示例。
- D1 schema 和迁移脚本。
- 订阅转换依赖 spike：评估 `sublink-worker`、`Sub-Store`、外部 `subconverter` 的复用方式、许可证和 bundle 影响。

### Phase 2: Agent MVP

- 固定版本 cloudflared 镜像。
- 启动 fixed tunnel。
- 启动 quick tunnel。
- 解析 quick tunnel URL。
- 本地文件输出。
- 注册、心跳、事件上报。

### Phase 3: Worker API 和存储

- Agent API。
- Admin API。
- D1 schema。
- Cron 健康探测。
- 命令队列。

### Phase 4: 管理 UI

- Dashboard。
- Tunnels。
- Proxy Nodes。
- Preferred Endpoints。
- Subscriptions。

### Phase 5: 订阅生成

- V2Ray / PassWall2 URI 输出。
- sing-box outbound 生成。
- Shadowsocks / VMess / VLESS / Trojan CDN 友好子集验证。
- 全局和节点级优选 IP/域名派生。
- 分组过滤。

### Phase 6: 联调和交付

- 本地模拟 agent 上报。
- Wrangler 本地 Worker 测试。
- Docker 镜像构建测试。
- Docker Swarm compose 示例。
- README、部署文档、环境变量模板。

## 13. 已确认决策和剩余开放点

### 13.1 已确认决策

1. 第一版代理协议覆盖 CDN 友好的主流协议：VLESS、VMess、Trojan、Shadowsocks，并支持 sing-box outbound JSON。
2. V2Ray 订阅使用 base64 编码的多行分享链接作为默认格式。
3. 必须支持 PassWall2，提供独立 `/sub/passwall2/:token` 订阅入口。
4. 订阅转换不从零手搓，优先调研并复用成熟开源项目；必要时保留外部 converter 后端。
5. quick tunnel 目标按公网 HTTP/HTTPS 服务进行 Worker 探测。
6. `SWARM_NODE_NAME` 直接用 `${DEPLOY_NODE}` 注入。
7. Worker 存储接受 D1 作为必需依赖。
8. 管理 UI 第一版只做单管理员 token。
9. 优选 IP/域名同时支持全局录入和节点级录入；每个代理节点配置时可以自行多选实际使用的 IP/域名。
10. Agent 如果 shell 实现复杂，则改用 Go 或 Rust；默认优先 Go，以降低并发和 HTTP 交互复杂度并保持低资源占用。

### 13.2 生产接入输入

1. 多节点 Swarm 生产部署需要确定镜像发布位置，例如 Docker Hub、GHCR 或私有 registry，并提供对应写入凭据。
2. 真实代理节点样例和固定隧道 token 属于生产数据，应通过管理 UI、API 或运行时环境变量录入，不提交到仓库。
3. 已在 `ssh hd01` 完成远端构建、Worker 部署、真实 Agent 容器测试和临时 Docker Swarm stack 测试。Swarm overlay 网络验证显示 `EDGE_IP_VERSION=auto` 比 IPv6-only 更稳妥。

## 14. 能力和开源项目参考

- [Cloudflare Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)：用于每 5 分钟执行健康探测。
- [Cloudflare D1](https://developers.cloudflare.com/d1/)：适合保存结构化配置、状态和事件。
- [Cloudflare Workers KV](https://developers.cloudflare.com/kv/)：适合读多写少缓存，但不建议作为实时命令队列唯一数据源。
- [TryCloudflare / Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)：适合临时公网入口，域名会随重启变化，不应假设长期稳定。
- [Cloudflare WebSockets](https://developers.cloudflare.com/network/websockets/)：Cloudflare 支持 proxied WebSocket 连接，适合作为 CDN 友好代理传输的重要基础。
- [Cloudflare Tunnel routing](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/routing-to-tunnel/)：Tunnel 可把 Cloudflare 网络流量路由到 `cloudflared` 后面的服务；TCP 会以 WebSocket 方式承载，但第一版公网健康探测仍按 HTTP/HTTPS 限定。
- [7Sageer/sublink-worker](https://github.com/7Sageer/sublink-worker)：轻量订阅转换/管理项目，支持 Cloudflare Workers、Node、Docker 等部署方式，协议和客户端覆盖与本项目接近。
- [sub-store-org/Sub-Store](https://github.com/sub-store-org/Sub-Store)：成熟订阅管理项目，格式覆盖广，但许可证和项目体量需要评估。
- [tindy2013/subconverter](https://github.com/tindy2013/subconverter)：成熟通用订阅转换服务，适合作为可选外部 converter 后端。
- [Openwrt-Passwall/openwrt-passwall2](https://github.com/openwrt-passwall/openwrt-passwall2)：PassWall2 目标客户端参考，第一版以其常见 Xray/sing-box/SS/Trojan/VLESS/VMess 使用方式做兼容验证。
