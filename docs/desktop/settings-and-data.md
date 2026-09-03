# Settings & data

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### Open settings

Use the **⚙** button in the top bar. Settings panes:

| Pane | Typical contents |
|------|------------------|
| **General** | Language, **visual theme** (Default Dark, Cyberpunk, DOS Amber, Clean Light), historical backfill, startup-related options, Agent action approvals |
| **Models** | OpenAI-compatible LLM / embeddings endpoints and models |
| **Sessions** | Agent home paths, session list / sync related options |
| **Workbench** | Default agent, ⌘T behavior, **terminal theme** and related defaults |
| **IM** | Role templates (agent, prompt, read/write/execute tools) used by IM rooms |
| **Report** | Digest / memory related preferences |
| **Data** | Panel home path, open data folder, **backup export / merge import** |
| **Logs** | Application error / warning log (redacted), clear, reveal in Finder |
| **Usage** | Local LLM usage summary |
| **MCP** | Register trusted local agents for Notes / Reports / Sessions tools |
| **About** | Version, update check entry |

Desktop settings are **not** VS Code `agentResume.*` settings. Shared values (e.g. LLM) may live in panel-home files so both products can reuse them; Desktop also keeps desktop-specific config (e.g. under panel home / `.desktop`).

### Project `.arp/config.json`

Commit-message style in **Settings → Workbench** is the user default. A repo can override it with a committed `<repo>/.arp/config.json`:

```json
{
  "version": 1,
  "shared": {},
  "workbench": {
    "git": {
      "commitMessage": {
        "style": "conventional",
        "extraInstructions": "Use the package name as scope when it is clear."
      }
    }
  },
  "im": {}
}
```

`workbench`, `im`, and `shared` are separate groups. Missing groups mean unset, not an empty override. Do not put API keys, themes, or panel-home paths in this file.

### Agent action approvals

**General → Agent actions** includes **Always allow non-delete Agent actions**. It is off by default. When enabled, classified write, launch, command, and network actions in Agent Q&A skip the per-action confirmation. Delete and unknown-risk actions still require confirmation every time. The [Agent execution flow](agent.md#execution-flow-and-approvals) shows the resulting status and source for each action.

### Panel home (shared)

Default:

```text
~/.agent-resume-panel
```

| Content | Role |
|---------|------|
| `catalog.db` | Session index, GTD, note flags (shared) |
| Notes + assets | Shared Markdown notes |
| Shared settings files | e.g. LLM-related `settings.json` where applicable |
| `.desktop/` | Desktop-only extras (scheduler state, desktop schema, etc.) |

CLI transcripts remain in native agent homes. Change panel home only if you understand both products will need the same path to stay in sync.

### Updates

- In-app **version check** / update entry (About or update icon when available).  
- Download new DMGs from [Releases](https://github.com/lucacicii/agent-resume-panel/releases).  
- First-launch Gatekeeper steps: see [README install](README.md).

### Backup

**In-app:**

1. Open **Settings → Data** (Backup). Choose **Local ZIP** or **iCloud Drive**.
2. **Native Agent conversations** are included by default. The app includes only recognized conversation records for configured Codex, Claude, Grok, Pi, Cursor CLI, Antigravity, and OpenCode homes. Credentials, Agent configuration, caches, logs, downloads, and Cursor IDE conversation bodies are excluded.
3. A local ZIP is compatible with the existing merge flow and can contain readable native conversation content. Store it securely. API keys remain optional and are encrypted with the backup password.
4. iCloud Drive backups are written as encrypted `.arbak` files in `~/Library/Mobile Documents/com~apple~CloudDocs/Agent Resume/Backups`. A password is always required; it is never saved. Agent Resume reports that the file is saved, while macOS performs the actual iCloud sync. The latest 10 managed backups created by each Mac are retained.
5. Choose a ZIP or select an iCloud backup to preview it. **Restore native Agent conversations** is off by default. The merge keeps newer local native files and reports conflicts; it never copies Agent configuration or authentication files. If a provider exceeds the per-file or archive size limits, that provider is skipped and the backup shows an actionable warning; the rest of the backup still completes.

**Manual folder copy (full control):**

1. Copy **`~/.agent-resume-panel`** (or custom panel home), including `.desktop`.
2. Copy native agent homes separately only when you need files outside the supported conversation set.
3. Reinstall the app from the DMG on a new machine, then restore the folder before first heavy sync if possible.

### Privacy

- Digests, Agent Q&A, embeddings, and assist features contact **your** configured third-party APIs only when used.  
- Never commit API keys; do not paste them into GitHub issues.

### Feedback

- [Issues](https://github.com/lucacicii/agent-resume-panel/issues)  
- [Changelog](../../apps/desktop/CHANGELOG.md)

### Related

- [Report](report.md) · [Agent](agent.md) · [Workbench](workbench.md) · [Notes](notes.md)  
- Extension settings: [Extension Settings](../panel/settings-and-data.md)

---

## 简体中文

### 打开设置

点击顶部栏 **⚙**。各页大致内容：

| 页 | 常见内容 |
|----|----------|
| **通用** | 语言、**视觉主题**（默认暗色、赛博朋克、DOS 琥珀、简约亮色）、历史回填、启动相关、Agent 操作授权 |
| **模型** | OpenAI 兼容 LLM / embeddings 端点与模型 |
| **Sessions** | 各 Agent 目录、会话列表 / 同步相关 |
| **Workbench** | 默认 Agent、⌘T 行为、**终端主题** 与相关默认 |
| **Report** | 回顾 / Memory 相关偏好 |
| **数据** | Panel home 路径、打开数据目录、**备份导出 / 合并导入** |
| **日志** | 应用错误 / 警告日志（脱敏）、清空、在访达中显示 |
| **用量** | 本机 LLM 用量汇总 |
| **MCP** | 为受信任的本机 Agent 注册 Notes / Reports / Sessions 工具 |
| **关于** | 版本、更新检查入口 |

Desktop 设置 **不是** VS Code 的 `agentResume.*`。可共用的值（如 LLM）可能写在 panel home 文件中供两产品复用；Desktop 另有桌面端专用配置（如 `.desktop`）。

### 项目级 `.arp/config.json`

**设置 → Workbench** 中的提交信息格式是用户默认。仓库可用已提交的 `<repo>/.arp/config.json` 覆盖：

```json
{
  "version": 1,
  "shared": {},
  "workbench": {
    "git": {
      "commitMessage": {
        "style": "conventional",
        "extraInstructions": "范围能确定时使用包名作为 scope。"
      }
    }
  },
  "im": {}
}
```

`workbench`、`im`、`shared` 是独立分组；缺省分组表示未配置，不是空覆盖。不要把 API Key、主题或 panel home 写进该文件。

### Agent 操作授权

**通用 → Agent 操作** 提供 **始终允许非删除 Agent 操作**，默认关闭。开启后，Agent 问答中已分类的写入、启动、命令和网络操作会跳过逐次确认；删除和未知风险操作仍会每次确认。每项操作的来源、状态与详情可在 [Agent 执行流程](agent.md#执行流程与授权) 查看。

### 数据目录（共用）

默认：

```text
~/.agent-resume-panel
```

| 内容 | 作用 |
|------|------|
| `catalog.db` | 会话索引、GTD、笔记标记（共用） |
| 笔记 + 资源 | 共用 Markdown |
| 共用设置文件 | 如 LLM 相关 `settings.json` |
| `.desktop/` | 仅 Desktop（调度、桌面 schema 等） |

CLI 原文仍在各 Agent 原生目录。修改 panel home 时请确保两产品使用同一路径以保持同步。

### 更新

- 应用内 **版本检查** / 更新入口（关于页或更新图标）。  
- 也可从 [Releases](https://github.com/lucacicii/agent-resume-panel/releases) 下载新 DMG。  
- 首次启动系统拦截步骤见 [README 安装](README.md)。

### 备份

**应用内：**

1. 打开 **设置 → 数据**（备份），选择 **本地 ZIP** 或 **iCloud Drive**。
2. 默认包含 **原始 Agent 对话**。应用只会从已配置的 Codex、Claude、Grok、Pi、Cursor CLI、Antigravity 与 OpenCode 目录收集可识别的对话记录；不会收集凭据、Agent 配置、缓存、日志、下载资源或 Cursor IDE 的对话正文。
3. 本地 ZIP 与原有合并流程兼容，也可能包含可直接阅读的原始对话，请安全保存。API Key 仍为可选项，并使用备份密码加密。
4. iCloud Drive 备份会保存为 `~/Library/Mobile Documents/com~apple~CloudDocs/Agent Resume/Backups` 中的加密 `.arbak` 文件，始终需要密码且不会保存密码。应用只提示“已保存”，实际 iCloud 同步由 macOS 完成。每台 Mac 仅保留自己创建的最近 10 份受管备份。
5. 选择 ZIP 或 iCloud 备份后可先预览。**恢复原始 Agent 对话** 默认关闭；合并会保留本机较新的原始文件并报告冲突，绝不会复制 Agent 配置或认证文件。如果某个 Provider 超过单文件或归档容量限制，该 Provider 会被跳过并显示可操作的警告，其余备份仍会完成。

**手动复制目录（完全控制）：**

1. 备份 **`~/.agent-resume-panel`**（含 `.desktop`）。
2. 只有在需要受支持对话集合以外的文件时，才单独复制原生 Agent 目录。
3. 新机器安装 DMG 后，尽量在大量同步前恢复该目录。

### 隐私

- 报告生成、Agent 问答、embeddings 等仅在使用时访问 **你配置的** 第三方 API。  
- 勿将 API Key 提交进仓库或贴进 Issue。

### 反馈

- [Issues](https://github.com/lucacicii/agent-resume-panel/issues)  
- [更新日志](../../apps/desktop/CHANGELOG.md)

### 相关文档

- [Report](report.md) · [Agent](agent.md) · [Workbench](workbench.md) · [Notes](notes.md)  
- 扩展设置：[扩展设置](../panel/settings-and-data.md)
