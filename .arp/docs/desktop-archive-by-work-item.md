# 归档 = 按工作项：交互与信息结构方案

角色：UI Designer · 状态：提案（待 PM 拍板 A/B/C 与 tab 改名）
覆盖：候选形态 A / B / C、入口与切换控件、分组头与空态文案、归档动作落点与二次确认、归档 / 已完成 / 隐藏 三词区分、今日删除后实时状态汇总的替代落点、自动建档 (a)/(b)/(c) 的 UI 立场。

---

## 0. 结论（先给答案）

**A / B / C 不是三个方案，是同一外壳的三层。** 推荐把它设计成**一个外壳 + 一片次第落地**：

| 片 | 内容 | 对应候选 |
|---|---|---|
| 外壳 | 「历史」tab 的**模式切换**：`时间轴 ｜ 工作项` | 新增 |
| 第 1 片 | 会话分组从「标题」升级为「工作项对象」（修掉同名合并） | **C** |
| 第 2 片 | 工作项生命周期：进行中 → 已归档（可逆、不删文件） | **B** |
| 第 3 片 | 工作项详情面：跨时间的会话史 / 报告摘录 / 状态变迁 / 决策 | **A** |

**明确否决的读法**：把 A 做成「第三条导航轴」（新增第五个 tab，或让工作项成为与时间并列的一级导航）。理由：产品刚从「两套导航（推 + 拉）」收敛成一套，再开一条一级轴会把这次收敛的收益退回去；而且 A 的内容（一个工作项的跨时间全貌）天然属于**详情面**，不属于导航层。

**顺序**：C（修 bug + 打地基）→ B（确立「不再活跃」边界，让「归档」这个词成立）→ A（价值最大，但依赖前两者）。与 PM 的判断一致。

---

## 1. 事实基线（提案依据）

- 顶栏 4 个 tab：今日 / 归档 / 工作台 / 笔记（`components/AppChrome.tsx:11,14-19`）。归档 = `desktop.tabs.report`。
- 归档布局是**日历优先**：`.report-layout` = 左列日历 `.report-cal-pane` + 中间会话侧栏 `.report-session-pane`（可折叠，标题为 `Sessions · 区间`）+ 主详情 `.report-detail-pane`（本期画像 `PeriodInsightsDashboard` + 日报/周报/月报 + 会话预览）。`ReportPanel.tsx:542-552`
- 归档的工具栏**不在页内**，被 portal 到应用头部 `#app-header-slot`：左 `‹ 年 月 › 今天`，右 刷新。`ReportPanel.tsx:526-539`
- 侧栏会话已按工作项分组，但**分组 key 是标题**：`workItemBySession[key] = link.title || link.noteId`（`ReportPanel.tsx:489`）→ `groupKey = work:${label}`（`:505`）。同名工作项会合并。分组头是非交互的 `div.cal-session-group-head`（标签 + 计数）。
- 工作台工作项行：`[GTD 状态点][标题 / 项目名][会话数]`（`layout/WorkbenchSidebar.tsx:250`）；筛选是两个单选 `select`：项目 + 状态（`:240-249`）。
- 工作项列表**只过滤、不排序**：`visibleWorkItems` 无 sort（`WorkbenchPanel.tsx:3381-3389`），继承 SQL `ORDER BY updated_at_ms DESC`（`packages/core/src/notes/catalogNotes.ts:328`）。**实时状态完全不参与排序与筛选。**
- 工作项作用域头部只有**存储 GTD** 的状态胶囊：`wb-work-item-status is-${status}`（`WorkbenchPanel.tsx:5628-5635`）。
- 全局唯一的工作项级实时汇总在今日：`rollupDot()` + `LIVE_RANK`（`features/today/TodayPanel.tsx:16-43,110-134`）。会话级实时在导航栏底部 `SessionDotsCluster`（`AppChrome.tsx:202`）。
- 归档已有的深链 idiom：`agent-resume:report-focus`（`ReportPanel.tsx:310`）；跨页跳转 idiom：`agent-resume:tab-request`。
- 通知是纯文本 toast，**不支持操作按钮**：`DesktopNotificationInput = { text, kind?, durationMs? }`（`components/notificationStore.ts:3-7`），3 秒自动消失，另有通知中心历史。
- 「归档」一词在本产品**已有三种不兼容含义**：① tab 名（时间轴报告页）；② 退役看板的 `desktop.kanban.archive*`，其语义是**清除 GTD 状态**（`desktop.kanban.archiveAllConfirm`：「将清除其 GTD 状态」）；③ provider 同步层的会话可见性（`desktop.settings.showArchivedCodex`、`archived` session）。

---

## 2. 外壳：入口与切换控件

### 2.1 入口

**主入口**：现有「归档」tab + 头部工具栏最左侧的模式切换。

**次入口（第 2 片再做，可选）**：
- 工作台工作项行的溢出菜单 → `查看历史`（`{tab: 历史, mode: 工作项, noteId}`），复用 `agent-resume:tab-request` + 新增一个 focus 事件（与既有 `agent-resume:report-focus` 同构）。
- 工作项作用域头部 `wb-work-item-head`（`WorkbenchPanel.tsx:5628-5667`，已有 笔记 / 讨论 / 关闭 三个图标按钮）追加第 4 个图标按钮 `历史`。**不改右边的关闭按钮语义。**

### 2.2 切换控件的位置与形态

放在**应用头部工具栏的最左端**，日历导航之前：

```
[时间轴｜工作项]   ‹  2026 ▾  09月 ▾  ›  [今天]        [项目▾ 状态▾] [需要我 2]            刷新
└─ 模式切换 ─┘  └──── 仅时间轴模式 ────┘   └──────── 仅工作项模式 ────────┘
```

- 控件沿用既有 idiom：`SegmentedControl` + `sidebar-project-filter-segmented` 家族（工作台侧栏 `工作项视图｜资源` 与 `项目｜GTD 视图` 都用的同一个组件，`WorkbenchSidebar.tsx:226-229`）。**不新造控件。**
- 两种模式**互斥地占用中段**：时间轴模式显示日历导航（现状不变），工作项模式显示工作项筛选。这避免了两套控件同时在场导致的误读。
- 默认进入**时间轴**（保持现状，不做惊喜），并**记住上次选择**（沿用工作台 `sidebarView` 的持久化方式）。
- 无障碍：`SegmentedControl` 自带 `aria-label`，用 `desktop.archive.mode`；两种模式的容器分别是 `role="tabpanel"` 语义的独立 section，切换后焦点留在切换控件上，由用户自行 Tab 进入内容（不要自动抢焦点到列表第一行）。

**被否决的替代位置**：
1. **左列内部再放一个 SegmentedControl**（照抄笔记页 `笔记｜GTD 视图` 的做法，`NotesPanel.tsx:1250-1258`）。否决原因：工作项模式下左列已经不是日历了，把开关放在列内会暗示「日历只是工作项列表的一个选项」，轴线关系被讲反。
2. **新增第五个 tab**。否决原因见 §0。
3. **顶栏 tab 直接拆成「时间轴」+「归档」两个 tab**。否决原因：4 个 tab 已接近上限，「我该去哪」的成本大于收益；模式切换的语义更准确（同一个"看过去"的面，换一根轴）。

### 2.3 工作项模式下的三列重映射（复用现有外壳，零新布局原语）

```
┌ 顶栏 (#app-header-slot) ───────────────────────────────────────────────┐
│ [时间轴｜工作项]     [项目▾] [状态▾] [需要我 2]                    刷新 │
└────────────────────────────────────────────────────────────────────────┘
┌ 左：工作项 ─ replace 日历 ─┬ 中：会话侧栏（重定范围）─┬ 右：详情 ────────┐
│ 工作项 (12)                │ Sessions · 重构          │ ■ 重构           │
│ 进行中 (9)                 │ ┌──────────────────────┐ │ [下一步] A·B     │
│  ● ▸ 重构        A·B   4  │ │ 今天 (3)             │ │ 下一步：拆分 arpm │
│  ▲ ▸ 支付接入     A    2  │ │   …                  │ │ 决策：等凭据      │
│  ○   周会纪要     —    0  │ │ 本周 (5)             │ │ ───────────────  │
│ ▸ 已归档 (3)   ← 折叠      │ │ 更早 (4)             │ │ 全部历史          │
│                            │ └──────────────────────┘ │ 09-13 会话 ×3     │
│                            │                          │ 09-12 周报摘录     │
│                            │                          │ 09-11 收件箱→下一步│
└────────────────────────────┴──────────────────────────┴──────────────────┘
 ● 需要你   ▲ 异常   ○ 进行中   （无点 = 无活动会话）
```

三个必须改的"含义漂移"：
1. **会话侧栏的标题**：现在显示 `Sessions · {区间}`（`rangeLabel`，`ReportPanel.tsx:551`）。工作项模式下区间无意义，必须改成 `Sessions · 工作项标题`，全时段视图的兜底文案为 `全部时间`。不改的话用户会以为列表仍被区间过滤。
2. **本期画像 `PeriodInsightsDashboard` 必须隐藏**（它是 period 维度的，其帮助文案全部以"当期"为前提，如 `composerHelpHourly`）。工作项模式的主详情改为「工作项概要 + 全部历史」。
3. **搜索框语义**：现在是全局会话搜索（`desktop.archive.searchPlaceholder = 搜索全部会话…`，跨期）。工作项模式下同一位置应改为搜索工作项，placeholder 换 `搜索工作项…`，且**不再走会话搜索 IPC**。

---

## 3. 三个候选形态逐一展开

### C — 会话分组从「标题」升级为「工作项对象」（第 1 片）

**做什么**
- 索引改为 noteId 维度：`workItemBySession[provider:id] = noteId`，另存 `workItemMeta[noteId] = { title, status, projects }`；`groupKey = work:${noteId}`。同名工作项不再合并。
- 分组头从 `div` 升级为 `button`：`[GTD 状态点] 标题 · 项目名   会话数   ↗`。点击 → 切到工作台工作项视图并选中该工作项。悬停 tooltip：`在工作台打开这个工作项`。
- 同名歧义时，标题后追加项目 basename 消歧：`重构 · agent-resume-panel`。
- 排序：组按（实时等级 desc，组内最新会话时间 desc），`未归属工作项` 永远置底。

**入口**：无需新入口（沿用时间轴模式的会话侧栏）。

**空态**：`未归属工作项` 已存在（`desktop.report.noWorkItemGroup`），保持不变；补 tooltip `没有关联工作项的会话`。

**成本**：最小，当天可验收。**唯一风险**：`ReportPanel.test.tsx` 现有断言可能依赖标题分组。

### B — 工作项生命周期归档（第 2 片）

**做什么**
- 工作项获得**独立于 `gtdStatus`** 的归档标记（理由见 §5）。
- 左列分两个 section：`进行中 (n)`、`已归档 (n)`（折叠，计数在标题里）。
- 归档后：退出工作台工作项默认列表、退出 `需要我` 筛选与排序、退出任何推式汇总；**不关闭会话、不动笔记文件、不动项目**。
- 可逆：`已归档` 行悬停出 `取消归档`，或在详情面头部操作。取消后回到原 GTD 状态（标记是布尔，不覆盖状态，所以无需"记住原状态"）。
- 同步：复用 `agent-resume:notes-mutated`，不新增广播。

**入口**：3 个落点，见 §4。

**空态**：见 §4.3。

**成本**：中等。需要一个新字段 + 列表分区 + 确认流程。

### A — 工作项详情面（第 3 片）

**做什么**：主详情 = 概要头 + 全部历史时间轴。

概要头：
```
■ 重构                                  [下一步 ▾]        ⋯ 归档
  agent-resume-panel · agent-resume-panel-doc            4 个会话
  下一步：拆分 arpm 的 shim 安装路径
  决策：等 provider 凭据
```
- 状态胶囊**可点击**，展开六态菜单（复用工作台右键菜单的 GTD 六态样式 `wb-gtd-context-tag`，`WorkbenchPanel.tsx:6314`），解决今日删除后"状态设不了"的缺口。
- 项目 chip 复用 `pathMissingHint` 的缺失态。
- `⋯` 里放 `归档` / `取消归档`；**不放删除**（删除只从笔记面板与卡片模态走，见 §5）。
- 头部保留一个 `打开笔记` 图标按钮（与工作项作用域头部一致）。

全部历史（倒序，时间轴）：
| 条目类型 | 内容 | 数据 |
|---|---|---|
| 会话 | provider tag · 标题 · 项目 · 时间 · 实时状态；点击 → 复用现有会话预览（`SessionDetail` + `返回` idiom） | 已有（`work_item_sessions`） |
| 报告摘录 | `[周]` 徽标（复用 `.badge` + `levelFor`）+ 前 2 行 + 点击展开 | **需新查询**（`report_*` 只按 period 建索引） |
| 状态变迁 | `09-11 收件箱 → 下一步` | **需新的变更日志**；若不做，此条降级为只显示当前状态 |
| 决策 / next 变更 | 同上 | 同上 |

规则：
- **没有数据的类型不渲染该分组标题**，绝不出现 `GTD 变迁 (0)`。
- 空态见 §4.3。
- 性能：不要一次全渲染。沿用归档已有的分页 idiom（`querySessionsPage({ limit: 200 })`，`ReportPanel.tsx:470`），底部给 `加载更早`。**注意现有搜索是静默截断在 200 条**——工作项历史里必须显式给"加载更早"，不能静默截断。

**成本**：最大，且被 §3 的两处"需新查询/新日志"卡住。**因此 A 应先只做会话史 + 当前 next/decision（已可做），报告摘录与状态变迁作为 A.2。**

---

## 4. 分组头、空态与归档动作的文案与落点

### 4.1 新增文案（key → zh-cn / en）

模式与外壳：
| key | zh-cn | en |
|---|---|---|
| `desktop.archive.mode` | 查看轴 | View axis |
| `desktop.archive.mode.time` | 时间轴 | Timeline |
| `desktop.archive.mode.workItem` | 工作项 | Work items |
| `desktop.archive.searchWorkItems` | 搜索工作项… | Search work items… |
| `desktop.archive.sessionsAllTime` | 全部时间 | All time |

列表与分区：
| key | zh-cn | en |
|---|---|---|
| `desktop.archive.sectionActive` | 进行中 | Active |
| `desktop.archive.sectionArchived` | 已归档 | Archived |
| `desktop.archive.needsMe` | 需要我 {0} | Needs me {0} |
| `desktop.archive.openInWorkbench` | 在工作台打开这个工作项 | Open this work item in Workbench |
| `desktop.archive.unassignedHint` | 没有关联工作项的会话 | Sessions with no linked work item |
| `desktop.archive.groupDisambiguated` | {0} · {1} | {0} · {1} |

归档动作：
| key | zh-cn | en |
|---|---|---|
| `desktop.archive.archive` | 归档 | Archive |
| `desktop.archive.unarchive` | 取消归档 | Unarchive |
| `desktop.archive.archivedToast` | 已归档「{0}」 · 可在「已归档」中恢复 | Archived "{0}" · restore it under Archived |
| `desktop.archive.unarchivedToast` | 已取消归档「{0}」 | Unarchived "{0}" |
| `desktop.archive.archivedBatchToast` | 已归档 {0} 个工作项 | Archived {0} work items |
| `desktop.archive.confirmActive` | 「{0}」还有 {1} 个会话正在运行或等待你。归档不会关闭它们，只是让这个工作项退出活跃列表。 | "{0}" has {1} session(s) running or waiting on you. Archiving won't close them — it only removes the work item from the active list. |

空态：
| key | zh-cn | en |
|---|---|---|
| `desktop.archive.workItemsEmpty` | 还没有工作项。在工作台 →「工作项」视图新建一个。 | No work items yet. Create one in Workbench → Work items. |
| `desktop.archive.workItemsEmptyCta` | 打开工作台 | Open Workbench |
| `desktop.archive.activeEmptyArchived` | 活跃工作项都已归档。展开下面的「已归档」查看 {0} 个。 | Every active work item is archived. Expand Archived below to see {0}. |
| `desktop.archive.historyEmpty` | 这个工作项还没有会话或报告。在工作台选中它并新建会话，或先给它写一条「下一步」。 | This work item has no sessions or reports yet. Open it in Workbench to start a session, or write a next action first. |
| `desktop.archive.searchNoWorkItems` | 没有匹配的工作项 | No matching work items |
| `desktop.archive.lastExitWaiting` | 上次退出时该会话在等待你的输入 | This session was waiting on you when the app last closed |

### 4.2 分组头（时间轴模式，第 1 片）

```
[●] 重构 · agent-resume-panel                        4   ↗
 ↑ GTD 状态点  ↑ 标题（歧义时追加项目名消歧）        ↑ 会话数  ↑ 点击进工作台
```
- 保持现有的视觉密度（`cal-session-group-head` 的标签 + 计数），只把容器从 `div` 换成 `button`，`↗` 是 hover 才出现的图标按钮（避免常驻噪音）。
- `未归属工作项` 组没有 `↗`（没有对象可跳）。

### 4.3 空态

| 场景 | 文案 | 附带动作 |
|---|---|---|
| 一个工作项都没有 | `workItemsEmpty` | 按钮 `打开工作台`（**跳转，不新建** —— 创建入口只留在工作台一处） |
| 活跃为空、已归档有 n | `activeEmptyArchived` | 展开「已归档」 |
| 详情无会话无报告 | `historyEmpty` | 按钮 `在工作台打开`；**其下再降级显示笔记正文摘要**（`contentPreview`），不留白 |
| 搜索无结果 | `searchNoWorkItems` | — |
| 已归档为 0 | **不渲染该 section**（不显示「已归档 0」） | — |

> 创建入口的迁移：`notesCreateWorkItem` 在渲染层只有今日一个调用者（`TodayPanel.tsx:172`）。删除今日时必须迁到工作台「工作项」视图工具栏（`WorkbenchSidebar.tsx:238-249` 那一行），且**归档页的空态只做跳转，不复制这个入口**——一个动作一个入口。

### 4.4 归档动作的落点与二次确认

**落点（3 个，都不放在行内图标位）**
1. 工作台工作项行的**溢出菜单**（`⋯` / 右键）→ `归档`。支持**多选批量**（工作台已有多选会话的机制，沿用）。
2. 工作项**详情/作用域头部的 `⋯`**（工作台 `wb-work-item-head`、归档详情面头部）→ `归档` / `取消归档`。
3. 归档页 `已归档` 行内 hover → `取消归档`（唯一一处允许行内直接动作，因为它只增不减注意力）。

**为什么不做行内图标按钮**：今日的行内 4 图标（认领/完成/搁置/编辑，`TodayPanel.tsx:241-254`）已经是密度上限的坏示范；归档是低频且"移走东西"的动作，放在溢出菜单里既省宽也降低误触。

**二次确认策略**（按"是否有用户看不见的副作用"决定，而不是按"是否危险"）：

| 场景 | 处理 | 理由 |
|---|---|---|
| 单个归档，无活跃会话 | **不弹窗**。行从「进行中」移到「已归档」，位移本身可见；toast `archivedToast` | 可逆 + 后果可见 = 不需要打断 |
| 单个归档，**有活跃会话**（running / connecting / error / awaiting_user） | **轻量确认** `confirmActive`（复用 `gtd-md-overlay` 的覆盖层 idiom，或 `window.confirm`）。按钮：`归档` / `取消` | 有看不见的后果：用户在别处期待这些会话 |
| 批量归档（≥2）且含活跃会话 | 同上的确认，文案带会话总数 | 同上 |
| 批量归档，无活跃会话 | **确认 + 结果摘要**（`archivedBatchToast`）。若要做撤销，见下依赖 | 位移发生在另一个 tab，用户看不见，需要一次"事实确认" |
| 取消归档 | **永不弹窗**，toast `unarchivedToast` | 纯恢复动作 |

**依赖缺口（必须知道）**：通知目前**不支持操作按钮**（`notificationStore.ts:3-7` 只有 text/kind/durationMs）。所以"批量归档 → 撤销"需要先给 `DesktopNotificationInput` 加一个可选 action（label + onClick，并落进通知中心历史）。这是产品里第一个真正需要 undo 的动作，值得加；**在加之前，不要在设计里假设有 undo**：单个归档的回退路径是**空间性**的（已归档就在同一列的下方，一次点击），不依赖 toast 按钮。

**结果一致性**：归档后 1 秒内列表与计数同步，复用 `agent-resume:notes-mutated`，**不新增广播**。

---

## 5. 「归档 / 已完成 / 隐藏」的语义契约

| 词 | 作用对象 | 说的是什么 | 可逆 | 动文件 | 出现位置 |
|---|---|---|---|---|---|
| **已完成** done | 工作项 / 会话 | **进度**事实：这件事做完了 | 可逆（改回其他 GTD 状态） | 否 | 状态点 / 状态胶囊；工作台 GTD「已完成」组；工作项详情 |
| **归档** archived | 工作项 | **注意力**事实：不必再出现在活跃列表 | 可逆 | **否** | 工作台溢出菜单；归档页「已归档」 |
| **隐藏** hidden | 会话（provider 同步层）/ 侧栏 | **视图**事实：这次别看 | 随时可恢复 | 否 | 现有 settings 会话可见性；`隐藏侧栏`。**工作项上不使用** |
| **删除** delete | 笔记 | **数据**事实：文件没了 | 不可逆 | 是 | 仅笔记面板与卡片模态 |

**四条硬规则**

1. **完成 ≠ 归档，两者正交，不互为前置。** 可以"完成但未归档"（还要跟后续），也可以"归档但未完成"（暂时放弃）。→ 归档必须是**独立字段**，不能复用 `gtdStatus=done`。
   *补一条 PM 未提的 UI 理由*：工作台的状态筛选是**单选**（`WorkbenchPanel.tsx:3385`）。若把归档塞进 `gtdStatus`，筛选下拉里会出现与「完成」同级的「已归档」，用户会天然以为它们是同一根轴上的兄弟状态，而它们其实一个是进度、一个是注意力。
2. **归档后不再产生任何推式提示。** 不进 `需要我` 的排序与筛选、不挂角标。但它**不掩盖事实**：展开「已归档」时，若某行有 `awaiting_user` / `error` 的会话，仍然显示实时点。规则一句话：**推式面排除，拉式面保留事实。** 因此归档一个"正在等待你"的工作项时，确认文案必须明说（`confirmActive`）。
3. **`隐藏` 不作为工作项动词存在。** 它只作为筛选开关的**标签**出现（如 `显示已归档`）。不要新增"隐藏工作项"这个动作——它会与归档抢同一个用户意图，且没有"我隐藏了什么"的回看面。
4. **归档 ≠ 删除，且绝不能删除笔记。** 除了"归档可逆"这个直觉理由，还有一个硬机制理由：自动建档的判重靠**笔记里的 session 链接**（`main.ts:408-409`）。**删除**自动建档的笔记会让它在下次阻塞/退出时**复活**；**归档**保留笔记 → 判重继续成立 → 不再复活。也就是说：**归档是让自动建档闭嘴的唯一可逆手段。**

### 5.1 「归档」这个词已有三种含义，必须先收口

| 现存含义 | 位置 | 处置建议 |
|---|---|---|
| ① tab 名（时间轴报告页） | `desktop.tabs.report = 归档` | **改名 → `历史`**（见下） |
| ② 退役看板的归档 = **清除 GTD 状态** | `desktop.kanban.archive / archiveAll / archiveAllConfirm / archived` | **一并删除**，语义与新定义冲突，不得复用 |
| ③ provider 同步层的会话可见性 | `desktop.settings.showArchivedCodex`、`archived` session | **不动**（来自 Codex 自身语义），仅在 settings 脚注补一句区分 |

**tab 改名建议：`归档` → `历史`**（`desktop.tabs.report`，3 个语言文件 + 菜单项；`docs/desktop/report.md` 仍写着 "Report is the default home of Desktop"，已是漂移，一并修）。

理由：该页默认就是「日历 + 周月报」，是一根**时间轴**。改名后：
- `历史` = 看过去（两根轴：时间 / 工作项）；
- `归档` = 一个**生命周期状态**，只在「历史 → 工作项」里作为 `已归档` 分区出现。

用户在 `历史 → 工作项 → 已归档` 里就不会遇到"归档里的归档"这种词套词。

**可接受的次选**（若 PM 认为改名成本过高）：保留 tab 名 `归档`，但**必须**把分区改名为 `已封存`，且不在该页使用「归档」作动词（动作叫"移入封存"）。我不推荐——它用两个新词换掉了一个改名。

---

## 6. 今日删除后：工作项实时状态汇总的替代落点

**核心动作：把「需要你」从一个**页面**降级为一个**排序 + 一个点 + 一个条件筛选片**，落在工作台「工作项」视图里。**

### 6.1 必做三件

**① 排序（最重要的替代）**
`visibleWorkItems` 现在只过滤不排序（`WorkbenchPanel.tsx:3381-3389`），继承 SQL 的 `updated_at_ms DESC`（`catalogNotes.ts:328`）。改为：**先按实时等级（`LIVE_RANK`）desc，再按 `updatedAtMs` desc。**

这一条就把今日唯一不可替代的价值（"它自己找上你"）搬进了工作台：不需要新增任何控件，卡在等你的工作项自然浮到最上。今日的排序权重逻辑正是 `TodayPanel.tsx:128-131`。

> **删除今日的硬前置**：`rollupDot()` 与 `LIVE_RANK` 现在定义在 `TodayPanel.tsx:16-43`，会随今日一起被删。**必须先提取到共享模块**（建议 `features/workbench/sessionStatus/workItemRollup.ts`），否则工作台会重写一份，第二次就会漂移。

**② 行内实时点**
工作项行左侧由 `[GTD 点]` 变成 `[GTD 点][实时点]`：

```
○ ▸ 周会纪要      —   0     ← 无活动：只显示 GTD 点（实时点不出现）
● ▸ 重构         A·B  4     ← 需要你：GTD 点 + accent 实时点 + 行左侧竖条
▲ ▸ 支付接入      A   2     ← 异常：GTD 点 + warn 实时点
○ ○ 数据迁移      A   1     ← 进行中：GTD 点 + muted 实时点
```

- **无活动时实时点不渲染**（不是渲染灰点）——"缺席即常态"，让出现本身成为信号。
- 三档映射：`awaiting_user` → accent；`error` → warn；`running` / `connecting` → muted。组件直接复用 `session-dot` + `sessionDotStatusClass`（与导航栏底部 `SessionDotsCluster` 同源，视觉自动一致）。
- 需要你的行加一条**左侧竖条**，**不要**照搬今日的整行底色（`.today-row.needs-me`）——侧栏行矮、面积小，整行底色会变成噪音墙。
- **备选（若加第二个点后行太挤）**：合并为一个点，GTD 点保留填充色（状态），实时性用**外环**表达（需要你 = accent 外环 + 轻微呼吸）。一个槽位承载两维。我不首选它：两个槽位各自可读、各自可复用现有组件，误读风险更低。
- **只保留在拉式面**：`已归档` 区不参与排序与筛选，展开时仍显示 `awaiting_user` / `error` 的实时点（见 §5 规则 2）。

**③ 条件筛选片**
工作项视图顶部筛选行（`WorkbenchSidebar.tsx:240-249`）追加一个 `需要我 {n}` 开关，**仅在 n > 0 时渲染**：

```
[项目 ▾] [状态 ▾]   [需要我 2]   ← 计数为 0 时整个芯片消失
```

- 保留"被推到眼前"的感受，但不再是常驻的一个页面；没有需要你的事时，界面里**不存在**这个东西（比今日的"目前没有需要你处理的"空态更安静）。
- 沿用现有的两个 `select`，**不要**改造成一排状态芯片——那会引入与工作台 GTD 文件夹重复的第二套状态语义。

### 6.2 明确不做

- **不在导航栏底部再堆一个工作项级的点**：那里已有会话级的 `SessionDotsCluster`（`AppChrome.tsx:202`）。两个层级的点并排会让人分不清哪个管什么。分工：**导航栏 = 会话（什么在跑）；工作台工作项列表 = 工作项（哪个需要我）。**
- **不给归档页的「工作项」模式加实时点**。归档是拉式面，加了实时点就变成第二个推式面——正是这次要收敛掉的东西。`已归档` 分区里的点例外（§5 规则 2）。
- **不要改项目行的活动点语义**。项目行已有 `active: pendingCount > 0 || 有打开的会话`（`WorkbenchPanel.tsx:1683`）+ `wb-folder-activity-dot`，它的意思是"这里开着东西"，**不是**"这里需要你"。强行统一会让每个有打开会话的项目都开始喊"需要你"，注意力信号立刻贬值。

### 6.3 一个必须写进契约的缺口

工作项实时汇总（和今日一样）只覆盖**当前打开的会话**——点是按 pane 生成的（`activeSessionDots.ts:41-44`）。**app 关闭期间卡住的会话没有任何实时信号。** 这正是自动建档链路存在的理由，见下节。

---

## 7. 自动建档 (a)/(b)/(c) 的 UI 立场

**推荐 (a)：停掉写笔记的自动建档，把"卡住"留在会话状态里。** 但需要两个前提，否则会丢信息：

1. **在会话对象上留一个持久标记。** 实时点只覆盖打开的会话，所以"上次退出时在等待你"必须落在会话记录上（daemon 已有 transition 事件，落在 session 上成本低），在会话行 / 工作项行的 tooltip 里显示 `lastExitWaiting`。这是把"往永久层写机器文案"换成"在正确的对象上留一个短标记"。
2. **如果最终保留任何写入，必须先本地化并改成决策口吻。** 现在的 `decision` 文案是硬编码英文、不经 i18n（`main.ts:389`），zh 用户看到的是 `Agent is blocked and waiting on you — codex reported by the agent.`。它现在的口吻是**日志**，不是决策。

**明确反对 (b)**（落点改成"待归档"）：**它不解决堆积，只是搬家。** 新的归档生命周期会让这些条目同样堆在「已归档」里，除非有人手动归档——问题从 A 列表搬到 B 列表，而 B 列表还多背了一个"归档"的名声。

**明确反对 (c)**（保持现状）：这就是"堆积而不是沉淀"的定义。

**对 PM 判断的一处修正**：自动建档**不会**变成"无人消费"——工作台工作项列表就是消费面（它列出全部工作项，含自动建档项）。它变成的是**无人排序**：这些机器命名的条目会与真实工作项混在一起，靠 `updated_at_ms` 排序被淹没、被跳过。这个区别很重要，因为它把结论从"要保留一个消费面"改成"要给列表排序"——也就是 §6.1 ① 那一条。

---

## 8. 验收标准

**第 1 片（C）**
1. 分组 key 由标题改为 noteId；两个同名工作项渲染为两个分组。
2. 分组头可点击并选中工作台对应工作项（`agent-resume:tab-request` + focus 事件）。
3. 无归属会话仍归入 `未归属工作项` 且置底。
4. 同名歧义时标题追加项目 basename。
5. `ReportPanel.test.tsx` 及归档相关测试全绿。

**第 2 片（B）**
1. 存在独立于 `gtdStatus` 的归档标记；归档不修改 `gtdStatus`。
2. 归档后可逆；取消归档不弹确认；归档不删除笔记文件、不关闭会话。
3. 归档动作后 1 秒内列表与计数同步（复用 `notes-mutated`，无新广播）。
4. 归档项不出现在工作台工作项默认列表、不进 `需要我` 排序与筛选、无角标。
5. 展开 `已归档` 时，含 `awaiting_user` / `error` 会话的行仍显示实时点。
6. 归档含活跃会话的工作项时弹出确认，文案含会话数。
7. `已归档` 为 0 时不渲染该分区。
8. 归档自动建档产生的工作项后，下次阻塞 / 退出**不再复活**它（判重仍命中）。

**第 3 片（A）**
1. 概要头显示：标题、可点击的状态胶囊（六态）、项目 chips（含缺失态）、`下一步` / `决策`、会话数、`打开笔记`、`⋯`（归档 / 取消归档，无删除）。
2. 全部历史按时间倒序，混合会话 / 报告摘录 / 状态变迁；**无数据的类型不渲染标题**。
3. 点击会话条目进入现有会话预览并可返回（复用 `backToReport` idiom）。
4. 空态使用 `historyEmpty` 且降级显示笔记正文摘要，不是空白页。
5. 单工作项 500 会话下可用：默认 200 条 + `加载更早`，不静默截断。
6. 工作项模式下隐藏 `PeriodInsightsDashboard`；会话侧栏标题不再显示区间，改为工作项标题 / `全部时间`。
7. 搜索框在工作项模式下改为搜索工作项，不走会话搜索 IPC。

**外壳**
1. 模式切换在最左，`SegmentedControl` idiom，默认时间轴，记住上次选择。
2. 两种模式互斥占用中段：时间轴显示日历导航，工作项显示工作项筛选。
3. 键盘可达，切换后焦点留在切换控件，不自动抢焦点。
4. tab 名 `归档` → `历史`（3 语言 + 菜单 + `docs/desktop/report.md`）。

---

## 9. 依赖与顺序

```
[删除今日的前置] 提取 rollupDot + LIVE_RANK 到共享模块
        │
        ├──→ 6.1① 工作台工作项按实时等级排序   ← 今日价值的真正替代
        ├──→ 6.1② 行内实时点
        └──→ 6.1③ 需要我 条件筛选片
                        │
[外壳] 历史 tab 模式切换 ──┬──→ 第 1 片 (C) 分组对象化
                          ├──→ 第 2 片 (B) 生命周期归档 ──→ 需 §4.4 的 toast action（若要做批量撤销）
                          └──→ 第 3 片 (A) 详情面
                                    └── A.1 会话史 + 当前 next/decision（可立即做）
                                        A.2 报告摘录（需按工作项查询 report_*）
                                        A.3 状态变迁日志（需新数据）
```

**并行建议**：`6.1 三件 + 删除今日` 与 `第 1 片 (C)` 无依赖，可并行；二者都完成后第 2 片才有意义（否则归档了也没地方看）。

**两个必须先落的前置**
1. `rollupDot` / `LIVE_RANK` 提取（否则删今日 = 丢能力）。
2. tab 改名拍板（否则第 2 片会做出"归档里的归档"）。

## 10. 对 PM 四问的 UI 立场

1. **归档的对象**：工作项。会话是被归档工作项的**明细**，仍保留时间轴与按工作项分组两根轴。
2. **状态还是视图**：两者都要，但要分开。**归档是状态**（决定它出现在哪个分区）；**工作项模式是视图**（决定你怎么看它）。
3. **时间轴要不要**：要，但 **tab 改名 `历史`**，把 `归档` 只留给状态。**不要拆成两个 tab**（4 个已是上限，模式切换比第五个 tab 更准确地表达了"同一根轴切换"）。
4. **自动建档**：**(a)**，附 §7 的两个前提（会话上的持久标记 + 本地化并改口吻）。
