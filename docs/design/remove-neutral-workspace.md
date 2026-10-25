# 移除任务中立工作区（共享工作区）— ADR

> 状态:**设计定稿,未实施**。
> 触发问题 v1:「共享工作区入侵性太强,如何用尽量少的概念实现类似功能?」
> 触发问题 v2:「中立工作区本身有没有存在的必要?agent 可以全局寻址,靠 AGENTS.md 路由说明 + note 按需引入是不是就够了?」
> 配套讨论中的三个拍板:零仓 cwd = home 兜底;worktree 功能砍掉;草稿概念砍掉。
> 实施依据:本文 §6 改动面清单与 §7 PR 拆分。

## 0. 修订记录

| 版本 | 变更 |
| --- | --- |
| v1 | 概念盘点(8 个概念)与三个候选方案(注入取代投影 / 单文件无标记 / 取消中立工作区)。 |
| v2 | 用户拍板走最彻底路线:彻底移除中立工作区。补齐 cwd 规则、草稿路由、worktree 砍除、迁移侦察(36 个存量目录)。 |
| **v3(本文)** | 补齐 workbench 文件/Git 面板的绑定退化、arpm 内容源、Thunder 沙箱根两个设计点;全仓改动面闭环;产出 PR 拆分。 |

---

## 1. 摘要

**中立工作区(`panelHome/.desktop/workspaces/<taskId>/`)整体移除。** 它解决的三件事——多仓任务的 cwd、跨仓发现、任务上下文分发——分别由更便宜的机制承接:会话落真实仓库(零仓 home 兜底)、启动注入事实性上下文(通道已存在)、note 作为唯一真相 + MCP 按需读。任务 = 笔记;上下文 = 注入 + 按需读;路由 = 用户全局 router 文件;会话活在真实仓库里。面板概念从 8 个降到 2 个(任务笔记、启动注入)。

## 2. 现状:概念清单与入侵面

为实现"多仓任务的会话有 cwd、知道仓库在哪、知道任务状态",当前叠加了 8 个概念:

| # | 概念 | 载体 |
| --- | --- | --- |
| 1 | 任务(工作项笔记) | note + work frontmatter |
| 2 | 中立工作区 | `panelHome/.desktop/workspaces/<taskId>/` |
| 3 | 地址表 | 渲染进 AGENTS.md 的文本 |
| 4 | 托管块 | `task-address` 标记 + 内容哈希 + upsert + 冲突回退(`taskWorkspace.ts`) |
| 5 | 双文件投影 | AGENTS.md + CLAUDE.md 同步维护 |
| 6 | 背景知识块 | note 的 `task-knowledge` 随托管块渲染 |
| 7 | `.arp/` 双重语义 | 仓库内 = committed config;工作区内 = `.arp/docs/` 长期文档 |
| 8 | 会话上下文注入 | 仓库内会话经 `sessionContextFile` 注入工作区 AGENTS.md |

入侵面判断:

1. **状态投影 ≠ 状态本身**:note frontmatter(status/next/decision)被快照成 AGENTS.md 文本,哈希/upsert/回退机制全是为养护这份投影。
2. **元叙事过重**:agent 要先理解"中立工作区不是 git 仓库"".arp 两义""worktree 约定",功能性信息只有三句。
3. **`.arp/` 一词两义**是纯概念税;且 agents 已把工作区 `.arp/` 当通用运行时目录(plugins/logs/vendor/qa 等野内容)。
4. 现状中中立工作区里的会话加载**零仓库上下文**(只有托管块);落在主仓库反而能吃到真实 AGENTS.md——严格更多。

## 3. 冻结决策

| # | 决策 |
| --- | --- |
| D1 | 移除中立工作区目录与 `taskWorkspace.ts` 整套机制(托管块、内容哈希、双文件生成、`sessionContextFile`)。 |
| D2 | 会话启动 cwd 规则:**激活目录 → 唯一挂载目录 → 主声明目录 → home**(零仓任务 home 兜底)。 |
| D3 | 任务上下文 = **启动注入一段事实性文字** + MCP `task_read`/`note_read` 按需读。注入通道复用 `sessionContextFlags`(codex `-c developer_instructions`;claude/pi/prime/omp `--append-system-prompt`);内容源从落盘文件改为**从 catalog 现场渲染**(renderer 启动与 `arpm run` 同一渲染函数)。note 是唯一真相,不再做文件投影。 |
| D4 | 草稿概念删除:长期内容进 note(`note_append`/`task-knowledge`),临时产物进 /tmp,注入文本带一句文档路由("不要在仓库里留草稿文件")。**panel 只注入事实,不再输出策略**(分支/PR 纪律等由用户写在自己 note 的 knowledge 里,随注入带出)。 |
| D5 | worktree 功能整体删除:`.worktrees` 约定、`worktreePolicyLines`、`worktreeGit.ts`、`worktrees.rootFor` per-pane checkout 选择器。 |
| D6 | workbench binding `null` 语义从"绑中立工作区"改为**"任务级:跟随挂载目录列表"**。侧栏(Explorer/Git/Search/Scripts)根 = 挂载目录列表,多根视图保留并升级为默认;零目录任务 = 空态 + "Add folder" CTA(Scripts 无 cwd 时禁用)。 |
| D7 | Thunder chat 沙箱:jail 根 = **主仓库**(零仓任务 = home),其余挂载目录为 extra roots(现有平权机制不变);Thunder 状态目录(`.thunder/`)跟 jail 根走。 |
| D8 | `.arp/` 回归单一含义(仅仓库内 committed config)。备份双向调整(include 与 restore `mergeTree`);迁移 36 个存量目录(含 `.arp/` 野内容);resume 对已删 cwd 做 home fallback。 |

静态项目路由(机器上有哪些项目、在哪)是**用户自维护的全局 router 文件**(`~/.agents/` 系);panel 可提供"生成建议"但不进入写入路径。这不是面板概念。

## 4. 终态设计

### 4.1 注入模板(事实性)

```
[Task] <title> (note: <abs path | noteId>)
Status: <status> · Next: <next> · Decision: <decision>
Repos: <label> → <path>; <label> → <path>; …
Working docs: durable → the task note (note_append); throwaway → /tmp. Do not leave scratch files in the repos.

<task-knowledge 内容,如有——用户策略也在这里>
```

### 4.2 保留的概念(2 个)

任务 = 笔记(work frontmatter);启动注入(一段事实性文字)。其余全砍:中立工作区目录、托管块机制、生成的 AGENTS.md/CLAUDE.md、地址表文件形态、`sessionContextFile`、worktree 功能、`.arp/docs/` 语义、草稿概念。

### 4.3 侧栏绑定退化

Explorer/Git/Search/Scripts 的锚**本来就不是工作区**,而是"任务挂载目录列表"(`WorkbenchPanel.tsx:1015-1050` 的 side roots 推导)。工作区只以三个特例存在,删除后各退化为更简单的规则:

| 特例 | 删除后 |
| --- | --- |
| Explorer 的工作区根("列出全部引用项目") | "任务未聚焦目录时显示全部挂载目录"从特例升级为默认行为 |
| 终端 workspace chip | 删除;cd 目标只剩真实目录 |
| workbench binding null = 中立工作区 | null = 任务级(跟随挂载目录列表) |

`worktrees.rootFor` 这层"repo → checkout 解析"随 D5 整体退化成纯路径列表。

## 5. 改动面清单(全仓核对过)

### main / core

- `apps/desktop/src/main/taskWorkspace.ts` — 整模块删除(含测试)。
- `apps/desktop/src/main/notesService.ts` — `notesEnsureTaskWorkspace`/`notesGetTaskWorkspaceContext`/`notesTaskSessionContext` 简化(去 dir/worktree 字段);`isPanelInternalPath` 过滤变死代码。
- `apps/desktop/src/main/worktreeGit.ts` — 删除;worktree 上下文(`worktreeContextForTask`)删除。
- `apps/desktop/src/main/thunder/thunderIpc.ts` — jail 根改主仓库/home(D7);`.thunder/` 状态锚点;gtdContext 去 worktreeLines。
- `packages/core/src/settings/arpmCli.ts` — `taskContextPath`(读工作区 AGENTS.md)改为从 catalog 现场渲染注入文本;`sessionContextFlags` 保留并升格为主通道。
- `packages/core/src/mcp/workbenchTools.ts` / `server.ts` / `catalog/taskWorkbenches.ts` — binding null 语义描述与存储层同步。
- `apps/desktop/src/main/backupService.ts` — include 项与 restore `mergeTree(.desktop/workspaces)` 双向删除;旧备份载荷容忍该目录消失。
- catalog meta 托管块内容哈希残留 — 顺手清理(无害)。
- resume:存量会话 cwd 指向已删目录 → spawn 前 fallback home。

### renderer

- `WorkbenchPanel.tsx` — `taskWorkspaceDir`/`sessionTarget` 工作区特判、workspace chip、composer `composerWorkspaceProjects`、Thunder 会话按工作区 dir 过滤、右键"打开任务工作区"、cwd 推导(`激活 → 唯一 → 主声明 → home`)、侧栏根退化、空态 + CTA。
- `workbenchModel.ts` / `TerminalComposer.tsx` / `ChatComposer.tsx` — 零散特判同步。
- `worktrees.rootFor` 及 per-pane checkout 选择器 — 删除。

### i18n / 文档

- 7 个 key:`sharedWorkspace`、`openTaskWorkspace`、`terminalCdSharedWorkspace`、`quickAccessCategoryWorkspace`、`terminalCdActionTitle` 相关等(en/zh-cn/ja)。
- `docs/desktop/workbench.md`、`mcp.md`、`settings-and-data.md`、`README`(桌面文档)同步。

### 确认不受影响

schedule 的 `workspaceDir`(独立概念,默认 home/当前项目,仅撞名);`ChatMain`/`gitDiffUtils` 的 `workspaceDirs`(workbench 文件夹列表);workspace mentions(全局包);`docs/desktop/sessions.md`、`resume-and-targets.md`(无引用)。

## 6. 迁移

侦察数据(2026-10-25):36 个目录,约 30 个纯空壳(仅生成的 AGENTS.md + CLAUDE.md)。

| 内容 | 处置 |
| --- | --- |
| 空壳目录 | 直接删除 |
| ~20 份任务文档(PLAN/KERNEL/TODO 等,集中在 6-7 个目录) | 人工审阅,收编进对应 note(`note_append`/task-knowledge)或移入仓库 |
| `cadbf9e6`(989 文件,主体 node_modules + worktrees) | 挽救几个 HTML 原型后整目录删除 |
| `.arp/` 野内容(plugins/logs/vendor/qa/thunder-benchmark/flowdown-prompts 等) | 逐目录判断,默认弃置;确有价值的挪进仓库或笔记 |

"在工作区里跑项目"(node_modules 类)场景今后由**挂载普通目录**承接(Add folder 本就支持非 git 目录)。

## 7. PR 拆分(每步可发布)

| PR | 内容 | 依据 |
| --- | --- | --- |
| 1 | 注入通道统一:注入模板 + 渲染函数(catalog → 文本);renderer 启动注入与 `arpm run` 切到新内容源;resume cwd fallback 一并加上 | D3 |
| 2 | cwd 规则 + workbench binding null 语义 + 侧栏根退化 + workspace chip/composer/Thunder 过滤特判删除 + 零目录空态 | D2/D6 |
| 3 | worktree 功能删除 + Thunder jail 根切换 | D5/D7 |
| 4 | `taskWorkspace.ts` 模块删除 + IPC + 备份双向 + catalog meta 清理 + i18n + MCP 描述 + 文档 | D1/D8 |
| 5 | 迁移:inventory 输出 + 收编流程 + 删除存量目录 | §6 |

## 8. 风险与边界

- **agent 习惯迁移**:“先写 PLAN.md 再执行”的肌肉记忆改为"更新 note",由注入文本的路由句引导;过渡期 agent 可能把草稿写进仓库 cwd——注入句明确禁止。
- **旧备份兼容**:恢复含 `.desktop/workspaces` 的载荷时静默忽略该目录。
- **arpm 离线渲染**:需读 catalog(`arpm` 已为任务查找读 catalog,无新增依赖)。
- **外部终端**手动 cd 进已删目录:属用户自理;面板只保证自己 spawn 的会话有 fallback。
