# 归档重构 · 待排期工单（既有缺陷，不阻塞 B1-B6）

角色：Architect · 状态：**已立单，未排期**
来源：[`desktop-archive-architect-rulings.md`](desktop-archive-architect-rulings.md) §1.3c 与 §2.2 的两处**非阻塞观察**，以及 A9 收尾时发现的文档漂移（T3）。
性质：**均为既有缺陷，不是本次归档重构引入的**。判定为不在 D/P/A/C 任何任务范围内，**不阻塞 B1-B6 任何批次**，不写入契约 §6。

> 归档重构期间只做一件事：**不要制造新的同类副本**。两单的修法在重构期间一律暂缓，避免与 P1/P7/P8 抢同一批文件。

---

## T1 · 工作项载荷的权威类型住在布局组件文件里

**类型**：分层缺陷（数据契约与布局实现同居）

**证据（逐行）**
- 权威类型声明在 **布局组件文件**：`apps/desktop/src/renderer-react/features/workbench/layout/WorkbenchSidebar.tsx:11-21`（`WorkbenchSidebarWorkItem`，8 字段）。该文件是 React 组件模块（`:1-5` import react / ThemeIcon / SegmentedControl / useI18n）。
- 同一形状另有 3 份无编译约束的副本：`TodayPanel.tsx:146-157`（生产方字面量，**已随 P7 一同删除**）、`KanbanCardModal.tsx:20-22`（内联 `work?:` 子形状）、`WorkbenchPanel.tsx:3412-3420`（消费方**全可选**内联类型）。
- 漂移是**静默**的：消费方用 `detail.title || ""`、`detail.status || "inbox"`、`Array.isArray(detail.sessions)`（`WorkbenchPanel.tsx:3422-3431`）兜底，生产方改字段名 → 消费方 `undefined` → 概要头内容整块消失，tsc 全绿、无测试变红。

**目标**
1. 权威类型移入中立模型模块（与 `features/workbench/activeSessionDots.ts` 同级是自然候选），消除「从 layout 组件文件取数据契约」。
2. 事件载荷形状与侧栏列表项形状的关系被**显式声明**（同一类型，或一层明确的映射），不再靠字面量对齐。
3. 所有生产方 / 消费方改为 import 该类型。

**非目标**
- 不改载荷字段名与语义（8 字段与 `WorkbenchPanel.tsx:3422-3431` 的既有期望保持一致）。
- 不为 `agent-resume:*` 事件建立登记表（超出本单）。
- 不引入运行时校验——那属于 `apps/desktop/src/shared/workbenchSelection.ts` 的职责范围（跨进程校验），渲染层内部事件不需要。

**前置 / 触发**
- 与 **P8** 同批或之后。归 P8 的理由：P7 之后 `KanbanCardModal` 才是唯一生产方，P8 本来就要改它的归属与命名（排期 §2.1 P7 已定「P7 只切 import、P8 才改名归位」）。
- 若 P8 已按裁定 §1.3b 把形状收敛到单一权威类型，**本单可并入 P8 关闭**；此时剩余工作量仅为「把类型从 layout 文件移到模型模块」。

**验收**
- `grep -rn "primaryProject" apps/desktop/src/renderer-react` → 载荷形状只剩**一处**声明。
- `WorkbenchSidebar.tsx` 不再声明该类型；无其它文件从 `layout/WorkbenchSidebar` 取该类型。
- `tsc` 全绿 + `pnpm --filter @agent-resume/desktop run test:renderer` 绿。

**Owner**：Developer · **阻塞性**：无

---

## T2 · 会话状态词汇有两份独立声明，彼此无编译期约束

**类型**：静默失效风险（跨进程词汇漂移）

**证据（逐行）**
- 两份结构完全相同的词汇表，各自独立声明：
  | 位置 | 内容 |
  |---|---|
  | `features/workbench/sessionStatus/types.ts:10-15` | `SESSION_DOT_STATUSES` / `SessionDotStatus`（渲染层） |
  | `apps/desktop/src/shared/workbenchSelection.ts:3-9` | `WORKBENCH_SESSION_DOT_STATUSES` / `WorkbenchSessionDotStatus`（主进程 / preload） |
- 点载荷同样是两份：`features/workbench/activeSessionDots.ts:11-17` `ActiveSessionDot` vs `shared/workbenchSelection.ts:13-19` `WorkbenchActiveSessionDot`。
- **单项校验，方向是渲染层 → 主进程**：`WorkbenchPanel.tsx:1019` 派发 `agent-resume:active-sessions`（渲染层词汇）→ `main.ts:1553` 用 `parseWorkbenchActiveSessionDots` 解析（共享词汇）。
- **漂移后的静默路径已实测**：`shared/workbenchSelection.ts:100-102` 对不在共享元组里的状态**强制回退为 `"open"`**，不抛错、不告警。于是渲染层若新增一个状态（例如更细的等待层级），主进程侧：
  - `sessionDotsTray.ts:12-27` 的两张 `Record<WorkbenchSessionDotStatus, ...>` 颜色表拿不到该状态 → 托盘点静默显示为 idle 色；
  - `sessionWaitingNotifications.ts:1` 与 `main.ts:3400` 依赖解析后的点做判定 → 判定静默失效。
- 反向不成立：往共享元组加状态会让主进程侧的 `Record` 编译报错（守卫存在），但**往渲染层元组加状态不会**——`LIVE_RANK: Record<SessionDotStatus, number>` 只守住渲染层这一侧。

**目标**
建立**双向**编译期约束，二选一（实现者取改动面更小者，并在提交信息里说明选择）：
- (a) 单一来源：渲染层 `SessionDotStatus` 从 `shared/workbenchSelection.ts` 派生（或将共享元组移至渲染层可 import 的中立位置），删除重复声明。
- (b) 显式穷尽映射：保留两份声明，但增加 `Record<rendererStatus, sharedStatus>` 的穷尽性映射 + 一条测试，任一方向新增状态即编译或测试失败。

**非目标**
- 不改任何状态的语义、不新增状态、不改托盘点颜色与直径。
- 不动 `LIVE_RANK` 的数值（见裁定 §2.4）。
- 不碰 `features/im/` 的 `job.status`（`imTypes.ts:16`、`callChainModel.ts`、`imUtils.tsx:209` 是**另一套** job 状态词汇，同名不同义，不在本单范围）。

**前置 / 触发**
- 无前置。建议排在归档重构全部落地之后（B6 之后），因为本单跨渲染层 / preload / 主进程三处，与 D/P/A/C 无耦合，但会与任何同时改这几处的任务抢文件。

**验收**
- 两份声明之间的漂移在**编译期或测试**可捕获：新增一个状态到任一侧，`pnpm run compile` 或 renderer 测试必须变红（提交里附上一次人为制造的失败证据）。
- `pnpm run compile` + `pnpm --filter @agent-resume/desktop run test:renderer` + `pnpm run test:desktop` 全绿。
- 注意：根 `test:desktop` **不含** renderer 测试（排期 §0），验收命令必须显式带上 `test:renderer`。

**Owner**：Developer · **阻塞性**：无

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

## T4 · `NoteDetailSheet`（原 `KanbanCardModal`）已无任何引用者

**类型**：既有缺陷／契约前提与代码事实不符（P8 期间发现，本单不改变 P8 的处置）

**证据**
- P8 已按契约把 `features/kanban/KanbanCardModal.tsx` 改名为 `features/noteDetail/NoteDetailSheet.tsx`（目录与组件同步改名，`desktop.kanban.*` → `desktop.noteDetail.*`），并清除全部 `.kanban-*` 死样式。
- **改名前后全仓库均无 importer**：`grep -rn "KanbanCardModal\|NoteDetailSheet\|noteSessionResume" apps/desktop/src --include=*.ts --include=*.tsx` 仅命中模块自身；`KanbanCardModal` 只出现在 `dist/`、`.pack-staging/` 等已 gitignore 的**旧构建产物**里，而那些产物同时含已删除的 `features/today/TodayPanel.tsx`，可证为陈旧构建。
- 契约与排期认为它是“工作项详情弹层”“删了会丢详情交互”。实测已不成立：工作项详情现由 `WorkbenchPanel` 的 `wb-work-item-*` 作用域头部提供，笔记编辑在 `NotesPanel`，会话预览在 `ReportPanel`。
- 排期 §2.1 P7 的「`kanban/` 整个目录没有任何消费者」是准确的；其后半句“它是工作项详情弹层”已失效。

**目标**（二选一，需产品拍板）
1. **删除** `features/noteDetail/`（组件 + `noteSessionResume.ts`）与 `desktop.noteDetail.*` 三语 11 个键。
2. **接线**：从工作台工作项列表或归档详情调用它，此时必须同时补测试与载荷类型收敛（见 T1）。

**非目标**
- 本单不改 P8 已完成的改名结果。

**前置 / 触发**：无。若拍板为 (1)，应顺便处理 `agent-sidebar-pane` / `.agent-sidebar-*` / `#btnAgentNewChat` 这类 Agent tab 退役后的残留（同属无引用样式）。

**验收**
- 若 (1)：`grep -rn "noteDetail\|NoteDetailSheet" apps/desktop/src` 无残留；`i18n:check` 绿且三语键集一致。
- 若 (2)：组件有可复现入口，且新增测试覆盖“入口 → 打开”路径。

**Owner**：Developer（需先拍板）· **阻塞性**：无
