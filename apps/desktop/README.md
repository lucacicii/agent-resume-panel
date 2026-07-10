# Agent Resume Desktop

macOS-oriented shell: **Memory** (home calendar), **Ask** (chat over digests), Settings (gear).

## Develop

```bash
npm install
npm run build:core
npm run dev:desktop
```

## Navigation

| Entry | Role |
|-------|------|
| **Memory** (default) | Calendar · generate digests (right panel) · GTD bar · day detail |
| **Ask** | Natural-language Q&A over digests |
| **Sessions** (header) | Reference list + read-only preview |
| **⚙** | Settings · **通用**（含批量回填） / **用量与日志** |

### Memory 主区

- 上方：**从周报/月报分析 GTD + todolist**（打开可编辑预览 sheet）
- 右侧上方：生成日 / 周 / 月报（点日历同步日报日期）
- 右侧下方：digest 详情
- 无 ⋯ 菜单；批量回填在 Settings → 通用

### GTD flow

1. 分析预览（不写盘）
2. 编辑 GTD / tasks / markdown
3. 应用选中 → `session_gtd` + `todolist.md`

No VS Code extension code changes required for Desktop features.
