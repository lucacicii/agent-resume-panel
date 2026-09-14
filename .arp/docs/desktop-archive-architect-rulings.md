# 归档重构 · Architect 裁定记录

角色：Architect · 状态：**已裁定，供实现者遵循**
请求来源：排期单 §2.1「旁支风险 · `agent-resume:workbench-work-item` 事件契约的双份定义」末句（「请在 A5 开工前由 Architect 裁定」）
依据：[`desktop-archive-contract.md`](desktop-archive-contract.md)（**本文件不修改契约、不修改需求口径**）、[`desktop-archive-schedule.md`](desktop-archive-schedule.md)

本文件只做一件事：给出**实现约束**。凡涉及需求范围的判断一律不作；凡与契约冲突之处以契约为准。
待排期的既有缺陷另见 [`desktop-archive-followups.md`](desktop-archive-followups.md)（**不阻塞 B1-B6 任何批次**）。

> **时序修正（重要）**：判据二的约束窗口是 **B1 的 P1**，不是 B2 的 P2。共享模块的**导出面在 P1 就定死了**，P2/P3/P4 只是消费者。若 P1 按 B1 开工而未拿到本文件，会漏掉必须导出的 `needs_you` 判据，P4 只能重写一份，直接踩 P1 的「无重复实现」验收。

---

## 1. 判据一 · `agent-resume:workbench-work-item` 事件契约是否复用（A5 开工前必须遵循）

### 1.1 结论：复用，不另立

A5 的工作项详情概要头若要打开工作项 / 会话，**必须复用既有的 `agent-resume:workbench-work-item` 事件**。

理由：

1. **语义完全同一。** 该事件的唯一消费语义是「把某个工作项设为工作台当前作用域」——`WorkbenchPanel.tsx:3412-3431` 的 `onWorkItem` 执行 `setWorkItemScope` + `selectProject(target)` + `sidebarView = "workitems"`。A5 的「IM 入口 / 打开工作项」要的正是这一个动作，不存在第二种语义。
2. **处境相同的先例已存在。** `KanbanCardModal` 本身就是「非工作台 tab 的浮层驱动工作台」（`KanbanCardModal.tsx:191`），与 A5 的「归档 tab 驱动工作台」是同一种跨 tab 导航。另立事件会让两条并行契约写同一份工作台状态，漂移面翻倍。
3. **反向无需求。** 工作台不需要把工作项回推给归档。

### 1.2 硬约束：A5 只能复用这四条既有事件，不得新增导航类事件

| 目的 | 复用事件 | 载荷 | 参照 |
|---|---|---|---|
| 切 tab | `agent-resume:tab-request` | `"workbench"` / `"notes"` | `KanbanCardModal.tsx:203,213` |
| 设工作项作用域 | `agent-resume:workbench-work-item` | 见 §1.3 | `KanbanCardModal.tsx:191,430` |
| 进 IM 房间 | `agent-resume:workbench-open-room` | `{ projectId }` | `KanbanCardModal.tsx:204` |
| 打开笔记 | `agent-resume:open-note` | `noteId` | `KanbanCardModal.tsx:214` |

实测 `apps/desktop/src/renderer-react` 下已有 **23 条** `agent-resume:*` 自定义事件，且**没有任何集中登记处**（`docs/desktop/*.md`、`.agents/menus/desktop.md` 均无事件清单）。因此新增一条的代价不是多一个字符串，而是多一条无人看守的契约。**A5 不得添加第 24 条导航类事件。**

### 1.3 载荷形状：现状 4 份副本，权威类型只有 1 份

| # | 位置 | 性质 | 编译期约束 |
|---|---|---|---|
| 1 | `WorkbenchSidebar.tsx:11-21` `WorkbenchSidebarWorkItem` | **权威类型**（8 字段，已导出） | — |
| 2 | `TodayPanel.tsx:146-157` | 生产方字面量 | **无** |
| 3 | `KanbanCardModal.tsx:20-22` | 内联 `work?:` 子形状副本 | 无（与 #1 无关联） |
| 4 | `WorkbenchPanel.tsx:3412-3420` | 消费方**全可选**内联类型 | 无 |

危险不在副本数量，而在 **#4 的兜底把漂移静默掉了**：消费方使用 `detail.title || ""`、`detail.status || "inbox"`、`Array.isArray(detail.sessions)`（`WorkbenchPanel.tsx:3422-3431`）。生产方若把 `next` 改名，消费方拿到 `undefined` → 概要头的「下一步」整块消失，而 **tsc 全绿、无测试变红**。

**1.3a（属于 A5 范围，不构成扩范围）**
A5 新增生产方时**必须** `import type { WorkbenchSidebarWorkItem }` 构造 detail，**不得再写第 5 份形状字面量**。这是对新增代码的约束，不是对既有代码的重构。
- 若概要头落在 `features/report/`，从 `features/workbench/layout/WorkbenchSidebar` 取**类型**是允许的（`import type` 被完全擦除，无运行时耦合）；但**不得**从该文件导入任何值或组件。

**1.3b（不属于 A5，归 P8）**
消除 #3、#4 两份副本，把权威类型搬到中立模型模块 —— **归 P8**。
- 理由：P7 之后 `KanbanCardModal` 才是唯一生产方，而 P8 本来就要改它的归属与命名。在 A5 动 `KanbanCardModal` 会破坏排期已定的「P7 只切 import、P8 才改名归位」纪律。
- **P8 的验收口径无需改字**：契约原文「无残留引用」已涵盖它——残留的形状副本正是已退役 kanban 弹层的残留。只需在 P8 派工卡里把 grep 面从「`.kanban-` 类名」扩到「`workbench-work-item` 载荷形状只剩一处声明」。

**1.3c（另开一单，不阻塞 A5 / P8）**
权威类型住在 `layout/WorkbenchSidebar.tsx` 这个**布局组件文件**里，是本次问题的根因之一（数据契约与布局实现同居）。彻底修法是把 `WorkbenchSidebarWorkItem` 移出 layout 到中立模块，所有生产方/消费方改 import。若 P8 已按 1.3b 收敛到单一权威类型，可并入 P8 一并关闭。→ 工单见 [`desktop-archive-followups.md`](desktop-archive-followups.md) §T1。

---

## 2. 判据二 · 排序模块的落点与边界（P1 开工前必须遵循）

### 2.1 落点：确认 `features/workbench/sessionStatus/workItemRollup.ts`，不迁移

1. **硬约束全部满足**：不在 `features/today/`（P7 会删）、不在 `features/kanban/`（P8 会改名归位）、P7/P8 都不触碰它。
2. **语义归属正确**：它消费 `SessionDotStatus` 与 `ActiveSessionDot`，两者都由该目录 / 该 feature 拥有——`sessionStatus/types.ts:10-15` 定义词汇，`activeSessionDots.ts` 的文档头明确写 *"It performs no detection of its own — see `sessionStatus/`"*。工作项级 rollup 就是这层词汇的**上一层聚合**，放在词汇拥有者旁边，符合契约 A1「不新造布局原语」的同类取向。
3. 契约与排期已冻结该落点（排期 §2.1 P7 列为硬要求）。无功能性理由，不制造文档漂移。

**三条边界条件（不满足则落点等于给错）：**

- **必须是纯函数：不得 `import react`，不得写成 hook。** `sessionStatus/` 现有两个文件恰好都是 hook（`useAcpStatus` / `useAgentStatus`），照着邻居写 hook 是这里最可能的错误。P2 要在对列表求值处排序，A2（归档左列）会用同一函数——一旦做成 hook，归档列表就被绑死在工作台组件树上。
- **不加入 `sessionStatus/index.ts` barrel。** 该 barrel 的文档头把作用域限定为「会话状态的检测词汇」（`sessionStatus/index.ts:1-14`）。rollup 按路径导入（工作台内 `./sessionStatus/workItemRollup`，归档 `features/workbench/sessionStatus/workItemRollup`），路径同样稳定，且不让 barrel 的作用域声明失真。
- 测试 `workItemRollup.test.ts` 放**同目录**——与 `activeSessionDots.ts` + `activeSessionDots.test.ts` 的同目录惯例一致。

### 2.2 输入类型必须选渲染层那一份，不得引入第三份

实测点类型与状态词汇在仓库里**已有两份独立声明**：

| 位置 | 用途 |
|---|---|
| `sessionStatus/types.ts:10-15` `SESSION_DOT_STATUSES` / `SessionDotStatus` | 渲染层词汇 |
| `features/workbench/activeSessionDots.ts:11-17` `ActiveSessionDot` | 渲染层点模型 |
| `shared/workbenchSelection.ts:3-19` `WORKBENCH_SESSION_DOT_STATUSES` / `WorkbenchActiveSessionDot` | **主进程 / preload 的跨进程副本**，结构完全相同 |

- `workItemRollup` 用**渲染层 `ActiveSessionDot`**（P2/P3/P4/A2 全在渲染层）。
- **禁止** import `shared/workbenchSelection`——那是跨进程校验模块，渲染层 rollup 没有理由依赖它。
- **更禁止**再声明第三份点类型。

> **非阻塞观察（不在 P1 范围）**：这两份词汇已无任何编译期约束彼此，任何一侧加状态另一侧不会报错；`LIVE_RANK: Record<SessionDotStatus, number>` 只能保证**渲染层**那一侧不遗漏。这是既有缺陷，工单见 [`desktop-archive-followups.md`](desktop-archive-followups.md) §T2，**不要塞进 P1**。

### 2.3 边界：分组不迁移，`sectionOf()` 留在 TodayPanel

- **四段分组不迁移。** 契约 P2 只要求工作台**扁平列表排序**，契约 A2 的归档左列也只要求「排序 + 沿用现有项目/GTD 筛选」。`needs_you` / `blocked` / `next` / `inbox` 是**今日面板的视图定义**，不是共享逻辑。
- **`sectionOf()`（`TodayPanel.tsx:45-51`）留在 TodayPanel 本体，随 P7 一起删除。** 其唯一调用点是 `TodayPanel.tsx:126,284`，P7 后零消费者；放进共享模块会留下死函数，更糟的是会**诱导 A2 把归档左列也做四段分组**——那是超出契约的信息结构改动。
- **唯一要迁移的判据是 `needs_you`（`dot?.status === "awaiting_user"`），以具名导出进入 `workItemRollup`，供 P4 的「需要我 {n}」复用。**
  → **P1 必须现在就导出它。** P4 在 B3、P1 在 B1，若 P1 不导出，P4 只能再写一份 `=== "awaiting_user"`，违反 P1 的「无重复实现」验收。（这与排期 §2.1 的旁注一致，不改变契约功能范围。）

**⚠ 一处同名不同义，请在 P3 派工卡上标出：**
排序等级把 `open` 与「无活动会话」**都算作 0**（`LIVE_RANK.open = 0`），而**渲染点**用的是另一个判据（`dot && dot.status !== "open"`，`TodayPanel.tsx:238`）。P3 实现「无活动不渲染点」时必须用后者，**不得用等级是否为 0 判断**——否则一个只有 `open` 会话的行会静默少渲染一个点，而排序等级看起来完全正常。

### 2.4 `* 1e15` 打包：保留原式，不改写

**安全证明（实测数值，非推断）：**

- `updatedAtMs` 当前量级 ≈ `1.78e12`（2026-09）。最大等级 4 → 上界 ≈ `4e15 + 1.78e12 = 4.0018e15`。
- 该值落在 `[2^51, 2^52) = [2.2518e15, 4.5036e15)`，此区间 ULP = **0.5 < 1** → 区间内所有整数可精确表示，加法结果精确；且远小于 `Number.MAX_SAFE_INTEGER = 9.0072e15`。
- 等级严格支配时间戳：跨级最小差 = `1e15 - max(updatedAtMs) ≈ 9.98e14 > 0` → 等价于 **(等级 desc, updatedAtMs desc)** 的字典序。
- `rank(b) - rank(a)` 是精确整数差值（两操作数同量级且皆可精确表示），`sort` 只需符号。
- 溢出临界需 `updatedAtMs > 5.036e14`（约公元 17930 年）。

**结论：无溢出、无精度风险。**

**裁定：保留原式。** 理由：

1. 没有任何正确性理由要求改写——上一条已证明。
2. **改写会让 P1/P2 从「纯提取」变成「提取 + 行为改写」**，排序等价性失去「逐字未变」这个最强证据；而唯一覆盖排序的 `TodayPanel.test.tsx:73` 会被 P7 删除，**改写窗口恰好是没有回归网的窗口**。
3. 契约 P1 的验收是「无重复实现」，不是「改善实现」。改写属**超出 P1 范围**的改动；要做必须另开一单，并同时补上「今日面板与工作台两侧排序等价」的对照测试。

**附一条硬要求（不改行为，只防将来漂移）：**

- 打包必须在模块级注释里写明 `1e15` 的作用与**前提**（`updatedAtMs` 以毫秒计且 `< 1e15`）——否则将来有人把毫秒换成微秒/纳秒会静默错序。
- `LIVE_RANK` 保持 `Record<SessionDotStatus, number>`（现式即此）。破坏 `sessionStatus/types.ts` 的词汇元组就编译报错，这是它唯一的守卫，**不要降级成 `Record<string, number>`**。

---

## 3. 验收口径补充（形式缺陷，非需求变更）

| 任务 | 追加的验收 |
|---|---|
| **P1** | ① 必须导出 `needs_you` 判据（`awaiting_user`）供 P4 复用；② 模块内无 `react` import、无 hook、未进 `sessionStatus/index.ts`；③ 模块注释写明 `1e15` 前提；④ `LIVE_RANK` 仍为 `Record<SessionDotStatus, number>` |
| **P3** | 「无活动不渲染点」用 `dot && dot.status !== "open"`，**不得**用「等级 === 0」 |
| **P8** | 追加一条 grep：`workbench-work-item` 载荷形状只剩一处声明（并见 §1.3b） |
| **A5** | ① 生产方 `import type { WorkbenchSidebarWorkItem }`，无第 5 份形状字面量；② 只复用 §1.2 的四条事件，无新增导航事件；③ `import type` 之外不 import layout 文件的任何值/组件 |

---

## 4. 与冻结文档的关系

- **契约文件与需求口径零改动。** 以上全部落在实现约束层面：A5 的两条是对**新增代码**的约束（§1.1/1.2/1.3a），不扩 A5 的需求范围；P8 的 §1.3b 复用契约原文「无残留引用」，无需改字。
- 回填位置：排期单 §2.1「旁支风险」段（判据一）、§2.1「P1 / P2」段（判据二）、§2.2 P8 行、§5 派工建议的 P1 / B4 行、§7 变更记录。
- §1.3c 与 §2.2 的非阻塞观察是两处**既有缺陷**，判定**不在本次任何任务范围内**，另立工单、不阻塞 B1-B6。
