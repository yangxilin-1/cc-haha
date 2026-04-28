# 双模式架构使用指南

## 概述

桌面版现在支持两种会话模式：

- **Code 模式**：完整的 CLI 功能，包括文件操作、Shell 命令、MCP 服务器、Skills、Agents 等
- **Chat 模式**：纯对话模式，无工具调用，适合日常问答和轻量级对话

## 功能对比

| 功能 | Code 模式 | Chat 模式 |
|------|----------|----------|
| 文件操作 | ✅ | ❌ |
| Shell 命令 | ✅ | ❌ |
| MCP 服务器 | ✅ | ❌ |
| Skills | ✅ | ❌ |
| Agents | ✅ | ❌ |
| Computer Use | ✅ | ❌ |
| 纯对话 | ✅ | ✅ |
| 记忆系统 | ✅ | ✅ |

## 使用方法

### 1. 创建新会话

点击侧边栏的 "New Session" 按钮，会弹出模式选择对话框：

- 选择 **Code** 模式：需要指定工作目录（可选），适合代码开发
- 选择 **Chat** 模式：无需工作目录，适合纯对话

### 2. 切换模式

在会话顶部有模式切换器，可以随时在 Code 和 Chat 模式之间切换：

- 从 Code 切换到 Chat：禁用所有工具，保留历史消息
- 从 Chat 切换到 Code：启用所有工具，保留历史消息

### 3. 模式持久化

- 每个会话的模式配置会自动保存到 localStorage
- 重启应用后，会话会恢复到上次的模式

## 架构说明

### 文件结构

```
desktop/src/
├── modes/
│   ├── types.ts              # 模式类型定义
│   ├── ModeSelector.tsx      # 模式切换器
│   ├── code/
│   │   └── CodeSession.tsx   # Code 模式会话
│   └── chat/
│       └── ChatSession.tsx   # Chat 模式会话
├── stores/
│   └── modeStore.ts          # 模式状态管理
├── pages/
│   └── UnifiedSession.tsx    # 统一会话路由
└── components/
    └── session/
        └── NewSessionModal.tsx  # 新建会话模态框
```

### 核心组件

1. **ModeStore** (`stores/modeStore.ts`)
   - 管理每个会话的模式配置
   - 提供模式切换和持久化功能

2. **UnifiedSession** (`pages/UnifiedSession.tsx`)
   - 根据会话模式路由到不同的会话组件
   - 显示模式切换器

3. **CodeSession** (`modes/code/CodeSession.tsx`)
   - 复用现有的 ActiveSession 组件
   - 包含所有 CLI 工具能力

4. **ChatSession** (`modes/chat/ChatSession.tsx`)
   - 简化版会话界面
   - 只显示消息列表和输入框，无工具调用

5. **NewSessionModal** (`components/session/NewSessionModal.tsx`)
   - 创建会话时选择模式
   - Code 模式可选择工作目录

## 开发说明

### 添加新模式

1. 在 `modes/types.ts` 中添加新的模式类型
2. 更新 `MODE_CAPABILITIES` 定义新模式的能力
3. 创建新模式的会话组件
4. 在 `UnifiedSession.tsx` 中添加路由

### 自定义模式行为

在 `modeStore.ts` 中的 `switchMode` 方法可以自定义模式切换时的行为，例如：

```typescript
switchMode: async (sessionId, newMode) => {
  // 自定义逻辑
  if (newMode === 'chat') {
    // 禁用工具
  } else {
    // 启用工具
  }
}
```

## 注意事项

1. **工作目录**：Chat 模式不需要工作目录，Code 模式建议指定
2. **历史消息**：切换模式时会保留所有历史消息
3. **工具调用**：Chat 模式下的历史工具调用仍会显示，但不会执行新的工具调用
4. **性能**：Chat 模式更轻量，适合长时间对话

## 未来扩展

可以考虑添加更多模式：

- **Debug 模式**：专注于调试和问题排查
- **Review 模式**：代码审查和建议
- **Learn 模式**：教学和解释代码
- **Test 模式**：测试生成和执行

每个模式可以有不同的工具集和 UI 布局。
