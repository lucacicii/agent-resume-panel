#!/usr/bin/env node
/** One-shot generator for scripts/desktop-i18n-catalog.json */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

/** @type {Record<string, { en: string, "zh-cn": string }>} */
const flat = {
  "desktop.app.title": { en: "Agent Resume Desktop", "zh-cn": "Agent Resume Desktop" },
  "desktop.common.close": { en: "Close", "zh-cn": "关闭" },
  "desktop.common.done": { en: "Done", "zh-cn": "完成" },
  "desktop.common.cancel": { en: "Cancel", "zh-cn": "取消" },
  "desktop.common.confirm": { en: "Confirm", "zh-cn": "确定" },
  "desktop.common.refresh": { en: "Refresh", "zh-cn": "刷新" },
  "desktop.common.search": { en: "Search", "zh-cn": "搜索" },
  "desktop.common.filter": { en: "Filter…", "zh-cn": "筛选…" },
  "desktop.common.loading": { en: "Loading…", "zh-cn": "加载中…" },
  "desktop.common.loadingPreview": { en: "Loading preview…", "zh-cn": "加载预览…" },
  "desktop.common.unknownError": { en: "Unknown error", "zh-cn": "未知错误" },
  "desktop.common.copy": { en: "Copy", "zh-cn": "复制" },
  "desktop.common.resend": { en: "Resend", "zh-cn": "重新发送" },
  "desktop.common.rename": { en: "Rename", "zh-cn": "重命名" },
  "desktop.common.delete": { en: "Delete", "zh-cn": "删除" },
  "desktop.common.showSidebar": { en: "Show sidebar", "zh-cn": "显示侧栏" },
  "desktop.common.hideSidebar": { en: "Hide sidebar", "zh-cn": "隐藏侧栏" },
  "desktop.common.revealInFinder": { en: "Reveal in Finder", "zh-cn": "在 Finder 中显示" },
  "desktop.common.importMarkdown": { en: "Import Markdown", "zh-cn": "导入 Markdown" },
  "desktop.common.newNote": { en: "New note", "zh-cn": "新建笔记" },
  "desktop.common.all": { en: "All", "zh-cn": "全部" },
  "desktop.common.pinned": { en: "Pinned", "zh-cn": "置顶" },
  "desktop.common.active": { en: "Active", "zh-cn": "活动" },
  "desktop.common.edit": { en: "Edit", "zh-cn": "编辑" },
  "desktop.common.view": { en: "View", "zh-cn": "查看" },
  "desktop.common.previous": { en: "Previous", "zh-cn": "上一个" },
  "desktop.common.next": { en: "Next", "zh-cn": "下一个" },
  "desktop.common.closeFind": { en: "Close find", "zh-cn": "关闭查找" },
  "desktop.common.send": { en: "Send", "zh-cn": "发送" },
  "desktop.common.today": { en: "Today", "zh-cn": "今天" },
  "desktop.common.year": { en: "Year", "zh-cn": "年" },
  "desktop.common.month": { en: "Month", "zh-cn": "月" },
  "desktop.common.justNow": { en: "Just now", "zh-cn": "刚刚" },
  "desktop.common.minutesAgo": { en: "{0} min ago", "zh-cn": "{0} 分钟前" },
  "desktop.common.hoursAgo": { en: "{0} h ago", "zh-cn": "{0} 小时前" },
  "desktop.common.daysAgo": { en: "{0} d ago", "zh-cn": "{0} 天前" },
  "desktop.common.yearSuffix": { en: "{0}", "zh-cn": "{0} 年" },
  "desktop.common.oneMinute": { en: "1 min", "zh-cn": "1 分钟" },
  "desktop.common.intervalSeconds": { en: "{0}s", "zh-cn": "{0}s" },

  "desktop.tabs.report": { en: "Report", "zh-cn": "报告" },
  "desktop.tabs.agent": { en: "Agent", "zh-cn": "Agent" },
  "desktop.tabs.workbench": { en: "Workbench", "zh-cn": "工作台" },
  "desktop.tabs.notes": { en: "Notes", "zh-cn": "笔记" },

  "desktop.top.sessionsRef": { en: "Sessions", "zh-cn": "Sessions" },
  "desktop.top.sessionsRefTitle": { en: "Sessions reference", "zh-cn": "Sessions 参考" },
  "desktop.top.settings": { en: "Settings", "zh-cn": "Settings" },
  "desktop.top.settingsTitle": { en: "Settings", "zh-cn": "Settings" },

  "desktop.report.prevMonth": { en: "Previous month", "zh-cn": "上月" },
  "desktop.report.nextMonth": { en: "Next month", "zh-cn": "下月" },
  "desktop.report.weekdayMon": { en: "Mon", "zh-cn": "一" },
  "desktop.report.weekdayTue": { en: "Tue", "zh-cn": "二" },
  "desktop.report.weekdayWed": { en: "Wed", "zh-cn": "三" },
  "desktop.report.weekdayThu": { en: "Thu", "zh-cn": "四" },
  "desktop.report.weekdayFri": { en: "Fri", "zh-cn": "五" },
  "desktop.report.weekdaySat": { en: "Sat", "zh-cn": "六" },
  "desktop.report.weekdaySun": { en: "Sun", "zh-cn": "日" },
  "desktop.report.weekCol": { en: "Wk", "zh-cn": "周" },
  "desktop.report.monthBtn": { en: "Month", "zh-cn": "月" },
  "desktop.report.legendDates": { en: "Dates:", "zh-cn": "日期：" },
  "desktop.report.legendDailyOk": { en: "D generated", "zh-cn": "D 已生成" },
  "desktop.report.legendDailyStale": { en: "↻ Update pending", "zh-cn": "↻ 待更新" },
  "desktop.report.legendDailyMissing": { en: "+ Not generated", "zh-cn": "+ 待生成" },
  "desktop.report.legendNoSession": { en: "— No activity", "zh-cn": "— 无活动" },
  "desktop.report.legendWeekly": { en: "Weekly", "zh-cn": "周报" },
  "desktop.report.legendMonthly": { en: "Monthly", "zh-cn": "月报" },
  "desktop.report.sessionsTitle": { en: "Sessions", "zh-cn": "Sessions" },
  "desktop.report.sessionEmpty": {
    en: "Select a month or date / week to show sessions",
    "zh-cn": "切换月份或选择日期 / 周后显示 session"
  },
  "desktop.report.reportDetail": { en: "Report detail", "zh-cn": "报告详情" },
  "desktop.report.backToReport": { en: "Back to report", "zh-cn": "返回报告" },
  "desktop.report.detailHint": {
    en: "Click a date / week / month to view sessions and reports; click a session to preview here.",
    "zh-cn": "点击日期 / 周 / 月查看 session 与报告；点击 session 可在本列预览。"
  },
  "desktop.report.sessionsRangeLabel": { en: "Sessions · {0}", "zh-cn": "Sessions · {0}" },
  "desktop.report.rangeDay": { en: "Day {0}", "zh-cn": "日 {0}" },
  "desktop.report.rangeWeek": { en: "Week {0}", "zh-cn": "周 {0}" },
  "desktop.report.rangeMonth": { en: "Month {0}", "zh-cn": "月 {0}" },
  "desktop.report.sessionCountMeta": { en: "{0} items · click to preview", "zh-cn": "{0} 条 · 点击预览" },
  "desktop.report.noSessionsInRange": { en: "No sessions in this range", "zh-cn": "该范围内没有 session" },
  "desktop.report.digestDaily": { en: "Daily", "zh-cn": "日报" },
  "desktop.report.digestWeekly": { en: "Weekly", "zh-cn": "周报" },
  "desktop.report.digestMonthly": { en: "Monthly", "zh-cn": "月报" },
  "desktop.report.digestReport": { en: "Report", "zh-cn": "报告" },
  "desktop.report.digestDetailTitle": { en: "{0} · {1}", "zh-cn": "{0} · {1}" },
  "desktop.report.scopeDay": { en: "this day", "zh-cn": "这一天" },
  "desktop.report.scopeWeek": { en: "this week", "zh-cn": "这一周" },
  "desktop.report.scopeMonth": { en: "this month", "zh-cn": "这一月" },
  "desktop.report.scopePeriod": { en: "this period", "zh-cn": "本期" },
  // Deprecated for visible UI — calendar badges use CAL_MARK in app.js; kept for aria / legacy keys.
  "desktop.report.markStale": { en: "Update", "zh-cn": "更" },
  "desktop.report.markMissing": { en: "Missing", "zh-cn": "未" },
  "desktop.report.markNone": { en: "None", "zh-cn": "无" },
  "desktop.report.weeklyStale": { en: "Weekly update pending", "zh-cn": "周报待更新" },
  "desktop.report.monthlyStale": { en: "Monthly update pending", "zh-cn": "月报待更新" },
  "desktop.report.monthFuture": { en: "Month (future)", "zh-cn": "月（未来）" },
  "desktop.report.futureMonth": { en: "Future month", "zh-cn": "未来月份" },
  "desktop.report.dailyStaleTitle": {
    en: "Daily exists; {0} · {1}",
    "zh-cn": "日报已有，{0} · {1}"
  },
  "desktop.report.newSessions": { en: "{0} new sessions", "zh-cn": "{0} 个新 session" },
  "desktop.report.updatedSessions": { en: "{0} updated", "zh-cn": "{0} 个有更新" },
  "desktop.report.staleDefault": {
    en: "The digest may be outdated; consider regenerating.",
    "zh-cn": "日报可能不是最新的，方便的话可以再生成一次。"
  },
  "desktop.report.cannotParseDigestId": { en: "Cannot parse digest id", "zh-cn": "无法解析 digest id" },
  "desktop.report.missingDigestId": { en: "Missing digest id", "zh-cn": "缺少 digest id" },
  "desktop.report.weeklyMonthlyBusy": {
    en: "Weekly/monthly generation in progress, please wait…",
    "zh-cn": "周报/月报生成中，请稍候…"
  },
  "desktop.report.taskBusyWeekly": {
    en: "A task is running; wait before regenerating weekly…",
    "zh-cn": "有任务进行中，请稍候再重新生成周报…"
  },
  "desktop.report.taskBusyMonthly": {
    en: "A task is running; wait before regenerating monthly…",
    "zh-cn": "有任务进行中，请稍候再重新生成月报…"
  },
  "desktop.report.taskBusyGenWeekly": {
    en: "A task is running; wait before generating weekly…",
    "zh-cn": "有任务进行中，请稍候再生成周报…"
  },
  "desktop.report.taskBusyGenMonthly": {
    en: "A task is running; wait before generating monthly…",
    "zh-cn": "有任务进行中，请稍候再生成月报…"
  },
  "desktop.report.manualRegenerate": { en: "Manual regenerate", "zh-cn": "手动重新生成" },
  "desktop.report.digestFailed": { en: "{0} failed: {1}", "zh-cn": "{0} 失败：{1}" },
  "desktop.report.digestOk": {
    en: "{0} {1} OK · {2} · {3} sessions · summary {4}{5}",
    "zh-cn": "{0} {1} OK · {2} · {3} sessions · summary {4}{5}"
  },
  "desktop.report.replaced": { en: "replaced", "zh-cn": "覆盖" },
  "desktop.report.created": { en: "created", "zh-cn": "新建" },
  "desktop.report.parallelDaily": { en: "{0} (summarize sessions first){1}", "zh-cn": "{0}（先 summarize sessions）{1}" },
  "desktop.report.openedDigest": { en: "Opened {0} {1}", "zh-cn": "已打开 {0} {1}" },
  "desktop.report.gtdNoDigest": {
    en: "Click GTD Analyze on a detail card first to choose a digest.",
    "zh-cn": "请先在详情卡片点击「GTD分析」，指定要分析的 digest。"
  },
  "desktop.report.gtdNotSaved": { en: " · not saved yet (cached; re-analyze to refresh)", "zh-cn": " · 尚未落库（已缓存，重新分析可刷新）" },
  "desktop.report.gtdInvalidProposal": { en: "Invalid proposal", "zh-cn": "无效的提议项" },
  "desktop.report.gtdAdding": { en: "Adding…", "zh-cn": "添加中…" },
  "desktop.report.gtdAddFailed": { en: "Save failed", "zh-cn": "落库失败" },
  "desktop.report.gtdAddBtn": { en: "Add GTD", "zh-cn": "添加GTD" },
  "desktop.report.gtdReanalyze": { en: "Re-analyze", "zh-cn": "重新分析" },
  "desktop.report.gtdNoSessionsReason": {
    en: "Possible reasons: no sessions in this digest period, or the model did not return session ids.",
    "zh-cn": "可能原因：该 digest 周期内无关联 session，或模型未给出可落库的 session id。"
  },
  "desktop.report.gtdCollapseTitle": { en: "Click to expand/collapse", "zh-cn": "点击折叠/展开" },
  "desktop.report.gtdFocusEditor": { en: "Focus to open large editor", "zh-cn": "聚焦后打开大编辑窗口" },
  "desktop.report.gtdMdDialog": { en: "Edit todolist.md", "zh-cn": "todolist.md 编辑" },
  "desktop.report.gtdTasksLabel": { en: "Tasks (one per line)", "zh-cn": "Tasks（每行一项）" },
  "desktop.report.gtdTodoLabel": { en: "todolist.md (editable, written on add)", "zh-cn": "todolist.md（可编辑，添加时写入）" },

  "desktop.calendar.month1": { en: "Jan", "zh-cn": "1 月" },
  "desktop.calendar.month2": { en: "Feb", "zh-cn": "2 月" },
  "desktop.calendar.month3": { en: "Mar", "zh-cn": "3 月" },
  "desktop.calendar.month4": { en: "Apr", "zh-cn": "4 月" },
  "desktop.calendar.month5": { en: "May", "zh-cn": "5 月" },
  "desktop.calendar.month6": { en: "Jun", "zh-cn": "6 月" },
  "desktop.calendar.month7": { en: "Jul", "zh-cn": "7 月" },
  "desktop.calendar.month8": { en: "Aug", "zh-cn": "8 月" },
  "desktop.calendar.month9": { en: "Sep", "zh-cn": "9 月" },
  "desktop.calendar.month10": { en: "Oct", "zh-cn": "10 月" },
  "desktop.calendar.month11": { en: "Nov", "zh-cn": "11 月" },
  "desktop.calendar.month12": { en: "Dec", "zh-cn": "12 月" },

  "desktop.agent.newChat": { en: "New chat", "zh-cn": "新建对话" },
  "desktop.agent.renameChat": { en: "Rename", "zh-cn": "重命名" },
  "desktop.agent.audit": { en: "Trace", "zh-cn": "追踪" },
  "desktop.agent.deleteChat": { en: "Delete chat", "zh-cn": "删除对话" },
  "desktop.agent.inputPlaceholder": { en: "Type a message…", "zh-cn": "输入消息…" },
  "desktop.agent.toolsOn": { en: "Tools on: operate notes via chat", "zh-cn": "工具已开启：可通过对话操作笔记" },
  "desktop.agent.toolsToggle": { en: "Tools toggle", "zh-cn": "工具开关" },
  "desktop.agent.indexingNotes": { en: "Indexing notes…", "zh-cn": "正在索引笔记…" },
  "desktop.agent.fetchingTools": { en: "Fetching tool list…", "zh-cn": "正在获取工具列表…" },
  "desktop.agent.toolsReady": { en: "Tools ready: {0}", "zh-cn": "工具就绪: {0}" },
  "desktop.agent.requestingLlm": { en: "Requesting LLM…", "zh-cn": "正在请求 LLM…" },
  "desktop.agent.requestingLlmRound": { en: "LLM request round {0}…", "zh-cn": "第 {0} 轮请求 LLM…" },
  "desktop.agent.toolsNoResponse": {
    en: "LLM returned no valid answer (endpoint may not support function calling). Confirm your LLM endpoint supports the tools parameter in Settings.",
    "zh-cn": "LLM 未返回有效回答（可能是端点不支持 function calling）。请在设置中确认你的 LLM 端点支持 tools 参数。"
  },
  "desktop.agent.toolsMaxIterations": {
    en: "Tool call limit reached; narrow the request and try again.",
    "zh-cn": "已达到工具调用次数上限，请缩小请求范围后重试。"
  },
  "desktop.agent.persistFailed": { en: "Failed to save chat: {0}", "zh-cn": "对话保存失败：{0}" },
  "desktop.notes.scanningNotes": { en: "Scanning notes…", "zh-cn": "正在扫描笔记…" },
  "desktop.notes.indexingProgress": { en: "Indexing note {0}/{1}", "zh-cn": "正在索引笔记 {0}/{1}" },
  "desktop.notes.generatingVectors": { en: "Generating vectors {0}/{1}", "zh-cn": "正在生成向量 {0}/{1}" },
  "desktop.notes.indexComplete": {
    en: "Note index complete: {0} notes, {1} chunks",
    "zh-cn": "笔记索引完成：{0} 篇，{1} 个片段"
  },
  "desktop.notes.indexUpToDate": { en: "Note index up to date", "zh-cn": "笔记索引已是最新" },
  "desktop.notes.indexFailed": { en: "Note index failed: {0}", "zh-cn": "笔记索引失败：{0}" },
  "desktop.workbench.editorAuto": { en: "Editor", "zh-cn": "编辑器" },
  "desktop.workbench.editorNotFoundAuto": {
    en: "No available VS Code, VSCodium, Cursor, or Windsurf found.",
    "zh-cn": "未找到可用的 VS Code、VSCodium、Cursor 或 Windsurf。"
  },
  "desktop.workbench.editorNotFound": {
    en: "{0} not found; confirm the app is installed or CLI tools are available.",
    "zh-cn": "未找到 {0}，请确认应用已安装或命令行工具可用。"
  },
  "desktop.report.gtdNoLinkedSessions": {
    en: "This digest is not linked to any catalog session (no report_links and no sessions in period). Cannot generate GTD proposals.",
    "zh-cn": "该 digest 未关联到任何 catalog session（无 report_links，且周期内无 session）。无法生成 GTD 提议。"
  },
  "desktop.report.gtdFallbackSessions": {
    en: "report_links empty; loaded {0} sessions from digest time range as fallback.",
    "zh-cn": "report_links 为空，已按 digest 时间范围回退加载 {0} 个 session。"
  },
  "desktop.report.gtdJsonParseFailed": {
    en: "Could not parse JSON from LLM: {0}",
    "zh-cn": "LLM 返回的 JSON 无法解析: {0}"
  },
  "desktop.agent.auditTitle": { en: "Ask note trace", "zh-cn": "Ask 笔记追踪" },
  "desktop.agent.auditEmpty": { en: "No trace records yet", "zh-cn": "暂无追踪记录" },
  "desktop.agent.newThread": { en: "New chat", "zh-cn": "新对话" },
  "desktop.agent.deleteConfirm": { en: 'Delete chat "{0}"?', "zh-cn": '确定要删除对话 "{0}" 吗？' },
  "desktop.agent.deleteFailed": { en: "Delete failed: {0}", "zh-cn": "删除失败：{0}" },
  "desktop.agent.renameFailed": { en: "Rename failed: {0}", "zh-cn": "重命名失败：{0}" },
  "desktop.agent.createFailed": { en: "Create chat failed: {0}", "zh-cn": "创建对话失败：{0}" },
  "desktop.agent.loadThreadsFailed": { en: "Load chats failed: {0}", "zh-cn": "加载对话列表失败：{0}" },
  "desktop.agent.loadChatFailed": { en: "Load chat failed: {0}", "zh-cn": "加载对话失败：{0}" },
  "desktop.agent.loadOlderFailed": { en: "Load older messages failed: {0}", "zh-cn": "加载更早消息失败：{0}" },
  "desktop.agent.renameDialogTitle": { en: "Rename chat", "zh-cn": "重命名对话" },
  "desktop.agent.renameInputLabel": { en: "Chat title", "zh-cn": "对话标题" },
  "desktop.agent.deleteThreadTitle": { en: "Delete chat", "zh-cn": "删除对话" },
  "desktop.agent.toolsOnStatus": { en: "Tools mode enabled", "zh-cn": "工具模式已开启" },
  "desktop.agent.toolsOffStatus": { en: "Tools mode disabled", "zh-cn": "工具模式已关闭" },
  "desktop.agent.toolsOffTitle": { en: "Enable to operate notes via chat (create/search)", "zh-cn": "开启后可通过对话操作笔记（新建/搜索）" },
  "desktop.agent.searchingReports": { en: "Searching memory…", "zh-cn": "检索记忆…" },
  "desktop.agent.generatingAnswer": { en: "Generating answer…", "zh-cn": "生成回答…" },
  "desktop.agent.callingTool": { en: "Calling tool: {0}…", "zh-cn": "调用工具: {0}…" },
  "desktop.agent.executingTool": { en: "Executing tool: {0}…", "zh-cn": "执行工具: {0}…" },
  "desktop.agent.copiedAnswer": { en: "Answer copied", "zh-cn": "已复制回答" },
  "desktop.agent.copied": { en: "Copied", "zh-cn": "已复制" },
  "desktop.agent.typing": { en: "Typing…", "zh-cn": "正在输入…" },
  "desktop.agent.recentSummary": { en: "Recent summary", "zh-cn": "近期摘要" },
  "desktop.agent.reportRetrieval": { en: "Memory retrieval", "zh-cn": "记忆检索" },
  "desktop.agent.citationReports": { en: "Report citations", "zh-cn": "报告引用" },
  "desktop.agent.citationNotes": { en: "Note citations", "zh-cn": "笔记引用" },
  "desktop.agent.citationHover": { en: "Hover to preview", "zh-cn": "悬停预览" },
  "desktop.agent.citationRef": { en: "Citation", "zh-cn": "引用" },
  "desktop.agent.citationUnnamedNote": { en: "Untitled note", "zh-cn": "未命名笔记" },
  "desktop.agent.citationNoPreview": { en: "No preview{0}", "zh-cn": "暂无预览内容{0}" },
  "desktop.agent.openInNotes": { en: "Open in Notes", "zh-cn": "在 Notes 中查看" },
  "desktop.agent.openInReport": { en: "Open in Memory", "zh-cn": "在 Memory 中查看" },
  "desktop.agent.noteDeleted": { en: "Note was deleted; cannot open in Notes", "zh-cn": "该笔记已被删除，无法在 Notes 中打开" },
  "desktop.agent.cannotResolveNote": { en: "Cannot resolve note citation", "zh-cn": "无法解析笔记引用" },
  "desktop.agent.cannotResolveReport": { en: "Cannot resolve report citation", "zh-cn": "无法解析引用报告" },
  "desktop.agent.auditStatusProposed": { en: "Pending", "zh-cn": "待确认" },
  "desktop.agent.auditStatusConfirmed": { en: "Confirmed", "zh-cn": "已确认" },
  "desktop.agent.auditStatusApplied": { en: "Applied", "zh-cn": "已执行" },
  "desktop.agent.auditStatusRejected": { en: "Rejected", "zh-cn": "已拒绝" },
  "desktop.agent.auditStatusFailed": { en: "Failed", "zh-cn": "失败" },
  "desktop.agent.auditStatusUnknown": { en: "Unknown", "zh-cn": "未知" },
  "desktop.agent.auditActionCreate": { en: "Create note", "zh-cn": "新建笔记" },
  "desktop.agent.auditActionAppend": { en: "Append", "zh-cn": "追加内容" },
  "desktop.agent.auditActionWrite": { en: "Edit note", "zh-cn": "修改笔记" },
  "desktop.agent.auditActionRename": { en: "Rename", "zh-cn": "重命名" },
  "desktop.agent.auditActionMove": { en: "Move note", "zh-cn": "移动笔记" },
  "desktop.agent.auditActionDelete": { en: "Delete note", "zh-cn": "删除笔记" },
  "desktop.agent.auditActionDefault": { en: "Note action", "zh-cn": "笔记操作" },
  "desktop.agent.auditUnspecifiedNote": { en: "Unspecified note", "zh-cn": "未指定笔记" },
  "desktop.agent.toolSearch": { en: "🔍 Search", "zh-cn": "🔍 搜索" },
  "desktop.agent.toolRead": { en: "📖 Read", "zh-cn": "📖 读取" },
  "desktop.agent.toolCreate": { en: "➕ Create", "zh-cn": "➕ 新建" },
  "desktop.agent.toolWrite": { en: "✏️ Edit", "zh-cn": "✏️ 修改" },
  "desktop.agent.toolAppend": { en: "📝 Append", "zh-cn": "📝 追加" },
  "desktop.agent.toolDelete": { en: "🗑 Delete", "zh-cn": "🗑 删除" },
  "desktop.agent.noteOpCreate": { en: "Create", "zh-cn": "新建" },
  "desktop.agent.noteOpWrite": { en: "Edit", "zh-cn": "修改" },
  "desktop.agent.noteOpAppend": { en: "Append", "zh-cn": "追加" },
  "desktop.agent.noteLevel": { en: "Note", "zh-cn": "笔记" },

  "desktop.notes.filterProjects": { en: "Filter projects", "zh-cn": "筛选项目" },
  "desktop.notes.projectFilter": { en: "Project filter", "zh-cn": "项目筛选" },
  "desktop.notes.loadingFolders": { en: "Loading folders…", "zh-cn": "加载文件夹…" },
  "desktop.notes.resizeFolders": { en: "Resize folder sidebar", "zh-cn": "调整文件夹侧栏宽度" },
  "desktop.notes.deleteNote": { en: "Delete note", "zh-cn": "删除笔记" },
  "desktop.notes.targetTabs": { en: "Note target", "zh-cn": "笔记目标" },
  "desktop.notes.targetLibrary": { en: "Standalone", "zh-cn": "独立笔记" },
  "desktop.notes.targetProject": { en: "Project", "zh-cn": "项目" },
  "desktop.notes.targetSession": { en: "Session", "zh-cn": "会话" },
  "desktop.notes.resizeList": { en: "Resize note list", "zh-cn": "调整笔记列表宽度" },
  "desktop.notes.viewMode": { en: "View mode", "zh-cn": "视图模式" },
  "desktop.notes.findInNote": { en: "Find in note", "zh-cn": "查找当前笔记" },
  "desktop.notes.findCount": { en: "{0}/{1}", "zh-cn": "{0}/{1}" },
  "desktop.notes.selectOrCreate": { en: "Select or create a note", "zh-cn": "选择或创建一条笔记" },
  "desktop.notes.loadingNotes": { en: "Loading notes…", "zh-cn": "加载笔记…" },
  "desktop.notes.allNotes": { en: "All notes", "zh-cn": "全部笔记" },
  "desktop.notes.librarySection": { en: "Standalone", "zh-cn": "独立笔记" },
  "desktop.notes.libraryArea": { en: "Standalone notes", "zh-cn": "独立笔记区" },
  "desktop.notes.libraryDesc": { en: "Personal notes not tied to a project or session", "zh-cn": "不关联项目或会话的个人笔记" },
  "desktop.notes.sessionsSection": { en: "Sessions", "zh-cn": "会话" },
  "desktop.notes.noMatchingProjects": { en: "No matching projects", "zh-cn": "没有匹配的项目" },
  "desktop.notes.noFilterProjects": { en: "No projects match filter", "zh-cn": "没有符合筛选的项目" },
  "desktop.notes.noFolders": { en: "No folders yet", "zh-cn": "暂无文件夹" },
  "desktop.notes.noMatchingNotes": { en: "No matching notes", "zh-cn": "没有匹配的笔记" },
  "desktop.notes.noNotesInFolder": { en: "No notes in this folder", "zh-cn": "此文件夹暂无笔记" },
  "desktop.notes.noExtraText": { en: "No extra text", "zh-cn": "无额外文本" },
  "desktop.notes.metaCount": { en: "{0} · {1} notes", "zh-cn": "{0} · {1} 条" },
  "desktop.notes.metaSearch": { en: '{0} · search "{1}" · {2} notes', "zh-cn": '{0} · 搜索「{1}」· {2} 条' },
  "desktop.notes.noProjectsSync": { en: "No projects; sync Sessions first", "zh-cn": "暂无可用项目，请先同步 Sessions" },
  "desktop.notes.noSessionsSync": { en: "No sessions; sync Sessions first", "zh-cn": "暂无可用会话，请先同步 Sessions" },
  "desktop.notes.titleLabel": { en: "Note title", "zh-cn": "笔记标题" },
  "desktop.notes.dblClickEdit": { en: "Double-click to edit title", "zh-cn": "双击编辑标题" },
  "desktop.notes.nameEmpty": { en: "Name cannot be empty", "zh-cn": "名称不能为空" },
  "desktop.notes.nameInvalid": { en: "Name cannot contain path separators", "zh-cn": "名称不能包含路径分隔符" },
  "desktop.notes.deleteConfirm": {
    en: 'Delete note "{0}"? Its assets folder will also be removed.',
    "zh-cn": "删除笔记「{0}」？将同时删除其 assets 文件夹。"
  },
  "desktop.notes.editorPlaceholder": {
    en: "Edit Markdown… (⌘V to paste images)",
    "zh-cn": "编辑 Markdown…（⌘V 可粘贴图片）"
  },
  "desktop.notes.clickZoom": { en: "Click to zoom", "zh-cn": "点击放大" },
  "desktop.notes.closeImagePreview": { en: "Close image preview", "zh-cn": "关闭图片预览" },
  "desktop.notes.closeImagePreviewBtn": { en: "Close", "zh-cn": "关闭" },
  "desktop.notes.pinProject": { en: "Pin project", "zh-cn": "置顶项目" },
  "desktop.notes.unpinProject": { en: "Unpin project", "zh-cn": "取消置顶" },
  "desktop.notes.renameProject": { en: "Rename project", "zh-cn": "重命名项目" },
  "desktop.notes.changeOwner": { en: "Change owner…", "zh-cn": "更改归属…" },
  "desktop.notes.copyPath": { en: "Copy path", "zh-cn": "复制路径" },
  "desktop.notes.noteNotFound": { en: "Created note not found", "zh-cn": "新建的笔记未找到" },
  "desktop.notes.projectLabel": { en: "Project", "zh-cn": "项目" },

  "desktop.workbench.filterProjects": { en: "Filter projects…", "zh-cn": "筛选项目…" },
  "desktop.workbench.resizeProjects": { en: "Resize project sidebar", "zh-cn": "调整项目侧栏宽度" },
  "desktop.workbench.resizeSessions": { en: "Resize session list", "zh-cn": "调整 Session 列表宽度" },
  "desktop.workbench.allSessions": { en: "All Sessions", "zh-cn": "全部 Sessions" },
  "desktop.workbench.allSessionsCount": { en: "All Sessions ({0})", "zh-cn": "全部 Sessions（{0}）" },
  "desktop.workbench.allSessionsWithTotal": {
    en: "All Sessions ({0} / {1})",
    "zh-cn": "全部 Sessions（{0} / {1}）"
  },
  "desktop.workbench.listMetaWithTotal": {
    en: "{0} · {1} / {2} sessions",
    "zh-cn": "{0} · {1} / {2} 条"
  },
  "desktop.workbench.loadingProjects": { en: "Loading projects…", "zh-cn": "加载项目…" },
  "desktop.workbench.loadingSessions": { en: "Loading sessions…", "zh-cn": "加载 sessions…" },
  "desktop.workbench.newTerminal": { en: "New Terminal", "zh-cn": "新建 Terminal" },
  "desktop.workbench.newSession": { en: "New Session", "zh-cn": "新建 Session" },
  "desktop.workbench.newSessionWithProject": { en: "New Session · {0}", "zh-cn": "新建 Session · {0}" },
  "desktop.workbench.newTerminalWithProject": { en: "New Terminal · {0}", "zh-cn": "新建 Terminal · {0}" },
  "desktop.workbench.noMatchingSessions": { en: "No matching sessions", "zh-cn": "没有匹配的 session" },
  "desktop.workbench.noSessionsInProject": { en: "No sessions in this project", "zh-cn": "此项目暂无 session" },
  "desktop.workbench.metaCount": { en: "{0} · {1} sessions", "zh-cn": "{0} · {1} 条" },
  "desktop.workbench.metaSearch": { en: '{0} · search "{1}" · {2} sessions', "zh-cn": '{0} · 搜索「{1}」· {2} 条' },
  "desktop.workbench.terminalTabs": { en: "Terminal tabs", "zh-cn": "终端标签" },
  "desktop.workbench.selectSessionHint": { en: "Select a session to restore terminal", "zh-cn": "选择 session 以恢复终端" },
  "desktop.workbench.selectProjectHint": {
    en: "Select a project; new Terminal or a session opens in that project's workbench.",
    "zh-cn": "选择项目后，新建 Terminal 或点击 session 会在该项目的工作台中打开。"
  },
  "desktop.workbench.externalTerminalHint": {
    en: "Terminal mode: system default. Click a session to restore in external terminal.",
    "zh-cn": "终端模式：系统默认终端。点击左侧 session 在外部终端中恢复。"
  },
  "desktop.workbench.closeTerminal": { en: "Close terminal", "zh-cn": "关闭终端" },
  "desktop.workbench.terminalNotLoaded": { en: "Terminal component not loaded", "zh-cn": "终端组件未加载" },
  "desktop.workbench.shellRestored": { en: "[Interactive shell restored]", "zh-cn": "[已恢复交互式 shell]" },
  "desktop.workbench.terminalClosed": { en: "[Terminal closed]", "zh-cn": "[终端已关闭]" },
  "desktop.workbench.renameSession": { en: "Rename Session", "zh-cn": "重命名 Session" },
  "desktop.workbench.renameProject": { en: "Rename project", "zh-cn": "重命名项目" },
  "desktop.workbench.renameProjectDisplay": { en: "Project display name", "zh-cn": "项目显示名" },
  "desktop.workbench.renameSessionTitle": { en: "Session title", "zh-cn": "Session 标题" },
  "desktop.workbench.renameDisplayHint": { en: "Display name only; disk path unchanged", "zh-cn": "仅改显示名，不影响磁盘路径" },
  "desktop.workbench.autoRename": { en: "Auto rename", "zh-cn": "自动重命名" },
  "desktop.workbench.autoRenaming": { en: "Auto renaming…", "zh-cn": "正在自动重命名…" },
  "desktop.workbench.generatingTitle": { en: "Generating title from conversation…", "zh-cn": "正在根据对话内容生成标题…" },
  "desktop.workbench.titleSuggested": { en: "Suggested title filled; edit and confirm", "zh-cn": "已填入建议标题，可编辑后点确定保存" },
  "desktop.workbench.selectProject": { en: "Select a project", "zh-cn": "请选择一个 project" },
  "desktop.workbench.scratchDir": { en: "Scratch dir (new)", "zh-cn": "临时目录（新建）" },
  "desktop.workbench.scratchDirTitle": { en: "New session in workbench scratch dir", "zh-cn": "在工作台临时目录中新建 session" },
  "desktop.workbench.nameEmpty": { en: "Name cannot be empty", "zh-cn": "名称不能为空" },
  "desktop.workbench.titleEmpty": { en: "Title cannot be empty", "zh-cn": "标题不能为空" },
  "desktop.workbench.pinProject": { en: "Pin project", "zh-cn": "置顶项目" },
  "desktop.workbench.unpinProject": { en: "Unpin project", "zh-cn": "取消置顶" },
  "desktop.workbench.openInEditor": { en: "Open in editor", "zh-cn": "在编辑器中打开" },
  "desktop.workbench.mountNote": { en: "Mount note", "zh-cn": "挂载笔记" },
  "desktop.workbench.openInChatGpt": { en: "Open in ChatGPT", "zh-cn": "在 ChatGPT 中打开" },
  "desktop.workbench.preview": { en: "Preview", "zh-cn": "预览" },
  "desktop.workbench.removeFromPanel": { en: "Remove from panel", "zh-cn": "从面板移除" },
  "desktop.workbench.syncingSessions": { en: "Syncing agent sessions…", "zh-cn": "正在同步 Agent sessions…" },
  "desktop.workbench.syncedSessions": { en: "Synced {0} sessions", "zh-cn": "已同步 {0} sessions" },

  "desktop.sessions.sheetTitle": { en: "Sessions (reference)", "zh-cn": "Sessions（参考）" },
  "desktop.sessions.refreshList": { en: "Refresh list", "zh-cn": "刷新列表" },
  "desktop.sessions.previewHint": {
    en: "Click a session on the left to preview. Supports Summarize / Auto Rename (like the VS Code extension).",
    "zh-cn": "点击左侧 session 查看对话预览。支持 Summarize / Auto Rename（与 VS Code 扩展类似）。"
  },
  "desktop.sessions.meta": {
    en: "{0} sessions · sync every {1} when visible{2} · click to preview",
    "zh-cn": "{0} sessions · 可见时每 {1} 同步{2} · 点击预览"
  },
  "desktop.sessions.lastSynced": { en: " · last sync {0}", "zh-cn": " · 最近同步 {0}" },
  "desktop.sessions.summarize": { en: "Summarize", "zh-cn": "Summarize" },
  "desktop.sessions.autoRename": { en: "Auto Rename", "zh-cn": "Auto Rename" },
  "desktop.sessions.summarizing": { en: "Summarizing…", "zh-cn": "正在 Summarize…" },
  "desktop.sessions.renaming": { en: "Renaming…", "zh-cn": "正在 Auto Rename…" },
  "desktop.sessions.summaryGenerated": { en: "Summary generated and saved to catalog", "zh-cn": "Summary 已生成并写入 catalog" },
  "desktop.sessions.summaryLabel": { en: "Summary", "zh-cn": "Summary" },
  "desktop.sessions.noMessages": { en: "No messages to preview.", "zh-cn": "无消息可预览。" },
  "desktop.sessions.truncated": { en: "(truncated)", "zh-cn": "（已截断）" },

  "desktop.sheet.gtdTitle": { en: "Digest → GTD + todolist", "zh-cn": "Digest → GTD + todolist" },
  "desktop.sheet.gtdDesc": {
    en: "Based on the selected daily / weekly / monthly digest in detail (today's daily is not auto-generated). Preview is editable; confirm to save.",
    "zh-cn": "基于详情中选中的 daily / weekly / monthly digest 分析（不会自动生成今日日报）。预览可编辑，确认后再落库。"
  },

  "desktop.settings.title": { en: "Settings", "zh-cn": "Settings" },
  "desktop.settings.done": { en: "Done", "zh-cn": "完成" },
  "desktop.settings.navLabel": { en: "Settings menu", "zh-cn": "Settings menu" },
  "desktop.settings.paneGeneral": { en: "General", "zh-cn": "通用" },
  "desktop.settings.paneModels": { en: "Models", "zh-cn": "模型" },
  "desktop.settings.paneSessions": { en: "Sessions", "zh-cn": "Sessions" },
  "desktop.settings.paneWorkbench": { en: "Workbench", "zh-cn": "工作台" },
  "desktop.settings.paneReport": { en: "Report", "zh-cn": "报告" },
  "desktop.settings.paneStorage": { en: "Data", "zh-cn": "数据" },
  "desktop.settings.paneUsage": { en: "Usage", "zh-cn": "用量" },
  "desktop.settings.paneGeneralDesc": { en: "Appearance and daily preferences", "zh-cn": "外观与日常偏好" },
  "desktop.settings.paneModelsDesc": { en: "Tool LLM, chat, and embedding", "zh-cn": "配置工具 LLM、对话与 Embedding" },
  "desktop.settings.paneSessionsDesc": { en: "Sync policy and session list visibility", "zh-cn": "同步策略与会话列表可见性" },
  "desktop.settings.paneWorkbenchDesc": { en: "New sessions, editor, and terminal", "zh-cn": "新建 Session、编辑器与终端" },
  "desktop.settings.paneReportDesc": { en: "Scheduled digests and backfill", "zh-cn": "定时 digests 与历史回填" },
  "desktop.settings.paneStorageDesc": { en: "Panel home, notes, and agent data dirs", "zh-cn": "Panel home、笔记与 Agent 数据目录" },
  "desktop.settings.paneUsageDesc": { en: "LLM calls and scheduled task stats", "zh-cn": "LLM 调用与定时任务统计" },
  "desktop.settings.appearance": { en: "Appearance", "zh-cn": "外观" },
  "desktop.settings.theme": { en: "Theme", "zh-cn": "主题" },
  "desktop.settings.themeDesc": { en: "Light, dark, or follow system", "zh-cn": "切换应用浅色、深色或跟随系统" },
  "desktop.settings.themeSystem": { en: "Follow system", "zh-cn": "跟随系统" },
  "desktop.settings.themeLight": { en: "Light", "zh-cn": "浅色" },
  "desktop.settings.themeDark": { en: "Dark", "zh-cn": "深色" },
  "desktop.settings.fieldUiLanguageDescription": {
    en: "Desktop UI language. Auto follows the system language; choose a language to override.",
    "zh-cn": "桌面界面语言。auto 跟随系统语言；选择语言可覆盖。"
  },
  "desktop.settings.fieldUiLanguageOptionAuto": { en: "Auto (follow system)", "zh-cn": "自动（跟随系统）" },
  "desktop.settings.toolLlm": { en: "Tool LLM", "zh-cn": "工具 LLM" },
  "desktop.settings.toolLlmFootnote": {
    en: "For summaries, auto-rename, scheduled digests, etc. Use a fast, inexpensive model (e.g. gpt-4o-mini, deepseek-chat).",
    "zh-cn": "用于摘要、自动重命名、定时 digests 等工具任务。请使用便宜、快速的模型（如 gpt-4o-mini、deepseek-chat）。"
  },
  "desktop.settings.chatModel": { en: "Chat model", "zh-cn": "对话模型" },
  "desktop.settings.chatModelFootnote": {
    en: "For Ask / Meta-Agent chat. Defaults to tool LLM; can use a stronger model.",
    "zh-cn": "用于 Ask / Meta-Agent 对话。默认同工具 LLM，可单独配置更强模型。"
  },
  "desktop.settings.embedding": { en: "Embedding", "zh-cn": "Embedding" },
  "desktop.settings.embeddingFootnote": {
    en: "Base URL / API Key optional; falls back to tool LLM settings.",
    "zh-cn": "Base URL / API Key 可留空，将回落到工具 LLM 的配置。"
  },
  "desktop.settings.baseUrl": { en: "Base URL", "zh-cn": "Base URL" },
  "desktop.settings.model": { en: "Model", "zh-cn": "Model" },
  "desktop.settings.apiKey": { en: "API Key", "zh-cn": "API Key" },
  "desktop.settings.outputLanguage": { en: "Output language", "zh-cn": "Output language" },
  "desktop.settings.baseUrlOptional": { en: "Base URL (optional)", "zh-cn": "Base URL（可选）" },
  "desktop.settings.apiKeyOptional": { en: "API Key (optional)", "zh-cn": "API Key（可选）" },
  "desktop.settings.settingsPathFootnote": {
    en: "Written to ~/.agent-resume-panel/settings.json (shared with VS Code extension).",
    "zh-cn": "写入 ~/.agent-resume-panel/settings.json（与 VS Code 扩展共用）。"
  },
  "desktop.settings.unhideAllDesc": {
    en: "Sync may mark sessions not scanned in the latest run as hidden. Restore makes them visible again without re-importing from agents.",
    "zh-cn": "同步时，本次未从 Agent 源扫入的 session 可能被标为隐藏。恢复可见不会重新从 Agent 导入。"
  },
  "desktop.settings.unhideAllBtn": { en: "Restore hidden sessions", "zh-cn": "恢复已隐藏 session" },
  "desktop.settings.unhideAllConfirm": {
    en: "Restore all hidden sessions in the catalog to visible? This does not re-import from agents.",
    "zh-cn": "将 catalog 中所有已隐藏的 session 恢复为可见？不会从 Agent 重新导入。"
  },
  "desktop.settings.unhideAllDone": { en: "Restored {0} hidden sessions", "zh-cn": "已恢复 {0} 条隐藏 session" },
  "desktop.settings.sync": { en: "Sync", "zh-cn": "同步" },
  "desktop.settings.syncMax": { en: "Sync limit", "zh-cn": "同步上限" },
  "desktop.settings.stalePolicy": { en: "Stale policy", "zh-cn": "过期策略" },
  "desktop.settings.stalePolicyDesc": {
    en: "Purge removes catalog rows not refreshed in the latest sync. Off keeps all rows.",
    "zh-cn": "清除会删除本次同步未刷新的 catalog 行。关闭则保留全部。"
  },
  "desktop.settings.staleOff": { en: "Off", "zh-cn": "关闭" },
  "desktop.settings.stalePurge": { en: "Purge", "zh-cn": "清除" },
  "desktop.settings.visibilityFilter": { en: "Visibility filter", "zh-cn": "可见性过滤" },
  "desktop.settings.visibilityFootnote": {
    en: "Control archived/sub-agent sessions per provider in lists.",
    "zh-cn": "控制各 Provider 的归档、子 Agent 等特殊 session 是否出现在列表中。"
  },
  "desktop.settings.showArchivedCodex": { en: "Show archived Codex", "zh-cn": "显示 Codex 归档" },
  "desktop.settings.showSubagentCodex": { en: "Show Codex sub-agents", "zh-cn": "显示 Codex 子 Agent" },
  "desktop.settings.showArchivedOpenCode": { en: "Show archived OpenCode", "zh-cn": "显示 OpenCode 归档" },
  "desktop.settings.showSubagentGrok": { en: "Show Grok sub-agents", "zh-cn": "显示 Grok 子 Agent" },
  "desktop.settings.hideCronAlma": { en: "Hide Alma cron", "zh-cn": "隐藏 Alma cron" },
  "desktop.settings.hideChannelAlma": { en: "Hide Alma channel", "zh-cn": "隐藏 Alma channel" },
  "desktop.settings.showIncognitoAlma": { en: "Show Alma incognito", "zh-cn": "显示 Alma incognito" },
  "desktop.settings.newSessionGroup": { en: "New Session", "zh-cn": "新建 Session" },
  "desktop.settings.defaultAgent": { en: "Default agent", "zh-cn": "默认 Agent" },
  "desktop.settings.defaultAgentDesc": {
    en: "Provider used when creating a session in Workbench",
    "zh-cn": "在工作台新建 session 时使用的 Provider"
  },
  "desktop.settings.scratchDir": { en: "Scratch directory", "zh-cn": "临时目录" },
  "desktop.settings.editorTerminal": { en: "Editor & terminal", "zh-cn": "编辑器与终端" },
  "desktop.settings.projectEditor": { en: "Project editor", "zh-cn": "项目编辑器" },
  "desktop.settings.projectEditorDesc": {
    en: "Editor used when opening a project from Workbench",
    "zh-cn": "从工作台打开项目时使用的编辑器"
  },
  "desktop.settings.editorAuto": { en: "Auto-detect", "zh-cn": "自动检测" },
  "desktop.settings.terminalMode": { en: "Terminal mode", "zh-cn": "终端模式" },
  "desktop.settings.terminalModeDesc": { en: "Embedded xterm or system default terminal", "zh-cn": "内嵌 xterm 或系统默认终端" },
  "desktop.settings.terminalXterm": { en: "Embedded terminal (xterm.js)", "zh-cn": "内嵌终端 (xterm.js)" },
  "desktop.settings.terminalExternal": { en: "System default terminal", "zh-cn": "系统默认终端" },
  "desktop.settings.externalLaunch": { en: "External terminal launch", "zh-cn": "外部终端启动方式" },
  "desktop.settings.externalLaunchDesc": {
    en: "How to pass resume command when restoring a session",
    "zh-cn": "恢复 session 时如何传递命令"
  },
  "desktop.settings.launchExecute": { en: "Auto-run resume command", "zh-cn": "自动执行恢复命令" },
  "desktop.settings.launchPaste": { en: "Paste command after open", "zh-cn": "打开后自动粘贴命令" },
  "desktop.settings.launchCopy": { en: "Copy command only", "zh-cn": "仅复制命令到剪贴板" },
  "desktop.settings.cmdT": { en: "⌘T shortcut", "zh-cn": "⌘T 快捷键" },
  "desktop.settings.cmdTDesc": {
    en: "Action when pressing ⌘T (Ctrl+T on Windows) in Workbench",
    "zh-cn": "在工作台按下 ⌘T（Windows 为 Ctrl+T）时执行的操作"
  },
  "desktop.settings.cmdTNewTerminal": { en: "New Terminal", "zh-cn": "新建 Terminal" },
  "desktop.settings.cmdTNewSession": { en: "New Session", "zh-cn": "新建 Session" },
  "desktop.settings.scheduledDigests": { en: "Scheduled digests", "zh-cn": "定时 digests" },
  "desktop.settings.enableSchedule": { en: "Enable scheduled analysis", "zh-cn": "启用定时分析" },
  "desktop.settings.enableScheduleDesc": {
    en: "Call tool LLM at set times to generate daily/weekly/monthly digests",
    "zh-cn": "在设定时刻调用工具 LLM 生成日/周/月报"
  },
  "desktop.settings.dailyHour": { en: "Daily hour", "zh-cn": "Daily hour" },
  "desktop.settings.weeklyHour": { en: "Weekly hour (Mon)", "zh-cn": "Weekly hour (Mon)" },
  "desktop.settings.monthlyHour": { en: "Monthly hour (day 1)", "zh-cn": "Monthly hour (day 1)" },
  "desktop.settings.backfillTitle": { en: "Backfill historical digests", "zh-cn": "批量回填历史 digests" },
  "desktop.settings.backfillCallout": {
    en: "Scan all session dates in catalog and batch-generate day→week→month. Many LLM calls; may incur cost and take time.",
    "zh-cn": "扫描 catalog 全部 session 日期，按日→周→月批量生成。多次 LLM 调用，可能产生费用且耗时较长。"
  },
  "desktop.settings.backfillMaxDays": { en: "Max days", "zh-cn": "最多天数" },
  "desktop.settings.backfillSkipExisting": { en: "Skip existing successful digests", "zh-cn": "跳过已有成功 digest" },
  "desktop.settings.backfillSkipEmbedding": { en: "Skip embedding", "zh-cn": "跳过 embedding" },
  "desktop.settings.backfillPreview": { en: "Preview range", "zh-cn": "预览范围" },
  "desktop.settings.backfillRun": { en: "Start backfill", "zh-cn": "开始回填" },
  "desktop.settings.appData": { en: "App data", "zh-cn": "应用数据" },
  "desktop.settings.appDataFootnote": {
    en: "catalog.db, acp/, notes/ live under Panel home.",
    "zh-cn": "catalog.db、acp/、notes/ 均存放在 Panel home 下。"
  },
  "desktop.settings.panelHome": { en: "Panel home", "zh-cn": "Panel home" },
  "desktop.settings.panelHomeFootnote": {
    en: "Reveal uses saved path; changes auto-save.",
    "zh-cn": "打开操作使用已保存的路径；修改后会自动保存。"
  },
  "desktop.settings.notesGroup": { en: "Notes", "zh-cn": "笔记" },
  "desktop.settings.notesFootnote": {
    en: "Notes are Markdown files; edit in Finder / Obsidian.",
    "zh-cn": "笔记以 Markdown 文件存储，可用 Finder / Obsidian 直接编辑。"
  },
  "desktop.settings.agentHomesAdvanced": { en: "Agent data directories (advanced)", "zh-cn": "Agent 数据目录（高级）" },
  "desktop.settings.codexHome": { en: "Codex home", "zh-cn": "Codex home" },
  "desktop.settings.claudeHome": { en: "Claude home", "zh-cn": "Claude home" },
  "desktop.settings.antigravityHome": { en: "Antigravity home", "zh-cn": "Antigravity home" },
  "desktop.settings.grokHome": { en: "Grok home", "zh-cn": "Grok home" },
  "desktop.settings.almaDataDir": { en: "Alma data directory", "zh-cn": "Alma data directory" },
  "desktop.settings.opencodeHome": { en: "OpenCode home", "zh-cn": "OpenCode home" },
  "desktop.settings.piHome": { en: "Pi home", "zh-cn": "Pi home" },
  "desktop.settings.saving": { en: "Saving…", "zh-cn": "保存中…" },
  "desktop.settings.saved": { en: "Saved{0}", "zh-cn": "已保存{0}" },
  "desktop.settings.schedulerOn": { en: " · schedule ON", "zh-cn": " · 定时 ON" },
  "desktop.settings.schedulerOff": { en: " · schedule OFF", "zh-cn": " · 定时 OFF" },
  "desktop.settings.memoryEnableConfirm": {
    en: "Enabling scheduled analysis will read session data and call tool LLM / embedding APIs at set times, which may incur cost. Continue?",
    "zh-cn": "启用定时分析后，Desktop 将在设定时刻读取 session 数据并调用工具 LLM / embedding API，可能产生费用。是否继续？"
  },
  "desktop.settings.fieldOutputLanguageDescription": {
    en: "Language for summaries, digests, and Agent replies. auto follows UI Language.",
    "zh-cn": "摘要、digest、Agent 回复使用的语言。auto 跟随界面语言。"
  },
  "desktop.settings.fieldOutputLanguageOptionAuto": {
    en: "Auto (follow UI language)",
    "zh-cn": "自动（跟随界面语言）"
  },
  "desktop.settings.paneAbout": { en: "About", "zh-cn": "关于" },
  "desktop.settings.paneAboutDesc": { en: "Documentation and feedback", "zh-cn": "文档与问题反馈" },
  "desktop.settings.aboutTagline": {
    en: "Session OS + Memory for coding agents",
    "zh-cn": "面向编程 Agent 的 Session OS + Memory"
  },
  "desktop.settings.aboutVersionLabel": { en: "Desktop", "zh-cn": "Desktop" },
  "desktop.settings.aboutResources": { en: "Resources", "zh-cn": "资源" },
  "desktop.settings.aboutFeedback": { en: "Feedback", "zh-cn": "反馈" },
  "desktop.settings.linkDocumentationDesc": {
    en: "User guide and feature overview",
    "zh-cn": "用户指南与功能说明"
  },
  "desktop.settings.linkExtensionDoc": { en: "VS Code extension docs", "zh-cn": "VS Code 扩展文档" },
  "desktop.settings.linkExtensionDocDesc": {
    en: "Companion VS Code sidebar extension",
    "zh-cn": "配套的 VS Code 侧边栏扩展"
  },
  "desktop.settings.linkReportIssueDesc": {
    en: "Bug reports and feature requests on GitHub",
    "zh-cn": "在 GitHub 提交 Bug 与功能建议"
  },
  "desktop.settings.footerHint": {
    en: "Feedback via GitHub Issues. Do not paste API keys or full transcripts.",
    "zh-cn": "请通过 GitHub Issues 反馈，勿粘贴 API 密钥或完整对话内容。"
  },

  "desktop.usage.scope": { en: "Range", "zh-cn": "范围" },
  "desktop.usage.last7": { en: "Last 7 days", "zh-cn": "近 7 天" },
  "desktop.usage.last30": { en: "Last 30 days", "zh-cn": "近 30 天" },
  "desktop.usage.last90": { en: "Last 90 days", "zh-cn": "近 90 天" },
  "desktop.usage.loading": { en: "Loading usage…", "zh-cn": "Loading usage…" },
  "desktop.usage.totalTokens": { en: "Total tokens", "zh-cn": "Total tokens" },
  "desktop.usage.promptCompletion": { en: "Prompt / Completion", "zh-cn": "Prompt / Completion" },
  "desktop.usage.chatEmbed": { en: "Chat / Embed", "zh-cn": "Chat / Embed" },
  "desktop.usage.events": { en: "Events", "zh-cn": "Events" },
  "desktop.usage.bySource": { en: "By source", "zh-cn": "By source" },
  "desktop.usage.byDay": { en: "By day", "zh-cn": "按日" },
  "desktop.usage.scheduleLog": { en: "Scheduled run log", "zh-cn": "定时执行日志" },
  "desktop.usage.llmDetails": { en: "LLM call details", "zh-cn": "LLM 调用明细" },
  "desktop.usage.colDate": { en: "Date", "zh-cn": "日期" },
  "desktop.usage.colTokens": { en: "Tokens", "zh-cn": "Tokens" },
  "desktop.usage.colCalls": { en: "Calls", "zh-cn": "调用" },
  "desktop.usage.colScheduleRuns": { en: "Scheduled runs", "zh-cn": "定时 runs" },
  "desktop.usage.colTime": { en: "Time", "zh-cn": "时间" },
  "desktop.usage.colLevel": { en: "Level", "zh-cn": "Level" },
  "desktop.usage.colPeriod": { en: "Period", "zh-cn": "Period" },
  "desktop.usage.colStatus": { en: "Status", "zh-cn": "Status" },
  "desktop.usage.colError": { en: "Error", "zh-cn": "Error" },
  "desktop.usage.colKind": { en: "Kind", "zh-cn": "Kind" },
  "desktop.usage.colSource": { en: "Source", "zh-cn": "Source" },
  "desktop.usage.colModel": { en: "Model", "zh-cn": "Model" },
  "desktop.usage.colMs": { en: "ms", "zh-cn": "ms" },
  "desktop.usage.noData": { en: "No data", "zh-cn": "暂无数据" },
  "desktop.usage.noScheduleRuns": { en: "No scheduled runs", "zh-cn": "暂无定时执行记录" },
  "desktop.usage.noLlmEvents": {
    en: "No call details yet (appears after digests / Ask)",
    "zh-cn": "暂无调用明细（生成 digests / Ask 后会出现）"
  },
  "desktop.usage.summaryStatus": { en: "Last {0} days · {1} calls", "zh-cn": "近 {0} 天 · {1} 次调用" },

  "desktop.backfill.scanning": { en: "Scanning catalog…", "zh-cn": "Scanning catalog…" },
  "desktop.backfill.scanningShort": { en: "Scanning…", "zh-cn": "Scanning…" },
  "desktop.backfill.preview": {
    en: "Preview · sessions {0} · days {1} · weeks {2} · months {3} · ~{4} LLM calls{5}",
    "zh-cn": "Preview · sessions {0} · days {1} · weeks {2} · months {3} · ~{4} LLM calls{5}"
  },
  "desktop.backfill.previewRange": { en: " · range {0} → {1}", "zh-cn": " · range {0} → {1}" },
  "desktop.backfill.noActivity": { en: " · no activity days", "zh-cn": " · no activity days" },
  "desktop.backfill.confirm": {
    en: "Batch-generate historical digests (day→week→month).\n\nSessions scanned: {0}\nDays: {1} · Weeks: {2} · Months: {3}\nEstimated LLM calls: ~{4}{5}\n\nMay be slow and incur API cost. Continue?",
    "zh-cn": "将批量生成历史 digests（日→周→月）。\n\nSessions 扫描: {0}\nDays: {1} · Weeks: {2} · Months: {3}\n预计 LLM 调用: ~{4}{5}\n\n可能较慢并产生 API 费用。是否继续？"
  },
  "desktop.backfill.dateRange": { en: "\nDate range: {0} → {1}\n", "zh-cn": "\n日期范围: {0} → {1}\n" },
  "desktop.backfill.cancelled": { en: "Cancelled", "zh-cn": "Cancelled" },
  "desktop.backfill.running": {
    en: "Backfilling (daily → weekly → monthly)… this may take a while",
    "zh-cn": "Backfilling (daily → weekly → monthly)… this may take a while"
  },
  "desktop.backfill.stats": {
    en: "{0}: ok {1} / skip {2} / fail {3} (planned {4})",
    "zh-cn": "{0}: ok {1} / skip {2} / fail {3} (planned {4})"
  },

  "desktop.dialog.markdown": { en: "Markdown", "zh-cn": "Markdown" },

  "desktop.workbench.noProjects": { en: "No projects yet", "zh-cn": "暂无项目" },
  "desktop.workbench.syncedCount": { en: "Synced {0} sessions", "zh-cn": "已同步 {0} sessions" },
  "desktop.workbench.terminalLabel": { en: "Terminal {0}", "zh-cn": "终端 {0}" },
  "desktop.workbench.openInApp": { en: "Open in {0}", "zh-cn": "在 {0} 中打开" },
  "desktop.workbench.removeConfirm": {
    en: 'Remove "{0}" from panel? (native storage unchanged)',
    "zh-cn": "从面板移除「{0}」？（不会删除原生存储）"
  },
  "desktop.workbench.newSessionTitle": { en: "New session · {0}", "zh-cn": "新 session · {0}" },
  "desktop.workbench.scratchSearch": { en: "scratch", "zh-cn": "临时目录" },
  "desktop.workbench.projectFilterMeta": {
    en: "Projects{0}{1} · {2}",
    "zh-cn": "项目{0}{1} · {2}"
  },
  "desktop.workbench.listMeta": { en: "{0} · {1} sessions", "zh-cn": "{0} · {1} 条" },
  "desktop.workbench.listMetaSearch": {
    en: '{0} · search "{1}" · {2} sessions',
    "zh-cn": '{0} · 搜索「{1}」· {2} 条'
  },
  "desktop.notes.listMeta": { en: "{0} · {1} notes", "zh-cn": "{0} · {1} 条" },
  "desktop.notes.listMetaSearch": {
    en: '{0} · search "{1}" · {2} notes',
    "zh-cn": '{0} · 搜索「{1}」· {2} 条'
  },
  "desktop.sessions.renamed": { en: 'Renamed to "{0}"', "zh-cn": "已重命名为「{0}」" },
  "desktop.sessions.renamedNativeError": {
    en: " (catalog updated; native: {0})",
    "zh-cn": "（catalog 已更新；原生存储：{0}）"
  },
  "desktop.sessions.regenerate": { en: "Regenerate", "zh-cn": "重新生成" },
  "desktop.sessions.gtdAnalyze": { en: "GTD analyze", "zh-cn": "GTD分析" },
  "desktop.report.regenerateBtn": { en: "Regenerate", "zh-cn": "重新生成" },
  "desktop.report.gtdBtn": { en: "GTD analyze", "zh-cn": "GTD分析" },
  "desktop.report.noDigest": { en: "No digest yet.", "zh-cn": "暂无 digest。" },
  "desktop.report.generatingDaily": { en: "Generating daily {0}…", "zh-cn": "正在生成日报 {0}…" },
  "desktop.report.generatingLabel": { en: "Generating {0} {1}…", "zh-cn": "正在生成{0} {1}…" },
  "desktop.report.generatingStrong": { en: "Generating", "zh-cn": "正在生成" },
  "desktop.report.generatingHint": {
    en: "See progress bar and session details above.",
    "zh-cn": "进度见上方进度条与 session 明细。"
  },
  "desktop.report.prepareSummarize": {
    en: "Preparing to summarize {0} sessions…",
    "zh-cn": "准备 summarize {0} 个 session…"
  },
  "desktop.report.generatingSessionSummary": {
    en: "Generating summary · {0}",
    "zh-cn": "正在生成摘要 · {0}"
  },
  "desktop.report.summarySkipped": {
    en: "Skipped (summary exists) · {0}",
    "zh-cn": "跳过（已有 summary）· {0}"
  },
  "desktop.report.summaryDone": {
    en: "Summary complete · {0}",
    "zh-cn": "摘要完成 · {0}"
  },
  "desktop.report.summaryFailed": {
    en: "Summary failed · {0}",
    "zh-cn": "摘要失败 · {0}"
  },
  "desktop.report.refreshNoSessionsSkip": {
    en: "No sessions this day; skipping generation",
    "zh-cn": "当日无 session，跳过生成"
  },
  "desktop.report.refreshDailyMissing": {
    en: "No daily yet · {0} sessions; will generate",
    "zh-cn": "尚无日报 · {0} sessions，将生成"
  },
  "desktop.report.refreshNewSessionsDaily": {
    en: "Detected {0} new sessions; will regenerate daily",
    "zh-cn": "检测到 {0} 个新 session，将重新生成日报"
  },
  "desktop.report.refreshUpdatedSessionsDaily": {
    en: "Detected {0} updated sessions; will regenerate daily",
    "zh-cn": "检测到 {0} 个 session 有更新，将重新生成日报"
  },
  "desktop.report.refreshDailyUpToDateCount": {
    en: "Daily up to date ({0} sessions)",
    "zh-cn": "日报已是最新（{0} sessions）"
  },
  "desktop.report.startDaily": {
    en: "Generating daily {0}… (summarize sessions first)",
    "zh-cn": "生成日报 {0}…（先 summarize sessions）"
  },
  "desktop.report.extractDailyFromSummary": {
    en: "Extracting daily {0} from summaries…",
    "zh-cn": "从 summary 提取日报 {0}…"
  },
  "desktop.report.skipEmbedding": { en: "Skipping embedding…", "zh-cn": "跳过 embedding…" },
  "desktop.report.writeEmbedding": { en: "Writing embedding…", "zh-cn": "写入 embedding…" },
  "desktop.report.dailyCompleteCount": {
    en: "Daily complete · {0} sessions",
    "zh-cn": "日报完成 · {0} sessions"
  },
  "desktop.report.extractWeeklyFromDailies": {
    en: "Extracting weekly from {0} dailies…",
    "zh-cn": "从 {0} 篇日报提取周报…"
  },
  "desktop.report.extractWeeklyPlaceholder": {
    en: "No dailies this week; generating placeholder weekly…",
    "zh-cn": "本周无日报，生成占位周报…"
  },
  "desktop.report.weeklyCompleteStats": {
    en: "Weekly complete · dailies {0} · backfill +{1}/skip {2}",
    "zh-cn": "周报完成 · dailies {0} · 补全 +{1}/skip {2}"
  },
  "desktop.report.extractMonthlyFromDailies": {
    en: "Extracting monthly from {0} dailies this month…",
    "zh-cn": "从本月 {0} 篇日报提取月报…"
  },
  "desktop.report.extractMonthlyPlaceholder": {
    en: "No dailies this month; generating placeholder monthly…",
    "zh-cn": "本月无日报，生成占位月报…"
  },
  "desktop.report.monthlyCompleteStats": {
    en: "Monthly complete · dailies {0} · daily +{1} · weekly +{2}",
    "zh-cn": "月报完成 · dailies {0} · 日报 +{1} · 周报 +{2}"
  },
  "desktop.report.aggregateWeeklyFromDailies": {
    en: "Aggregating weekly from {0} dailies",
    "zh-cn": "使用 {0} 篇日报聚合周报"
  },
  "desktop.report.aggregateWeeklyPlaceholder": {
    en: "No dailies this week (will generate placeholder weekly)",
    "zh-cn": "本周无可用日报（将生成占位周报）"
  },
  "desktop.report.aggregateMonthlyFromDailies": {
    en: "Aggregating monthly from {0} dailies this month",
    "zh-cn": "使用本月 {0} 篇日报聚合月报"
  },
  "desktop.report.aggregateMonthlyPlaceholder": {
    en: "No dailies this month (will generate placeholder monthly)",
    "zh-cn": "本月无可用日报（将生成占位月报）"
  },
  "desktop.report.freshDailiesUpToDateWeek": {
    en: "This week's dailies are up to date",
    "zh-cn": "本周日报已是最新"
  },
  "desktop.report.freshDailiesUpToDateMonth": {
    en: "This month's dailies are up to date",
    "zh-cn": "本月日报已是最新"
  },
  "desktop.report.freshDailiesUpToDatePeriod": {
    en: "Period dailies are up to date",
    "zh-cn": "本期日报已是最新"
  },
  "desktop.report.freshDailiesRefreshWeek": {
    en: "Refreshing stale dailies this week · {0} days…",
    "zh-cn": "先更新本周待刷新日报 · 共 {0} 天…"
  },
  "desktop.report.freshDailiesRefreshMonth": {
    en: "Refreshing stale dailies this month · {0} days…",
    "zh-cn": "先更新本月待刷新日报 · 共 {0} 天…"
  },
  "desktop.report.freshDailiesRefreshPeriod": {
    en: "Refreshing stale dailies this period · {0} days…",
    "zh-cn": "先更新本期待刷新日报 · 共 {0} 天…"
  },
  "desktop.report.freshDailiesUpdateProgress": {
    en: "Updating daily {0}/{1} · {2}",
    "zh-cn": "更新日报 {0}/{1} · {2}"
  },
  "desktop.report.freshWeekliesUpToDateMonth": {
    en: "This month's weeklies are up to date",
    "zh-cn": "本月周报已是最新"
  },
  "desktop.report.freshWeekliesRefreshMonth": {
    en: "Refreshing stale weeklies this month · {0} weeks…",
    "zh-cn": "先更新本月待刷新周报 · 共 {0} 周…"
  },
  "desktop.report.freshWeekliesUpdateProgress": {
    en: "Updating weekly {0}/{1} · {2}",
    "zh-cn": "更新周报 {0}/{1} · {2}"
  },
  "desktop.report.dailiesCompleteWeek": {
    en: "This week's dailies complete (or no session activity days)",
    "zh-cn": "本周日报已齐全（或无 session 活动日）"
  },
  "desktop.report.dailiesCompleteMonth": {
    en: "This month's dailies complete (or no session activity days)",
    "zh-cn": "本月日报已齐全（或无 session 活动日）"
  },
  "desktop.report.dailiesCompletePeriod": {
    en: "Period dailies complete (or no session activity days)",
    "zh-cn": "本期日报已齐全（或无 session 活动日）"
  },
  "desktop.report.ensureDailiesCheckWeek": {
    en: "Checking and backfilling this week's dailies · {0} days to generate…",
    "zh-cn": "检查并补全本周日报 · 需生成 {0} 天…"
  },
  "desktop.report.ensureDailiesCheckMonth": {
    en: "Checking and backfilling this month's dailies · {0} days to generate…",
    "zh-cn": "检查并补全本月日报 · 需生成 {0} 天…"
  },
  "desktop.report.ensureDailiesCheckPeriod": {
    en: "Checking and backfilling period dailies · {0} days to generate…",
    "zh-cn": "检查并补全本期日报 · 需生成 {0} 天…"
  },
  "desktop.report.backfillDailyProgress": {
    en: "Backfilling daily {0}/{1} · {2}",
    "zh-cn": "补全日报 {0}/{1} · {2}"
  },
  "desktop.report.weekliesCompleteMonth": {
    en: "This month's weeklies complete (or no session activity weeks)",
    "zh-cn": "本月周报已齐全（或无 session 活动周）"
  },
  "desktop.report.ensureWeekliesCheck": {
    en: "Checking and backfilling weeklies · {0} weeks to generate…",
    "zh-cn": "检查并补全周报 · 需生成 {0} 周…"
  },
  "desktop.report.backfillWeeklyProgress": {
    en: "Backfilling weekly {0}/{1} · {2}",
    "zh-cn": "补全周报 {0}/{1} · {2}"
  },
  "desktop.report.nestedDailyDetail": {
    en: "Daily {0} · {1}",
    "zh-cn": "日报 {0} · {1}"
  },
  "desktop.report.nestedDailyLabel": { en: "Daily {0}", "zh-cn": "日报 {0}" },
  "desktop.report.nestedWeeklyDetail": {
    en: "Weekly {0} · {1}",
    "zh-cn": "周报 {0} · {1}"
  },
  "desktop.report.nestedWeeklyLabel": { en: "Weekly {0}", "zh-cn": "周报 {0}" },
  "desktop.report.periodNoSessions": {
    en: "{0}: no sessions in period",
    "zh-cn": "{0}：当期无 session"
  },
  "desktop.report.periodMissing": {
    en: "No {0} yet · {1} sessions",
    "zh-cn": "尚无{0} · {1} sessions"
  },
  "desktop.report.periodUpdatedSessions": {
    en: "{0}: {1} sessions updated",
    "zh-cn": "{0}：{1} 个 session 有更新"
  },
  "desktop.report.periodUnderlyingNewOnly": {
    en: "{0}: {1} new dailies",
    "zh-cn": "{0}：{1} 篇新日报"
  },
  "desktop.report.periodUnderlyingStaleOnly": {
    en: "{0}: {1} days with stale dailies",
    "zh-cn": "{0}：{1} 天日报待更新"
  },
  "desktop.report.periodUnderlyingBoth": {
    en: "{0}: {1} new dailies, {2} days with stale dailies",
    "zh-cn": "{0}：{1} 篇新日报、{2} 天日报待更新"
  },
  "desktop.report.periodUpToDate": { en: "{0} up to date", "zh-cn": "{0}已是最新" },
  "desktop.report.weeklyStaleShort": { en: "Weekly update pending", "zh-cn": "周报待更新" },
  "desktop.report.monthlyStaleShort": { en: "Monthly update pending", "zh-cn": "月报待更新" },
  "desktop.report.futureWeek": { en: "Future week {0}", "zh-cn": "未来周 {0}" },
  "desktop.report.weeklyTitleStale": { en: "Weekly {0} · {1}", "zh-cn": "周报 {0} · {1}" },
  "desktop.report.weeklyTitleView": {
    en: "Weekly {0} · click to view (regenerate in side panel)",
    "zh-cn": "周报 {0} · 点击查看（右侧面板可重新生成）"
  },
  "desktop.report.weeklyTitleGenerate": {
    en: "Weekly {0} · click sessions; generate in side panel",
    "zh-cn": "周报 {0} · 点击查看 session，右侧面板生成"
  },
  "desktop.report.monthTitleStale": { en: "Month {0} · {1}", "zh-cn": "月 {0} · {1}" },
  "desktop.report.monthTitleView": {
    en: "Month {0} · click sessions & monthly report (regenerate in side panel)",
    "zh-cn": "月 {0} · 点击查看 session 与月报（右侧面板可重新生成）"
  },
  "desktop.report.monthTitleGenerate": {
    en: "Month {0} · click sessions; generate monthly in side panel",
    "zh-cn": "月 {0} · 点击查看 session，右侧面板生成月报"
  },
  "desktop.report.dailyStaleTitle": {
    en: "Daily exists; {0} · {1}",
    "zh-cn": "日报已有，{0} · {1}"
  },
  "desktop.report.sessionChanged": { en: "sessions changed", "zh-cn": "session 有变化" },
  "desktop.report.dailyUpToDate": { en: "Daily up to date · {0}", "zh-cn": "日报已是最新 · {0}" },
  "desktop.report.dailyMissingTitle": { en: "Sessions exist; daily not generated · {0}", "zh-cn": "有 session，日报未生成 · {0}" },
  "desktop.report.noSessionTitle": { en: "No sessions · {0}", "zh-cn": "无 session · {0}" },
  "desktop.report.unknownLevel": { en: "Unknown level: {0}", "zh-cn": "未知 level: {0}" },
  "desktop.report.gtdCachePreview": {
    en: "Cached preview · {0} items · source {1}:{2} · click Re-analyze to refresh",
    "zh-cn": "缓存预览 · {0} 项 · 源 {1}:{2} · 点「重新分析」可刷新"
  },
  "desktop.report.staleNewSessions": {
    en: "{0} new sessions not in daily; consider regenerating.",
    "zh-cn": "有 {0} 个新 session 还没写进日报，方便的话可以再生成一次同步一下。"
  },
  "desktop.report.staleUpdatedSessions": {
    en: "{0} sessions updated after daily; consider regenerating.",
    "zh-cn": "有 {0} 个 session 在日报之后又更新了，方便的话可以再生成一次保持最新。"
  },
  "desktop.report.staleUpdatedAfterDigest": {
    en: "{0} sessions updated after {1}; consider regenerating.",
    "zh-cn": "有 {0} 个 session 在{1}之后又更新了，方便的话可以再生成一次保持最新。"
  },
  "desktop.report.staleUnderlyingDaily": {
    en: "Underlying dailies changed; {0} may be outdated. Consider regenerating.",
    "zh-cn": "底层日报有变化，{0}可能不是最新的。方便的话可以再生成一次同步一下。"
  },
  "desktop.report.llmRequiredTitle": {
    en: "Cannot generate {0}: tool LLM not configured",
    "zh-cn": "无法生成{0}：尚未配置工具 LLM"
  },
  "desktop.report.llmRequiredBody1": {
    en: "Calendar sessions come from local index; daily/weekly/monthly digests require tool LLM API.",
    "zh-cn": "日历中的 session 来自本地索引；生成日报 / 周报 / 月报需要调用工具 LLM API（会先补全缺失的日报，再聚合为周报 / 月报）。"
  },
  "desktop.report.llmRequiredBody2": {
    en: "Fill Base URL, Model, API Key under Settings → Models; auto-saves. Retry after saving.",
    "zh-cn": "请在 设置 → 模型 填写 Base URL、Model、API Key，会自动保存，保存后重试。"
  },
  "desktop.report.llmSettingsBtn": { en: "Open Settings", "zh-cn": "去 Settings 配置" },
  "desktop.report.llmRequiredToast": {
    en: "Cannot generate {0}: configure tool LLM under Settings → Models",
    "zh-cn": "无法生成{0}：请先在设置 → 模型配置工具 LLM（baseUrl / model / apiKey）"
  },
  "desktop.report.llmRequiredGenFinal": {
    en: "Cannot generate {0}: configure tool LLM in Settings → Provider first",
    "zh-cn": "无法生成{0}：请先在 Settings → Provider 配置工具 LLM"
  },
  "desktop.report.emptyNoSessions": {
    en: "No CLI sessions for {0} yet; no need to generate {1}.",
    "zh-cn": "{0}还没有 CLI 会话记录，暂时不必生成{1}。"
  },
  "desktop.report.emptyHasSessions": {
    en: "{0} has activity; {1} not ready. Tap below to generate (configure tool LLM in Settings first).",
    "zh-cn": "{0}有会话活动，{1}还没整理好。如果想汇总一下，可以点下方按钮（需先在 Settings 配置工具 LLM）。"
  },
  "desktop.report.generateBtn": { en: "Generate {0}", "zh-cn": "生成{0}" },
  "desktop.report.futureDateHint": {
    en: "Future dates cannot generate {0} yet; check back after activity.",
    "zh-cn": "未来的日期还无法生成{0}，等有活动后再来看看吧。"
  },
  "desktop.agent.deleteConfirmSimple": { en: 'Delete chat "{0}"?', "zh-cn": '确定要删除对话 "{0}" 吗？' },
  "desktop.agent.auditIndexWithTitle": { en: "{0} · {1}", "zh-cn": "{0} · {1}" },
  "desktop.agent.indexProgress": { en: "Indexing notes…", "zh-cn": "正在索引笔记…" },
  "desktop.agent.statusGenerating": { en: "Generating answer…", "zh-cn": "生成回答…" },
  "desktop.agent.deleteFailedPrefix": { en: "Delete failed: {0}", "zh-cn": "删除失败：{0}" },
  "desktop.agent.renameFailedPrefix": { en: "Rename failed: {0}", "zh-cn": "重命名失败：{0}" },
  "desktop.agent.createFailedPrefix": { en: "Create chat failed: {0}", "zh-cn": "创建对话失败：{0}" },
  "desktop.agent.loadThreadsFailedPrefix": { en: "Load chats failed: {0}", "zh-cn": "加载对话列表失败：{0}" },
  "desktop.agent.loadChatFailedPrefix": { en: "Load chat failed: {0}", "zh-cn": "加载对话失败：{0}" },
  "desktop.agent.loadOlderFailedPrefix": { en: "Load older messages failed: {0}", "zh-cn": "加载更早消息失败：{0}" },
  "desktop.agent.auditFailedPrefix": { en: "Failed to load trace: {0}", "zh-cn": "加载追踪失败：{0}" },
  "desktop.agent.sendFailedPrefix": { en: "Send failed: {0}", "zh-cn": "发送失败：{0}" },
  "desktop.agent.cancelled": { en: "Cancelled", "zh-cn": "已取消" },
  "desktop.agent.stopped": { en: "Stopped", "zh-cn": "已停止" },
  "desktop.agent.errorPrefix": { en: "Error: {0}", "zh-cn": "错误：{0}" },
  "desktop.agent.emptyChat": { en: "Start a conversation…", "zh-cn": "开始对话…" },
  "desktop.agent.loadOlder": { en: "Load older messages", "zh-cn": "加载更早消息" },
  "desktop.agent.renameProjectDialog": { en: "Rename project", "zh-cn": "重命名项目" },
  "desktop.agent.traceRefresh": { en: "Refresh trace", "zh-cn": "刷新追踪" },
  "desktop.report.openedDigestStatus": { en: "Opened {0} {1}", "zh-cn": "已打开 {0} {1}" },
  "desktop.report.weeklyMonthlyBusyError": {
    en: "Weekly/monthly generation in progress, please wait…",
    "zh-cn": "周报/月报生成中，请稍候…"
  },
  "desktop.report.taskBusyRegenWeekly": {
    en: "A task is running; wait before regenerating weekly…",
    "zh-cn": "有任务进行中，请稍候再重新生成周报…"
  },
  "desktop.report.taskBusyRegenMonthly": {
    en: "A task is running; wait before regenerating monthly…",
    "zh-cn": "有任务进行中，请稍候再重新生成月报…"
  },
  "desktop.report.taskBusyGenWeekly": {
    en: "A task is running; wait before generating weekly…",
    "zh-cn": "有任务进行中，请稍候再生成周报…"
  },
  "desktop.report.taskBusyGenMonthly": {
    en: "A task is running; wait before generating monthly…",
    "zh-cn": "有任务进行中，请稍候再生成月报…"
  },
  "desktop.report.parallelDailyOne": { en: "Generating daily {0}…", "zh-cn": "生成日报 {0}…" },
  "desktop.report.parallelDailyMany": {
    en: "Generating {0} dailies in parallel: {1}",
    "zh-cn": "并行生成 {0} 天日报：{1}"
  },
  "desktop.report.generatingWeekly": { en: "Generating weekly {0}…", "zh-cn": "生成周报 {0}…" },
  "desktop.report.generatingMonthly": { en: "Generating monthly {0}…", "zh-cn": "生成月报 {0}…" },
  "desktop.report.stillGenerating": { en: " · still generating: {0}", "zh-cn": " · 仍在生成：{0}" },
  "desktop.report.dailyFailed": { en: "Daily {0} failed: {1}", "zh-cn": "日报 {0} 失败：{1}" },
  "desktop.report.digestFailedShort": { en: "{0} failed: {1}", "zh-cn": "{0} 失败：{1}" },
  "desktop.report.backfillDaily": { en: "backfill daily +{0}/skip {1}{2}", "zh-cn": "补日报 +{0}/skip {1}{2}" },
  "desktop.report.backfillWeekly": { en: "backfill weekly +{0}/skip {1}{2}", "zh-cn": "补周报 +{0}/skip {1}{2}" },
  "desktop.report.gtdWarnDefault": {
    en: "Possible reasons: no sessions in period, or model did not return session ids.",
    "zh-cn": "可能原因：该 digest 周期内无关联 session，或模型未给出可落库的 session id。"
  },
  "desktop.report.gtdMdDone": { en: "Done", "zh-cn": "完成" },
  "desktop.sessions.summarizeBtn": { en: "Summarize", "zh-cn": "Summarize" },
  "desktop.sessions.autoRenameBtn": { en: "Auto Rename", "zh-cn": "Auto Rename" },
  "desktop.sessions.summarizingBtn": { en: "Summarizing…", "zh-cn": "Summarizing…" },
  "desktop.sessions.renamingBtn": { en: "Renaming…", "zh-cn": "Renaming…" }
};

function nest(flatMap) {
  const en = {};
  const zhcn = {};
  for (const [key, val] of Object.entries(flatMap)) {
    const parts = key.split(".");
    // Group under desktop.<section> but keep full desktop.* key at leaves for merge script.
    const groupParts = parts.slice(1, -1);
    let enNode = en;
    let zhNode = zhcn;
    for (const p of groupParts) {
      enNode[p] = enNode[p] || {};
      zhNode[p] = zhNode[p] || {};
      enNode = enNode[p];
      zhNode = zhNode[p];
    }
    enNode[key] = val.en;
    zhNode[key] = val["zh-cn"];
  }
  return { en, "zh-cn": zhcn };
}

const catalog = nest(flat);
const outPath = join(root, "scripts", "desktop-i18n-catalog.json");
writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${Object.keys(flat).length} keys to ${outPath}`);