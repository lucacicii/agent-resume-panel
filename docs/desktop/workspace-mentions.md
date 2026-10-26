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

- `@name` — a workspace pack (relocates the conversation); a **task** binds the task instead, so the run inherits every repository the task references (plus its context and worktree rule); a note or session injects its content.
- `#path` — references one file or directory inside the current workspace, without moving it.
- `/command` — a skill, an MCP tool, or one of the Quick Agent's local lookups (`/git status`, `/git log`, `/find`).

The menu lists exactly four kinds — **workspace packs, tasks, notes, conversations** — in that order. Catalog projects are not a mention: a directory you never named does not belong in `@`.

### Configure

1. Open **⚙ Settings → Workbench**.
2. **Mention sources (@)** — four switches decide which kinds the menu may list. A kind switched off is never queried, so it costs nothing. Switching one off only hides it from `@`; the catalog keeps indexing sessions either way.
3. **Workspace mentions** — click **Add workspace pack**, then set **Mention id** (`anfeng` — letters, digits, `_`, `-`; no `@` in the stored id) and the **Directory** (absolute or `~/…`). Fields save when they lose focus.

Ids are unique case-insensitively. Rows with an empty id or directory are dropped on save, and duplicate ids keep the first.

### Auto-collecting project directories

History knows every folder an agent ever ran in, and most of them are noise: `~`, `/tmp`, the app's own scratch workspaces. So auto-collection is a **suggestion list**, not an import:

1. Turn on **Project directories (auto-collected)** in **Mention sources (@)**.
2. Under **Auto-collect project directories**, click **Scan candidates**. The scan only reads the catalog — nothing is written.
3. Each row shows the id it would get, the path and its session count. Excluded rows stay visible and greyed with a reason: home directory, temporary folder, app's own workspace, folder is gone, already a pack.
4. Tick what you want, then **Apply to @ mentions**. Ticked rows are *appended* to the packs you already have, so an existing `@anfeng` is never rewritten.

A candidate id is the directory's last segment, lowercased and reduced to `[A-Za-z0-9_-]`, with `-2`-style suffixes on collision.

Switching the source off afterwards hides the collected packs from `@` without deleting them.

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

- `@名字` —— 工作区 pack（切换对话目录）；**任务**则是直接绑定该任务，本次运行会继承它引用的全部仓库（连同任务上下文与 worktree 规则）；笔记 / 会话则注入其内容。
- `#路径` —— 引用当前工作区里的某个文件或目录，但不切换目录。
- `/命令` —— 技能、MCP 工具，或悬浮助手的本地快查（`/git status`、`/git log`、`/find`）。

菜单只列四类：**工作区 pack、任务、笔记、会话**，顺序如上。项目目录不算提及——你没命名过的目录不该出现在 `@` 里。

### 配置

1. 打开 **⚙ 设置 → Workbench**。
2. **提及来源（@）** —— 四个开关决定菜单能列出哪几类。关掉的类别根本不会被查询，所以不产生开销；关掉只是让它从 `@` 里消失，项目目录照常索引会话。
3. **工作区提及（@）** —— 点「新增工作区 pack」，填**提及 ID**（`anfeng`，允许字母、数字、`_`、`-`；存储时不带 `@`）和**目录**（绝对路径或 `~/…`）。字段失焦即保存。

ID 大小写不敏感且唯一；ID 或目录为空的行在保存时丢弃，重复 ID 保留第一个。

### 自动收集项目目录

历史里记着 agent 跑过的每个目录，其中大部分是噪音：`~`、`/tmp`、应用自己的草稿目录。所以自动收集是**候选清单**，不是导入：

1. 在 **提及来源（@）** 里打开 **项目目录（自动收集）**。
2. 在 **自动收集项目目录** 里点「扫描候选」。扫描只读项目目录，不写任何东西。
3. 每行显示它将会得到的 id、路径与会话数。被排除的行仍然列出（灰色）并给出原因：主目录、临时目录、应用内部工作区、目录不存在、已在 pack 中。
4. 勾选需要的行，点「应用到 @ 提及」。勾选的行会**追加**到已有的 pack 之后，已有的 `@anfeng` 不会被覆盖。

候选 id 取目录最后一段，转小写并只保留 `[A-Za-z0-9_-]`，冲突时加 `-2` 之类后缀。

之后关掉该来源开关，只会把这些 pack 从 `@` 里隐藏，不会删除。

### Finder 路径

一次性的目录不必配 pack：从 Finder 把文件夹拖到聊天输入框，对话就定位到那里。

若没有任何记住的工作区，新对话默认从用户主目录（`~`）开始。
