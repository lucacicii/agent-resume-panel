# 归档重构 · 待排期工单（既有缺陷，不阻塞 B1-B6）

角色：Architect · 状态：**T1 / T2 / T4 已关闭；T3、T5、T6 已立单未排期**
来源：[`desktop-archive-architect-rulings.md`](desktop-archive-architect-rulings.md) §1.3c 与 §2.2 的两处**非阻塞观察**，以及 A9 收尾时发现的文档漂移（T3）。
性质：**均为既有缺陷，不是本次归档重构引入的**。判定为不在 D/P/A/C 任何任务范围内，**不阻塞 B1-B6 任何批次**，不写入契约 §6。

> 归档重构期间只做一件事：**不要制造新的同类副本**。重构期间各单的修法一律暂缓，避免与 P1/P7/P8 抢同一批文件。T1 / T2 / T4 已在 B6 之后按 Owner 判定关闭。

---

## T1 · 工作项载荷的权威类型住在布局组件文件里 —— **已关闭**

**类型**：分层缺陷（数据契约与布局实现同居）

**原证据**：权威类型声明在布局组件文件 `layout/WorkbenchSidebar.tsx`，另有 3 份无编译约束的副本（`TodayPanel.tsx` 生产方、`KanbanCardModal.tsx` 内联子形状、`WorkbenchPanel.tsx` 消费方全可选内联类型）；消费方用 `detail.title || ""`、`Array.isArray(detail.sessions)` 兜底，漂移被静默吸收。

**处置（已执行）**
- 新增中立模型模块 `apps/desktop/src/renderer-react/features/workbench/workItem.ts`：
  - `WorkbenchWorkItem` 为**唯一**权威形状（含 `noteId/title/status/next/decision/sessions/projects/primaryProject/updatedAtMs`）。
  - `WorkItemSource` 为 `workItemFromRecord()` 的输入形状（结构化声明，因为 preload 返回的是自己手写的结构副本，不是 core 的 `WorkItemRecord`）。
  - `workItemFromRecord()` 收敛此前**四处各自手写**的映射（`WorkbenchPanel.loadWorkItems`、`WorkbenchPanel.addWorkItem`、`ReportPanel` IM 入口生产方、消费方兜底），并顺带删掉 `ReportPanel` 里 `(item.work as any)?.nextAction` 这个已失效的兜底。
- `WorkbenchSidebar.tsx` 不再声明该类型，props 改用中立类型；`WorkbenchSidebar.test.tsx` 同步改 import。
- `WorkbenchPanel` 的 `workItemScope` state 与事件消费者改为直接用 `WorkbenchWorkItem`，删掉字段级重建与运行时兜底。
- 新增 `workItem.test.ts` 覆盖标题兜底链、状态默认值、work 字段映射与 `noteId`/`updatedAtMs` 透传。

**关闭验收（已实测）**
- `grep -rn "primaryProject" apps/desktop/src/renderer-react` → 除 `workItem.ts`（声明）与 `WorkbenchSidebar.tsx`（无）外，其余全是**读取**，无第二处形状声明。
- 人为把 `workItem.ts` 的字段改名 → `typecheck:renderer` 立即在 `WorkbenchPanel.tsx`（消费方 ×2）与 `workItem.ts`（生产方）报错，**漂移已在编译期可捕获**。
- `typecheck:desktop` / `compile` / `i18n:check` 绿；`test:renderer` 新增 4 个用例通过。

---

## T2 · 会话状态词汇有两份独立声明，彼此无编译期约束 —— **已关闭**

**类型**：静默失效风险（跨进程词汇漂移）

**原证据**：`sessionStatus/types.ts` 与 `shared/workbenchSelection.ts` 各声明一份完全相同的五值词汇表；点载荷同样两份（`ActiveSessionDot` vs `WorkbenchActiveSessionDot`）。单项校验且方向是渲染层 → 主进程，而 `parseWorkbenchActiveSessionDots` 对未知状态**静默回退为 `"open"`**，于是渲染层新增状态会让主进程的颜色表与等待通知判定静默失效。

**处置（已执行，取裁定给出的方案 (a)：单一来源）**
- `shared/workbenchSelection.ts` 成为**唯一**声明点（该文件是无 import 的叶子模块，且 `SelectionSendMenu.tsx` 早已在渲染层 value-import 它，不引入新的打包面）。
- `sessionStatus/types.ts` 的 `SESSION_DOT_STATUSES` / `SessionDotStatus` 改为从共享模块**派生**，删除重复元组。
- `activeSessionDots.ts` 的 `ActiveSessionDot` 改为共享 `WorkbenchActiveSessionDot` 的别名，删除重复载荷形状。
- `workItemRollup.test.ts` 追加守卫：断言 `WORKBENCH_SESSION_DOT_STATUSES` 只在 `shared/workbenchSelection.ts` 出现一次，且 `SESSION_DOT_STATUSES` 与它**同引用**（`toBe`，不是值相等）——「渲染层私自新增状态」从此不可能。

**关闭验收（已实测）**
- 往共享元组插入一个 `probe_status` → **两侧都编译失败**：
  - 渲染层 `workItemRollup.ts:20`（`LIVE_RANK` 的 `Record<SessionDotStatus, number>` 缺失该键）
  - 主进程 `sessionDotsTray.ts:11` 与 `:19`（两张颜色表缺失该键）
- `typecheck:desktop` / `compile` / `i18n:check` / `test:renderer` / `test:core` / `test:desktop` 全绿。

---

## T3 · 用户文档与菜单地图仍有本次重构留下的漂移

**类型**：文档漂移（重命名 / 删除功能后未同步）

**证据**
- `docs/desktop/agent.md` 通篇以 “**Agent** tab” 为入口，但 `AppChrome.tsx` 的 rail 只有 `report` / `workbench` / `notes` 三个 tab，仓库内也**没有** `features/agent/`；`desktop.agent.*` 现在只服务于待办/报告/IM/工具设置等通用文案。
- `docs/desktop/im.md` 与 `docs/desktop/README.md` 把 IM 描述为独立入口；实际 `ImPanel` 已内嵌在 Workbench 面板中（`WorkbenchPanel.tsx:5862`），通过 `agent-resume:im-open-room` 打开房间。
- `.agents/menus/report-gtd.md` 仍按 `packages/core/src/memory/*` 与 `agent/*` 描述能力，但 `packages/core/src/memory/` 已不存在（digest 代码在 `packages/core/src/report/`），且 “Memory and Ask UI” 一行指向已删除的日历 / GtdSheet。
- `.agents/menus-index.md` 与 `report-gtd.md` 仍写载 desktop renderer 为 `apps/desktop/src/renderer/{index.html,app.js,styles.css}` 的 “plain JavaScript” 应用；实际为 `renderer-react/` 下的 React 运行时（`.agents/menus/desktop.md` 已在本轮修正）。

**目标**
1. 每个桌面模块文档只描述**当前存在**的入口与路径。
2. 菜单地图指向的代码路径全部可解析（无 `app.js`、无 `memory/`）。
3. 删除的功能（Agent tab、日历视图、GtdSheet、Kanban board）不再有“现有功能”叙述；如仍要保留历史说明，必须显式标注为已移除。

**非目标**
- 不改代码。
- 不改 `docs/desktop/report.md`（已在 A9 重写）。

**前置 / 触发**：无。建议紧随 B6 之后单开一单，避免与 P8 抢文件（P8 已把 `features/kanban/` 改名为 `features/noteDetail/`，若 `agent.md`/`im.md` 提到旧名会再次漂移）。

**验收**
- `grep -rn "Agent tab\|app\.js\|core/src/memory" docs/desktop .agents/menus .agents/menus-index.md` 无残留（或有显式“已移除”标注）。
- 文档中每个 rail / tab 名都能在 `AppChrome.tsx` 的 `tabs` 数组里找到对应项。

**Owner**：Developer · **阻塞性**：无

---

## T4 · `NoteDetailSheet`（原 `KanbanCardModal`）已无任何引用者 —— **已关闭（判定：删除）**

**类型**：既有缺陷／契约前提与代码事实不符（P8 期间发现）

**证据**
- P8 按契约把 `features/kanban/KanbanCardModal.tsx` 改名为 `features/noteDetail/NoteDetailSheet.tsx`，但**改名前后全仓库均无 importer**；`KanbanCardModal` 只出现在已 gitignore 的**旧构建产物**里，而那些产物同时含已删除的 `features/today/TodayPanel.tsx`，可证为陈旧构建。
- 契约与排期认为它是“工作项详情弹层”“删了会丢详情交互”；实测不成立：工作项详情由 `WorkbenchPanel` 的 `wb-work-item-*` 作用域头部提供，笔记编辑在 `NotesPanel`，会话预览在 `ReportPanel`。

**处置（已执行，Owner 判定「没有引用就删掉」）**
- 删除 `apps/desktop/src/renderer-react/features/noteDetail/`（`NoteDetailSheet.tsx` + `noteSessionResume.ts`；后者的唯一消费者是该模块，随之一并删除）。
- 删除随之成为死代码的 `.note-detail-*` 样式（含 `.sheet-body.note-detail-body` 三条子选择器与三处选择器列表中的成员）。
- 删除 10 个 `desktop.noteDetail.*` 键；唯一仍有引用的 `openRoom` 归位为 `desktop.archive.openRoom`（归档详情面的 IM 入口），三语同值。
- 顺带删除 T4 备注中指出的 Agent tab 退役残留：`.agent-sidebar-list`、`.sidebar-folders-pane.is-collapsed .agent-sidebar-list`、`.agent-sidebar-pane.is-collapsed #btnAgentNewChat`。

**关闭验收**：`grep -rn "noteDetail\|NoteDetailSheet\|agent-sidebar" apps/desktop/src` → 0 命中；`i18n:check` 绿且三语键集一致；`compile` / `typecheck:renderer` / `test:renderer` 全绿。

---

## T5 · 渲染层 CSS 存在约 322 个无引用选择器（含 D1/D2/P7 删除后的遗留）

**类型**：死样式（跨多个已退役功能）

**证据（脚本统计：抽取 `styles.css` 全部类名，与 `apps/desktop/src/**/*.{ts,tsx,html}` 全文比对）**
| 家族 | 数量 | 来源 |
|---|---|---|
| `insights-*` | 61 | 已退役的 Period Insights（D2） |
| `wb-*` | 51 | 工作台历史样式（需逐个确认是否经模板字符串拼接） |
| `gtd-*` | 19 | 已退役的 GtdSheet（D1） |
| `cal-*` | 18 | 已退役的归档日历视图（A1） |
| `ask-*` / `agent-*` / `chat-*` | 40 | 已退役的 Ask/Agent tab |
| 其余（`friction-*`/`tool-*`/`intent-*`/`hourly-*`/…） | ~133 | 混合 |

**⚠ 关键陷阱（不要在没做这一步之前批量删）**
- `is-*` / `has-*` 一类状态类名常由模板字符串拼接（`className={\`x is-${status}\`}`），**静态 grep 会误报为无引用**。统计里有 32 个 `is-*` 属此类风险。
- 因此删除必须**按选择器逐个确认**（至少对 `is-*`/`has-*` 全量人工核对），不能按家族批量删。

**目标**：把 `styles.css` 中真正无引用的规则清零；对动态拼接的类名，改为在源码里显式列出或在样式旁注明来源。

**非目标**
- 不改任何仍在使用的规则的视觉结果。
- 不与 T4 的删除混提（T4 已单独完成）。

**前置 / 触发**：无。建议单开一单，按家族分批提交，每批附上该批前后 `styles.css` 行数与本判据脚本输出。

**验收**
- 每批提交后 `compile` + `typecheck:renderer` + `test:renderer` 绿。
- 全程不得出现“样式还在用但被删掉”的情况：对 `is-*`/`has-*` 批次需附人工核对清单。

**Owner**：Developer · **阻塞性**：无

---

## T6 · renderer 测试套件存在间歇性失败（重负载 jsdom 用例）

**类型**：测试基础设施（既有的不稳定，非本次重构引入）

**证据（本机实测，同一工作树重复跑 `pnpm --filter @agent-resume/desktop run test:renderer`）**
- **未改动的基线**（`git stash` 后）：3 次中 1 次失败，失败用例为 `WorkbenchPanel > disables Replace All when results were truncated`。
- 带 T1 改动：6 次中 3 次失败，且**每次失败的用例都不同** —— `FloatingSessionNote > opens find with Cmd+F and Escape closes find…`、`WorkbenchPanel > searches inside an Explorer folder via Find in Folder`、`WorkbenchPanel > dismisses the branch popover on outside click and Escape`。
- 单独跑这些文件时全部通过（如 `FloatingSessionNote.test.tsx` 单独跑 17/17 通过）。
→ 结论：**与改动无关**，属于并行执行下的计时 / `act()` 抖动，集中在最重的几个 jsdom 套件。

**影响**：验收命令「`test:renderer` 绿」不是可重复的判据；一次绿不能证明没有回归，一次红也不能证明有回归。

**目标**：让全量 renderer 测试可重复，至少到「连续 5 次同一结果」。

**建议方向（择一或组合）**
1. 对失败用例做 fake timers 收敛，去掉对真实 `setTimeout`/`requestAnimationFrame` 的依赖。
2. 复查未包 `act()` 的状态更新（跑测时控制台已有大量 `not wrapped in act(...)` 警告，集中在 `WorkbenchPanel`）。
3. 若仍抖动，考虑对这些重套件降低并行度（单独 project / `--poolOptions` 限制），而不是继续放松断言。

**非目标**
- 不改产品代码来迁就测试。
- 不用重试（retry）掩盖抖动。

**前置 / 触发**：无。

**验收**
- 连续 5 次 `pnpm --filter @agent-resume/desktop run test:renderer` 结果一致且全绿，附 5 次输出摘要。
- 控制台 `act(...)` 警告数量显著下降或清零（附前后对比）。

**Owner**：Developer · **阻塞性**：无（但影响所有后续验收的可信度）
