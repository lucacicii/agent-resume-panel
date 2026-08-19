# Agent Resume Desktop — User Documentation

Languages: [English](#english) | [简体中文](#简体中文)

macOS-oriented **Session OS + Memory** desktop app: calendar digests, **Agent** Q&A over reports, **Workbench** with embedded terminal, plus **Notes** and **GTD** workflows.

Pairs with the **Agent Resume Panel VS Code extension** — same agent sessions, same `~/.agent-resume-panel` data directory, no duplicate setup.

| | Desktop app (macOS) | VS Code extension |
|---|---|---|
| **Install** | [Download DMG](https://github.com/thunder-luc/agent-resume-panel/releases/latest) | [Marketplace](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2) |
| **Docs** | [docs/desktop](README.md) | [docs/panel](../panel/README.md) |

[Changelog](../../apps/desktop/CHANGELOG.md) · [Latest release](https://github.com/thunder-luc/agent-resume-panel/releases/latest) · Extension: **2.6.12**

> **No cloud · Local-first**  
> Data is stored under **`~/.agent-resume-panel`** by default (shared with the VS Code extension; change in settings).  
> Digest generation, Agent chat, and semantic search only use a third-party API when you configure one.

---

## English

### Download & install

- **macOS** (Apple Silicon + Intel universal): [Latest release](https://github.com/thunder-luc/agent-resume-panel/releases/latest)
- Open the DMG and drag **Agent Resume** into **Applications**.
- **First launch:** macOS may block the app because it is not notarized. Right-click the app → **Open** once, or run:

  ```bash
  xattr -cr "/Applications/Agent Resume.app"
  ```

Requirements: macOS 12+, Apple Silicon or Intel. Version history: [Changelog](../../apps/desktop/CHANGELOG.md).

### Documentation by module

| Module | What it covers |
|--------|----------------|
| [Report](report.md) | Calendar, daily/weekly/monthly digests, GTD bar, analyze → apply |
| [Agent](agent.md) | Natural-language Q&A over local work history, citations, tools, and threads |
| [Workbench](workbench.md) | Embedded terminal (themes), ACP visual chat, multi-tab resume, project search, scripts, Git select-commit, explorer |
| [Sessions](sessions.md) | Reference list and read-only preview |
| [Notes](notes.md) | Markdown editor shared with the extension |
| [MCP](mcp.md) | Register trusted local agents to use Notes, Reports, Sessions, and GTD tools |
| [Settings & data](settings-and-data.md) | Settings panes, backup/merge, logs, data directory, usage, updates |

### Navigation (at a glance)

| Entry | Role |
|-------|------|
| **Report** (default) | Calendar · digests · GTD bar · day detail |
| **Agent** | Q&A over digests / work history |
| **Workbench** | Session list + ACP visual chat + embedded or external terminal |
| **Notes** | Markdown notes |
| **Sessions** (toolbar) | Reference list + preview |
| **⚙ Settings** | General, models, sessions, workbench, report, data, MCP, usage, about |

### VS Code extension vs Desktop

| | **Agent Resume Desktop** | **VS Code extension** |
|---|---|---|
| **What it is** | Standalone macOS app — **Session OS + Memory** | Sidebar panel inside VS Code / Cursor / VSCodium |
| **Best for** | Calendar digests, **Agent** Q&A, embedded **Workbench** | Resume while coding; **ACP Chat**; GTD / Notes in the IDE |
| **Desktop-only** | Daily / weekly / monthly digests; semantic recall over reports; xterm Workbench + git tools | — |
| **Extension-only** | — | ACP Chat; Claude / Codex IDE panel resume; Ghostty targets |

**Shared:** `catalog.db`, GTD tags, Notes, LLM settings (`settings.json`). Desktop extras live under `panelHome/.desktop/`.

[Download Desktop](https://github.com/thunder-luc/agent-resume-panel/releases/latest) · [Install extension](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2) · [Extension docs](../panel/README.md)

### Feedback & support

- **Discord community**: [discord.gg/CG2esx7K7](https://discord.gg/CG2esx7K7)
- **Bugs / feature requests**: [GitHub Issues](https://github.com/thunder-luc/agent-resume-panel/issues)
- Do not paste API keys, full transcripts, or sensitive paths in issues.

### Related links

- [Changelog](../../apps/desktop/CHANGELOG.md)
- [VS Code extension documentation](../panel/README.md)
- [Install VS Code extension](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2)

---

## 简体中文

macOS 导向的 **Session OS + Memory** 桌面应用：日历回顾 AI 工作记忆，**Agent** 对报告问答，**Workbench** 恢复会话并嵌入终端，配合 **Notes** 与 **GTD**。

与 **Agent Resume Panel VS Code 扩展** 搭配使用 — 同一批 Agent 会话、共用 **`~/.agent-resume-panel`**，无需重复配置。

| | Desktop 桌面端（macOS） | VS Code 扩展 |
|---|---|---|
| **安装** | [下载 DMG](https://github.com/thunder-luc/agent-resume-panel/releases/latest) | [Marketplace](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2) |
| **文档** | [docs/desktop](README.md) | [docs/panel](../panel/README.md) |

[更新日志](../../apps/desktop/CHANGELOG.md) · [最新版本](https://github.com/thunder-luc/agent-resume-panel/releases/latest) · 扩展：**2.6.12**

> **无云端 · 纯本机存储**  
> 数据默认在 **`~/.agent-resume-panel`**（与 VS Code 扩展共用，可在设置中修改）。

### 下载安装

- **macOS**（Apple Silicon + Intel 通用包）：[最新版本](https://github.com/thunder-luc/agent-resume-panel/releases/latest)
- 打开 DMG，将 **Agent Resume** 拖入 **应用程序**。
- **首次打开：** 应用未经 Apple 公证，macOS 可能拦截。请右键应用 → **打开** 一次，或执行：

  ```bash
  xattr -cr "/Applications/Agent Resume.app"
  ```

系统要求：macOS 12+，Apple Silicon 或 Intel。版本历史：[更新日志](../../apps/desktop/CHANGELOG.md)。

### 按模块阅读

| 模块 | 内容 |
|------|------|
| [Report](report.md) | 日历、日/周/月报、GTD 条、分析并应用 |
| [Agent](agent.md) | 基于本机工作历史的自然语言问答、引用、工具与线程 |
| [Workbench](workbench.md) | 内嵌终端（配色）、ACP 可视化聊天、多标签恢复、项目搜索、脚本、Git 选择提交、资源管理器 |
| [Sessions](sessions.md) | 参考列表与只读预览 |
| [Notes](notes.md) | 与扩展共用的 Markdown 笔记 |
| [MCP](mcp.md) | 为受信任的本机 Agent 注册 Notes、Reports、Sessions 与 GTD 工具 |
| [设置与数据](settings-and-data.md) | 各设置页、备份/合并、日志、数据目录、用量、更新 |

### 导航一览

| 入口 | 作用 |
|------|------|
| **Report**（默认） | 日历 · 回顾 · GTD 条 · 日详情 |
| **Agent** | 对报告 / 工作历史问答 |
| **Workbench** | 会话列表 + ACP 可视化聊天 + 嵌入式 / 外部终端 |
| **Notes** | Markdown 笔记 |
| **Sessions**（工具栏） | 参考列表 + 预览 |
| **⚙ Settings** | 通用、模型、会话、工作台、Report、数据、MCP、用量、关于 |

### VS Code 扩展 vs Desktop

| | **Agent Resume Desktop** | **VS Code 扩展** |
|---|---|---|
| **定位** | 独立 macOS 应用 — **Session OS + Memory** | VS Code / Cursor / VSCodium 侧边栏面板 |
| **适合场景** | 日历日报、对报告 **Agent** 问答、内嵌 **Workbench** | 写代码时恢复会话；编辑器旁 **ACP Chat**；IDE 内 GTD / 笔记 |
| **仅 Desktop** | 日 / 周 / 月 Digest；基于报告的语义回忆；xterm Workbench + Git 工具 | — |
| **仅扩展** | — | ACP Chat；Claude / Codex 插件面板恢复；Ghostty |

**共用：** `catalog.db`、GTD、Notes、LLM 设置（`settings.json`）。Desktop 私有数据在 `panelHome/.desktop/`。

[下载 Desktop](https://github.com/thunder-luc/agent-resume-panel/releases/latest) · [安装扩展](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2) · [扩展文档](../panel/README.md)

### 反馈与支持

- **Discord 社区**：[discord.gg/CG2esx7K7](https://discord.gg/CG2esx7K7)
- [GitHub Issues](https://github.com/thunder-luc/agent-resume-panel/issues)
- 请勿粘贴 API Key、完整对话内容或敏感路径。

### 相关链接

- [更新日志](../../apps/desktop/CHANGELOG.md)
- [VS Code 扩展用户文档](../panel/README.md)
- [安装 VS Code 扩展](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2)
