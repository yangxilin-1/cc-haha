# 单会话模式重构总结

## 概述

成功将桌面应用从多标签模式重构为单会话模式，并实现了 Code 和 Chat 模式的分离。

## 主要变更

### 1. 架构调整

**移除标签页系统**
- 移除 `TabBar` 组件
- 不再使用 `TabStore` 管理多个标签
- 改为单会话模式，一次只能打开一个会话

**模式切换器移到顶部**
- `ModeSelector` 从会话内部移到应用顶部
- 全局控制当前模式（Code/Chat）
- 切换模式时自动过滤显示对应的会话列表

### 2. 状态管理更新

**SessionStore 增强** (`stores/sessionStore.ts`)
```typescript
- currentMode: SessionMode           // 当前模式（code/chat）
- currentView: 'session' | 'settings' | 'scheduled' | 'empty'  // 当前视图
- fetchSessions(project?, mode?)     // 支持按模式过滤
- setCurrentMode(mode)               // 切换模式并重新加载会话
- setCurrentView(view)               // 切换视图
```

**会话类型定义** (`types/session.ts`)
```typescript
export type SessionListItem = {
  // ... 其他字段
  mode?: SessionMode  // 会话模式标记
}
```

### 3. 组件更新

**AppShell** (`components/layout/AppShell.tsx`)
- 移除 `TabBar` 导入和使用
- 添加 `ModeSelector` 到主内容区顶部
- 移除标签恢复逻辑

**ContentRouter** (`components/layout/ContentRouter.tsx`)
- 不再依赖 `TabStore`
- 使用 `SessionStore.currentView` 决定显示内容
- 支持 session/settings/scheduled/empty 四种视图

**Sidebar** (`components/layout/Sidebar.tsx`)
- 使用 `activeSessionId` 替代 `activeTabId`
- 点击会话直接切换，不创建新标签
- 根据 `currentMode` 过滤显示会话列表
- 删除会话时清空活动会话
- Settings 和 Scheduled 按钮使用 `setCurrentView`

**ModeSelector** (`modes/ModeSelector.tsx`)
- 改为全局组件，不需要 sessionId 参数
- 直接调用 `SessionStore.setCurrentMode`
- 切换模式时自动重新加载对应会话列表

**NewSessionModal** (`components/session/NewSessionModal.tsx`)
- 移除 `TabStore` 依赖
- 创建会话后使用 `setActiveSession` 和 `setCurrentView`
- 不再打开新标签

**ChatInput** (`components/chat/ChatInput.tsx`)
- 所有 `activeTabId` 替换为 `activeSessionId`
- 移除 `TabStore` 导入
- 工作目录切换逻辑使用 `setActiveSession`

**MessageList** (`components/chat/MessageList.tsx`)
- 使用 `activeSessionId` 替代 `activeTabId`
- 移除 `TabStore` 依赖

**StatusBar** (`components/layout/StatusBar.tsx`)
- 使用 `activeSessionId` 替代 `activeTabId`
- 移除 `TabStore` 依赖

### 4. 用户体验变化

**会话管理**
- ✅ 一次只能打开一个会话
- ✅ 点击侧边栏会话直接切换
- ✅ 删除当前会话后显示空状态

**模式切换**
- ✅ 顶部显示 [Code] [Chat] 切换器
- ✅ 切换模式时左侧栏自动显示对应模式的会话
- ✅ Code 和 Chat 会话记录完全分离

**视图导航**
- ✅ Settings 和 Scheduled 作为特殊视图
- ✅ 可以在会话、设置、定时任务之间切换

## 文件清单

### 修改的文件
```
desktop/src/
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx              # 移除 TabBar，添加 ModeSelector
│   │   ├── ContentRouter.tsx         # 使用 currentView 路由
│   │   ├── Sidebar.tsx               # 单会话逻辑，模式过滤
│   │   └── StatusBar.tsx             # 使用 activeSessionId
│   ├── chat/
│   │   ├── ChatInput.tsx             # 使用 activeSessionId
│   │   └── MessageList.tsx           # 使用 activeSessionId
│   └── session/
│       └── NewSessionModal.tsx       # 移除标签逻辑
├── modes/
│   └── ModeSelector.tsx              # 改为全局组件
├── stores/
│   └── sessionStore.ts               # 添加 currentMode 和 currentView
├── types/
│   └── session.ts                    # 添加 mode 字段
└── pages/
    └── UnifiedSession.tsx            # 保持不变
```

### 未修改但仍引用 TabStore 的文件
以下文件仍然引用 TabStore，但主要用于测试或不影响核心功能：
- `ActiveSession.tsx` - 可能需要后续更新
- `EmptySession.tsx`
- `PermissionDialog.tsx`
- `AskUserQuestion.tsx`
- `ComputerUsePermissionModal.tsx`
- `StreamingIndicator.tsx`
- `TaskRunsPanel.tsx`
- `PermissionModeSelector.tsx`
- 各种测试文件

## 后续工作

### 必须完成
1. 更新 `ActiveSession.tsx` 使用 `activeSessionId`
2. 更新 `EmptySession.tsx` 移除 TabStore 依赖
3. 更新权限相关组件使用新的会话模型

### 可选优化
1. 添加会话历史导航（前进/后退）
2. 添加快捷键切换最近会话
3. 优化模式切换动画
4. 添加会话搜索功能

## 测试建议

1. **基本功能**
   - 创建 Code 模式会话
   - 创建 Chat 模式会话
   - 在会话之间切换
   - 删除会话

2. **模式切换**
   - 切换到 Chat 模式，验证只显示 Chat 会话
   - 切换到 Code 模式，验证只显示 Code 会话
   - 验证工作目录在 Chat 模式下不显示

3. **视图导航**
   - 打开 Settings
   - 打开 Scheduled Tasks
   - 从特殊视图返回会话

4. **边界情况**
   - 删除当前活动会话
   - 没有会话时的空状态
   - 切换模式时没有对应会话

## 注意事项

1. **TabStore 仍然存在**：虽然核心功能不再使用，但 TabStore 文件仍然存在，某些组件可能还在引用。建议逐步清理。

2. **会话持久化**：当前实现没有持久化活动会话，应用重启后需要重新选择会话。

3. **模式标记**：新创建的会话需要在后端正确标记 mode 字段，否则过滤可能不准确。

4. **向后兼容**：旧的会话数据可能没有 mode 字段，需要处理这种情况（默认为 code 模式）。
