# 归档重构 · 执行排期与派工单

状态：**排期冻结，待开工** · 角色：Project Manager
依据：[`desktop-archive-contract.md`](desktop-archive-contract.md)（D1-D8 与 §6 任务表**不修改**）
本文件只回答四件事：**顺序与并行窗口** / **风险与回滚** / **不可自动化验收** / **R5 默认值**。

> 需求口径以契约为准。本文件不含新需求、不缩范围。凡与契约冲突之处以契约为准。

---

## 0. 环境事实（本次排期实测，非推断）

| 事实 | 证据 | 对排期的影响 |
|---|---|---|
| **仓库无 CI** | 无 `.github/workflows/` | 所有验收靠本地手动命令，"绿"是人为执行的结论，不是门禁 |
| **根 `test:desktop` 不跑 renderer 测试** | `package.json` 的 `test:desktop` 只串了 `test:mac-app`/`node-pty`/`doctor`/`workbench-files`/`agent-status` | **P7「全量测试绿」当前无对应命令**。113 个测试文件在 `apps/desktop/src/**/*.test.ts(x)`，只有 `pnpm --filter @agent-resume/desktop run test:renderer`（vitest）会跑 |
| **vitest 同时覆盖主进程与渲染层** | `apps/desktop/vitest.config.ts` → `include: ["src/**/*.test.{ts,tsx}"]` | D1/D2/C2 的主进程改动**能**被 vitest 测到；这是个好消息，前提是有人真的跑它 |
| **`i18n:check` 只对"缺失/多余"判失败** | `check-i18n.mjs:98-101` 推入 `errors` 并 `exit 1`；`:203-209` 的 unused 只 `console.warn` | 译文键残留**不会**让 `i18n:check` 变红 → 删除的干净程度必须靠 grep 验收，不能靠 i18n:check |
| **locale 必须三语键集完全一致** | `check-i18n.mjs:93-104` 对 `zh-cn`/`ja` 双向比对 | D3/P7/A9 必须**三个文件同一次改完**；漏一个即红 |
| **core 测试是 `node --test test/*.test.mjs`** | `packages/core/package.json` | core 的删除验收在 `packages/core/test/`，不在 vitest |
| **`work_item_sessions` 有覆盖索引** | `catalog/extensionSchema.ts:117,212` → `idx_work_item_sessions_session ON work_item_sessions(provider, agent_session_id)` | A0 的 `NOT EXISTS` 子查询可走索引，§5 的性能假设成立 |
| **`work_item_sessions` 有两份重复 DDL** | `catalog/extensionSchema.ts:110` 与 `:205` | A0 只加查询不加表，无需动这里；但审查时不要误改其一 |
| **`querySessionsPage` 的入参类型有三份副本** | core `SessionQueryRequest`（`catalog/query.ts:175-186`）、preload 手写接口（`preload.ts:189-204`）、main 的 IPC args 类型（`main.ts:1935-1946`） | **A0 必须三处同改**，只改 core 会编译通过但字段被静默丢弃（§2.1 A0） |
| **count 与 rows 共用同一个 `where` 数组**，但 count 在 `query.ts:242` 先被冻结 | `query.ts:242` 冻结 `countBase`；`query.ts:248` 才追加游标谓词 | A0 的新谓词**必须插在 240 行之前**，插到之后会让 `total` 静默变大（§2.1 A0） |
| **`querySessionsPage` 无任何真实数据库测试** | `grep querySessionsPage packages/core/test` → 空；唯一覆盖是 renderer 层的 mock | A0 的正确性目前**零自动化覆盖**，需新建 core 测试 |
| **扩展侧确实未消费被删能力** | `grep runReportGtdSync\|getPeriodInsights\|analyzeReportForGtd\|GtdProposal apps/extension/src/` → 空 | PM 的跨产品安全结论成立，D1/D2 不违反 product independence |

**已核对通过、无需返工的 PM 数字**（三语一致）：

| 项 | 契约值 | 实测 |
|---|---|---|
| `desktop.report.gtd*` | 35 | 35 / 35 / 35 ✅ |
| `insights*` + `composer*` | 42 | 20 + 22 = 42 ✅ |
| `desktop.today.*` | 14 | 14 ✅ |
| 三语总键数 | — | 2108 / 2108 / 2108（当前对齐） |

---

## 1. 执行顺序与并行窗口

### 1.1 关键路径

```
        ┌── D 阶段（D1 ∥ D2 → D3）──────────┐
        │                                    ▼
t0 ─────┤                            A1 ──┬─ A2 ──┐
        │                                    ├─ A5   │
        │                                    ├─ A6 ── A7
        │                                    │   └─ A8
        │                                    └─ A9
        ├── A0（独立，不依赖 D）──────────────┘(汇入 A4)
        ├── A3（独立）
        └── P 阶段（P1 → P2 → P3/P4；P5 → P6 → P7 → P8）
```

**关键路径 = D1 → A1 → A2/A6 → A9**。D1 是唯一的硬串行瓶颈，它一天不放，A1 一天不能动。

### 1.2 并行窗口

| 窗口 | 并行组 | 说明 |
|---|---|---|
| **W1** | **D1 ∥ D2 ∥ A0 ∥ A3 ∥ P1** | 五条互不触碰同一文件。这是全程并行度最高的一窗，应一次开满 |
| **W2** | **D3**（待 D1+D2）∥ **P2**（待 P1）∥ **C1** ∥ **A0 的验收测试** | D3 只是改 3 个 json；P2 依赖 P1 |
| **W3** | **A1**（待 D1+D2）∥ **P3 ∥ P4**（待 P1）∥ **P5** ∥ **C2**（待 C1） | A1 是 A 阶段唯一入口，尽早开 |
| **W4** | **A2 ∥ A5 ∥ A6**（均待 A1）∥ **P6**（待 P5）∥ **C3**（待 C2） | A2/A5/A6 三片都挂在 A1 下，可同时开 |
| **W5** | **A7 ∥ A8**（待 A6）∥ **P7**（待 P1-P6）∥ **A4**（待 A0+A1） | |
| **W6** | **A9**（待 A1-A5）∥ **P8**（待 P7） | 收尾 |

### 1.3 耦合点（必须点名的三处）

**耦合 ①：A2 与 P2 的隐式依赖 —— 契约的依赖列漏标了。**
§6 给 A2 标的依赖是「A1」，但 A2 的验收原文是「**按 P2 排序**」。A2 复用 P2 的排序逻辑，所以 **A2 的真实依赖是 A1 + P2**。
→ 若 P 线晚于 A 线，A2 会被卡住。**处置：把 P1+P2 提到 W1/W2，不要让它掉到 A2 后面。** 本单按此重排窗口，契约的依赖列表不改，只在此标注。

**耦合 ②：A1 的布局要为 D1/D2 的删除结果留位。**
D 是 A1 的前置（契约已写明）。若 D 未完成就开 A1，归档布局会按"还有 insights 柱状图、还有 GTD 提案按钮"来留位，等于白做。
→ **A1 不得早于 D1+D2 开始**，这是硬门。

**耦合 ③：D3 与 P7 都在改同一批 locale 文件。**
D3 删 `gtd*/insights*/composer*`，P7 删 `today.*` + `tabs.kanban`，A9 又要新增 `archive.*`。三者都落在 `apps/desktop/locales/{en,zh-cn,ja}.json`。
→ **同一时刻只允许一个任务持有 locale 文件**。建议 D3 在 W2 单独跑完，P7 在 W5，A9 在 W6，彼此不重叠。若必须并行，则按"一人一次改完三语"的规则串行化到同一个 owner。

### 1.4 建议批次（可直接派工）

| 批次 | 任务 | 并行数 | 出口条件 |
|---|---|---|---|
| **B1** | D1, D2, A0, A3, P1 | 5 | 各任务验收通过 + `test:core` + `test:renderer` 绿。**P1 需自带 `workItemRollup.test.ts`**（§2.1） |
| **B2** | D3, P2, C1 | 3 | `i18n:check` 绿 + P2 排序测试绿 |
| **B3** | A1, P3, P4, P5, C2 | 5 | A1 归档默认进工作项布局；C2 无机器文案写入 |
| **B4** | A2, A5, A6, P6, C3 | 5 | 三个 A 片挂在 A1 下 |
| **B5** | A4, A7, A8, P7 | 4 | P7 为删今日总闸 |
| **B6** | A9, P8 | 2 | 三语文案齐 + 文档漂移修完 |

---

## 2. 风险等级与回滚方式

等级口径：**高** = 破坏面跨包/跨产品，或静默错数据；**中** = 单包内破坏面明确，测试可拦；**低** = 局部，删除即回滚。

### 2.1 高风险项（逐个点名）

#### D1 · 删除 GtdSheet — **风险：中高**

- **为什么要盯**：这不是一次 UI 删除，是**跨包删除**。涉及 `packages/core/src/index.ts:708-720` 的 12 行公共导出 + `workflow/runReportGtdSync.ts` + `workflow/analyzeGtd.ts`。core 是**桌面与扩展共享**的包。
- **已验证的风险被排除**：扩展未引用（见 §0），故不违反 product independence。
- **真实残留风险（两条，都是静默型）**：
  1. `writeSessionTodolistMd`（`packages/core/src/notes/todolist.ts`）在删掉 `runReportGtdSync.ts:212` 后**没有任何调用者**。它是 core 的导出符号，删了会留孤儿。契约已定：**`todolist.md` 文件类型保留、已存在文件不删**。→ 处置：`writeSessionTodolistMd` 本身**一并删**（无消费者），但 `todolist.md` 的**索引与"不可移动"保护保留**（`notes/indexStore.ts:27`、`notes/store.ts:657`）。这两件事必须分开做，别一起删。
  2. `packages/core/test/reportGtdAnalysis.test.mjs` 会随实现一起失效。**它必须与 D1 同批删除**，否则 `test:core` 红。
- **回滚方式**：D1 单独一个 commit，`git revert <sha>` 即完整回滚。**不要**把 D1 与 D2 混在一个 commit —— 两者回滚粒度不同。
- **回滚后必须做的**：locale 三语一起 revert（否则 parity 红）。D3 若已执行，D1 的 revert 需要连带恢复 35 个 `gtd*` 键 → **这就是 D3 必须在 D1/D2 之后、且单独成群的理由**。

#### D2 · 删除 insights IPC — **风险：中**

- **为什么要盯**：`report:getPeriodInsights` 是 IPC 面（`main.ts:2421-2466` + `preload.ts:1085,1905`）。IPC 删除的危险不是编译错误，是**运行时静默 undefined**。
- **具体风险**：`main.ts:2434` 的注释显示 calendar-click 曾走这条廉价路径。删 IPC 后若任何渲染层残留 `desktopApi().getPeriodInsights(...)` 调用，会拿到 `undefined` 而**不报错**（除非调用点做了 `typeof === "function"` 守卫——`ReportPanel.tsx:483` 正是这么写的，说明这个 codebase 里存在这种模式）。
  → 处置：验收必须用 `grep -rn "getPeriodInsights\|PeriodInsights" apps/desktop/src/` 确认**零命中**，不能只看 `tsc` 通过。
- **必须同批删除的测试**：`PeriodInsightsDashboard.test.tsx`、`packages/core/test/periodInsights.test.mjs`、`ReportPanel.test.tsx` 中 4 处相关断言（`grep` 结果见 §0）。
- **回滚方式**：D2 单独 commit，`git revert`。D2 与 D1 无相互依赖，可独立回滚。

#### A0 · core 查询新增 `unassignedOnly` — **风险：高**（级联面比契约 §5 描述的更大）

- **为什么要盯**：`querySessionsPage` 是**全量调用方共享**的读路径。契约 §5 已定死：**所有过滤必须落在 SQL**，不许客户端拉全量过滤。
- **本次实测确认的三点（降低了风险，但仍列为高）**：
  1. 新字段**必须是可选的**（`unassignedOnly?: boolean`）。`SessionQueryRequest` 现有 **10 个字段全部可选**；仓库里有 **7 个非测试调用点**（`main.ts:404`、`main.ts:1962`、`WorkbenchPanel.tsx:1172`、`:1212`、`:1854`、`NotesPanel.tsx:405`、`ReportPanel.tsx:470`），其中 5 处是对象字面量构造。**加必填字段会让这 7 处全部报错**。→ **这是本次排期的硬约束**。
  2. **`NOT EXISTS` 子查询可走 `idx_work_item_sessions_session(provider, agent_session_id)` 覆盖索引**（§0 已验证），5000+ 会话下的性能假设成立。
  3. **`NOT EXISTS` 的语义选对了**：`work_item_sessions` 的 PRIMARY KEY 是复合的 `(work_item_note_id, provider, agent_session_id)`，**对 `(provider, agent_session_id)` 本身没有唯一约束**。"一个会话至多属于一个工作项"只由应用层的 last-writer-wins 保证（`notes/work.ts:127-136`）。所以必须用 `NOT EXISTS`（存在任一认领即算已归属），**不能假设该二元组唯一**。

- **⚠ 契约 §5 漏掉的两个真实陷阱（本单最重要的修正，必须在派工卡里写明）**：

  **陷阱 ①：入参类型有三份副本，只改 core 会"编译通过但功能没生效"。**
  `unassignedOnly` 要真正抵达 SQL，必须**三处同改**：
  | 层 | 位置 |
  |---|---|
  | core | `packages/core/src/catalog/query.ts:175-186`（`SessionQueryRequest`） |
  | preload | `apps/desktop/src/preload/preload.ts:189-204`（**手写的重复接口**，不是从 core 导入的） |
  | main | `apps/desktop/src/main/main.ts:1935-1946`（IPC `sessions:queryPage` 的 args 内联类型） |
  应用层代码**并不 import core 的 `SessionQueryRequest`** —— renderer 是对着 preload 的手写副本取类型的。只改 core：`tsc` 全绿，字段在 `main.ts:1953` 的 spread 处**被静默丢弃**，A4 表现为"未归属条目永远查不出东西"。
  → **这是本次排期里最容易漏、且最难从测试发现的一条。** 验收方式不能只看类型检查，必须有一条**端到端**的断言（见陷阱 ③）。

  **陷阱 ②：新谓词的插入位置是严格约束，插错会让 `total` 静默变大。**
  `query.ts` 用**一个可变的 `where` 数组**，count 与 rows 共用它，但**冻结时机不同**：
  ```
  :208   const where = ["s.hidden = 0"]
  :212-239  各谓词 push 进来（provider / projectPath / gtdStatus / keys …）
  :242   const countBase = FROM sessions s WHERE ${where.join(" AND ")}   ← count 在此冻结
  :248   追加游标谓词（这就是为什么游标不影响 total）
  :253   const base = ...                                                ← rows 在此求值
  ```
  → **`unassignedOnly` 必须插在 `:240`（`countBase` 那行）之前**，与 `gtdStatus` 谓词并列。
  - 插在**之前** → count 与 rows 一致 ✅（这是唯一正确做法；插在 234 行附近，紧挨同构的 `gtdStatus` 的 `EXISTS` 子查询）
  - 插在**之后** → rows 被过滤、`total` 不过滤 → **列表显示 3 条、计数写 47**。这恰好就是 A0 验收要防的"静默截断"的**镜像形态**，而且比截断更难发现（数字看起来更大、不像出错）。
  - 附注：`countBase` 每页都会重算（含翻页请求），`NOT EXISTS` 会给 count 路径也加成本。有覆盖索引，可接受，但不要夸大成"零成本"。

- **测试覆盖缺口（必须在 A0 内补上，否则这条 SQL 无人看守）**：
  - `grep querySessionsPage packages/core/test` → **零命中**。这条 SQL **当前没有任何真实数据库测试**。
  - 唯一相关覆盖是 renderer 层 mock：`WorkbenchPanel.test.tsx:484-507` 的 `querySessionsPageFromList` 假实现**签名只接受 `{ keys?, projectPath?, projectId? }`，其余字段一律忽略**。→ **即使 A4 传错了参数，这个 mock 也会让测试通过**。若在 renderer 层写 A4 的测试，必须同步扩这个 mock，否则得到的是假绿。
  - 现有 `toEqual`/`objectContaining` 式断言（如 `WorkbenchPanel.test.tsx:2529`、`ReportPanel.test.tsx:363`）**容忍新增字段**，所以不会因为多传字段而红 —— 好事，但也意味着**没人会因为 A0 出错而变红**。
  - → **A0 必须自带一条 core 测试**（`packages/core/test/` 下，参照 `catalogDb.test.mjs` / `noteWork.test.mjs` 的建临时 `catalog.db` 模式），至少覆盖：
    (a) 未归属会话被正确返回；(b) 已归属的被排除；(c) **`total` 与逐页游标在"结果多于一页"时一致**（否则测不出陷阱 ②）；(d) 查询路径确实吃到了新字段（防陷阱 ①）。

- **回滚方式**：A0 是**纯增量**（新增可选字段 + 新谓词），不改既有语义 → 回滚 = 删掉该字段与谓词，**7 个调用方零改动**。这是本单里回滚成本最低的高风险项。**建议 A0 用独立 commit，且不与其它 core 改动混合。**

#### P7 · 删除今日面板 — **风险：中高**

- **为什么要盯**：它是**删除**且**依赖链最长**（P1-P6 六个前置）。前置没全做完就删，会丢功能而不是丢代码。
- **删除面已知且很小（好消息）**：`TodayPanel.tsx` 共 317 行，**全仓库唯一 import 点是 `main.tsx:171`**。`rollupDot`/`LIVE_RANK` 除本文件外**零引用**（实测）→ P1 是纯提取，无外部消费者可破坏。
- **今日面板已有测试，且测的正是要提取的逻辑**：`features/today/TodayPanel.test.tsx`（118 行）含 3 个用例，其中 `:73` "sorts work items into needs-you / blocked / next / inbox" 覆盖的就是 P2 要复用的排序。**P7 会把它一起删掉** → 见下方"P1 必须自带测试"。
- **P7 会孤立整个 `features/kanban/` 目录（P8 的前提，契约未写明）**：`kanban/` 下只有两个文件 —— `KanbanCardModal.tsx` 与 `noteSessionResume.ts`，而后者的**唯一 importer 就是 `KanbanCardModal`**（实测）。删掉 `TodayPanel.tsx:8` 的 import 后，**`kanban/` 整个目录没有任何消费者**。→ 这解释了契约为什么把「`KanbanCardModal` 改名」放在 P8：**P7 只切 import，P8 才做重命名/归位**。**不要顺手把 `kanban/` 当死代码直接删** —— 它是工作项详情弹层，删了会丢详情交互。P8 的正确动作是**给文件与目录改名**（脱离已退役的 "kanban" 词汇），不是删除。
- **真正的风险不是代码，是静默功能丢失**：`notesCreateWorkItem` 目前（契约称）只有 TodayPanel 一个调用者。删掉 TodayPanel 后**"新建工作项"入口会消失** → 用户仍能看到工作项列表、但**无法新建**。这类缺失不会让任何测试变红。→ **P5 是 P7 的实质性前置，不是形式前置。**
- **验收命令风险**：契约写「全量测试绿」，但**根 `test:desktop` 不含 renderer 测试**（§0）。按现命令验收会得到一个"绿"，而 113 个测试文件根本没跑。
  → 处置：P7 的验收命令必须显式写为
  `pnpm --filter @agent-resume/desktop run test:renderer && pnpm run test:core && pnpm run test:desktop`
  并在验收记录里附上**实际执行的行数/用例数**，证明 renderer 确实跑了。
- **回滚方式**：P7 删的是 UI 与 14 个键。**回滚 = 反向 revert，但前提是 P1 提取的 `rollupDot`/`LIVE_RANK` 仍在**（P7 不删共享模块，只删面板）→ 这条约束要写进 P1：**提取出的模块不得放在 `features/today/` 下**，否则 P7 回滚时会把共享模块一起带回来或带走。契约建议的落点 `features/workbench/sessionStatus/workItemRollup.ts` 正合此意，**应作为硬要求执行**。

#### P5 / P6 · 入口迁移与默认落地页（两处实测细节，契约未写）

**P5 的前置风险已被实测坐实，且比契约描述更硬**：
- 「新建工作项」的 UI 入口**全仓库只有一个** —— `TodayPanel.tsx:265-268` 的工具栏按钮（`desktop.today.newWorkItem`）。`WorkbenchSidebar.tsx:238-250` 有工作项**列表**视图（筛选 + 行 + 空态）但**没有新建按钮**。→ **P5 不是"迁移一个入口"，是"重建一个入口"**：`WorkbenchSidebar` 那边目前连按钮都没有。
- `notesCreateWorkItem` 的 renderer 调用点确实只有 `TodayPanel.tsx:172` 一处（实测），但注意 `main.ts:410` 另有一条**内部**自动建档调用（D8/C2 要停的正是这类），与 UI 入口无关，不要混为一谈。
- **该按钮当前没有任何测试**：`TodayPanel.test.tsx:48-53` 的 `window.agentResume` stub **只提供了 `getI18nBundle`/`onLocaleChanged`/`notesListWorkItems`/`notesSetGtdStatus`，没有 `notesCreateWorkItem`** → 新建路径从未被测试覆盖。
  → **处置：P5 必须自带测试**，断言迁移后的新入口确实调用了 `notesCreateWorkItem`。否则 P7 删掉今日面板后，这条路径**既无入口验证也无测试**，是双重静默。

**P6 有两处需同改，契约只点了其中一处**：
- `AppChrome.tsx:27` 的 `useState<PrimaryTab>("today")` —— 契约已写。
- `main.tsx:166-167` 的启动强制切 tab（`dispatchEvent(tab-change, "today")`）—— 契约已写。
- **契约未写的第三处：`apps/desktop/src/renderer/index.html:21` 的 `<div id="react-today">`**。`TodayPanel` 通过 `document.getElementById("react-today")`（`TodayPanel.tsx:61`）取宿主再 `createPortal`（`:259-316`），**且它始终挂载、靠 `hidden={!active}` 隐藏**（`:260`），并非按 tab 条件渲染。
  → P7 删除时应一并清掉 `index.html` 的这个宿主 div；P6 改默认落地页时**不要**误以为改了 `useState` 初值就完成——还有这个 portal 宿主与常挂载语义要处理。

**旁支发现（顺带修，非新增范围）**：`desktop.tabs` 的 7 个键里有 **3 个已是孤儿** —— `desktop.tabs.agent` **全仓库零引用**；`desktop.tabs.im` 与 `desktop.tabs.kanban` 只出现在测试夹具 `AppChrome.test.tsx:21`。契约已要求 P7 删 `desktop.tabs.kanban`，**建议同时把 `agent` 一并清掉**（`im` 若扩展侧要用则保留，需确认）。

#### 旁支风险 · `agent-resume:workbench-work-item` 事件契约的双份定义

- 载荷在 `TodayPanel.tsx:146-157` 组装，消费方是 `WorkbenchPanel.tsx:3442-3446` 的监听。
- 生产方有两处：`TodayPanel.tsx:146` 与 `KanbanCardModal.tsx:191,430`。
- **危险点**：`WorkItem` 的形状在 `KanbanCardModal.tsx:20-22` 是**内联重新声明的副本**（不是 import）→ **两边漂移不会有任何编译错误**。
- 对本次排期的影响：P7 移除 TodayPanel 的生产路径后，`KanbanCardModal` 成为该事件**唯一的生产方**；若 P8 又改动 modal，需确认载荷形状与 `WorkbenchPanel:3442` 的期望仍然一致。
  → **建议（非新增范围，供裁量）**：A5 的详情概要头若要打开工作项，**复用同一条事件**而不是另造一条，避免出现第二条同类事件契约。这一点请在 A5 开工前由 Architect 裁定。

**✅ Architect 裁定已回填（详见 [`desktop-archive-architect-rulings.md`](desktop-archive-architect-rulings.md) §1）**：
1. **复用，不另立。** 该事件的唯一语义就是「把某个工作项设为工作台当前作用域」（`WorkbenchPanel.tsx:3412-3431`），与 A5「归档 tab 驱动工作台」同一语义；反向无需求。
2. **A5 只能复用四条既有事件**：`tab-request` / `workbench-work-item` / `workbench-open-room` / `open-note`，**不得新增导航类事件**（实测 `agent-resume:*` 已有 **23 条**，且**无任何集中登记处**）。
3. **载荷形状实测是 4 份副本，权威类型只有 1 份**：`WorkbenchSidebar.tsx:11-21`（权威）／`TodayPanel.tsx:146-157`／`KanbanCardModal.tsx:20-22`／`WorkbenchPanel.tsx:3412-3420`。危险点不是副本数量，而是消费方（`WorkbenchPanel.tsx:3422-3431`）用 `detail.title || ""`、`Array.isArray(detail.sessions)` 兜底 → **漂移被静默吸收**，tsc 全绿、无测试变红。
4. **范围内外的划法**：A5 **必须** `import type { WorkbenchSidebarWorkItem }` 构造载荷，**不得再写第 5 份字面量**（对新增代码的约束，不构成扩范围）；消除既有副本、把权威类型移出 layout **归 P8**（见下方 P8 行）；权威类型「应开一单但不必现在开」的部分见 [`desktop-archive-followups.md`](desktop-archive-followups.md) §T1。

#### P1 / P2 · 修订契约对现状的描述（**P2 的"现在只过滤不排序"是错的**）

实测 `TodayPanel.tsx:128-132` **已经实现了 P2 要求的那套排序**：

```ts
const rank = (item: WorkItem) => {
  const dot = rollupDot(item, dotByKey);
  return (dot ? LIVE_RANK[dot.status] : 0) * 1e15 + item.updatedAtMs;   // :130
};
for (const list of Object.values(sections)) list.sort((a, b) => rank(b) - rank(a));
```

- 所以 **P2 不是"新写排序"，而是"把 TodayPanel 里已有的 `rank()` 提取出来、再作用到工作台列表"**。这**显著降低 P2 的风险**（逻辑已被线上验证过），但也改变了派工口径：**P1 的提取范围应包括 `rank()`，不只是 `rollupDot` + `LIVE_RANK`**，否则 P2 到了工作台会重新写一遍、变成"重复实现"，直接违反 P1 的验收（「无重复实现」）。
- **必须保留的差异**：TodayPanel 除排序外还做了**四段分组**（`needs_you` / `blocked` / `next` / `inbox`，`:121-127`）。**工作台列表是扁平列表，不做这四段分组**（契约 P2 只要求排序）。提取时**不要连分组一起搬**，否则会改变了工作台的既有信息结构 —— 这是超出契约范围的改动。
- **顺带可复用的点（提请注意，非新增范围）**：`needs_you` 的判定条件（`dot.status === "awaiting_user"`，`:125`）与 P4 的「需要我 {n}」芯片是同一个判据。**P4 应复用同一常量/函数，不要另写一份 `=== "awaiting_user"`**，否则两处判据将来会漂移。
- **等级修正**：P1 由「中」下调至「低」（纯提取、零外部消费者）；P2 维持「低」，但**实现路径改为"复用已提取的 `rank()`"**。
- **⚠ P1 必须自带单元测试（否则产生永久覆盖缺口）**：排序与 rollup 的**唯一现有覆盖**是 `TodayPanel.test.tsx:73`，而 **P7 会删掉这个文件**。若 P1 只做代码搬家、不补测试，则 P7 之后 `rollupDot` / `rank()` **永久无测试**，且不会有任何测试变红来提示这件事。
  → **处置：P1 的验收标准加一条 —— 提取出的模块自带 `workItemRollup.test.ts`，覆盖 (a) 多会话取最高等级、(b) `LIVE_RANK` 五档顺序、(c) `rank()` 排序。** 这不改变契约的功能范围，只是把将要丢失的覆盖**跟着代码一起搬走**。P7 随之只删 `TodayPanel.test.tsx`，不产生净损失。

**✅ Architect 裁定已回填（详见 [`desktop-archive-architect-rulings.md`](desktop-archive-architect-rulings.md) §2）**：

**⚠ 时序修正：判据二的约束窗口是 B1 的 P1，不是 B2 的 P2。** 共享模块的**导出面在 P1 就定死**，P2/P3/P4 只是消费者。P1 未拿到本裁定就开工，会漏掉必须导出的 `needs_you` 判据 → P4 只能重写一份，直接踩 P1 的「无重复实现」验收。

1. **落点确认** `features/workbench/sessionStatus/workItemRollup.ts`（不迁移）。三条**边界条件**，不满足则落点等于给错：
   - **必须是纯函数**：不得 `import react`、不得写成 hook。该目录现有两个文件恰好都是 hook（`useAcpStatus` / `useAgentStatus`），**照着邻居写 hook 是这里最可能的错误**；一旦成 hook，A2 的归档列表就被绑死在工作台组件树上。
   - **不加入 `sessionStatus/index.ts` barrel**（该 barrel 文档头把作用域限定为「会话状态的检测词汇」，`index.ts:1-14`）；按路径导入。
   - `workItemRollup.test.ts` 放**同目录**（对齐 `activeSessionDots.ts` + `activeSessionDots.test.ts` 惯例）。
2. **输入类型必须选渲染层那一份**：用 `activeSessionDots.ts:11-17` 的 `ActiveSessionDot`；**禁止** import `shared/workbenchSelection.ts`（跨进程校验模块），**更禁止**再声明第三份点类型。既有缺陷另见 [`desktop-archive-followups.md`](desktop-archive-followups.md) §T2。
3. **分组不迁移（确认）**，`sectionOf()`（`:45-51`）留在 TodayPanel 本体随 P7 删除。★ **P1 必须现在就导出 `needs_you` 判据**（`dot?.status === "awaiting_user"`）供 P4 复用——P1 在 B1、P4 在 B3，P1 不导出则 P4 只能重写，违反「无重复实现」。
4. **`* 1e15` 保留原式，不改写。** 已证明**无溢出、无精度风险**：上界 `4e15 + 1.78e12 = 4.0018e15`，落在 `[2^51, 2^52)` 区间（ULP 0.5 < 1，整数精确），远小于 `MAX_SAFE_INTEGER 9.0072e15`；跨级最小差 `≈ 9.98e14 > 0`，等价于 (等级 desc, updatedAtMs desc)；溢出临界需 `updatedAtMs > 5.036e14`（约公元 17930 年）。改写的代价：P1/P2 从「纯提取」变「提取+行为改写」，而唯一覆盖排序的 `TodayPanel.test.tsx:73` 会被 P7 删除 → **改写窗口恰好没有回归网**。属超出 P1 范围，要做须另开一单。
   附硬要求（不改行为，只防漂移）：模块注释写明 `1e15` 的作用与**前提**（`updatedAtMs` 毫秒且 `< 1e15`）；`LIVE_RANK` 保持 `Record<SessionDotStatus, number>`，**不要降级成 `Record<string, number>`**。
5. **⚠ 一处同名不同义，P3 派工卡请标注**：排序等级把 `open` 与「无活动会话」**都算作 0**（`LIVE_RANK.open = 0`），而渲染点用的是**另一个判据**（`dot && dot.status !== "open"`，`TodayPanel.tsx:238`）。P3 实现「无活动不渲染点」必须用后者，**不得用「等级 === 0」判断**，否则只有 `open` 会话的行会静默少渲染一个点。

### 2.2 其余任务的风险与回滚

| ID | 风险 | 主要失效模式 | 回滚方式 |
|---|---|---|---|
| **D3** | 低 | 三语漏改 → `i18n:check` 红（**会**红，属良性失败）；误跑 `merge:desktop-i18n` 会打散键 | 单 commit revert；**明确禁止** `merge:desktop-i18n` |
| **P1** | **低**（由中下调） | 模块落点放进 `features/today/` → P7 连带删除/回滚困难；或漏提取 `rank()` → P2 重写一遍违反「无重复实现」 | 纯移动，revert 即还原 |
| **P2** | 低 | 排序不稳定 → 无实时会话的工作项相对顺序被打乱；或误把四段分组一起搬到工作台 | revert；验收含"相对顺序不变" |
| **P3** | 低 | 无活动行多渲染一个点 | revert |
| **P4** | 低 | n=0 时控件仍渲染（契约明确要求 DOM 中不存在） | revert |
| **P5** | **中** | 入口迁移后新旧入口并存（重复）或都消失（功能丢失）；**该按钮当前零测试**（`TodayPanel.test.tsx` 未 stub `notesCreateWorkItem`） | revert；**必须自带测试**断言新入口调用 `notesCreateWorkItem` |
| **P6** | 低 | 冷启动未落工作台；**三处**而非两处要改（`AppChrome.tsx:27`、`main.tsx:166`、**`index.html:21` 的 `react-today` portal 宿主**） | revert |
| **P8** | 低 | 误删仍在用的 `.kanban-*`（56 行是死样式，**余下 41 行不是**）；或把整个 `features/kanban/` 当死代码删掉（它是工作项详情弹层，见 §2.1 P7） | revert；删除前按类名逐个 grep 引用；**并按裁定 §1.3b 追加一条 grep：`workbench-work-item` 载荷形状只剩一处声明**（即消除 `KanbanCardModal.tsx:20-22` 与 `WorkbenchPanel.tsx:3412-3420` 两份副本，权威类型统一到 `WorkbenchSidebar.tsx:11-21`） |

> **P8 计数待核，且有一个真实删除危险**：契约写「91 行 `.kanban-*`，其中 56 行是死样式」。实测 `apps/desktop/src/renderer/styles.css`：**97 行匹配、116 处出现、52 个唯一选择器**，且**不连续**（分散在 `:388`、`:1029-1056`、`:12332-12356`、`:12998`、`:15745-16041` 五个区域）。
> **危险 ①（必须写进派工卡）：`styles.css:388` 是多选择器规则的一员，不是独立规则**——
> ```css
> 387  .mac-top #app-header-slot > .toolbar,
> 388  .mac-top #app-header-slot > .kanban-toolbar,
> 389  .mac-top #app-header-slot > .wb-detail-head {
> ```
> 按行删 `.kanban-*` 会**破坏头部布局规则**。必须逐选择器处理，不能按行批量删。
> **危险 ②：约 40 个选择器（`kanban-board` / `kanban-card-*` / `kanban-column-*` / `kanban-folders-*` 等）已经没有任何组件消费者**（board 组件此前已移除），只有 modal 相关选择器还活着。→ P8 的真正动作是**分离"已死"与"仍在用"两组，只删前者**，并以实际 grep 为准，不要照抄 91/56 这两个数字。
> **漏项：`desktop.kanban.*` 有 35 个键 × 3 语言**，契约从未提及。P7 孤立 `KanbanCardModal` 后这批键全部成为孤儿，**应并入 P8 的删除范围**（三语同改）。
| **A1** | 中高 | 新造布局原语（契约禁止）→ 与三列外壳产生两套布局 | revert；**A1 必须单独 commit** |
| **A2** | 中 | 按 `link.title` 分组 → 同名工作项被合并（**这就是 A3**，两者同区域，务必先合 A3） | revert |
| **A3** | 低 | 改 key 时漏改显示用 title → 界面显示 noteId | revert |
| **A4** | 中 | 靠客户端过滤实现 → 违反 §5，大目录下静默截断 | revert；验收含 5000+ 目录 |
| **A5** | 低 | 六态胶囊未落库 | revert |
| **A6** | 低 | 无会话时白页 | revert |
| **A7** | **中** | 用整篇报告冒充摘录（契约 §3 明令禁止 T3） | revert；验收含"无报告时不渲染分组标题" |
| **A8** | 低 | 默认 200 静默截断 → 与 A0 同源的失效模式 | revert |
| **A9** | 低 | 三语不全 → `i18n:check` 红 | revert |
| **C1** | 中 | 持久标记与实时点语义混淆（两者叠加会双信号） | revert |
| **C2** | **中高** | 停掉自动建档后用户丢失信号（**这就是 C1 必须前置的原因**）；误删已存在的工作项 | revert；验收含"已存在工作项不受影响、不被删除" |
| **C3** | 低 | 硬编码英文残留（该文案此前完全不经 i18n，容易被漏） | revert |

### 2.3 全流程通用回滚纪律

1. **一个任务一个 commit**，scope 用 `core`/`desktop`（`.arp/config.json` 的 commit 约定）。
2. **locale 改动与代码改动在同一 commit** —— 拆开会让中间态 `i18n:check` 红。
3. **D1 / D2 / A0 / A1 / P7 五个高影响项禁止混合提交**，否则回滚粒度丢失。
4. 每个 commit 落地前跑：`pnpm run test:core && pnpm --filter @agent-resume/desktop run test:renderer && pnpm run i18n:check`。**注意**：`test:renderer` 必须显式敲，根 `test:desktop` 不会带你跑。

---

## 3. 无法自动化验证的验收标准（需人工确认）

契约里的验收标准有相当一部分**本质是"界面上不出现某物"或"数据没被破坏"**，测试能证明"新东西在"，但很难证明"旧的没混进来"。以下逐条列出，**必须在 PR 描述或验收记录里留人工确认痕迹（截图/录屏/DOM 快照）**。

### 3.1 必须人工确认（自动化不可靠或不可行）

| ID | 验收原文 | 为什么不能自动化 | 建议的人工证据 |
|---|---|---|---|
| **D1** | 「全仓库无 `GtdSheet`/`runReportGtdSync`/`gtd-open` 引用」 | 可 grep，但**"无引用"是 grep 的结论不是测试的结论**；grep 会漏字符串拼接式动态引用 | 附 `grep -rn` 原始输出 + 打开日报面板看 GTD 入口确已消失 |
| **D1** | 「已存在的 `todolist.md` **仍被索引且可见**」 | 需要一份**预置了 todolist.md 的 panel home 快照**才能验；单测里造假数据证明不了真实索引行为 | 在真实 workbench 打开一个含 todolist.md 的笔记面板，截图 |
| **D2** | 「`ReportPanel` 仍正常渲染日报/周报/月报」 | "正常"无客观断言；且历史报告需真实数据 | 三种周期各截一张图 |
| **P3** | 「三种状态各一条测试；**无活动行不出现第二个点**」 | 前半可自动化；**后半是"不出现"，视觉断言** | 无活动行的行截图 |
| **P4** | 「n=0 时 **DOM 中不存在**该控件」 | **可自动化**（`queryBy*` 断言 null）→ 见 §3.2，此处列出仅为提醒"断言不存在"≠"断言不可见" | — |
| **P5** | 「今日删除后**仍可新建工作项**」 | 依赖 P7 完成后的真实交互 | 删今日后录屏一次新建流程 |
| **P6** | 「冷启动直接进工作台」 | 需真实冷启动（`AppChrome.tsx:27` + `main.tsx:166` 两处） | 冷启动截图 |
| **A1** | 「进入归档**不再默认看到日历**」 | "不再默认看到"= 否定式视觉断言 | 进入归档首屏截图 |
| **A1** | 「沿用现有三列外壳，**不新造布局原语**」 | 架构性约束，无客观判据 | 代码审查结论 + 与既有三列外壳的 diff 对照 |
| **A2** | 「同名工作项**不合并**（按 `noteId`）」 | 可自动化，但**需要预置两个同名工作项的 fixture**，成本高 | 若能造 fixture 则自动化；否则双同名工作项截图 |
| **A4** | 「归档左列**存在该条目**」+「搜索仍覆盖全部会话（含已关联与未归属）」 | 前半可自动化；后半"仍覆盖"是**回归型**断言，需对比改前改后结果集 | 附搜索改前/改后结果条数对比 |
| **A4** | 「5000+ 会话下未归属计数与游标正确，**不被 limit 静默截断**」 | **需要真实 5000+ 会话目录**，单测 fixture 造不出来才有说服力 | 用真实 panel home 跑，附计数与逐页游标记录 |
| **A5** | 「**六态可切换并落库**」 | "落库"要查真实存储；六态各切一次 | 六态截图 + 数据库/笔记 frontmatter 前后对照 |
| **A5** | 「IM 入口进入现有房间，**不聚合消息**（D4）」 | "不聚合"是否定式断言，且需真实 IM 房间 | 点击 IM 入口后的房间截图 |
| **A6** | 「无会话时显示空态，**不是白页**」 | 否定式视觉断言 | 空态截图 |
| **A7** | 「**不渲染整篇报告冒充摘录**」+「无报告时**不渲染该分组标题**」 | 两条都是否定式；且 T3 禁令需人判断"这是指针还是摘录" | 有报告/无报告两种情况截图 |
| **A8** | 「单工作项 500 会话下可用，**能看到还有更多**」 | 需 500+ 会话的真实工作项 | 附"加载更早"出现与点击后结果 |
| **A9** | 「`docs/desktop/report.md` 改写」+「`.agents/menus/desktop.md` 补齐」 | 文档质量无法自动化 | 人工通读确认四处漂移均已修 |
| **C1** | 「关闭期间卡住的会话**仍有信号**（tooltip）」 | 需真实"关闭-卡住-重开"时序 | 复现时序的录屏 |
| **C2** | 「**已存在的工作项不受影响、不被删除**」 | 破坏性验收，需改动前的备份对照 | 改动前后工作项清单 diff |
| **C3** | 「无硬编码英文残留」 | 可 grep，但"硬编码英文"的判定边界模糊 | 附 grep 输出 + 人工通读该函数 |
| **全阶段** | 「无引用残留」（D2/P7/P8） | grep 可辅助，但**动态引用与字符串键**是盲区 | 附 grep 输出 |

### 3.2 确实可以自动化（不要浪费人工）

- D3 / A9 / P7 的 **`i18n:check` 绿** → 命令化，且**必须三语同时改**才绿。
- P1 的「无重复实现」→ 可 grep 断言 `rollupDot` 只有一个定义。
- P2 的「`awaiting_user` 会话的工作项浮到最上」→ 排序函数单测（纯函数）。
- P4 的「n=0 时 DOM 中不存在」→ 用 `queryBy*` 断言 `null`（**注意：断言"不存在"，不是断言"不可见"**）。
- A0 的「计数与游标一致」→ **可以也应该自动化**，但必须新建 core 测试（现有 `querySessionsPage` 零测试覆盖）：
  - 必须包含**"结果多于一页"**的用例，否则测不出 `total` 与 rows 的谓词错位（§2.1 陷阱 ②）。
  - 必须有一条断言**字段真的抵达 SQL**（非"仅类型通过"），否则测不出三份类型副本漏改（§2.1 陷阱 ①）。
- A3 的「两个同名工作项渲染为两个条目」→ fixture 可造。
- P8 的「无残留引用」→ grep `.kanban-` 类名。

### 3.3 建议新增的一条验收（形式缺陷，非需求变更）

**「验收命令真的跑到了测试」**：P7 与 D1/D2 的验收都依赖"测试绿"，但根 `test:desktop` 不跑 renderer。
→ 建议在验收记录里**强制附上 renderer 测试的执行摘要（通过用例数 > 0）**。这不需要改需求，只是补上取证方式。

---

## 4. R5（`归档` 是否改 `历史`）的默认值处理

**结论：默认不变更，不占任务位，不作为 A9 的验收项。** 理由与处置如下。

### 4.1 实测事实（与契约的措辞有出入，需记录）

契约 §7 把 R5 描述为 "tab 改名 `归档` → `历史`"。实测：**tab 已经在界面上叫「归档」了**——

| locale | `desktop.tabs.report` |
|---|---|
| en | `'Archive'` |
| zh-cn | `'归档'` |
| ja | `'レポート'` ← **仍是"报告"，未同步** |

- tab 的 **id 是 `report`**（`AppChrome.tsx:16`），**显示名已改为 Archive/归档**。
- 即：**"改名"动作在早前已完成**，R5 剩下的是一个"是否再改一次"的命名偏好。
- 附带发现：**ja 未跟上 en/zh 的改名**，`desktop.tabs.report` 在日语仍是"レポート"。这是一处**现存漂移**，与 R5 同源。

### 4.2 默认值：不改，理由是 D3

D3 定「归档是视图、不是状态」，界面上不再有"归档/取消归档"动词。**"归档里没有归档动作" → "归档"不再有词套词的歧义**，改名 `历史` 的主要收益消失。PM 的倾向（不改）成立，本单采纳为默认值。

### 4.3 处置方式（低优先决策的标准流程）

1. **默认 = 不改。** 无人明确推翻即按此执行，**不阻塞任何任务**。
2. **不写进 A9 的验收标准。** A9 只做契约已写明的两件事（`desktop.archive.*` 新增键 + 两处文档漂移）。R5 若混进 A9，会让 A9 的完成标准变模糊。
3. **落 A9 的文档漂移部分照做**（契约已定）：`docs/desktop/report.md:13` 现仍写 *"Report is the default home of Desktop"*，且描述为 *"calendar-first ... with a GTD strip"* —— 与 D1（时间轴降级）、D2（GTD 权威迁移）、D7（砍 insights）三处冲突，**这是必须修的漂移，与 R5 无关**。
4. **ja 的 `レポート` 漂移**：按默认值处理原则**顺带在 A9 修**（改为 `アーカイブ` 或与 en 一致的词），因为 A9 已经在改这三个文件，此时修成本为零。**若你希望 R5 保持"完全不动"，则 ja 也保持原样，二者需一致决定。**
5. **重开条件**：R5 若要翻转，**应在 A1-A5 落地、能看到真实归档界面之后**再评估（届时"归档"一词在界面上的实际观感才有依据），并作为**独立的文案单**（改 3 个 locale 的 1 个键），不回头修改 A9。

---

## 5. 派工建议（按批次）

| 批次 | 任务 | 建议 owner | 备注 |
|---|---|---|---|
| B1 | D1, D2 | Developer（core 改动 + IPC 一起，避免跨人拆 core 导出） | D1/D2 分开 commit |
| B1 | A0 | Developer（core） | 纯增量，独立 commit |
| B1 | A3 | Developer（renderer） | 与 A2 同区域，先落 |
| B1 | P1 | Developer（renderer） | **落点硬约束**：`features/workbench/sessionStatus/workItemRollup.ts`；**并须满足裁定 §2 的四条边界**：纯函数不成 hook、不进 `sessionStatus/index.ts` barrel、必须导出 `needs_you` 判据供 P4 复用、保留 `1e15` 原式 |
| B2 | D3 | Developer（locale） | 需独占三语文件 |
| B2 | P2, C1 | Developer | |
| B3 | A1 | Developer（renderer，需先过 D1+D2 门） | **必须单独 commit** |
| B3 | P3, P4, P5, C2 | Developer | |
| B4 | A2, A5, A6, P6, C3 | Developer | A2 依赖 P2 已完成；**A5 须遵守裁定 §1**：复用既有四条事件、不得内联第五份载荷形状（须 `import type { WorkbenchSidebarWorkItem }`）、`import type` 之外不引 layout 文件的任何值/组件 |
| B5 | A4, A7, A8 | Developer | A4 依赖 A0+A1 |
| B5 | P7 | Developer | 验收命令见 §2.1 |
| B6 | A9, P8 | Developer | A9 需独占三语文件 |

**Tester 介入点**：A0 完成（5000+ 目录的压力与游标验证需要真实数据）；P7 删今日前（功能丢失回归）；A4 完成（搜索覆盖面回归）。
**Architect 介入点**：A1 开工前（"不新造布局原语"的判据需架构裁定）、A0 的 SQL 谓词落位、**P1 的模块导出面（见裁定 §2，须在 B1 开工前下发）**。
**已闭合的介入点**：A5 的事件契约判据（裁定 §1）与 P1/P2 的落点与边界（裁定 §2）**已回填**，见 [`desktop-archive-architect-rulings.md`](desktop-archive-architect-rulings.md)，**B1 的 P1 与 B4 的 A5 开工前无需再等裁定**。

---

## 6. 待你裁决（阻塞 B1 的两项，其余不阻塞）

1. **D8 的前置 C1 是否一起做。** 契约 §6 把 C1 标为 C2 的依赖，C1 本身无依赖 → **可按 B2 的 C1 → B3 的 C2 执行**。若你决定不做 C1，则 C2 会丢信号（关闭期间卡住的会话无任何提示），**此决策影响 C2 的验收标准，需在 C2 开工前定**。
2. **`.arp/docs/` 目前 untracked，且仓库有并发写入者。** 本单与契约两份文档都在 untracked 状态，随时可能被并发会话的自动提交打散或丢失。**建议立刻提交一次**（仅 `.arp/docs/`，不含工作区其它未提交改动）——这会改动 git 状态，**需你明确同意后我才执行**。

---

## 7. 变更记录

| 时点 | 变更 |
|---|---|
| 初版 | 依契约 §6 排出 D/P/A/C 顺序、6 个批次、并行窗口与 3 处耦合点；完成风险分级与回滚策略；列出不可自动化验收清单；R5 默认值定为"不改"；实测发现无 CI、根 `test:desktop` 不跑 renderer 测试、tab 已改名（ja 未同步）三处环境事实 |
| 复核 A0 | 实测确认契约 §5 漏掉两个陷阱：① 入参类型有**三份副本**（core/preload/main），只改 core 会编译通过但字段被静默丢弃；② `countBase` 在 `query.ts:242` 先冻结，新谓词必须插在 `:240` 之前，否则 `total` 静默变大。另确认 `querySessionsPage` **零真实数据库测试**，A0 必须自带 core 测试 |
| 复核 P | 实测修正契约对现状的描述：P2 的排序**已存在于** `TodayPanel.tsx:128-132`（`rank()`），P2 改为"复用已提取的 `rank()`"，P1 提取范围须含 `rank()` 与 `needs_you` 判据；P1 降为中→低；新增 P1 必须自带测试（否则 P7 删 `TodayPanel.test.tsx` 后永久丢覆盖）；查清 P7 会孤立整个 `features/kanban/`（P8 是改名而非删除）；P8 的 91/56 行 CSS 计数实测为 97 行 / 116 处 / 52 选择器，且发现 `styles.css:388` 属多选择器规则（按行删会破坏头部布局）、35 个 `desktop.kanban.*` 键×3 语言为契约漏项 |
| 复核 P5/P6 | 实测坐实 P5 前置风险：新建工作项 UI 入口**全仓库唯一**（`TodayPanel.tsx:265-268`），`WorkbenchSidebar` 只有列表没有新建按钮 → P5 是"重建入口"而非"迁移入口"，且该路径**零测试**（`TodayPanel.test.tsx` 未 stub `notesCreateWorkItem`）；P6 实测**三处**要改（契约只写两处，漏 `index.html:21` 的 `react-today` portal 宿主，且 TodayPanel 是常挂载 + `hidden` 而非条件渲染）；另记录 `agent-resume:workbench-work-item` 载荷在 `KanbanCardModal` 内有形状副本（漂移无编译错误）、`desktop.tabs` 有 3 个孤儿键 |
| 回填 Architect 裁定 | 两项判据已裁定并回填本单（全文见 [`desktop-archive-architect-rulings.md`](desktop-archive-architect-rulings.md)，**契约未改一字**）。**判据一（§2.1 旁支风险段）**：A5 复用既有 `workbench-work-item` 事件、不得新增导航事件（实测 `agent-resume:*` 已有 23 条且无登记处）；载荷形状实测 **4 份副本**（权威类型 `WorkbenchSidebar.tsx:11-21`），消费方 `WorkbenchPanel.tsx:3422-3431` 的全可选兜底使漂移**静默**；A5 只承担「不得新增第 5 份字面量」，既有副本收敛归 P8，权威类型移出 layout 另立工单（followups §T1）。**判据二（§2.1 P1/P2 段）**：落点确认 `features/workbench/sessionStatus/workItemRollup.ts` 并追加三条边界（纯函数不成 hook／不进 barrel／测试同目录）；输入类型用渲染层 `ActiveSessionDot`、禁止引 `shared/workbenchSelection`；分组不迁移、`sectionOf()` 随 P7 删除、**P1 必须现导出 `needs_you` 判据**；`* 1e15` **保留原式**并附溢出/精度证明（上界 4.0018e15，ULP 0.5，远小于 2^53）；**时序修正：判据二的约束窗口是 B1 的 P1 而非 B2 的 P2**。另记录两处既有缺陷为**不阻塞**工单（双份会话状态词汇无双向编译约束，followups §T2；其静默失效路径为 `workbenchSelection.ts:100-102` 把未知状态回退为 `open`） |
