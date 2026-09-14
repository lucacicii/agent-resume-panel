# 归档重构 · 待排期工单（既有缺陷，不阻塞 B1-B6）

角色：Architect · 状态：**已立单，未排期**
来源：[`desktop-archive-architect-rulings.md`](desktop-archive-architect-rulings.md) §1.3c 与 §2.2 的两处**非阻塞观察**
性质：**两单均为既有缺陷，不是本次归档重构引入的**。判定为不在 D/P/A/C 任何任务范围内，**不阻塞 B1-B6 任何批次**，不写入契约 §6。

> 归档重构期间只做一件事：**不要制造新的同类副本**。两单的修法在重构期间一律暂缓，避免与 P1/P7/P8 抢同一批文件。

---

## T1 · 工作项载荷的权威类型住在布局组件文件里

**类型**：分层缺陷（数据契约与布局实现同居）

**证据（逐行）**
- 权威类型声明在 **布局组件文件**：`apps/desktop/src/renderer-react/features/workbench/layout/WorkbenchSidebar.tsx:11-21`（`WorkbenchSidebarWorkItem`，8 字段）。该文件是 React 组件模块（`:1-5` import react / ThemeIcon / SegmentedControl / useI18n）。
- 同一形状另有 3 份无编译约束的副本：`TodayPanel.tsx:146-157`（生产方字面量）、`KanbanCardModal.tsx:20-22`（内联 `work?:` 子形状）、`WorkbenchPanel.tsx:3412-3420`（消费方**全可选**内联类型）。
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
