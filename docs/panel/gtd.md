# GTD

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### What it is

**GTD** status labels on **CLI sessions** help you triage work without leaving the IDE. Labels are stored in the local catalog (`catalog.db` under panel home).

ACP chats are **not** GTD-tagged.

### Statuses

| Status | Typical meaning |
|--------|-----------------|
| `@inbox` | Captured, not yet sorted |
| `@next` | Next actions |
| `@waiting` | Blocked on someone / something else |
| `@someday` | Deferred / maybe later |
| `@reference` | Keep for lookup, not actionable |
| `@done` | Completed and kept as a completion record |

### Main workflows

1. Open the **GTD** sidebar view (sessions grouped by status).  
2. Or set status from a session’s context menu / **set GTD status** command.  
3. **Refresh** the GTD view after bulk changes.  
4. Filter by GTD in **Search** / Session Manager when hunting a queue of work.

### Tips

1. Use GTD on **sessions**, Notes for longer prose.  
2. Prefer few `@next` items so the view stays actionable.  
3. Hiding a session removes it from the panel; clear GTD first if you still need it elsewhere.

### Related

- [Sessions](sessions.md) · [Notes](notes.md)  
- [Settings & data](settings-and-data.md)

---

## 简体中文

### 是什么

**GTD** 状态标签打在 **CLI 会话**上，便于在 IDE 内分流任务。标签保存在本机目录数据库（面板数据目录下的 `catalog.db`）。

ACP 聊天 **不会** 打 GTD 标签。

### 状态含义

| 状态 | 常见含义 |
|------|----------|
| `@inbox` | 已捕获，尚未整理 |
| `@next` | 下一步行动 |
| `@waiting` | 等待他人 / 外部条件 |
| `@someday` | 以后再说 |
| `@reference` | 参考资料，非行动项 |
| `@done` | 已完成，并保留为完成记录 |

### 主要流程

1. 打开 **GTD** 侧边栏（按状态分组）。  
2. 或在会话右键 / **set GTD status** 命令中设置。  
3. 批量修改后 **Refresh** GTD 视图。  
4. 在 **Search** / Session Manager 中按 GTD 筛选。

### 提示

1. 会话用 GTD，长文用 Notes。  
2. `@next` 不宜过多，便于行动。  
3. 隐藏会话会从面板移除；若仍需在他处使用，可先理清 GTD。

### 相关文档

- [会话 Sessions](sessions.md) · [Notes](notes.md)  
- [设置与数据](settings-and-data.md)
