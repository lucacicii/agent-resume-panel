# Settings & data

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### Open settings

Use the **⚙** button in the top bar. Settings panes:

| Pane | Typical contents |
|------|------------------|
| **General** | Language, appearance (system / light / dark), notifications |
| **Providers** | AI provider pool and per-feature model selection |
| **Sessions** | Agent home paths, session list / sync related options |
| **Workbench** | Default agent, ⌘T behavior, **workspace mentions**, **terminal theme** and related defaults |
| **Selection** | Text selection actions (built-in Translate / Explain and custom actions) |
| **Data** | Panel home path, open data folder, **backup export / merge import** (local ZIP, iCloud Drive, WebDAV) |
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
  }
}
```

`workbench` and `shared` are separate groups. Missing groups mean unset, not an empty override. Do not put API keys, themes, or panel-home paths in this file.

### Workspace mentions

**Settings → Workbench → Workspace mentions** stores global packs in `settings.desktop.json` (`workbench.composerMentions`). They are not per-repo `.arp` files. Full usage (New session, `arpm`, limits): [Workspace mentions](workspace-mentions.md).

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

1. Open **Settings → Data** (Backup). Choose **Local ZIP**, **iCloud Drive**, or **WebDAV**.
2. **Native Agent conversations** are included by default. The app includes only recognized conversation records for configured Codex, Claude, Grok, Pi, Cursor CLI, Antigravity, OpenCode, and Thunder homes. Credentials, Agent configuration, caches, logs, downloads, Thunder `traces/`, and Cursor IDE conversation bodies are excluded.
3. Backups are **unencrypted ZIP files** and contain full conversation text and note bodies. API keys are never written into a backup. Store them where only you can read them.
4. **iCloud Drive** backups go to `~/Library/Mobile Documents/com~apple~CloudDocs/Agent Resume/Backups`. Agent Resume reports that the file is saved, while macOS performs the actual iCloud sync.
5. **WebDAV** is configured once in the same pane: server URL (for example `https://dav.jianguoyun.com/dav/`), username, app password, and a remote folder (default `Agent Resume/Backups`). The app password is encrypted with the system keychain (Electron `safeStorage`) and never written in plaintext or returned to the window. Use **Test connection** to verify the folder before uploading.
6. Each machine keeps the latest 10 backups it created on the selected remote target; older ones are deleted. Files are uploaded as `.partial` and renamed only when complete, so an interrupted upload never appears in the list.
7. Choose a ZIP or select a stored backup to preview it. **Restore native Agent conversations** is off by default. The merge keeps newer local native files and reports conflicts; it never copies Agent configuration or authentication files. If a provider exceeds the per-file or archive size limits, that provider is skipped and the backup shows an actionable warning; the rest of the backup still completes.
8. What a backup contains: `catalog.db` and `desktop.db` (rebuildable search/vector indexes excluded), notes with their assets, archive marks and hierarchy, ACP threads, task templates and images, Thunder conversations, and `settings.json` / `settings.desktop.json` with credentials stripped.
9. Backups written by older releases are encrypted `.arbak` files. They still appear in the list and can be restored, but the password used when they were created is required. New backups are always plain ZIPs.

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

- [Report](report.md) · [Agent](agent.md) · [Workbench](workbench.md) · [Notes](notes.md) · [Workspace mentions](workspace-mentions.md)  
- Extension settings: [Extension Settings](../panel/settings-and-data.md)

---

## 简体中文

### 打开设置

点击顶部栏 **⚙**。各页大致内容：

| 页 | 常见内容 |
|----|----------|
| **通用** | 语言、外观（跟随系统 / 浅色 / 深色）、通知 |
| **模型** | AI 供应商池与分功能模型选择 |
| **Sessions** | 各 Agent 目录、会话列表 / 同步相关 |
| **Workbench** | 默认 Agent、⌘T 行为、**工作区 Mention**、**终端主题** 与相关默认 |
| **数据** | Panel home 路径、打开数据目录、**备份导出 / 合并导入**（本地 ZIP、iCloud Drive、WebDAV） |
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
  }
}
```

`workbench`、`shared` 是独立分组；缺省分组表示未配置，不是空覆盖。不要把 API Key、主题或 panel home 写进该文件。

### 工作区 Mention

**设置 → Workbench → 工作区 Mention** 把全局包写在 `settings.desktop.json` 的 `workbench.composerMentions`，不是某个仓库的 `.arp`。完整用法（新建会话、`arpm`、限制）见 [工作区 Mention](workspace-mentions.md)。

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

1. 打开 **设置 → 数据**（备份），选择 **本地 ZIP**、**iCloud Drive** 或 **WebDAV**。
2. 默认包含 **原始 Agent 对话**。应用只会从已配置的 Codex、Claude、Grok、Pi、Cursor CLI、Antigravity、OpenCode 与 Thunder 目录收集可识别的对话记录；不会收集凭据、Agent 配置、缓存、日志、下载资源、Thunder 的 `traces/` 或 Cursor IDE 的对话正文。
3. 备份是 **未加密的 ZIP 文件**，包含完整对话正文与笔记内容；API Key 永远不会写入备份。请把备份放在只有你能读取的位置。
4. **iCloud Drive** 备份保存到 `~/Library/Mobile Documents/com~apple~CloudDocs/Agent Resume/Backups`。应用只提示“已保存”，实际 iCloud 同步由 macOS 完成。
5. **WebDAV** 在同一页配置一次：服务器地址（例如 `https://dav.jianguoyun.com/dav/`）、用户名、应用密码与远端目录（默认 `Agent Resume/Backups`）。应用密码经系统钥匙串（Electron `safeStorage`）加密，不会以明文写入磁盘，也不会返回给界面。上传前可先用 **测试连接** 验证目录。
6. 每台机器在所选远端目标上仅保留自己创建的最近 10 份备份，更旧的会被删除。上传时先写成 `.partial`，完成后再改名，因此中断的上传不会出现在列表里。
7. 选择 ZIP 或某份已存备份后可先预览。**恢复原始 Agent 对话** 默认关闭；合并会保留本机较新的原始文件并报告冲突，绝不会复制 Agent 配置或认证文件。如果某个 Provider 超过单文件或归档容量限制，该 Provider 会被跳过并显示可操作的警告，其余备份仍会完成。
8. 备份内容：`catalog.db` 与 `desktop.db`（不含可重建的搜索/向量索引）、笔记及其附件、归档状态与层级、ACP 线程、任务模板与图片、Thunder 对话，以及剔除凭据后的 `settings.json` / `settings.desktop.json`。
9. 旧版本写出的是加密 `.arbak` 文件：仍会出现在列表中并可恢复，但需要当时设置的密码。新备份一律为明文 ZIP。

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

- [Report](report.md) · [Agent](agent.md) · [Workbench](workbench.md) · [Notes](notes.md) · [工作区 Mention](workspace-mentions.md)  
- 扩展设置：[扩展设置](../panel/settings-and-data.md)
