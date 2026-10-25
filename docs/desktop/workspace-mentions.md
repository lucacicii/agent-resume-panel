# Workspace mentions

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### What it is

A **workspace pack** is a named directory context you summon with `@` in a chat composer:

```text
@anfeng
```

Typing it in the **board chat** or the **Quick Agent** window does two things at once:

1. **Points the conversation at the pack's work folder.** The agent's working directory — and the `git` / search slash commands that run against it — move to that folder.
2. **Carries the pack's read-only reference folders into the prompt** as a `[Workspace anfeng]` block, so the agent knows which sibling repos it may read but must not write to.

The conversation itself continues: switching packs does **not** start a new session. A notice confirms the working directory changed.

Packs live in Desktop settings and are shared with the `arpm` CLI:

```text
~/.agent-resume-panel/settings.desktop.json
→ workbench.composerMentions
```

Example:

| Id | Work folder (agent writes here) | Reference folders (read only) |
|----|--------------------------------|-------------------------------|
| `anfeng` | `~/wb/wlgk/anfeng` | — |
| `auth` | `~/wb/wb-auth/web-ums` | `~/wb/wb-auth/ums`, `~/wb/wb-auth/auth` |

### Related `@`, `#` and `/`

- `@name` — a workspace pack (relocates the conversation) or a catalog project (relocates only), or a note / task / session (injects its content).
- `#path` — references one file or directory inside the current workspace, without moving it.
- `/command` — a skill, an MCP tool, or one of the Quick Agent's local lookups (`/git status`, `/git log`, `/find`).

### Configure

1. Open **⚙ Settings → Workbench**.
2. Under **Workspace mentions**, click **Add workspace pack**.
3. Set **Mention id** (`anfeng` — letters, digits, `_`, `-`; no `@` in the stored id).
4. Set **Work folder** (absolute or `~/…`).
5. Optionally add **Reference folders**, one absolute path per line.
6. Fields save when they lose focus.

Ids are unique case-insensitively. Rows with an empty id or work folder are dropped on save, and duplicate ids keep the first.

### Finder paths

No pack needed for a one-off directory: drag a folder from Finder onto a chat composer and the conversation points there, exactly as an `@pack` would (minus references).

With no remembered workspace, a fresh conversation runs from your home directory.

---

## 简体中文

### 是什么

**工作区 pack** 是一个有名有姓的目录上下文，在聊天输入框里用 `@` 唤起：

```text
@anfeng
```

在**看板聊天**或**悬浮助手**窗口里输入它，会同时做两件事：

1. **把该对话定位到 pack 的工作目录**。agent 的工作目录、以及针对它运行的 `git` / 查找斜杠命令，都切到这个目录。
2. **把 pack 的只读参考目录带进提示词**，形如 `[Workspace anfeng]` 块——agent 因此知道哪些兄弟仓库可读不可写。

对话本身是**延续**的：切换 pack 不会开新会话，只会弹一条提示告诉你工作目录变了。

Pack 存在 Desktop 设置里，与 `arpm` CLI 共用同一份数据：

```text
~/.agent-resume-panel/settings.desktop.json
→ workbench.composerMentions
```

示例：

| ID | 工作目录（agent 写入此处） | 参考目录（只读） |
|----|---------------------------|-----------------|
| `anfeng` | `~/wb/wlgk/anfeng` | — |
| `auth` | `~/wb/wb-auth/web-ums` | `~/wb/wb-auth/ums`、`~/wb/wb-auth/auth` |

### `@`、`#`、`/` 的分工

- `@名字` —— 工作区 pack（同时切换对话目录）或项目别名（只切目录），也可以是笔记 / 任务 / 会话（注入其内容）。
- `#路径` —— 引用当前工作区里的某个文件或目录，但不切换目录。
- `/命令` —— 技能、MCP 工具，或悬浮助手的本地快查（`/git status`、`/git log`、`/find`）。

### 配置

1. 打开 **⚙ 设置 → Workbench**。
2. 在 **工作区提及（@）** 里点「新增工作区 pack」。
3. 填**提及 ID**（`anfeng`，允许字母、数字、`_`、`-`；存储时不带 `@`）。
4. 填**工作目录**（绝对路径或 `~/…`）。
5. 可选填**参考目录**，每行一个绝对路径。
6. 字段失焦即保存。

ID 大小写不敏感且唯一；ID 或工作目录为空的行在保存时丢弃，重复 ID 保留第一个。

### Finder 路径

一次性的目录不必配 pack：从 Finder 把文件夹拖到聊天输入框，对话就定位到那里（只是不带参考目录）。

若没有任何记住的工作区，新对话默认从用户主目录（`~`）开始。
