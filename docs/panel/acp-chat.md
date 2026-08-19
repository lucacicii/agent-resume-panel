# ACP Chat

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### What it is

**ACP Chat** is an **extension-only** surface for chatting with agents in the editor via the [Agent Client Protocol (ACP)](https://agentclientprotocol.com). It is separate from CLI session history in **Sessions**.

Desktop does **not** include ACP Chat.

### Supported agents (ACP)

Typical launch configurations include:

- Codex  
- Claude  
- Grok  
- OpenCode  
- Pi  

Commands and args for each agent are configurable under ACP settings.

### Main workflows

1. Open the **ACP Chats** sidebar view.  
2. **New chat** / open an existing entry to open an editor-side chat panel.  
3. Chat with streaming replies; approve or manage agent **permissions** when prompted.  
4. Attach images when the agent supports them (size limits apply).  
5. Rename chats from the tree; refresh the list when needed.

### How it differs from Sessions

| | **ACP Chat** | **Sessions (CLI history)** |
|---|---|---|
| Source | Live ACP process + local ACP records | Provider CLI transcript homes |
| GTD | Not GTD-tagged | GTD on CLI sessions |
| Resume | Reopen ACP panel / connection | Terminal / panel / app targets |
| Handoff | Can hand off into CLI/ACP targets | Handoff from preview / menus |

### Permissions & safety

- Agents may request filesystem or terminal access; prefer least privilege.  
- Optional **auto-approve permissions** exists for convenience — only enable if you trust the agent and workspace.  
- ACP chats and attachments are stored locally under panel home; they are not uploaded unless *you* configure an agent that talks to a remote service.

### Related settings

- Per-agent command / args  
- Auto-approve permissions  
- Open **ACP settings** from the view or command palette  

See also [Settings & data](settings-and-data.md) and [LLM Assist / Handoff](llm-assist.md).

### Related

- [Sessions](sessions.md) · [Resume & targets](resume-and-targets.md) · [Notes](notes.md)

---

## 简体中文

### 是什么

**ACP Chat** 是 **仅扩展提供** 的能力：通过 [Agent Client Protocol (ACP)](https://agentclientprotocol.com) 在编辑器旁与 Agent 对话。它与 **Sessions** 里的 CLI 历史会话是两套数据。

Desktop **没有** ACP Chat。

### 支持的 ACP Agent

常见可配置启动项包括：

- Codex  
- Claude  
- Grok  
- OpenCode  
- Pi  

各 Agent 的 command / args 可在 ACP 设置中修改。

### 主要流程

1. 打开 **ACP Chats** 侧边栏。  
2. **新建聊天** 或打开已有条目，弹出编辑器旁聊天面板。  
3. 流式对话；按提示处理 Agent 的 **权限** 请求。  
4. 在支持时附加图片（有大小限制）。  
5. 可在树中重命名；列表过期时刷新。

### 与 Sessions 的区别

| | **ACP Chat** | **Sessions（CLI 历史）** |
|---|---|---|
| 来源 | 实时 ACP 进程 + 本机 ACP 记录 | 各 Provider CLI 对话目录 |
| GTD | 不打 GTD 标签 | 可对 CLI 会话打 GTD |
| 恢复 | 重新打开 ACP 面板 / 连接 | 终端 / 面板 / App 等目标 |
| Handoff | 可交接给 CLI/ACP 目标 | 从预览 / 菜单交接 |

### 权限与安全

- Agent 可能请求文件或终端权限，请按最小权限处理。  
- 可选的 **自动批准权限** 仅建议在信任 Agent 与工作区时开启。  
- ACP 聊天与附件保存在本机面板目录；除非你配置的 Agent 本身会访问远端服务，否则不会上传。

### 相关设置

- 各 Agent 的 command / args  
- 自动批准权限  
- 从视图或命令面板打开 **ACP 设置**  

详见 [设置与数据](settings-and-data.md) 与 [LLM 辅助 / Handoff](llm-assist.md)。

### 相关文档

- [会话 Sessions](sessions.md) · [恢复与目标](resume-and-targets.md) · [Notes](notes.md)
