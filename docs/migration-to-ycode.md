# cc-haha → Ycode 重命名 & 数据目录迁移方案

## 一、目标

1. 项目品牌从 `cc-haha` / `Claude Code Haha` 统一改为 `Ycode`
2. 自有数据目录从 `~/.claude/cc-haha/` 迁移到独立可配置路径，默认 `D:\Ycode\`
3. 保持对 `~/.claude/settings.json` 的只读兼容（API 认证）
4. 保持对 `~/.claude/projects/` 的共享读写（会话 JSONL 互通）

---

## 二、数据目录规划

### 最终目录结构

```
D:\Ycode\                              ← YCODE_DATA_DIR（可配置）
├── settings.json                      ← provider env vars
├── providers.json                     ← provider 索引
├── computer-use-config.json           ← 授权应用配置
├── adapters.json                      ← IM 适配器（原 ~/.claude/adapters.json）
├── server-sessions.json               ← 会话元数据（原 ~/.claude/server-sessions.json）
├── scheduled_tasks.json               ← 定时任务（原 ~/.claude/scheduled_tasks.json）
├── scheduled_tasks_log.json           ← 定时任务日志
├── agents/                            ← Agent YAML（原 ~/.claude/agents/）
├── tasks/                             ← 任务数据（原 ~/.claude/tasks/）
└── teams/                             ← 团队配置（原 ~/.claude/teams/）

~/.claude/                             ← 官方目录，只读 + 共享
├── settings.json                      ← 只读：API key / auth token
└── projects/                          ← 共享：会话 JSONL 文件
```

### 路径优先级

```
YCODE_DATA_DIR  →  D:\Ycode\（默认）
```

不再 fallback 到 `~/.claude/cc-haha/`，彻底独立。

---

## 三、需要新增的文件

### 3.1 `src/server/utils/paths.ts`

统一路径工具函数，替换所有 service 中散落的路径拼接。

```typescript
import path from 'path'
import os from 'os'

/** 官方 Claude 配置目录（只读，用于读取 API 认证） */
export function getClaudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

/** Ycode 自有数据目录 */
export function getAppDataDir(): string {
  return process.env.YCODE_DATA_DIR || 'D:\\Ycode'
}

/** 官方会话目录（共享读写） */
export function getProjectsDir(): string {
  return path.join(getClaudeHome(), 'projects')
}
```

---

## 四、重命名清单

### 4.1 品牌名替换（全局文本替换）

| 原值 | 新值 | 涉及范围 |
|------|------|----------|
| `Claude Code Haha` | `Ycode` | 产品名、窗口标题、文档 |
| `claude-code-haha` | `ycode` | Tauri identifier、GitHub URL slug |
| `cc-haha` | `ycode` | 目录名、配置路径、文档引用 |
| `CC_HAHA` | `YCODE` | 环境变量前缀 |

### 4.2 文件/目录重命名

| 原路径 | 新路径 |
|--------|--------|
| `bin/claude-haha` | `bin/ycode` |
| `src/server/api/haha-oauth.ts` | `src/server/api/ycode-oauth.ts` |
| `src/server/services/hahaOAuthService.ts` | `src/server/services/ycodeOAuthService.ts` |
| `src/server/__tests__/haha-oauth-service.test.ts` | `src/server/__tests__/ycode-oauth-service.test.ts` |
| `src/server/__tests__/haha-oauth-api.test.ts` | `src/server/__tests__/ycode-oauth-api.test.ts` |
| `desktop/src/stores/hahaOAuthStore.ts` | `desktop/src/stores/ycodeOAuthStore.ts` |
| `desktop/src/stores/hahaOAuthStore.test.ts` | `desktop/src/stores/ycodeOAuthStore.test.ts` |
| `desktop/src/api/hahaOAuth.ts` | `desktop/src/api/ycodeOAuth.ts` |

### 4.3 代码内符号重命名

| 原符号 | 新符号 | 文件数 |
|--------|--------|--------|
| `hahaOAuth` | `ycodeOAuth` | ~8 |
| `HahaOAuth` | `YcodeOAuth` | ~5 |
| `haha-oauth` | `ycode-oauth` | ~6 |
| `claude-haha` (npm script) | `ycode` | package.json |

### 4.4 配置文件修改

#### `package.json`
```diff
- "claude-haha": "./bin/claude-haha"
+ "ycode": "./bin/ycode"

- "claude-haha": "bun run ./bin/claude-haha",
- "start": "bun run ./bin/claude-haha",
+ "ycode": "bun run ./bin/ycode",
+ "start": "bun run ./bin/ycode",
```

#### `desktop/src-tauri/tauri.conf.json`
```diff
- "productName": "Claude Code Haha",
- "identifier": "com.claude-code-haha.desktop",
+ "productName": "Ycode",
+ "identifier": "com.ycode.desktop",
```

#### GitHub updater endpoint
```diff
- "https://github.com/NanmiCoder/cc-haha/releases/latest/download/latest.json"
+ "https://github.com/NanmiCoder/Ycode/releases/latest/download/latest.json"
```

---

## 五、数据目录路径替换清单

以下文件中的 `~/.claude/cc-haha/` 或直接写在 `~/.claude/` 下的自有文件路径，需改为调用 `getAppDataDir()`：

| 文件 | 当前路径 | 改为 |
|------|----------|------|
| `src/server/services/providerService.ts` | `~/.claude/cc-haha/providers.json` | `getAppDataDir()/providers.json` |
| `src/server/services/providerService.ts` | `~/.claude/cc-haha/settings.json` | `getAppDataDir()/settings.json` |
| `src/server/services/adapterService.ts` | `~/.claude/adapters.json` | `getAppDataDir()/adapters.json` |
| `src/server/services/agentService.ts` | `~/.claude/agents/` | `getAppDataDir()/agents/` |
| `src/server/services/taskService.ts` | `~/.claude/tasks/` | `getAppDataDir()/tasks/` |
| `src/server/services/teamService.ts` | `~/.claude/teams/` | `getAppDataDir()/teams/` |
| `src/server/services/teamWatcher.ts` | `~/.claude/teams/` | `getAppDataDir()/teams/` |
| `src/server/services/cronService.ts` | `~/.claude/scheduled_tasks.json` | `getAppDataDir()/scheduled_tasks.json` |
| `src/server/services/cronScheduler.ts` | `~/.claude/scheduled_tasks_log.json` | `getAppDataDir()/scheduled_tasks_log.json` |
| `src/server/types.ts` | `~/.claude/server-sessions.json` | `getAppDataDir()/server-sessions.json` |
| `src/server/api/computer-use.ts` | `~/.claude/cc-haha/computer-use-config.json` | `getAppDataDir()/computer-use-config.json` |
| `src/server/services/sessionService.ts` | 多处 `getClaudeHome()` | 区分：会话用 `getProjectsDir()`，其他用 `getAppDataDir()` |
| `src/server/services/conversationService.ts` | 多处 | 同上，按用途区分 |
| `src/server/services/settingsService.ts` | `~/.claude/settings.json` | 保持 `getClaudeHome()`（只读官方） |

---

## 六、保持不动的部分

| 路径 | 原因 |
|------|------|
| `~/.claude/settings.json` | 官方 API 认证，只读 |
| `~/.claude/projects/` | 会话 JSONL，和官方 CLI 共享 |
| `~/.claude/.runtime/` | computer-use 运行时，官方约定 |
| `CLAUDE_CONFIG_DIR` 环境变量 | 仍用于定位官方目录 |

---

## 七、执行顺序

1. **新建 `src/server/utils/paths.ts`** — 三个工具函数
2. **全局文本替换** — 品牌名 cc-haha → ycode（先跑一遍 grep 确认范围）
3. **重命名文件** — bin、oauth 相关文件
4. **替换路径引用** — 各 service 改用 `getAppDataDir()` / `getClaudeHome()`
5. **更新 Tauri 配置** — productName、identifier、updater endpoint
6. **更新 package.json** — bin、scripts
7. **跑测试** — 确保所有 import 路径正确
8. **首次启动迁移** — 可选：加一个一次性迁移脚本，把旧 `~/.claude/cc-haha/` 的数据复制到 `D:\Ycode\`

---

## 八、可选：启动时自动迁移

在 server 启动时检测旧目录是否存在，自动复制到新位置：

```typescript
// src/server/utils/migrate.ts
import fs from 'fs'
import path from 'path'
import { getClaudeHome, getAppDataDir } from './paths'

export async function migrateIfNeeded() {
  const oldDir = path.join(getClaudeHome(), 'cc-haha')
  const newDir = getAppDataDir()
  const marker = path.join(newDir, '.migrated')

  if (!fs.existsSync(oldDir) || fs.existsSync(marker)) return

  await fs.promises.cp(oldDir, newDir, { recursive: true })
  await fs.promises.writeFile(marker, new Date().toISOString())
  console.log(`[Ycode] Migrated data from ${oldDir} → ${newDir}`)
}
```
