# Board 主窗口导航收敛（Rail 平价 + 统一工具栏槽）— ADR

> 状态:**待决**(路线 A 已由用户拍板;D1/D2/D3 待拍板,§6)。
> 触发问题:「现在 agent-resume-panel 的 UX 我觉得不太好,功能没有完全融合,你帮我想想怎么处理功能显示的更好。」
> 范围收敛(用户指定):**Board 主窗口(侧边栏 + 各视图)**;核心痛点是**割裂感**。
> 关联实现:`apps/desktop/src/renderer-react/components/AppSidebar.tsx`、
> `apps/desktop/src/renderer-react/components/AppChrome.tsx`、
> `apps/desktop/src/renderer-react/main.tsx`、`apps/desktop/src/renderer/styles.css`、
> `apps/desktop/src/main/main.ts`。

## 0. 修订记录

| 版本 | 变更 |
| --- | --- |
| v1 | 首版。诊断 Board 主窗口「割裂感」的 6 个具体证据(§2);给出三条候选路线 A/B/C 与对比(§4);**路线 A 已由用户拍板**;`archive` / `sessions` **两个隐形视图已定:都进 rail**。列出 D1/D2/D3 三个待决项(§6)。本版**只交设计文档,不改代码**(§8)。 |
| — | 待决项拍板后,补「决策细节 + 实施步骤 + 测试迁移清单」,状态改为**已实现**。 |

---

## 1. 摘要

Board 主窗口是「GTD-first」定位下的多视图容器:一个全高 rail(`AppSidebar`)加一个内容区,内容区按
`data-board-view` 显示 6 个视图之一(`main.tsx:299-308`)。

问题不是「缺功能」,而是**同一类能力被拆在互不一致的位置**,用户的手不知道该去哪 —— 也就是用户说的
**割裂感**。最刺眼的一条:**`BoardView` 有 6 个成员,rail 只渲染 4 个**(`AppSidebar.tsx:10` vs `:33-38`),
`archive` / `sessions` 存在却没有任何 rail 入口,只能靠命令面板(§2 E1)。

本 ADR 采纳**路线 A:Rail 平价 + 统一工具栏槽** —— 不改信息架构、不删视图,只做两件事:

1. **Rail 平价**:6 个视图全部进 rail,`archive` / `sessions` 归位(用户已拍板)。
2. **统一工具栏槽**:所有视图的「搜索 + 主操作」统一 portal 进共享的 `#app-header-slot`
   (`AppChrome.tsx:65`),不再各自散落在内容区/左列表里(§2 E2)。

A 是**止血层**:低风险、可回滚,先让「入口对称、工具条有家」。真正的结构融合(Work/Reference 分层、
Archive 融入 GTD、Sessions 统一会话面)是后续路线 B,不在本 ADR 范围。

---

## 2. 诊断:割裂感的 6 个证据(已逐文件核对)

### E1. `BoardView` union 与 rail 渲染项不一致 —— 两个视图「存在但不可见」

| 项 | 位置 |
| --- | --- |
| 类型 6 个成员 | `AppSidebar.tsx:10` — `"gtd" \| "notes" \| "schedule" \| "chat" \| "archive" \| "sessions"` |
| rail 只渲染 4 个 | `AppSidebar.tsx:33-38` — 仅 `gtd` / `notes` / `schedule` / `chat` |
| `archive` / `sessions` 的进入方式 | `BoardQuickAccess.tsx:50-61` — 只有 `view.archive` / `view.sessions` 两条命令 |

**后果**:可以落在一个 **rail 上没有任何高亮项**的界面(用 View 菜单 ⌘3/⌘4 或命令面板进入 archive/sessions
后,rail 四行全部 `aria-current` 为空);返回也只能再开一次命令面板。这是割裂感最直接的来源。

> 根因是**演进时序**:rail 是后来才回归的(`fbfa1998 feat(desktop): add the board nav sidebar and a Notes view`),
> 而 `archive` / `sessions` 加得更早(`46726a16`)。它们加进来时没有 rail,后来 rail 回来也没被收编,
> 于是长期停在「能用、但没入口」的状态。

### E2. 工具栏没有家 —— 同一个「搜索 + 主操作」在四个位置

| 视图 | 工具栏位置 | 证据 |
| --- | --- | --- |
| GTD | **窗口顶栏** portal 进 `#app-header-slot` | `GtdView.tsx:477-502`(`gtd-toolbar` / `gtd-search` / `gtd-new-btn`) |
| Sessions | **内容区**自带 toolbar | `SessionsView.tsx:269-290`(`sessions-view-toolbar`) |
| Archive | **内容区**自带 toolbar | `ArchiveView.tsx:110-118`(`archive-view-toolbar`) |
| Notes | 列表内部 | `NotesView.tsx:171-176`(`notes-view-search`) |
| Schedule | 列表内部 | `ScheduleView.tsx:160-165`(`schedule-view-search`) |

**后果**:窗口顶栏已存在专门的「per-view 工具栏宿主」`#app-header-slot`(`AppChrome.tsx:65`;
样式 `.mac-top #app-header-slot`,`styles.css:770-794`),且 **GTD 与 Workbench 已经在用它**
(`GtdView.tsx:477`、`WorkbenchPanel.tsx:6070`,后者把 `wb-detail-head` portal 进去)。
也就是说「统一工具栏槽」这个机制**已经存在、已验证**,只是 4 个视图没接。这是本 ADR 能低风险落地的关键前提。

### E3. 心智模型反复横跳 —— 注释与代码互相打架

`AppChrome.tsx:9-14` 的组件注释原文:

> *"The app is GTD-first: **there is no primary-tab rail anymore.**"*

但 rail 现在就在渲染(`AppSidebar` 已挂载,`main.tsx:297`)。**注释描述的是一个已不存在的范式**。
演进轨迹:主 tab rail → (注释所述)去 rail 的 GTD 单视图 → 侧边栏 rail 回归。
本次改动必须**同时修正这段注释**,否则下一个读者会继续被误导。

### E4. 一个词(view)指五种结构

| 视图 | 结构 | Board 角色 |
| --- | --- | --- |
| GTD | 看板(列 + 拖拽) | editor + launcher |
| Notes | 列表 + 编辑器 | editor |
| Schedule | 列表 + 详情 | editor |
| Chat | 列表 + 对话 | editor |
| Archive | 扁平列表 | launcher(点开跳窗口) |
| Sessions | 扁平列表 | launcher(点开跳窗口) |

它们被当作「平级的 6 个 view」呈现,但结构、职责、(是否自拥工具栏)都不同。
**本 ADR 不解决这条**(属路线 B),仅记录:rail 平价后,6 行视觉上会更平等,反而**放大**这个不一致 ——
这也是为什么 A 之后需要 B(§9)。

### E5. Board 与 Workbench 的边界没有被表达

Board 不承载 workbench;点 GTD 卡片 / 会话都要**开新窗口**(`taskWindows.ts`,见
`.agents/menus/desktop.md` 约束:「a workbench exists in exactly one window」)。
所以 Board 一半是 **launcher**(GTD/Sessions/Archive 主要「点了跳走」),一半是 **editor**(Notes/Schedule/Chat 真在编辑),
但 UI 上两者长得一样。

### E6. i18n key 与目录源不同步

| key | 在 `locales/en.json` | 在 `scripts/desktop-i18n-catalog.json` |
| --- | --- | --- |
| `desktop.nav.schedule` | ✅(`Schedule` / `计划` / `スケジュール`) | ❌ |
| `desktop.nav.chat` | ✅(`Chat` / `AI 对话` / `チャット`) | ❌ |
| `desktop.nav.archive` | ❌ | ❌ |
| `desktop.nav.sessions` | ❌ | ❌ |

catalog 里只有 `nav.label/gtd/notes/collapse/expand`。两个视图名在 locale 文件里是**手写**的(未走目录源),
另两个根本没有 nav 名。**这是 E1 的下游后果**:没进 rail 的视图,连 nav 文案都没被正经登记。
按 `.agents/menus/desktop.md`,desktop 文案必须先改 `scripts/desktop-i18n-catalog.json` 再 `merge:desktop-i18n` ——
所以补 `archive`/`sessions` 的 nav 名时,**必须把 4 个 nav key 一起补进 catalog**,顺手修好 E6。

---

## 3. 现状架构(已逐文件核对)

```
Board 窗口(main.tsx, window mode = "main")
├─ <AppSidebar>        AppChrome 之前;portal 到 #react-nav           :293
│    items = [gtd, notes, schedule, chat]        ← 只有 4 个          :33-38
│    BoardView = 6 个成员                                              :10
├─ <AppChrome>         header;内含 #app-header-slot                    :65
│    ├─ sidebar toggle                                                :54-63
│    └─ #app-header-slot  ← GTD / Workbench 在此 portal 工具栏        :770-794(css)
├─ 视图(按 data-board-view 显示一个)
│    GtdView        toolbar → #app-header-slot                        :477
│    NotesView      toolbar 在左列表内                                :171
│    ScheduleView   toolbar 在左列表内                                :160
│    ChatView       (侧栏 + 主区)
│    ArchiveView    toolbar 在内容区                                  :110
│    SessionsView   toolbar 在内容区                                  :269
└─ <BoardQuickAccess>  命令面板;archive/sessions 的唯一可见入口       :50-61
```

**Board 视图的四种进入路径**(收敛后应全部对齐):

| 路径 | 覆盖 | 证据 |
| --- | --- | --- |
| rail 点击 | gtd / notes / schedule / chat | `AppSidebar.tsx:33-38` |
| View 菜单(⌘1–⌘4) | gtd / notes / archive / sessions | `main.ts:1932-1957` |
| 命令面板 | gtd / notes / archive / sessions | `BoardQuickAccess.tsx:36-61` |
| `nav:show` IPC | 由 `showBoardView` 触发 | `main.ts:987-997` |

**收敛目标**:四条路径覆盖的视图集合**完全一致**(都 = 6)。

---

## 4. 候选方案

### 路线 A(选定):Rail 平价 + 统一工具栏槽

- 6 个视图全部进 rail。
- 所有视图的「搜索 + 主操作」portal 进 `#app-header-slot`。
- 不动信息架构、不删视图、不改数据投影。

### 路线 B(后续):Board 分两层 —— Work / Reference

- rail 分两组:Work(GTD / Notes / Schedule / Chat)、Reference(Archive / Sessions)。
- `Archive` 降级为 GTD 的一个 facet(「Done / 已归档」过滤视图),不单独占 rail 行。
- `Sessions` 与 Chat 的左侧会话列表合并为**统一会话面**。
- 解掉 E1/E2/E4/E5 —— 真正的「功能融合」。

### 路线 C(已否决):命令优先的极简 Board

- Board 只留 GTD + Notes,其余降级为命令 / 弹层。
- **否决理由**:把「割裂」换成了「找不到」。与 `.agents/extended/ui-policy.md` 的 macOS HIG 要求
  (快捷键必须在菜单栏可发现、控件要有可见 affordance)和发现性原则相悖。

### 对比

| 维度 | A(选定) | B(后续) | C(否决) |
| --- | --- | --- | --- |
| 消除 E1(入口不对称) | ✅ | ✅ | ⚠️ 换成为找不到 |
| 消除 E2(工具栏无家) | ✅ | ✅ | ✅ |
| 消除 E4/E5(结构/边界不一致) | ❌ | ✅ | ⚠️ |
| 改动面 | 小(AppSidebar + 4 视图 toolbar + i18n) | 中(动 IA 与数据投影) | 大(删视图 + 改路由) |
| 可回滚 | ✅ 高 | 中 | 低 |
| 契合仓库理念(增量分层) | ✅ | ✅ | ❌ |
| 风险 | 低 | 中 | 高 |

**结论**:A 当第一层(立即止血、低风险),B 当第二层(真正融合)。C 不做。

---

## 5. 决策(路线 A 的细节)

### 5.1 Rail 平价

`AppSidebar.tsx:33-38` 的 `items` 扩到 6 行,`archive` / `sessions` 补位:

| 顺序 | view | icon(`ThemeIconName`) | label key |
| --- | --- | --- | --- |
| 1 | `gtd` | `square-kanban` | `desktop.nav.gtd` |
| 2 | `notes` | `notebook` | `desktop.nav.notes` |
| 3 | `schedule` | `clock` | `desktop.nav.schedule` |
| 4 | `chat` | `message-square` | `desktop.nav.chat` |
| 5 | `archive` | `archive` | `desktop.nav.archive` |
| 6 | `sessions` | `history` | `desktop.nav.sessions` |

- **顺序待 D1 拍板**(§6)。
- `BoardView` union **不变**(本就 6 个)。
- icon 需在 `ThemeIcon` 的 name 契约内(`themeIconContract.test.ts` 会校验);`archive` / `history`
  均在现用集合内(`ArchiveView` / `SessionsView` 已用过 `archive` 与 `history`,见 `GtdView.tsx:555`、`SessionsView.tsx:392`)。
- **不改 `main.ts` 的 View 菜单**:⌘1–⌘4 仍只挂 4 个视图。若要补 ⌘5/⌘6 见 D2。

### 5.2 统一工具栏槽

把「搜索 + 主操作」抽成各视图的一个 toolbar 节点,`createPortal` 进 `#app-header-slot`,
与 GTD 现有做法一致(`GtdView.tsx:477-502`;条件 `active && headerSlot`)。

| 视图 | 现状 → 目标 | 迁移要点 |
| --- | --- | --- |
| GTD | 已在 header slot | **不动**(基准实现) |
| Sessions | `SessionsView.tsx:269-290` 内容区 → header slot | 搜索框 + age select 上移;`filters`(chips)可留在内容区 |
| Archive | `ArchiveView.tsx:110-118` 内容区 → header slot | 搜索框上移;count 可留内容区 |
| Notes | `NotesView.tsx:171-176` 左列表内 → header slot | **需评估**:列表内搜索是否更贴列表;见 D3 |
| Schedule | `ScheduleView.tsx:160-165` 左列表内 → header slot | 同上,见 D3 |

- 样式:`#app-header-slot` 已声明 `flex: 1 1 auto; display: flex; align-items: center; gap: var(--space-2)`
  (`styles.css:770-778`),其直接子 `.toolbar` / `.wb-detail-head` 已被 reset(`:779-788`)。
  新迁入的 toolbar 根节点**统一使用 `className="toolbar"`**(或补一条同款 reset),避免各自再写一套顶栏样式。
- **受影响的练习项**:`AppSidebar.test.tsx` 的 `messages` fixture 需补 `nav.archive` / `nav.sessions`(§7)。

### 5.3 进入路径对齐

收敛后四条路径覆盖同一集合 {6}:

| 路径 | 收敛后 |
| --- | --- |
| rail | 6 行全覆盖(5.1) |
| View 菜单 | 现状 4 个;⌘5/⌘6 见 D2 |
| 命令面板 | 现状已是 4 个(gtd/notes/archive/sessions);**需补 schedule/chat 两条命令**,否则不齐 |
| `nav:show` IPC | 覆盖 `showBoardView` 接受的集合 |

> 注:`BoardQuickAccess.tsx:36-61` 当前有 4 条 `view.*` 命令,但**没有** `view.schedule` / `view.chat`,
> 而 rail 有 schedule/chat —— 两条进入路径**互补但不重合**。这是 E1 的另一种表现,一并修。

### 5.4 i18n(必须先改 catalog)

按 `.agents/menus/desktop.md`:desktop 文案**先改 `scripts/desktop-i18n-catalog.json`,再 `pnpm run merge:desktop-i18n`**。

需补 4 个 nav key × 3 语言(en / zh-cn / ja):

| key | en | zh-cn | ja |
| --- | --- | --- | --- |
| `desktop.nav.schedule` | Schedule | 计划 | スケジュール |
| `desktop.nav.chat` | Chat | AI 对话 | チャット |
| `desktop.nav.archive` | Archive | 归档 | アーカイブ |
| `desktop.nav.sessions` | Sessions | 会话 | セッション |

(`schedule` / `chat` 的译文取 `locales/*.json` 现值;`archive` / `sessions` 取各自
`desktop.archive.title` / `desktop.sessions.title` 的现值,保持与视图标题一致。)

### 5.5 组件边界

```
components/
  AppSidebar.tsx        items 扩到 6;BoardView 不变
  AppChrome.tsx         #app-header-slot 不变;修正 :9-14 的过时注释(E3)
main.tsx                view 渲染:6 个视图的挂载与事件白名单(main.tsx:277)保持对齐
features/
  gtd/GtdView.tsx       基准,不动
  sessions/SessionsView.tsx   toolbar → header slot
  archive/ArchiveView.tsx     toolbar → header slot
  notes/NotesView.tsx         视 D3
  schedule/ScheduleView.tsx   视 D3
```

---

## 6. 待决项(需拍板)

### D1. rail 的排列顺序?

- **选项 1(推荐)**:`GTD · Notes · Schedule · Chat · Archive · Sessions`
  —— 前 4 个是**既有 rail 顺序**(零位移),`archive`(GTD 的下游产物)紧跟 `chat` 后,`sessions` 收尾。
- 选项 2:`GTD · Archive · …`(把 archive 贴到 GTD 旁,强调同源)。
- 选项 3:按使用频率排序(需你给频率依据)。

> 推荐 1:对既有用户**零位移**,只在尾部追加两行,回归成本最低。

### D2. View 菜单是否补 ⌘5/⌘6?

菜单项文案(`desktop.menu.showGtdBoard` 等)已在,但**没有** `desktop.menu.showSchedule` / `showChat`。

- **选项 1(推荐)**:补 ⌘5 = Schedule、⌘6 = Chat,顺带补两个菜单文案 key。菜单栏覆盖全部 6 视图。
- 选项 2:菜单保持 4 项,只在 rail + 命令面板覆盖 6 个。
- **倾向 1**:`.agents/extended/ui-policy.md` 明确「every keyboard shortcut the renderer implements must also be
  registered as a menu item accelerator」—— 视图切换应可在菜单栏发现。

### D3. Notes / Schedule 的搜索框是否也上移?

它们的搜索在**左列表内部**(`NotesView.tsx:171`、`ScheduleView.tsx:160`),上移会拉远与列表的视觉关联。

- 选项 1(推荐):**只迁 Sessions / Archive**(它们在内容区,基线本就不一致);
  Notes / Schedule 的搜索**就近列表**,属合理的局部设计。
- 选项 2:全部 6 个统一进 header slot,绝对一致但 Notes/Schedule 体验可能下降。

> 推荐 1:**统一的是「工具的归属规则」,不是「所有工具都必须同款位置」**。内容区视图的工具上顶栏,
> 列表内搜索保留在列表 —— 规则一致即可消解割裂感。

---

## 7. 测试迁移清单(A 落地时)

| 测试 | 现状 | 影响 |
| --- | --- | --- |
| `components/AppSidebar.test.tsx` | `messages` fixture 只含 gtd/notes/schedule | **必改**:补 `nav.archive` / `nav.sessions`;「renders the navigation views」断言补两行 |
| `features/gtd/BoardQuickAccess.test.tsx` | 覆盖命令面板 | 若 D2/§5.3 补 schedule/chat 命令,断言同步 |
| `GtdView` / `WorkbenchPanel` header-slot | 已在 header slot | 无(基准) |
| `SessionsView.test.tsx` / `ArchiveView` | 若 `ArchiveView` 无独立测试,以 `pnpm run test:renderer` 覆盖 | toolbar portal 后 DOM 落点变化,查询需按 header slot 调整 |
| `main.ts` 菜单 | `desktopShortcuts.test.ts` 不测 `showBoardView` | 若 D2 补 ⌘5/⌘6,补一条菜单项断言 |

**回归验证点(不可省)**:

1. 六个视图逐一进入 → rail 对应行 `aria-current="page"`,**无视图落在 rail 无高亮的状态**(E1 回归点)。
2. View 菜单 ⌘1–⌘4(或 ⌘1–⌘6,视 D2)→ 与 rail 高亮一致。
3. 命令面板 → 与 rail / 菜单覆盖集合一致。
4. 内容区视图(Sessions/Archive)搜索框出现在窗口顶栏,且**不与 GTD 的 toolbar 同时出现**。
5. 折叠 rail 后,6 行图标仍可点击,`aria-label` / `title` 双语正确。
6. 语言切换(en/zh-cn/ja)→ 6 个 nav 名全部正确,无 key 回退。

---

## 8. 本轮范围

**只交本文档,不改代码。** 待 D1/D2/D3 拍板后,补 §5 的实现步骤并进入编码。

预期代码改动面(供后续排期,非本轮):

| 文件 | 改动 |
| --- | --- |
| `AppSidebar.tsx` | `items` 扩到 6 |
| `AppChrome.tsx` | 修正过时注释(E3) |
| `SessionsView.tsx` / `ArchiveView.tsx` | toolbar → `#app-header-slot` |
| `NotesView.tsx` / `ScheduleView.tsx` | 视 D3 |
| `BoardQuickAccess.tsx` | 补 schedule/chat 命令(§5.3) |
| `scripts/desktop-i18n-catalog.json` | 补 4 nav key × 3 语言 |
| `main.ts` | 视 D2 补菜单项 |
| `styles.css` | 新迁 toolbar 的 reset(若复用 `.toolbar` 类则无需) |

---

## 9. 后续:路线 B 的边界

A 是止血,B 才是真正的「功能融合」。B 要解决 A 无法解决的 E4/E5:

- **Archive → GTD 的 facet**:`ArchiveView` 本质是「`archivedAtMs != null` 的 task 列表」
  (`ArchiveView.tsx:54`),与 GTD 同源。合并后可省掉一个 rail 行。
- **Sessions → 统一会话面**:Board 的 `SessionsView`(全量目录、分页、过滤)与
  Chat 的左列表、Workbench 的左列表,三者都在列会话,是三条独立的会话列表 UI。
- **Work / Reference 分层**:rail 分组表达「哪些是工作台入口、哪些是参考」。

B 的实现路径与取舍另开 ADR,不在本文件展开。
