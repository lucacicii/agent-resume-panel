# Report

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### What it is

**Report** is the default home of Desktop: a **calendar-first** view of your agent work, with **daily / weekly / monthly** AI digests and a **GTD** strip. Digests are generated from local session history (and related context) using the LLM you configure.

### Layout

| Area | Role |
|------|------|
| **Calendar** | Month grid; dots show daily status (generated / stale / missing / no activity) and week/month markers |
| **Session list** | Sessions for the selected day / week / month |
| **Detail pane** | Digest content, generation progress, actions |

Navigation: previous/next month, year/month selectors, **Today**, **Refresh**.

### Generate digests

1. Select a day (daily), week column, or use the **Month** action for monthly.  
2. Run generate / refresh from the detail side when the entry is missing or marked **stale**.  
3. Parallel generation may show loading in the detail pane — wait for completion before judging empty content.  
4. Historical backfill options live under **Settings → General** (and related Report settings).

Digest generation **sends local work summaries / transcript excerpts** to your configured API. Only enable with a trusted endpoint.

### GTD from reports

1. After weekly/monthly reports exist, use **Analyze GTD + todolist from weekly/monthly reports**.  
2. Review the **editable preview** of proposed session GTD labels and project task list items.  
3. **Apply** selected items to update catalog GTD and project `todolist.md` where applicable.  
4. Changes show up in the VS Code extension GTD tree when sharing the same panel home.

Always review the preview — apply is a write to your local catalog / files.

### Tips

1. Click the calendar to keep the daily date in sync with the detail pane.  
2. Prefer weekly review for GTD triage; use daily digests for “what did I do that day?”.  
3. Configure models and schedules under [Settings & data](settings-and-data.md).  
4. Ask questions about reports in the [Agent](agent.md) tab.

### Related

- [Agent](agent.md) · [Sessions](sessions.md) · [Settings & data](settings-and-data.md)  
- Extension GTD: [Extension GTD](../panel/gtd.md)

---

## 简体中文

### 是什么

**Report** 是 Desktop 的默认首页：以 **日历** 为中心查看 Agent 工作，支持 **日 / 周 / 月** AI 回顾报告与 **GTD** 条。报告基于本机会话历史（及相关上下文），使用你配置的 LLM 生成。

### 布局

| 区域 | 作用 |
|------|------|
| **日历** | 月视图；圆点表示日报状态（已生成 / 待更新 / 未生成 / 无活动）及周 / 月标记 |
| **会话列表** | 所选日 / 周 / 月的会话 |
| **详情区** | 报告正文、生成进度与操作 |

导航：上/下月、年/月选择、**Today**、**Refresh**。

### 生成回顾

1. 选择某一天（日报）、周列，或使用 **Month** 生成月报。  
2. 在详情侧对缺失或 **过期（stale）** 条目执行生成 / 刷新。  
3. 并行生成时详情区可能显示 loading — 完成后再判断是否为空。  
4. 历史回填见 **Settings → 通用**（及相关 Report 设置）。

生成过程会把 **本机工作摘要 / 对话节选** 发往你配置的 API，请使用可信端点。

### 从报告做 GTD

1. 在已有周报/月报后，使用 **从周报/月报分析 GTD + todolist**。  
2. 在 **可编辑预览** 中检查拟写入的会话 GTD 与项目待办。  
3. **应用** 选中项，更新目录 GTD 与项目 `todolist.md`（如适用）。  
4. 与扩展共用 panel home 时，GTD 会反映在扩展侧边栏。

请务必审阅预览——应用会写入本机目录 / 文件。

### 提示

1. 点击日历可同步详情区的日报日期。  
2. 周回顾适合 GTD 分流；日报适合「那天我做了什么」。  
3. 模型与调度见 [设置与数据](settings-and-data.md)。  
4. 对报告提问请用 [Agent](agent.md) 页签。

### 相关文档

- [Agent](agent.md) · [Sessions](sessions.md) · [设置与数据](settings-and-data.md)  
- 扩展 GTD：[Extension GTD](../panel/gtd.md)
