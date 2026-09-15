# Report / Archive

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### What it is

**Report** (the **Archive** tab) is a **work-item-first** view of your agent history: the left column lists **work items**, the middle column lists their **sessions**, and the detail pane shows the work item's scope, live status, and **session timeline**.

Daily / weekly / monthly AI **digests** still exist and are generated from local session history and related context using the LLM you configure — they are reached from the **timeline** (report pointers) and from **Agent** citations, not from a calendar.

> Report is **not** the default landing tab. Desktop opens on **Workbench**.

### Layout

| Area | Role |
|------|------|
| **Work items** (left) | Every work item, including `done` / `someday`, sorted by live urgency and recency. Project and GTD filters. A **No work item** entry at the bottom holds sessions with no linked work item. |
| **Sessions** (middle) | Sessions for the selected work item (or the unassigned set). Search here covers the **whole catalog**, both linked and unlinked sessions. |
| **Detail** (right) | Work item summary (GTD capsule, projects, next action, decision, open note, IM room) plus the session timeline and report pointers. Selecting a session or a report switches this pane to its full view with a **Back** button. |

### Reading a work item

1. Pick a work item on the left. Its **six-state GTD capsule** is clickable — changing it writes to the catalog immediately.
2. The **timeline** aggregates sessions by day, newest first, with provider, project, time, and live status. A closed session that was still waiting on you when the app last quit is marked as such.
3. **Reports** that mention this work item are listed as pointers (for example *Mentioned in 2026-W37 Weekly report*). Click a pointer to open the full digest; click **Back** to return. Pointers never paraphrase the report — open it to read it.
4. When a work item has more than 200 sessions, an explicit **Load earlier** button appears at the bottom of the timeline and session list. Nothing is truncated silently.

### Generate digests

1. Focus a period (day / week / month) from a report pointer, an **Agent** citation, or the native **Sessions** menu.
2. Run generate / refresh from the detail pane when the entry is missing or marked **stale**.
3. Parallel generation may show progress in the detail pane — wait for completion before judging empty content.
4. Historical backfill options live under **Settings → General** (and related Report settings).

Digest generation **sends local work summaries / transcript excerpts** to your configured API. Only enable with a trusted endpoint.

### Tips

1. Use the middle-column search to jump across every project — it is not limited to the selected work item.
2. Prefer weekly review for triage; use daily digests for "what did I do that day?".
3. Configure models and schedules under [Settings & data](settings-and-data.md).
4. Ask questions about reports in the [Agent](agent.md) tab.

### Related

- [Agent](agent.md) · [Sessions](sessions.md) · [Workbench](workbench.md) · [Settings & data](settings-and-data.md)
- Extension GTD: [Extension GTD](../panel/gtd.md)

---

## 简体中文

### 是什么

**Report**（即 **归档** 页签）是一个 **工作项优先** 的历史视图：左列列出 **工作项**，中列列出它们的 **会话**，详情区展示该工作项的范围、实时状态与 **会话时间线**。

**日 / 周 / 月 AI 回顾报告** 仍然存在，基于本机会话历史及相关上下文、使用你配置的 LLM 生成——入口在**时间线**（报告指针）与 **Agent** 引用中，不再通过日历进入。

> Report **不是** 默认落地页。Desktop 冷启动直接进入 **工作台**。

### 布局

| 区域 | 作用 |
|------|------|
| **工作项**（左） | 全部工作项（含 `done` / `someday`），按实时紧急度与更新时间排序；支持项目与 GTD 筛选。底部固定一个 **未归属** 条目，收纳没有关联工作项的会话。 |
| **会话**（中） | 所选工作项（或未归属集合）的会话。此处搜索覆盖 **整个目录**，含已关联与未关联会话。 |
| **详情**（右） | 工作项概要（GTD 胶囊、项目、下一步、决策、打开笔记、IM 房间）以及会话时间线与报告指针。选中某个会话或报告后，此区切换为其完整视图，并显示 **返回** 按钮。 |

### 阅读一个工作项

1. 在左侧选中工作项。**六态 GTD 胶囊** 可点击，切换后立即写入目录。
2. **时间线** 按天聚合会话，最新的在前，含 provider、项目、时间与实时状态。应用上次退出时仍在等待你的已关闭会话会被标注出来。
3. 提到该工作项的 **报告** 会以指针形式列出（例如 *在 2026-W37 周报中被提到*）。点击指针打开整篇回顾；点 **返回** 回到工作项。指针不会改写报告内容——要看正文请打开它。
4. 单个工作项会话超过 200 条时，时间线与会话列表底部会出现显式的 **加载更早** 按钮。不会有静默截断。

### 生成回顾

1. 通过报告指针、**Agent** 引用或原生 **Sessions** 菜单聚焦某个周期（日 / 周 / 月）。
2. 条目缺失或标记为 **过期（stale）** 时，在详情区执行生成 / 刷新。
3. 并行生成时详情区可能显示进度 —— 完成后再判断是否为空。
4. 历史回填见 **Settings → 通用**（及相关 Report 设置）。

生成过程会把 **本机工作摘要 / 对话节选** 发往你配置的 API，请使用可信端点。

### 提示

1. 用中列搜索跨项目跳转 —— 它不限于当前工作项。
2. 周回顾适合分流；日报适合「那天我做了什么」。
3. 模型与调度见 [设置与数据](settings-and-data.md)。
4. 对报告提问请用 [Agent](agent.md) 页签。

### 相关文档

- [Agent](agent.md) · [Sessions](sessions.md) · [Workbench](workbench.md) · [设置与数据](settings-and-data.md)
- 扩展 GTD：[Extension GTD](../panel/gtd.md)
