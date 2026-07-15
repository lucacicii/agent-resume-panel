# Mac 端 Agent Session OS + Memory 系统

> 产品 / 架构讨论结论（the product owner × 助手）  
> 性质：愿景与决策文档，**非实现规格**。  
> 相关现状：本仓库 VS Code 扩展 **Agent Resume Panel**（local-first 多 CLI 会话管理）。

---

## 1. 背景与动机

### 1.1 现状（扩展已具备）

| 能力 | 现状 |
|------|------|
| 多 CLI 会话统一浏览 | Codex / Claude / AGY / Grok / OpenCode / Pi / Alma |
| 索引库 | `~/.agent-resume-panel/catalog.db`（sessions、GTD、notes 索引、summary 等） |
| 对话全文 | 仍在各 Agent **原生存储**（如 `~/.codex`、`~/.claude`） |
| 单次摘要 | LLM Assist → `session_summary`（按需、单 session） |
| 跨 Agent 交接 | Handoff Brief |
| 编辑器内对话 | ACP Chat（协议层挂第三方 agent） |
| 笔记 / GTD | 本机 Markdown + catalog 索引 |

### 1.2 痛点

1. **工作环境不止编辑器** — 希望有不绑 VS Code 的 **Mac 原生 App**。
2. **记忆是一次性的** — 仅有单 session 摘要，没有日 / 周 / 月沉淀，难形成跨 session、跨项目的长期记忆。
3. **执行面碎片化** — 真正干活的是第三方 CLI；会话散落各家目录；缺「总控台 + 懂你历史的 agent」。
4. **核心问题** — 是否要自研一个带页面的 Agent，统一管理第三方产生的 session？

### 1.3 一句话共识

> **要做的不是再造一个 coding CLI，而是做一个「Session OS」：统一索引与管理第三方 session，并在其上挂 Memory 系统与 Meta-Agent；执行仍可委托给现有第三方 CLI / ACP。**

---

## 2. 产品定位

### 2.1 分层架构

```text
┌─────────────────────────────────────────────────────────┐
│  Electron App UI（总控台 / Memory 看板 / 对话入口）          │
├─────────────────────────────────────────────────────────┤
│  Meta-Agent（记忆检索、任务路由、定期分析、问答）            │
├─────────────────────────────────────────────────────────┤
│  Session Catalog + Memory Store（SQLite + 分层记忆）       │
├─────────────────────────────────────────────────────────┤
│  Adapters：同步各 CLI 原生 session / resume / 可选 ACP     │
└─────────────────────────────────────────────────────────┘
         │ resume / handoff / spawn
         ▼
   Codex · Claude · Grok · OpenCode · Pi · Alma · …
```

### 2.2 是否需要「自己的 Agent」？

| 方案 | 含义 | 结论 |
|------|------|------|
| A. 只做管理 UI + DB | 浏览 / 搜索 / 恢复，无智能 | 不够：Memory 需要主动分析与问答 |
| B. **自有 Meta-Agent + 页面** | 自有对话与调度层；**不替代**第三方写代码 | **要做（推荐）** |
| C. 自研完整 coding agent | 自己实现工具调用、改文件、终端 | **现阶段不做**；成本高且与现有 CLI 重复 |

**方案 B 的分工：**

- **自己的 Agent** = **记忆与编排层**（Memory + Router + 定期分析），带 **Mac 页面** 做统一管理与对话。
- **第三方 CLI** = **执行层**（真正改代码、跑命令）。
- 页面统一管理的是：**索引、摘要、记忆、GTD、笔记、跨工具 handoff、启动 / 恢复命令** —— 不是把各家 transcript 强行吞进一个假的「唯一会话」。

### 2.3 与现有 VS Code 扩展的关系

- **复用**：`catalog.db` 模型、history adapters、transcript 预览、summary / handoff 思路、local-first 原则。
- **共享数据与配置中枢**：`~/.agent-resume-panel`（`panelHome`）是 **VS Code 扩展与 Electron App 的通用目录** —— 含 `catalog.db`、notes、acp、以及 **LLM / Memory 等共用配置**（可配置覆盖路径，但默认即此）。
- **演进**：两边读写同一 catalog 与配置，避免双份数据；App 可对部分设置做覆盖层（见 §7.1）。
- **扩展不必立刻废弃**：IDE 内 resume 仍有价值；Mac App 覆盖全天工作流、记忆与跨项目回顾。
- **落地策略（已定 1C）**：并行推进 —— 抽出 `packages/core` + 开 Electron 壳 + Memory MVP（日/周/月 + 向量检索）同阶段推进。

---

## 3. Memory 系统

### 3.1 设计原则

1. **分层记忆**，而非把所有 transcript 塞进一个 prompt。
2. **定期批处理**（日 / 周 / 月），用 LLM 从 session 数据提炼，写入可检索 store。
3. **可引用**：每条记忆能回溯到 `provider + agent_session_id`（及时间范围）。
4. **Local-first**：记忆落本机；仅在用户配置的 LLM API 时出网。

### 3.2 分层模型

```text
L0  Raw Session Index     ← 已有 catalog.sessions + 原生 transcript 路径
L1  Session Summary       ← 已有 session_summary；可批量补全
L2  Daily Digest          ← 当天跨 session / 项目的工作日志
L3  Weekly Review         ← 主题、决策、未完成、跨项目关联
L4  Monthly / Long-term   ← 稳定偏好、项目阶段、技术栈习惯、决策档案
L5  Working Memory        ← Meta-Agent 当前对话的短期上下文（可过期）
```

### 3.3 定期分析流水线

| 周期 | 输入 | 输出 | 触发 |
|------|------|------|------|
| **Daily** | 当日新增 / 更新的 sessions + 已有 L1 | `daily_digest`（做了什么、卡点、待续） | 本地定时（如每天 22:00）或 launchd |
| **Weekly** | 7 天 digests + 重要 session summaries | `weekly_review`（主题聚类、决策、债务） | 每周日 / 手动 |
| **Monthly** | 周报聚合 | `monthly_archive` + 更新 long-term profile | 月初 / 手动 |

```text
catalog.db sessions (updated_at in range)
  → load transcripts (adapters, 限长 / 抽样)
  → LLM extract (facts / decisions / todos / entities)
  → write memory_entries + links back to sessions
  → optional: 推送「今日回顾」到 App 通知
```

### 3.4 数据扩展（概念，非实现）

在现有 `catalog.db` 旁扩展或同库新表：

| 表 | 用途 |
|----|------|
| `memory_entries` | `id, level, period_start, period_end, title, content, embedding_ref?, created_at` |
| `memory_links` | `memory_id → (provider, agent_session_id)` 或 `project_path` |
| `memory_jobs` | 定时任务状态、上次成功时间、错误 |
| `user_profile` / `project_memory` | 长期偏好与项目阶段（L4） |
| embeddings / 向量索引 | 与 `memory_entries` 关联；实现可选 sqlite-vec 或旁路向量文件 |

**检索（已定 3C）**：日 / 周 / 月 digest + **向量检索**；辅以时间范围 / 关键词 / LLM 重排。  
**Embedding（已定）**：走 **第三方 OpenAI 兼容** API（`/v1/embeddings` 形态），与 chat 一样可配置 base URL / model / key；**不做**本地 embedding 运行时为首选。配置落在 `panelHome`（见 §5.5）。  
**落地节奏**：能力目标仍是 3C；**工程交付按 v0.1 切片**（见 §6.1），避免并行半成品。

### 3.5 Meta-Agent 如何用 Memory

用户示例：

- 「上周 payment 相关改了什么？」
- 「这个项目现在卡在哪？」
- 「帮我接着昨天 codex 那个 session 继续，但用 claude」

Agent 行为：

1. 查 L2–L4 + 相关 L1 + GTD / notes  
2. 组装 brief  
3. **路由执行**（可选）：生成 resume / handoff 命令，或拉起 ACP / 终端中的第三方 agent，并注入记忆 brief  

---

## 4. 统一管理第三方 Session：边界

### 4.1 要做（控制面）

- 统一列表、搜索、筛选（provider / project / GTD / 时间）
- 预览 transcript、summary、notes
- Resume / 复制命令 / 打开项目
- Handoff 到另一 CLI
- 批量归档、导出备份
- Memory 看板（日 / 周 / 月）与 Meta-Agent 对话

### 4.2 不要做（至少 MVP）

- 复制一套完整 coding agent 运行时
- 强制把所有供应商会话「合并成一个物理会话」
- 上传用户对话到自有云（保持 local-first）
- 在未获用户授权时改写各 CLI 原生存储以外的全局状态

### 4.3 身份模型

```text
Logical Work Thread（可选，App 层概念）
  ├── link: codex session xxx
  ├── link: claude session yyy
  └── memory: digests / decisions
```

「统一」发生在 **索引 + 记忆 + 逻辑线程**，不是消灭多 provider 的物理 session。

---

## 5. Mac App 形态

### 5.1 技术栈（已定：Electron）

**决策：使用 Electron 构建 Mac 桌面 App。**

| 理由 | 说明 |
|------|------|
| 复用现有 TS | 可直接/间接复用 `src/history/*`、`src/catalog/*`、`src/llm/*` 等 Node 侧逻辑 |
| 心智接近 | 与 VS Code 扩展、webview UI 模型一致，迁移成本低 |
| 本机能力 | main process 可读写 `catalog.db`、调 CLI、resume、跑定时 Memory job |
| 打包分发 | electron-builder 等成熟链路，先覆盖 macOS |

**架构示意：**

```text
┌──────────────────────────────────────────┐
│  Renderer（UI：Sessions / Memory / Agent） │
├──────────────────────────────────────────┤
│  Preload（contextBridge IPC）             │
├──────────────────────────────────────────┤
│  Main（Node）：catalog · adapters · LLM   │
│              · memory jobs · resume CLI  │
└──────────────────────────────────────────┘
         │ 通用 panelHome（扩展 + App）
         ▼
   ~/.agent-resume-panel/
     catalog.db · notes/ · acp/ · 共用配置(LLM/Memory…)
```

**已知取舍**：安装包体积大于 Tauri / 原生；接受该成本以换取与现有扩展代码同构和更快落地。

**不做**（当前阶段）：Tauri、SwiftUI 原生壳 —— 若未来要极致轻量或系统集成再评估。

### 5.2 仓库布局（已定 2A）

同仓 monorepo：

```text
agent-resume-panel/
  packages/core/          # catalog · history adapters · llm · memory jobs（扩展与 App 共用）
  apps/desktop/           # Electron main / preload / renderer
  src/                    # 现有 VS Code 扩展（逐步改为依赖 packages/core）
  docs/
```

### 5.3 核心页面（MVP 草图）

1. **Sessions** — 多 provider 列表（对齐现有 Sessions + Session Manager）
2. **Memory** — 日 / 周 / 月 digest 时间线 + **向量 / 语义检索**
3. **Agent** — Meta-Agent 对话（带引用 session / digest）
4. **Projects** — 项目别名、项目记忆、笔记入口
5. **Settings** — 读写 `~/.agent-resume-panel` 共用配置；App 可覆盖部分项

### 5.4 后台与定时（已定 4A）

- Electron main 内 scheduler + 可选 `launchd`：daily / weekly / monthly jobs  
- **默认关闭**自动定时；用户在 Settings 显式打开后才跑  
- 首次开启时提示：将读取 transcript 并调用已配置的 LLM（**成本 / 隐私**）  
- 始终保留 **手动**「生成今日 / 本周 / 本月回顾」入口  

### 5.5 配置策略（已定 5C + A3 + panelHome 中枢）

- **`~/.agent-resume-panel` 即 VS Code 插件与 Electron App 的通用配置与数据根**（可用设置改路径，默认不变）。  
- **共用配置文件：`~/.agent-resume-panel/settings.json`**（实现时定 schema；含 chat LLM、**embedding** OpenAI 兼容 base/model、Memory 开关等）。  
- **API key**：优先安全存储（如 OS keychain / 扩展 SecretStorage）；`settings.json` 可只存非敏感项与「key 引用」；迁移期允许兼容现有扩展配置读取。  
- **扩展已对齐（v0.1）**：LLM 读序为 Secret → `settings.json` → env；非 key 项优先「VS Code 显式配置」，否则回落 `settings.json`。在扩展 Settings 保存 LLM / API key 时会**回写** `settings.json`，Desktop 与扩展共用。  
- **两边都能读**；**App 可覆盖**仅桌面相关键（窗口、托盘、定时本地策略等），覆盖层仍落在同一 `panelHome`（如 `settings.desktop.json` 或同文件 `desktop` 命名空间）。  
- 目标：配置一次 chat + embedding，扩展与 App 都能用。

### 5.6 平台范围（已定 A2）

- **首版仅 macOS**（Apple Silicon / Intel 按 electron-builder 常规支持）。  
- Windows / Linux 不在 v0.1 范围；架构不主动堵死，但不投入打包与测试。

---

## 6. 分阶段路线图

落地策略已定为 **并行（1C）**，但 **v0.1 先切片交付**（A1），再叠满 3C 与 Meta-Agent。

### 6.1 v0.1 切片（已定 A1）— 第一个可交付

目标：**能跑通「共享 core + 读 panelHome + 手动 Daily + Electron 能看见 sessions」**，而不是一次做满周/月/向量/对话。

| 项 | v0.1 包含 | v0.1 不做（顺延） |
|----|-----------|-------------------|
| **packages/core** | 抽出 catalog + history（扩展可编译依赖）；Memory **表结构** + job 骨架 | 扩展全部模块一次迁完 |
| **Memory** | **手动**生成 **Daily** digest（无 summary 时拉 transcript 片段；同日可覆盖）；链路可复用到周/月 | 自动定时默认开；Weekly/Monthly UI 完整验收可 v0.2 |
| **向量** | schema / embedding 客户端（OpenAI 兼容）可先接线 | 检索体验与全量回填可 v0.2 打磨 |
| **Electron** | 壳 + **Sessions 列表** + 读 panelHome + Settings 读写 `settings.json` | 精致 Memory 看板、Meta-Agent 对话 |
| **平台** | **仅 macOS** | Windows |

**v0.1 验收（最小）：**

1. 扩展与 App 共用同一 `panelHome`，Sessions 列表一致（或 App 能列出 catalog 中的 session）。  
2. 配置写入 `settings.json`（+ key 安全策略）后，core 能调 OpenAI 兼容 chat / embeddings。  
3. 用户手动触发一次 **Daily digest**，结果入库并可关联回 session。  
4. macOS 上 Electron 可启动、可打开 Settings / Sessions。

### 6.2 后续阶段（与 v0.1 衔接）

| 阶段 | 内容 |
|------|------|
| **Phase 0** | 讨论固化 → 本文档 |
| **v0.1** | 见 §6.1（core + Daily 手动 + Electron Sessions + settings.json） |
| **v0.2** | Weekly/Monthly 跑通；向量检索可用；Memory 看板；定时（默认仍关）— **feature 分支已实现** |
| **v0.3 / Phase 3** | Meta-Agent 对话：digests + 向量问答、引用溯源、handoff / resume brief — **feature 分支已实现** |
| **v0.4** | Memory→GTD 直写（AI 标记）+ panelHome notes `todolist.md` — **Desktop/core only，不改扩展代码** |
| **Phase 4** | Logical Work Thread、智能路由、可选 ACP 内嵌 |

---

## 7. 决策记录

### 7.1 已拍板

1. **需要**带页面的自有 **Meta-Agent**，用于统一管理与记忆，而不是再造 coding CLI。  
2. **Memory** 必须分层 + 日 / 周 / 月定期分析，不能只靠单次 summarize。  
3. **数据与配置**继续 local-first；**`~/.agent-resume-panel` 为 VS Code 扩展与 Electron App 的通用 panelHome**（catalog、notes、acp、共用配置）。  
4. **第三方 CLI** 仍是执行主力；App 做控制面 + 记忆面。  
5. **Mac App 技术栈 = Electron**（main Node 复用 catalog/adapters；renderer 做总控 UI）。  
6. **落地路径 = 1C 并行**：`packages/core` + Electron 壳 + Memory 同阶段推进；**交付按 v0.1 切片（A1）** 见 §6.1。  
7. **仓库布局 = 2A monorepo**：`apps/desktop` + `packages/core`，扩展逐步依赖 core。  
8. **Memory 能力目标 = 3C**：**Daily + Weekly + Monthly** + **向量检索**；v0.1 先 **手动 Daily** + 接线，周/月/检索体验 v0.2 打满。  
9. **定时任务 = 4A**：**默认关闭**；Settings 显式开启 + 首次成本/隐私提示；保留手动生成。  
10. **LLM / 配置 = 5C + A3**：共用 **`~/.agent-resume-panel/settings.json`**；扩展逐步对齐；**App 可覆盖**桌面项；避免双份 API key。  
11. **Embedding**：第三方 **OpenAI 兼容** `/v1/embeddings`；base / model / key 可配置（与 chat 同类）。  
12. **平台 = A2**：**首版仅 macOS**。  

### 7.2 仍可后定（不挡 v0.1 开工）

1. 产品显示名（Agent Resume Desktop / 其他）。  
2. 系统托盘 / 开机自启。  
3. 向量持久化细节（sqlite-vec vs 旁路文件）— embedding **协议**已定 OpenAI 兼容。  
4. Logical Work Thread / 内嵌 ACP（Phase 4）。  
5. 自动批量补全历史 summary 的默认策略（仅新 session vs 用户点批量）。  
6. monorepo 工具链与 UI 框架（npm/pnpm、React 等）— 工程默认即可。

---

## 8. 验收思路

### 8.1 v0.1（见 §6.1）

扩展与 App 同 panelHome、Sessions 可见、`settings.json` + OpenAI 兼容 chat/embeddings、手动 Daily digest 入库、macOS Electron 可启动。

### 8.2 愿景完整（v0.2+）

1. 手动 / 定时跑通 Daily / Weekly / Monthly，digest 可点回源 session。  
2. 向量检索能按语义找到相关 digest / session。  
3. Meta-Agent 回答「昨天做了什么」时引用正确 session。  
4. 从 App 一键 resume 到 Codex / Claude 等仍可用。  
5. 配置一次 chat + embedding，扩展与 App 均可使用。  
6. 定时默认关闭；开启前有成本/隐私提示。  
7. 无自有云账号可完整使用（仅可选第三方 LLM / embedding API）。  

---

## 9. 现有可复用资产

| 路径 | 用途 |
|------|------|
| `src/catalog/db.ts` | schema / migrations → 迁入 `packages/core`，扩展 memory 表 |
| `src/catalog/types.ts` / `query.ts` / `sync.ts` | session 索引读写与同步 |
| `src/history/*` | 各 provider session 列表与路径 |
| `src/history/preview/*` | transcript 读取（digest 输入） |
| `src/llm/sessionAssist.ts` / `prompts.ts` | 摘要与 prompt 模式 |
| `src/handoff/*` | brief 生成与跨 agent 交接 |
| `src/acp/*` | 可选：App 内嵌 ACP 对话 |
| `src/settings/*` | 配置读写模式 → 对齐 panelHome 共用配置 |
| `~/.agent-resume-panel/` | **扩展 + App 通用数据与配置中枢** |

---

## 10. 总结

the product owner 要的是：

**Electron（macOS）Session 总控 + 日/周/月 Memory（OpenAI 兼容 embedding 向量检索）+ Meta-Agent；与 VS Code 扩展共享 `~/.agent-resume-panel`（`settings.json`）。**

并行 monorepo、**v0.1 切片先交付**：core + 手动 Daily + Electron Sessions。第三方 CLI 继续干活；App / Agent 负责 **统一看见、记住、调度**。
