# 超级单入口与自适应动态舞台 (Universal Chat + Adaptive Stage) — 架构设计规范 (RFC/ADR)

> 状态：**v2 深度 Review 修订版 (Grounded in Codebase)**
> 触发诉求：将 `agent-resume-panel` 桌面端打造成单一对话超级入口，所有现有与未来功能（GTD 待办、笔记树、浏览器自动化、工作台、会话历史、Git Diff）全面服务化下沉；同时解决对话流高密度多维渲染、开放式未定义需求即时渲染的核心体验与架构难题。
> 关联路径：
> - 核心契约：`packages/core/src/artifacts/`
> - 桌面入口：`apps/desktop/src/renderer-react/main.tsx`, `apps/desktop/src/renderer/index.html`
> - 现有 Artifact 基础：`apps/desktop/src/renderer-react/components/artifact/` (`ArtifactCard.tsx`, `ArtifactHtmlSandbox.tsx`)
> - 对话与流式管线：`apps/desktop/src/renderer-react/features/chat/` (`useThunderChat.ts`, `StreamdownRenderer.tsx`)
> - 后台服务与 MCP：`agent-resume-task`, `agent-resume-note`, `agent-resume-browser`, `thunder-memory`

## 0. 修订记录 (Revision History)

| 版本 | 变更摘要 |
| :--- | :--- |
| v1 | 初版架构设计：提出「单入口 Chat + 自适应舞台 Adaptive Stage」、三层渲染引擎、沙箱微应用与 `agentBridge` 双向通信、上下文虚拟化与 P0–P3 路线图。 |
| **v2** | **结合代码库深度 Review 修正 8 大关键架构与工程问题**：① 修复 `index.html` CSP (`script-src 'self'`) 拦截 `iframe srcdoc` 脚本执行的致命限制；② 升级为「MCP 工具事件零延迟直驱 + LLM 代码块生成」双轨触发机制，避免 LLM 复述结构化数据浪费 Token；③ 利用现有 `#react-*` DOM Portal 架构实现零重写 CSS Grid 舞台收拢；④ 复用并升级现有 `components/artifact/` 组件族，修复流式状态硬编码导致沙箱高频报错抖动的问题；⑤ 明确多会话切换时“全局常驻视图”与“会话专属产物”的作用域隔离；⑥ 收紧 `agentBridge` 权限白名单防止间接 Prompt 注入提权。 |

---

## 0. 架构核心思想 (Core Philosophy)

从传统的**「多页面/多 Tab 标签式桌面后台管理系统」**转向**「以对话为神经中枢的 Agentic OS」**：
1. **单一输入入口 (Single Front Door)**：用户感知中只有这一个极简的高性能对话窗口（Chat Stream）。
2. **所有功能服务化 (Headless Background Services)**：现有的业务逻辑全部下沉为无头服务，统一通过本地 RPC 或 MCP (Model Context Protocol) 工具接口对外暴露。
3. **输出空间解耦 (Separated Visual Stage)**：线性对话流负责交互与思考流转，非线性高维交互（看板、树图、编辑器、浏览器、图表、微应用）投射至**自适应舞台 (Adaptive Stage)**。
4. **无限开放渲染 (Open-ended Sandboxed Runtime)**：针对未提前预设的交互式需求，通过即时沙箱执行 Agent 编写的微应用，并经由安全 Bridge 反向打通本地系统能力。

---

## 1. 空间布局与舞台生命周期模型

### 1.1 空间形态 (Dual-Space Topology)

```
+-----------------------------------------------------------------------------------------+
| [● ● ●] 💬 Agent Resume Hub                 [ 🗂 Artifacts (3) ▾ ] [ ◫ Split ] [ ⤢ Max ] |
+-----------------------------------------+-----------------------------------------------+
|                                         |  [ Tabs: 📋 GTD 看板 | 🌐 浏览器 | 📝 需求笔记 ]    |
|               Chat Stream               +-----------------------------------------------+
|                                         |                                               |
|  User: 帮我看下当前阻塞的任务           |                                               |
|  Agent: 发现 2 个阻塞任务，已呈现在舞台。 |            [ Active Artifact View ]           |
|                                         |                                               |
|  [ 📋 GTD 看板已激活 · 2 个待处理 ]       |               (支持拖拽、直接编辑)              |
|                                         |                                               |
+-----------------------------------------+-----------------------------------------------+
| [/] [⚡ YOLO] 输入指令或用 @ 引用舞台卡片...                                      [Send ↵] |
+-----------------------------------------------------------------------------------------+
```

系统窗口具备 4 种自适应视图模式：

| 模式 | 触发场景 | 表现形态 |
| :--- | :--- | :--- |
| **Hidden (纯聊隐身)** | 默认态、纯文本对话、日常快速提问 | 纯单列居中，隐藏右侧舞台，最大化阅读呼吸感。 |
| **Split Pane (双栏分屏)** | Agent 触发具有 UI 投射属性的工具，或用户点击展示 | 左右分栏（默认 4:6 或 3:7），中线支持拖拽调整宽度，两栏独立滚动。 |
| **Maximized (舞台独占)** | 用户点击右上角 `⤢`，或聚焦复杂看板整理/深度代码审阅 | 舞台填满整个主窗口，Chat 自动折叠为左侧边缘抽屉或悬浮唤起卡片。 |
| **Detached (原生弹窗)** | 用户点击右上角 `⤢` 弹出独立窗口 | 借助 Electron 多窗口能力将当前 Artifact 移至独立 macOS 窗口。 |

### 1.2 舞台生命周期与多会话作用域隔离 (Session Scoping)

在 `ChatView` 中，用户会频繁在不同对话会话（`activeSessionId`）之间切换。舞台上的Tab必须区分**两类作用域**：

1. **全局工作区视图 (Workspace-Scoped Native Views)**：
   - 包括 `GTD 看板`、`Notes 笔记树`、`Schedule 日程`、`Browser 浏览器`。
   - 这类视图反映的是本地数据库的实时状态，可作为舞台顶部的**常驻固定槽位 (Pinned Slots)**，切换对话会话时不会消失，但可根据当前对话关联的 `rootPath` 或 `taskId` 自动高亮/过滤。
2. **会话专属产物 (Session-Scoped Generative Artifacts)**：
   - 包括某次对话中生成的 `Chart 统计图`、`Mermaid 架构图`、`Git Diff`、`Custom Micro-App (如复利计算器)`。
   - 与 `activeSessionId` 强绑定。当用户从会话 A 切换到会话 B 时，舞台上的动态产物 Tab 栈随之切换为会话 B 的产物栈。
3. **活体数据 vs 历史快照 (Live State vs Snapshot)**：
   - `Live`：与后台本地服务实时直连（如 GTD 看板、在线浏览器、本地文件笔记）。
   - `Snapshot`：针对某次特定分析生成的只读快照（如过去的 Token 消耗图表、某次测试跑批的死锁诊断报告）。

### 1.3 基于现有 DOM Portal 架构的零重写布局改造

审视现有代码 `apps/desktop/src/renderer/index.html` 与 `main.tsx`：
目前系统采用扁平 Portal 挂载模式（`#react-gtd`, `#react-notes`, `#react-schedule`, `#react-sessions`, `#react-chat` 并列于 `<main>` 下，通过 `document.documentElement.dataset.boardView` 互斥显隐）。

**最优工程改造方案（避免重写现有各 Feature 内部逻辑）**：
- 将 `<main>` 改造为 CSS Grid 双栏弹性容器：
  - **左栏（主入口常驻）**：`#react-chat` 始终挂载并保持可见（彻底消除目前 `main.tsx` 中用 `chatVisited` 临时 latch 的 hack）。
  - **右栏（Adaptive Stage 舞台槽位）**：通过 `document.documentElement.dataset.stageView = "none" | "gtd" | "notes" | "schedule" | "sessions" | "archive" | "artifact"` 控制右侧舞台展示哪个 Portal 容器。
- **收益**：现有的 `GtdView`、`NotesView`、`ScheduleView`、`SessionsView` **无需修改任何内部状态与事件逻辑**，天然成为右侧舞台的 Layer 1 原生视图！

---

## 2. 三层渲染引擎体系 (3-Layer Rendering Engine)

为了兼顾**“原生系统性能”**、**“数据图表通用性”**和**“面对开放式需求的无限扩展能力”**，UI 渲染采用分层解析：

```
                Agent / MCP Tool Result / Stream
                               │
       ┌───────────────────────┼───────────────────────┐
       ▼                       ▼                       ▼
 [Layer 1 原生硬核]       [Layer 2 声明式数据]    [Layer 3 动态沙箱微应用]
 (Native Domain)          (Declarative Data)     (Sandboxed Dynamic App)
       │                       │                       │
 - GTD 看板 (GtdBoard)     - 趋势折线/柱状图       - 即时编写单文件 React/HTML
 - 笔记树/编辑器 (Notes)   - 桑基图/饼图/分布图    - 交互式模拟器/计算器
 - 实时浏览器 (Browser)    - 拓扑流程/Mermaid      - 动态甘特图/音频波形/3D
 - 代码 Diff (GitDiff)     - KPI 指标汇总大屏      - 自定义多维排版大屏
       │                       │                       │
       └───────────────────────┼───────────────────────┘
                               ▼
                   Adaptive Stage Host Container
```

### Layer 1: 原生领域业务组件 (Native Domain Artifacts)
- **实现手段**：桌面端预置的高性能 React 组件（将原 `apps/desktop/src/renderer-react/features/` 下的代码无缝解耦）。
- **特点**：速度极快、完整支持 macOS HIG 与原生拖拽手势、与本地 SQLite/RPC 深度双向打通。
- **内置组件库**：
  - `<GtdBoardArtifact />`
  - `<NotesTreeArtifact />` & `<MarkdownDocEditor />`
  - `<BrowserLiveArtifact />` (基于现有 CDP / Webview screencast)
  - `<GitDiffArtifact />` (逐文件折叠 diff + commit push)
  - `<WorkbenchGridArtifact />` (多终端多任务运行监控)

### Layer 2: 声明式通用数据组件 (Declarative Data Visualizations)
- **实现手段**：宿主预装通用轻量图表与数据引擎（如 ECharts / Recharts / Mermaid）。
- **特点**：Agent 无需写任何渲染逻辑，只需输出遵循 Schema 的结构化 JSON 数据，前端自动套用 Vercel Geist 配色规范渲染。
- **支持类型**：`chart:bar`, `chart:line`, `chart:pie`, `chart:scatter`, `graph:mermaid`, `stats:kpi-grid`, `table:pivot`。

### Layer 3: 开放式即时沙箱微应用 (Sandboxed Dynamic Micro-App)
- **实现手段**：受限的隔离 `iframe`（`sandbox="allow-scripts"`，严禁 `allow-same-origin`）。
- **预置运行时 (Pre-bundled Runtime)**：
  - 样式：Tailwind CSS + Geist Design Tokens (`:root` CSS 变量全量同步)。
  - 核心运行时：React 18 + Babel-standalone + Lucide Icons + D3/Chart.js 预埋加载器。
- **自适应深浅色**：宿主通过 `postMessage` 实时向沙箱派发深浅色事件，沙箱无刷新切换。

---

## 3. UI Artifact 协议规范 (Protocol & Wire Format)

### 3.1 TypeScript 契约定义 (`packages/core/src/artifacts/`)

```typescript
export type ArtifactKind = 
  | "native:gtd"
  | "native:notes"
  | "native:browser"
  | "native:diff"
  | "native:workbench"
  | "chart"
  | "graph:mermaid"
  | "stats:kpi"
  | "custom:app";

export interface UIArtifactEnvelope<T = unknown> {
  /** 唯一标识符，相同 ID 则执行原地热更新 */
  id: string;
  /** 协议版本号 */
  version: "1.0";
  /** 舞台 Tab 标题 */
  title: string;
  /** 图标指示符 (如 "kanban", "file-text", "globe", "bar-chart-3") */
  icon?: string;
  /** 投射目标：右侧舞台(默认) / 气泡内嵌 / 临时抽屉 */
  target: "stage" | "inline" | "drawer";
  /** 展现类型 */
  kind: ArtifactKind;
  /** 针对 Layer 1 & 2 的强类型载荷，或 Layer 3 的单文件代码 */
  payload: T;
  /** 权限与双向直连能力声明 */
  capabilities?: {
    /** 是否支持跳过 LLM 直接向后台服务 RPC 写回数据 */
    canDirectMutate?: boolean;
    /** 绑定的后台服务名，如 "agent-resume-task" */
    service?: string;
    /** 是否可持久化为本地长期文件 */
    exportable?: boolean;
  };
}
```

### 3.2 双轨触发机制：工具事件直驱 + LLM 生成块 (Dual-Track Triggering)

> **关键设计修正（v2）**：如果所有舞台渲染都要求 LLM 在回复正文中重新手写一遍 `json:ui-artifact`，当调用 `task_list` 返回 30 个任务时，LLM 把工具结果再抄写一遍不仅浪费双倍输出 Token、增加 5~10 秒延迟，还极易发生字段幻觉或截断。

因此，舞台投射采用**「双轨触发机制」**：

#### 轨道 A：MCP 工具事件零延迟直驱（针对 Layer 1 原生组件，0 Token 开销）
`useThunderChat.ts` 在流式周期中已完整接收 `tool_exec_start` 与 `tool_exec_result` 事件。前端内置一个轻量级的 **`ToolStageRouter`**：
- 当监听到 `agent_resume_task_*` 工具执行完成 ➔ 自动打开/刷新右侧舞台的 `native:gtd` 视图，并将工具参数中的 `noteId` / `rootPath` 传给看板进行聚焦高亮。
- 当监听到 `agent_resume_note_*` 工具执行完成 ➔ 自动激活舞台的 `native:notes` 视图并定位到目标 `noteId`。
- 当监听到 `agent_resume_browser_*` 工具执行 ➔ 自动展开 `native:browser` 实时网页画面。
- **优势**：毫秒级响应、零额外 Token 消耗、100% 数据准确性。

#### 轨道 B：LLM 声明式/生成式代码块（针对 Layer 2 图表与 Layer 3 开放式微应用）
当用户提出定制图表或开放式未定义需求时，复用并升级现有的 `StreamdownRenderer.tsx` + `ArtifactCard.tsx` 拦截管线：
- 支持代码块语言标识：`html`, `svg`, `mermaid`, `chart` (JSON ECharts/Recharts 规范), `ui-artifact` (复合 Envelope)。
- **内嵌与舞台联动**：
  - 轻量级内容（小型 Mermaid 图、单指标卡）默认在气泡内通过 `ArtifactCard` 渲染，右上角提供 **`[◫ 投射至舞台]`** 按钮。
  - 复杂交互应用（带有 `<script>` 的 HTML/React 微应用、多维仪表盘）自动投射至右侧舞台，气泡内仅保留紧凑的 **`[⚡ 已在舞台打开：十年复利模拟器 ➔]`** 锚点卡片。
- **流式防抖与防闪烁保护**：
  - 修复现有 `StreamdownRenderer.tsx` 中 `isStreaming={false}` 硬编码问题，透传真实的流式闭合状态。
  - 在代码块尚未闭合（`isStreaming === true`）期间，沙箱**仅展示代码生成进度骨架屏或只读预览，暂缓执行 `<script>`**，彻底消除流式输出半截 JS 代码导致的数十次语法报错与白屏闪烁。

---

## 4. 开放式沙箱安全与反向通信架构 (Reverse Bridge)

对于 Layer 3 动态生成的微应用，必须既保证系统的绝对安全，又赋予其调用后台服务的联动能力：

```
+-------------------------------------------------------------------------+
| Desktop Host (Electron Renderer)                                        |
|                                                                         |
|  +-------------------------+     postMessage      +------------------+  |
|  |     <SandboxHost />     | ───────────────────> | Security Gateway |  |
|  |                         | <─────────────────── | (Permission Gate)|  |
|  |  +-------------------+  |                      +--------┬---------+  |
|  |  | <iframe>          |  |                               │            |
|  |  |  sandbox="        |  |                               ▼            |
|  |  |   allow-scripts"  |  |                     +-------------------+  |
|  |  |                   |  |                     | Background MCP/   |  |
|  |  |  window.          |  |                     | Headless Services |  |
|  |  |   agentBridge     |  |                     | (Task/Note/Git)   |  |
|  |  +-------------------+  |                     +-------------------+  |
|  +-------------------------+                                            |
+-------------------------------------------------------------------------+
```

### 4.1 突破 Electron CSP 限制与沙箱隔离方案 (Critical Engineering Fix)

> **代码库现状隐患**：
> 当前 `apps/desktop/src/renderer/index.html` 第 6 行配置了严格的 CSP：
> `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' file: data:`
> 根据 W3C 与 Chromium 规范，`<iframe srcdoc="...">` **会强制继承父文档的 CSP**。这意味着在当前 `ArtifactHtmlSandbox.tsx` 中，任何带有内联 `<script>` 的 HTML 产物都会被浏览器以 `Refused to execute inline script because it violates CSP directive: "script-src 'self'"` 直接拦截失效！

**解决方案：采用自定义沙箱协议 `agent-sandbox://` 或独立 CSP Blob/Webview**
1. 在 Electron 主进程（`apps/desktop/src/main/`）注册特权隔离协议 `protocol.handle("agent-sandbox", ...)`，其响应头返回专为沙箱定制的独立 CSP：
   - 允许执行内联脚本与受控本地 Vendor 资源：`script-src 'unsafe-inline' 'unsafe-eval' agent-sandbox://vendor/; connect-src 'none';`
   - **`connect-src 'none'`**：严禁沙箱内部代码私自发起任何外网 `fetch`/`XHR` 请求（防止数据外泄），所有外部数据交互必须经由 `postMessage` 走宿主的 `agentBridge` 审计。
2. **本地离线预置 Vendor 库**：
   - 将 Tailwind CSS 生成器、React 18、Lucide 图标、轻量图表库打包在桌面端本地 `vendor/` 目录并通过 `agent-sandbox://vendor/*` 提供，既绕开 CSP 限制，又保证**完全离线可用、零网络加载延迟**。

### 4.2 安全沙箱注入微内核 (`window.agentBridge`) 与防提权门闸

宿主通过 `srcdoc` 向沙箱注入微型 SDK：
```javascript
window.agentBridge = {
  // 1. 获取宿主环境变量与深浅色模式
  getTheme: () => ({ appearance: "dark", accent: "#0070f3" }),
  
  // 2. 状态保持：避免微应用重新渲染时用户输入的表单数据丢失
  saveState: (state) => window.parent.postMessage({ type: "STAGE_SAVE_STATE", payload: state }, "*"),
  getState: () => __INITIAL_STATE__,
  
  // 3. 反向调用宿主系统能力 (需过安全门闸)
  callService: (service, tool, params) => {
    const callId = Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      // 注册单次回调监听
      window.__rpc_callbacks[callId] = { resolve, reject };
      window.parent.postMessage({
        type: "STAGE_CALL_SERVICE",
        callId,
        service,
        tool,
        params
      }, "*");
    });
  },
  
  // 4. 反向触发自然语言对话流
  sendPrompt: (text) => {
    window.parent.postMessage({ type: "STAGE_SEND_PROMPT", prompt: text }, "*");
  }
};
```

### 4.3 权限白名单与防间接 Prompt 注入 (Privilege Escalation Defense)

如果用户让 Agent 总结一篇外部网页或第三方 Issue，恶意文本可能包含间接 Prompt 注入，诱导 Agent 生成一段自动调用后台删除/执行命令的 `<script>`。因此必须设立两道铁律：
1. **高阶意图白名单 (Strict Action Allowlist)**：
   - `agentBridge.callService` **绝不暴露**底层 Shell (`bash`/`exec`)、原始文件系统读写 (`fs`) 或任意进程拉起能力。
   - 仅开放受控的领域意图：`task.create`, `task.updateStatus`, `note.createDraft`, `note.append`, `chat.sendPrompt`。
2. **宿主级写操作确认栏 (Host-Rendered Confirmation Bar)**：
   - 当沙箱内的微应用发起写操作（如批量创建 5 个任务）时，宿主在舞台顶部弹出原生确认条：`[沙箱应用请求创建 5 个 GTD 任务] [允许] [拒绝]`，由用户显式点击授权后方可执行。

### 4.4 错误自愈闭环 (Self-Healing Loop)

当 Agent 生成的代码在沙箱中抛出运行时异常（如组件未定义、语法错误）：
1. 沙箱全局 `window.onerror` 与 `window.onunhandledrejection` 捕获异常堆栈。
2. 通过 `postMessage` 向 `StageHost` 发送 `STAGE_RUNTIME_ERROR`。
3. 宿主端不呈现破损白屏，而是静默生成一道自愈 Prompt 注入会话：
   *“你刚才为舞台生成的代码在沙箱中抛出异常：`[Error Stack]`，请分析原因并修正该代码。”*
4. Agent 自动输出修正后的 `json:ui-artifact`，舞台平滑原地更新。

---

## 5. Token 经济学与上下文虚拟化 (Context Virtualization)

当 Agent 频繁输出包含几百行代码或数千条数据的 Artifact 时，若直接留在历史会话中，将导致 Token 爆炸与性能骤降。

### 5.1 上下文虚拟化策略

```
   用户消息 / Agent 思考 / 工具调用
                 │
                 ▼
 ┌──────────────────────────────────────┐
 │   本地持久化存储 (SQLite / File)       │
 │   - artifact_id: "calc-sim-10y"      │
 │   - code: 450 行 React 代码           │
 │   - raw_data: 2MB JSON 数据          │
 └──────────────────┬───────────────────┘
                    │
                    ▼ (Prompt 序列化层前置处理)
 ┌──────────────────────────────────────┐
 │   LLM Context (送入模型的上下文)      │
 │                                      │
 │   Agent: 模拟器已生成。              │
 │   [System Ref: Stage Artifact        │
 │    id="calc-sim-10y"                 │
 │    title="十年复利模拟器"            │
 │    kind="custom:app"                 │
 │    summary="包含资产比例滑块与折线图"]│
 └──────────────────────────────────────┘
```

1. **虚拟化引用条目**：进入长期记忆/会话上下文时，将庞大的 payload 剪裁为简短的结构描述指针（`<stage_artifact_ref id="..." />`）。
2. **按需恢复召回**：只有当用户明确要求“修改刚才的模拟器”时，系统感知拦截器才将该 `artifact_id` 的完整代码挂载至当前轮次的上下文注入区。

---

## 6. 交互体系：全键盘操作流 (Keyboard-Driven Interaction)

作为高频专业工具，超级入口必须具备全键盘流操作能力：

### 6.1 Slash Commands (功能快速硬路由)
在 ChatComposer 中输入 `/`，弹出快速补全列表：
- `/gtd`：立刻在舞台激活 GTD 任务看板。
- `/notes`：打开工程笔记树。
- `/browser <url>`：启动内置浏览器视窗并导航。
- `/diff`：唤出当前工作区 Git 改动对比。
- `/workbench`：唤出任务工作台控制台。
- `/split` / `/stage`：切换舞台分屏模式。
- `/clear`：清空当前对话会话。

### 6.2 Context Mentions (精确上下文引用)
在 ChatComposer 中输入 `@`，唤出跨域实体检索：
- `@task:<title>`：引用具体 GTD 任务，将其状态和元数据带入对话。
- `@note:<title>`：引用本地笔记。
- `@stage`：把当前舞台正在展示的实体或代码作为精准上下文提供给 Agent。
- `@file:<path>`：引用工程文件。

---

## 7. 实施演进路线图 (Roadmap & Phases)

```
阶段 P0: 协议定义与舞台分屏容器 ──────▶ 阶段 P1: 原生组件 (GTD/Notes) 迁移接入
                                                    │
阶段 P3: 全键盘交互与上下文虚拟化 ◀────── 阶段 P2: 隔离沙箱微应用与双向 Bridge
```

### 阶段 P0：协议契约与舞台容器搭建 (Foundation)
- 在 `packages/core` 中发布 `UIArtifactEnvelope` 协议类型。
- 在 `apps/desktop/src/renderer-react` 中引入 `StageContext` 与 `StageHost`。
- 实现 Chat 与 Stage 的双栏 Split Pane 布局（支持可拖拽调整宽度、一键收起/展开）。

### 阶段 P1：核心原生功能封装入舞台 (Native Layer Migration)
- 将现有的 `GtdView` 包装为受控的 `<GtdArtifact />`。
- 将现有的 `NotesView` 包装为受控的 `<NotesArtifact />`。
- 将现有的 `GitDiffPanel` 包装为受控的 `<GitDiffArtifact />`。
- 在 `ChatMain` 中拦截 `json:ui-artifact` 代码块，实现自然语言唤醒并投射至舞台。

### 阶段 P2：安全微应用沙箱与反向 Bridge (Sandbox & Generative UI)
- 实现 `<SandboxHost />` 隔离容器（`iframe sandbox`）。
- 注入 Geist CSS Tokens、Tailwind、React 运行时。
- 实现 `window.agentBridge` 双向 RPC 通信通道。
- 接入运行时异常捕获与 Agent 自愈闭环。

### 阶段 P3：超级入口交互完善与性能调优 (Polish & Production-Ready)
- 在 `ChatComposer` 中完善 `/` 命令与 `@stage` 实体补全。
- 实现非活动 Tab 内存惰性冻结（截图占位，避免内存飙升）。
- 实现上下文虚拟化剥离，保障 Token 经济性与长会话响应速度。
