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
| **Workbench** | Embedded terminal with multi-tab session resume and Git tooling |
| **Notes** | Markdown note editor (shared with the extension) |
| **Sessions** | Reference list and read-only preview |

### External agent MCP

**Agent Resume MCP** is one local stdio service that lets a trusted local agent work with the same Notes, Reports, Sessions, and GTD data as Desktop. Open **Settings → MCP** to register detected Codex, Claude Code, Gemini CLI, Antigravity, or OpenCode installations. Cursor, Pi, and Grok Build use the copyable configuration from that page.

The service exposes 20 tools: 11 for Notes and note GTD, 3 for Reports, and 6 for Sessions. Registered agents can create, update, and permanently delete local data, so only register clients you trust. The service does not open a network port. See the [MCP user guide](https://github.com/thunder-luc/agent-resume-desktop-doc/blob/main/mcp.md) for the tool reference and registration details.

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
| **Workbench** | 内嵌终端、多标签恢复与 Git 工具 |
| **Notes** | Markdown 笔记编辑（与扩展共用） |
| **Sessions** | 会话参考列表与只读预览 |

### 外部 Agent MCP

**Agent Resume MCP** 是一个本机 stdio 聚合服务，让受信任的本机 Agent 使用与 Desktop 相同的 Notes、Reports、Sessions 与 GTD 数据。在 **设置 → MCP** 中可注册已检测到的 Codex、Claude Code、Gemini CLI、Antigravity 与 OpenCode；Cursor、Pi、Grok Build 可从该页面复制配置后手动添加。

服务当前提供 20 个工具：Notes 与笔记 GTD 11 个、Reports 3 个、Sessions 6 个。注册后的 Agent 可创建、修改和永久删除本机数据，请仅注册可信客户端。服务不会开放网络端口。工具说明与注册细节见 [MCP 使用文档](https://github.com/thunder-luc/agent-resume-desktop-doc/blob/main/mcp.md)。

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
