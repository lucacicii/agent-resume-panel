# ACP Chat

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### What it is

**ACP Chat** lets you chat with agents in the editor via the [Agent Client Protocol (ACP)](https://agentclientprotocol.com). It is separate from CLI session history in **Sessions**.

### Supported agents (ACP)

Typical launch configurations include:

- Codex  
- Claude  
- Antigravity  
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

#### Antigravity ACP policy & compliance

Google's Antigravity Terms of Service prohibit extracting/proxying consumer OAuth (`oauth-personal`) credentials or wrapping `agy acp` inside an outer third-party agent harness (injecting external system prompts, external tool definitions, cross-model context replay, or unattended automated loops). Outer harnesses should use `GEMINI_API_KEY` or Google Cloud / Gemini Enterprise Agent Platform auth instead.

**Agent Resume Panel** stays within the compliant thin-client boundary by:
1. Launching the unmodified local `agy acp` binary directly via standard ACP stdio.
2. Never reading, extracting, or proxying OAuth credentials or exposing an API relay.
3. Acting strictly as a human-driven chat UI (no injected outer system prompts, no tool hijacking, no automated loops).
4. Excluding `agy` from ACP Handoff (`supportsAcp: false`) so cross-model context is not automatically injected into `agy acp` sessions.

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

**ACP Chat** 通过 [Agent Client Protocol (ACP)](https://agentclientprotocol.com) 在编辑器旁与 Agent 对话。它与 **Sessions** 里的 CLI 历史会话是两套数据。

### 支持的 ACP Agent

常见可配置启动项包括：

- Codex  
- Claude  
- Antigravity  
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

#### Antigravity ACP 政策与合规说明

Google 的 Antigravity 服务条款禁止在使用个人消费级 OAuth（`oauth-personal`）时提取/反代凭证，或将 `agy acp` 包装到外层第三方 Agent 框架中（注入外部 system prompt、外部工具定义、跨模型上下文重放或无人值守自动循环）。如需接入外层框架或自动化流水线，请改用 `GEMINI_API_KEY` 或 Google Cloud / Gemini Enterprise Agent Platform 认证。

**Agent Resume Panel** 通过以下约束保持在官方允许的薄客户端合规范围内：
1. 仅通过标准 ACP stdio 直接启动本机未修改的官方 `agy acp`。
2. 不读取、不提取、不代理任何 OAuth 凭证，也不提供 API 中转服务。
3. 仅作为人类用户直接交互的聊天 UI（不注入外层系统提示词、不劫持原生工具、不跑自动化循环）。
4. 刻意禁用向 `agy` 的 ACP Handoff（`supportsAcp: false`），避免把其他模型的对话上下文自动注入 `agy acp` 会话。

### 相关设置

- 各 Agent 的 command / args  
- 自动批准权限  
- 从视图或命令面板打开 **ACP 设置**  

详见 [设置与数据](settings-and-data.md) 与 [LLM 辅助 / Handoff](llm-assist.md)。

### 相关文档

- [会话 Sessions](sessions.md) · [恢复与目标](resume-and-targets.md) · [Notes](notes.md)
