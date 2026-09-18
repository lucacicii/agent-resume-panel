# 归档契约（PM 决策记录）

状态：**决策冻结，未开工** · 角色：Product Manager
配套：[`desktop-archive-by-work-item.md`](desktop-archive-by-work-item.md)（UI Designer 提案，部分结论已被本文件决策取代，见 §7）
覆盖：归档单元定义、GTD 权威规则、删除范围、任务拆分与验收标准。

> 变更：R1-R4 已定案并并入 §1/§4；新增阶段 D（功能删除）与 R1 的实现风险 §5。

---

## 1. 冻结决策

| # | 决策 | 含义 |
|---|---|---|
| **D1** | 归档 = **历史工作项的合集**，时间轴降级为工作项详情内的子视图 | 归档是**单一轴**（工作项），日历不再是归档的主结构 |
| **D2** | **工作项 GTD 唯一权威** | 会话 GTD 降级为"这个会话谁还要跟进"的会话级标注，**不参与归档的筛选、分组与计数** |
| **D3** | 归档是**视图**，不是状态 | **不新增归档标记字段**；没有"已归档"分区；完成与否只看工作项 GTD（`done`） |
| **D4** | IM 只给**入口** | 归档里不聚合 IM 消息，不读消息摘要；点击进入现有讨论房间 |
| **D5** | 未归属会话 = 归档左列一个**虚拟条目**（R1 = i） | 它**不是工作项**，豁免 GTD 筛选与计数；全局跨目录会话搜索保留 |
| **D6** | **删除 GtdSheet 整个功能**（R2） | 日报/周报/月报不再产出 GTD 提案；`session_gtd` 与 `todolist.md` 的自动写入路径一并消失 |
| **D7** | **砍掉 PeriodInsightsDashboard**（R3） | "本期画像与统计"整块移除 |
| **D8** | **停掉自动建档**（R4 = a） | `promoteBlockedTransition` / `promoteAwaitingSessionsToInbox` 不再把会话状态写成笔记 |

**由 D3 推出的必然结果**：归档列表展示**全部工作项**（含 `done` / `someday`），用现有 GTD 状态筛选来收窄。因此"归档"一词**只作为页面名**出现，界面上不得再出现"归档/取消归档"动词或"已归档"分区。

**由 D2 推出的必然结果**：工作项 GTD 与下属会话 GTD 不一致时（工作项=完成，会话=等待），**界面以工作项 GTD 为准**；会话 GTD 仅作该会话行的标注。

**D2 + D6 + D8 合起来的净效果**：会话 GTD 从"被 AI 批量生成的状态"退化为"人工标注"，写入者只剩手动入口（工作台会话右键菜单 / MCP `session_set_gtd` / VS Code 扩展命令）。这是自洽的——**一套 GTD（工作项）驱动注意力，另一套（会话）只描述单个会话的跟进需要**。

---

## 2. 归档单元的定义（契约）

一个归档条目 = 一个工作项，其完整构成为 **5 个部分**。实现时按此定义对齐，不得只渲染前两项。

| 组成 | 载体 | 基数 |
|---|---|---|
| ① 笔记 + 知识区 | `notes/library/*.md`（frontmatter `work: true`） | 1 |
| ② Session | `work_item_sessions` 索引（源：frontmatter `sessions:`） | N |
| ③ IM 房间 | `im_projects.work_item_note_id` | **恰好 1**（`openWorkItemRoom` 按 noteId 幂等） |
| ④ 中立工区 + 地址表 | `panelHome/.desktop/workspaces/<noteId>` 的 `AGENTS.md` / `CLAUDE.md` | 1 |
| ⑤ 仓库引用 | frontmatter `projects[]` | N |

**归属边界已由现有代码保证，不需要新规则**：一个 session 至多属于一个工作项——`work_item_sessions` 认领时会先删掉其他工作项对该 session 的认领（last-writer-wins，`packages/core/src/notes/work.ts:112-120`）。

**权威数据源**：`notesListWorkItems()`（含 GTD 状态、projects 并集、sessions）。**不得为归档新建并行数据源。**

---

## 3. 时间轴子视图的可行边界

| 层 | 内容 | 数据来源 | 可行性 |
|---|---|---|---|
| **T1 会话时间线** | 该工作项在哪几天有会话、provider / 项目 / 时间 / 实时状态 | `work_item_sessions` + `sessions` | ✅ 立即可做 |
| **T2 报告指针** | "这个工作项在 2026-W37 周报里被提到" | `report_links`（`reportId → provider/agentSessionId/projectPath`，`packages/core/src/report/schema.ts:42-47`）反查 | ✅ 可做，输出是**指针列表** |
| **T3 报告摘录** | 从周报正文里**摘出**属于该工作项的那一段 | `report_entries.content` 是整篇自由文本，**没有工作项维度字段** | ❌ **做不到精确摘录** |

**契约**：T1 必做，T2 做（指针，点击进整篇），**T3 明确不做**。不要用整篇报告冒充摘录——一条 period 报告覆盖多个工作项，冒充会让用户以为报告是工作项级的。要做 T3 必须另开一单。

---

## 4. 删除范围（D6 / D7）

### 4.1 D6 · 删除 GtdSheet

**要删的**（已验证的完整闭环，无旁路消费者）：

| 层 | 文件 / 符号 |
|---|---|
| UI | `features/report/GtdSheet.tsx` + `GtdSheet.test.tsx`；`main.tsx:17,173` 的挂载 |
| 入口 | `ReportPanel.tsx:523` 的 `onGtd` → `agent-resume:gtd-open` 事件 |
| IPC | `workflow:previewReportGtdSync` / `workflow:applyReportGtdSync`（`main.ts:2651-2680`、`preload.ts:1111-1153, 1943-1944`） |
| Core | `packages/core/src/workflow/runReportGtdSync.ts`、`workflow/analyzeGtd.ts`（`filterReportGtdProposals` 等）及其 `index.ts:708-719` 导出 |
| 文案 | `desktop.report.gtd*` **35 个 key** |

**必须知道的连带后果**（不是反对，是要写进验收）：

1. **`todolist.md` 失去唯一生成者。** `writeSessionTodolistMd` 的唯一调用点是 `runReportGtdSync.ts:212`。已存在的 `todolist.md`（会话级路径 `notes/<provider>/<sessionId>/todolist.md`）**仍被索引**（`notes/indexStore.ts:27`）、仍在笔记面板可见、仍受"不可移动"保护（`notes/store.ts:657`）。→ 删除后它是**只读遗留物**，契约按此处理，不要顺手删文件。
2. **`gtd_ai_audit` 少一个写入方。** 该表的另一个来源是笔记写入审计（Ask 的"笔记追踪"），不受影响。
3. **跨产品安全**：`runReportGtdSync` 系列**只有桌面消费**，扩展未使用（已验证）。删除属桌面独立决策，不违反 product independence；但 core 的公共导出要同步移除，避免留下无消费者的 API。

### 4.2 D7 · 砍掉 PeriodInsightsDashboard

**要删的**：`PeriodInsightsDashboard.tsx` + `PeriodInsightsDashboard.test.tsx`、`report:getPeriodInsights` IPC（`main.ts:2421-2466`、`preload.ts:1085, 1905`）、`PeriodInsights` 类型、core `report/insights.ts` 的 `getPeriodInsights`（`index.ts:457` 导出）、`desktop.report.insights*` + `desktop.report.composer*` **42 个 key**。

**连带后果**：insights 柱状条 → 日报的联动（`insightsTrendHint`："点击柱状条可直接跳转至该日报"）一并消失。与 D1（时间轴降级）方向一致。已验证**无其它消费者**。

---

## 5. R1(i) 的实现风险（必须先解决，否则「未归属会话」做不出来）

`SessionQueryRequest`（`packages/core/src/catalog/query.ts:175-186`）**没有任何"排除已关联工作项"的字段**，而 `querySessionsPage` 的既定原则是**所有过滤在 SQL**（同文件 `:194-198` 注释原话：*"Keep all filtering in SQL so a search or scope change covers the entire catalog, rather than only the pages already rendered by the client."*）。

**所以「未归属会话」不能靠客户端拉全量再过滤。** 必须给 core 加一个过滤位，建议：

```ts
// SessionQueryRequest
unassignedOnly?: boolean;
// SQL
NOT EXISTS (SELECT 1 FROM work_item_sessions w
            WHERE w.provider = s.provider AND w.agent_session_id = s.agent_session_id)
```

`work_item_sessions` 与 `sessions` 同在 `catalog.db`，该子查询可用现有索引。

**验收**：5000+ 会话的目录下，「未归属会话」条目数与分页游标正确，不被 `limit` 静默截断。

---

## 6. 任务拆分

阶段 P（今日替代）/ A（归档）/ C（自动建档）/ D（删除）。**D 是 A1 的前置**（先删掉 insights 与 GtdSheet，归档布局才不用为它们留位）。**P 与 A 无依赖，可并行。**

### 阶段 D · 功能删除（D6 / D7）

| ID | 任务 | 依赖 | 验收 |
|---|---|---|---|
| D1 | 删除 GtdSheet：UI + `agent-resume:gtd-open` 入口 + 两个 IPC + core workflow 与导出 | — | 全仓库无 `GtdSheet` / `runReportGtdSync` / `gtd-open` 引用；已存在的 `todolist.md` 仍被索引且可见 |
| D2 | 删除 PeriodInsightsDashboard：UI + `report:getPeriodInsights` IPC + core `getPeriodInsights` + `PeriodInsights` 类型 | — | 无引用残留；`ReportPanel` 仍正常渲染日报/周报/月报 |
| D3 | 清理 35 个 `desktop.report.gtd*` + 42 个 `insights*`/`composer*` 文案 | D1,D2 | **直接改 `apps/desktop/locales/{en,zh-cn,ja}.json`，禁止跑 `merge:desktop-i18n`**；`i18n:check` 绿 |

### 阶段 P · 实时状态替代落点（删今日的前置）

| ID | 任务 | 依赖 | 验收 |
|---|---|---|---|
| P1 | 把 `rollupDot()` 与 `LIVE_RANK` 从 `TodayPanel.tsx:16-43` 提取到共享模块（建议 `features/workbench/sessionStatus/workItemRollup.ts`） | — | 今日删除后工作台仍能拿到工作项级实时等级；无重复实现 |
| P2 | 工作台工作项列表**排序**：实时等级 desc → `updatedAtMs` desc（现只过滤不排序，继承 SQL 的 `updated_at_ms DESC`） | P1 | 有 `awaiting_user` 会话的工作项浮到最上；无实时会话的工作项相对顺序不变 |
| P3 | 工作项行加**实时点**（`awaiting_user`→accent / `error`→warn / `running`·`connecting`→muted；无活动时**不渲染**） | P1 | 三种状态各一条测试；无活动行不出现第二个点 |
| P4 | 工作项视图加「需要我 {n}」条件筛选片，**n=0 时整个控件不渲染** | P1 | n=0 时 DOM 中不存在该控件 |
| P5 | 工作项**创建入口**从今日迁到工作台「工作项」视图工具栏（`notesCreateWorkItem` 现仅 TodayPanel 一个调用者，`TodayPanel.tsx:172`） | — | 今日删除后仍可新建工作项 |
| P6 | 默认落地页 `today` → `workbench`（`AppChrome.tsx:27` + `main.tsx:166`） | P5 | 冷启动直接进工作台 |
| P7 | 删除今日面板 + `desktop.today.*`（14 键）+ 残留 `desktop.tabs.kanban` | P1-P6 | 全量测试绿；无引用残留 |
| P8 | 清死代码/死样式：91 行 `.kanban-*`（其中 56 行是已退役的 board/column 死样式）、`KanbanCardModal` 改名 | P7 | 无残留引用 |

### 阶段 A · 归档 = 历史工作项合集

| ID | 任务 | 依赖 | 验收 |
|---|---|---|---|
| A0 | core：`SessionQueryRequest` 增加 `unassignedOnly`（见 §5） | — | 5000+ 会话下未归属计数与游标正确，非静默截断 |
| A1 | 归档改为工作项优先布局：左列工作项列表 + 右侧详情；沿用现有三列外壳，不新造布局原语 | D1,D2 | 进入归档不再默认看到日历 |
| A2 | 左列列表：全部工作项（含 `done`/`someday`），按 P2 排序；项目 / GTD 状态筛选沿用现有 `select`；计数与筛选**豁免会话 GTD**（D2） | A1 | 同名工作项不合并（按 `noteId`） |
| A3 | 修正现存缺陷：会话→工作项索引的 key 必须用 `noteId`，**不得沿用 `link.title`**（`ReportPanel.tsx:489,507` 现按标题分组，同名会合并） | — | 两个同名工作项渲染为两个条目 |
| A4 | **未归属会话虚拟条目**（D5）：非工作项，豁免 GTD 筛选与计数；点击展示该会话列表；**全局跨目录搜索保留** | A0,A1 | 归档左列存在该条目；搜索仍覆盖全部会话（含已关联与未归属） |
| A5 | 工作项详情概要头：标题 / **可点击 GTD 状态胶囊（六态）** / 项目 chips（含缺失态）/ 下一步 / 决策 / 打开笔记 / **IM 入口** | A1 | 六态可切换并落库；IM 入口进入现有房间，不聚合消息（D4） |
| A6 | 时间轴子视图 **T1 会话时间线**（按天聚合，含 provider / 项目 / 时间 / 实时状态） | A1 | 无会话时显示空态，不是白页 |
| A7 | 时间轴子视图 **T2 报告指针**（`report_links` 反查，"在 2026-W37 周报中被提到"，点击进整篇） | A6 | 不渲染整篇报告冒充摘录；无报告时不渲染该分组标题 |
| A8 | 分页：默认 200 条 + 显式「加载更早」，**不得静默截断** | A6 | 单工作项 500 会话下可用，能看到还有更多 |
| A9 | 文案与文档：`desktop.archive.*` 新增键（直接改 3 个 locale）、`docs/desktop/report.md` 改写（现仍写 "Report is the default home of Desktop"，已是漂移）、`.agents/menus/desktop.md` 补齐 | A1-A5 | 3 语言齐全；`i18n:check` 绿 |

### 阶段 C · 停掉自动建档（D8）

| ID | 任务 | 依赖 | 验收 |
|---|---|---|---|
| C1 | 会话上留**持久标记**（"上次退出时在等待你"），供 tooltip 显示 | — | 实时点只覆盖打开的会话；关闭期间卡住的会话仍有信号（这是 D8 的前置，否则直接丢信息） |
| C2 | 停掉 `promoteBlockedTransition`（`main.ts:391`）与 `promoteAwaitingSessionsToInbox`（`main.ts:3405`） | C1 | 不再有机器文案写入 `decision`；**已存在的工作项不受影响、不被删除** |
| C3 | 删除 `promoteBlockedTransition` 里的硬编码英文文案与 `blockedDecisionText` | C2 | 无硬编码英文残留（该文案此前完全不经 i18n） |

---

## 7. 与 UI Designer 提案的差异（避免实现者照两份文档干活）

以下提案结论**已被 D1/D3/D6/D7 取代，不再执行**：

| 提案内容 | 现状 |
|---|---|
| 「外壳 + 三片（C→B→A）」分片推进 | **作废**。改为阶段 D/P/A/C |
| 归档 tab 内做 `时间轴 ｜ 工作项` **模式切换**（双轴） | **作废**（D1：单一轴） |
| 第 2 片「工作项生命周期归档」+ `已归档` 分区 + 独立归档标记字段 | **作废**（D3） |
| tab 改名 `归档` → `历史` | **待定**。D3 让"归档里没有归档动作"，词套词问题自然消失，改名收益下降。**PM 倾向不改**，仅修 `docs/desktop/report.md` |
| 归档动作的 3 个落点 + 二次确认 + toast 撤销 | **作废**（没有归档动作） |
| §3 第 3 片 A 里"报告摘录"作为主详情内容之一 | **收窄为 T2 指针**（D7 后 `report_entries` 仍在，但摘录不做） |
| §8 验收标准里的"工作项模式"相关条目 | **作废**（无模式切换） |
| §6 今日删除后的替代落点（排序 / 实时点 / 需要我芯片 / 提取 rollup） | **保留，采纳为阶段 P** |
| §7 自动建档推荐 (a) + 两个前提 | **保留，采纳为阶段 C** |
| §5「归档/已完成/隐藏/删除」四词契约 | **保留**，其中"归档"按 D3 收窄为页面名 |

---

## 8. 跨产品与数据影响

1. **工作项笔记 frontmatter 不改字段**（D3 不新增归档标记）→ VS Code 扩展读同一 panel home **零影响**。别在实现中偷偷加字段。
2. **`session_gtd` 表不动**。扩展的 GTD 树建在 `SessionGtdStore` 上（`apps/extension/src/extension.ts:139-141, 190`），桌面会话右键菜单也依赖它。D2 只是**在桌面归档视图里不采信它**，D6 只是**移除 AI 批量写入路径**——都不是删表/删能力。
3. **`todolist.md` 文件类型保留**（§4.1 后果 1），只是不再有生成者。
4. **报告生成链路（`report_*`）不改 schema**。T2 用现有 `report_links` 反查。
5. `docs/desktop/` 与 `.agents/menus/desktop.md` 目前**完全没有"今日""归档按工作项"的描述**，A9 需补齐（`.agents/menus/desktop.md` 的 renderer 行还写着 "Memory, Ask, Workbench, Notes, Sessions, and Settings"，已是四处漂移）。
6. **不要跑 `merge:desktop-i18n`**，桌面文案直接改 `apps/desktop/locales/{en,zh-cn,ja}.json`。

---

## 9. 变更记录

| 时点 | 变更 |
|---|---|
| 初版 | D1-D4 冻结，提出 R1-R5 |
| R1-R4 定案 | D5（未归属会话虚拟条目）、D6（删 GtdSheet）、D7（砍 insights）、D8（停自动建档）；新增阶段 D 与 §5 R1 实现风险；§7 增补被取代的提案条目 |
