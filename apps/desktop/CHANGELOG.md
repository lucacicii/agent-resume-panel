# Changelog

Languages: [English](#english) | [简体中文](#简体中文)

Desktop release notes for [agent-resume-desktop-doc](https://github.com/thunder-luc/agent-resume-desktop-doc) releases. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Update this file before each Desktop release (`pnpm run release:desktop:mac`).

## English

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
