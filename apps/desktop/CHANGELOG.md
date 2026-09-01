# Changelog

Languages: [English](#english) | [简体中文](#简体中文)

Desktop release notes for [GitHub Releases](https://github.com/lucacicii/agent-resume-panel/releases). Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Update this file before each Desktop release (`pnpm run release:desktop:mac`).

## English

### [0.2.17]

#### Added

- **Smart Intent Routing & Automatic Role Dispatch**: introduced intelligent intent parsing in IM chat to automatically determine role responsibilities, route user requests to matching specialized roles, and provide dispatch proposals with interactive confirmation
- **Role Delegation Graph & Custom Roles**: support configuring multi-role collaborative delegation workflows (e.g. PM → UI Designer → Developer → Tester) with visual dependency tracking, circular dispatch protection, and custom ACP role templates
- **IM Project Management & Workspace Association**: associate local workspace folders with IM projects, guide role tools to persist artifacts under `.arp/`, and link project knowledge snapshots for context-aware collaboration
- **Floating Timeline Navigation**: added an interactive timeline alongside IM conversations with hover previews, role color coding, and quick jump to key dialogue milestones
- **Intelligent Conversation Title Generation**: automatically renames newly created chats upon the user's first prompt, and provides manual LLM auto-rename via context menu

#### Improved

- **Multi-Role Conductor Scheduling & Parallelism**: enhanced task queueing, read-only parallel dispatch, thought level propagation, and live streaming of thinking deltas and assistant tokens
- **Proxy Model Parser & Message Attribution**: robust proxy endpoint response handling, accurate tool-call file capture, and refined role avatar/color fallback styling

### [0.2.16]

#### Added

- **Multi-Role IM Group Chat with ACP Agent Dispatch**: introduced real-time multi-agent IM group chat with built-in role templates (PM, Project Manager, UI Designer, Developer, Tester) and custom ACP roles (Pi, Claude, Codex), supporting multi-role `@mention` fan-out, read-only parallelism, room-level execution serialization, Markdown transcript rendering, and background knowledge snapshots
- **IM Selection Actions & Context Popover**: text selection in IM messages triggers quick actions (quote context, translate, explain, or custom prompt actions); independent actions execute via Chat LLM and display inline result popovers with token usage tracking
- **Provider-Centric AI Model Pool**: redesigned model configuration into a unified Provider Pool with baseUrl/apiKey and categorized models (`text`, `image`, `embedding`); features discovery via `GET /models` with heuristic classification, fine-grained per-feature model assignments, and automatic migration from legacy settings

#### Improved

- **Automatic Model Resolution & Selection Auto-Populate**: automatically falls back to the first available model of the matching kind from the provider pool when specific use-case selections are unset, and auto-populates empty tool/chat/embedding choices upon adding new models
- **Enhanced LLM Error Detail Extraction**: parses deep error payloads from API response JSON across `error`, `message`, and `detail` fields, formatting error notifications with HTTP status codes and target model names
- **IM Mentions & Roles Configuration**: rendered inline mention tags for referenced roles directly inside message bubbles, and polished Roles settings layout and scrolling

### [0.2.15]

#### Added

- **Global Notification Center**: added a persistent notification history popover and header bell button across Workbench, Agent, Notes, Kanban, Report, and Settings panels, capturing system alerts and background activity
- **Workbench batch session selection & multi-removal**: multi-select sessions using Finder-style Cmd/Ctrl+Click and Shift+Range selection; batch-remove sessions from panel with clean ACP controller disposal, selected count indicator, and Escape to clear selection
- **Multi-repository Git grouping in Workbench**: group file changes by Git repository root when workspace contains nested or sibling repositories, with per-repository stage/unstage controls and persistent collapse states
- **In-app browser upload tool (`browser_upload`)**: extended `agent-resume-browser` MCP with file upload automation via Chrome DevTools Protocol (`DOM.setFileInputFiles`)

#### Improved

- **Session transcript interaction & caret positioning**: clicking or right-clicking in Markdown transcripts accurately places caret at cursor position for seamless text selection and copying
- **Workbench project search & missing path handling**: polished workspace search UX with friendly error feedback when working directories are missing or inaccessible, and stripped raw Electron IPC wrappers from status notifications
- **Database & schema reliability**: unified SQLite database engine and improved concurrency resilience during schema initialization

#### Removed

- **Flow DAG experimental module**: removed legacy Flow DAG canvas and MCP tools (`flow_sync`, `flow_read`, etc.) to streamline Project Note tree associations and Kanban task boards

### [0.2.14]

#### Added

- **Ghostty Web & Xterm dual-engine terminal architecture**: introduced a pluggable terminal engine adapter abstraction in **Settings → Workbench → Terminal Engine** supporting both Ghostty Web (Wasm/WebGL with ultra-low latency and native GPU acceleration) and Xterm (Canvas/WebGL)
- **Workbench workspace & campaign folders**: organize sessions in hierarchical, nested campaign folders within projects; support session group collapse/expand, project-level session count badges, and auto-assigning new sessions to focused folders
- **Workbench session auto rename with project / folder context**: auto-renamed sessions append project name and folder path (e.g. `Fix renderer · app / Campaign / Phase 1`), keeping hierarchy visible outside the tree with deduplicated suffixes capped at native title limits
- **Truncated session titles reveal full text on hover**: long session titles in Workbench and Sessions lists display full text via native tooltips on hover
- **In-app Workbench browser & MCP integration**: built-in interactive browser panel with comprehensive `agent-resume-browser` MCP server integration for programmatic navigation, DOM accessibility snapshots, click, type, fill, wait, and cookie management
- **Multi-dimensional knowledge tags**: automated AI tagging for sessions and notes across seven dimensions (tech stack, business domain, architecture, task type, problem domain, concept knowledge, context environment), with a dedicated Tag taxonomy view, filtering, and consensus weighting
- **Full-stack code Link Graph**: Workbench Link Graph side panel and MCP tool (`link_graph_trace`) for tracing UI symbol and form field lineages from frontend code → API client → HTTP route → backend controller → DTO/VO
- **Visual Flow DAG & Kanban for Project Notes**: structured Project Note association trees with drag-and-drop linking, interactive Flow DAG execution with step progress syncing, and Kanban board view with GTD status columns, direct note creation, and quick delete
- **Floating scratchpad & quick note (⌘⇧D / Cmd+D)**: global shortcut to open the most recent note in a floating scratchpad with project selector, in-note Cmd+F search, and automatic cleanup of empty unedited notes
- **Deep Git integration**: line-level and hunk-level staging / unstaging, line-level discard / rollback, merge into current branch from the branch graph, and file rename history inspection
- **Report interactive citations & Ask enhancements**: clickable report citations jumping directly to linked sessions or reports, per-session Ask tool preferences (auto / custom / off), project-scoped Agent compose context, and Prime Agent ACP / CLI integration

#### Improved

- **TUI session scrolling & controls**: real wheel scrolling events for full-screen TUI sessions (Claude Code, Prime Agent), floating Jump to Top / Jump to Bottom controls with theme-adaptive styling, and auto-expanding multiline bottom input bar
- **Large Git diff performance**: offloaded large file diff parsing to background Web Workers, with automated retry logic for transient `index.lock` contention
- **Session focus & navigation**: resuming an open session switches and focuses it without reopening duplicate tabs; keyboard arrow navigation across session, terminal, and code editor groups
- **Session transcript viewer**: expanded AI tool call rendering in session transcripts with customizable Markdown font size in Settings

#### Fixed

- **Session moves to another project now stick**: reassigning a session to a different project keeps the assignment across provider syncs — the catalog tracks the provider's native path separately, so sync no longer snaps the session back. Moving a session back to its native project restores automatic path tracking.
- **Resuming a moved session starts the agent in the new project**: the resume command (and terminal cwd) now follow the assigned project for every provider, so the agent keeps working in the directory you moved it to. For Codex, Grok, OpenCode, Antigravity, Cursor CLI, Claude, Pi, and Prime Agent the provider's stored cwd is rewritten too, so even a plain `resume` outside the panel starts in the new project (best-effort; remaining providers stay sticky via the catalog's native-path tracking).
- **Settings state persistence & editing**: resolved settings form dirty-state tracking and explicit save handling
- **Uncommitted directory trailing slash**: fixed untracked directories being dropped during git commit operations
- **TUI sync redraw viewport jump**: prevented viewport from snapping to top after full-screen TUI re-renders

### [0.2.13]

#### Fixed

- **Notes target picker stacking & dismissal**: fixed popover stacking context issues in theme list panes and guaranteed target picker closes cleanly when note creation fails

### [0.2.12]

#### Added

- **Desktop visual themes & settings sync**: support application-wide visual themes in Settings → Visual Theme (Default Dark, Cyberpunk, DOS Amber, Clean Light) with auto system mode, synchronized across windows and settings
- **CodeMirror & Diff Viewer theme integration**: synchronized CodeMirror editor and Git diff views with the active visual theme, providing matching editor themes (One Dark, Solarized, Amber Terminal, Cyberpunk) with theme auto-following and explicit light/dark overrides
- **Cyberpunk visual effects & terminal transparency**: built Cyberpunk theme full-screen glitch particle background animation and top animated pulsing energy bar, and enabled transparent background for Workbench terminal (xterm)

#### Improved

- **DOS Amber palette & theme semantic contrast**: optimized semantic colors and DOS Amber contrast across Agent, Notes, and Report panels

### [0.2.11]

#### Added

- **Native Agent conversation backup**: in-app backup (**Settings → Data**) supports including native CLI agent conversation histories (Claude, Codex, Gemini, Antigravity, OpenCode, Pi, etc.) in local ZIP archives and encrypted iCloud Drive backups (`.arbak`)
- **Backup & restore progress feedback**: live progress bar with percentage, current operation phase, and item counter during export and restore
- **Workbench Explorer colorful file icons**: distinct file type icons and color styling for common programming languages, configs, assets, images, and archives in the project file tree

#### Improved

- **Report hierarchical digests & refresh budget**: two-tier session summaries for large sessions to avoid prompt token limits, plus configurable daily digest refresh budget controls and progress feedback
- **Settings layout**: refined Settings detail pane max-width and layout responsiveness

#### Fixed

- **Notes path conflicts & idempotent indexing**: resolved path collision handling during note reconciliation and guaranteed SQLite index migration idempotency

### [0.2.10]

#### Added

- **Workbench file history**: right-click a file in Explorer to inspect commits from all local and remote-tracking branches, including history before file renames ("文件历史" / "File History")
- **Directory-level Git discard**: discard Git changes for an entire directory directly from the project explorer or Git changes panel
- **Git changes context menu**: right-click changed files to open the file in editor or copy absolute / relative path

#### Improved

- **Explorer and editor sync**: active open files auto-reveal and synchronize tree highlight state in the project explorer
- **Quick Access search & switching**: optimized path indexing and search performance for Cmd+P in large projects, along with improved project switching response
- **Settings i18n**: localized tool interaction and execution tracking settings across English, Chinese, and Japanese

#### Fixed

- **Workbench editor find**: pressing Enter in the editor Find input bar now correctly advances to the next search match

### [0.2.9]

#### Added

- **Workbench Quick Access**: choose a project quickly from the keyboard-friendly project picker before opening files or sessions
- **Workbench file operations**: copy file paths and cut, copy, paste, and delete files from the project explorer
- **Virtualized session lists**: load and render the complete catalog and ACP session history without the previous display cap

#### Improved

- **Workbench editor sync**: watch workspace files, refresh external changes, and surface conflicts when an open editor file changes or is deleted on disk
- **Git workflow**: inspect inline diffs with find navigation, receive clearer push / pull / commit notifications, and keep editor and file-tree state synchronized
- **Workbench navigation**: project selection, file explorer refresh, and pending-session binding are more reliable

#### Fixed

- Copying paths from the Workbench explorer now uses the localized desktop action consistently
- Git push clears the commit input after a successful operation


### [0.2.8]

#### Added

- **ACP visual chat in Workbench**: start and resume Claude Code, Codex, Grok Build, OpenCode, and Pi sessions directly in a native chat pane; ACP conversations are indexed with the shared session catalog
- **ACP setup and connection test**: configure ACP agents from **Settings → Workbench**, verify a model or agent connection before starting work, and reuse the latest available command when a prompt is not required
- **ACP collaboration controls**: choose an agent-supported mode such as **Plan**, use its dynamic `/` command menu, and answer agent questions without leaving the Workbench
- **ACP tool interaction**: review streamed terminal and file-system activity, inspect file reads, and explicitly approve or deny permission requests before agent actions proceed

#### Improved

- **ACP chat experience**: Telegram-style conversation layout with clearer tool states, attachments, command submission, and automatic titles
- **ACP session reliability**: shared local persistence, catalog previews, external-file change detection, connection reuse, and safer session resume handling

#### Fixed

- Empty ACP sessions no longer fail to render a preview
- File-system tool calls and approval prompts now display and resolve correctly in the chat pane

### [0.2.7]

#### Added

- **Terminal renderer setting**: **Settings → Workbench → Terminal renderer** — prefer WebGL (default) or force Canvas for better CJK layout stability; hot-swaps without killing the PTY session

#### Improved

- **Embedded xterm CJK layout**: Latin mono + CJK font fallback stack, Unicode 11 widths, overlapping-glyph rescale, and tighter cell metrics so mixed Chinese/English lines stay aligned
- **WebGL glyph atlas refresh**: rebuild atlas after zoom / DPR / theme changes to avoid scrambled glyphs that only “fix” on hover
- **Desktop i18n loading in dev**: locale catalogs reload on each bundle fetch so new settings strings appear without a full main-process restart
- **i18n coverage for React settings**: checker scans `renderer-react` so Workbench/settings keys stay in sync with catalogs

#### Fixed

- **xterm layout corruption on hover**: WebGL-preferred path with Canvas fallback on context loss; force-Canvas option when GPU atlas still mis-paints double-width text
- **Missing settings strings**: `desktop.settings.terminalRenderer*` and `desktop.common.save` resolve correctly in en / zh-cn / ja

### [0.2.6]

#### Added

- **Workbench project search**: side panel **Search** indexes file contents in the selected project (match case, whole word, regex); open a hit in the file editor at the matching line
- **Workbench scripts tree**: discover and run project scripts (npm / pnpm / yarn / bun, Makefile, Gradle, Python, Cargo) from the explorer or a dedicated **Scripts** side panel into the active terminal
- **Terminal color presets**: **Settings → Workbench → Terminal theme** with Default Dark/Light, Solarized Dark/Light, One Dark, and Dracula; applies to open xterm tabs immediately and persists
- **Selective Git commit**: choose individual changed files in the Git panel and commit only the selection; commit UI refined for clearer staging flow
- **Git tracking indicators**: explorer and related surfaces show tracked / changed file state for faster orientation
- **Backup & merge restore**: **Settings** export of reports, notes, ACP chats, and vector indexes; optional password-encrypted API keys; merge import prefers newer matching records
- **Application error logs**: **Settings → Logs** lists runtime and background-task failures (redacted), with clear and reveal-in-Finder actions

#### Improved

- **Workbench title bar**: richer panel title interactions and localization
- **Branch status placement**: branch controls live in the detail header with more reliable menu positioning
- **Tab MRU focus**: closing a Workbench tab activates the most recently used panel
- **Slash-command menu**: CodeEditor `/` menus stay within the viewport
- **MCP process model**: registered clients start Agent Resume MCP via headless Node (`ELECTRON_RUN_AS_NODE` + core CLI) so each agent no longer spawns an extra Dock Electron icon

#### Fixed

- **Terminal clipboard**: paste into the PTY and copy from the terminal use correct text encoding
- **Branch popover**: removed the redundant close control; dismiss via outside interaction as before

### [0.2.5]

#### Added

- **External Agent MCP**: register one local `Agent Resume MCP` service from **Settings → MCP** for Codex, Claude Code, Gemini CLI, Antigravity, and OpenCode; Cursor, Pi, and Grok Build can use copied configuration
- **MCP Notes access**: external agents can list all indexed notes with pagination, search and edit Notes, manage note GTD tasks, read Reports, and work with Sessions
- **Cursor session integration**: Desktop can index, preview, and resume local Cursor agent sessions
- **Notes GTD slash command**: type `/` in the Markdown editor to insert a status-tagged GTD shortcut; arrow keys choose a command and Enter inserts it
- **Ask source links**: report, note, and session citations in Agent replies open their corresponding Desktop preview

#### Improved

- **Workbench file explorer**: refreshed the file-tree icon

#### Fixed

- **Workbench branch selector**: closes correctly when an external interaction dismisses the popover

### [0.2.4]

#### Added

- **Agent session tools**: Meta-Agent can search, list, and read local CLI sessions with `session_search`, `session_list`, `session_read`, and `session_read_transcript`
- **Hybrid session recall**: keyword matching across titles, paths, and summaries, plus summary-vector semantic search when embeddings are configured
- **Session citations and resume**: Agent replies can cite reports, notes, and sessions; inspect a preview, open the source in Desktop, or use **Resume** to continue a cited session in Workbench
- **Automatic session summaries**: create missing summaries after sync and refresh updated sessions after a configurable quiet delay in **Settings → Sessions**
- **Semantic session indexing**: transcript-chunk search, independent transcript indexing, and background summary-embedding backfill with configurable scheduling and batch limits
- **Agent session actions**: `session_set_gtd` and `session_resume` tools, with local-session context available to the Agent
- **Conversation recovery**: edit and resend a user turn, or truncate a thread and continue from an earlier point
- **GTD Done status**: mark a Workbench session as Done from its context menu; completed sessions appear in a collapsed **Completed** group and share the status with the VS Code extension

#### Improved

- **Agent execution flow and approvals**: inspect retrieval, model, and tool steps with inputs, outputs, timing, source, and risk; write, launch, command, and network actions request approval by default, while destructive or unknown-risk actions always do
- **Agent safety and auditability**: tool execution records are retained locally with redacted, size-limited payloads; note operations are visible in the audit view
- **Agent interaction**: clearer context display, citations, execution status, and input layout during streamed answers
- **Workbench GTD menu**: status choices use colored rounded tags; Reference and Done have distinct colors
- **GTD analysis**: stricter status interpretation improves how completed and actionable sessions are reflected in Report and GTD workflows
- **Workbench feedback**: Git actions now report completion and failure through in-app toast notifications


### [0.2.3]

#### Added

- **Settings auxiliary window**: Preferences open in a singleton secondary window (macOS style); the main window stays on the current tab (Workbench terminal context is preserved)
- App menu **Settings…** with **⌘,** ; reopening focuses the existing Settings window and can jump to a target pane
- Cross-window settings / locale broadcast after save so theme, language, and Workbench options refresh in the main window

#### Improved

- **Usage** pane layout for the compact Settings window: fixed KPI row, source chips, and tabbed detail tables for metrics and call logs

#### Changed

- **Removed Alma provider support**: Alma sessions are no longer synced or resumed; Alma data-directory and filter settings are gone
- **Purge Alma catalog rows on sync**: hard-deletes Alma sessions / satellite rows and Alma-only projects; mixed projects are kept
- Prefer **Agent Resume Panel extension ≥ 2.6.12** when sharing the same `panelHome`

#### Fixed

- Workbench project list hides catalog rows with no sessions (e.g. empty Alma app-data shells)

### [0.2.2]

#### Added

- First-class **projects** in the shared catalog (`project_id`, portable key, per-machine local paths)
- Cross-machine project identity: same `~/…` layout merges automatically; bind a folder on this Mac when paths differ
- Workbench project actions: remove from panel, pin, set local folder, copy path, reveal in Finder, merge / split (advanced)
- Configurable **project context menu** in Settings → Workbench (defaults: New Session, Mount note, Reveal in Finder, Remove from panel), with per-item tips
- Notes sidebar projects aligned with catalog projects (shared pins / path state)

#### Improved

- Session sync reconciles projects after each scan; hide/unhide project cascades sessions
- Clearer path-missing state and safer Reveal in Finder (errors when the folder is missing)
- Cross-machine session badge when a session path is under another user home

#### Fixed

- Stale per-machine path rows no longer force “Not on this machine” when the real folder exists
- Empty project alias no longer deletes the projects row (personalization is preserved)

### [0.2.1]

#### Added

- Keep-alive Workbench terminal sessions when switching panels
- Improved model configuration UX and global notifications
- Context menus aligned with macOS styling
- Sidebar segment filter slider animation with clearer dark-mode contrast

#### Fixed

- Git refresh button shows a loading spinner while refreshing
- Dark mode code and Notes editors use One Dark for better contrast
- Workbench session list agent badges match Report styling
- Terminal PTY resizes correctly when the window is resized
- Workbench session active-state display
- Cmd+W closes the current Workbench panel

### [0.2.0]

#### Added

- React desktop renderer for Workbench, Agent, Notes, Report, Sessions, and Settings
- React-native Workbench Git changes, branch graph, terminal, and file editor flows

#### Improved

- Synchronize the status-bar branch and Git graph after terminal Git operations
- Keep notes context menus sized correctly in the React renderer

### [0.1.4]

#### Added

- Configurable AI Git commit message formats: Conventional Commits, Gitmoji, or custom rules
- Desktop environment doctor for Node, pnpm, Electron, and node-pty setup checks

#### Improved

- Workbench and Notes search toolbar interactions, motion, and visual consistency
- macOS packaging and deployment reliability

#### Fixed

- Workbench settings layout and styling issues

### [0.1.3]

#### Added

- Embedded Workbench file editor with syntax highlighting, editable tabs, and configurable font size, tab width, and word wrap
- Git commit and push workflow, including AI-generated commit message suggestions
- Commit history file previews and inline diff inspection
- Session filters plus note pinning and collapsible note search

#### Improved

- Richer Git diff views and nested repository handling
- Stable Workbench side panel widths across window resizing
- Automatic selection of the first Workbench project

#### Fixed

- Arrow keys now switch files correctly in commit history previews
- macOS packaging now installs the complete Electron download dependency tree and preserves workspace-owned scoped packages

### [0.1.2]

#### Added

- In-app version check and update entry
- Terminal status bar with live cwd and git branch
- Workbench side panel with explorer and nested git scan
- Git log graph in workbench side panel
- Full en / zh-cn / ja localization; extension and desktop locales separated

#### Improved

- Project path in workbench detail header
- Nested git repos in terminal status bar
- Click status bar branch to switch via git IPC
- Git side panel actions and project-linked explorer
- Git log branch graph layout and node details
- Top bar icons and version update prompts
- Post-refactor path alignment and hardened desktop dev

#### Fixed

- Report parallel generation loading state in detail pane
- Update button vs About page status mismatch
- Electron install hoisted so dev binary is available
- Stale electron symlink removed before pack

### [0.1.1]

#### Fixed

- First launch no longer floods "data directory not found" when CLI agent dirs are missing
- Default agent paths no longer persisted as custom settings on save
- Absolute paths from other macOS users remapped to current home
- Startup sync status bar shows synced session count instead of treating warnings as errors

### [0.1.0]

#### Added

- **Report** — Calendar, daily/weekly/monthly digests, GTD bar, day detail
- **Agent** — Natural-language Q&A over digests
- **Workbench** — Session list with embedded or external terminal resume
- **Sessions** — Reference list and read-only preview
- **Notes** — Markdown note editor
- **Settings** — General, models, sessions, workbench, memory, data, usage

---

## 简体中文

### [0.2.17]

#### 新增

- **智能意图路由与自动角色分发**：在 IM 面板中引入智能意图分析器，根据用户问题自动识别并推荐匹配的专业角色进行任务分发，支持带交互确认的派发建议与快速触发
- **角色协作关系拓扑与自定义角色**：支持配置多角色协作委托关系链（如产品经理 → UI 设计师 → 开发工程师 → 测试工程师），具备依赖关系追踪、防循环派发保护及自定义 ACP 角色模板扩展
- **IM 项目管理与工作区本地关联**：支持为 IM 项目关联本地工作目录，引导角色将产物沉淀于 `.arp/` 目录，并支持嵌入项目知识库快照进行上下文增强
- **浮动时间轴导航**：在 IM 对话侧边新增时间轴视图，支持悬停消息预览、角色专属色彩标识及对话里程碑快速跳转
- **智能会话命名**：在用户发送首条消息时自动将默认标题提炼替换为问题摘要，并支持在右键菜单中手动触发基于大模型的「自动重命名」

#### 改进

- **多角色调度器（Conductor）与并发优化**：增强任务队列管理、只读角色并行分发、思考等级（Thought Level）动态传递以及思考过程与文本增量实时流式渲染
- **代理模型解析与消息展示优化**：完善各类 Proxy 模型响应解析器与工具调用修改文件追踪，优化角色头像、色彩回退与国际化文案

### [0.2.16]

#### 新增

- **IM 多角色群聊与 ACP Agent 调度**：引入支持多 Agent 协同的即时通讯（IM）群聊面板，提供内置角色模板（产品经理、项目经理、UI 设计师、开发工程师、测试工程师）与自定义 ACP 角色（接入 Pi、Claude、Codex 等），支持单条消息 `@` 多个角色并行分发、只读并行与写入串行调度、Markdown 转录渲染及背景知识快照
- **IM 划词动作与即时结果弹窗**：在 IM 消息中选中文本即可触发划词快捷操作（引用、翻译、解释或自定义 Prompt 动作），独立动作通过 Chat LLM 异步执行并在原地弹窗展示结果，自动记录使用量与 Token 消耗
- **以 Provider 为中心的 AI 模型池**：全新重构模型配置体系为统一 Provider 模型池（Base URL、API Key 及文本/图像/嵌入分类模型列表），支持一键探测（`GET /models`）与启发式分类，精细化分配各场景模型，并支持旧版配置自动平滑迁移

#### 改进

- **模型池智能回退与自动填充**：未显式指定功能模型时，自动从模型池中匹配对应类型的可用模型进行回退，并在新增模型时自动填充未配置的 Tool / Chat / Embedding 选项
- **LLM 错误详情提取与友好提示**：深度解析 API 响应 JSON 中的 `error`、`message` 与 `detail` 错误细节，在错误提示中携带 HTTP 状态码与模型名称，大幅提升排错效率
- **IM 提及标签展示与角色配置优化**：在消息气泡中以直观的内联标签展示被 `@` 提及的角色列表，并优化设置页「角色」面板的布局与滚动交互

### [0.2.15]

#### 新增

- **全局通知中心与铃铛面板**：在顶栏新增通知中心铃铛按钮与历史通知浮窗，并在 Workbench、Agent、Notes、看板、Report 及设置等各面板统一聚合系统提醒与后台任务通知
- **Workbench 会话批量选择与批量移除**：支持类似访达（Finder）的 Cmd/Ctrl 多选与 Shift 范围连选；支持从工具栏或右键菜单一键批量将多个会话从面板中移除（自动释放 ACP 会话控制器），并在工具栏实时展示选中数量，按 Escape 快速取消选择
- **Workbench 多仓库 Git 分组显示**：在工作区包含多个 Git 子仓库时，变更列表按仓库根目录分组聚合展示，支持按仓库一键暂存/取消暂存所有变更并保持分组折叠状态
- **内置浏览器文件上传 MCP 工具（`browser_upload`）**：在 `agent-resume-browser` MCP 中新增文件上传工具，通过 Chrome DevTools Protocol（`DOM.setFileInputFiles`）支持自动化向网页表单上传本地文件

#### 改进

- **会话转录文本交互与右键光标定位**：支持在 Markdown 转录面板中右键或点击时精准定位光标位置，便于快速选中文本与摘录内容
- **项目搜索交互与缺失路径容错**：优化工作台文件与项目搜索交互体验，当工作目录不存在或已被删除时给出友好的提示信息，并清理搜索错误通知中的 Electron IPC 包装层
- **数据库与 Schema 迁移稳定性**：统一 SQLite 数据库引擎底层依赖，提升并发初始化与迁移过程的稳定性

#### 移除

- **Flow DAG 实验模块**：移除早期 Flow DAG 画布及相关 MCP 流程调度工具（`flow_sync`、`flow_read` 等），聚焦优化项目笔记父子关联树与敏捷看板视图

### [0.2.14]

#### 新增

- **Ghostty Web 与 Xterm 双引擎终端架构**：在 **设置 → Workbench → 终端引擎** 中引入模块化终端适配器抽象，支持 Ghostty Web（Wasm/WebGL 极速渲染与原生级 GPU 加速）与 Xterm（Canvas/WebGL）双引擎无缝切换
- **Workbench 战役多级目录与工作区文件夹**：支持在项目下创建多层级战役文件夹归类会话，支持项目会话折叠展开、项目会话数聚合统计，以及自动将会话分配到聚焦的子文件夹
- **Workbench 会话自动重命名附带项目/目录上下文**：会话自动重命名时，标题末尾追加项目名与目录路径（如 `Fix renderer · app / Campaign / Phase 1`；未分类会话仅追加 `· app`），让项目与目录归属在树之外依然可见；后缀自动去重并按原生 180 字符上限截断
- **会话列表长标题悬停显示完整内容**：Workbench 与会话列表中被截断的长标题，悬停时以原生提示显示完整标题
- **内置工作台浏览器与 MCP 深度联动**：内嵌交互式网页浏览器面板，并集成 `agent-resume-browser` MCP 服务，供 CLI 与 ACP Agent 自动化控制（页面导航、可访问性 DOM 快照、点击、输入、等待与 Cookie 管理）
- **多维知识标签体系与标签分类视图**：为会话与笔记自动提取技术栈、业务域、架构模式、任务类型、问题域、概念知识与上下文环境等 7 个维度的知识标签，提供专属标签分类总览、筛选与共识权重衰减机制
- **全栈代码链路图（Link Graph）**：新增工作台 Link Graph 侧边栏与 MCP 工具（`link_graph_trace`），支持跨前端组件 → API 请求客户端 → HTTP 路由 → 后端控制器 → DTO/VO 的端到端字段与符号调用链深度追踪
- **项目笔记关联树、Flow 流程与看板视图**：支持拖拽管理项目笔记父子关联树，支持基于 DAG 依赖图的 Flow 流程调度与步骤状态回写，新增项目笔记看板视图（GTD 状态分栏、按列快速新建与快捷删除）
- **全局浮窗笔记与快捷速记（⌘⇧D / Cmd+D）**：全局快捷键一键唤起最近编辑笔记浮窗，支持项目快速归属选择、笔记内 Cmd+F 查找以及未编辑空笔记自动清理
- **Git 深度工作流支持**：支持代码变更块与行级暂存/取消暂存、行级变更回退、Git 分支图右键快速合并到当前分支、文件重命名历史与提交记录穿透查看
- **报告双向引用跳转与 Ask 工具增强**：日/周/月回顾正文引用支持点击一键直达对应报告与会话，Ask 工具支持 auto/custom/off 会话级记忆，Agent 输入栏支持项目限定上下文，并深度接入 Prime Agent（ACP 与 CLI）

#### 改进

- **全屏 TUI 会话滚动与控制优化**：通过真实滚轮事件改进 Claude Code、Prime Agent 等全屏 TUI 会话的滚动平滑度，提供主题自适应的回到顶部/回到底部浮动水滴控件，终端输入框支持无上限多行自适应增高
- **大文件 Git Diff 性能提升**：将大文件差异对比解析移至 Worker 后台线程，并增加暂态 `index.lock` 冲突重试机制
- **会话聚焦与快捷切换**：恢复已在工作台打开的会话时直接跳转聚焦不重复开标签，支持方向键在会话、终端与代码编辑器之间快速切换
- **会话转录面板增强**：扩展会话转录预览对多种 AI 工具调用的解析与展示，会话记录 Markdown 字号支持在设置中自定义

#### 修复

- **会话跨项目移动不再被同步回退**：将会话重新分配到其他项目后，归属会在多次同步后保持 —— catalog 单独记录 provider 的原生路径，同步不再把会话弹回原项目。把会话移回其原生项目即恢复自动路径跟随。
- **恢复被移动的会话时，agent 直接在新项目目录启动**：所有 provider 的恢复命令与终端工作目录都跟随归属项目，agent 在你移到的目录继续工作。Codex、Grok、OpenCode、Antigravity、Cursor CLI、Claude、Pi 与 Prime Agent 还会改写 provider 存储的 cwd，即使绕过面板直接 resume 也会在新项目启动（尽力而为；其余 provider 靠原生路径跟踪保持归属）。
- **桌面设置显式保存与状态编辑**：修复设置页面脏状态检查与显式保存持久化逻辑
- **Git 提交未跟踪目录末尾斜杠**：修复包含尾部斜杠的未跟踪目录在提交时被意外丢弃的问题
- **TUI 重绘视口跳动**：修复全屏 TUI 界面同步重绘后视口跳回顶部的问题

### [0.2.13]

#### 修复

- **笔记目标选择器层级与关闭逻辑**：修复特定主题下笔记目标选择器弹层的层级（stacking context）遮挡问题，并确保创建笔记失败时弹层能正确收起

### [0.2.12]

#### 新增

- **桌面视觉主题与设置同步**：在 **设置 → 视觉主题** 中新增应用全局主题支持（默认暗色、赛博朋克、DOS 琥珀、简约亮色）与跟随系统模式，并支持跨窗口与设置同步
- **CodeMirror 编辑器与差异对比主题联动**：为 Workbench 编辑器与 Git 差异对比视图统一主题配置，支持跟随应用主题及显式亮暗主题设置，提供 One Dark、Solarized、琥珀终端与赛博朋克等匹配配色
- **赛博朋克视觉特效与终端透明渲染**：为赛博朋克主题引入全屏坏屏粒子背景特效与顶部呼吸能量线动画，并为 Workbench 内置终端（xterm）开启透明背景渲染与主题边框强化

#### 改进

- **DOS 琥珀与主题配色优化**：优化应用主题语义色与 DOS 琥珀复古配色的对比度及面板视觉层级

### [0.2.11]

#### 新增

- **原生 Agent 对话备份**：在应用内备份（**设置 → 数据**）中支持将原生 CLI Agent（Claude、Codex、Gemini、Antigravity、OpenCode、Pi 等）的对话历史一并打包到本地 ZIP 或加密 iCloud Drive 备份（`.arbak`）中
- **备份与恢复进度反馈**：导出与恢复全过程提供带百分比、当前步骤与项目计数的实时进度条反馈
- **Workbench 资源管理器彩色文件图标**：为项目文件树中常见的编程语言、配置文件、资源图片与压缩包等提供丰富的图标与色彩样式

#### 改进

- **Report 分层摘要与刷新预算**：长会话日回顾引入两层分层摘要避免 Token 超限，并新增每日摘要刷新预算控制与进度显示
- **设置详情页布局**：优化设置分区详情页的最大宽度限制与响应式布局

#### 修复

- **笔记路径冲突与索引迁移幂等**：修复笔记同步时的路径冲突处理，并确保 SQLite 索引迁移的幂等性

### [0.2.10]

#### 新增

- **Workbench 文件历史**：右键资源管理器文件可查看全分支（含本地与远程跟踪分支）提交记录，并支持追溯重命名以前的历史
- **目录级 Git 改动回退**：支持在资源管理器与 Git 变更列表中右键选择目录并一键回退该目录下的全部 Git 改动
- **Git 变更右键菜单**：右键 Git 变更文件支持直接打开文件、复制绝对路径与相对路径

#### 改进

- **资源管理器与编辑器同步**：在编辑器中切换文件时，资源管理器会自动展开并高亮当前活动文件
- **Quick Access 搜索与项目切换**：优化大项目 Cmd+P 路径索引与匹配性能，修正快捷面板项目切换行为
- **设置国际化**：补充工具交互与执行追踪设置的英文、中文及日文国际化文案

#### 修复

- **Workbench 编辑器查找**：在编辑器查找输入框中按下 Enter 键现在可正确跳转到下一个匹配项

### [0.2.9]

#### 新增

- **Workbench Quick Access**：在打开文件或会话前，使用键盘友好的项目选择器快速切换项目
- **Workbench 文件操作**：在资源管理器中支持复制文件路径，以及剪切、复制、粘贴与删除文件
- **全量会话列表**：Workbench 与 Sessions 视图可全量展示合并的 Session 目录与 ACP 对话历史

#### 改进

- **Workbench 编辑器同步**：实时监听工作区文件变动，当磁盘文件发生修改或删除时提示冲突并刷新
- **Git 流程体验**：改进内嵌 diff 查找跳转、推送/拉取/提交通知提示，并保持编辑器与文件树状态同步
- **Workbench 导航交互**：优化项目选择、资源管理器刷新以及待绑定会话的操作可靠性

#### 修复

- 在资源管理器中复制路径统一步骤使用桌面端本地化文案
- Git 推送成功后自动清空提交信息输入框

### [0.2.8]

#### 新增

- **Workbench ACP 可视化聊天**：可直接创建或恢复 Claude Code、Codex、Grok Build、OpenCode、Pi 会话；ACP 对话会进入共用会话索引
- **ACP 设置与连接测试**：在 **设置 → Workbench** 配置 ACP Agent，开始工作前测试模型或 Agent 连接；无需输入提示时可复用最近可用命令
- **ACP 协作控制**：选择 Agent 支持的协作模式（如 **Plan**）、使用动态 `/` 命令菜单，并在 Workbench 内回答 Agent 提问
- **ACP 工具交互**：查看流式终端和文件系统操作、检查读取文件，并在操作继续前明确允许或拒绝权限请求

#### 改进

- **ACP 聊天体验**：Telegram 风格会话布局，工具状态、附件、命令提交和自动标题更清晰
- **ACP 会话可靠性**：完善本机共用存储、目录预览、外部文件变更监听、连接复用与会话恢复

#### 修复

- 空 ACP 会话预览不再报错
- 文件系统工具调用与授权提示可在聊天面板中正确展示和处理

### [0.2.7]

#### 新增

- **终端渲染器设置**：**设置 → Workbench → 终端渲染器**，可优先 WebGL（默认）或强制 Canvas 以改善中文排版稳定性；切换时不中断当前 PTY 会话

#### 改进

- **内嵌 xterm 中文排版**：拉丁等宽 + CJK 回退字体栈、Unicode 11 双宽、重叠字形缩放与更紧的 cell 度量，中英混排更整齐
- **WebGL 字形 atlas 刷新**：窗口缩放 / DPR / 主题变更后重建 atlas，避免悬停才「修好」的错位字形
- **开发态 i18n 热加载**：每次拉取文案包时重载 catalog，新增设置字符串无需整进程重启即可显示
- **React 设置 i18n 覆盖检查**：`i18n:check` 扫描 `renderer-react`，Workbench/设置 key 与 catalog 保持同步

#### 修复

- **xterm 悬停布局错乱**：默认仍优先 WebGL，context loss 时降级 Canvas；GPU atlas 仍异常时可强制 Canvas
- **设置文案缺失**：`desktop.settings.terminalRenderer*` 与 `desktop.common.save` 在 en / zh-cn / ja 下正确显示

### [0.2.6]

#### 新增

- **Workbench 项目内搜索**：侧栏 **Search** 可检索当前项目文件内容（区分大小写、整词、正则），点击结果在编辑器中跳到对应行
- **Workbench 脚本树**：在资源管理器或独立 **Scripts** 侧栏中发现并运行项目脚本（npm / pnpm / yarn / bun、Makefile、Gradle、Python、Cargo），命令写入当前终端
- **终端配色预设**：**设置 → Workbench → 终端主题**，提供 Default Dark/Light、Solarized Dark/Light、One Dark、Dracula；对已打开的 xterm 即时生效并持久化
- **按文件选择提交**：Git 面板可勾选变更文件后仅提交选中项，提交区布局更清晰
- **Git 跟踪状态提示**：资源管理器等位置展示跟踪 / 变更状态，便于快速定位改动
- **备份与合并恢复**：在 **设置** 中导出报告、笔记、ACP 聊天与向量索引；可选密码加密 API Key；合并导入时较新同名记录覆盖较旧记录
- **应用错误日志**：**设置 → 日志** 查看运行时与后台任务失败记录（敏感信息脱敏），支持清空与在访达中显示

#### 改进

- **Workbench 标题栏**：面板标题交互与国际化更完善
- **分支状态位置**：分支控件移至详情头部，菜单定位更稳定
- **标签 MRU**：关闭 Workbench 标签后激活最近使用的面板
- **斜杠命令菜单**：CodeEditor 的 `/` 菜单会适配视口，避免被裁切
- **MCP 进程模型**：注册客户端通过无界面 Node（`ELECTRON_RUN_AS_NODE` + core CLI）启动 Agent Resume MCP，避免每个 Agent 再多一个 Dock Electron 图标

#### 修复

- **终端剪贴板**：向 PTY 粘贴与从终端复制时使用正确文本编码
- **分支弹层**：移除多余关闭按钮，仍可通过外部点击关闭

### [0.2.5]

#### 新增

- **外部 Agent MCP**：可在 **设置 → MCP** 中为 Codex、Claude Code、Gemini CLI、Antigravity 与 OpenCode 注册统一的本机 `Agent Resume MCP` 服务；Cursor、Pi、Grok Build 可复制配置后手动接入
- **MCP Notes 访问**：外部 Agent 可分页列出全部已索引笔记、搜索和编辑 Notes、管理笔记 GTD、读取 Reports，以及查询和操作 Sessions
- **Cursor 会话集成**：Desktop 可索引、预览和恢复本机 Cursor Agent 会话
- **Notes GTD 斜杠命令**：在 Markdown 编辑器输入 `/` 可插入带状态标签的 GTD 快捷项；可用方向键选择、回车插入
- **Ask 来源链接**：Agent 回复中的报告、笔记和会话引用可直接打开对应的 Desktop 预览

#### 改进

- **Workbench 文件资源管理器**：更新文件树图标

#### 修复

- **Workbench 分支选择器**：外部交互关闭弹层时可正确收起

### [0.2.4]

#### 新增

- **Agent session 工具**：Meta-Agent 可通过 `session_search`、`session_list`、`session_read` 与 `session_read_transcript` 搜索、列出和读取本地 CLI 会话
- **混合会话回忆**：按标题、路径与摘要做关键词匹配；配置 embeddings 后还支持摘要向量语义搜索
- **会话引用与恢复**：Agent 回答可引用报告、笔记与会话；可查看预览、在 Desktop 中打开来源，或使用 **Resume** 在 Workbench 中继续引用的会话
- **自动会话摘要**：同步后为缺失摘要的会话生成摘要；会话更新后可在 **Settings → 会话** 设置静默延迟再刷新
- **会话语义索引**：支持 Transcript 分块检索、独立 Transcript 索引，以及带可配置调度与批量限制的摘要向量后台补齐
- **Agent 会话操作**：提供 `session_set_gtd` 与 `session_resume` 工具，并向 Agent 提供本机会话上下文
- **对话恢复**：可编辑并重发用户消息，或截断线程后从较早位置继续
- **GTD Done 状态**：在 Workbench 会话右键菜单中标记完成；完成会话收纳到默认折叠的 **已完成** 分组，并与 VS Code 扩展共用状态

#### 改进

- **Agent 执行流程与授权**：可查看检索、模型与工具步骤的输入、输出、耗时、来源和风险；写入、启动、命令与网络操作默认需要授权，破坏性或未知风险操作始终需要授权
- **Agent 安全与审计**：工具执行记录保存在本机，内容会做常见密钥脱敏和长度限制；笔记操作可在审计视图中查看
- **Agent 交互**：流式回答期间的上下文、引用、执行状态和输入栏布局更清晰
- **Workbench GTD 菜单**：状态选项改为带状态色的圆角标签；Reference 与 Done 使用不同颜色
- **GTD 分析**：更严格地识别状态，使 Report 与 GTD 工作流更准确地区分完成与可行动会话
- **Workbench 反馈**：Git 操作完成或失败时会显示应用内 Toast 通知

### [0.2.3]

#### 新增

- **设置辅助窗口**：偏好设置在独立单例窗口中打开（macOS Preferences 风格）；主窗口保持当前 Tab（Workbench 终端上下文不丢）
- 应用菜单 **设置…** 与 **⌘,** ；再次打开会聚焦已有窗口，并可跳到目标分区
- 保存后跨窗口广播设置 / 语言，主题、语言与 Workbench 选项会同步刷新主窗口

#### 改进

- **用量** 分区适配紧凑设置窗：固定 KPI 行、来源 chips、分 Tab 的明细表（指标与调用日志）

#### 变更

- **移除 Alma Provider 支持**：不再同步 / 恢复 Alma 会话；设置中的 Alma 目录与过滤项已删除
- **清理 catalog 中的 Alma 数据**：同步时硬删除 Alma 会话与仅含 Alma 的 projects；混合项目保留
- 请与 **Agent Resume Panel 扩展 ≥ 2.6.12** 共用同一 `panelHome`

#### 修复

- Workbench 项目列表隐藏无会话的 catalog 行（例如空的 Alma 应用数据壳）

### [0.2.2]

#### 新增

- Catalog 中 **一等 projects**（`project_id`、可移植键、按机器绑定本机路径）
- 跨机项目身份：相同 `~/…` 布局自动合并；路径不同时可「设置本机文件夹」
- Workbench 项目能力：从面板移除、置顶、设置本机路径、复制路径、Finder 显示、合并 / 拆分（高级）
- **设置 → Workbench → 项目右键菜单** 可勾选显示项（默认：新建 Session、挂载笔记、Finder 显示、从面板移除），并附功能说明
- Notes 侧栏项目与 catalog 对齐（共用置顶 / 路径状态）

#### 改进

- Session 同步后自动 reconcile 项目；隐藏 / 恢复项目会级联 session
- 路径缺失提示更清晰；Finder 显示在目录不存在时给出明确错误
- 外机用户 home 下的 session 显示「其他机器」标记

#### 修复

- 本机 local_paths 过期时，若真实目录仍存在，不再误报「本机未绑定」
- 清空项目别名不再删除 projects 行，个性化数据得以保留

### [0.2.1]

#### 新增

- Workbench 终端会话在切换面板时保活
- 改进模型配置体验与全局通知
- 右键菜单对齐 macOS 样式
- 侧栏分段筛选增加滑块动画，并优化暗色对比

#### 修复

- Git 刷新按钮在加载时显示转圈动画
- 暗色模式下代码与 Notes 编辑器使用 One Dark 提升对比度
- Workbench 会话列表 agent 标识对齐 Report 样式
- 终端随窗口缩放动态适配 PTY 尺寸
- 工作台会话活跃状态显示
- Workbench 中 Cmd+W 关闭当前面板

### [0.2.0]

#### 新增

- Desktop 渲染层迁移至 React，覆盖 Workbench、Agent、Notes、Report、Sessions 和 Settings
- React 原生实现 Workbench Git 变更、分支图、终端和文件编辑流程

#### 改进

- 终端执行 Git 操作后同步状态栏分支和 Git 图
- 修复 React 渲染层中 Notes 右键菜单宽度

### [0.1.4]

#### 新增

- AI 生成 Git 提交信息支持 Conventional Commits、Gitmoji 和自定义规则三种格式
- 新增 Desktop 环境诊断工具，检查 Node、pnpm、Electron 和 node-pty 配置

#### 改进

- 优化 Workbench 与 Notes 搜索工具栏的交互、动画和视觉一致性
- 提升 macOS 打包与部署稳定性

#### 修复

- 修复 Workbench 设置页的布局和样式问题

### [0.1.3]

#### 新增

- Workbench 内嵌文件编辑器，支持语法高亮、可编辑标签页，以及字号、缩进宽度和自动换行设置
- Git 提交与推送工作流，并支持 AI 生成提交信息建议
- 提交历史文件预览与行内差异查看
- 会话筛选、笔记置顶与可折叠的笔记搜索

#### 改进

- 增强 Git 差异视图与嵌套仓库处理
- 调整窗口大小时保持 Workbench 侧栏宽度稳定
- 进入 Workbench 时自动选中首个项目

#### 修复

- 修复提交历史预览中方向键无法正确切换文件的问题
- 补全 Electron 下载依赖，并在 macOS 打包时保留 workspace 自有的 scoped packages

### [0.1.2]

#### 新增

- 应用内版本检查与更新入口
- 终端状态栏（实时 cwd 与 git 分支）
- Workbench 侧边栏（资源管理器与嵌套 git 扫描）
- Workbench 侧边栏 Git 日志图
- 英文 / 简体中文 / 日文界面；扩展与 Desktop locale 分离

#### 改进

- Workbench 详情头显示项目路径
- 终端状态栏显示嵌套 git 仓库
- 点击状态栏分支通过 git IPC 切换
- Git 侧边栏操作与项目关联的资源管理器
- Git Log 分支图布局与节点信息
- 顶部栏图标与版本更新提示
- 重构后路径对齐与 Desktop 开发流程加固

#### 修复

- Report 并行生成时详情区 loading 错乱
- 更新按钮与 About 页状态不一致
- Electron 安装提升到根 workspace，dev 二进制可用
- 打包前移除过期的 electron 符号链接

### [0.1.1]

#### 修复

- 首次打开不再误报 Agent 目录错误
- 保存设置时不再把默认路径当成自定义路径持久化
- 跨账号绝对路径自动 remap 到当前用户 home
- 启动同步状态栏显示已同步 session 数量

### [0.1.0]

#### 新增

- **Report** — 日历、日/周/月回顾、GTD 条、日详情
- **Agent** — 对回顾的自然语言问答
- **Workbench** — 会话列表与内嵌/外部终端恢复
- **Sessions** — 参考列表与只读预览
- **Notes** — Markdown 笔记编辑
- **Settings** — 通用、模型、会话、工作台、记忆、数据、用量
