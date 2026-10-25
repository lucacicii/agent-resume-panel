# Workspace mentions

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### What it is

A **workspace pack** is a *named directory* you summon with `@` in a chat composer:

```text
@anfeng
```

Typing it in the **board chat** or the **Quick Agent** window points the conversation at the pack's directory. The agent's working directory — and the `git` / `#` / search commands that run against it — move there.

A pack is only a name for a directory. It grants no extra folders: a Thunder run is confined to its working directory, and the directories it may also read are decided by the run itself (a GTD task's referenced repositories), not by a pack.

Cite **several packs in one message** (`@front @back …`) and every pack except the bound one is granted to that run as an additional root — same read/write standing as the workspace — so one message can edit and cross-check repositories that share no parent directory. The grant is real and invisible to you: the message on screen stays exactly what you typed (`@front @back 改一下登录接口`), while the agent receives the same sentence plus a `[Additional workspace roots (read/write): …]` line naming the extra directories it may touch.

The conversation itself continues: switching packs does **not** start a new session. A notice confirms the working directory changed.

Packs live in Desktop settings and are shared with the `arpm` CLI:

```text
~/.agent-resume-panel/settings.desktop.json
→ workbench.composerMentions
```

Example:

| Id | Directory |
|----|-----------|
| `anfeng` | `~/wb/wlgk/anfeng` |
| `auth` | `~/wb/wb-auth/web-ums` |

### Related `@`, `#` and `/`

- `@name` — a workspace pack or a catalog project (both relocate the conversation); a **task** binds the task instead, so the run inherits every repository the task references (plus its context and worktree rule); a note or session injects its content.
- `#path` — references one file or directory inside the current workspace, without moving it.
- `/command` — a skill, an MCP tool, or one of the Quick Agent's local lookups (`/git status`, `/git log`, `/find`).

### Configure

1. Open **⚙ Settings → Workbench**.
2. Under **Workspace mentions**, click **Add workspace pack**.
3. Set **Mention id** (`anfeng` — letters, digits, `_`, `-`; no `@` in the stored id).
4. Set the **Directory** (absolute or `~/…`).
5. Fields save when they lose focus.

Ids are unique case-insensitively. Rows with an empty id or directory are dropped on save, and duplicate ids keep the first.

### Finder paths

No pack needed for a one-off directory: drag a folder from Finder onto a chat composer and the conversation points there, exactly as an `@pack` would.

With no remembered workspace, a fresh conversation runs from your home directory.

---

## 简体中文

### 是什么

**工作区 pack** 就是「一个有名字的目录」，在聊天输入框里用 `@` 唤起：

```text
@anfeng
```

在**看板聊天**或**悬浮助手**窗口里输入它，会把该对话定位到 pack 的目录。agent 的工作目录、以及 `git` / `#` / 查找等命令，都跟着切到那里。

pack 只是目录的名字，不授予任何额外目录：一次 Thunder 运行被限制在它的工作目录内，另外可读的目录由那次运行本身决定（GTD 任务引用的仓库），与 pack 无关。

可以在**一条消息里艾特多个 pack**（`@front @back …`）：除当前绑定的那个之外，每个被艾特的 pack 都会作为本次运行的**额外根**授予——与工作目录同权（读写），所以一条消息就能同时修改、相互参考不在同一父目录下的多个仓库。这个授权是真的、但对你不可见：屏幕上就是你打的那句话（`@front @back 改一下登录接口`），而 agent 收到的是同一句 + 一行 `[Additional workspace roots (read/write): …]`，列出它能碰的额外目录。

对话本身是**延续**的：切换 pack 不会开新会话，只会弹一条提示告诉你工作目录变了。

Pack 存在 Desktop 设置里，与 `arpm` CLI 共用同一份数据：

```text
~/.agent-resume-panel/settings.desktop.json
→ workbench.composerMentions
```

示例：

| ID | 目录 |
|----|------|
| `anfeng` | `~/wb/wlgk/anfeng` |
| `auth` | `~/wb/wb-auth/web-ums` |

### `@`、`#`、`/` 的分工

- `@名字` —— 工作区 pack 或项目别名（两者都切换对话目录）；**任务**则是直接绑定该任务，本次运行会继承它引用的全部仓库（连同任务上下文与 worktree 规则）；笔记 / 会话则注入其内容。
- `#路径` —— 引用当前工作区里的某个文件或目录，但不切换目录。
- `/命令` —— 技能、MCP 工具，或悬浮助手的本地快查（`/git status`、`/git log`、`/find`）。

### 配置

1. 打开 **⚙ 设置 → Workbench**。
2. 在 **工作区提及（@）** 里点「新增工作区 pack」。
3. 填**提及 ID**（`anfeng`，允许字母、数字、`_`、`-`；存储时不带 `@`）。
4. 填**目录**（绝对路径或 `~/…`）。
5. 字段失焦即保存。

ID 大小写不敏感且唯一；ID 或目录为空的行在保存时丢弃，重复 ID 保留第一个。

### Finder 路径

一次性的目录不必配 pack：从 Finder 把文件夹拖到聊天输入框，对话就定位到那里。

若没有任何记住的工作区，新对话默认从用户主目录（`~`）开始。
