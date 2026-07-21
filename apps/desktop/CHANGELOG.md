# Changelog

Languages: [English](#english) | [简体中文](#简体中文)

Desktop release notes for [agent-resume-desktop-doc](https://github.com/thunder-luc/agent-resume-desktop-doc) releases. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Update this file before each Desktop release (`pnpm run release:desktop:mac`).

## English

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
