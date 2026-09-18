# Reports (MCP)

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### What it is

Daily / weekly / monthly AI **digests** are generated in the background from local session history. There is **no in-app Archive / Report tab**. Read and search reports through the built-in **MCP** tools.

> Desktop still opens on **Workbench**.

### How reports are generated

The desktop scheduler always runs in the background with fixed defaults: daily at 22:00 local time, weekly and monthly at 09:00, 100 LLM-call budget. Assign a digest model under **Settings → Providers** (Scheduled Digests).

Generation **sends local work summaries / transcript excerpts** to your configured API. Configure a trusted endpoint before expecting reports.

### How to read reports

Register an MCP client (see [External Agent MCP](mcp.md)) and use:

| Tool | Purpose |
| --- | --- |
| `memory_retrieve` | One-shot retrieval across digests, notes, and sessions |
| `report_search` | Semantic search over memory digests |
| `report_read` | Read one full digest by `reportId` |
| `report_list` | List digests by level and period |

### Related

- [Agent memory](agent.md) · [MCP](mcp.md) · [Workbench](workbench.md) · [Settings & data](settings-and-data.md)

---

## 简体中文

### 是什么

**日 / 周 / 月 AI 回顾报告** 由后台根据本机会话历史生成。应用内 **没有归档 / Report 页签**。阅读与搜索报告请走内置 **MCP** 工具。

> Desktop 冷启动仍进入 **工作台**。

### 如何生成

桌面调度器始终在后台按固定默认值运行：日报本地 22:00，周报 / 月报 09:00，LLM 调用预算 100。在 **设置 → 提供商** 为「定时工作报告」指定模型。

生成过程会把 **本机工作摘要 / 对话节选** 发往你配置的 API，请先配置可信端点。

### 如何阅读

注册 MCP 客户端（见 [External Agent MCP](mcp.md)），然后使用：

| 工具 | 用途 |
| --- | --- |
| `memory_retrieve` | 一次检索报告、笔记与会话 |
| `report_search` | 对回顾报告做语义搜索 |
| `report_read` | 按 `reportId` 读取整篇报告 |
| `report_list` | 按层级与周期列出报告 |

### 相关文档

- [Agent memory](agent.md) · [MCP](mcp.md) · [Workbench](workbench.md) · [设置与数据](settings-and-data.md)
