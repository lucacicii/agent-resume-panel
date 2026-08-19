# Settings & data

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### Open settings

- Gear on the **Sessions** view, or  
- Command **Agent Resume: Open Settings**

VS Code also exposes many keys under `agentResume.*` in Settings UI. After an **in-place extension upgrade**, if menus look wrong, run **Developer: Reload Window** (sidebar Refresh does not reload package contributions).

### Panel home (shared data)

Default directory:

```text
~/.agent-resume-panel
```

Shared with **Agent Resume Desktop** when both use the same path:

| Content | Role |
|---------|------|
| `catalog.db` | Session index, GTD, note flags, etc. |
| Notes files / assets | Markdown notes |
| `settings.json` (and related) | Shared LLM / panel settings where applicable |
| ACP chat records | Extension ACP data |
| Desktop extras | Under `panelHome/.desktop/` (Desktop-only) |

CLI **transcripts** remain in each agent’s native home (`~/.codex`, `~/.claude`, …). Back those up separately when migrating machines.

You can override **panel home** and **catalog DB path** in settings if needed.

### Common setting groups

| Area | Examples |
|------|----------|
| **Agent homes** | `codexHome`, `claudeHome`, Antigravity, Grok, OpenCode, Pi paths |
| **Catalog** | sync max items, stale policy, sidebar mode |
| **Terminal / resume** | terminal mode & location, Ghostty path/mode, Claude/Codex resume modes, IDE panel resume |
| **ACP** | auto-approve permissions, per-agent command/args |
| **LLM Assist** | base URL, model, output language, max context |
| **Menus** | project / session menu main actions and order |
| **Handoff** | attach recent verbatim, max brief tokens |
| **UI** | UI language (en / zh-cn / ja), max items, archive/subagent filters per provider |

API keys should never be pasted into issues or committed to git.

### Backup

1. Copy **`~/.agent-resume-panel`** (or your custom panel home).  
2. Copy native agent homes you care about (transcripts).  
3. Optionally use **Session Manager → Export** for conversation backups from the catalog/export path.

### Language

UI language can follow VS Code or be forced via `agentResume.uiLanguage` (English / 简体中文 / 日本語 where supported).

### Feedback

- Issues: [Issues](https://github.com/lucacicii/agent-resume-panel/issues)  
- Do not paste API keys, full transcripts, or sensitive paths.

### Related

- [Sessions](sessions.md) · [Resume & targets](resume-and-targets.md) · [ACP Chat](acp-chat.md) · [LLM Assist](llm-assist.md)  
- [Desktop settings & data](../desktop/README.md)

---

## 简体中文

### 打开设置

- **Sessions** 视图齿轮，或  
- 命令 **Agent Resume: Open Settings**

许多项也在 VS Code 设置 UI 的 `agentResume.*` 下。若 **就地升级扩展** 后菜单异常，请执行 **Developer: Reload Window**（侧边栏 Refresh 不会重载贡献点）。

### 面板数据目录（共用）

默认路径：

```text
~/.agent-resume-panel
```

与 **Agent Resume Desktop** 在同一路径时共用：

| 内容 | 作用 |
|------|------|
| `catalog.db` | 会话索引、GTD、笔记标记等 |
| 笔记文件 / 资源 | Markdown 笔记 |
| `settings.json` 等 | 共用 LLM / 面板相关设置 |
| ACP 聊天记录 | 扩展 ACP 数据 |
| Desktop 私有 | `panelHome/.desktop/`（仅 Desktop） |

CLI **对话原文** 仍在各 Agent 原生目录（`~/.codex`、`~/.claude` 等），换机请单独备份。

可在设置中覆盖 **panel home** 与 **catalog DB 路径**。

### 常见设置分组

| 区域 | 示例 |
|------|------|
| **Agent 目录** | Codex / Claude / Antigravity / Grok / OpenCode / Pi 路径 |
| **目录 Catalog** | 同步条数上限、过期策略、侧边栏模式 |
| **终端 / 恢复** | 终端模式与位置、Ghostty、Claude/Codex resume、IDE 面板恢复 |
| **ACP** | 自动批准权限、各 Agent command/args |
| **LLM 辅助** | base URL、model、输出语言、最大上下文 |
| **菜单** | 项目 / 会话主操作与顺序 |
| **Handoff** | 是否附带近文、brief token 上限 |
| **界面** | 语言（en / zh-cn / ja）、条数、归档 / subagent 过滤 |

请勿把 API Key 贴进 Issue 或提交进 git。

### 备份

1. 备份 **`~/.agent-resume-panel`**（或自定义 panel home）。  
2. 备份关心的原生 Agent 目录（对话原文）。  
3. 可选：**Session Manager → Export** 导出对话备份。

### 语言

界面语言可跟随 VS Code，或通过 `agentResume.uiLanguage` 强制（支持范围内的中 / 英 / 日）。

### 反馈

- [Issues](https://github.com/lucacicii/agent-resume-panel/issues)  
- 请勿粘贴 API Key、完整对话或敏感路径。

### 相关文档

- [会话 Sessions](sessions.md) · [恢复与目标](resume-and-targets.md) · [ACP Chat](acp-chat.md) · [LLM 辅助](llm-assist.md)  
- [Desktop 设置与数据](../desktop/README.md)
