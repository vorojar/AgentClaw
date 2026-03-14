# AgentClaw 桌面版：一键跨平台启动包计划

## 目标

把 AgentClaw 从"开发者手动配 .env + 命令行启动"变成"双击打开、GUI 配置、零门槛"的跨平台桌面应用。

**目标平台**：Windows (x64) / macOS (arm64 + x64) / Linux (x64)

---

## 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 桌面壳 | **Tauri v2** | 体积小（~10MB 壳）、跨平台、Rust 安全性、系统托盘原生支持 |
| 后端打包 | **Bun --compile** | 单文件可执行文件、内置 SQLite、零 Node.js 依赖 |
| SQLite | **bun:sqlite** | Bun 内置、零 native addon、API 与 better-sqlite3 高度兼容 |
| 前端 | 现有 React web 包 | Tauri 内嵌 webview 加载，零改动 |
| 配置持久化 | **AppData/config.json** | 替代 .env，GUI 可编辑，跨平台路径自适应 |

## .env 策略

| 场景 | 配置来源 | 说明 |
|---|---|---|
| 开发模式 | `.env` + `dotenv` | 不变，开发者继续用 |
| 桌面版 | `config.json` | 首次启动引导用户填写，Settings 页面可改 |
| Docker | 环境变量 | 不变 |

**优先级**：环境变量 > config.json > .env > 默认值

---

## 架构

```
┌──────────────────────────────────────┐
│  Tauri v2 Shell (Rust, ~10MB)        │
│  ├─ 窗口管理 / 系统托盘 / 自动更新    │
│  ├─ Sidecar 管理（启动/停止 gateway） │
│  └─ Webview → 加载 React 前端        │
├──────────────────────────────────────┤
│  agentclaw-server (Bun 编译单文件)    │
│  ├─ Gateway (HTTP/WS, port 3100)     │
│  ├─ bun:sqlite（内置 SQLite）        │
│  ├─ 所有渠道 Bot                     │
│  └─ 读取 config.json + 环境变量      │
└──────────────────────────────────────┘
```

**数据目录**（跨平台）：
- Windows: `%APPDATA%/agentclaw/`
- macOS: `~/Library/Application Support/agentclaw/`
- Linux: `~/.config/agentclaw/`

```
{dataDir}/
├── config.json          # 用户配置（API keys、模型、渠道等）
├── agentclaw.db         # SQLite 数据库
├── skills/              # 用户自定义 Skill
├── mcp-servers.json     # MCP 配置
└── system-prompt.md     # 自定义系统提示词（可选）
```

---

## 实施步骤

### Phase 1：配置系统改造（不依赖 Tauri，先行完成）

**目标**：gateway 支持从 config.json 读取配置，为桌面版铺路。

#### Task 1.1：创建 `packages/gateway/src/config.ts`

统一配置读取模块：

```typescript
interface AppConfig {
  // LLM
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  geminiApiKey?: string;
  defaultModel?: string;
  // Vision / Fast
  visionApiKey?: string;
  visionProvider?: string;
  visionModel?: string;
  fastApiKey?: string;
  fastProvider?: string;
  fastModel?: string;
  // Server
  port: number;           // default 3100
  host: string;           // default "0.0.0.0"
  apiKey?: string;
  // Paths
  dbPath: string;
  skillsDir: string;
  systemPromptFile: string;
  // Channels (各渠道凭证)
  telegram?: { botToken: string };
  dingtalk?: { appKey: string; appSecret: string };
  feishu?: { appId: string; appSecret: string };
  qqBot?: { appId: string; appSecret: string };
  wecom?: { botId: string; botSecret: string };
  whatsapp?: { enabled: boolean };
  // Optional
  sentryDsn?: string;
  maxIterations?: number;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  volcanoEmbeddingKey?: string;
  searxngUrl?: string;
}
```

**读取逻辑**：
1. 读 `config.json`（路径由 `CONFIG_PATH` 环境变量 或 `{dataDir}/config.json` 决定）
2. 环境变量覆盖 config.json 中的同名字段
3. 填充默认值
4. 导出 `getConfig(): AppConfig`，`bootstrap.ts` 改为从此处读取

#### Task 1.2：新增 REST API 写入配置

```
GET  /api/config          → 返回当前配置（脱敏：API key 只返回后 4 位）
PUT  /api/config          → 写入 config.json 并热重载
POST /api/config/validate → 验证 API key 有效性（调一次 LLM）
```

`PUT /api/config` 写入后：
- 重新加载 Provider（切换模型/密钥）
- 不重启进程，热生效

#### Task 1.3：Settings 页面增加配置编辑

现有 SettingsPage 的 General tab 只展示信息，改为可编辑：
- API Keys 输入框（密码类型，显示后 4 位）
- 模型选择（下拉）
- 保存按钮调 `PUT /api/config`
- 验证按钮调 `POST /api/config/validate`

---

### Phase 2：better-sqlite3 → bun:sqlite 兼容层

**目标**：让 memory 包同时支持 better-sqlite3（Node 开发）和 bun:sqlite（桌面版打包）。

#### Task 2.1：创建 `packages/memory/src/db-adapter.ts`

```typescript
// 统一接口，屏蔽底层差异
export interface DbAdapter {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  pragma(directive: string): unknown;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

export interface Statement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
```

**运行时检测**：
```typescript
export function createDatabase(path: string): DbAdapter {
  if (typeof Bun !== "undefined") {
    // bun:sqlite
    const { Database } = require("bun:sqlite");
    return new BunSqliteAdapter(new Database(path));
  } else {
    // better-sqlite3 (Node.js)
    const Database = require("better-sqlite3");
    return new BetterSqliteAdapter(new Database(path));
  }
}
```

#### Task 2.2：API 差异适配

| 操作 | better-sqlite3 | bun:sqlite | 适配方案 |
|---|---|---|---|
| 创建 | `new Database(path)` | `new Database(path)` | 相同 |
| pragma | `db.pragma("journal_mode=WAL")` | `db.run("PRAGMA journal_mode=WAL")` | adapter 统一 |
| prepare | `db.prepare(sql)` | `db.prepare(sql)` | 相同 |
| run/get/all | `.run()/.get()/.all()` | `.run()/.get()/.all()` | 相同 |
| transaction | `db.transaction(fn)` 返回函数 | `db.transaction(fn)` 返回函数 | 相同 |
| BLOB 读写 | Buffer | Uint8Array | adapter 转换 |

**差异很小**，主要是 pragma 调用方式和 BLOB 类型。

#### Task 2.3：迁移 `database.ts` 和 `store.ts`

- `import Database from "better-sqlite3"` → `import { createDatabase } from "./db-adapter.js"`
- 所有 `db.pragma()` 调用走 adapter
- Buffer ↔ Uint8Array 在 embedding 存取时转换
- 确保 `npm run test` 全部通过（Node 环境跑 better-sqlite3 路径）

---

### Phase 3：Tauri 项目搭建

#### Task 3.1：初始化 `packages/desktop`

```bash
pnpm create tauri-app packages/desktop --template vanilla-ts
```

目录结构：
```
packages/desktop/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── src/
│   │   ├── main.rs          # 入口
│   │   ├── sidecar.rs       # Sidecar 生命周期管理
│   │   └── tray.rs          # 系统托盘
│   └── icons/               # 应用图标
├── package.json
└── tsconfig.json
```

#### Task 3.2：`tauri.conf.json` 核心配置

```jsonc
{
  "productName": "AgentClaw",
  "version": "1.0.0",
  "build": {
    // 开发模式：代理到 Vite dev server
    "devUrl": "http://localhost:3200",
    // 生产模式：使用 web 包的构建产物
    "frontendDist": "../web/dist"
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "dmg", "appimage"],
    "externalBin": ["binaries/agentclaw-server"]
  },
  "app": {
    "windows": [{
      "title": "AgentClaw",
      "width": 1200,
      "height": 800,
      "minWidth": 800,
      "minHeight": 600
    }],
    "security": {
      "csp": "default-src 'self'; connect-src 'self' ws://localhost:3100 http://localhost:3100"
    }
  }
}
```

#### Task 3.3：Rust Sidecar 管理 (`sidecar.rs`)

```rust
// 启动时：
// 1. 确定 dataDir 路径（platform-dirs）
// 2. 检查 config.json 是否存在
//    - 不存在 → 前端显示首次配置引导
//    - 存在 → 启动 sidecar
// 3. spawn agentclaw-server，设置环境变量 CONFIG_PATH
// 4. 等待 health check 通过（GET /api/health）
// 5. webview 加载 http://localhost:3100（生产模式 gateway 托管静态文件）

// 关闭时：
// 1. 窗口关闭 → 最小化到托盘（可配置）
// 2. 托盘退出 → 发 SIGTERM 给 sidecar → 等待优雅关闭
```

#### Task 3.4：系统托盘 (`tray.rs`)

菜单项：
- 打开主窗口
- 启动/停止 Gateway
- 分割线
- 退出

---

### Phase 4：Bun 编译与 Sidecar 打包

#### Task 4.1：Gateway 静态文件托管

生产模式下 gateway 直接托管 web 前端：

```typescript
// packages/gateway/src/server.ts
if (process.env.NODE_ENV === "production") {
  app.register(fastifyStatic, {
    root: path.join(__dirname, "../web/dist"),
    prefix: "/",
  });
}
```

这样桌面版不需要单独启动前端，gateway 一个进程搞定。

#### Task 4.2：Bun 编译脚本

```bash
# 先构建所有包
npm run build

# 编译为单文件（各平台）
bun build packages/gateway/dist/index.js \
  --compile \
  --target=bun-windows-x64 \
  --outfile=packages/desktop/src-tauri/binaries/agentclaw-server-x86_64-pc-windows-msvc.exe

bun build packages/gateway/dist/index.js \
  --compile \
  --target=bun-darwin-arm64 \
  --outfile=packages/desktop/src-tauri/binaries/agentclaw-server-aarch64-apple-darwin

bun build packages/gateway/dist/index.js \
  --compile \
  --target=bun-linux-x64 \
  --outfile=packages/desktop/src-tauri/binaries/agentclaw-server-x86_64-unknown-linux-gnu
```

文件名后缀必须匹配 Tauri 的 target triple 命名规范。

#### Task 4.3：处理 Native Addon

| Addon | 方案 |
|---|---|
| better-sqlite3 | 已被 bun:sqlite 替代，不需要 |
| sherpa-onnx-node | 标记为可选依赖，桌面版暂不打包语音识别（后续可用 Rust 版替代） |
| silk-wasm | 纯 WASM，Bun 兼容，无需处理 |
| node-edge-tts | 纯 JS，Bun 兼容，无需处理 |

#### Task 4.4：首次启动引导流程

```
用户双击启动
    ↓
Tauri 窗口打开
    ↓
检测 config.json 是否存在
    ↓ 不存在
显示 Setup Wizard（前端新页面）
    ├─ Step 1: 选择 LLM Provider（Claude/OpenAI/Gemini/Ollama）
    ├─ Step 2: 填写 API Key
    ├─ Step 3: 验证连接（调 /api/config/validate）
    └─ Step 4: 保存 → 启动 Gateway → 进入主界面
    ↓ 存在
直接启动 Gateway → 进入主界面
```

---

### Phase 5：打包与分发

#### Task 5.1：CI/CD（GitHub Actions）

```yaml
# .github/workflows/desktop-release.yml
# 触发：push tag v*
# Matrix: windows-latest / macos-latest / ubuntu-latest
# 步骤：
#   1. checkout
#   2. 安装 Rust + Bun + pnpm
#   3. pnpm install && npm run build
#   4. Bun 编译 sidecar（对应平台）
#   5. pnpm --filter @agentclaw/web build（前端产物）
#   6. pnpm tauri build（生成安装包）
#   7. 上传 artifact / 发布 Release
```

#### Task 5.2：产物

| 平台 | 格式 | 预估体积 |
|---|---|---|
| Windows | `.msi` / `.exe`(NSIS) | ~60 MB |
| macOS | `.dmg` | ~55 MB |
| Linux | `.AppImage` / `.deb` | ~55 MB |

#### Task 5.3：自动更新

Tauri v2 内置 updater，配置 GitHub Releases 为更新源：
```jsonc
// tauri.conf.json
{
  "plugins": {
    "updater": {
      "endpoints": ["https://github.com/user/agentclaw/releases/latest/download/latest.json"],
      "dialog": true
    }
  }
}
```

---

## 风险与 Fallback

| 风险 | 概率 | Fallback |
|---|---|---|
| Bun 编译后某些 npm 包不兼容 | 中 | 改用 `pkg` 或 `nexe` 打包 Node.js；或用 Tauri sidecar 携带 Node runtime |
| bun:sqlite 行为与 better-sqlite3 不一致 | 低 | db-adapter 层隔离，单独修复差异 |
| sherpa-onnx 在 Bun 下不工作 | 高 | 桌面版初版不含语音功能，后续用 Rust 原生替代 |
| 前端静态托管路径问题 | 低 | Vite `base` 配置 + gateway 路由调整 |

---

## 执行顺序与依赖关系

```
Phase 1 (配置系统) ──→ Phase 3 (Tauri 搭建)
                            ↓
Phase 2 (SQLite 兼容) ──→ Phase 4 (Bun 编译 + 打包)
                            ↓
                      Phase 5 (CI/CD + 分发)
```

- Phase 1 和 Phase 2 **可并行**，互不依赖
- Phase 3 依赖 Phase 1（配置系统要先好）
- Phase 4 依赖 Phase 2 + 3
- Phase 5 依赖 Phase 4

**预计新增/修改文件**：
- 新增：`packages/desktop/`（Tauri 项目）、`packages/gateway/src/config.ts`、`packages/memory/src/db-adapter.ts`、前端 SetupWizard 页面
- 修改：`packages/gateway/src/bootstrap.ts`（用 config 模块）、`packages/memory/src/database.ts`（用 adapter）、`packages/web/src/pages/SettingsPage.tsx`（可编辑配置）、`pnpm-workspace.yaml`（加 desktop 包）
