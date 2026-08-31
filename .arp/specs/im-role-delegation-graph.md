# IM 角色协同调用拓扑图与任务流转设计规范 (IM Role Delegation Graph Specification)

## 1. 背景与目标 (Background & Objectives)

Agent Resume Desktop 的 IM 模块当前支持多人项目房间，用户可以通过 `@Role` 手动向单个或多个角色（如 Product Manager, Architect, Developer 等）派发任务。当前各角色间是割裂孤立的，角色在完成自身工作（如需求分析、架构规划、UI设计）后，无法自动或半自动地将产出下发给下游角色。

本方案旨在建立 **IM 角色间的可调用拓扑关系（Role Delegation / Handoff Graph）**：
1. **拓扑调用矩阵**：预置符合标准软件工程研发流程的默认调用关系，并支持在设置中自定义配置。
2. **决策下发协议**：角色完成当前任务后，根据自身产出与上下文，主动判断是否需要向下游角色下发任务并生成结构化任务简报。
3. **确认与自动指派机制**：默认进入「用户确认（Human-in-the-Loop）」流转卡片，用户可一键确认、修改后派发或忽略；同时支持在「Settings → IM」中配置开启「自动指派（Auto-Dispatch）」，实现无人值守的自动化流水线串联。
4. **环路与安全防范（Loop & Depth Guard）**：内置最大调用深度与环路检测机制，防止 Agent 间产生无限递归死循环。

---

## 2. 默认调用拓扑矩阵 (Default Delegation Matrix)

| 上游角色 (Caller / Source Role) | 默认可调用下游角色 (Callees / Target Roles) | 典型协作场景 |
| :--- | :--- | :--- |
| **Project Manager (项目经理)** | Product Manager, Architect, Tester, UI Designer | 拆解整体项目计划，指派需求细化、技术方案、测试计划与界面设计 |
| **Product Manager (产品经理)** | Architect, UI Designer, Tester | 需求 PRD 定稿后，发起架构方案设计、原型视觉设计与测试用例准备 |
| **Architect (架构师)** | Developer | 技术方案与模块设计完成后，下发具体代码实现任务给开发角色 |
| **UI Designer (UI 设计师)** | Developer | 视觉与交互规范确定后，下发前端组件与界面还原任务给开发角色 |
| **Developer (研发工程师)** | *(默认无，叶子节点)* | 编码实现与自测（可按需在设置中配置调用 Tester） |
| **Tester (测试工程师)** | *(默认无，叶子节点)* | 验收与测试用例执行 |

---

## 3. 架构分层与模块边界 (Architecture Layers & Module Boundaries)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Renderer UI (React)                            │
│  - ImPanel / MessageTimeline (Delegation Proposal Action Card)          │
│  - ImSettingsPane (Role Callable Matrix Editor & Auto-Dispatch Toggle)   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ IPC (im:dispatchProposal, im:dismissProposal, im:updateTemplate)
┌────────────────────────────────────▼────────────────────────────────────┐
│                       Main Process - IM Conductor                       │
│  - Dispatch Prompt Injector (Injects allowed downstream roles to prompt)│
│  - Stream & Done Parser (Extracts <im_dispatch> XML/JSON blocks)        │
│  - Auto-Dispatch Engine & Loop Guard (Depth & cycle safety checks)       │
│  - Confirmation Flow Coordinator (Emits proposal cards to room)         │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ SQLite / Core DB
┌────────────────────────────────────▼────────────────────────────────────┐
│                    Data Storage Layer (@agent-resume/core)              │
│  - im_role_templates (callable_template_ids_json, auto_dispatch)        │
│  - im_members (inherited / overridden callable config)                  │
│  - im_messages (delegation_proposals_json)                              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 数据结构与存储设计 (Data Schema & Types)

### 4.1 核心类型扩展 (`apps/desktop/src/shared/imTypes.ts`)

```typescript
export interface ImDelegationProposal {
  id: string;                      // 唯一提案 ID (UUID)
  targetTemplateId: string;        // 目标角色模板 ID (如 role_developer)
  targetRoleName?: string;         // 目标角色展示名称 (快照)
  instruction: string;             // 下发给下游角色的指令内容
  reason?: string;                 // 下发原因/说明
  status: "pending" | "dispatched" | "dismissed" | "auto_dispatched";
  dispatchedMessageId?: string;    // 执行下发后生成的 IM 消息 ID
  dispatchedJobId?: string;        // 执行下发后生成的 Job ID
  createdAtMs: number;
  resolvedAtMs?: number;
}

export interface ImRoleTemplate {
  templateId: string;
  name: string;
  persona: string;
  agent: ImAgent;
  model?: string;
  thoughtLevel?: string;
  permissions: ImPermission;
  tools: ImRoleTools;
  // ===== 新增字段 =====
  callableTemplateIds: string[];   // 该角色可调用的下游角色模板 ID 列表
  autoDispatch: boolean;           // 是否开启自动指派（默认 false）
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ImMember {
  // ... 现有字段 ...
  callableTemplateIds?: string[];  // 房间成员级别可调用列表（可选覆盖）
  autoDispatch?: boolean;          // 房间成员级别自动指派（可选覆盖）
}

export interface ImMessage {
  // ... 现有字段 ...
  delegationProposals?: ImDelegationProposal[]; // 消息附带的下发任务提案
}
```

### 4.2 SQLite 数据库迁移脚本 (`packages/core/src/catalog/desktopSchema.ts`)

```sql
-- 角色模板与房间成员扩展
ALTER TABLE im_role_templates ADD COLUMN callable_template_ids_json TEXT;
ALTER TABLE im_role_templates ADD COLUMN auto_dispatch INTEGER DEFAULT 0;

ALTER TABLE im_members ADD COLUMN callable_template_ids_json TEXT;
ALTER TABLE im_members ADD COLUMN auto_dispatch INTEGER;

-- 消息表扩展提案字段
ALTER TABLE im_messages ADD COLUMN delegation_proposals_json TEXT;
```

---

## 5. 提示词契约与输出协议 (Prompt & Protocol Design)

### 5.1 注入 Prompt (`buildDispatchPrompt`)
当派发上游角色任务时，若该角色配置了可调用角色且目标角色在当前房间中处于启用状态，Conductor 将在 Prompt 尾部追加 `[Callable Downstream Roles]` 上下文：

```text
[Callable Downstream Roles]
You can delegate follow-up tasks to the following active roles in this room:
- Developer (id: role_developer): Implement the user's instruction in the project working directory.

If you determine that follow-up work should be delegated to one or more of these roles after completing your response, append your delegation block(s) at the very end of your response using this exact XML tag format:
<im_dispatch target="role_developer" reason="Architecture plan finalized, proceed to implementation">
[Clear, actionable instructions and constraints for the Developer]
</im_dispatch>

Guidelines:
1. Only delegate if actionable follow-up work is required.
2. The target must strictly match one of the available role ids listed above.
3. You can output multiple <im_dispatch> blocks if tasks need to be fanned out to multiple roles.
```

### 5.2 响应解析与协议提取 (`conductor.ts`)
在 `assistantDone` 或流式结束时，Conductor 扫描响应文本：
1. 提取所有 `<im_dispatch target="..." reason="...">...</im_dispatch>` 块。
2. 校验 `target` 是否处于当前角色的 `callableTemplateIds` 且在当前房间已启用。
3. 从对用户展示的正文（`body`）中安全剥离或修剪 `<im_dispatch>` 标记，转换为结构化的 `ImDelegationProposal[]` 存储。

---

## 6. 调度器执行逻辑与安全防范 (Conductor & Safety Guard)

### 6.1 流转控制逻辑
```
Agent 完成输出 (assistantDone)
       │
       ▼
解析提取 <im_dispatch> 提案
       │
   [是否有提案?]
   ├── 否 ──► 正常结束
   └── 是 ──► 校验 target 是否合法
               │
               ▼
       [是否开启 autoDispatch?]
       ├── 否 (默认) ──► 生成 status="pending" 提案并存入消息，通知前端展示「确认卡片」
       └── 是 ─────────► [安全检测: 深度 < MAX_DEPTH 且 无环路?]
                          ├── 否 ──► 降级为手动确认并附带警告信息
                          └── 是 ──► 标记 status="auto_dispatched"，自动调用 postMessage 发起下游 Job
```

### 6.2 环路与深度保护 (Loop & Depth Guard)
- **最大链式深度（Max Chain Depth）**：单次用户触发的链式调用最大深度限制为 `5`（可配置），防止递归失控。
- **环路检测（Cycle Detection）**：维护当前链路的调用路径（如 `PM -> Arch -> Dev`）。若检测到已访问的角色节点（如 `Dev -> Arch` 出现环路），自动中断自动下发，转为手动确认。

---

## 7. UI 与交互设计规范 (UI & Interaction Design)

### 7.1 IM 聊天流中的下发确认卡片 (Delegation Proposal Card)
在 `ImPanel.tsx` 消息流中，若角色消息包含 `delegationProposals`：
1. **卡片视觉结构**：
   - 顶部标头：展示下游目标角色 Badge（图标、角色色、名称）、下发原因（reason）。
   - 中间内容：展示下发指令摘要（Markdown 渲染，可折叠/展开）。
   - 底部操作栏：
     - `[确认指派 / Approve & Dispatch]`：一键派工，调用 `im:dispatchProposal`，生成新消息并在房间内启动下游角色任务。
     - `[修改指令 / Edit in Composer]`：将该指令填入主输入框，自动带上 `@TargetRole` 及对应引用，由用户微调后手动发送。
     - `[忽略 / Dismiss]`：调用 `im:dismissProposal`，将卡片置为已忽略状态。
2. **已处理状态反馈**：
   - 当已确认派发或已自动派发时，卡片展示浅色已完成态，并提供快捷跳转链接跳转至下游生成的对应消息。

### 7.2 设置面板配置 (Settings → IM)
在 `ImSettingsPane.tsx` 的角色模板编辑器中：
1. **可调用角色列表 (Callable Roles)**：
   - 提供多选复选框组（Checkbox Group），罗列系统中所有可用的角色模板。
   - 默认根据内置拓扑图进行初始化勾选。
   - 允许用户为自定义角色或现有角色增删下游调用目标。
2. **自动指派开关 (Auto-Dispatch Switch)**：
   - Checkbox: `任务完成后自动下发给下游角色（无需确认）`。
   - 附带说明文案，提示自动派发适用场景及安全防范机制。

---

## 8. 实施计划 (Implementation Plan for Developer)

- **Phase 1: 数据层与持久化改造**
  - 在 `@agent-resume/core` 中添加 SQLite 迁移脚本（`callable_template_ids_json`, `auto_dispatch`, `delegation_proposals_json`）。
  - 在 `imTypes.ts` 中定义 `ImDelegationProposal` 等新接口及默认拓扑常量 `DEFAULT_ROLE_CALLABLE_GRAPH`。
  - 更新 `ImStore` CRUD 方法与内置角色初始化逻辑。

- **Phase 2: 调度器与 Prompt 协议集成**
  - 修改 `buildDispatchPrompt`，根据角色可调用配置注入 Downstream Roles 规则。
  - 在 `ImConductor` 中实现 `parseDelegationProposals`、`dispatchProposal`、`dismissProposal`。
  - 加入最大深度与环路防范逻辑，实现自动下发分支。

- **Phase 3: IPC 与 Preload 桥接**
  - 在 `ipc.ts` 和 `preload.ts` 中注册 `im:dispatchProposal` 与 `im:dismissProposal` 接口。
  - 补充主进程单元测试（`conductor.test.ts`, `store.test.ts`）。

- **Phase 4: 前端交互与设置界面**
  - 在 `ImSettingsPane.tsx` 中增加可调用角色多选列表与自动指派开关。
  - 在 `ImPanel.tsx` 中实现 `ImDelegationCard` 提案卡片组件与操作回调。
  - 同步补充 `scripts/desktop-i18n-catalog.json` 多语言词条并运行 `pnpm run merge:desktop-i18n`。
