# IM 自定义角色调用关系与拓扑治理设计规范 (Custom Roles Delegation & Topology Governance)

## 1. 概述与核心挑战 (Overview & Core Challenges)

在 IM 多角色协作系统中，除了系统内置的 6 大基础角色（PM、产品经理、架构师、UI、开发、测试）外，用户可以随时创建自定义角色（如 `DevOps 运维`、`Security 安全专家`、`Tech Lead 技术主管`、`DBA`、`Code Reviewer` 等）。

引入自定义角色后，角色调用关系（Delegation Graph）面临以下核心挑战：
1. **双向配置效率问题**：新增角色时，若仅支持配置「该角色可调用谁（Outgoing）」，用户需逐一修改已有角色才能将其加入被调用池（Incoming）。
2. **标识符与 LLM 解析鲁棒性**：自定义角色使用 UUID 作为 `templateId`，LLM 可能倾向于输出角色名称而非 UUID。
3. **悬空引用与生命周期管理**：自定义角色被删除、禁用或重命名后，历史调用图和下游提案的引用一致性保障。
4. **房间级动态拓扑剪枝**：不同项目房间启用的角色子集不同，运行时需根据房间当前成员动态裁切有效拓扑。
5. **复杂拓扑与环路治理**：用户自定义拓扑可能包含复杂 DAG、交叉调用甚至环路，需要更严密的自动指派策略与熔断机制。

---

## 2. 自定义角色关系配置模型 (Configuration Models)

### 2.1 角色编辑器中的双向配置视图 (`ImSettingsPane.tsx`)

在编辑任意角色（无论是内置还是自定义角色）时，提供两组直观的配置区域：

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 角色模板编辑器 (Role Template Editor)                                    │
├─────────────────────────────────────────────────────────────────────────┤
│ 角色名称: [ DevOps 运维工程师 ]                                          │
│ Agent / 模型 / 权限: [ Pi ] [ claude-3-7-sonnet ] [ 读写/执行 ]         │
│                                                                         │
│ ─── 任务下发配置 (Delegation Settings) ─────────────────────────────── │
│                                                                         │
│ [x] 自动指派 (Auto-Dispatch): 任务完成后自动派发给下游，无需用户确认     │
│                                                                         │
│ 1. 该角色可下发给哪些下游角色? (Outgoing / Callees):                    │
│    [ ] Product Manager    [ ] Architect         [ ] UI Designer         │
│    [x] Developer          [x] Tester            [ ] Security 审计员     │
│                                                                         │
│ 2. 哪些上游角色可以下发任务给该角色? (Incoming / Callers):              │
│    [x] Project Manager    [x] Architect         [ ] UI Designer         │
│    [ ] Product Manager    [ ] Developer         [ ] Tester              │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 双向同步保存机制 (Bi-directional Sync on Save):
- 保存该角色时：
  - **Outgoing 变更**：直接更新当前角色模板的 `callable_template_ids_json`。
  - **Incoming 变更**：在同一 SQLite 事务中，遍历被勾选/取消勾选的上游角色模板，将其 `callable_template_ids_json` 中对应追加或移除当前角色的 `templateId`。

### 2.2 全局调用关系矩阵网格 (Global Topology Matrix View - 可选增强)
在 Settings → IM 顶部或右侧提供「调用关系矩阵（Matrix Grid）」，以表格形式展示行（Caller）和列（Callee），支持一键点击切换任意 $(A \to B)$ 派发许可，便于全局审视团队流水线。

---

## 3. 自定义角色的 Prompt 注入与智能模糊匹配协议

### 3.1 动态 Prompt 注入规范 (`buildDispatchPrompt`)
系统根据当前房间内 **已启用（enabled = 1）** 的成员，过滤出当前角色的有效下游列表：

$$\text{ActiveCallees} = \text{CurrentRole.callableTemplateIds} \cap \{ \text{Room.enabledMembers.templateIds} \}$$

注入 Prompt 结构：
```text
[Callable Downstream Roles]
You can delegate follow-up tasks to the following active roles in this room:
- Developer (id: role_developer): Implement the user's instruction in the project working directory.
- DevOps (id: tpl_9b2e4f, name: "DevOps Engineer"): Manage Docker, CI/CD pipelines, and cloud environments.

If you determine that follow-up work should be delegated to one or more of these roles after completing your response, append your delegation block(s) at the very end of your response using this exact XML format:
<im_dispatch target="tpl_9b2e4f" reason="Need CI/CD container build configuration">
[Actionable instructions for DevOps]
</im_dispatch>
```

### 3.2 鲁棒解析器设计 (Robust Dispatch Parser in `conductor.ts`)
为了防止模型输出自定义名称（如 `target="DevOps Engineer"` 或 `target="DevOps"`）而非 UUID，Conductor 采用两级匹配算法：
1. **Level 1 (Exact ID Match)**：匹配 `target === member.templateId`。
2. **Level 2 (Fuzzy Name/Key Match)**：匹配 `target.toLowerCase() === member.name.toLowerCase()` 或匹配已知别名 key。
3. **安全校验**：匹配成功后，必须二次校验该角色是否在当前角色的 `callableTemplateIds` 允许清单中；若不在则忽略，确保安全边界。

---

## 4. 自定义角色生命周期与引用完整性 (Lifecycle & Referential Integrity)

### 4.1 自定义角色删除时的级联清洗 (`deleteTemplate`)
当用户删除自定义角色模板 `tpl_xxx` 时，`ImStore.deleteTemplate` 执行原子事务：
1. 删除 `im_members` 中属于该模板的成员行。
2. 删除 `im_role_templates` 中该模板行。
3. **全局清洗悬空引用**：
   ```sql
   -- 从所有其他模板的 callable_template_ids_json 中移除 tpl_xxx
   -- 从所有房间成员的 callable_template_ids_json 中移除 tpl_xxx
   ```
4. **历史未决提案处理**：若历史消息中存在指向 `tpl_xxx` 且状态为 `pending` 的提案，前端渲染时自动回退为「角色已移除」禁用态，避免报错。

### 4.2 角色更名处理 (`updateTemplate`)
- 消息卡片和提案中持久化保存的是 `targetTemplateId`（不可变 ID）。展示时动态关联最新模板名称；若模板已不存在，降级显示提案创建时的 `targetRoleName` 快照。

---

## 5. 复杂自定义拓扑下的环路与熔断治理 (Loop & Circuit Breaker)

当用户配置了互调或环状拓扑（如 `Arch -> Dev -> Tester -> Arch`）且开启了自动指派时：

```
[ 用户发出初始任务 ]
       │ (Chain Depth = 1)
       ▼
 [ Architect ] ──(Auto-Dispatch: OK)──► [ Developer ]
                                             │ (Chain Depth = 2)
                                             ▼
                                        [ Tester ]
                                             │ (Chain Depth = 3, Target: Architect)
                                             ▼
                                [ 环路检测: Architect 已在调用链中! ]
                                             │
                                ┌────────────┴────────────┐
                                ▼                         ▼
                   [ 自动熔断: 降级为手动确认 ]    [ UI 标注: 环路预警 ]
```

1. **调用链路上下文传递 (`ImJobBrief.dispatchChain`)**：
   每次派发记录调用链路栈，如 `["role_architect", "role_developer", "role_tester"]`。
2. **环路命中策略**：
   当目标角色已存在于 `dispatchChain` 中时，强制中断自动派发，转为在 IM 消息中渲染 **`[环路流转需人工确认 / Loop Detected - Human Confirmation Required]`** 交互卡片。
3. **最大深度硬限制**：
   单次链路最大深度阈值 `MAX_CHAIN_DEPTH = 5`，超过直接中止自动链，防止 token 耗尽和失控。
