# LLM Assist

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### What it is

Optional **LLM Assist** uses an **OpenAI-compatible** API you configure to help with session hygiene and handoffs. Nothing is sent until you run an assist action and have configured an endpoint.

### Features

| Feature | Purpose |
|---------|---------|
| **Summarize** | Short summary of a session transcript for scanning |
| **Auto Rename** | Suggest / apply a clearer session title |
| **Handoff Brief** | Build a brief and deliver it to another agent target (CLI or ACP path) |

Handoff targets commonly include Codex, Claude, Antigravity, Grok, OpenCode, and Pi (menu items may vary by version).

### Setup (overview)

1. Open **Agent Resume: Open Settings** (or the Sessions gear).  
2. Configure LLM **base URL**, **model**, and API key (key is kept in secure storage when possible — not in source control).  
3. Optionally set **output language** and **max context characters**.  
4. Run Summarize / Rename / Handoff from preview or session menus.

### Privacy

- Assist **sends local transcript (or excerpts) and prompts** to the third-party endpoint you set.  
- Do not use a key or endpoint you do not trust with that content.  
- Prefer lowering max context size when sessions contain secrets.  
- Panel remains local-first; Assist is opt-in.

### Handoff tips

1. Use Handoff when switching tools (e.g. research in one agent, implementation in another).  
2. Review the brief before delivery when the UI offers a preview.  
3. Handoff attach / token limits are configurable under handoff-related settings.  
4. ACP and CLI delivery paths differ — pick the target that matches how you work.

### Related

- [Sessions](sessions.md) · [ACP Chat](acp-chat.md) · [Resume & targets](resume-and-targets.md)  
- [Settings & data](settings-and-data.md)  
- Desktop has separate **Report digests** and **Agent Q&A** (same shared LLM settings possible): [Desktop docs](../desktop/README.md)

---

## 简体中文

### 是什么

可选的 **LLM 辅助** 使用你配置的 **OpenAI 兼容** API，帮助整理会话与交接。只有在配置好接口并主动执行辅助操作时，才会向外发送内容。

### 功能

| 功能 | 作用 |
|------|------|
| **Summarize** | 为会话生成便于扫读的短摘要 |
| **Auto Rename** | 建议 / 应用更清晰的会话标题 |
| **Handoff Brief** | 生成交接简报并投递到其他 Agent 目标（CLI 或 ACP） |

常见 Handoff 目标包括 Codex、Claude、Antigravity、Grok、OpenCode、Pi（菜单以实际版本为准）。

### 配置概要

1. 打开 **Agent Resume: Open Settings**（或 Sessions 齿轮）。  
2. 配置 LLM **base URL**、**model** 与 API Key（Key 尽量放在安全存储，不要进仓库）。  
3. 可按需设置 **输出语言** 与 **最大上下文长度**。  
4. 从预览或会话菜单执行摘要 / 重命名 / Handoff。

### 隐私

- 辅助功能会把 **本机会话（或节选）与提示** 发往你配置的第三方接口。  
- 请仅使用你信任、且允许承载该内容的密钥与端点。  
- 会话含敏感信息时，建议减小最大上下文。  
- 面板仍以本机为先；LLM 辅助是可选能力。

### Handoff 提示

1. 适合跨工具交接（例如一个 Agent 调研、另一个实现）。  
2. UI 提供预览时，投递前请先过目。  
3. 附件与 token 上限可在 Handoff 相关设置中调整。  
4. ACP 与 CLI 投递路径不同，按工作方式选择目标。

### 相关文档

- [会话 Sessions](sessions.md) · [ACP Chat](acp-chat.md) · [恢复与目标](resume-and-targets.md)  
- [设置与数据](settings-and-data.md)  
- Desktop 另有 **Report 回顾** 与 **Agent 问答**（可共用 LLM 设置）：[Desktop 文档](../desktop/README.md)
