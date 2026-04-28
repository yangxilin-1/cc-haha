# 双模式架构设计

## 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        桌面应用 (Tauri + React)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    AppShell (主容器)                        │ │
│  │  ┌──────────┐  ┌──────────────────────────────────────┐   │ │
│  │  │ Sidebar  │  │         ContentRouter                 │   │ │
│  │  │          │  │  ┌────────────────────────────────┐   │   │ │
│  │  │ • 会话列表│  │  │    UnifiedSession              │   │   │ │
│  │  │ • 新建按钮│  │  │  ┌──────────────────────────┐  │   │   │ │
│  │  │ • 设置   │  │  │  │   ModeSelector           │  │   │   │ │
│  │  └──────────┘  │  │  │  [Code] [Chat]           │  │   │   │ │
│  │                │  │  └──────────────────────────┘  │   │   │ │
│  │                │  │  ┌──────────────────────────┐  │   │   │ │
│  │                │  │  │  Mode Router             │  │   │   │ │
│  │                │  │  │   ├─ Code → CodeSession  │  │   │   │ │
│  │                │  │  │   └─ Chat → ChatSession  │  │   │   │ │
│  │                │  │  └──────────────────────────┘  │   │   │ │
│  │                │  └────────────────────────────────┘   │   │ │
│  │                └──────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                      状态管理层 (Zustand)                   │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │ │
│  │  │ TabStore │  │ModeStore │  │ChatStore │  │SessionSt │  │ │
│  │  │          │  │          │  │          │  │ore       │  │ │
│  │  │ • 标签管理│  │ • 模式配置│  │ • 消息流 │  │ • 会话列表│  │ │
│  │  │ • 激活状态│  │ • 模式切换│  │ • WebSocket│ │ • CRUD   │  │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      后端 API 服务 (Express)                     │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Session Manager                          │ │
│  │  ┌──────────────────────┐  ┌──────────────────────┐        │ │
│  │  │   Code Engine        │  │   Chat Engine        │        │ │
│  │  │                      │  │                      │        │ │
│  │  │ • File Operations    │  │ • Pure Conversation  │        │ │
│  │  │ • Shell Commands     │  │ • No Tools           │        │ │
│  │  │ • MCP Servers        │  │ • Lightweight        │        │ │
│  │  │ • Skills             │  │                      │        │ │
│  │  │ • Agents             │  │                      │        │ │
│  │  │ • Computer Use       │  │                      │        │ │
│  │  └──────────────────────┘  └──────────────────────┘        │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Claude API (Anthropic)                        │
└─────────────────────────────────────────────────────────────────┘
```

## 数据流图

### 创建会话流程

```
用户点击 "New Session"
    │
    ▼
NewSessionModal 显示
    │
    ├─ 选择 Code 模式
    │   └─ 选择工作目录 (可选)
    │
    └─ 选择 Chat 模式
        └─ 无需工作目录
    │
    ▼
调用 SessionStore.createSession(workDir?)
    │
    ▼
调用 ModeStore.initSessionMode(sessionId, mode, workDir)
    │
    ▼
调用 TabStore.openTab(sessionId, title)
    │
    ▼
调用 ChatStore.connectToSession(sessionId)
    │
    ▼
会话创建完成，显示在界面
```

### 模式切换流程

```
用户点击 ModeSelector 按钮
    │
    ▼
调用 ModeStore.switchMode(sessionId, newMode)
    │
    ├─ 更新本地配置
    │   └─ enableTools = (mode === 'code')
    │
    ├─ 保存到 localStorage
    │
    └─ 触发 UI 重新渲染
    │
    ▼
UnifiedSession 根据新模式路由
    │
    ├─ Code → CodeSession (显示工具栏)
    │
    └─ Chat → ChatSession (纯对话界面)
```

### 消息发送流程

#### Code 模式

```
用户输入消息
    │
    ▼
ChatInput.onSend()
    │
    ▼
ChatStore.sendMessage(sessionId, message)
    │
    ▼
WebSocket 发送到后端
    │
    ▼
Code Engine 处理
    │
    ├─ 解析工具调用
    ├─ 执行文件操作
    ├─ 运行 Shell 命令
    └─ 调用 MCP/Skills
    │
    ▼
流式返回结果
    │
    ▼
ChatStore 更新消息列表
    │
    ▼
MessageList 显示结果
```

#### Chat 模式

```
用户输入消息
    │
    ▼
ChatInput.onSend()
    │
    ▼
ChatStore.sendMessage(sessionId, message)
    │
    ▼
WebSocket 发送到后端
    │
    ▼
Chat Engine 处理
    │
    └─ 纯文本对话 (无工具)
    │
    ▼
流式返回结果
    │
    ▼
ChatStore 更新消息列表
    │
    ▼
MessageList 显示结果
```

## 组件层次结构

```
App
└── AppShell
    ├── Sidebar
    │   ├── SessionList
    │   ├── NavItem (New Session)
    │   └── NewSessionModal
    │       ├── ModeSelection (Code/Chat)
    │       └── WorkDirInput (Code only)
    │
    ├── TabBar
    │   └── Tab[] (多标签)
    │
    └── ContentRouter
        ├── EmptySession (无标签)
        ├── Settings (设置标签)
        ├── ScheduledTasks (定时任务标签)
        └── UnifiedSession (会话标签)
            ├── ModeSelector
            │   ├── [Code] 按钮
            │   └── [Chat] 按钮
            │
            └── Mode Router
                ├── CodeSession (mode === 'code')
                │   └── ActiveSession
                │       ├── MessageList
                │       ├── SessionTaskBar
                │       ├── TeamStatusBar
                │       ├── ChatInput
                │       └── ComputerUsePermissionModal
                │
                └── ChatSession (mode === 'chat')
                    ├── MessageList (简化版)
                    └── ChatInput (简化版)
```

## 状态管理

### ModeStore

```typescript
{
  sessionModes: Map<sessionId, SessionConfig>
  
  getSessionMode(sessionId): SessionMode
  getSessionConfig(sessionId): SessionConfig
  setSessionMode(sessionId, config): void
  switchMode(sessionId, newMode): Promise<void>
  initSessionMode(sessionId, mode, workDir?): void
  restoreModes(): void
  saveModes(): void
}
```

### SessionConfig

```typescript
{
  mode: 'code' | 'chat'
  workingDirectory?: string
  enableTools: boolean
  enableMCP: boolean
  enableSkills: boolean
  enableMemory: boolean
}
```

## 持久化策略

### localStorage 存储

1. **会话模式** (`cc-haha-session-modes`)
   ```json
   [
     ["session-id-1", { "mode": "code", "enableTools": true, ... }],
     ["session-id-2", { "mode": "chat", "enableTools": false, ... }]
   ]
   ```

2. **打开的标签** (`cc-haha-open-tabs`)
   ```json
   {
     "openTabs": [
       { "sessionId": "xxx", "title": "Code Session", "type": "session" }
     ],
     "activeTabId": "xxx"
   }
   ```

### 恢复流程

```
应用启动
    │
    ▼
AppShell.bootstrap()
    │
    ├─ ModeStore.restoreModes()
    │   └─ 从 localStorage 恢复模式配置
    │
    ├─ TabStore.restoreTabs()
    │   └─ 从 localStorage 恢复标签
    │
    └─ ChatStore.connectToSession(activeTabId)
        └─ 连接到激活的会话
```

## 扩展性设计

### 添加新模式

1. 在 `modes/types.ts` 添加类型：
   ```typescript
   export type SessionMode = 'code' | 'chat' | 'debug' | 'review'
   ```

2. 定义能力：
   ```typescript
   export const MODE_CAPABILITIES = {
     debug: {
       fileOperations: true,
       shellCommands: true,
       mcpServers: false,
       skills: false,
       agents: false,
       computerUse: false,
     }
   }
   ```

3. 创建会话组件：
   ```typescript
   // modes/debug/DebugSession.tsx
   export function DebugSession({ sessionId }) {
     // 自定义 UI 和逻辑
   }
   ```

4. 更新路由：
   ```typescript
   // pages/UnifiedSession.tsx
   {mode === 'debug' && <DebugSession sessionId={sessionId} />}
   ```

### 自定义工具集

每个模式可以有不同的工具集合：

```typescript
const MODE_TOOLS = {
  code: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', ...],
  chat: [],
  debug: ['Read', 'Bash', 'Grep'],
  review: ['Read', 'Grep', 'Glob'],
}
```

## 性能优化

1. **懒加载模式组件**
   ```typescript
   const CodeSession = lazy(() => import('./modes/code/CodeSession'))
   const ChatSession = lazy(() => import('./modes/chat/ChatSession'))
   ```

2. **WebSocket 连接复用**
   - 同一会话切换模式时不断开连接
   - 只更新服务端的工具启用状态

3. **状态持久化节流**
   - 使用 debounce 减少 localStorage 写入频率

4. **消息列表虚拟化**
   - 长对话使用虚拟滚动优化性能
