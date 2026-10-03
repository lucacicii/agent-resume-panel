# Chat 头部 Changes 面板（单按钮收敛方案）— ADR

> 状态:**已实现**(v2 定稿;D3 已由用户拍板:头部只保留一个 `Changes` 按钮)。
> 实现:`apps/desktop/src/renderer-react/features/chat/`(`ChatChangesPopover` / `GitDiffPanel` / `FileFootprintList` / `useConversationChanges` / `useConversationCommit`)。
> 触发问题 v1:「可以也在 Files 中添加 diff 视图吗,然后在 diff 视图中添加 Git commit push,相当于只提交本次会话修改的文件?」
> 触发问题 v2:「头部只留一个 Changes 按钮」
> 关联实现:`apps/desktop/src/renderer-react/features/chat/`

## 0. 修订记录

| 版本 | 变更 |
| --- | --- |
| v1 | 首版:确认 diff/commit 能力**已存在**于 `GitDiffPopover`;提出"单弹层 + 两 tab,两个按钮共用弹层"的方案 A,列出 D1/D2/D3 三个待决项。 |
| **v2** | **D3 已决:头部只保留一个 `Changes` 按钮**(方案 A 的单按钮形态,记为 A′)。随之收敛:tab 状态从 ChatMain 移入弹层内部;头部徽标从"两个互相矛盾的数字"变为**唯一定义**;新增徽标取值规则(§5.4)与非 git 工作区回退;补全测试迁移清单(§11)。D1 仍推荐"默认全选";D2 因单按钮而退化为"徽标取什么值",已给出规则化答案。 |
| **已实现** | P0–P4 一次性落地:抽出 `FileFootprintList` / `GitDiffPanel`,新增 `ChatChangesPopover` 双 tab 宿主与 `useConversationChanges` / `useConversationCommit` 两个 hook;`ChatMain` 合并为单个 `Changes` 按钮;删除 `FileChangesPopover` / `GitDiffPopover` 及其测试,迁移到 `ChatChangesPopover.test.tsx` / `useConversationChanges.test.tsx`;新增 `desktop.chat.changes.*` i18n 键(en/zh-cn/ja)。 |

---

## 1. 摘要(先回答原始问题)

**你要的能力已经存在,只是不在 `Files` 按钮里。**

`apps/desktop/src/renderer-react/features/chat/GitDiffPopover.tsx`(639 行)已经实现:

| 你要的 | 现状 | 位置 |
| --- | --- | --- |
| diff 视图 | ✅ 逐文件手风琴 diff,带行号/增删色 | `GitDiffPopover.tsx:441-626` |
| Git commit | ✅ 按仓库分组逐仓 `git add -- <paths> && git commit` | `GitDiffPopover.tsx:246-294` |
| Git push | ✅ commit 后逐仓 `git push`(含首次 push 自动 `--set-upstream`) | `workbenchGit.ts:732-770` |
| **只提交本次会话修改的文件** | ✅ 提交范围 = 会话触及路径 ∩ 当前 git 脏文件 | `gitDiffUtils.ts:310-340` |

证据:`GitDiffPopover.tsx:630` 的底部说明原文是 *"Only commits files modified in this conversation. Other workspace modifications are preserved."*;`gitDiffUtils.ts:filterConversationDirtyFiles` 做 `touchedByRepo` 交集过滤;`GitDiffPopover.test.tsx:63-89` 断言了 `src/other-agent.ts`(非本会话文件)不出现。

所以真正的问题是:**Chat 头部有 `Trace` / `Files` / `Git Diff` 三个按钮,其中 `Files` 与 `Git Diff` 功能高度重合、提交入口重复**,而不是"缺功能"。本 ADR 把它们收敛成**一个 `Changes` 按钮**(v2 决定),内部两个 tab。

---

## 2. 现状架构(已逐文件核对)

### 2.1 两个弹层的数据源

```
fileChanges / messages / streamingTools   (React state, useTraceCollector 驱动)
        │
        ├──► Files 弹层       直接渲染 fileChanges(事件足迹)
        │
        └──► Git Diff 弹层    extractConversationTouchedPathsByRepo()
                              ∩ filterConversationDirtyFiles()  ← 与 git status 求交
```

| | `Files` (`FileChangesPopover.tsx`) | `Git Diff` (`GitDiffPopover.tsx`) |
| --- | --- | --- |
| 宽度 | 460px (`styles.css:17877`) | 660px (`styles.css:17881`) |
| 语义 | **会话事件足迹**:AI 说它改过什么 | **当前磁盘真实差异**:哪些还没提交 |
| 数据 | `ThunderFileChangeRecord[]` 原样 | 会话路径 ∩ `git status` 脏文件 |
| 已提交的文件 | 仍在(事件已发生) | 消失(已不脏) |
| 非 git / 仓库外文件 | 仍在 | 不出现 |
| 失败写入 | 在(`action: "failed"`) | 不出现 |
| 每文件信息 | action 徽标、tool、bytes、复制绝对路径 | A/M/D 徽标、diff、复制路径 |
| 提交能力 | 无 | 逐仓 commit + push |
| 行交互 | 无(纯列表) | `role="button"` 手风琴展开 + `Enter`/`Space` |

**关键不对齐**:`Files` 是 `Git Diff` 的**超集**(多出:失败写入、非 git 文件、已提交文件、仓库外路径),但在 `Git Diff` 里这些恰好**都没有 diff 可看**(已经 clean 或根本不在 git 里)。这是"合并成一个面板"最大的设计约束 —— 见 §5.3。

### 2.2 头部按钮与挂载(收敛前)

`ChatMain.tsx`:
- `:139-144` state:`isTraceOpen` / `isFilesOpen` / `isGitDiffOpen` / `conversationDirtyCount` / `nestedScan` / `workspaceDirs`
- `:414-438` Trace 按钮(`activity`)
- `:440-452` **Files 按钮**(`file-diff`,徽标 = `fileChanges.length`,title `View modified files`)
- `:454-465` **Git Diff 按钮**(`git-branch`,徽标 = `conversationDirtyCount`,title `View Git diff and commit conversation changes`)
- `:470-500` 三个弹层挂载点
- `:290-320` 一个独立 `useEffect`,自己调 `loadConversationGitFiles()` **只为算头部徽标数字**(与弹层内 `refresh()` 重复扫描)
- `:496` `onCommitSuccess={() => setConversationDirtyCount(0)}`

### 2.3 提交链路(IPC)

| 通道 | 签名 | 位置 |
| --- | --- | --- |
| `terminal:gitStatus` | `{cwd, nestedScan?}` → `GitStatusResult` | `preload.ts:1908` |
| `terminal:gitDiffSides` | `{cwd, path, staged?}` → `{oldText, newText, patch, …}` | `preload.ts:1912` |
| `terminal:gitSuggestCommit` | `{repoRoot, paths}` → `{message, source}` | `preload.ts:1920` / `workbenchGit.ts:662-665` |
| `terminal:gitCommit` | `{repoRoot, message, paths?}` → `{ok, skipped[]}` | `preload.ts:1921` / `workbenchGit.ts:667-730` |
| `terminal:gitPush` | `{repoRoot}` → `{ok}` | `preload.ts:1922` / `workbenchGit.ts:732-770` |

`terminal:gitCommit` 服务端语义(`workbenchGit.ts:667-730`),逐条都对"只提交本次会话文件"负责:

1. `paths` 为空 → 抛「请选择要提交的文件」
2. 仓库无任何改动 → 抛「当前仓库没有可提交的改动」
3. 不可提交子模块(gitlink 未变但工作区脏)→ 记入 `skipped` 并跳过
4. `previouslyStaged - selected` → **`git restore --staged`**(见 §8 风险 R2)
5. 存在的文件 → `git add --`;已删除的文件 → `git rm --cached --ignore-unmatch --`
6. `git commit -m <message>`
7. 返回 `{ok, skipped}`

---

## 3. 问题陈述

1. **重复的提交入口**:两个弹层若都加 commit,用户无法判断该信哪个徽标 / 哪个按钮。
2. **徽标数字会互相矛盾**:`Files` = `fileChanges.length`(含失败写入与已提交文件);`Git Diff` = 脏文件数。同一时刻两个数字不同,且都没解释为什么。
3. **重复 IPC 扫描**:`ChatMain:290-320` 为了徽标单独跑一遍 `loadConversationGitFiles()`,弹层打开时再跑一遍。
4. **多仓库部分失败不可见**(见 §8 R3)。
5. **无法逐文件选择提交**:`handleCommitAndPush` 固定提交 `conversationFiles` 全部。
6. **头部三个按钮、其中两个语义重叠**,用户需要先学会区别才敢点。

---

## 4. 候选方案

### 方案 A′(选定):单按钮 `Changes` + 双 tab 弹层

```
┌─────────────────────────────────────────────────────┐
│ ⑂ Changes   [2 files]   ⟳  ⌄⌃  ✕                    │
│ ┌─────────────┬──────────────┐                      │
│ │ Diff ● 2    │ Footprint 3  │  ← tab 条            │
│ └─────────────┴──────────────┘                      │
│ [message input                        ] [✨ AI]     │
│                        [Commit & Push (2) ▸]        │
│ ── 逐文件 diff(带复选框)────────────────────────── │
└─────────────────────────────────────────────────────┘
```

- 头部**只留一个** `Changes` 按钮(图标 `git-branch`,徽标规则见 §5.4)。
- `Trace` 按钮保持不变(完全不同的职责:执行链路 / 遥测)。
- 弹层内两个 tab:
  - **Diff**(默认,可提交):会话脏文件 + 逐文件 diff + 勾选 + commit/push
  - **Footprint**(只读):`fileChanges` 事件足迹原样,含失败写入、bytes、复制绝对路径
- 提交逻辑**只有一份**,只存在于 Diff tab。

### 方案 B(已否决):保留两个独立弹层,在 `Files` 里加 tab

字面满足 v1 原话,但会长期保留两套列表 UI + 两个矛盾徽标。v2 明确要单按钮,故否决。

### 方案 C(已否决):反向收敛,`Files` 退化为纯足迹

保留两个按钮与两个徽标;用户原话"在 Files 里加 diff"不被满足,且 v2 要求单按钮。

### 对比

| 维度 | A′(选定) | B | C |
| --- | --- | --- | --- |
| 消除重复提交入口 | ✅ 单按钮单弹层 | ❌ | ✅ |
| 徽标唯一 | ✅ 一个数字 | ❌ 两个数字 | ❌ |
| 头部按钮数(不含 Trace) | **1** | 2 | 2 |
| 满足"在 Files 里看 diff" | ✅(同一面板) | ✅ | ❌ |
| 改动面 | 中(抽 body + 新宿主 + 改 ChatMain + 改 3 个测试文件) | 小 | 小 |
| 学习成本 | 低(一个入口) | 中 | 中 |
| 非 git 文件无 diff 的呈现 | 需处理(§5.3) | 需处理 | 不需要 |

---

## 5. 决策(A′ 的细节)

### 5.1 组件边界

```
features/chat/
  ChatChangesPopover.tsx        ← 新宿主:头部 + tab 条 + 内容槽(唯一弹层)
  FileFootprintList.tsx         ← 从 FileChangesPopover 抽出的纯列表体(无弹层壳)
  GitDiffPanel.tsx              ← 从 GitDiffPopover 抽出的纯面板体(含 commit bar)
  useConversationChanges.ts     ← 单一数据源 hook(status + 会话文件 + 徽标数)
  useConversationCommit.ts      ← 提交状态机(选中集、message、phase、逐仓结果)
  gitDiffUtils.ts               ← 不变(纯函数,已有测试)
```

- `FileChangesPopover.tsx` / `GitDiffPopover.tsx` 在 **P0–P3 期间保留为兼容壳**(内部直接渲染新 body),使 `TracePopover.test.tsx:84-119` 与 `GitDiffPopover.test.tsx`(7 个用例)无需立刻重写;P4 删壳并迁移断言。
- 两者**不再**由 `ChatMain` 挂载(§5.2),只被测试引用。

### 5.2 头部与挂载(收敛后)

`ChatMain.tsx` 的改动:

```tsx
// 删除:isFilesOpen / isGitDiffOpen / conversationDirtyCount / 独立徽标 useEffect
const [isChangesOpen, setIsChangesOpen] = useState(false);
const changes = useConversationChanges({ workspaceDirs, workspaceDir, nestedScan, fileChanges, messages, streamingTools });
```

```tsx
{/* Trace Popover Trigger:不变 */}
<button ... className={`tb-header-action-btn${isTraceOpen ? " is-active" : ""}`} title="View execution trace and telemetry">
  <ThemeIcon name="activity" size={ICON_SIZE.dense} /><span>Trace</span>...
</button>

{/* 唯一的新按钮(替换原 Files + Git Diff 两个) */}
<button
  type="button"
  className={`tb-header-action-btn${isChangesOpen ? " is-active" : ""}`}
  onClick={() => setIsChangesOpen((open) => !open)}
  title={t("desktop.chat.changes.tooltip", "View files changed in this conversation")}
>
  <ThemeIcon name="git-branch" size={ICON_SIZE.dense} />
  <span>{t("desktop.chat.changes.label", "Changes")}</span>
  {changes.badgeCount > 0 && <span className="tb-header-badge">{changes.badgeCount}</span>}
</button>
```

弹层挂载变成一个:

```tsx
<ChatChangesPopover
  isOpen={isChangesOpen}
  onClose={() => setIsChangesOpen(false)}
  workspaceDir={workspaceDir}
  workspaceDirs={workspaceDirs}
  nestedScan={nestedScan}
  fileChanges={fileChanges}
  messages={messages}
  streamingTools={streamingTools}
  changes={changes}
  onCommitSuccess={() => { void changes.refresh(); }}
/>
```

要点:
- **tab 状态不再由 ChatMain 持有**(v1 方案 A 为了给两个按钮预选 tab 才需要受控)。tab 是弹层的内部状态,默认 `"diff"`。
- 徽标由 `useConversationChanges` 提供,`ChatMain` 不再自己调 `loadConversationGitFiles()`(修 §3 问题 2/3)。
- `onCommitSuccess` 不再手工 `setConversationDirtyCount(0)`(那是乐观归零,仓库若 push 失败或被过滤会显示失真);改为 `refresh()`,由数据源重算。
- 弹层未打开时 hook 仍需要产出徽标 → hook 内部的 status 扫描**在弹层关闭时也要跑一次**(与现状的独立 `useEffect` 等价,只是搬到 hook 里,且弹层打开复用同一份结果,不重复扫描)。

### 5.3 非 git / 已提交文件在 Diff tab 的呈现(必须明确)

Diff tab 的内容 = `loadConversationGitFiles().files`(会话 ∩ 脏)。Footprint 里那些**没有 diff 的条目**不能被静默丢弃,否则用户会以为"AI 没改这个文件"。规则:

- Diff tab 顶部一行汇总:`{n} file(s) with uncommitted changes · {m} touched file(s) have no pending diff`。
- `m > 0` 时,列表**底部**固定一个折叠区 `No pending diff (m)`,逐条给**原因标签**:
  - `committed` — 命中足迹但当前不脏(已被提交或改动被撤销)
  - `not-in-repo` — 路径不在任何 git 仓库内
  - `failed` — `action === "failed"`,写入失败
- 这些行**不可勾选**,不参与提交。
- 判定 `committed` 只需一次集合差:`touchedByRepo`(`gitDiffUtils.ts:230`,已导出)减去 `files` 的 `${repoRoot}\0${repoPath}` 键集,**无需新 IPC**。判定 `not-in-repo` / `failed` 用 `resolveRepoRelativePath()`(`gitDiffUtils.ts:194`)返回值与 `fc.action`。
- **自适应默认 tab**:若 `files.length === 0 && noDiffEntries.length > 0`,弹层打开时默认展示 `footprint` tab(此时 Diff tab 是空的,展示它会误导)。此规则只在弹层**首次打开**时生效,用户手动切过后不再强制。

### 5.4 头部徽标取值规则(单按钮后唯一定义点)

单按钮后不再有"两个数字互相矛盾"的问题,但**一个**数字必须无歧义。v1 的 D2 因此简化为一个规则问题。

```ts
// useConversationChanges 内部
const footprintCount = useMemo(() => distinctPaths(fileChanges), [fileChanges]); // 去重路径数,含 failed
const badgeCount = status?.isRepo ? files.length : footprintCount;
```

语义:
- **git 工作区** → `badgeCount = files.length`(本会话未提交文件数),与 Diff tab 的 `Commit & Push (N)` 完全一致,按钮上看到 2 就代表"能提交 2 个"。
- **非 git 工作区**(`status` 为 `null` / 非 repo)→ `badgeCount = footprintCount`(去重路径数)。此时 git 概念不成立,足迹数是唯一可用信号,总比不显示徽标好。
- 两种情况下数字的**权威解释都在 tab 条上**:`Diff ● 2` / `Footprint 3`,悬停 tab 显示完整说明。

> 附带收益:此规则让 `ChatView.test.tsx:238`(`.tb-header-badge` = `"1"`,该测试**未** mock `terminalGitStatus` → `status` 为 null → 走 footprint 分支)无需修改即可继续通过。见 §11。

---

## 6. 接口契约(实现者可直接照此编码)

### 6.1 `ChatChangesPopover`

```ts
export type ChatChangesTab = "diff" | "footprint";

export interface ChatChangesPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceDir: string;
  workspaceDirs?: string[];
  nestedScan?: GitNestedScanOptions;
  fileChanges?: ThunderFileChangeRecord[];
  messages?: ThunderChatMessage[];
  streamingTools?: ActiveToolInfo[];
  /** 单一数据源(徽标与面板同源)。 */
  changes: ConversationChanges;
  onCommitSuccess?: () => void;
}
```

- **无受控 `tab` prop**(v2 变更):tab 由弹层内部 `useState<ChatChangesTab>` 持有,默认值按 §5.3 的自适应规则在首次打开时算出。
- `isOpen === false` → 返回 `null`(与现有弹层一致)。
- 宽度 **660px**(取原 Git Diff 宽度;diff 需要横向空间),`max-width: 90vw`。
- tab 条:`role="tablist"` + `aria-label`,`role="tab"` + `aria-selected`,左右方向键切换,`role="tabpanel"` 用 `aria-labelledby` 关联。视觉可复用 `.sidebar-project-filter-segmented`(`styles.css:11467`)或新写 `.tb-changes-tabs`。
- **懒加载门控**:`activeTab !== "diff"` 时不得发起 `terminalGitDiffSides`;`isOpen === false` 时两者都不发。与现状 `useEffect(() => { if (isOpen) void refresh() }, [isOpen, refresh])`(`GitDiffPopover.tsx:161-165`)门控风格一致。
- 关闭按钮 / overlay 点击关闭 / 面板内点击 `stopPropagation` 均沿用现状(`GitDiffPopover.tsx:300-305`)。

### 6.2 `useConversationChanges`(单一数据源)

```ts
export interface ConversationChanges {
  status: GitStatusResult | null;
  repoRoots: string[];
  /** 会话触及 ∩ 脏 → 可展示 / 可提交 */
  files: ConversationGitFile[];
  /** 会话触及但当前无 diff 的条目(§5.3) */
  noDiffEntries: Array<{ key: string; path: string; reason: "committed" | "not-in-repo" | "failed" }>;
  /** 头部徽标数字,规则见 §5.4 */
  badgeCount: number;
  /** 足迹去重路径数(tab 标签用) */
  footprintCount: number;
  isLoading: boolean;
  error?: string;
  /** 弹层打开与提交成功后调用 */
  refresh: () => Promise<void>;
}
```

- 内部**一次** `loadConversationGitFiles()`;`ChatMain` 与弹层都从这一份读 → 数字不可能矛盾(修 §3 问题 2/3)。
- 依赖数组与现状一致:`[workspaceDirs, workspaceDir, nestedScan, fileChanges, messages, streamingTools]`。
- **取消/竞态**:沿用现状的 `cancelled` 标志模式(`ChatMain.tsx:291-296`);`refresh()` 与自动 effect 共用一把 in-flight 保护,避免弹层打开时与徽标 effect 并发双跑。
- 空 `workspaceDirs` → `files: []`、`noDiffEntries` 仍按足迹计算(footprint tab 有内容)、`badgeCount = footprintCount`。
- git status 抛错 → `status: null`、`error` 置为消息、`badgeCount = footprintCount`(**不**归零,否则非 git 环境徽标消失)。

### 6.3 `useConversationCommit`

```ts
export type CommitPhase = "idle" | "generating-message" | "committing" | "pushing" | "done";

export interface RepoCommitOutcome {
  repoRoot: string;
  paths: string[];
  committed: boolean;
  pushed: boolean;
  skipped?: string[];   // 服务端返回的不可提交子模块
  error?: string;       // 该仓失败原因,不阻断其他仓
}

export interface ConversationCommit {
  selected: Set<string>;                 // key = `${repoRoot}\0${repoPath}`
  isAllSelected: boolean;
  toggle: (key: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  message: string;
  setMessage: (value: string) => void;
  suggestMessage: () => Promise<void>;   // → terminalGitSuggestCommit
  phase: CommitPhase;
  isBusy: boolean;
  phaseLabel: string;                    // "Generating message..." / "Committing..." / "Pushing..."
  outcomes: RepoCommitOutcome[];
  error?: string;
  run: () => Promise<void>;
  retryPush: (repoRoot: string) => Promise<void>;
}
```

不变式(必须由该 hook 保证):

- **I1** `selected ⊆ conversationFiles`,两侧都用 key `${repoRoot}\0${repoPath}`。
- **I2** 只对 `selected` 非空的仓库调用 `terminal:gitCommit`。
- **I3** 选中集为空 → 提交按钮 `disabled`,理由文案「Select at least one file」。
- **I4** 提交进行中(任一仓在 commit/push)→ 按钮 `disabled`,防重入(现状靠 `isCommitting`,`GitDiffPopover.tsx:248,252`)。
- **I5** 提交成功 → `changes.refresh()` + `onCommitSuccess?.()`;徽标由数据源重算,**不**手工归零。
- **I6** files 列表刷新后,`selected` 必须与新 `files` 求交,剔除已消失的 key(否则会对已 clean 的文件发起 commit → 服务端报「没有可提交的改动」)。

错误语义:
- `terminalGitSuggestCommit` 抛错 → `phase: "idle"`,`error` 置为消息,**不清空**已输入 message。
- 某仓 commit 抛错 → 记入该仓 `outcome.error`,**继续下一仓**。
- push 抛错 → 该仓 `committed: true, pushed: false`,**继续下一仓**。
- 全部结束后 `changes.refresh()`;若全成功则清空 `message`。

### 6.4 逐仓库结果上报(修 §8 R3)

- 循环内每仓独立 `try/catch`;**不因仓 1 失败而跳过仓 2**。
- 结束后按结果渲染:
  - 全成功 → 绿字 `Committed and pushed N files across M repositories.`
  - 部分成功 → 黄字逐仓列出:`repo-a ✓ pushed` / `repo-b ✗ commit failed: <error>` / `repo-c ✓ committed, push failed: <error>`,并给失败仓一个**单独重试 push** 的按钮。
  - `commit 成功但 push 失败` 必须与 `commit 失败` 分开显示 —— 否则用户会重复 commit(产生空提交或报「没有可提交的改动」)。
- **保持现有文案格式** `Commit & Push (N)`,因为 `GitDiffPopover.test.tsx` 用 `screen.getByText("Commit & Push (1)")` 定位按钮(§11)。
- 多仓 message:现状用 `primaryRepo`(= 路径最多的仓,`GitDiffPopover.tsx:179-183`)生成一条 message 后所有仓复用(`GitDiffPopover.tsx:232-236,258-262`)。改为**每仓各生成一次**(`terminalGitSuggestCommit` 本就按 `paths` 生成);单仓行为不变。见 §8 R4。

### 6.5 选择控件(无障碍)

- 复用 workbench 视觉与语义:`role="checkbox"` + `aria-checked`,样式类 `.wb-git-check`,参考 `GitTreeCheckbox`(`GitChangesPanel.tsx:34-62`);分组级用 `gitGroupCheckboxState()` 求 `mixed`(`workbenchGitModel`)。
- 文件行现为 `role="button"` 手风琴头(`GitDiffPopover.tsx:492-504`),行点击 = 展开。复选框是**独立命中区**,点击必须 `event.stopPropagation()`,不能触发展开,也不能让展开触发勾选。
- 键盘:复选框 `Space` 切换;**不**用 `Enter`(`Enter` 留给展开,避免冲突)。

---

## 7. 分阶段落地

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **P0** | 纯重构:抽出 `FileFootprintList` / `GitDiffPanel`,`FileChangesPopover` / `GitDiffPopover` 变薄壳 | `TracePopover.test.tsx`、`GitDiffPopover.test.tsx`、`ChatMain.test.tsx` **全绿且未改** |
| **P1** | `useConversationChanges` + `ChatChangesPopover`(两 tab);ChatMain 删掉 Files/Git Diff 两个按钮与独立徽标 `useEffect`,换成单 `Changes` 按钮 | 徽标与 Diff tab 数量一致;新增「单按钮打开面板、默认 tab 正确、切 tab 不重复请求 status」用例 |
| **P2** | `useConversationCommit` + 逐文件/逐仓勾选 + 按钮显示 `Commit & Push (N)` | 「取消勾选 1 个 → 只提交剩余」用例断言 `terminalGitCommit` 收到正确 `paths` |
| **P3** | 逐仓结果上报 + push 重试 + §5.3 `No pending diff` 区 + §5.4 徽标规则 | 多仓部分失败用例:仓 2 push 抛错仍提交仓 3 |
| **P4** | 删除兼容壳,迁移/重写测试;文档更新 | 源码中除测试外无 `GitDiffPopover` / `FileChangesPopover` 引用 |

每阶段独立可发布。P0 无行为变化,先进主干降低后续 diff 噪声。**P1 是唯一的用户可见断点**(三个按钮变两个),应在 P0 合入后单独提交。

### 测试清单

- `useConversationChanges`:
  - `badgeCount === files.length`(git 工作区)
  - `badgeCount === footprintCount`(status null / 非 repo;含 `terminalGitStatus` 未 mock 的降级场景,§11)
  - 空 workspace → `files: []`,footprint tab 仍有内容
  - `noDiffEntries` 三类 reason 各一条(committed / not-in-repo / failed)
  - `refresh()` 并发调用只发一次 `terminalGitStatus`
- `useConversationCommit`:I1–I6 六个不变式各一条;`message` 为空时自动 `suggestMessage`;多仓顺序与逐仓 `error` 隔离;I6 剔除消失 key。
- `ChatChangesPopover`:tab 切换保留各自滚动位置;Diff tab 懒加载(未激活不发 `terminalGitDiffSides`);`files.length === 0 && noDiffEntries.length > 0` 时默认 footprint tab;`Escape` 关闭;overlay 点击关闭但面板内点击不关(沿用 `stopPropagation`)。
- `ChatMain`:头部**只有** `Trace` + `Changes` 两个 `.tb-header-action-btn`;点击 `Changes` 打开面板;徽标不因面板开合而变;`Trace` 独立开关互不干扰。
- 无障碍:`role=checkbox` 的 `aria-checked`;分组 `mixed`;键盘 `Space` 勾选不触发展开;tab 左右键切换。

---

## 8. 风险与已知缺口(实现时必须处理)

**R1 — 双 commit 入口(v1 方案 B 的风险)**:已由单弹层规避。

**R2 — 提交会取消手动暂存(真实副作用,必须在 UI 说明)**
`workbenchGit.ts:695-697,713-717` 计算 `toUnstage = previouslyStaged - selected` 并执行 `git restore --staged`。即:若用户在 workbench 手动 `git add` 了文件 X,而 X 不在本次会话勾选集里,那么在 Chat 面板点 Commit & Push **会把 X 取消暂存**。

- 这是有意的"提交范围 = 勾选集"语义,但对用户是意外副作用。
- 处理:提交栏旁固定一行说明「Unselected staged files will be unstaged.」;或在 Diff tab 里显式标出"已暂存但未勾选"的条目(`file.status` 已能区分 staged/unstaged)。
- **建议**:先加说明文案(P2),把"区分 staged 来源"留到后续迭代。

**R3 — 多仓库部分失败**(现状:循环里任一仓抛错即整体 `catch`,`GitDiffPopover.tsx:286-288`,已成功仓的结果丢失,用户只看到一条 error)。由 §6.4 修复。注意现状失败的连锁后果:仓 1 commit 成功、仓 2 commit 抛错后,点重试时仓 1 已 clean → 会被 `filterConversationDirtyFiles` 过滤掉,于是仓 1 不再出现在列表里(符合预期),但仓 2 的 push 若此前没执行也无人补 — 所以逐仓结果 + 单独重试按钮是必要的,不是可选的优化。

**R4 — 多仓库共用一条 commit message**:见 §6.4 末段。多仓时 message 可能不贴切。

**R5 — 已删除文件 vs 已删除目录**:服务端用 `fs.existsSync` 区分 `git add` / `git rm --cached`;未跟踪目录的尾斜杠问题在 **0.2.14** 修过(`apps/desktop/CHANGELOG.md:379` 版块,条目在 `:407`)。勾选改动不触碰这段逻辑,但回归测试要覆盖删除场景。

**R6 — 提交后 diff 缓存**:`fileDiffs` 以 key 缓存(`GitDiffPopover.tsx:70`)。提交后文件从列表消失,但同一 key 在下一轮若再次变脏会命中旧 diff。`refresh()` 需清掉不在新 `files` 里的 key(现状 `refresh` 只覆盖,不清理,`GitDiffPopover.tsx:134-155`)。

**R7 — 硬编码英文**:两弹层文案均为英文字面量(`FileChangesPopover.tsx:48,69,73,102,121`;`GitDiffPopover.tsx:311,370,446,461,633`)。新组件应走 `useI18n().t()`,至少把**新增**文案纳入 i18n:建议键 `desktop.chat.changes.label` / `.tooltip` / `.tabDiff` / `.tabFootprint` / `.commitPush` / `.emptyDiff` / `.noPendingDiff` / `.unstageWarning`,同步写入 `apps/desktop/locales/{en,zh-cn,ja}.json`。

**R8(新增,v2 特有)— 单按钮后"改了什么"的信息密度下降**:原来 `Files` 按钮一眼可见"AI 改了 3 个文件",现在若这 3 个文件恰好都已提交/非 git,`badgeCount` 会走 footprint 分支才显示。缓解:§5.3 的自适应默认 tab + §5.4 的徽标回退规则。**必须在实现 P1 时验证:`write_file` 成功但文件未变脏(内容相同)时,徽标不应从 1 闪成 0 再回 1。** 若出现闪烁,改为对 `badgeCount` 做"只增不减直到 refresh 完成"的展示缓冲。

**R9(新增,v2 特有)— `ChatMain` 的 `fileChanges` 仅来自 `useTraceCollector`**:会话回放(`loadTrace`)会重建 `fileChanges`(`useTraceCollector.ts:437-447`),所以 footprint tab 与徽标在回放会话中同样可用,不依赖活跃流。

---

## 9. 决策记录

**D1 — 提交范围默认值**(v1 遗留,仍待确认)

| 选项 | 说明 |
| --- | --- |
| **默认全选,可取消勾选(推荐)** | 一次点击即提交,贴合"只提交本次会话"原意;高级用户可精确剔除 |
| 维持现状:不可勾选,始终全提交 | 改动最小;个别文件不想提交时只能去 workbench |
| 默认全不选,显式勾选后才可提交 | 最安全、防误提交,但每次多一步 |

推荐"默认全选":徽标已明示数量,可预期;且默认全选时 P2 只需在 P1 基础上加选择状态,不改变主路径交互。

**D2 — 徽标含义**(单按钮后已规则化,见 §5.4)

不再是"两个数字谁对"的问题,而是"一个数字代表什么"。已定:`isRepo ? files.length : footprintCount` —— 按钮上的数字在 git 工作区**恒等于**可提交文件数,非 git 工作区退化为足迹数。tab 标签同时显示两个数,信息不丢失。

**D3 — 头部按钮数量** ✅ **已决(本 v2):只保留一个 `Changes` 按钮。**

- 头部最终形态:`[sparkles] 标题 … [Find*] [Trace] [Changes ③]`
- 删除:`Files` 按钮、`Git Diff` 按钮、`isFilesOpen`/`isGitDiffOpen`、`conversationDirtyCount` 状态及其独立 `useEffect`。
- 原 `Files` 的事件足迹能力**不丢失**,移入面板的 `Footprint` tab。
- 提交能力只在 `Diff` tab,面板外无第二个提交入口。

---

## 10. 结论

- **无需新增 diff/commit 能力**,`GitDiffPopover` + `workbenchGit.ts` 已完整覆盖"只提交本次会话修改的文件"。
- 要做的是**收敛重复**:头部单 `Changes` 按钮 → 单弹层双 tab → 单一数据源 hook → 单一提交状态机 → 逐仓结果上报。
- 推荐按 P0→P4 增量落地;P0 是无行为变化的纯重构,可独立合入;**P1 是用户可见断点**,单独提交。
- 剩余唯一待确认项是 §9 的 **D1(提交范围默认值)**,建议取"默认全选"。

---

## 11. 迁移清单(实现时的改动作业单)

### 源码

| 文件 | 动作 |
| --- | --- |
| `features/chat/ChatMain.tsx` | 删 2 按钮 + 2 state + 独立徽标 `useEffect` + 2 弹层挂载;加 1 按钮 + `useConversationChanges` + 1 弹层挂载;移除 `loadConversationGitFiles` 导入 |
| `features/chat/ChatChangesPopover.tsx` | 新增 |
| `features/chat/GitDiffPanel.tsx` / `FileFootprintList.tsx` | 从现有两组件抽出 body |
| `features/chat/useConversationChanges.ts` / `useConversationCommit.ts` | 新增 |
| `features/chat/FileChangesPopover.tsx` / `GitDiffPopover.tsx` | 变薄壳(P0)→ 删除(P4) |
| `renderer/styles.css` | 新增 `.tb-changes-popover`(沿用 `tb-git-diff-popover` 的 660px/90vw,`styles.css:17881`)、`.tb-changes-tabs`;`.tb-files-popover`(`styles.css:17877`,460px)与 `.tb-files-list`(`styles.css:18249` 起)在 P4 清理 |
| `apps/desktop/locales/{en,zh-cn,ja}.json` | 新增 `desktop.chat.changes.*` 键(§8 R7) |

### 测试(现有断言会因单按钮而失效,必须同步改)

| 文件:行 | 现状断言 | 需要的改动 | 时点 |
| --- | --- | --- | --- |
| `ChatMain.test.tsx:122-142` | `button[title="View Git diff and commit conversation changes"]` + 文案 `Git Diff` + `.tb-git-diff-popover` | 改为 `button[title$="changed in this conversation"]` + 文案 `Changes` + `.tb-changes-popover`;补一条"头部无 `Files` 按钮"的反向断言 | P1 |
| `ChatMain.test.tsx:144-196` | 用 `button[title="View Git diff and commit conversation changes"] .tb-header-badge` 读徽标 = `2` | 选择器换成 `Changes` 按钮;断言不变(仍为 2,该场景是有 git mock 的 git 工作区) | P1 |
| `ChatView.test.tsx:238` | `.tb-header-badge` = `"1"`(**未** mock `terminalGitStatus`) | **无需改动** —— 靠 §5.4 的 footprint 回退分支通过。若实现时选择"徽标只取 git 数",则此测试会破,需改为 mock `terminalGitStatus` 后断言 `"1"` | P1(验证点) |
| `TracePopover.test.tsx:84-119` | `FileChangesPopover` 渲染 `Modified Files` / `write_file` / `bash` | P0–P3 靠兼容壳不改;P4 迁移到 `FileFootprintList`(标题文案可能变,断言需同步) | P4 |
| `GitDiffPopover.test.tsx`(7 例) | `Git Diff` 标题、`Commit & Push (1)`、`2 files`、`pkg-a`/`pkg-b` 分组、`terminalGitCommit` 参数、`.tb-git-diff-popover` | P0–P3 靠兼容壳不改;**必须保留 `Commit & Push (N)` 与 `N file(s)` 文案格式**;P4 迁移到 `GitDiffPanel` | P4 |

**回归验证点(不可省)**:
1. git 工作区:`write_file` 一个文件 → 徽标 1 → 打开面板 → Diff tab 有该文件 → commit&push → 徽标归 0。
2. 非 git 工作区:`write_file` → 徽标仍显示 1(footprint 分支),面板默认 footprint tab,无报错。
3. 会话回放(`loadTrace` 路径):面板能重建足迹,footprint tab 有内容。
4. 多仓:一仓 commit 成功 + 另一仓 push 失败 → 两条结果分别显示,失败仓有"重试 push"按钮,重试不再触发 commit。
