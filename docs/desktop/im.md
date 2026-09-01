# IM

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

**IM** is a Desktop-only room for a project you create. It is not a projection of the Workbench/catalog project list.

- Create a project, then optionally associate a local folder.
- Configure roles in **Settings → IM** (agent, prompt, read/write/execute tools). Builtin templates cannot be deleted.
- Select text in a message and right-click for Quote / Translate / Explain. Quote goes into the composer; Translate and Explain run on the chat model and open a result popover. Custom actions are added in Settings → IM.
- New rooms enable the five builtin roles. The room sidebar only turns templates on or off.
- Each room can keep **background knowledge**: text, http(s) links, and images. Links are stored as URLs only — IM does not fetch pages; the dispatched agent decides whether to open them.
- Every role’s ACP session uses the room folder as `cwd` and may list/read the entire tree. Write and command tools still follow the template.
- `@` several roles on one message to fan out the same instruction. Read-only roles can run together; write/command roles queue one at a time in the room.
- Mentioning a role without an associated folder is blocked. Messages without `@` stay in the room and do not dispatch.
- Jobs reuse Desktop’s ACP host. Permission prompts appear in the room. Finished ACP sessions still show up in Workbench.

Notes reuse is deferred: IM does not write project notes yet.

---

## 简体中文

**IM** 是 Desktop 独占的项目房间，由用户自己创建，不会从 catalog / Workbench 项目列表自动长出。

- 先新建项目，再按需关联本地目录。
- 在 **设置 → IM** 配置角色（Agent、提示词、读/写/执行工具）。内置模板不可删除。
- 在消息里选中文字后右键：引用 / 翻译 / 解释。引用进入输入框；翻译和解释走对话模型，结果显示在弹出层。自定义操作在 设置 → IM 里添加。
- 新房间默认启用五个内置角色。房间侧栏只负责勾选或取消模板。
- 每个房间可添加 **背景知识**：文本、http(s) 链接、图片。链接只存 URL，IM 不抓网页；要不要打开由被派发的 agent 自己决定。
- 每个角色的 ACP 会话都以房间目录为 `cwd`，可以列出并阅读整个项目树。写文件和执行命令仍由模板控制。
- 一条消息可以 `@` 多个角色，同一指令扇出。只读角色可并行；写文件/执行命令的角色在房间里排队、同时只跑一个。
- 未关联目录时不能派工；不 @ 只落房间消息。
- 派工走现有 ACP host，权限在房间内确认。完成后的 ACP session 仍会出现在 Workbench。

笔记复用放到后续：当前不会自动写项目笔记。
