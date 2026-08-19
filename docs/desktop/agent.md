# Agent

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### What it is

The **Agent** tab is Desktop’s **meta-agent**: natural-language Q&A over your **digests, notes, and CLI sessions** (semantic retrieval when embeddings are configured). It is for recalling and reasoning about past work — not a full IDE replacement for coding agents (use [Workbench](workbench.md) or the VS Code extension for resume / ACP).

### Main workflows

1. Open the **Agent** tab.  
2. Create or select a **thread** (rename / delete as needed).  
3. Ask questions such as “what did I work on last Tuesday?”, “find the codex session about auth”, or “summarize the auth refactor week”.  
4. Watch **streaming** replies; cancel an in-flight ask if needed.  
5. Use citations / linked context when shown to jump back into the underlying report, note, or session.
6. Open **Execution flow** below a reply to review the retrieval, model, and action steps behind it.  
7. Clear a thread’s chat history when you want a clean slate.

### Answers, citations, and navigation

Agent answers can cite the local material used as context: **reports**, **notes**, and **sessions**. Open the citation sheet to inspect its source, preview the matched content, and navigate straight to the relevant Desktop surface:

- **Reports** open in Report / Memory.
- **Notes** open in Notes.
- **Sessions** open in Sessions; use **Resume** when you want to continue that session in Workbench.

This makes an answer a starting point for review, rather than a detached summary.

### Session tools (when tools are enabled)

The Agent can call read-only tools against the local session catalog:

| Tool | Purpose |
| --- | --- |
| `session_search` | Keyword search on titles / paths / summaries; **plus** summary-vector search when embeddings are configured |
| `session_list` | Recent sessions with provider / project / GTD / time filters |
| `session_read` | Metadata + cached `session_summary` for one session |
| `session_read_transcript` | Short native transcript excerpt (capped; only when summary is not enough) |

- Without embeddings, search still works via **keywords**.  
- Semantic session search improves after sessions have **summaries** (Summarize / digest ensure-summaries) and embeddings are configured.  
- Digests answer “what did I do that week”; session tools answer “which single CLI session”.

### Tools, execution flow, and approvals

- Use the **Tools** switch in the thread header to allow or disable Agent tool calls for that conversation.
- The execution-flow summary separates **context retrieval**, **LLM requests**, and actual **tool actions**. A report, note, or session citation comes from retrieval; it is not itself a tool call.
- Open the right-side flow panel to inspect each step. Inputs and outputs are collapsed by default; MCP actions also show their source and risk level.
- Read-only actions proceed automatically. Write, launch, command, and network actions request approval by default. Delete and unknown-risk actions always request approval.
- A tool action that modifies local data, such as creating or changing a note, requires an explicit **Allow** or **Deny** decision. Denying it leaves local data unchanged.
- The **audit** view records note operations attempted through Agent, including their action, status, time, and any error.
- In **Settings → General → Agent actions**, **Always allow non-delete Agent actions** skips approval for classified non-delete actions. Use it only when you trust the configured model and tools.

### Semantic indexing

When embeddings are configured, Desktop can index notes for semantic retrieval. The Agent panel shows indexing progress while notes are scanned and embedded; keyword retrieval remains available without embeddings.

### Requirements

- LLM (and optionally **embeddings**) configured under **Settings → Models**.
- Useful digests in [Report](report.md) improve answer quality for calendar-style questions.
- Without embeddings, retrieval quality may be limited to keyword / digest-level context depending on configuration.

### Privacy

- Agent Q&A **sends retrieved local content and your prompts** to the third-party API you configure (including tool results such as summaries or short transcript excerpts).  
- Do not ask questions that force secrets into the prompt if the endpoint is untrusted.  
- Chat threads and execution-flow records are stored locally under panel home / desktop data. Recorded tool inputs and outputs are redacted for common secret fields and limited in length.
- Session summary vectors (when enabled) live in Desktop’s local `desktop.db`.

### Tips

1. Prefer concrete time ranges and project names in questions.  
2. Generate or refresh relevant digests first for better recall.  
3. Summarize important sessions so keyword and semantic session search work better.  
4. Keep separate threads per topic (weekly review vs. one project).  
5. Usage of LLM calls appears under **Settings → Usage**.

### Related

- [Report](report.md) · [Sessions](sessions.md) · [Settings & data](settings-and-data.md)  
- Extension-side assist (summarize / rename / handoff): [Extension LLM Assist](../panel/llm-assist.md)

---

## 简体中文

### 是什么

**Agent** 页签是 Desktop 的 **元 Agent**：用自然语言对 **回顾报告、笔记与 CLI 会话** 提问（配置 embeddings 时支持语义检索）。适合回忆与梳理过往工作，而不是完整替代写代码的 Agent（恢复会话请用 [Workbench](workbench.md) 或 VS Code 扩展 / ACP）。

### 主要流程

1. 打开 **Agent** 页签。  
2. 新建或选择 **线程**（可重命名 / 删除）。  
3. 提问，例如「上周二我在做什么」「找一下关于鉴权的 codex session」或「总结鉴权重构那一周」。  
4. 查看 **流式** 回答；需要时可取消进行中的提问。  
5. 有引用 / 关联上下文时，可跳回对应的报告、笔记或会话。
6. 点击回答下方的 **执行流程**，查看检索、模型与操作步骤。  
7. 需要干净上下文时可清空该线程聊天记录。

### 回答、引用与跳转

Agent 的回答可引用用于检索的本机内容：**报告**、**笔记** 与 **会话**。打开引用面板可查看来源、预览命中的内容，并直接跳到 Desktop 中相应的位置：

- **报告** 跳到 Report / Memory。
- **笔记** 跳到 Notes。
- **会话** 跳到 Sessions；需要在 Workbench 中继续时可使用 **Resume**。

因此回答不仅是独立摘要，也可以作为回查原始工作记录的入口。

### Session 工具（开启 tools 时）

Agent 可对本地会话 catalog 调用只读工具：

| 工具 | 作用 |
| --- | --- |
| `session_search` | 按标题 / 路径 / 摘要关键词搜索；配置 embeddings 时叠加 **摘要向量** 语义搜索 |
| `session_list` | 按 provider / 项目 / GTD / 时间列出最近 session |
| `session_read` | 读单条元数据与 `session_summary` |
| `session_read_transcript` | 读取原生对话片段（有长度上限；仅在摘要不够时使用） |

- 未配置 embeddings 时仍可用 **关键词** 搜索。  
- 有 **会话摘要** 且配置了 embeddings 后，语义找 session 更准。  
- 报告适合回答「那一周整体在忙什么」；session 工具适合回答「是哪一次 CLI 会话」。

### 工具、执行流程与授权

- 使用线程标题栏的 **Tools** 开关，决定该对话是否允许 Agent 调用工具。
- 执行流程会分别统计 **上下文检索**、**LLM 请求** 与实际的 **工具操作**。报告、笔记、会话引用来自检索，本身不算工具调用。
- 打开右侧执行流程面板可查看每个步骤；输入和输出默认折叠，MCP 操作还会显示来源和风险级别。
- 只读操作自动执行。写入、启动、命令和网络操作默认请求授权；删除和未知风险操作始终请求授权。
- 会修改本机数据的工具操作，例如新建或修改笔记，必须明确选择 **Allow** 或 **Deny**。拒绝后不会修改本机数据。
- **审计** 视图会记录 Agent 发起的笔记操作，包括动作、状态、时间和错误信息。
- 在 **设置 → 通用 → Agent 操作** 中开启 **始终允许非删除 Agent 操作** 后，已分类的非删除操作会跳过授权。仅在信任当前模型与工具时开启。

### 语义索引

配置 embeddings 后，Desktop 可为笔记建立语义检索索引。Agent 面板会在扫描和生成向量时显示索引进度；未配置 embeddings 时，关键词检索仍可使用。

### 前提

- 在 **Settings → 模型** 配置 LLM（可选 **embeddings**）。
- [Report](report.md) 中有相关回顾时，日历类问题效果更好。
- 未配置 embeddings 时，检索可能偏关键词 / 报告级上下文（视配置而定）。

### 隐私

- Agent 问答会把 **检索到的本机内容与你的提示** 发往配置的第三方 API（含工具返回的摘要或短 transcript 片段）。  
- 端点不可信时，避免在问题中带入密钥等敏感信息。  
- 线程与执行流程记录保存在本机面板 / Desktop 数据目录。记录的工具输入与输出会对常见密钥字段脱敏，并限制长度。
- Session 摘要向量（若启用）保存在本机 `desktop.db`。

### 提示

1. 问题尽量带上时间范围与项目名。  
2. 先生成或刷新相关回顾，回忆更准。  
3. 重要 session 先生成摘要，关键词与语义搜索都更准。  
4. 按主题分线程（周回顾 vs 单项目）。  
5. LLM 用量见 **Settings → 用量**。

### 相关文档

- [Report](report.md) · [Sessions](sessions.md) · [设置与数据](settings-and-data.md)  
- 扩展侧辅助（摘要 / 重命名 / Handoff）：[扩展 LLM 辅助](../panel/llm-assist.md)
