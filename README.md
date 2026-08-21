# Agent Resume Panel

Monorepo for two independent products that share local data under `~/.agent-resume-panel`:

Languages: [English](#english) | [简体中文](#简体中文)

| Product | Directory | Install | User docs | Issues |
|---------|-----------|---------|-----------|--------|
| **VS Code extension** | [`apps/extension/`](apps/extension/) | [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2) | [docs/panel](docs/panel/README.md) | [Extension Issues](https://github.com/lucacicii/agent-resume-panel/issues) |
| **Desktop app (macOS)** | [`apps/desktop/`](apps/desktop/) | [Download DMG](https://github.com/lucacicii/agent-resume-panel/releases/latest) | [docs/desktop](docs/desktop/README.md) | [Desktop Issues](https://github.com/lucacicii/agent-resume-panel/issues) |

Shared core library: [`packages/core/`](packages/core/) (`@agent-resume/core`).
<img width="2880" height="1632" alt="image" src="https://github.com/user-attachments/assets/f7ed9f25-c00f-4443-aab4-085a1825ed87" />
<img width="1486" height="742" alt="image" src="https://github.com/user-attachments/assets/236c9398-5f53-4a25-be57-2e7f91d92053" />
<img width="2880" height="1632" alt="image" src="https://github.com/user-attachments/assets/a7e4a16a-e43b-4a10-ade5-6944fe8bfdf6" />
<img width="2880" height="1632" alt="image" src="https://github.com/user-attachments/assets/a7be547f-bf1d-4605-8100-38eae78cd48e" />
<img width="2880" height="1632" alt="image" src="https://github.com/user-attachments/assets/c57adc0e-3d99-488e-8cfe-05810b799270" />
<img width="2880" height="1632" alt="image" src="https://github.com/user-attachments/assets/d29d364d-c30d-4b08-98ce-9c6e8b597f0f" />
<img width="2880" height="1632" alt="image" src="https://github.com/user-attachments/assets/0b8355b2-438a-4acc-be26-4050d8e1b19b" />
---

## English

### Overview & Core Philosophy

**Agent Resume Panel** is a unified session management, memory recall, and task management hub for AI coding CLI agents and IDE tools. 

- **Local-First & Privacy-Focused**: No mandatory cloud servers or telemetry. All session metadata, transcripts index, GTD status, notes, and daily digests reside locally on your machine inside `~/.agent-resume-panel`.
- **Zero-Duplicate Setup**: The VS Code extension and the macOS Desktop app seamlessly share the exact same SQLite database (`catalog.db`), settings (`settings.json`), and Markdown notes (`notes/`).

---

### Supported AI Agent Providers

| Provider / Tool | Indexing & Parser Scope | Resume & Integration Target |
|-----------------|-------------------------|-----------------------------|
| **Codex (CLI & App)** | History transcripts, multi-turn messages, session titles, workspace directories | VS Code Terminal, Ghostty, Codex App, Official Panel |
| **Claude Code** | Native CLI project sessions under `~/.claude/projects` | VS Code Terminal, Ghostty, Official Extension Panel |
| **Antigravity / AGY** | Antigravity agent CLI execution logs and workspace sessions | Integrated Terminal, Ghostty |
| **Grok Build** | Task logs and build agent execution history | Integrated Terminal, Ghostty |
| **OpenCode & Pi** | Universal CLI transcripts and multi-agent interaction logs | Integrated Terminal, Ghostty |
| **Cursor CLI & Composer** | Cursor IDE Composer session metadata and project path indexing | Opens recorded project directly in Cursor IDE / Cursor CLI |

---

### Product 1: VS Code Extension (`apps/extension`)

The **VS Code extension** brings agent session management right inside your editor's sidebar panel (compatible with VS Code, Cursor, and VSCodium).

#### Key Features & Modules

1. **Sessions Management ([docs/panel/sessions.md](docs/panel/sessions.md))**:
   - **Categorized Views**: Filter sessions by *Recent*, *Favorites*, and *Projects*.
   - **Global Search**: Search sessions using plain text or regular expressions across session titles, prompts, and timestamps.
   - **Session Manager**: Batch hide sessions, lock custom session titles, pin critical tasks, or permanently remove transcript logs.
   - **Hover Snapshot**: Instantly preview session prompts and turn details without switching context.

2. **Resume & Target Dispatch ([docs/panel/resume-and-targets.md](docs/panel/resume-and-targets.md))**:
   - **One-Click Resume**: Continue past conversations right where you left off.
   - **Multiple Dispatch Targets**:
     - *Integrated Terminal*: Launch directly in VS Code's internal terminal shell.
     - *Ghostty*: Spawn session in external high-performance Ghostty terminal.
     - *Claude / Codex Extension Panels*: Resume inside official VS Code extension webviews.
     - *Codex App*: Launch session in the native Codex desktop application.
     - *Cursor CLI*: Resume directly inside Cursor terminal tools.
   - **Custom Environment & Arguments**: Configure preset flags and environment parameters per target.

3. **ACP Chat ([docs/panel/acp-chat.md](docs/panel/acp-chat.md))**:
   - **In-Editor Agent Client Protocol Panel**: Connect directly to local ACP-compliant agents (e.g., Claude Code, OpenCode, or custom ACP agents).
   - **Streamed Thinking & Tool Call Approval**: View live agent thought processes and manually approve or reject tool execution requests.
   - **Live File Diffs**: Review code edits directly within editor diff tabs before applying.

4. **GTD Workflow ([docs/panel/gtd.md](docs/panel/gtd.md))**:
   - **Status Tagging**: Organize sessions using standard GTD tags (`@inbox`, `@next`, `@waiting`, `@someday`, `@reference`, `@done`).
   - **Action Item Extraction**: Automatically parse and extract high-frequency tasks from session transcripts.
   - **Drag-and-Drop & Context Menus**: Rapidly move tasks between execution buckets.

5. **Markdown Notes ([docs/panel/notes.md](docs/panel/notes.md))**:
   - **Multi-Note Association**: Attach multiple Markdown notes per session or project workspace.
   - **Media Attachments**: Support embedded images, code snippets, and structured notes.
   - **Real-Time Sync**: Notes created in the extension are instantly accessible in the Desktop app.

6. **LLM Assist ([docs/panel/llm-assist.md](docs/panel/llm-assist.md))**:
   - **Bring Your Own Key**: Configure OpenAI, Anthropic, DeepSeek, Ollama, or custom OpenAI-compatible endpoints.
   - **Auto Summary**: Condense lengthy multi-turn conversations into concise bulleted digests.
   - **Auto Rename**: Automatically generate clean, human-readable session titles from transcript contents.
   - **Handoff Brief**: Generate structured handover summaries to easily transfer context to another agent or teammate.

---

### Product 2: Agent Resume Desktop App (`apps/desktop`)

The **Agent Resume Desktop app** is a native macOS application built on Electron, serving as a **Session OS & Work Memory** system.

#### Key Features & Modules

1. **Report & Calendar Digest Module ([docs/desktop/report.md](docs/desktop/report.md))**:
   - **Calendar Heatmap**: Visual calendar overview tracking your daily agent usage, session frequency, and task completion.
   - **AI-Generated Digests**: One-click generation of Daily, Weekly, and Monthly work reports summarizing key achievements, code changes, blocker analysis, and unresolved items.
   - **GTD Progress Bar**: Consolidated view of all active GTD task buckets across all projects.

2. **Agent Memory Q&A ([docs/desktop/agent.md](docs/desktop/agent.md))**:
   - **Natural Language Work Recall**: Ask questions over your local session history and daily reports (e.g., *"What issues did I encounter during last week's database migration?"*).
   - **Source Citations**: Answers include clickable citations that jump directly to the underlying session transcript or daily digest.
   - **Agent Tools & Threads**: Supports tool calls and interactive agent threads for deeper contextual inquiries.

3. **Workbench Super Terminal ([docs/desktop/workbench.md](docs/desktop/workbench.md))**:
   - **Embedded xterm Shell**: High-performance terminal emulator with customizable color themes (Tokyo Night, One Dark, Solarized Dark/Light, etc.).
   - **Visual ACP Chat**: Interactive sidebar for ACP agent communication with streamed responses and tool control.
   - **Multi-Tab Resume**: Open and run multiple concurrent agent sessions across different projects in separate tabs.
   - **Project & File Search**: Integrated file tree explorer and fuzzy project file search.
   - **Git Integration**: View code diffs, visually select files for commit, drag-and-drop images, and auto-convert image uploads to Git commits.
   - **Script Runner**: Single-click execution of `package.json` scripts.

4. **MCP Server Integration ([docs/desktop/mcp.md](docs/desktop/mcp.md))**:
   - **Native Model Context Protocol (MCP)**: Acts as a local MCP server.
   - **Tool Registration**: Exposes local Notes, Daily Reports, Session catalogs, and GTD tasks as tools to external agents (such as Cursor, Claude Desktop, or Windsurf).

---

### Product Comparison Matrix

| Feature / Capability | VS Code Extension | Agent Resume Desktop (macOS) |
|----------------------|:-----------------:|:----------------------------:|
| **Primary Use Case** | In-editor session resume & coding sidekick | Work digest, memory recall & standalone session OS |
| **Supported Platforms** | VS Code / Cursor / VSCodium (Cross-platform) | macOS 12+ (Apple Silicon & Intel Universal) |
| **Session Browsing & Search** | ✅ Full-text & regex search | ✅ Full-text & reference preview |
| **Resume Targets** | ✅ Terminal, Ghostty, Claude/Codex Panels, Cursor CLI | ✅ Built-in xterm Workbench, External Terminals |
| **ACP Interactive Chat** | ✅ Sidebar Panel | ✅ Visual Workbench Chat |
| **GTD & Markdown Notes** | ✅ In-editor views | ✅ Full Markdown editor sync |
| **AI Work Digests & Calendar** | ❌ | ✅ Daily / Weekly / Monthly AI Reports |
| **Memory Agent Q&A** | ❌ | ✅ Natural language Q&A with citations |
| **xterm Multi-Tab Workbench** | ❌ | ✅ Integrated xterm, Git tools, Script runner |
| **MCP Server Capabilities** | ❌ | ✅ Native MCP server for external agents |

---

### Shared Core Architecture (`packages/core`)

Both products share `@agent-resume/core` and operate on a unified local data directory at **`~/.agent-resume-panel`**:

```text
~/.agent-resume-panel/
├── catalog.db         # SQLite database storing session metadata, indexes, and GTD tags
├── settings.json      # Shared preferences, LLM API keys, and target configurations
├── notes/             # Markdown notes and media attachments shared across products
└── .desktop/          # Desktop-specific vector store, report caches, and MCP settings
```

---

### Installation & Downloads

#### 1. VS Code Extension
- **VS Code Marketplace**: [Install Extension](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2)
- **Open VSX Registry**: Search for `agent-resume-panel-v2` in VSCodium or Open VSX compatible editors.

#### 2. Agent Resume Desktop App (macOS)
- **Latest Release**: [Download DMG](https://github.com/lucacicii/agent-resume-panel/releases/latest)
- **Installation Step**: Open DMG and drag `Agent Resume.app` to `/Applications`.
- **macOS Security Gatekeeper**: Since the app build may not be notarized by Apple, run the following command if macOS blocks execution on first launch:
  ```bash
  xattr -cr "/Applications/Agent Resume.app"
  ```

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

# Build shared core
pnpm run build:core

# Extension commands
pnpm run compile       # Compile extension TypeScript
pnpm run watch         # Watch mode for extension dev
pnpm run install:local # Build VSIX & install to local VS Code/Cursor

# Desktop commands
pnpm run dev:desktop   # Start Desktop app in dev mode
pnpm run build:desktop # Build Desktop app bundle
pnpm run pack:desktop  # Package Universal macOS DMG
pnpm run doctor:desktop# Run Desktop environment diagnostic doctor
```

---

## 简体中文

### 概述与核心理念

**Agent Resume Panel** 是专为 AI Coding Agent (如 Codex, Claude Code, Antigravity 等) 打造的统一会话管理、工作回忆复盘与任务管理中心。

- **纯本地优先与隐私安全**：无需任何强制云端服务或数据上报。所有的会话元数据、对话索引、GTD 状态、Markdown 笔记以及 AI 日报均保存在本机的 `~/.agent-resume-panel` 目录下。
- **两个产品，一套存储**：VS Code 插件与 macOS Desktop 桌面端无缝共享相同的 SQLite 数据库 (`catalog.db`)、配置文件 (`settings.json`) 以及 Markdown 笔记目录 (`notes/`)，无需重复配置。

---

### 支持的 Agent 工具列表

| Provider / 工具 | 索引与解析范围 | 恢复与集成目标 |
|-----------------|----------------|----------------|
| **Codex (CLI & App)** | 历史对话 JSON/JSONL 记录、多轮消息、会话标题、项目路径 | VS Code 内置终端、Ghostty、Codex App、官方插件面板 |
| **Claude Code** | 位于 `~/.claude/projects` 的原生 CLI 项目会话 | VS Code 内置终端、Ghostty、官方插件面板 |
| **Antigravity / AGY** | Antigravity agent CLI 运行日志与项目会话 | 内置终端、Ghostty 外部终端 |
| **Grok Build** | Grok 构建 Agent 的任务日志与执行历史 | 内置终端、Ghostty 外部终端 |
| **OpenCode & Pi** | 通用 CLI 对话记录与多 Agent 交互日志 | 内置终端、Ghostty 外部终端 |
| **Cursor CLI & Composer** | Cursor IDE Composer 会话元数据与项目路径索引 | 直接在 Cursor IDE 中打开记录的项目 / Cursor CLI |

---

### 产品一：VS Code 扩展 (`apps/extension`)

**VS Code 扩展**将 AI 会话管理能力直接无缝融入编辑器的侧边栏面板（支持 VS Code、Cursor 及 VSCodium）。

#### 核心功能与模块

1. **会话管理 ([docs/panel/sessions.md](docs/panel/sessions.md))**:
   - **分组视图**：按 *Recent (近期)*、*Favorites (收藏)*、*Projects (项目)* 分类浏览会话。
   - **全局检索**：支持对会话标题、Prompt 提示词及时间戳进行全文与正则表达式搜索。
   - **Session Manager (会话管理器)**：支持批量隐藏会话、锁定自定义标题、固定关键会话或物理删除历史日志。
   - **悬浮快照**：无需切换上下文，悬浮即可快速预览会话首条 Prompt 及对话详情。

2. **恢复与目标调配 ([docs/panel/resume-and-targets.md](docs/panel/resume-and-targets.md))**:
   - **一键恢复**：无缝接续过去的对话上下文，迅速重拾代码思路。
   - **多种恢复目标 (Targets)**：
     - *集成终端*：直接在 VS Code 内置终端 Shell 中恢复会话。
     - *Ghostty*：在高性能的 Ghostty 外部终端中唤起会话。
     - *Claude / Codex 插件面板*：在官方 VS Code 插件 Webview 面板中恢复。
     - *Codex App*：在 Codex macOS 桌面应用中唤起会话。
     - *Cursor CLI*：在 Cursor 终端工具中接续对话。
   - **自定义环境与参数**：支持为不同恢复目标预设命令行参数与环境变量。

3. **ACP Chat ([docs/panel/acp-chat.md](docs/panel/acp-chat.md))**:
   - **编辑器旁 ACP 面板**：直接连接本地符合 Agent Client Protocol (ACP) 协议的 Agent（如 Claude Code, OpenCode 或自定义 ACP Agent）。
   - **流式思考与工具审核**：实时展示 Agent 的思考过程（Thinking），支持手动 Approve / Reject 工具执行请求。
   - **代码变更实时 Diff**：在应用修改前，直接在编辑器 Diff 标签页中预览代码变动。

4. **GTD 任务流 ([docs/panel/gtd.md](docs/panel/gtd.md))**:
   - **状态标记**：支持 Getting Things Done 规范标签（`@inbox`, `@next`, `@waiting`, `@someday`, `@reference`, `@done`）。
   - **高频动作提取**：自动从会话文本中解析并提取高频 Action Items。
   - **拖拽与右键分类**：快捷在不同执行桶之间流转任务状态。

5. **Markdown 笔记 ([docs/panel/notes.md](docs/panel/notes.md))**:
   - **多笔记关联**：每个会话或项目均可关联多条独立的 Markdown 笔记。
   - **媒体附件**：支持代码片段与本地截图附件。
   - **双端实时同步**：扩展内创建的笔记可即时在 Desktop 桌面端查看与编辑。

6. **LLM 智能辅助 ([docs/panel/llm-assist.md](docs/panel/llm-assist.md))**:
   - **自定义 API**：支持接入 OpenAI、Anthropic、DeepSeek、Ollama 或任意兼容 OpenAI 接口的模型。
   - **Auto Summary (自动摘要)**：一键将冗长复杂的会话总结为精炼的要点。
   - **Auto Rename (智能重命名)**：根据对话正文自动生成简短易读的会话标题。
   - **Handoff Brief (交接简报)**：生成结构化的交接 Brief，方便快速将上下文传递给其他 Agent 或同事。

---

### 产品二：Agent Resume Desktop 桌面端 (`apps/desktop`)

**Agent Resume Desktop** 是一款 macOS 原生 Electron 桌面应用，定位为 **Session OS + Memory (会话操作系统与记忆沉淀)**。

#### 核心功能与模块

1. **Report 日历回顾与 AI 总结 ([docs/desktop/report.md](docs/desktop/report.md))**:
   - **日历热力图**：通过日历大盘直观展示每日 AI 交互频率与工作活跃度。
   - **AI 自动工作回顾**：一键生成日/周/月 AI 工作报告，总结已完成任务、修改点、卡点分析及未尽事项。
   - **GTD 进度条**：全盘汇总所有项目下的 GTD 任务完成进度。

2. **Agent 记忆问答 ([docs/desktop/agent.md](docs/desktop/agent.md))**:
   - **自然语言回忆检索**：基于本地历史 Session 与 Daily Report 建立索引，支持自然语言提问（如：*“我上周在处理数据库迁移时遇到了什么报错？”*）。
   - **精准证据引用 (Citations)**：回答附带可点击的引用链接，可一键跳转至对应的历史 Session 或日报详情。
   - **Agent 工具与线程**：支持 Agent 工具调用与多轮深入探讨线程。

3. **Workbench 超级工作台 ([docs/desktop/workbench.md](docs/desktop/workbench.md))**:
   - **内嵌 xterm 终端**：高性能终端模拟器，预置多种经典/现代配色主题（Tokyo Night, One Dark, Solarized 等）。
   - **Visual ACP Chat**：可视化 ACP 聊天面板，支持流式对话与工具执行交互。
   - **多标签页 (Multi-Tab) 恢复**：支持在多个标签页中同时恢复并并行运行不同项目的 Agent 会话。
   - **项目与文件检索**：集成文件树资源管理器与项目文件模糊搜索。
   - **Git 工具集成**：代码 Diff 预览、图形化勾选 Commit 文件、图片拖拽/粘贴快捷转换为 Git 提交。
   - **脚本运行器 (Script Runner)**：一键快捷运行 `package.json` 中的自定义脚本。

4. **MCP 服务集成 ([docs/desktop/mcp.md](docs/desktop/mcp.md))**:
   - **原生 MCP (Model Context Protocol) 服务器**：内置 MCP Server 实现。
   - **工具暴露**：受信任的外部 AI 工具（如 Cursor, Claude Desktop, Windsurf）可通过 MCP 协议直接查询本机的 Notes、Daily Reports、Sessions 列表及 GTD 任务。

---

### 产品功能对比表

| 功能 / 特性 | VS Code 扩展 | Agent Resume Desktop (macOS) |
|-------------|:------------:|:----------------------------:|
| **核心定位** | 编辑器内会话恢复与 ACP 辅助 | 工作回顾、记忆回忆与独立 Session OS |
| **支持平台** | VS Code / Cursor / VSCodium (跨平台) | macOS 12+ (Apple Silicon & Intel 通用包) |
| **会话浏览与搜索** | ✅ 全文与正则表达式搜索 | ✅ 全文搜索与参考列表预览 |
| **恢复目标 (Targets)** | ✅ 内置终端、Ghostty、Claude/Codex 面板、Cursor CLI | ✅ 内置 xterm 工作台、外部终端 Shell |
| **ACP 交互对话** | ✅ 编辑器侧边栏面板 | ✅ Workbench 可视化 ACP 聊天 |
| **GTD 与 Markdown 笔记** | ✅ 编辑器内视图 | ✅ 全功能 Markdown 编辑与同步 |
| **AI 工作总结与日历大盘** | ❌ | ✅ 日/周/月 AI 工作回顾报告 |
| **Agent 记忆自然语言问答** | ❌ | ✅ 带引用 (Citations) 的自然语言回忆问答 |
| **xterm 多标签工作台** | ❌ | ✅ 集成 xterm 终端、Git 工具、脚本运行器 |
| **MCP Server 服务能力** | ❌ | ✅ 原生 MCP 服务器（对外暴露本地数据） |

---

### 共享核心架构 (`packages/core`)

两个产品共享 `@agent-resume/core` 核心模块，统一读写本机 **`~/.agent-resume-panel`** 目录：

```text
~/.agent-resume-panel/
├── catalog.db         # SQLite 数据库：存储会话元数据、索引与 GTD 标签
├── settings.json      # 共享配置文件：包含 LLM API Key、恢复目标与通用偏好
├── notes/             # Markdown 笔记目录与媒体附件（双端实时共享）
└── .desktop/          # Desktop 私有数据：向量索引、报告缓存与 MCP 偏好
```

---

### 安装与快速上手

#### 1. VS Code 扩展安装
- **VS Code Marketplace**: [前往 Marketplace 安装](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2)
- **Open VSX 市场**: 在 VSCodium 或支持 Open VSX 的编辑器中搜索 `agent-resume-panel-v2`。

#### 2. Agent Resume Desktop 桌面端安装 (macOS)
- **最新 Release 下载**: [下载 DMG 安装包](https://github.com/lucacicii/agent-resume-panel/releases/latest)
- **安装步骤**: 打开 DMG 并将 `Agent Resume.app` 拖入 `Applications (应用程序)` 目录。
- **macOS 安全提示 (Gatekeeper)**：若首次打开提示“无法验证开发者”，请在终端运行以下指令清除隔离标记：
  ```bash
  xattr -cr "/Applications/Agent Resume.app"
  ```

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

# 构建共享核心库
pnpm run build:core

# Extension 常用命令
pnpm run compile       # 编译 Extension TypeScript
pnpm run watch         # 开发监听模式
pnpm run install:local # 构建 VSIX 并安装至本机 VS Code/Cursor

# Desktop 常用命令
pnpm run dev:desktop   # 启动 Desktop 开发模式
pnpm run build:desktop # 构建 Desktop 产物
pnpm run pack:desktop  # 打包 macOS Universal DMG
pnpm run doctor:desktop# 运行 Desktop 环境诊断 Doctor
```

---

## License & Community

- **License**: Copyright (C) 2026 lucacicii. Licensed under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`).
- **Third-Party Notices**: See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Discord Community**: [discord.gg/CG2esx7K7](https://discord.gg/CG2esx7K7)
- **Feedback & Issues**: [GitHub Issues](https://github.com/lucacicii/agent-resume-panel/issues)
