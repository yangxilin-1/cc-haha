# 专业桌面 Agent 与原生 Runtime 演进方案

> 目标：Ycode Desktop 成为一个专业桌面 Agent 产品，体验对标 Codex、Claude Desktop 这一类现代 AI 工作台；CLI 只能作为设计思想参考，不能作为运行依赖。

---

## 一句话定位

Ycode Desktop 不是“CLI 套壳”，而是一个面向真实工作的桌面端 AI Agent 工作台：

```txt
Desktop UI
  -> Desktop Server
  -> Conversation Engine
  -> Provider Adapter / Tool Runtime / Permission Runtime / Project Context
```

CLI 可以提供启发，例如流式事件、工具循环、权限门禁、会话 transcript，但不能继续作为桌面端的执行中心。

产品上，Ycode Desktop 要同时满足两类使用场景：

- **Chat 模式**：像专业 AI 桌面助手一样，快速、干净、稳定地完成对话、解释、写作、分析、模型切换，也可以基于用户粘贴或附件里的代码写代码。
- **Code 模式**：像专业 AI coding agent 一样，理解项目、读写文件、执行命令、管理工具权限、追踪任务和产出。

---

## 当前执行进度

第一批去 CLI 化已经落地到主链路：

- `src/server/runtime/ChatEngine.ts`：Chat 模式通过桌面端原生 provider streaming 完成对话，不启动 CLI 子进程，也不注入 Ycode 自己的身份或行为 system prompt。
- `src/server/runtime/ChatToolRuntime.ts`：Chat 模式接入桌面端会话级工具，例如当前时间、计算器、天气、网页搜索和网页读取；这些工具不绑定项目目录，不能读写用户项目文件。
- `src/server/runtime/CodeEngine.ts`：Code 模式通过桌面端原生 tool loop 运行，负责工具调用、tool result 回传和 transcript 持久化；工具结果已带桌面端 metadata，可展示耗时、退出码、超时、截断和 patch 审计状态；默认不注入 Ycode 自己的身份或行为 system prompt。
- `src/server/runtime/ProviderAdapter.ts`：provider 调用成为显式对象，支持 Anthropic、OpenAI Chat Completions、OpenAI Responses 三类协议入口。
- `src/server/runtime/ToolRuntime.ts`：桌面后端提供 `list_files`、`read_file`、`search_text`、`write_file`、`edit_file`、`apply_patch`、`run_command` 等原生工具，并做工作区边界校验、执行耗时统计、命令退出码/超时/输出截断反馈；`apply_patch` 会生成 forward/reverse patch、文件操作类型和前后 sha256。
- `src/server/runtime/PermissionService.ts`：读工具默认放行，写入和命令执行进入桌面权限审批，支持 session/project/tool 粒度的 always 规则。
- `src/server/runtime/DesktopSlashCommands.ts`：`/` 保留为输入框的桌面快捷文本特性，不再表示 CLI slash command；runtime 不在后端偷偷扩展为隐藏 prompt。
- `src/server/ws/handler.ts`：桌面消息按 session mode 进入 `ChatEngine` 或 `CodeEngine`，消息发送链路不再依赖 `ConversationService` 或 SDK bridge。
- `src/server/services/sessionService.ts`：新会话写入 `YCODE_DATA_DIR` 或桌面 AppData 目录，不再把 CLI 配置目录作为新数据真源；服务层已拆成 orchestration，不再直接承担文件发现和 JSONL 解析。
- `src/server/storage/SessionStore.ts` / `src/server/storage/TranscriptStore.ts`：会话文件生命周期和 transcript 读写/归一化已经拆分，`SessionService` 只保留对 API/runtime 稳定的门面。
- `src/server/services/conversationService.ts`：旧 CLI subprocess manager 已替换为 tombstone，任何误用都会直接失败。
- `desktop/src/stores/desktopTaskStore.ts` / `desktop/src/api/desktopTasks.ts` / `desktop/src/types/desktopTask.ts`：前端任务模型已迁到 desktop runtime 命名。
- `desktop/sidecars/claude-sidecar.ts`：打包 sidecar 只保留 `server` / `adapters` 模式，不再暴露 `cli` 模式。
- `src/server/services/taskService.ts`：任务读取和 reset 已迁到 Ycode Desktop data dir。
- `src/server/api/scheduled-tasks.ts`：手动运行 scheduled task 不再走旧 CLI runner，等待 native scheduler 接管。
- `src/server/services/searchService.ts`：工作区搜索优先 `rg`，无 `rg` 时使用内置扫描，避免 Windows 桌面环境依赖 `grep`。

当前原则：可以继续借鉴 CLI 的 agent 思想，但不能保留 CLI 作为运行时后门。旧文件只允许作为待删除遗留代码或一次性导入旧数据的参考，不允许再进入新消息执行链路。

---

## 产品目标

### 目标用户

| 用户 | 诉求 |
|------|------|
| 独立开发者 | 一个桌面端工具管理多个模型和项目，不想在 CLI、网页、配置文件之间来回切 |
| 专业工程师 | 希望 AI 能理解仓库、修改代码、运行命令、解释 diff，并且所有危险动作都可控 |
| 团队负责人 | 希望会话、项目、provider、权限、任务记录都清楚，可复盘、可迁移、可审计 |
| 多模型用户 | 希望 Anthropic/OpenAI 兼容/本地模型/自定义网关可以统一配置和切换 |

### 产品定位

Ycode Desktop 要成为“桌面端 AI 开发工作台”，而不是“命令行工具的 UI”。

核心特征：

- 打开即用，不要求用户理解 CLI。
- 所有能力都有可视化入口。
- 所有 provider 都通过桌面端配置管理。
- 所有会话都由桌面端存储和索引。
- 所有工具调用都能展示、审批、回放。
- 所有项目上下文都受工作区边界控制。

### 不做什么

- 不做一个只能聊天的轻量壳。
- 不做一个只能代理 CLI 的图形界面。
- 不把 provider 配置交给用户手写 env。
- 不把权限风险隐藏在后台。
- 不把项目数据散落在不可控的外部目录。

---

## 专业桌面端功能基线

下面是 Ycode Desktop 必须具备的产品能力。它们不是“锦上添花”，而是达到 Codex / Claude Desktop 同级桌面体验的基础。

### 1. 应用外壳

| 能力 | 要求 |
|------|------|
| 原生窗口 | Tauri 管理窗口、菜单、标题栏、关闭/最小化/更新 |
| 启动体验 | 冷启动有明确状态，服务不可用时有可恢复错误 |
| 多标签 | 会话、设置、任务等页面可并行打开 |
| 侧边栏 | 按模式、项目、时间组织历史 |
| 全局命令 | 新建会话、切换模式、打开设置、停止生成有稳定入口 |
| 更新机制 | 支持检查更新、安装更新、失败回退提示 |

### 2. Chat 模式

| 能力 | 要求 |
|------|------|
| 纯对话 | 不加载项目、不启用项目工具、不启用 MCP |
| 多 provider | 可选择模型和 provider |
| 流式输出 | token 级或 chunk 级稳定流式 |
| 附件 | 可支持图片/普通文件；Chat 可以分析和改写附件里的代码文本，但不等价于项目读写权限 |
| 会话工具 | 可用时间、计算、天气、网页搜索、网页读取等非项目工具；外部网络工具走权限策略 |
| 历史记录 | 独立于 code 会话展示和搜索 |
| 快速启动 | 不应为 chat 模式启动项目索引、Git、MCP、Shell 能力 |

### 3. Code 模式

| 能力 | 要求 |
|------|------|
| 项目绑定 | 每个 code session 绑定一个明确工作目录 |
| 项目概览 | 显示项目名、Git 分支、变更数、路径可用性 |
| 文件上下文 | 支持文件搜索、引用、读取、片段展示 |
| 代码修改 | 支持 patch/diff 预览、应用、失败提示 |
| 命令执行 | Shell 命令必须走权限审批和输出展示 |
| 任务追踪 | 长任务有状态、阶段、结果，不只显示“正在思考” |
| 结果可复盘 | 工具调用、命令输出、文件修改都进入 transcript |

### 4. Provider 与模型管理

| 能力 | 要求 |
|------|------|
| 多服务商 | Anthropic、OpenAI 兼容、自定义 base URL、本地模型预留 |
| 凭据管理 | token/API key 不应长期明文散放，后续接系统凭据存储 |
| 连接测试 | 保存前能验证 provider 是否可用 |
| 模型发现 | 支持静态预设，也预留 provider list models |
| 运行时快照 | 会话启动时冻结 provider/model/参数，避免切换 provider 污染旧会话 |
| 参数配置 | model、effort、temperature、max tokens 等由桌面端统一管理 |

### 5. 工具与权限

| 能力 | 要求 |
|------|------|
| 工具注册 | 工具由 Ycode 后端注册，不由 CLI 提供 |
| 风险分级 | read/write/execute/external/computer-use |
| 权限弹窗 | 工具执行前展示风险、输入、影响范围 |
| 记住授权 | 支持本次调用/本会话/本项目/全局 |
| 审计记录 | 每次权限请求和决策都写入 transcript |
| 安全默认值 | 默认最小权限，chat 模式默认无工具 |

### 6. 项目与上下文

| 能力 | 要求 |
|------|------|
| 项目索引 | 文件树、搜索、Git 状态可缓存 |
| 工作区边界 | 工具默认只能访问项目目录和显式授权目录 |
| 配置隔离 | 项目配置不能污染 chat 模式和其他项目 |
| 最近项目 | 侧边栏按项目聚合 code sessions |
| 缺失目录处理 | 项目被删除/移动时 UI 明确提示，不能静默失败 |

### 7. 会话与数据

| 能力 | 要求 |
|------|------|
| 桌面端 session store | 新会话由 Ycode 自己管理，不依赖 CLI transcript |
| 事件 transcript | user、assistant、tool、permission、error 都是事件 |
| 搜索与索引 | 支持按标题、内容、项目、provider、时间检索 |
| 附件存储 | 附件有独立存储、引用和清理策略 |
| 迁移导入 | 如需保留历史数据，只做一次性导入工具；不做运行时兼容，不把新会话写回 CLI 路径 |

### 8. 可观测与稳定性

| 能力 | 要求 |
|------|------|
| 日志 | provider 请求、工具执行、权限、错误有结构化日志 |
| 错误分类 | 网络、认证、provider、工具、权限、存储错误分开处理 |
| 取消/停止 | 每个流式请求和工具执行都可取消 |
| 恢复能力 | 应用重启后能恢复会话列表和未完成状态 |
| 性能 | chat 启动轻量，code 索引后台化，不阻塞输入 |
| 打包 | macOS/Windows 安装、更新、权限提示稳定 |

---

## 专业桌面体验标准

### 信息架构

Ycode Desktop 的第一屏不是营销页，也不是配置页，而应该是可工作的桌面工作台。

```txt
┌──────────────────────────────────────────────────────────┐
│ Top Bar: mode switch / provider / model / status          │
├───────────────┬──────────────────────────────────────────┤
│ Sidebar       │ Main Workspace                            │
│               │                                          │
│ New Session   │ Chat or Code session                      │
│ Chat history  │                                          │
│ Projects      │ Messages / tool calls / diffs / tasks     │
│ Tasks         │                                          │
│ Settings      │ Composer                                  │
└───────────────┴──────────────────────────────────────────┘
```

### Chat 模式体验

Chat 模式应该像一个干净、快速的 AI 桌面助手：

- 输入框只保留消息、模型、发送/停止。
- 不显示项目目录选择。
- 可显示模型、附件和会话级权限模式。
- 不显示 file search、MCP、任务栏。
- `/` 只作为输入框可见模板，不在后端扩展隐藏 prompt。
- 历史按时间组织，不按项目组织。
- 错误提示更像聊天产品：认证失败、额度不足、provider 不可达要能指导用户去设置页修复。

### Code 模式体验

Code 模式应该像一个可控的 coding agent 工作台：

- 必须能看到当前项目。
- 必须能看到模型和 provider。
- 必须能看到工具调用和执行结果。
- 文件修改必须有 diff。
- Shell 命令必须有审批和输出。
- 长任务必须有阶段状态。
- 项目目录不可用时必须阻止继续执行工具。

### 设置体验

设置页要专业，不要只是表单堆叠：

- Provider 设置：新增、测试、激活、模型列表、错误诊断。
- 模型设置：默认 chat 模型、默认 code 模型、effort、上下文策略。
- 权限设置：默认权限、项目授权、历史授权、撤销规则。
- 存储设置：数据目录、日志目录、清理缓存、一次性历史导入。
- 高级设置：MCP、Computer Use、本地模型、代理、更新通道。

### 反馈与状态

桌面产品不能让用户猜后台发生了什么：

- 启动中：显示 server/provider/storage 初始化状态。
- 生成中：显示 thinking/streaming/tool executing。
- 执行工具：显示工具名、输入摘要、耗时、结果。
- 等待权限：明确显示需要用户批准。
- 停止生成：立即反馈，后台继续清理也要有状态。
- 失败：错误必须可读、可复制、可定位到设置或日志。

### 设计约束

- UI 要偏工作台，不要做成 landing page。
- 信息密度要适合长时间工作。
- 卡片只用于会话项、工具结果、弹窗，不要卡片套卡片。
- Code 模式强调可扫描：项目、任务、工具、diff 都要有层级。
- Chat 模式强调轻：少控件、少干扰、快速响应。

---

## 设计原则

### 必须坚持

1. **桌面端是主产品形态**
   后端模型、会话、权限、工具、provider 都围绕桌面端体验设计。

2. **CLI 只作为思想参考**
   可以借鉴协议和工程模式，但不能启动 CLI 子进程、不能依赖 CLI 参数、不能复用 CLI 的运行时状态。

3. **模式是后端安全边界**
   `chat` 和 `code` 不是 UI 状态，而是服务端能力策略。

4. **Provider 是一等公民**
   Anthropic、OpenAI 兼容、自定义网关、本地模型都应该通过统一 adapter 接入。

5. **工具执行必须可解释、可拦截、可审计**
   文件读写、Shell、MCP、Computer Use 都必须经过明确的权限和审计链路。

6. **会话数据归桌面端所有**
   会话存储、索引、标题、项目关系、附件、工具结果，都应该由 Ycode Desktop 自己管理。

### 明确禁止

最终形态中不应该存在：

- Server 启动 CLI 子进程处理用户消息。
- 使用 `--tools`、`--permission-mode`、`--session-id` 等 CLI 参数控制桌面端能力。
- 解析 CLI stdout/stderr 作为主协议。
- 把桌面端会话写入 CLI 的 `.claude/projects` 作为唯一真源。
- 通过模拟 CLI 环境变量来切换 provider。
- 让 chat 模式通过“禁用 CLI 工具参数”来实现隔离。

---

## 当前问题

此前实现里，桌面端已经有独立 UI、Provider 设置、WebSocket 服务和会话列表，但核心对话链路仍然偏 CLI bridge：

```txt
Desktop UI
  -> WebSocket
  -> ConversationService
  -> spawn CLI
  -> CLI stream-json
  -> translateCliMessage()
  -> Desktop UI
```

这条主链路已经被 `ChatEngine` / `CodeEngine` 替换。下面这些问题仍然是继续清理旧代码和提升专业度时必须盯住的风险：

| 问题 | 影响 |
|------|------|
| `ConversationService` 已变成 tombstone | 后续可彻底删除文件和剩余历史引用 |
| scheduled task/agent team 等旧服务仍可能 spawn CLI | 后台能力需要统一迁到 desktop task runtime |
| transcript 仍是 JSONL 过渡层 | `SessionStore` / `TranscriptStore` 已拆分，下一步补 `AttachmentStore`、SQLite 索引和 provider/runtime 快照 |
| diff/patch 体验还不完整 | `apply_patch` 已可应用多文件 unified diff、失败不落盘，并生成 reverse patch 审计数据；UI 已能从工具结果发起回滚，并通过同一套权限门禁执行；下一步补更完整 diff 时间线 |
| MCP/Computer Use 尚未接入原生 runtime | 高级工具能力必须走同一套权限和审计链路 |

---

## 目标架构

```txt
┌─────────────────────────────────────────────────────────────┐
│                        Desktop UI                            │
│  React / Zustand / Tauri WebView                             │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP + WebSocket / Tauri IPC
┌──────────────────────────────▼──────────────────────────────┐
│                     Desktop Server                           │
│  API Router / WebSocket Gateway / Auth / App Lifecycle        │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                  Conversation Runtime                         │
│                                                              │
│  ┌──────────────────┐        ┌──────────────────┐           │
│  │    ChatEngine    │        │    CodeEngine    │           │
│  │  pure dialogue   │        │ provider+tools   │           │
│  └────────┬─────────┘        └────────┬─────────┘           │
│           │                           │                     │
│  ┌────────▼───────────────────────────▼────────┐            │
│  │          Model Stream Orchestrator           │            │
│  │ provider streaming / tool loop / cancellation│            │
│  └────────┬───────────────────────────┬────────┘            │
│           │                           │                     │
│  ┌────────▼─────────┐       ┌─────────▼────────┐            │
│  │ Provider Adapters│       │    Tool Runtime   │            │
│  │ Anthropic/OpenAI │       │ Read/Edit/Shell   │            │
│  │ Local/Custom     │       │ MCP/Computer Use  │            │
│  └──────────────────┘       └─────────┬────────┘            │
│                                       │                     │
│                            ┌──────────▼──────────┐          │
│                            │ Permission Service  │          │
│                            └─────────────────────┘          │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                       Storage Layer                          │
│ Session DB / Transcript Events / Project Index / Attachments  │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心模块

### 1. ConversationEngine

统一所有会话运行时，不关心 UI，也不关心具体 provider。

```ts
export interface ConversationEngine {
  sendMessage(input: SendMessageInput): AsyncIterable<ConversationEvent>
  stop(sessionId: string): Promise<void>
  resume(sessionId: string): Promise<void>
}

export type SendMessageInput = {
  sessionId: string
  content: Array<MessagePart>
  runtimeProfile: RuntimeProfileSnapshot
}
```

### 2. ChatEngine

对话模式，允许 provider streaming 和会话级工具。

职责：

- 读取会话历史。
- 构造纯对话 messages，不注入桌面端身份或行为 system prompt。
- 调用 `ProviderAdapter.stream()`。
- 注册 `ChatToolRuntime` 的会话级工具：当前时间、计算器、天气、网页搜索、网页读取。
- 将用户粘贴的代码和普通文件附件作为用户可见内容传给 provider，模型可以基于这些输入写代码或给出补丁文本。
- 写入 transcript。
- 向 WebSocket 输出标准事件。

禁止：

- 不加载项目上下文。
- 不注册项目文件工具。
- 不加载 MCP。
- 不读工作目录。
- 不处理文件搜索和 slash command。
- 不在后端扩展 slash prompt；如果后续做模板，应在输入框中以用户可见文本呈现。

### 3. CodeEngine

项目会话模式，负责 Agent loop。

职责：

- 加载 `ProjectContext`。
- 按 `ModePolicy` 注册工具。
- 调用 provider。
- 解析 tool call。
- 经过 `PermissionService` 审批。
- 执行 `ToolRuntime`。
- 将 tool result 回灌给模型，直到完成或达到限制。
- 向 UI 发送工具执行 metadata，让桌面端能展示耗时、退出码、超时、截断、文件/匹配数量等可复盘信息。
- 不注入 Ycode 身份或行为 system prompt；Code 模型只接收用户可见消息、会话历史、工具 schema 和工具结果。

核心循环：

```txt
user message
  -> build model request
  -> provider stream
  -> text delta: emit to UI
  -> tool call: pause model turn
  -> permission gate
  -> execute tool
  -> emit tool result + metadata to UI
  -> append tool result
  -> continue model loop
  -> message complete
```

### 4. ProviderAdapter

Provider 不能再靠环境变量隐式控制，必须是显式对象。

```ts
export interface ProviderAdapter {
  id: string
  protocol: 'anthropic' | 'openai-compatible' | 'local'
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>
  listModels?(): Promise<ModelInfo[]>
  validate?(): Promise<ProviderHealth>
}
```

每次会话启动时生成快照：

```ts
export type RuntimeProfileSnapshot = {
  providerId: string
  providerType: string
  baseUrl: string
  model: string
  credentialRef: string
  mode: 'chat' | 'code'
  createdAt: string
}
```

这样用户切换 provider 后，旧会话不会被新配置污染。

### 5. ModePolicy

模式策略是服务端能力边界。

```ts
export type ModePolicy = {
  mode: 'chat' | 'code'
  projectRequired: boolean
  toolsEnabled: boolean
  mcpEnabled: boolean
  skillsEnabled: boolean
  fileAttachmentsEnabled: boolean
  shellEnabled: boolean
  computerUseEnabled: boolean
}
```

默认策略：

| 能力 | chat | code |
|------|------|------|
| 纯文本对话 | 是 | 是 |
| 项目工作目录 | 否 | 是 |
| 文件读取 | 否 | 是 |
| 文件编辑 | 否 | 是 |
| Shell | 否 | 是，需权限 |
| 会话级时间/计算 | 是 | 可选 |
| 会话级天气/网页 | 是，需按外部风险策略 | 可选 |
| MCP | 否 | 可配置 |
| Skills | 否 | 可配置 |
| Computer Use | 否 | 可配置 |
| 附件 | 图片/普通文件；只作为输入内容 | 是 |

### 6. ToolRuntime

工具由桌面端实现，不由 CLI 提供。

```ts
export interface ToolRuntime {
  name: string
  schema: ToolSchema
  risk: 'read' | 'write' | 'execute' | 'external'
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult>
}
```

当前工具结果分两层：

- 给模型的 `tool_result.content` 保持为文本，保证 Anthropic/OpenAI-compatible provider 协议稳定。
- 给桌面 UI 和 transcript 的 `tool_result.metadata` 保存执行事实，例如 `durationMs`、`exitCode`、`timedOut`、`outputTruncated`、`filePath`、`matches`、`occurrences`。
- `apply_patch` 额外保存 `metadata.patch.forwardPatch`、`metadata.patch.reversePatch`、每个文件的 `operation/additions/deletions/beforeSha256/afterSha256`。这些字段不会回灌给 provider，只进入桌面事件和会话历史；UI 可基于 reverse patch 做“回滚本次修改”。
- UI 回滚不会绕过安全层：工具卡片发出 `rollback_patch` WebSocket 请求，服务端把 reverse patch 当作新的 `apply_patch` 工具调用处理，仍然需要写入权限审批，并把回滚结果写入 transcript。

这样 Code 模式既能继续完成 provider tool loop，又能在桌面时间线里展示专业 agent 需要的执行状态。

第一批工具建议：

| 工具 | 风险 | 说明 |
|------|------|------|
| `read_file` | read | 读取项目内文件 |
| `list_files` | read | 文件搜索/Glob |
| `search_text` | read | 文本搜索 |
| `edit_file` | write | 精确字符串替换 |
| `apply_patch` | write | 多行/多文件 unified diff，先验证再落盘 |
| `write_file` | write | 新建或覆盖文件 |
| `run_command` | execute | Shell 命令 |
| `web_fetch` | external | 网络请求 |

Chat 模式使用独立的 `ChatToolRuntime`，只包含会话级工具：

| 工具 | 风险 | 说明 |
|------|------|------|
| `get_current_time` | read | 当前日期、时间和时区 |
| `calculate` | read | 数值计算 |
| `get_weather` | external | 天气查询 |
| `web_search` | external | 公共网页搜索 |
| `web_fetch` | external | 读取公共网页文本 |

Chat 工具不能读取项目文件、不能写项目文件、不能执行 Shell。Chat 可以写代码，但代码来源必须是用户输入框、粘贴内容或附件文本；项目级读改跑只属于 Code 模式。

后续再接：

- MCP tool bridge
- Computer Use
- Agent / subtask
- 定时任务工具

### 7. PermissionService

权限不能散在 UI 或工具里，必须集中。

```ts
export interface PermissionService {
  request(decision: PermissionRequest): Promise<PermissionDecision>
  remember(rule: PermissionRule): Promise<void>
  evaluate(request: PermissionRequest): Promise<PermissionDecision | null>
}
```

权限层级：

1. 本次工具调用。
2. 当前会话。
3. 当前项目。
4. 全局用户设置。

权限规则要能回答：

- 谁请求的？
- 哪个 session？
- 哪个项目？
- 哪个工具？
- 输入是什么？
- 风险等级是什么？
- 用户是否已经授权？

### 8. ProjectContextService

只在 code 模式启用。

职责：

- 解析工作目录。
- 检测 Git 仓库、分支、变更。
- 构造项目摘要。
- 提供文件索引。
- 管理 allowlist/sandbox 边界。
- 读取项目级配置，但不能影响 chat 模式。

### 9. TranscriptStore

不要把 CLI JSONL 当作最终真源。建议使用桌面端自己的事件模型：

```ts
export type TranscriptEvent =
  | { type: 'user_message'; sessionId: string; content: MessagePart[]; createdAt: string }
  | { type: 'assistant_delta'; sessionId: string; text: string; createdAt: string }
  | { type: 'assistant_message'; sessionId: string; content: MessagePart[]; model: string; createdAt: string }
  | { type: 'tool_call'; sessionId: string; toolCallId: string; name: string; input: unknown; createdAt: string }
  | { type: 'tool_result'; sessionId: string; toolCallId: string; result: unknown; createdAt: string }
  | { type: 'permission_request'; sessionId: string; requestId: string; payload: unknown; createdAt: string }
  | { type: 'permission_decision'; sessionId: string; requestId: string; decision: unknown; createdAt: string }
  | { type: 'error'; sessionId: string; code: string; message: string; createdAt: string }
```

存储建议：

- 短期：JSONL 文件，路径归 Ycode 管理。
- 中期：SQLite 索引 + JSONL 原始事件。
- 长期：SQLite 作为主索引，附件单独 blob/file 存储。

---

## WebSocket 事件协议

保留流式思想，但事件命名归桌面端所有。

### Client -> Server

| type | 说明 |
|------|------|
| `user_message` | 发送消息 |
| `rollback_patch` | 基于已审计的 reverse patch 发起回滚，服务端按新的 `apply_patch` 工具调用和权限请求处理 |
| `permission_response` | 权限响应 |
| `stop_generation` | 停止当前生成 |
| `set_session_mode` | 仅用于新会话或空会话 |
| `ping` | 心跳 |

### Server -> Client

| type | 说明 |
|------|------|
| `connected` | 已连接 |
| `status` | thinking / streaming / tool_executing / idle |
| `message_start` | assistant 消息开始 |
| `content_delta` | 文本增量 |
| `tool_call` | 工具调用请求 |
| `tool_result` | 工具结果 |
| `permission_request` | 权限弹窗 |
| `message_complete` | 当前 assistant 消息结束 |
| `session_title_updated` | 标题更新 |
| `error` | 错误 |
| `pong` | 心跳 |

关键要求：

- UI 不应该知道事件来自哪个 provider。
- UI 不应该知道是否曾经借鉴过 CLI。
- tool call/result 必须可还原到 transcript。

---

## 目录建议

```txt
src/server/
├── runtime/
│   ├── ConversationEngine.ts
│   ├── ChatEngine.ts
│   ├── CodeEngine.ts
│   ├── ModelStreamOrchestrator.ts
│   └── RuntimeProfileService.ts
│
├── providers/
│   ├── ProviderAdapter.ts
│   ├── AnthropicProvider.ts
│   ├── OpenAICompatibleProvider.ts
│   ├── LocalProvider.ts
│   └── ProviderRegistry.ts
│
├── tools/
│   ├── ToolRuntime.ts
│   ├── builtin/
│   │   ├── readFile.ts
│   │   ├── editFile.ts
│   │   ├── searchText.ts
│   │   └── runCommand.ts
│   └── mcp/
│       └── McpToolBridge.ts
│
├── permissions/
│   ├── PermissionService.ts
│   ├── PermissionPolicy.ts
│   └── PermissionStore.ts
│
├── projects/
│   ├── ProjectContextService.ts
│   ├── ProjectIndexService.ts
│   └── GitService.ts
│
├── storage/
│   ├── SessionStore.ts
│   ├── TranscriptStore.ts
│   ├── AttachmentStore.ts
│   └── SearchIndex.ts
│
└── ws/
    ├── handler.ts
    └── events.ts
```

过渡期可以保留旧文件，但最终 `ConversationService` 不应该继续表示 CLI 子进程管理器。

---

## 迁移路线图

### Phase 0：切断 CLI 运行入口

状态：已执行。

目标：桌面端消息不再通过 CLI bridge 运行。

动作：

- 新增桌面端 `ConversationEngine` 风格接口。
- WebSocket 主链路只调用 `ChatEngine` / `CodeEngine`。
- SDK bridge 不再作为 WebSocket/HTTP 分支暴露。
- 停用 CLI 子进程消息翻译层和 `conversationService` 主链路依赖。

验收：

- 发送任何 chat/code 消息都不会 spawn CLI。
- WebSocket handler 不再翻译 CLI stdout/stderr。
- 新 runtime 事件只表达桌面端状态、文本、工具、权限和完成。

### Phase 1：原生 ChatEngine

状态：已执行，已补会话级 Chat 工具。

目标：chat 模式完全脱离 CLI。

动作：

- 实现 `ProviderAdapter`。
- 实现 Anthropic/OpenAI-compatible streaming。
- 实现 `ChatEngine`。
- 实现 `ChatToolRuntime`：时间、计算、天气、网页搜索、网页读取。
- chat 会话写入 Ycode 自己的 transcript。

验收：

- chat 模式不 spawn CLI。
- chat 模式不读工作目录。
- chat 模式不加载项目文件工具、Shell、MCP、skills。
- chat 模式可以基于输入框文本和附件文件内容写代码。
- provider 切换通过 `RuntimeProfileSnapshot` 生效。

### Phase 2：桌面端会话存储

状态：已执行第一阶段，主链路已切到 Ycode 数据目录，文件生命周期和 transcript 读写已拆成 `SessionStore` / `TranscriptStore`。

目标：会话数据归 Ycode Desktop 所有。

动作：

- 新会话默认写入 `YCODE_DATA_DIR` 或系统 AppData。
- Chat/Code runtime 通过 `SessionService` 自写 transcript。
- `SessionService` 保留 API/runtime 门面，底层拆成 `SessionStore` 和 `TranscriptStore`。
- 后续继续补 `AttachmentStore`、搜索索引、provider/runtime snapshot。
- 历史 CLI JSONL 只做一次性导入器或手动迁移参考，不再作为兼容读取目标。

验收：

- 新建 chat/code 会话不写 `.claude/projects`。
- 会话列表由 Ycode storage 提供。
- 支持标题、项目、模式、provider 快照。
- storage 层有直接单元测试，覆盖 chat/code 路径、session discovery、JSONL 初始化和消息归一化。

### Phase 3：原生 CodeEngine MVP

状态：已执行 MVP，工具结果 metadata 与 `apply_patch` 已接入，继续补专业化能力。

目标：code 模式不用 CLI，也能完成基础代码任务。

动作：

- 实现项目工作目录解析和系统提示。
- 实现基础工具：`list_files`、`read_file`、`search_text`、`write_file`、`edit_file`、`apply_patch`。
- 实现 provider tool loop 和 `tool_result` 回传。
- 实现权限请求和 UI 弹窗闭环。
- 工具执行结果回传 metadata：耗时、退出码、超时、输出截断、文件/匹配/替换数量。
- `apply_patch` 支持多文件 unified diff，并在任何 hunk 失败时阻止部分写入。
- `apply_patch` 生成 patch audit metadata：forward patch、reverse patch、文件操作类型、增删行和前后 sha256。
- 工具结果卡片支持基于 reverse patch 发起回滚，回滚仍经过 `PermissionService` 并作为新的工具事件持久化。

验收：

- code 模式可读取项目文件。
- code 模式可提出 edit_file。
- code 模式可提出 apply_patch 进行多文件修改。
- 用户审批后写入文件。
- transcript 能记录 tool call/result，并保留桌面 metadata；provider 续写历史时只看到协议允许的 tool result 内容。
- UI 能展示工具结果摘要，不只显示一段原始输出。
- UI 能对成功的 `apply_patch` 结果发起权限受控的回滚请求。

### Phase 4：执行与外部能力

状态：部分执行，`run_command` 已进入原生工具层。

目标：补齐专业 code agent 能力。

动作：

- 完善 `run_command` 输出流式展示、退出码、超时和取消。
- 实现 Shell 权限策略。
- 实现 MCP bridge。
- 实现 Computer Use。
- 实现任务/Agent 子流程。

验收：

- Shell 命令有风险识别和审批。
- MCP 可以按项目/用户配置启用。
- Computer Use 不会在 chat 模式出现。

### Phase 5：删除 CLI 运行依赖

状态：主链路已停用，遗留文件继续清理。

目标：彻底成为原生桌面端，代码结构里也不再保留会让人误判的 CLI runtime 入口。

动作：

- 删除或隔离旧 `ConversationService`、scheduled task CLI runner、旧 sdk conversation 测试。
- 删除 CLI 参数转换逻辑和 stdout/stderr 翻译层。
- 删除对 CLI session storage 的新写入。
- 保留一次性历史导入工具时，位置必须在 migration/importer，不得挂到消息主链路。

验收：

- 发送任何桌面端消息都不会 spawn CLI。
- 打包产物不需要 CLI sidecar 才能对话。
- provider、工具、权限、存储都由 Ycode Desktop 后端实现。

---

## 产品里程碑

### M0：可用桌面工作台

这是“能日常用”的最低标准。

- Chat 模式原生运行，不依赖 CLI。
- Provider 配置、测试、激活可用。
- 会话历史归 Ycode 管理。
- WebSocket 流式稳定。
- 设置页能处理认证、模型、provider 错误。
- macOS/Windows dev/build 基本稳定。

### M1：专业 Code Agent

这是“像专业 coding agent”的标准。

- Code 模式原生运行，不依赖 CLI。
- 项目上下文、Git 状态、文件搜索可用。
- read/list/search/edit/write 工具可用。
- 文件修改有 diff 和失败恢复。
- 权限弹窗可用于文件修改和 Shell。
- transcript 可回放 tool call/result。

### M2：完整桌面 Agent 产品

这是“可对标 Codex / Claude Desktop 同类体验”的标准。

- Shell、MCP、Computer Use 可按项目启用。
- 任务状态、后台执行、停止/恢复可用。
- 会话搜索、项目聚合、收藏/归档可用。
- provider runtime snapshot 完整落库。
- 日志、错误诊断、数据清理、一次性历史导入可用。
- 打包、更新、崩溃恢复、权限提示稳定。

### M3：团队与高级能力

这是产品继续拉开差异的阶段。

- 多 Agent / 子任务编排。
- 项目级规则和团队共享配置。
- 本地模型和远程 runtime。
- 审计导出和团队权限策略。
- 插件/工具市场。

---

## 当前已改和下一批文件

已经进入原生桌面主链路：

1. `src/server/runtime/types.ts`
2. `src/server/runtime/ProviderAdapter.ts`
3. `src/server/runtime/ChatEngine.ts`
4. `src/server/runtime/CodeEngine.ts`
5. `src/server/runtime/ToolRuntime.ts`
6. `src/server/runtime/PermissionService.ts`
7. `src/server/runtime/DesktopSlashCommands.ts`
8. `src/server/ws/handler.ts`
9. `src/server/api/sessions.ts`
10. `src/server/services/sessionService.ts`
11. `src/server/storage/SessionStore.ts`
12. `src/server/storage/TranscriptStore.ts`

下一批清理重点：

1. `src/server/services/conversationService.ts`：已替换为 tombstone，后续确认无历史引用后删除文件。
2. `src/server/services/taskService.ts`：已切到 Ycode Desktop data dir；继续补 runtime task 写入来源。
3. `src/server/services/cronScheduler.ts`：移除最后的 CLI runner，改为 native scheduled task runtime。
4. `src/server/__tests__/conversation-service.test.ts` / `conversations.test.ts`：已删除，下一步补 native runtime websocket 测试。
5. Code 模式 patch/diff：`apply_patch`、patch audit metadata 与 UI 回滚入口已落地，下一步补更完整的 diff 时间线。
6. `desktop/sidecars/*` 和打包脚本：已移除 CLI sidecar 模式，后续可把二进制文件名从历史命名迁到 `ycode-sidecar`。

---

## 专业桌面端的完成标准

### Runtime 标准

当下面这些都成立时，Ycode Desktop 才算真正脱离 CLI：

- chat/code 的能力差异由服务端 `ModePolicy` 保证。
- provider 不靠 CLI env 注入，而是由 `ProviderAdapter` 显式调用。
- 会话 transcript 是 Ycode 自己的事件流。
- 工具由 Ycode 后端执行。
- 权限由 Ycode 后端统一裁决，UI 只负责展示和响应。
- 项目上下文由 Ycode 自己索引和管理。
- WebSocket 协议不暴露任何 CLI 概念。
- 桌面端打包后不依赖 CLI 子进程完成核心对话。

### 产品标准

当下面这些都成立时，Ycode Desktop 才算达到专业桌面体验：

- 用户可以不懂 CLI，也能完成 provider 配置、chat、code、权限审批和历史管理。
- Chat 模式足够轻，不出现项目工具、Shell、MCP 等 Code 噪音。
- Code 模式足够强，能完成真实项目里的读、改、跑、解释、复盘。
- 每一次工具调用都有可视化状态、结果和错误。
- 每一次高风险动作都有明确权限边界。
- 每个会话都能追溯 provider、model、项目、工具、权限和结果。
- 应用启动、失败、更新、恢复都有清楚反馈。
- macOS 和 Windows 上的核心体验一致。

---

## 最重要的判断

不要把“去 CLI 化”理解成重写所有东西。

应该保留：

- 当前 React 桌面 UI。
- 当前 provider 配置体验。
- 当前 WebSocket 流式 UI 模型。
- 当前 permission 弹窗体验。
- 当前 session/sidebar/tab 的产品结构。

应该替换：

- CLI 子进程对话内核。
- CLI 参数驱动能力。
- CLI JSONL 作为新会话真源。
- CLI stdout/stderr 翻译协议。

最终形态不是“把 CLI 搬进桌面”，而是：

**把 CLI 里被验证过的 agent 思想，重新实现为 Ycode Desktop 自己的原生后端内核。**
