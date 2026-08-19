# Agent Resume Desktop

Languages: [English](#english) | [简体中文](#简体中文)

Standalone **macOS Session OS + Memory** app — calendar digests, Agent Q&A over your work history, and an embedded **Workbench** terminal. Shares the same local data as the [Agent Resume Panel VS Code extension](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2).

| | Link |
|---|------|
| **Download** | [Latest DMG](https://github.com/lucacicii/agent-resume-panel/releases/latest) |
| **User docs** | [docs/desktop](../../docs/desktop/README.md) |
| **Report issues** | [Issues](https://github.com/lucacicii/agent-resume-panel/issues) |
| **VS Code extension** | [Marketplace](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2) |

Version: **0.2.7**

> **No cloud · Local-first**  
> Session index, notes, and reports are stored on your machine under **`~/.agent-resume-panel`** (shared with the VS Code extension).  
> Optional LLM features only contact a third-party API you configure.

---

## English

### What it is

| View | Description |
|------|-------------|
| **Report** | Calendar with daily / weekly / monthly AI digests and GTD bar |
| **Agent** | Natural-language Q&A over your digests and session history |
| **Workbench** | Embedded terminal (themes, multi-tab resume), project search, scripts runner, and Git tooling |
| **Notes** | Markdown note editor (shared with the extension) |
| **Sessions** | Reference list and read-only preview |

### Requirements

- macOS 12 or later
- Apple Silicon or Intel (universal build)

### Local development (Mac Intel / Apple Silicon)

```sh
# from monorepo root
pnpm install
pnpm run doctor:desktop   # optional: Node/pnpm/Electron/node-pty health
pnpm run dev:desktop
pnpm run pack:desktop     # universal .app + DMG; either Mac arch is fine
```

Do **not** copy `node_modules` or `.pack-staging` between Intel and Apple Silicon machines—only clone/pull and `pnpm install`.

### Install

1. Download the latest `Agent Resume-<version>.dmg` from [Releases](https://github.com/lucacicii/agent-resume-panel/releases/latest).
2. Open the DMG and drag **Agent Resume** to **Applications**.
3. If macOS blocks the app on first launch, right-click → **Open** once, or run:

   ```bash
   xattr -cr "/Applications/Agent Resume.app"
   ```

---

## 简体中文

独立 **macOS Session OS + Memory** 应用：日历回顾、基于报告的 **Agent** 问答、内嵌 **Workbench** 终端。与 [Agent Resume Panel VS Code 扩展](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2) 共用同一份本机数据。

### 主要视图

| 视图 | 说明 |
|------|------|
| **Report** | 日历、日/周/月 AI 回顾报告与 GTD 条 |
| **Agent** | 对回顾与会话历史的自然语言问答 |
| **Workbench** | 内嵌终端（配色、多标签恢复）、项目搜索、脚本运行与 Git 工具 |
| **Notes** | Markdown 笔记编辑（与扩展共用） |
| **Sessions** | 会话参考列表与只读预览 |

### 系统要求

- macOS 12 或更高
- Apple Silicon 或 Intel（通用构建）

### 安装

1. 从 [Releases](https://github.com/lucacicii/agent-resume-panel/releases/latest) 下载最新 `Agent Resume-<version>.dmg`。
2. 打开 DMG，将 **Agent Resume** 拖入 **应用程序**。
3. 若首次启动被系统拦截，可右键 → **打开** 一次，或执行：

   ```bash
   xattr -cr "/Applications/Agent Resume.app"
   ```
