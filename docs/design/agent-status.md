# Agent 状态感知 — 技术方案

> 状态:已实现(0.2.27),待 dogfooding 与公证发布。
> 相关文档:设计过程与取舍见 [`agent-status-herdr-parity.md`](agent-status-herdr-parity.md);发布前人工验收见
> [`agent-status-acceptance.md`](agent-status-acceptance.md)。

本文是这套子系统的**实现规格**:它由什么组成、为什么这样切分、协议与规则的确切形态、怎么运维和排障。
代码位于 `apps/desktop/src/main/agentStatus/`(主进程 + 守护进程)与
`apps/desktop/src/renderer-react/features/workbench/sessionStatus/`(纯 UI 投影)。

---

## 1. 目标与非目标

**目标**

1. 一眼看出"哪个 agent 卡住了",并在点开之前就相信这个结论。
2. 状态与 UI 解耦:窗口关掉、面板未挂载、切到别的标签页,判定都照常进行。
3. 判定可解释:任何一次判定都能回答"命中了哪条规则、我读了屏幕的哪一段、其他规则为什么没命中"。
4. 规则是数据:改一条规则不需要改代码、不需要重新编译。
5. 全本地、零边际成本:不为了猜状态调用模型。
6. 窗口关闭后仍能感知(由常驻守护进程承担),并在无人看屏幕时通知用户。

**非目标**

- Windows(进程组与 tty 语义不同,见 §16)。
- 让 agent 在 App 退出后继续运行(需要把 PTY 所有权迁进守护进程,是另一个产品决策)。
- 扩展端(VS Code)的屏幕感知:VS Code 不提供终端原始输出,扩展只保留 ACP 原生状态。

---

## 2. 背景:为什么重写

旧实现(已删除)在渲染进程里跑三层:`fingerprint.ts`(硬编码正则识别对话框)+ `resolver.ts`(信任排名 + 迟滞)
+ `store.ts`(660 行采样循环),外加一个**在线 LLM 裁决**兜底。它有三个结构性问题:

1. **依赖 UI 挂载**:屏幕文本来自渲染进程的 xterm 实例,面板未挂载时只能靠 8KB tail 心跳,后台面板的状态不可信。
2. **全 agent 通用正则**:同一套关键词要覆盖 Claude/Codex/Pi/OpenCode 的所有版本,只能越写越松,误报随之而来。
3. **判定不可解释**:只能回答"这一 tick 是哪一层判的",无法回答"为什么不是那条规则"。

对照成熟实现(herdr)后确定的取舍:

| herdr 的做法 | 本项目是否采纳 | 理由 |
| --- | --- | --- |
| 常驻 server 拥有 PTY,客户端 attach/detach | **部分**:守护进程承担判定与上报,PTY 仍归 App | 完整采纳等于重做终端服务化(见 §16 D2) |
| 声明式 per-agent TOML 规则 + region + priority | **采纳**,改为 JSON + 本项目 region 集合 | 规则即数据是这套东西可维护的前提 |
| 每 pane 单一权威(装了钩子就不跑屏幕规则) | **采纳** | 两个真相源必然打架,旧实现的迟滞就是证据 |
| 规则热更新(远程 manifest) | **暂缓**,先做本地 override | 自用场景下本地覆盖足够,远程需要托管与信任模型 |
| 钩子把状态写进她的 socket | **采纳**(unix socket + 包装脚本 + 极简 CLI) | 与既有 `mcpRegistration` 的配置写入范式一致 |
| 把通用规则复制进每个 agent 规则包 | **不采纳**:改为**分层**(基础层 + agent 层) | 复制必然漂移 |
| 在线模型裁决 | **不采纳**:保留为离线挖规则工具 | 成本、延迟,以及屏幕内容外发 |

---

## 3. 架构总览

按"谁拥有字节,谁负责采集;判定集中在一处"切三层:

```
┌─ Electron 主进程(传感器,与 PTY 同生共死)─────────────────────────┐
│  ptyHost.ts        字节流进出、注入 AGENT_RESUME_PANE_ID、剥离状态序列 │
│  agentStatus/                                                       │
│    mirror.ts       每 pane 一个 @xterm/headless 屏幕镜像             │
│    scan.ts         OSC 0/2 标题、OSC 9;4 进度、DEC 25 光标、状态序列  │
│    processTable.ts ps 表(pgid/tpgid/tty/comm + argv)                 │
│    identity.ts     进程 → agent(解释器解包、会话键提示)               │
│    sensor.ts       每 1s 组帧并发布 telemetry                        │
│    bridge.ts       断线自愈的守护进程客户端                           │
│    ipc.ts          渲染层接口(快照推送 + 设置动作 + 诊断读取)         │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ unix socket,JSON lines,telemetry.publish
                            ▼
┌─ agent-status 守护进程(判定器,常驻,无 Electron 依赖)─────────────┐
│  server.ts        传输 + 订阅广播                                    │
│  state.ts         每 pane 记录、每帧一次规则求值与迟滞、state.json    │
│  engine/          manifest 编译 / region 切片 / 求值 / 仲裁 / 注册表  │
│  engine/manifests 5 份规则包(34 条规则)                              │
│  discovery.ts     发现本 App 之外的 agent                            │
│  notify.ts        无窗口连接时的 macOS 通知                          │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ status.changed
                            ▼
┌─ 渲染进程(纯消费者)─────────────────────────────────────────────┐
│  useAgentStatus    快照 → 圆点;useAcpStatus ACP 会话生命周期(本地)   │
│  activeSessionDots 工作台 / 侧栏 / 托盘共用                          │
│  AgentStatusPane   设置 → 后台状态:守护进程健康、钩子安装、逐 pane 解释 │
└─────────────────────────────────────────────────────────────────────┘
```

**为什么镜像必须跟 PTY 同进程**:它需要完整字节流才能重建屏幕;判定集中则保证只有一份真相、一份规则缓存、
一个可解释的来源。两者用 socket 相连,所以 App 关闭不影响守护进程继续接收**钩子上报**与外部 agent 发现。

### 3.1 能力矩阵(必须如实对外表述)

| 场景 | 自有 pane 屏幕 | 钩子上报 | 本 App 之外的 agent |
| --- | --- | --- | --- |
| App 运行、窗口可见 | ✅ | ✅ | ✅(进程证据,无屏幕判定) |
| 仅关窗(macOS 常驻 Dock) | ✅ | ✅ | ✅ |
| App 完全退出、守护进程存活 | ❌(它的 PTY 已随 App 消失) | ✅ | ✅ |
| 守护进程停止 | ❌ | ❌ | ❌ |

---

## 4. 判定模型

### 4.1 状态词汇

`AgentState = idle | working | blocked | unknown`
`AgentKind = claude | codex | pi | opencode | grok | cursor | agy | prime | unknown`
(八种来自仓库自己的 `buildResumeCommand`,即 App 真能恢复会话的 agent。)

UI 词汇是投影:`blocked → 等待你`,`working → 运行中`,`idle/unknown → 不显示圆点`(宁可少提示,不可误报);
`connecting/error` 只来自 ACP,不由守护进程产生。

### 4.2 信任顺序(整套设计里最重要的部分)

| # | 来源 | 判据 | 说明 |
| --- | --- | --- | --- |
| 1 | `native` | 钩子/状态序列上报 | agent 自己说的,压过一切 |
| 2 | `process` | 前台进程组里有命令 | 内核作业控制,不是推断 |
| 3 | `screen` | 命中的规则带 `skipStateUpdate` | 屏幕是 viewer(转录/历史),保留上一次状态 |
| 4 | `screen`/`osc` | 命中的规则带 `visibleBlocker` | **正在绘制**的对话框,压过"画它的输出" |
| 5 | `activity` | 250ms 内仍有输出 | 活跃流压过屏幕上残留的旧对话框 |
| 6 | `screen`/`osc` | 其他规则命中 | 普通屏幕证据 |
| 7 | `screen` | 迟滞窗口内上一帧的告警 | 抗重绘抖动 |
| 8 | `fallback` | 都没有 | `idle`,不猜 `blocked` |

顺序本身就是设计:第 4 条先于第 5 条,第 5 条先于第 6 条。少了任何一条,要么旧对话框长期挂着,
要么正在弹的对话框被自己的输出盖掉。

**单权威是“连算都不算”**:权威一旦变成 `native`,守护进程不再对该 pane 求值屏幕规则(`applyScreenFrame` 直接返回,`explain.evaluated` 为空)。这样 explain 里不会出现一堆没人使用的规则行,也让“每个 pane 只有一个真相源”在实现层成立。

**迟滞**:只在屏幕分支生效。命中立刻确认;未命中需要连续 2 帧才清除;`visibleIdle`(屏幕明确显示
实时输入框)立即清除。**每帧只推进一次**,且推进发生在 telemetry 到达时——所以读快照永远不会改变判定。

### 4.3 规则包分层

`generic` 是**基础层**,对每个 pane 都生效;agent 规则包只补自己 UI 需要的东西。
求值时把两层拼成一个规则列表(agent 规则在前),优先级相同则 agent 胜出;`explain` 会报出参与的两层。

这样每个 agent 都能白拿基础层的对话框/选项列表规则,而 agent 规则写错也不会让别的 agent 失明。
(herdr 的做法是把基础规则复制进每个 agent 文件,本项目不采纳:复制必然漂移。)

---

## 5. 规则包 schema

规则是 JSON 数据,编译期做校验与正则预编译(`engine/manifest.ts`)。字段:

| 字段 | 含义 |
| --- | --- |
| `id` | 规则标识,出现在圆点提示与 explain 中 |
| `state` | 命中后的状态:`blocked` / `working` / `idle` / `unknown` |
| `priority` | 数字,越大越强;命中多条时最高者胜 |
| `region` | 读屏幕的哪一段(见下) |
| `contains` | 必须出现的文本(大小写不敏感) |
| `regex` | 必须**全部**匹配的正则 |
| `lineRegex` | 行级正则;`atLeast: n` 表示需要至少 n 行命中(默认 1 行) |
| `cursorHidden` | 要求光标隐藏(DEC 25),用于给单个选项行背书 |
| `all` / `any` / `not` | 嵌套 gate:一个 gate 内部的多个条件之间是"与";**备选要写成并列的多个 gate** |
| `visibleIdle` / `visibleBlocker` / `visibleWorking` | 参与仲裁顺序与迟滞清除(见 §4.2) |
| `skipStateUpdate` | 这是"viewer"声明,不是 pane 状态 |

两个 schema 决策值得单独说明:

- **换行容错**:镜像会**撤销软折行**(终端把一条长行断成两行,这里合成一条逻辑行),所以规则字面量(`esc to cancel`)在窄面板里被折断也照样命中;若字面量被应用自己断成两条逻辑行,匹配器还有第二次机会:把逻辑行用空格拼接后再匹配一次(命中时 explain 标注 `matched across a line wrap`)。行级模式(`lineRegex`/`atLeast`)始终按**真实行**计数,不受拼接影响。
- **`atLeast`** 是"至少 N 行长得像选项",它是"菜单"与"恰好含箭头的散文"的分界线,也是旧实现证据计数的声明式形式。
- **大小写不敏感**统一施加于 `contains` 与正则:同一 TUI 文案跨版本会变大小写,匹配的是形状而非拼写。

### 5.1 region 集合

| region | 取哪一段 |
| --- | --- |
| `whole_recent` | 整个屏幕快照(可见屏 + 5 行 headroom) |
| `bottom_non_empty_lines(n)` | 末尾 n 个非空行 |
| `top_non_empty_lines(n)` | 开头 n 个非空行 |
| `after_last_horizontal_rule` | 最后一条纯分隔线(`────` 等)之后 |
| `osc_title` / `osc_progress` | 终端标题 / OSC 9;4 进度 |

`after_last_horizontal_rule` 针对 Claude 这类"分隔线 + 对话框"的画法:它把聊天正文排除在外,
这正是"用户昨天打的字不能被当成审批对话框"的解法。

### 5.2 现状与覆盖

| 规则包 | 规则数 | 主要内容 |
| --- | --- | --- |
| `generic`(基础层) | 12 | 计划模式选择器、Claude/Codex 风格审批、等待批准、y/n 许可、中文确认、选项列表(需佐证) |
| `claude` | 8 | transcript viewer、`after_last_horizontal_rule` 对话框、bash 审批、标题 spinner、`esc to interrupt`、提示框 idle、标题/进度 idle |
| `codex` | 8 | 标题 `Action Required`、viewer、标题 spinner、信任目录、强阻断、working footer、弱 y/n、标题 idle |
| `opencode` | 3 | permission panel、中断提示、进度条 |
| `pi` | 1 | `Working...`(pi 通常由伴随扩展上报,规则只是兜底) |

**夹具纪律**:`engine/fixtures/<agent>/<case>.txt` + `expected.json`,当前 19 个用例,断言
**命中规则**与**来自哪一层**,以及 `skipStateUpdate`/`visible*` 标志。harness 会反向检查
"每份规则包都有夹具""每个夹具都有期望"。

### 5.3 本地覆盖

`<panel home>/.desktop/agent-detection/<agent>.json` 按 id 替换内置规则包,`explain` 里标记为
`source: override`。非法覆盖只忽略并告警,不会让检测失效。

---

## 6. 信号来源

| 来源 | 实现 | 说明 |
| --- | --- | --- |
| 屏幕镜像 | `mirror.ts` + `@xterm/headless` | 每 pane 一个实例;与渲染层**同宽度表**(Unicode 11,否则 emoji 折行位置不同)、**撤销软折行**;`flush()` 等解析完成再快照(xterm 解析是异步的) |
| 终端转义 | `scan.ts` | 状态序列 `ESC ] 633 ; AR ; …`、OSC 0/2 标题、OSC 9;4 进度、DEC 25 光标;**跨 chunk 进位缓冲**避免序列被切断 |
| 进程身份 | `identity.ts` | 可执行名 → agent;`node|bun|deno` 后跟脚本名时解包(pi 就是这种 npm 安装形态);会话键 `cli:<provider>` 作为声明式兜底 |
| 前台作业 | `processTable.ts` | `ps -Ao pid=,ppid=,pgid=,tpgid=,tty=,comm=` + 独立 `pid=,args=`;`tpgid` 即该终端的前台进程组 |
| 钩子上报 | `integrations/*` + `cli.ts` | agent 自己汇报生命周期事件(见 §8) |
| 外部发现 | `discovery.ts` | 进程表里不属于任何 pane 的交互式 agent;状态只来自其终端前台组,无屏幕判定 |

**两次 `ps` 是有理由的**:`comm` 可能是含空格的路径(`/Applications/Agent Resume.app/…`),
与 `args` 无法在一次输出里无歧义划界;各自保持"最后一列"的格式即可安全解析。

**状态序列的语义**:`awaiting → blocked`、`running → working`、`idle → idle`。它由 pi 伴随扩展写入
stdout,传感器扫描后转为 `native` 上报——因此 pi 的精确度与钩子同级,不需要第二条通道。

---

## 7. 守护进程

### 7.1 生命周期与文件

| 文件 | 位置 | 说明 |
| --- | --- | --- |
| 入口 | `<app>/dist/main/agentStatus/daemon.js`(打包后在 `app.asar` 内) | 用 `ELECTRON_RUN_AS_NODE=1` 以纯 Node 运行,不加载 Electron |
| endpoint | `<panel home>/.desktop/agent-status/endpoint.json` | `{apiVersion, appVersion, pid, socketPath, startedAt, updatedAt}`,0600 |
| 状态快照 | `<panel home>/.desktop/agent-status/state.json` | 只存 pane 身份 + 原生上报,**不存屏幕文本** |
| 日志 | `<panel home>/.desktop/agent-status/daemon.log` | 启动时打印已加载规则包清单 |
| socket | `<tmpdir>/agent-resume-status-<uid>-<profile-hash>.sock` | 0600;见下 |
| 登录启动 | `~/Library/LaunchAgents/dev.agentresume.agent-status.plist` | `RunAtLoad` + `KeepAlive{SuccessfulExit:false}` + `ThrottleInterval 5` |

**socket 为什么在 tmpdir**:macOS 的 unix socket 路径上限约 104 字节,`<panel home>/.desktop/agent-status/daemon.sock`
在长用户名或长 panel home 下直接 `listen EINVAL`(实现时实测踩到)。tmpdir 路径短且按用户私有,
endpoint 文件仍是唯一的发现来源并记录真实 socket 路径。

**单实例与升级**:启动时读 endpoint,存活实例直接退出;`--replace` 用于升级——协议新增方法会
`AGENT_STATUS_API_VERSION + 1`,App 启动发现版本不匹配就替换守护进程。这条不是洁癖:
实现期间真的遇到过一个旧构建留下的守护进程,它照常回答 `status.snapshot`,却拒绝新方法。

**退出语义**:打包版在 App 退出时**不停**守护进程(这正是"关窗后仍能通知"的前提);dev 版退出时停掉,
避免每次热重载留下孤儿。

### 7.2 通知

`notify.ts`:某 pane **进入** blocked 且**当前没有窗口连接**(`subscriberCount === 0`)时,
用 `osascript -e 'display notification …'` 通知。只在跃迁时触发;打包版由 `--notify` 打开,
dev 不打开(否则开发时天天弹窗)。

### 7.3 外部 agent 发现

`discovery.ts` 每 5 秒扫一次进程表,找出:`tty` 存在(交互式)、能识别为 agent、且不属于任何已跟踪 pane
(沿 `ppid` 向上追溯到 pane 的 ptyPid)。外部 pane 的 id 为 `-pid`,与正数的 PTY id 不可能冲突。
它们以 telemetry 形式喂入同一套判定,`toolRunning` 来自其自身终端的前台进程组——
所以外部 agent 有**进程证据**,永远没有屏幕判定。

---

## 8. 钩子集成

### 8.1 安装清单

| Agent | 位置 | 事件 → 状态 |
| --- | --- | --- |
| Claude Code | `~/.claude/settings.json` | `SessionStart`→idle、`UserPromptSubmit`→working、`PreToolUse`→working、`Notification`→**blocked**、`Stop`→idle |
| Codex | `~/.codex/hooks.json` + `config.toml` 的 `[features] hooks = true` | `SessionStart`→idle、`UserPromptSubmit`→working、`PreToolUse`→working、`PermissionRequest`→**blocked**、`Stop`→idle |
| Pi | `~/.pi/agent/extensions/agent-resume-bridge.ts`(App 自动写入) | 提示开始→awaiting、轮次开始→running、轮次结束→idle |

**状态在安装时确定**:每个事件注册一条固定状态的命令,钩子不需要解析 payload;
payload 只在包装脚本里被粗略 grep 出 `session_id`(作为 session 归属),并**跳过带 `agent_id` 的子 agent 事件**——
子 agent 不能夺走 pane 的状态。

### 8.2 包装脚本与门禁

`<panel home>/.desktop/agent-state/agent-resume-status-<agent>.sh`:

1. **门禁**:`AGENT_RESUME_PANE_ID` 为空直接退出。该变量只由本 App 派生的 pane 注入,
   所以全局安装的钩子在别人的终端里什么也不做。
2. **静默**:所有输出重定向到 `report.log`。部分 agent 会把 hook stdout 当指令解析,钩子绝不能污染它。
3. **永不失败**:任何路径 `exit 0`,不阻塞 agent 的关键路径。
4. 调用 App 自带 Node 运行时执行 `cli.js report --pane … --state … [--session-ref …]`。

### 8.3 配置编辑策略

写入用户全局配置是这套东西里风险最高的部分,`integrations/config.ts` 的约束:

- 未知键原样保留;别人的钩子绝不触碰;只删除命令指向我们包装脚本的条目。
- 解析失败的文件**只报告不改写**(宁可不装,也不能毁掉用户配置)。
- 内容不变就不写文件(重复安装不 churn mtime)。
- Codex 的 `[features] hooks = true` 按行编辑:走 TOML 解析器会重排格式并丢掉注释。
- 卸载时,只有当自己的钩子确实清空后才撤掉 `features.hooks`。

**OpenCode 暂不提供安装器**:它的插件注册方式跨版本不同(TUI 插件目录 / CLI `cli.json` 列表 / v2 目录),
写错一个会直接改坏用户配置,代价大于收益;它继续靠屏幕规则 + 进程身份覆盖。

---

## 9. 线协议(v2)

传输:unix domain socket,JSON lines;`hello` 握手校验 `apiVersion`。

| 方法 | 方向 | 说明 |
| --- | --- | --- |
| `hello` | App/CLI → daemon | 版本握手;返回 `{apiVersion, appVersion, pid, startedAt, paneCount, subscriberCount}` |
| `telemetry.publish` | App → daemon | 传感器帧:屏幕文本、OSC、光标、`toolRunning`、agent 身份 |
| `pane.report_state` | 钩子 CLI → daemon | `{paneId, source, agent, state, seq, sessionKey?, sessionRef?, subagent?}`;`seq` 非递增则丢弃 |
| `pane.forget` | App → daemon | pane 关闭,丢弃记录 |
| `status.snapshot` | App → daemon | 全量快照(pane 级 + 会话键级) |
| `status.explain` | App → daemon | 逐条规则的解释(见 §10.2) |
| `status.manifests` | App → daemon | 已加载规则包(设置面板与 doctor 使用) |
| `pane.screen` | 工具 → daemon | 诊断:规则读到的屏幕文本 + 当前判定(夹具采集用) |
| `status.subscribe` | App → daemon | 之后推送 `status.changed` |
| `daemon.shutdown` | 任意 → daemon | 优雅退出(清 socket、落盘、删 endpoint) |

**安全**:只监听 unix socket,不做 TCP 监听——127.0.0.1 端口对任意网页可达,unix socket 不是;
目录 0700、socket/endpoint/state 0600;不落任何密钥;状态文件不存屏幕文本。

---

## 10. UI 集成

### 10.1 圆点

`useAgentStatus` 订阅快照并把 `AgentState` 投影为圆点;`activeSessionDots` 汇总工作台/侧栏/托盘。
ACP 聊天不是 PTY pane,它的生命周期留在渲染进程(`useAcpStatus` 直接读 ACP 流),与守护进程的状态合并展示。

### 10.2 设置 → 后台状态(同时也是检查器)

一个页面回答四个问题:

1. 守护进程活着吗(pid、API 版本、连接窗口数、已加载规则包、socket 路径、launchd 是否注册);
2. 哪些 agent 装了钩子(可安装/卸载,未检测到则禁用按钮);
3. 守护进程在跟踪哪些 pane(含外部 agent);
4. **某一个 pane 为什么是这个状态**:命中的规则、参与的两层规则包、每条被考虑规则的原因、
   以及规则读到的原始屏幕文本。

第 4 项是这套东西可维护的关键:误判不再需要靠猜,直接看到引擎眼里的世界。

---

## 11. 持久化与隐私

- `state.json` 只保存 pane → 身份、会话键、原生上报(含 seq)与权威归属;**不保存屏幕文本、不保存 transcript**。
- 屏幕文本只存在于守护进程内存中的 telemetry 帧里,进程结束即消失。
- 不为了判定调用任何外部服务(在线模型裁决已移除);`agent-status:mine --propose` 才会主动调用已配置模型,
  且只在开发者手动执行时。
- 规则包与覆盖文件是纯文本,不含用户数据。

---

## 12. 模块清单

`apps/desktop/src/main/agentStatus/`(传感器 + 守护进程共 6.4k 行含测试):

| 文件 | 职责 |
| --- | --- |
| `types.ts` / `../../shared/agentStatusTypes.ts` | 协议与跨进程词汇(共享类型给 preload/渲染层) |
| `paths.ts` / `endpoint.ts` | 路径推导(含 socket 短路径)与原子写/权限 |
| `server.ts` / `client.ts` | socket 传输、订阅、握手 |
| `mirror.ts` / `scan.ts` | 屏幕镜像与转义扫描 |
| `processTable.ts` / `identity.ts` | 进程表、前台作业组、agent 命名 |
| `arbitrate.ts`(engine/) | 仲裁与迟滞(§4.2) |
| `sensor.ts` | 组帧与发布、`AGENT_RESUME_PANE_ID` 之外的进程探测 |
| `bridge.ts` / `ipc.ts` / `runtime.ts` | 主进程与守护进程、渲染层的桥 |
| `state.ts` | 每 pane 记录、每帧求值、持久化、explain/screenDump |
| `daemon.ts` | 入口、单实例、心跳、优雅退出、通知与发现的宿主 |
| `lifecycle.ts` | 重启/替换、launchd 安装与卸载、状态读取、入口路径解析 |
| `engine/manifest.ts` / `region.ts` / `evaluate.ts` / `registry.ts` | 规则编译、切片、求值、分层与覆盖 |
| `engine/manifests/*.json` | 5 份规则包(34 条规则) |
| `integrations/` | 钩子安装器、包装脚本、配置编辑、pi 扩展 |
| `cli.ts` | 钩子上报 CLI(打包后经 `ELECTRON_RUN_AS_NODE` 执行) |
| `discovery.ts` / `notify.ts` | 外部 agent 发现 / 无人看屏幕时的通知 |

渲染层:`sessionStatus/{types,useAgentStatus,useAcpStatus,index}.ts`(243 行)+ `settings/AgentStatusPane.tsx`(267 行)。
旧的 `sessionStatus/{store,resolver,fingerprint,protocol,react}.ts`(约 1900 行含测试)已整体删除。

---

## 13. 测试与验证

| 层次 | 手段 | 位置 |
| --- | --- | --- |
| 规则引擎单测 | region / gate 语义 / 优先级 / 迟滞 / 分层与覆盖 | `engine/*.test.ts`(57 例) |
| 黄金夹具 | 19 个屏幕样本 × 期望状态 + 命中规则 + 来源层 | `engine/manifests.test.ts` + `engine/fixtures/` |
| 传感器单测 | 转义扫描(含跨 chunk)、镜像(含异步解析)、进程表/身份、发现、通知 | `agentStatus/*.test.ts` |
| 钩子配置单测 | 幂等、仅删自己的条目、保留他人钩子、TOML 行编辑 | `integrations/config.test.ts`(15 例) |
| 协议集成 | 真实守护进程:单实例、权限、握手、遥测→快照、seq 乱序、订阅、重启恢复、`--replace`、App 侧 ensure/stop | `scripts/agent-status-daemon.test.mjs`(18 步) |
| 真实 pty 探针 | 在真 pty 上打印 tty/pgid/tpgid/组成员/`toolRunning`,退出码即结论 | `scripts/process-foreground-baseline.mjs` |
| 全链路演示 | 把一屏字节走完 字节→旁路信号→屏幕文本→规则→守护进程快照,并逐条断言(含折行容错、宽度表、native 跳过规则) | `scripts/agent-status-pipeline-demo.mjs` |
| 打包验证 | `app.asar` 内含 daemon/cli/manifests;打包二进制启动守护进程;打包 CLI 上报被应用为 native | 人工(见验收文档) |
| 环境自检 | `doctor:desktop` 报告守护进程 pid/API/规则包与已安装钩子 | `scripts/doctor-desktop.mjs` |

当前基线:renderer **108 文件 / 1049 例**、core **204 例**、桌面脚本链 **5/5**、状态子系统单测 **141 例**、
`agent-status:mine` 输出 `0 stale`。

---

## 14. 运维手册

**某个 pane 状态看起来不对**

1. 设置 → 后台状态 → 找到该 pane → **查看原因**:看命中规则、参与层、每条规则的原因、屏幕文本。
2. 若屏幕文本与终端实际显示不一致 → 问题在传感器(镜像/扫描),不是规则。
3. 若是规则缺失或过松:
   ```
   pnpm --filter @agent-resume/desktop run agent-status:capture -- --pane <id> --name <case>
   # 把打印出的期望条目写进 engine/fixtures/expected.json
   # 改规则包,然后
   pnpm --filter @agent-resume/desktop run test:agent-status
   ```
4. 只想临时改行为:把规则包复制到
   `~/.agent-resume-panel/.desktop/agent-detection/<agent>.json` 改优先级/条件,重启守护进程即可。

**想看清整条链路**(把一屏字节从 PTY 走到快照,并逐条断言):

```bash
pnpm --filter @agent-resume/desktop run build
node apps/desktop/scripts/agent-status-pipeline-demo.mjs
```

**守护进程相关**

| 症状 | 处理 |
| --- | --- |
| 设置页显示未运行 | 点"启动";仍失败看 `<panel home>/.desktop/agent-status/daemon.log` |
| 钩子没生效 | 看 `<panel home>/.desktop/agent-state/report.log`;确认 pane 内有 `AGENT_RESUME_PANE_ID` |
| 升级后行为反常 | 多半是旧守护进程:确认 `endpoint.json` 的 `apiVersion`,App 启动会自动替换 |
| 想彻底卸载 | 设置里移除各 agent 钩子 → 停止守护进程 → 删 `~/Library/LaunchAgents/dev.agentresume.agent-status.plist` → 删 `<panel home>/.desktop/agent-status` 与 `.desktop/agent-state` |

---

## 15. 发布(0.2.27)

破坏性变更(已写入 CHANGELOG 中英双段):

- **移除**在线 LLM 状态裁决及其设置项与调用预算;
- **新增**常驻后台守护进程(可在设置中启停);
- 状态检测从渲染进程迁至主进程 + 守护进程,旧的 `sessionStatus` 三层实现删除;
- `terminal:activity` 尾部流删除。

发布步骤:`pnpm run merge:desktop-i18n && pnpm run i18n:check` → `pnpm run test:desktop` →
`pnpm run pack:desktop`(已在本机产出 arm64/x64 DMG 并验证打包内守护进程可启动)→
按 [`agent-status-acceptance.md`](agent-status-acceptance.md) 逐条人工验收 →
`pnpm run release:desktop:mac`(从 CHANGELOG 提取 0.2.27 段落,需要 Developer ID 公证)。

---

## 16. 已知缺口与后续工作

| 缺口 | 影响 | 现在的状态 |
| --- | --- | --- |
| Dogfooding 未进行 | per-agent 夹具是按另一项目捕获的形态重建的,真实 TUI 版本可能不同 | 首个维护动作:用 capture 替换为真实屏幕 |
| OpenCode 无钩子安装器 | 精度等同其他 agent 的屏幕规则,而非原生上报 | 见 §8.3 的理由 |
| 外部 agent 无屏幕判定 | 只能报"在跑/在等钩子上报",看不出对话框 | 钩子是正解(需要 pid 归属,见 D2 前置) |
| 无 marker 类 region(`prompt_box_body` 等) | 个别规则用 `bottom_non_empty_lines(n)` 近似 | 有真实屏幕证明不足时再加 |
| 远程规则包热更新 | 规则修复需要随版本发布 | 本地覆盖已可用;远程需要托管与信任模型 |
| Windows | 不支持状态感知 | 需要 ConPTY 下另一套进程组/tty 逻辑 |

**D2(未纳入本次)**:把 PTY 所有权迁进守护进程,使 agent 在 App 退出后继续运行。
它会让"感知"升级为"终端服务化"(attach/detach、replay、resize、会话恢复、崩溃接管),
工作量和风险都是另一档,且不影响状态感知的正确性。
