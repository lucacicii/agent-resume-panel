# Agent Resume Desktop

macOS-oriented shell: **Memory** (home calendar), **Ask** (chat over digests), Settings (gear).

## 开发流程

在仓库根目录执行：

```bash
npm install
npm run dev:desktop
```

默认会按需做一次初始 build，然后并行启动 core / main / renderer 的 watch，并用 `electronmon` 在产物变更时自动重启或刷新窗口。

### 脚本对照

| 命令 | 说明 | 何时使用 |
|------|------|----------|
| `npm run dev:desktop` | watch + electronmon | 日常开发（默认） |
| `npm run dev:desktop -- --fresh` | 强制全量 rebuild 后 dev | 依赖/vendor 变更、dist 异常 |
| `npm run dev:once -w @agent-resume/desktop` | 单次 build + 启动，无 watch | 快速验证 |
| `npm run dev:mac -w @agent-resume/desktop` | macOS `.app` 启动 | 验证 node-pty / 打包路径 |
| `npm run build:desktop` | 全量构建 | 发布前、CI |
| `npm run pack:desktop` | 打 macOS 安装包 | 分发测试 |

### 架构

- **Main / Preload**（`src/main`、`src/preload`）：TypeScript 编译到 `dist/main`、`dist/preload`，`tsc -w` 监听。
- **Renderer**（`src/renderer`）：纯 JS/CSS/HTML，由 `watch-renderer.mjs` 同步到 `dist/renderer`。
- **Core**（`packages/core`）：独立 workspace，`tsc -w` 输出到 `packages/core/dist`；desktop 运行时读取该目录。
- **自动重启**：`electronmon` 监听 `dist/main`、`dist/preload`、`dist/renderer` 与 `packages/core/dist` 的变更。

### 修改不同层时的预期行为

| 改动位置 | 预期 |
|----------|------|
| `src/main/**`、`src/preload/**` | tsc 编译 → Electron 自动重启 |
| `packages/core/src/**` | core tsc → Electron 自动重启 |
| `src/renderer/**` | copy → 窗口自动刷新或重启 |
| `src/renderer/vendor-entry/**` | 需 `--fresh` 或 `npm run build:desktop`（esbuild vendor） |

### macOS 说明

- 默认 dev 使用 `electron .`，启动快，适合日常迭代。
- `dev:mac` 会按需 repack `Agent Resume.app` 再 `open` 启动，慢但更接近发布环境；stamp 文件为 `apps/desktop/.dev-app-stamp`。
- `node-pty`：`postinstall` 会执行 `fix-node-pty`；若内置终端异常，可用 `dev:mac` 排除是否为打包路径问题。

### 常见问题

- **白屏 / 找不到 main**：执行 `npm run build:desktop` 或 `npm run dev:desktop -- --fresh`。
- **core 改动不生效**：确认 `packages/core/dist` 已更新；dev 会 watch core。
- **renderer 改了没反应**：确认 `dist/renderer` 已同步；或按 Cmd+R 手动刷新。
- **进程残留**：Ctrl+C 结束 dev；必要时 `pkill -f "Agent Resume"` 或关闭 Electron 窗口。

## Navigation

| Entry | Role |
|-------|------|
| **Memory** (default) | Calendar · generate digests (right panel) · GTD bar · day detail |
| **Ask** | Natural-language Q&A over digests |
| **Sessions** (header) | Reference list + read-only preview |
| **⚙** | Settings · **通用**（含批量回填） / **用量与日志** |

### Memory 主区

- 上方：**从周报/月报分析 GTD + todolist**（打开可编辑预览 sheet）
- 右侧上方：生成日 / 周 / 月报（点日历同步日报日期）
- 右侧下方：digest 详情
- 无 ⋯ 菜单；批量回填在 Settings → 通用

### GTD flow

1. 分析预览（不写盘）
2. 编辑 GTD / tasks / markdown
3. 应用选中 → `session_gtd` + `todolist.md`

No VS Code extension code changes required for Desktop features.