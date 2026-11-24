# Agent Resume Panel

Local-first VS Code extension for managing, searching, and resuming AI coding CLI sessions (`apps/extension/`), backed by `@agent-resume/core` (`packages/core/`).

Languages: [English](#english) | [简体中文](#简体中文)

| Product | Directory | Install | User docs | Issues |
|---------|-----------|---------|-----------|--------|
| **VS Code extension** | [`apps/extension/`](apps/extension/) | [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2) | [docs/panel](docs/panel/README.md) | [Issues](https://github.com/lucacicii/agent-resume-panel/issues) |

Core library: [`packages/core/`](packages/core/) (`@agent-resume/core`).

---

## English

### Overview & Core Philosophy

**Agent Resume Panel** is a unified session management and task hub for AI coding CLI agents and IDE tools inside VS Code, Cursor, and VSCodium.

- **Local-First & Privacy-Focused**: No mandatory cloud servers or telemetry. All session metadata, GTD status, notes, and ACP chats reside locally on your machine inside `~/.agent-resume-panel`.

---

### Supported AI Agent Providers

| Provider / Tool | Indexing & Parser Scope | Resume & Integration Target |
|-----------------|-------------------------|-----------------------------|
| **Codex (CLI & App)** | History transcripts, multi-turn messages, session titles, workspace directories | VS Code Terminal, Ghostty, Codex App, Official Panel |
| **Claude Code** | Native CLI project sessions under `~/.claude/projects` | VS Code Terminal, Ghostty, Official Extension Panel |
| **Antigravity / AGY** | Antigravity agent CLI execution logs and workspace sessions | Integrated Terminal, Ghostty |
| **Grok Build** | Task logs and build agent execution history | Integrated Terminal, Ghostty |
| **OpenCode & Pi** | Universal CLI transcripts and multi-agent interaction logs | Integrated Terminal, Ghostty |
| **Prime Agent & OMP** | Prime Agent and OMP CLI session transcripts | Integrated Terminal, Ghostty, ACP Chat |
| **Cursor CLI & Composer** | Cursor CLI transcripts and Cursor IDE Composer metadata | Opens recorded project in Cursor IDE / Cursor CLI |

---

### Key Features & Modules

1. **Sessions Management ([docs/panel/sessions.md](docs/panel/sessions.md))**:
   - **Categorized Views**: Filter sessions by *Recent*, *Favorites*, and *Projects*.
   - **Global Search**: Search sessions using plain text or regular expressions across session titles, prompts, and timestamps.
   - **Session Manager**: Batch hide sessions, lock custom session titles, pin critical tasks, or export backups.
   - **Hover Snapshot**: Instantly preview session prompts and turn details without switching context.

2. **Resume & Target Dispatch ([docs/panel/resume-and-targets.md](docs/panel/resume-and-targets.md))**:
   - **One-Click Resume**: Continue past conversations right where you left off.
   - **Multiple Dispatch Targets**:
     - *Integrated Terminal*: Launch directly in VS Code's internal terminal shell.
     - *Ghostty*: Spawn session in external high-performance Ghostty terminal.
     - *Claude / Codex Extension Panels*: Resume inside official VS Code extension webviews.
     - *Codex App*: Launch session in the native Codex app.
     - *Cursor CLI*: Resume directly inside Cursor terminal tools.
   - **Custom Environment & Arguments**: Configure preset flags and environment parameters per target.

3. **ACP Chat ([docs/panel/acp-chat.md](docs/panel/acp-chat.md))**:
   - **In-Editor Agent Client Protocol Panel**: Connect directly to local ACP-compliant agents (e.g., Claude Code, Codex, OpenCode, Pi, Prime Agent, OMP, or Grok).
   - **Streamed Thinking & Tool Call Approval**: View live agent thought processes and manually approve or reject tool execution requests.
   - **Live File Diffs**: Review code edits directly within editor diff tabs before applying.

4. **GTD Workflow ([docs/panel/gtd.md](docs/panel/gtd.md))**:
   - **Status Tagging**: Organize sessions and notes using standard GTD tags (`@inbox`, `@next`, `@waiting`, `@someday`, `@reference`, `@done`).
   - **Drag-and-Drop & Context Menus**: Rapidly move items between execution buckets.

5. **Markdown Notes ([docs/panel/notes.md](docs/panel/notes.md))**:
   - **Multi-Note Association**: Attach multiple Markdown notes per session or project workspace, or store personal library notes.
   - **Media Attachments**: Support embedded images, code snippets, and structured notes.

6. **LLM Assist ([docs/panel/llm-assist.md](docs/panel/llm-assist.md))**:
   - **Bring Your Own Key**: Configure OpenAI, Anthropic, DeepSeek, Ollama, or custom OpenAI-compatible endpoints.
   - **Auto Summary**: Condense lengthy multi-turn conversations into concise bulleted digests.
   - **Auto Rename**: Automatically generate clean, human-readable session titles from transcript contents.
   - **Handoff Brief**: Generate structured handover summaries to easily transfer context to another agent or teammate.

---

### Local Data Layout

The extension stores its local data under **`~/.agent-resume-panel`**:

```text
~/.agent-resume-panel/
├── catalog.db         # SQLite database storing session metadata, indexes, and GTD tags
├── settings.json      # Local settings bridge (LLM configuration and agent homes)
├── notes/             # Markdown notes and media attachments
└── acp/               # ACP Chat session records and thread JSONL files
```

---

### Installation & Downloads

- **VS Code Marketplace**: [Install Extension](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2)
- **Open VSX Registry**: Search for `agent-resume-panel-v2` in VSCodium or Open VSX compatible editors.

---

### Companion Extension: Herdr Core Bridge

**Agent Resume Panel** pairs with **[Herdr Core Bridge](https://github.com/lucacicii/herdr-bridge)** ([Marketplace](https://marketplace.visualstudio.com/items?itemName=lucacicii.herdr-core-bridge) · [Open VSX](https://open-vsx.org/extension/lucacicii/herdr-core-bridge)):

- **Agent Resume Panel** handles **historical session indexing, GTD, Markdown notes, LLM Assist, and dispatch**.
- **Herdr Core Bridge** handles **live `herdr-core` (`hc`) PTY sessions, Herdr Spaces, Native/XTerm Webview terminal hosting, and `@path#L` editor references**.

With both installed:
- Live Herdr session states (`working` / `blocked` / `done` / `idle`) appear directly in Agent Resume Panel, and Herdr sessions auto-resume via Herdr Core Bridge.
- Project aliases set in Agent Resume Panel sync automatically to Herdr Space names.
- Herdr Core Bridge shows readable session titles from Agent Resume Panel and lets you jump straight to **Preview**, **Notes**, or **GTD** from any live Herdr terminal.

---

### Monorepo Development Guide

See [DEVELOPMENT.md](DEVELOPMENT.md) for full developer setup, build, and contribution instructions.

#### Requirements
- **Node.js**: `>= 22.13` (managed via `fnm` / `.node-version`)
- **pnpm**: `11.13.1` (managed via `corepack`)

#### Workspace Quick Commands

```bash
# Setup dependencies
fnm use
corepack enable
pnpm install

# Build core & extension
pnpm run compile       # Build core + compile extension TypeScript
pnpm run watch         # Watch mode for extension dev
pnpm run install:local # Build VSIX & install to local VS Code/Cursor
```

---

## 简体中文

### 概述与核心理念

**Agent Resume Panel** 是专为 AI Coding Agent（如 Codex、Claude Code、Antigravity 等）打造的 VS Code / Cursor / VSCodium 侧边栏统一会话管理与任务中心。

- **纯本地优先与隐私安全**：无需任何强制云端服务或数据上报。所有的会话元数据、GTD 状态、Markdown 笔记及 ACP 对话均保存在本机的 `~/.agent-resume-panel` 目录下。

---

### 支持的 Agent 工具列表

| Provider / 工具 | 索引与解析范围 | 恢复与集成目标 |
|-----------------|----------------|----------------|
| **Codex (CLI & App)** | 历史对话 JSON/JSONL 记录、多轮消息、会话标题、项目路径 | VS Code 内置终端、Ghostty、Codex App、官方插件面板 |
| **Claude Code** | 位于 `~/.claude/projects` 的原生 CLI 项目会话 | VS Code 内置终端、Ghostty、官方插件面板 |
| **Antigravity / AGY** | Antigravity agent CLI 运行日志与项目会话 | 内置终端、Ghostty 外部终端 |
| **Grok Build** | Grok 构建 Agent 的任务日志与执行历史 | 内置终端、Ghostty 外部终端 |
| **OpenCode & Pi** | 通用 CLI 对话记录与多 Agent 交互日志 | 内置终端、Ghostty 外部终端 |
| **Prime Agent & OMP** | Prime Agent 与 OMP CLI 对话记录 | 内置终端、Ghostty、ACP Chat |
| **Cursor CLI & Composer** | Cursor CLI 对话记录与 Cursor IDE Composer 会话元数据 | 直接在 Cursor IDE 中打开记录的项目 / Cursor CLI |

---

### 核心功能与模块

1. **会话管理 ([docs/panel/sessions.md](docs/panel/sessions.md))**:
   - **分组视图**：按 *Recent (近期)*、*Favorites (收藏)*、*Projects (项目)* 分类浏览会话。
   - **全局检索**：支持对会话标题、Prompt 提示词及时间戳进行全文与正则表达式搜索。
   - **Session Manager (会话管理器)**：支持批量隐藏会话、锁定自定义标题、固定关键会话或导出备份。
   - **悬浮快照**：无需切换上下文，悬浮即可快速预览会话首条 Prompt 及对话详情。

2. **恢复与目标调配 ([docs/panel/resume-and-targets.md](docs/panel/resume-and-targets.md))**:
   - **一键恢复**：无缝接续过去的对话上下文，迅速重拾代码思路。
   - **多种恢复目标 (Targets)**：
     - *集成终端*：直接在 VS Code 内置终端 Shell 中恢复会话。
     - *Ghostty*：在高性能的 Ghostty 外部终端中唤起会话。
     - *Claude / Codex 插件面板*：在官方 VS Code 插件 Webview 面板中恢复。
     - *Codex App*：在 Codex 应用中唤起会话。
     - *Cursor CLI*：在 Cursor 终端工具中接续对话。
   - **自定义环境与参数**：支持为不同恢复目标预设命令行参数与环境变量。

3. **ACP Chat ([docs/panel/acp-chat.md](docs/panel/acp-chat.md))**:
   - **编辑器旁 ACP 面板**：直接连接本地符合 Agent Client Protocol (ACP) 协议的 Agent（如 Claude Code、Codex、OpenCode、Pi、Prime Agent、OMP、Grok）。
   - **流式思考与工具审核**：实时展示 Agent 的思考过程（Thinking），支持手动 Approve / Reject 工具执行请求。
   - **代码变更实时 Diff**：在应用修改前，直接在编辑器 Diff 标签页中预览代码变动。

4. **GTD 任务流 ([docs/panel/gtd.md](docs/panel/gtd.md))**:
   - **状态标记**：支持 Getting Things Done 规范标签（`@inbox`、`@next`、`@waiting`、`@someday`、`@reference`、`@done`）。
   - **拖拽与右键分类**：快捷在不同执行桶之间流转任务状态。

5. **Markdown 笔记 ([docs/panel/notes.md](docs/panel/notes.md))**:
   - **多笔记关联**：每个会话或项目均可关联多条独立的 Markdown 笔记，也支持个人笔记库。
   - **媒体附件**：支持代码片段与本地截图附件。

6. **LLM 智能辅助 ([docs/panel/llm-assist.md](docs/panel/llm-assist.md))**:
   - **自定义 API**：支持接入 OpenAI、Anthropic、DeepSeek、Ollama 或任意兼容 OpenAI 接口的模型。
   - **Auto Summary (自动摘要)**：一键将冗长复杂的会话总结为精炼的要点。
   - **Auto Rename (智能重命名)**：根据对话正文自动生成简短易读的会话标题。
   - **Handoff Brief (交接简报)**：生成结构化的交接 Brief，方便快速将上下文传递给其他 Agent 或同事。

---

### 本地数据目录

扩展统一读写本机 **`~/.agent-resume-panel`** 目录：

```text
~/.agent-resume-panel/
├── catalog.db         # SQLite 数据库：存储会话元数据、索引与 GTD 标签
├── settings.json      # 本地配置桥接：LLM 配置与各 Agent 数据目录
├── notes/             # Markdown 笔记目录与媒体附件
└── acp/               # ACP Chat 会话记录与对话 JSONL 文件
```

---

### 安装与快速上手

- **VS Code Marketplace**: [前往 Marketplace 安装](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2)
- **Open VSX 市场**: 在 VSCodium 或支持 Open VSX 的编辑器中搜索 `agent-resume-panel-v2`。

---

### 配套扩展：Herdr Core Bridge

**Agent Resume Panel** 与 **[Herdr Core Bridge](https://github.com/lucacicii/herdr-bridge)**（[Marketplace](https://marketplace.visualstudio.com/items?itemName=lucacicii.herdr-core-bridge) · [Open VSX](https://open-vsx.org/extension/lucacicii/herdr-core-bridge)）协同工作：

- **Agent Resume Panel** 负责**历史会话索引、GTD 状态、Markdown 笔记、LLM 辅助与恢复调度**。
- **Herdr Core Bridge** 负责**实时 `herdr-core`（`hc`）共享 PTY 终端、Herdr Spaces、Native / XTerm Webview 双模式附着与 `@path#L` 代码引用发送**。

同时安装两个扩展时会自动打通双向联动：
- Agent Resume Panel 侧边栏会实时显示 Herdr 运行状态徽标（`working` / `blocked` / `done` / `idle`），支持自动通过 Herdr Core Bridge 恢复/新建终端，并将项目别名自动同步为 Herdr Space 名称。
- Herdr Core Bridge 会自动读取 Agent Resume Panel 的会话标题展示在活跃终端上，并支持从终端右键一键打开预览、笔记或设置 GTD 状态。

---

### Monorepo 开发者指南

详细开发环境搭建、构建与发布工作流请参阅 [DEVELOPMENT.md](DEVELOPMENT.md)。

#### 开发环境要求
- **Node.js**: `>= 22.13`（通过 `fnm` / `.node-version` 自动管理）
- **pnpm**: `11.13.1`（通过 `corepack` 自动管理）

#### 常用 Workspace 命令

```bash
# 安装依赖
fnm use
corepack enable
pnpm install

# 编译核心库与扩展
pnpm run compile       # 构建 core 并编译 Extension TypeScript
pnpm run watch         # 开发监听模式
pnpm run install:local # 构建 VSIX 并安装至本机 VS Code/Cursor
```

---

## License & Community

- **License**: Copyright (C) 2026 lucacicii. Licensed under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`).
- **Third-Party Notices**: See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Discord Community**: [discord.gg/CG2esx7K7](https://discord.gg/CG2esx7K7)
- **Feedback & Issues**: [GitHub Issues](https://github.com/lucacicii/agent-resume-panel/issues)
