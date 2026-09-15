# 归档重构 · 待排期工单（既有缺陷，不阻塞 B1-B6）

角色：Architect · 状态：**T1–T5 已关闭；T6 已缓解（7/7 稳定），残留 act 警告待独立处理**
来源：[`desktop-archive-architect-rulings.md`](desktop-archive-architect-rulings.md) §1.3c 与 §2.2 的两处**非阻塞观察**，以及 A9 收尾时发现的文档漂移（T3）。
性质：**均为既有缺陷，不是本次归档重构引入的**。判定为不在 D/P/A/C 任何任务范围内，**不阻塞 B1-B6 任何批次**，不写入契约 §6。

> 归档重构期间只做一件事：**不要制造新的同类副本**。重构期间各单的修法一律暂缓，避免与 P1/P7/P8 抢同一批文件。T1–T5 已在 B6 之后按 Owner 判定关闭；T6 已缓解，残留项见文末。

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

## T3 · 用户文档与菜单地图仍有本次重构留下的漂移 —— **已关闭**

**类型**：文档漂移（重命名 / 删除功能后未同步）

**原证据**：`docs/desktop/agent.md` 通篇以 “Agent tab” 为入口（实际该 tab 已在 `93208c8d` 删除，能力转为 MCP 工具）；`im.md`/README 把 IM 写成独立入口；`.agents/menus/report-gtd.md` 指向已不存在的 `packages/core/src/memory/*` 与 `renderer/app.js`；`menus-index` 写 renderer 为 plain JavaScript。

**处置（已执行）**
- `docs/desktop/agent.md` 重写为 **Agent memory (MCP)**：说明应用内 Agent 页签已退役、能力现由 MCP `memory_retrieve` 提供，附三类引用（`[D#]`/`[N#]`/`[S#]`）到应用内位置的对照，并列出相关只读工具与「已移除功能的去向」。中英双语。
- `docs/desktop/mcp.md` 修正工具总数与分区：**27 → 28**，`Reports 3 → Reports and memory retrieval 4`（`memory_retrieve` 此前未列入），中英两侧同改，并补 `memory_retrieve` 行。
- `docs/desktop/im.md` 补上真实入口：**不是导航页签**，从 Workbench 打开并以嵌入方式渲染（中英同改）。
- `docs/desktop/README.md` 模块表：Agent 行改为 MCP 记忆检索、IM 行注明从 Workbench 打开、MCP 行补 “memory retrieval”（中英同改）。
- `.agents/menus/report-gtd.md` 重写为 **Memory, GTD, And Retrieval**：`memory/*` → `report/*`，删除 Ask meta-agent UI 叙述，改为 `agent/retrieve.ts` + `mcp/memoryTools.ts`，并补 digest 进度、note GTD、归档 UI 落点。
- 顺带修正同类的失效路径：`.agents/menus/{desktop,sessions,vscode-integration}.md` 与 `.agents/menus-index.md` 中不存在的 `renderer/vendor-entry/`、`build-renderer-vendor.mjs`、`renderer/app.js`、`package-vscode.json`、`scripts/merge-extension-manifest.mjs`。

**关闭验收（已实测）**
- 脚本抽取全部文档里出现的 `packages/… / apps/… / scripts/…` 路径并 `os.path.exists` 校验：**77 条路径，0 条缺失**。
- `grep -rn "app\.js\|core/src/memory\|features/agent\b\|AgentPanel" docs/desktop .agents/menus .agents/menus-index.md AGENTS.md` → 仅剩 3 处**刻意**声明「没有 Agent 页签」的句子。
- 文档中的 rail 名与 `AppChrome.tsx` 的 `tabs` 数组一致（`report` / `workbench` / `notes`）。

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

## T5 · 渲染层 CSS 无引用选择器 —— **已关闭（270 个安全类已删；76 个保守保留）**

**类型**：死样式（跨多个已退役功能）

**处置方法与判据（重要：不可照搬成"家族批量删"）**
1. 抽取 `styles.css` 中所有选择器位置的类名，与 `apps/desktop/src/**/*.{ts,tsx,html,js,mjs,cjs}` 全文比对，得到「无引用」集合（初测 **322 个**）。
2. **动态构造守卫**：解析所有 `` className={`…${…}…`} ``、三元/`&&`/`cn()`/字符串拼接里的字面片段，得到"动态片段"集合；凡类名以这些片段开头（如 `wb-git-graph-lane-`、`is-`）一律**不删**。
3. **状态类守卫**：后缀作为字符串字面量存在于源码中的 `is-*` / `has-*`（如 `is-inbox`、`is-next`、`is-someday`）一律不删 —— 它们由 `is-${status}` 拼出。
4. 以「**该选择器要求一个从不存在的类 ⇒ 永不匹配**」为删块/删部分的判据，但**整体跳过含 `:not(...)` / `:has(...)` 的部分**（`.live:not(.dead)` 仍会匹配 live 元素，删掉会掉样式）。
5. 全量断言：删后大括号平衡；每个被删块的选择器类名都在安全集合内；被删块内**不含**任何自定义属性定义（实测 0）；重复检测直到收敛。

**结果**
| | 数值 |
|---|---:|
| `styles.css` 行数 | **20299 → 17343** |
| 删除行数 | 3044 行（净） |
| 删除的安全类 | **270 个**（`insights-*` / `gtd-*` / `cal-*` / `ask-*` / `agent-*` / `chat-*` / `friction-*` / `wb-*` 等） |
| 保守保留 | **76 个**（命中动态片段或状态类守卫） |
| 顺带删除 | 3 个变空的 `@media` 外壳、若干已无归属的小节注释 |

**关闭验收（已实测）**
- `{` / `}` 平衡；无空规则块与空 `@media`。
- `pnpm run compile`、`pnpm run typecheck:desktop`、`pnpm run i18n:check`、`test:renderer`（113 文件 / 1085 用例）全绿。
- 逐项核对"丢失规则的活类"告警：全部为 `day`/`meta`/`loading` 这类短英文词造成的**子串误报**；被删选择器实例（如 `.cal-session-list[data-view="month"] .cal-session-group-title.day`、`.digest-list.search-results:not([hidden])`）经确认其必需类在 JSX 中从不出现。

**遗留（建议并入 T7 或下次 T5 续做）**
- 76 个保守保留项中大部分是**真死**（例如 `is-ok`、`is-peak` 仅因 `"ok"`/`"peak"` 恰好作为其它语义的字面量出现）。要清掉它们需要把守卫从"后缀是字面量"收紧为"后缀出现在 className 相关表达式里"，属判据改进而非删样式。

---

## T6 · renderer 测试套件存在间歇性失败（重负载 jsdom 用例） —— **已缓解（7/7 稳定）**

**类型**：测试基础设施（既有的不稳定，非归档重构引入）

**根因（实测，非猜测）**
- vitest 默认按 CPU 数并行（本机 10 逻辑核 / 4 性能核）。本套件里有若干**重负载文件**：`WorkbenchPanel.test.tsx`（139 用例、全量工作台 DOM）、`ReportPanel.test.tsx`（500 行时间线的分页用例）、以及跑真实 git / 文件系统的 `workbenchGit.test.ts`（约 18s）。
- 争用下有**两类**失败，都不是逻辑错误：
  1. `Error: Test timed out in 5000ms`（默认 `testTimeout`）；
  2. `Unable to find an element…` / `expected spy to have been called` —— 这是 `findBy*` / `waitFor` 的 **1s 等待窗口**被拖垮，与 `testTimeout` 无关。
- 失败用例每次都不同（`FloatingSessionNote`、`WorkbenchPanel > searches inside an Explorer folder`、`WorkbenchPanel > dismisses the branch popover`、`WorkbenchPanel > disables Replace All`），且**单独跑全过** —— 典型的争用抖动。

**处置（已执行，未使用 retry）**
1. `apps/desktop/vitest.config.ts`：`maxWorkers: 4`（对齐性能核数，消除重文件互相饿死）+ `testTimeout: 20000`（给真实 git/fs 用例留余量；真正的挂死仍会在 20s 失败）。附带注释说明原因。
2. 顺手削掉**自己写的那条 A8 用例**的无谓开销：它原本对 500 行 DOM 反复做 `getAllByText` 全量文本扫描，改为一次性取 `.report-timeline-title` 文本数组后断言包含关系。

**验证（实测）**
| 配置 | 结果 |
|---|---|
| 改动前基线 | 3 次中 1 次失败 |
| 仅 `--maxWorkers=4` | 3 次中 1 次失败（仍不够） |
| `maxWorkers: 4` + `testTimeout: 20000` | **7 次连续全绿**（1085 用例），单次 25–27s，比改动前的 27–31s **更快** |

**残留（本单未做，属独立工作）**
- 控制台仍有大量 `An update to X inside a test was not wrapped in act(...)` 警告，集中在 `WorkbenchPanel.test.tsx`。这是抖动倾向的**根**，收敛 fake timers 与补齐 `act()` 是根治手段。当前用「限并发 + 放宽超时」压住了症状，但**警告仍在**。
- 因此本单标记为**已缓解**而非已关闭：判据「控制台 act 警告清零」尚未达成。

**验收（剩余部分）**
- 消除 `WorkbenchPanel.test.tsx` 的 `act(...)` 警告（附前后数量对比）。
- 收敛后重测并发上限：若 `maxWorkers` 可调回默认而仍稳定，则一并放宽。

**Owner**：Developer · **阻塞性**：无（现状 7/7 稳定，验收命令可信）
