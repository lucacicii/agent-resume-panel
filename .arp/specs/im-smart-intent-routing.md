# IM 无 @ 消息智能意图识别与自动路由设计规范 (IM Smart Intent Routing Specification)

## 1. 业务背景与目标 (Background & Objectives)

在现有的 IM 房间协作中，系统采用显式 `@` 触发机制：用户发送消息若未 `@` 任何角色，消息仅作为普通聊天记录留存，后台调度器不会唤起任何 AI 执行任务。

本规范设计 **无 @ 消息智能意图识别与自动路由 (Smart Intent Routing)** 功能：
1. **自动意图识别**：当用户在房间内直接输入自然语言指令（未显式 `@` 任何角色）时，系统自动结合当前房间启用的角色列表进行语义分析，智能匹配最合适承接该任务的单一角色。
2. **静默自动派发**：匹配成功后，自动将任务派发给该角色执行，并在消息流中提供明确的「智能指派」视觉标识。
3. **未匹配友好提示**：若消息为闲聊、模糊记录、会议纪要或无须具体角色执行的内容，系统不触发派工，但在该消息末尾附加友好的交互 Tip，提示用户可手动 `@` 角色。
4. **30s 超时控制与专用 Tip 提示**：意图分析超时时间统一设置为 **30 秒**（`30_000 ms`）。若大模型调用超时，系统自动熔断降级并附加明确的超时提示 Tip，告知用户可直接手动 `@` 派发。

---

## 2. 核心架构与决策流 (Architecture & Decision Flow)

```
               [ 用户发送无 @ 消息 (mentionRoleIds == []) ]
                                    │
                                    ▼
                  [ ImConductor.postMessage ]
                                    │
                    [ 检查设置: im.smartRoutingEnabled ? ]
                    ├── 否 ──► 保持原有行为 (仅存消息，不派发)
                    └── 是 ──► [ ImIntentRouter.routeIntent ]
                                    │
                        ┌───────────┴───────────┐
                        ▼                       ▼
            [ 快速规则短路 / Fast Path ]   [ LLM 意图分类 (30s 超时保护) ]
                        │                       │
                        └───────────┬───────────┘
                                    │
                     [ 路由分析结果判定 ]
                     ├── 1. 成功匹配 (Matched) ────────► 消息标记 autoRouted: true，拉起对应 Job 派工
                     ├── 2. 无匹配角色 (Unmatched) ─────► 消息附加「未匹配到执行角色」普通 Tip
                     └── 3. 分析超时 (Timed Out, 30s) ─► 消息附加「识别超时」专用 Tip，提示手动 @
```

---

## 3. 意图路由器设计 (`apps/desktop/src/main/im/intentRouter.ts`)

### 3.1 路由器接口契约
```typescript
export interface IntentRouteResult {
  matched: boolean;
  targetMemberId?: string;
  targetTemplateId?: string;
  targetRoleName?: string;
  reason?: string;
  confidence?: number;
  timedOut?: boolean;        // 是否因 30s 超时熔断
  tip?: string;              // 附加在消息下方的提示文案
}

export const INTENT_ROUTING_TIMEOUT_MS = 30_000; // 30 秒硬超时

export async function routeMessageIntent(options: {
  text: string;
  roomMembers: ImMember[];
  settings: PanelSettings;
  desktopDb: string;
  timeoutMs?: number;        // 默认 30_000
}): Promise<IntentRouteResult>;
```

### 3.2 快速短路启发式规则 (Fast Path Heuristics)
在调用 LLM 之前，进行确定性轻量短路，减少不必要的等待：
- **极短文本 / 确认语**：字数 $\le 4$（如 "好的", "收到", "ok", "yes", "hello"） $\to$ 直接判定为 `matched: false, timedOut: false`，返回默认 Tip。
- **纯代码块粘贴**：且无任何提问 $\to$ 判定为上下文备忘，`matched: false`。

### 3.3 30s 超时处理机制 (Timeout & AbortController)
- 使用 `AbortController` 绑定 `setTimeout(..., 30_000)`；
- 若触发超时，终止 LLM 请求，捕获 `AbortError`，生成结果：
  ```typescript
  {
    matched: false,
    timedOut: true,
    tip: "desktop.im.routingTimeoutTip" // "💡 提示：智能意图识别已超时（30s）。您可以直接使用 @ 明确指派角色（如 @Project Manager, @Developer）。"
  }
  ```

---

## 4. 数据模型与持久化扩展 (Schema & Model Extensions)

### 4.1 消息实体扩展 (`imTypes.ts`)
```typescript
export interface ImMessage {
  // ... 现有字段 ...
  autoRouted?: boolean;       // 是否由系统智能路由
  routedRoleName?: string;    // 自动路由到的角色名称
  routingTip?: string;        // 未匹配或超时时附加的引导提示语
  routingTimedOut?: boolean;  // 是否超时
}
```

### 4.2 SQLite 迁移 (`desktopSchema.ts`)
```sql
ALTER TABLE im_messages ADD COLUMN auto_routed INTEGER DEFAULT 0;
ALTER TABLE im_messages ADD COLUMN routed_role_name TEXT;
ALTER TABLE im_messages ADD COLUMN routing_tip TEXT;
ALTER TABLE im_messages ADD COLUMN routing_timed_out INTEGER DEFAULT 0;
```

---

## 5. 前端交互与视觉设计 (UI & Visual Feedback)

### 5.1 智能路由成功标识
```
[You] ✦ 智能指派给 @Developer
帮我写一个基于 Express 的用户鉴权路由接口
```

### 5.2 未匹配与超时的 Tip 渲染策略 (`ImPanel.tsx`)
在用户消息气泡正文下方渲染紧凑胶囊卡片：
1. **正常未匹配（Unmatched）**：
   ```
   ┌────────────────────────────────────────────────────────────────────────┐
   │ 💡 提示：该消息未匹配到明确的执行角色。可在输入框中使用 @ 指派任务      │
   └────────────────────────────────────────────────────────────────────────┘
   ```
2. **识别超时（Timed Out, 30s）**：
   ```
   ┌────────────────────────────────────────────────────────────────────────┐
   │ ⏱ 提示：智能意图识别已超时（30s）。您可以直接使用 @ 手动指派角色以继续处理 │
   └────────────────────────────────────────────────────────────────────────┘
   ```
- 卡片包含时钟图标 `ThemeIcon name="clock"` 与高亮的操作提示，支持点击角色名称直接填入输入框。

---

## 6. 面向 Developer 的分步实施计划 (Implementation Plan)

1. **Phase 1: 字段与数据层**
   - 在 `desktopSchema.ts`、`imTypes.ts` 与 `store.ts` 中完成 `auto_routed`, `routed_role_name`, `routing_tip`, `routing_timed_out` 迁移与持久化。
2. **Phase 2: 意图路由器 (带 30s AbortController)**
   - 在 `apps/desktop/src/main/im/intentRouter.ts` 中实现带有 `timeoutMs = 30_000` 的 Abort 控制器。
   - 增加对超时异常的捕获与 `timedOut: true` 标记返回。
3. **Phase 3: 调度器接入与错误处理**
   - 在 `ImConductor.postMessage` 中，当 `mentionIds.length === 0` 时调用 `routeMessageIntent`。
   - 分支处理：匹配成功 $\to$ 发起派工；未匹配/超时 $\to$ 存储 tip 并持久化。
4. **Phase 4: 渲染与多语言**
   - 在 `ImPanel.tsx` 中渲染两种不同状态的 Tip（未匹配 vs 超时）。
   - 在 `desktop-i18n-catalog.json` 中配置多语言文案（中、英、日）并运行 `merge:desktop-i18n`。
