# Agent Resume Desktop

Languages: [English](#english) | [简体中文](#简体中文)

Standalone **macOS Session OS + Memory** app — calendar digests, Agent Q&A over your work history, and an embedded **Workbench** terminal. Shares the same local data as the [Agent Resume Panel VS Code extension](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2).

| | Link |
|---|------|
| **Download** | [Latest DMG](https://github.com/thunder-luc/agent-resume-desktop-doc/releases/latest) |
| **User docs** | [agent-resume-desktop-doc](https://github.com/thunder-luc/agent-resume-desktop-doc) |
| **Report issues** | [desktop-doc Issues](https://github.com/thunder-luc/agent-resume-desktop-doc/issues) |
| **VS Code extension** | [Marketplace](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2) |

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
| **Workbench** | Embedded terminal (themes, ACP visual chat, multi-tab resume), project Quick Access, file operations, search, scripts runner, and Git tooling |
| **Notes** | Markdown note editor (shared with the extension) |
| **Sessions** | Reference list and read-only preview |

### Workbench highlights

- **Quick Access**: select a project quickly before working in the Workbench.
- **Explorer**: inspect full-branch file history ("File History"), discard folder-level Git changes, copy paths, and cut/copy/paste/delete project files; open files update when workspace files change.
- **Search** side panel: find text across the selected project (case / whole word / regex) and open hits in the file editor.
- **Scripts**: run package manager, Make, Gradle, Python, and Cargo scripts into the active terminal.
- **Terminal themes**: Default Dark/Light, Solarized, One Dark, Dracula under **Settings → Workbench**.
- **Git**: selective file commit, tracking indicators, inline diff search, and branch controls in the detail header.
- **Sessions**: display the complete merged session history, including ACP sessions.
- **ACP visual chat**: create or resume supported agent sessions, select a mode such as Plan, use `/` commands, and approve requested actions in the Workbench.

### External agent MCP

**Agent Resume MCP** is one local stdio service that lets a trusted local agent work with the same Notes, Reports, Sessions, and GTD data as Desktop. Open **Settings → MCP** to register detected Codex, Claude Code, Gemini CLI, Antigravity, or OpenCode installations. Cursor, Pi, and Grok Build use the copyable configuration from that page.

The service exposes 28 tools: 15 for Notes and note GTD, 4 for Executable Notes, 3 for Reports, and 6 for Sessions. Executable `run` / `note-child` / `session` / `result` blocks should be written through the deterministic MCP tools instead of hand-authored Markdown. Registered agents can create, update, and permanently delete local data, so only register clients you trust. The service does not open a network port. See the [MCP user guide](https://github.com/thunder-luc/agent-resume-desktop-doc/blob/main/mcp.md) for the tool reference and registration details.

### Requirements

- macOS 12 or later
- Apple Silicon or Intel (universal build)

### Install

1. Download the latest `Agent Resume-<version>.dmg` from [Releases](https://github.com/thunder-luc/agent-resume-desktop-doc/releases/latest).
2. Open the DMG and drag **Agent Resume** to **Applications**.
3. If macOS blocks the app on first launch, right-click → **Open** once, or run:

   ```bash
   xattr -cr "/Applications/Agent Resume.app"
   ```

---

## 简体中文

独立 **macOS Session OS + Memory** 应用：日历回顾、基于报告的 **Agent** 问答、内嵌 **Workbench** 终端。与 [Agent Resume Panel VS Code 扩展](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2) 共用同一份本机数据。

### 主要视图

| 视图 | 说明 |
|------|------|
| **Report** | 日历、日/周/月 AI 回顾报告与 GTD 条 |
| **Agent** | 对回顾与会话历史的自然语言问答 |
| **Workbench** | 内嵌终端（配色、ACP 可视化聊天、多标签恢复）、项目搜索、脚本运行与 Git 工具 |
| **Notes** | Markdown 笔记编辑（与扩展共用） |
| **Sessions** | 会话参考列表与只读预览 |

### Workbench 要点

- **Explorer**：支持右键查看文件历史（跨分支追溯重名前记录）、目录级 Git 改动回退、复制路径与文件剪切/复制/粘贴/删除；打开的编辑器监听工作区变动。
- **Scripts**：将 npm / pnpm / yarn / bun、Make、Gradle、Python、Cargo 等脚本写入当前终端执行。
- **终端主题**：在 **设置 → Workbench** 中选择 Default Dark/Light、Solarized、One Dark、Dracula。
- **Git**：支持按文件选择提交、跟踪状态提示，分支控件位于详情头部。
- **ACP 可视化聊天**：在 Workbench 内创建或恢复受支持的 Agent 会话、选择 Plan 等协作模式、使用 `/` 命令并授权请求的操作。

### 外部 Agent MCP

**Agent Resume MCP** 是一个本机 stdio 聚合服务，让受信任的本机 Agent 使用与 Desktop 相同的 Notes、Reports、Sessions 与 GTD 数据。在 **设置 → MCP** 中可注册已检测到的 Codex、Claude Code、Gemini CLI、Antigravity 与 OpenCode；Cursor、Pi、Grok Build 可从该页面复制配置后手动添加。

服务当前提供 28 个工具：Notes 与笔记 GTD 15 个、Executable Notes 4 个、Reports 3 个、Sessions 6 个。`run` / `note-child` / `session` / `result` 指令必须通过确定性 MCP 工具写入，而不是由 Agent 手工拼接 Markdown。注册后的 Agent 可创建、修改和永久删除本机数据，请仅注册可信客户端。服务不会开放网络端口。工具说明与注册细节见 [MCP 使用文档](https://github.com/thunder-luc/agent-resume-desktop-doc/blob/main/mcp.md)。

### 系统要求

- macOS 12 或更高
- Apple Silicon 或 Intel（通用构建）

### 安装

1. 从 [Releases](https://github.com/thunder-luc/agent-resume-desktop-doc/releases/latest) 下载最新 `Agent Resume-<version>.dmg`。
2. 打开 DMG，将 **Agent Resume** 拖入 **应用程序**。
3. 若首次启动被系统拦截，可右键 → **打开** 一次，或执行：

   ```bash
   xattr -cr "/Applications/Agent Resume.app"
   ```
