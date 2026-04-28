# 架构设计

> 从 Tauri 窗口到 Desktop Server，再到原生 Chat/Code Engine 的桌面端架构。CLI 只作为历史实现和思想参考，不再是运行时依赖。

---

## 技术栈

### 前端

| 技术 | 版本 | 职责 |
|------|------|------|
| React | 18 | UI 框架 |
| Zustand | 5 | 状态管理 |
| Vite | 6 | 构建工具 |
| Tailwind CSS | 4 | 样式 |
| Shiki | 4 | 代码高亮 |
| Mermaid | 11 | 图表渲染 |
| marked + DOMPurify | - | Markdown 渲染 |
| react-diff-viewer | 4 | Diff 展示 |
| Lucide React | - | 图标 |

### 桌面层

| 技术 | 版本 | 职责 |
|------|------|------|
| Tauri | 2 | 跨平台桌面框架 (Rust) |
| tauri-plugin-shell | 2 | Sidecar 进程管理 |
| tauri-plugin-dialog | 2 | 原生对话框 |
| tauri-plugin-process | 2 | 进程生命周期 |
| tauri-plugin-updater | 2 | 自动更新 |

### 服务端

| 技术 | 职责 |
|------|------|
| Bun | 运行时 + 构建工具 |
| Bun.serve | HTTP/WebSocket 服务器 |

### 字体

- **Inter** — 正文
- **Manrope** — 标题
- **JetBrains Mono** — 代码
- **Material Symbols Outlined** — 图标

---

## 三层架构

```
┌─────────────────────────────────────┐
│         Tauri 主进程 (Rust)           │
│  ┌─────────────────────────────┐    │
│  │   WebView (React App)       │    │  ← 用户界面
│  └───────────┬─────────────────┘    │
│              │ HTTP + WebSocket      │
│  ┌───────────▼─────────────────┐    │
│  │   Desktop Server (Bun)      │    │  ← API 服务 + 原生 runtime
│  │   Port: 动态分配             │    │
│  └───────────┬─────────────────┘    │
│              │ 进程内 runtime 调用    │
│  ┌───────────▼─────────────────┐    │
│  │   ChatEngine / CodeEngine   │    │  ← provider + tools + permission
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │   Adapter Sidecar (可选)    │    │  ← Telegram/飞书接入
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

### 第一层：Tauri 主进程

**职责**：窗口管理、Sidecar 进程编排、原生 API 桥接

核心文件 `desktop/src-tauri/src/lib.rs`，暴露两个 Tauri Command：

| Command | 说明 |
|---------|------|
| `get_server_url` | 前端获取 Server Sidecar 的 HTTP 地址 |
| `restart_adapters_sidecar` | 热重启 Adapter Sidecar（修改配置后生效） |

**状态管理**：

| Struct | 说明 |
|--------|------|
| `ServerState` | `Mutex<ServerStatus>` — 含 server URL 和 Child 进程 handle |
| `AdapterState` | `Mutex<Option<CommandChild>>` — adapter 子进程 handle |

**启动流程**：

1. `reserve_local_port()` — 绑定 `127.0.0.1:0` 获取 OS 随机端口，再释放
2. `start_server_sidecar(port)` — 启动桌面 server sidecar：`ycode-sidecar server --host 127.0.0.1 --port {port}`（旧产物名可能仍在迁移中）
3. `wait_for_server()` — TCP 探活轮询，150ms 间隔，10s 超时
4. WebView 加载 React 应用
5. `start_adapters_sidecar()` — 启动 adapters sidecar（当前产物名仍可能处在 `claude-sidecar` 到 `ycode-sidecar` 的迁移期），注入 `ADAPTER_SERVER_URL` 环境变量

**退出处理**：`RunEvent::Exit` / `ExitRequested` 时自动 kill 两个 sidecar。

**平台差异**：
- **macOS**：overlay titlebar + 自定义菜单（关于、设置 Cmd+,、编辑、窗口）
- **Windows**：`set_decorations(false)` 隐藏原生标题栏，前端自定义渲染 `TitleBar` + `WindowControls`

### 第二层：Desktop Server

**职责**：HTTP REST API + WebSocket 网关 + 会话管理 + 协议代理 + 原生 Chat/Code runtime

核心文件 `src/server/`（项目根目录），分层结构：

```
src/server/
├── index.ts              # 入口
├── server.ts             # HTTP 服务器
├── router.ts             # 路由注册
├── sessionManager.ts     # 会话管理器
├── api/                  # REST 路由层 (14 个模块)
├── services/             # 业务服务层 (14 个模块)
├── runtime/              # ChatEngine / CodeEngine / ToolRuntime / PermissionService
├── storage/              # SessionStore / TranscriptStore
├── ws/                   # WebSocket 处理
├── proxy/                # API 代理（Anthropic/OpenAI 协议转换）
├── middleware/            # auth、cors、errorHandler
└── config/               # Provider 预设
```

### 第三层：原生 Runtime

**职责**：AI 对话核心、工具执行、权限裁决、Agent 循环、transcript 写入

Desktop Server 按 session mode 调用原生 runtime：

| Runtime | 职责 |
|---------|------|
| `ChatEngine` | 对话和会话级工具，不绑定项目，不启用项目文件/Shell/MCP 工具，不注入桌面端身份或行为 system prompt |
| `CodeEngine` | 项目会话、tool loop、工具结果回传、代码任务；默认不注入桌面端身份或行为 system prompt |
| `ProviderAdapter` | 多服务商请求、协议转换、模型选择 |
| `ChatToolRuntime` | Chat 专用非项目工具：时间、计算、天气、网页搜索、网页读取；Chat 可以基于输入框或附件里的代码写代码，但不能读写项目文件 |
| `ToolRuntime` | 文件读写、搜索、patch、命令执行等桌面原生工具，返回耗时、退出码、超时、截断、增删行、reverse patch 和 sha256 等 metadata；patch 回滚也复用同一工具和权限链路 |
| `PermissionService` | 写入和命令执行的审批、always 规则、取消 |
| `SessionStore` | Ycode 数据目录、项目目录、session 文件发现和生命周期 |
| `TranscriptStore` | JSONL 初始化、读取、标题提取、消息归一化和追加写入 |

CLI 子进程、SDK bridge、stdout/stderr 翻译层不属于新的桌面端消息主链路。

### Sidecar 构建

使用 Bun 编译为独立二进制（`desktop/scripts/build-sidecars.ts`）：

目标形态下，sidecar 只保留桌面后台能力：

- `server` — 启动 HTTP/WS 服务和原生 runtime。
- `adapters` — 启动 IM 适配器（解析 `--feishu`/`--telegram` 参数，检查凭据后按需加载）。

旧 `cli` sidecar 模式属于迁移清理项，不应被新功能引用。

编译产物放置在 `desktop/src-tauri/binaries/`，Tauri 打包时自动包含。

---

## WebSocket 通信协议

### 连接地址

```
ws://127.0.0.1:{port}/ws/{sessionId}
```

前端通过 `WebSocketManager`（per-session 连接）管理，支持自动重连、消息队列缓冲、ping 心跳保活。

### 客户端 → 服务端

| type | 说明 |
|------|------|
| `user_message` | 用户消息（含 content, attachments） |
| `rollback_patch` | 从工具结果卡片发起 patch 回滚，携带 `originalToolUseId` 和 `reversePatch`，服务端按新的 `apply_patch` 工具调用处理 |
| `permission_response` | 权限审批（requestId, allowed, rule） |
| `set_permission_mode` | 切换权限模式 |
| `stop_generation` | 停止生成 |
| `ping` | 心跳 |

### 服务端 → 客户端

| type | 说明 |
|------|------|
| `connected` | 连接成功 |
| `status` | 状态变更（thinking/generating） |
| `content_start` / `content_delta` | 流式文本 |
| `thinking` | Extended Thinking |
| `tool_use_complete` | 工具调用就绪 |
| `tool_result` | 工具执行结果，附带桌面端 metadata；provider 续写历史时只使用协议允许的 tool result 内容 |
| `permission_request` | 权限请求 |
| `message_complete` | 消息完成（含 Token 统计） |
| `error` | 错误通知 |
| `session_title_updated` | 标题更新 |
| `team_update` / `team_created` / `team_deleted` | 团队事件 |
| `task_update` | 任务变更 |
| `pong` | 心跳响应 |

### 连接管理

- **心跳**：30s 间隔 ping/pong
- **重连**：指数退避 `min(1000ms × 2^n, 30000ms)`，最多 10 次
- **缓冲**：未连接时消息暂存队列，恢复后自动发送

---

## HTTP API

### 会话

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/sessions` | 列表（支持 project/limit/offset 筛选） |
| `POST` | `/api/sessions` | 创建 |
| `GET` | `/api/sessions/:id/messages` | 历史消息 |
| `PATCH` | `/api/sessions/:id` | 重命名 |
| `DELETE` | `/api/sessions/:id` | 删除 |
| `GET` | `/api/sessions/:id/git-info` | Git 信息 |
| `GET` | `/api/sessions/:id/slash-commands` | 可用斜杠命令 |
| `GET` | `/api/sessions/recent-projects` | 最近项目 |

### 模型与提供商

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET/PUT` | `/api/models/current` | 当前模型 |
| `GET` | `/api/models` | 可用模型列表 |
| `GET/PUT` | `/api/effort` | Effort 级别 |
| `GET/POST/PUT/DELETE` | `/api/providers` | 提供商 CRUD |
| `POST` | `/api/providers/:id/activate` | 激活 |
| `POST` | `/api/providers/:id/test` | 测试连接 |
| `GET` | `/api/providers/presets` | 预设列表 |

### 定时任务

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET/POST/PUT/DELETE` | `/api/scheduled-tasks` | 任务 CRUD |
| `POST` | `/api/scheduled-tasks/:id/run` | 手动运行 |
| `GET` | `/api/scheduled-tasks/runs` | 运行记录 |

### 其他

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/teams` | Agent 团队 |
| `GET` | `/api/teams/:name/members/:agentId/transcript` | 成员转录 |
| `GET` | `/api/agents` | Agent 定义 |
| `GET` | `/api/skills` | 技能列表 |
| `GET/PUT` | `/api/adapters` | 适配器配置 |
| `GET/PUT` | `/api/settings/user` | 用户设置 |
| `GET/PUT` | `/api/permissions/mode` | 权限模式 |
| `GET` | `/api/tasks/lists` | 桌面任务清单 |
| `GET` | `/health` | 健康检查 |

---

## 状态管理

使用 Zustand，按领域拆分为 12 个 Store：

| Store | 核心状态 |
|-------|----------|
| `chatStore` | per-session 消息、流式状态、权限请求、Token 统计 |
| `sessionStore` | 会话列表、activeSessionId、项目筛选 |
| `tabStore` | 标签页顺序（localStorage 持久化） |
| `settingsStore` | 权限模式、当前模型、effort、语言 |
| `providerStore` | Provider 列表、activeId |
| `uiStore` | 主题、侧边栏、activeView、Toast、设置标签页 |
| `taskStore` | 定时任务、运行记录 |
| `teamStore` | 团队列表、成员转录轮询 |
| `agentStore` | Agent 定义列表 |
| `skillStore` | 技能元数据、详情 |
| `adapterStore` | 适配器配置、配对码 |
| `desktopTaskStore` | per-session 桌面任务追踪 |

### 数据流

```
用户操作 → Component → Store → API/WebSocket → Server → Store → Component 重渲染
```

### 持久化

| 数据 | 存储 |
|------|------|
| 标签页状态 | `localStorage` |
| 语言偏好 | `localStorage` |
| 会话数据 | Ycode Desktop data dir 下的 Server JSONL，由 `SessionStore` / `TranscriptStore` 管理 |
| 设置 | Server API |
| 适配器配置 | Ycode Desktop data dir 下的 `adapters.json` |

---

## 协议代理层

Server 内置代理层（`src/server/proxy/`），统一不同 AI 提供商的 API 格式。

### 支持格式

| 格式 | 典型提供商 |
|------|-----------|
| `anthropic` | Anthropic、OpenRouter、MiniMax |
| `openai_chat` | OpenAI、DeepSeek、Ollama |
| `openai_responses` | OpenAI Responses API |

### 模型映射

每个 Provider 配置 4 个模型槽位：`main`、`haiku`、`sonnet`、`opus`，前端按槽位名调用，代理层自动映射为实际模型名。

---

## 适配器架构

适配器系统让 Telegram/飞书等 IM 平台接入 Ycode Desktop runtime。

```
IM 平台 → Adapter 进程 → HTTP + WebSocket → Desktop Server → ChatEngine/CodeEngine
```

### 共享模块 `adapters/common/`

| 模块 | 职责 |
|------|------|
| `config.ts` | 配置加载（env > JSON > 默认值） |
| `ws-bridge.ts` | WebSocket 桥接（心跳、重连、消息路由） |
| `pairing.ts` | 用户配对（6 位安全码、速率限制） |
| `session-store.ts` | Chat → Session 映射持久化 |
| `message-buffer.ts` | 流式缓冲（500ms / 200 字符阈值） |
| `message-dedup.ts` | 消息去重 |
| `chat-queue.ts` | 同一 Chat 消息串行队列 |
| `http-client.ts` | HTTP 客户端 |

### 分片限制

- Telegram: 4000 字符/消息
- 飞书: 30000 字符/消息

---

## 项目目录结构

```
desktop/
├── src/                              # React 前端
│   ├── api/                         #   API 客户端 (15 个模块)
│   ├── components/
│   │   ├── layout/                  #   AppShell, Sidebar, TabBar, TitleBar,
│   │   │                            #   WindowControls, StatusBar, ContentRouter,
│   │   │                            #   ProjectFilter
│   │   ├── chat/                    #   ChatInput, MessageList, AssistantMessage,
│   │   │                            #   ToolCallBlock, ToolCallGroup, ThinkingBlock,
│   │   │                            #   PermissionDialog, CodeViewer, DiffViewer,
│   │   │                            #   ImageGalleryModal, StreamingIndicator ...
│   │   ├── shared/                  #   Button, Modal, Toast, Spinner,
│   │   │                            #   UpdateChecker, DirectoryPicker ...
│   │   ├── controls/                #   ModelSelector, PermissionModeSelector
│   │   ├── markdown/                #   MarkdownRenderer, MermaidRenderer
│   │   ├── skills/                  #   SkillList, SkillDetail
│   │   ├── tasks/                   #   TaskList, TaskRow, NewTaskModal,
│   │   │                            #   DayOfWeekPicker, PromptEditor ...
│   │   └── teams/                   #   TeamStatusBar
│   ├── pages/                       #   ActiveSession, EmptySession, Settings,
│   │                                #   AdapterSettings, AgentTeams, ScheduledTasks,
│   │                                #   ComputerUseSettings, ToolInspection ...
│   ├── stores/                      #   12 个 Zustand store
│   ├── types/                       #   TypeScript 类型 (9 个模块)
│   ├── hooks/                       #   useKeyboardShortcuts
│   ├── i18n/                        #   中/英 国际化
│   ├── config/                      #   providerPresets, spinnerVerbs
│   └── lib/                         #   desktopRuntime, cronDescribe, parseRunOutput
├── src-tauri/
│   ├── src/main.rs                  #   入口
│   ├── src/lib.rs                   #   核心（~415 行）
│   ├── Cargo.toml
│   └── tauri.conf.json
├── sidecars/
│   └── ycode-sidecar.ts             #   目标入口 (server/adapters)，旧命名待迁移
└── scripts/
    ├── build-sidecars.ts
    ├── build-macos-arm64.sh
    └── build-windows-x64.ps1

src/server/                           # 服务端（项目根目录）
├── api/                             #   REST 路由 (14 个模块)
├── services/                        #   业务服务 (14 个模块)
├── runtime/                         #   原生 Chat/Code runtime
├── ws/                              #   WebSocket 处理
├── proxy/                           #   协议代理转换
├── middleware/                      #   auth, cors, errorHandler
└── config/                          #   Provider 预设

adapters/                             # IM 适配器
├── common/                          #   共享模块 (8 个)
├── telegram/                        #   Telegram Bot
└── feishu/                          #   飞书 Bot
```
