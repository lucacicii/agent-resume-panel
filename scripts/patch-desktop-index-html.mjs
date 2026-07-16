#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const path = join(import.meta.dirname, "..", "apps/desktop/src/renderer/index.html");
let html = readFileSync(path, "utf8");

html = html.replace('<html lang="zh-CN">', '<html lang="en">');
html = html.replace("<title>Agent Resume Desktop</title>", '<title data-i18n="desktop.app.title">Agent Resume Desktop</title>');

const attrMap = [
  ['data-tab="report">Memory</button>', 'data-tab="report" data-i18n="desktop.tabs.report">Report</button>'],
  ['data-tab="agent">Ask</button>', 'data-tab="agent" data-i18n="desktop.tabs.agent">Agent</button>'],
  ['data-tab="workbench">工作台</button>', 'data-tab="workbench" data-i18n="desktop.tabs.workbench">Workbench</button>'],
  ['data-tab="notes">笔记</button>', 'data-tab="notes" data-i18n="desktop.tabs.notes">Notes</button>'],
  ['id="btnOpenSessions" title="Sessions 参考">Sessions</button>', 'id="btnOpenSessions" data-i18n-title="desktop.top.sessionsRefTitle" data-i18n="desktop.top.sessionsRef">Sessions</button>'],
  ['id="btnOpenSettings" title="Settings">⚙</button>', 'id="btnOpenSettings" data-i18n-title="desktop.top.settingsTitle" aria-label="Settings">⚙</button>'],
  ['id="btnCalPrev" title="上月">‹</button>', 'id="btnCalPrev" data-i18n-title="desktop.report.prevMonth" aria-label="Previous month">‹</button>'],
  ['id="btnCalNext" title="下月">›</button>', 'id="btnCalNext" data-i18n-title="desktop.report.nextMonth" aria-label="Next month">›</button>'],
  ['id="calYearSelect" class="quiet-select tool-select cal-year-select" title="年" aria-label="年"', 'id="calYearSelect" class="quiet-select tool-select cal-year-select" data-i18n-title="desktop.common.year" data-i18n-aria-label="desktop.common.year"'],
  ['id="calMonthSelect" class="quiet-select tool-select cal-month-select" title="月" aria-label="月"', 'id="calMonthSelect" class="quiet-select tool-select cal-month-select" data-i18n-title="desktop.common.month" data-i18n-aria-label="desktop.common.month"'],
  ['id="btnCalToday">今天</button>', 'id="btnCalToday" data-i18n="desktop.common.today">Today</button>'],
  ['id="btnRefreshReport">刷新</button>', 'id="btnRefreshReport" data-i18n="desktop.common.refresh">Refresh</button>'],
  ['<span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>', '<span data-i18n="desktop.report.weekdayMon">Mon</span><span data-i18n="desktop.report.weekdayTue">Tue</span><span data-i18n="desktop.report.weekdayWed">Wed</span><span data-i18n="desktop.report.weekdayThu">Thu</span><span data-i18n="desktop.report.weekdayFri">Fri</span><span data-i18n="desktop.report.weekdaySat">Sat</span><span data-i18n="desktop.report.weekdaySun">Sun</span>'],
  ['<span class="cal-week-col-head">周</span>', '<span class="cal-week-col-head" data-i18n="desktop.report.weekCol">Wk</span>'],
  ['id="btnCalMonthDigest">月</button>', 'id="btnCalMonthDigest" data-i18n="desktop.report.monthBtn">Month</button>'],
  ['<strong id="calSessionTitle">Sessions</strong>', '<strong id="calSessionTitle" data-i18n="desktop.report.sessionsTitle">Sessions</strong>'],
  ['<strong id="calDetailTitle">报告详情</strong>', '<strong id="calDetailTitle" data-i18n="desktop.report.reportDetail">Report detail</strong>'],
  ['id="btnCalDetailBack" hidden>\n                返回报告\n              </button>', 'id="btnCalDetailBack" hidden data-i18n="desktop.report.backToReport">Back to report</button>'],
  ['id="btnAgentNewChat" title="新建对话" aria-label="新建对话"', 'id="btnAgentNewChat" data-i18n-title="desktop.agent.newChat" data-i18n-aria-label="desktop.agent.newChat"'],
  ['id="btnAgentToggleSidebar"\n                title="隐藏侧栏"\n                aria-label="隐藏侧栏"', 'id="btnAgentToggleSidebar"\n                data-i18n-title="desktop.common.hideSidebar"\n                data-i18n-aria-label="desktop.common.hideSidebar"'],
  ['<h2 class="quiet-title" id="agentChatTitle">Ask</h2>', '<h2 class="quiet-title" id="agentChatTitle" data-i18n="desktop.tabs.agent">Agent</h2>'],
  ['id="btnAgentRenameChat">重命名</button>', 'id="btnAgentRenameChat" data-i18n="desktop.agent.renameChat">Rename</button>'],
  ['id="btnAgentAudit">追踪</button>', 'id="btnAgentAudit" data-i18n="desktop.agent.audit">Trace</button>'],
  ['id="btnClearChat">删除对话</button>', 'id="btnClearChat" data-i18n="desktop.agent.deleteChat">Delete chat</button>'],
  ['id="agentInput" rows="1" placeholder="输入消息…"', 'id="agentInput" rows="1" data-i18n-placeholder="desktop.agent.inputPlaceholder" placeholder="Type a message…"'],
  ['id="btnAgentTools" class="chat-tools-toggle active" title="工具已开启：可通过对话操作笔记" aria-label="工具开关"', 'id="btnAgentTools" class="chat-tools-toggle active" data-i18n-title="desktop.agent.toolsOn" data-i18n-aria-label="desktop.agent.toolsToggle"'],
  ['id="btnAgentSend" class="chat-send-btn" title="发送" aria-label="发送"', 'id="btnAgentSend" class="chat-send-btn" data-i18n-title="desktop.common.send" data-i18n-aria-label="desktop.common.send"'],
  ['<span id="agentIndexProgressText">正在索引笔记…</span>', '<span id="agentIndexProgressText" data-i18n="desktop.agent.indexingNotes">Indexing notes…</span>'],
  ['<strong>Ask 笔记追踪</strong>', '<strong data-i18n="desktop.agent.auditTitle">Agent note trace</strong>'],
  ['id="btnAgentAuditRefresh">刷新</button>', 'id="btnAgentAuditRefresh" data-i18n="desktop.common.refresh">Refresh</button>'],
  ['placeholder="筛选项目"', 'data-i18n-placeholder="desktop.notes.filterProjects" placeholder="Filter projects"'],
  ['aria-label="筛选项目"', 'data-i18n-aria-label="desktop.notes.filterProjects" aria-label="Filter projects"'],
  ['aria-label="项目筛选"', 'data-i18n-aria-label="desktop.notes.projectFilter" aria-label="Project filter"'],
  ['data-filter="all" class="active">全部</button>', 'data-filter="all" class="active" data-i18n="desktop.common.all">All</button>'],
  ['data-filter="pinned">置顶</button>', 'data-filter="pinned" data-i18n="desktop.common.pinned">Pinned</button>'],
  ['data-filter="active">活动</button>', 'data-filter="active" data-i18n="desktop.common.active">Active</button>'],
  ['id="btnNotesNew" title="新建笔记" aria-label="新建笔记"', 'id="btnNotesNew" data-i18n-title="desktop.common.newNote" data-i18n-aria-label="desktop.common.newNote"'],
  ['id="btnNotesImport" title="导入 Markdown" aria-label="导入 Markdown"', 'id="btnNotesImport" data-i18n-title="desktop.common.importMarkdown" data-i18n-aria-label="desktop.common.importMarkdown"'],
  ['id="btnNotesRefresh" title="刷新" aria-label="刷新"', 'id="btnNotesRefresh" data-i18n-title="desktop.common.refresh" data-i18n-aria-label="desktop.common.refresh"'],
  ['id="btnNotesDelete"\n                  title="删除笔记"\n                  aria-label="删除笔记"', 'id="btnNotesDelete"\n                  data-i18n-title="desktop.notes.deleteNote"\n                  data-i18n-aria-label="desktop.notes.deleteNote"'],
  ['aria-label="笔记目标"', 'data-i18n-aria-label="desktop.notes.targetTabs" aria-label="Note target"'],
  ['data-target-kind="library" class="active">独立笔记</button>', 'data-target-kind="library" class="active" data-i18n="desktop.notes.targetLibrary">Standalone</button>'],
  ['data-target-kind="project">项目</button>', 'data-target-kind="project" data-i18n="desktop.notes.targetProject">Project</button>'],
  ['data-target-kind="session">会话</button>', 'data-target-kind="session" data-i18n="desktop.notes.targetSession">Session</button>'],
  ['id="notesSearch" class="notes-search" placeholder="搜索"', 'id="notesSearch" class="notes-search" data-i18n-placeholder="desktop.common.search" placeholder="Search"'],
  ['data-mode="edit">编辑</button>', 'data-mode="edit" data-i18n="desktop.common.edit">Edit</button>'],
  ['data-mode="view">查看</button>', 'data-mode="view" data-i18n="desktop.common.view">View</button>'],
  ['id="wbSearch" class="wb-search" placeholder="搜索"', 'id="wbSearch" class="wb-search" data-i18n-placeholder="desktop.common.search" placeholder="Search"'],
  ['id="wbDetailProjectLabel">全部 Sessions</span>', 'id="wbDetailProjectLabel">\n                <span class="wb-detail-project-label-text" id="wbDetailProjectLabelText" data-i18n="desktop.workbench.allSessions">All Sessions</span>\n                <span class="wb-detail-project-path" id="wbDetailProjectPath" hidden></span>\n              </span>'],
  ['id="btnWorkbenchTabNewTerminal"\n                    title="新建 Terminal"\n                    aria-label="新建 Terminal"', 'id="btnWorkbenchTabNewTerminal"\n                    data-i18n-title="desktop.workbench.newTerminal"\n                    data-i18n-aria-label="desktop.workbench.newTerminal"'],
  ['id="btnWorkbenchTabNewSession"\n                    title="新建 Session"\n                    aria-label="新建 Session"', 'id="btnWorkbenchTabNewSession"\n                    data-i18n-title="desktop.workbench.newSession"\n                    data-i18n-aria-label="desktop.workbench.newSession"'],
  ['<h2 class="quiet-title">Settings</h2>', '<h2 class="quiet-title" data-i18n="desktop.settings.title">Settings</h2>'],
  ['id="btnSettingsBack">完成</button>', 'id="btnSettingsBack" data-i18n="desktop.settings.done">Done</button>'],
  ['<aside class="settings-nav" aria-label="Settings menu">', '<aside class="settings-nav" data-i18n-aria-label="desktop.settings.navLabel" aria-label="Settings menu">'],
  ['data-settings-pane="general">通用</button>', 'data-settings-pane="general" data-i18n="desktop.settings.paneGeneral">General</button>'],
  ['data-settings-pane="models">模型</button>', 'data-settings-pane="models" data-i18n="desktop.settings.paneModels">Models</button>'],
  ['data-settings-pane="sessions">Sessions</button>', 'data-settings-pane="sessions" data-i18n="desktop.settings.paneSessions">Sessions</button>'],
  ['data-settings-pane="workbench">工作台</button>', 'data-settings-pane="workbench" data-i18n="desktop.settings.paneWorkbench">Workbench</button>'],
  ['data-settings-pane="report">Memory</button>', 'data-settings-pane="report" data-i18n="desktop.settings.paneReport">Memory</button>'],
  ['data-settings-pane="storage">数据</button>', 'data-settings-pane="storage" data-i18n="desktop.settings.paneStorage">Data</button>'],
  ['data-settings-pane="usage">用量</button>', 'data-settings-pane="usage" data-i18n="desktop.settings.paneUsage">Usage</button>'],
  ['<h2 id="settingsPaneTitle" class="settings-pane-title">通用</h2>', '<h2 id="settingsPaneTitle" class="settings-pane-title" data-i18n="desktop.settings.paneGeneral">General</h2>'],
  ['<p id="settingsPaneDesc" class="settings-pane-desc">外观与日常偏好</p>', '<p id="settingsPaneDesc" class="settings-pane-desc" data-i18n="desktop.settings.paneGeneralDesc">Appearance and daily preferences</p>'],
  ['<span class="cal-legend-group">日期：<span class="dot daily"></span>D 已生成', '<span class="cal-legend-group"><span data-i18n="desktop.report.legendDates">Dates:</span><span class="dot daily"></span><span data-i18n="desktop.report.legendDailyOk">D generated</span>'],
  ['<span class="dot daily-stale"></span>更 待更新', '<span class="dot daily-stale"></span><span data-i18n="desktop.report.legendDailyStale">Update pending</span>'],
  ['<span class="dot daily-missing"></span>未 待生成', '<span class="dot daily-missing"></span><span data-i18n="desktop.report.legendDailyMissing">Not generated</span>'],
  ['<span class="dot no-session"></span>无 无活动</span>', '<span class="dot no-session"></span><span data-i18n="desktop.report.legendNoSession">No activity</span></span>'],
  ['<span class="cal-legend-group"><span class="dot weekly"></span>周报', '<span class="cal-legend-group"><span class="dot weekly"></span><span data-i18n="desktop.report.legendWeekly">Weekly</span>'],
  ['<span class="dot monthly"></span>月报</span>', '<span class="dot monthly"></span><span data-i18n="desktop.report.legendMonthly">Monthly</span></span>'],
  ['<p class="muted cal-session-empty">切换月份或选择日期 / 周后显示 session</p>', '<p class="muted cal-session-empty" data-i18n="desktop.report.sessionEmpty">Select a month or date / week to show sessions</p>'],
  ['<p class="muted">点击日期 / 周 / 月查看 session 与报告；点击 session 可在本列预览。</p>', '<p class="muted" data-i18n="desktop.report.detailHint">Click a date / week / month to view sessions and reports.</p>'],
  ['<p class="muted">暂无追踪记录</p>', '<p class="muted" data-i18n="desktop.agent.auditEmpty">No trace records yet</p>'],
  ['<p class="muted notes-folders-empty">加载文件夹…</p>', '<p class="muted notes-folders-empty" data-i18n="desktop.notes.loadingFolders">Loading folders…</p>'],
  ['aria-label="调整文件夹侧栏宽度"', 'data-i18n-aria-label="desktop.notes.resizeFolders" aria-label="Resize folder sidebar"'],
  ['id="notesTargetSearch" placeholder="筛选…"', 'id="notesTargetSearch" data-i18n-placeholder="desktop.common.filter" placeholder="Filter…"'],
  ['<p class="muted notes-list-empty">加载笔记…</p>', '<p class="muted notes-list-empty" data-i18n="desktop.notes.loadingNotes">Loading notes…</p>'],
  ['aria-label="调整笔记列表宽度"', 'data-i18n-aria-label="desktop.notes.resizeList" aria-label="Resize note list"'],
  ['aria-label="视图模式"', 'data-i18n-aria-label="desktop.notes.viewMode" aria-label="View mode"'],
  ['id="notesFindInput" class="notes-find-input" placeholder="查找当前笔记"', 'id="notesFindInput" class="notes-find-input" data-i18n-placeholder="desktop.notes.findInNote" placeholder="Find in note"'],
  ['id="btnNotesFindPrev" title="上一个" aria-label="上一个"', 'id="btnNotesFindPrev" data-i18n-title="desktop.common.previous" data-i18n-aria-label="desktop.common.previous"'],
  ['id="btnNotesFindNext" title="下一个" aria-label="下一个"', 'id="btnNotesFindNext" data-i18n-title="desktop.common.next" data-i18n-aria-label="desktop.common.next"'],
  ['id="btnNotesFindClose" title="关闭查找" aria-label="关闭查找"', 'id="btnNotesFindClose" data-i18n-title="desktop.common.closeFind" data-i18n-aria-label="desktop.common.closeFind"'],
  ['<p class="muted notes-hint" id="notesHint">选择或创建一条笔记</p>', '<p class="muted notes-hint" id="notesHint" data-i18n="desktop.notes.selectOrCreate">Select or create a note</p>'],
  ['<p class="muted wb-folders-empty">加载项目…</p>', '<p class="muted wb-folders-empty" data-i18n="desktop.workbench.loadingProjects">Loading projects…</p>'],
  ['aria-label="调整项目侧栏宽度"', 'data-i18n-aria-label="desktop.workbench.resizeProjects" aria-label="Resize project sidebar"'],
  ['placeholder="筛选项目…"', 'data-i18n-placeholder="desktop.workbench.filterProjects" placeholder="Filter projects…"'],
  ['aria-label="调整 Session 列表宽度"', 'data-i18n-aria-label="desktop.workbench.resizeSessions" aria-label="Resize session list"'],
  ['<p class="muted wb-terminal-hint" id="wbTerminalHint">选择 session 以恢复终端</p>', '<p class="muted wb-terminal-hint" id="wbTerminalHint" data-i18n="desktop.workbench.selectSessionHint">Select a session to restore terminal</p>'],
  ['aria-label="终端标签"', 'data-i18n-aria-label="desktop.workbench.terminalTabs" aria-label="Terminal tabs"'],
  ['id="btnWorkbenchRefresh" title="刷新" aria-label="刷新"', 'id="btnWorkbenchRefresh" data-i18n-title="desktop.common.refresh" data-i18n-aria-label="desktop.common.refresh"'],
  ['data-close-sheet="sheetGtd">关闭</button>', 'data-close-sheet="sheetGtd" data-i18n="desktop.common.close">Close</button>'],
  ['data-close-sheet="sheetSessions">关闭</button>', 'data-close-sheet="sheetSessions" data-i18n="desktop.common.close">Close</button>'],
  ['data-notes-action="pinProject" hidden>置顶项目</button>', 'data-notes-action="pinProject" hidden data-i18n="desktop.notes.pinProject">Pin project</button>'],
  ['data-notes-action="unpinProject" hidden>取消置顶</button>', 'data-notes-action="unpinProject" hidden data-i18n="desktop.notes.unpinProject">Unpin project</button>'],
  ['data-notes-action="new" hidden>新建笔记</button>', 'data-notes-action="new" hidden data-i18n="desktop.common.newNote">New note</button>'],
  ['data-notes-action="import" hidden>导入 Markdown</button>', 'data-notes-action="import" hidden data-i18n="desktop.common.importMarkdown">Import Markdown</button>'],
  ['data-notes-action="renameProject" hidden>重命名项目</button>', 'data-notes-action="renameProject" hidden data-i18n="desktop.notes.renameProject">Rename project</button>'],
  ['data-notes-action="move" hidden>更改归属…</button>', 'data-notes-action="move" hidden data-i18n="desktop.notes.changeOwner">Change owner…</button>'],
  ['data-notes-action="copyPath" hidden>复制路径</button>', 'data-notes-action="copyPath" hidden data-i18n="desktop.notes.copyPath">Copy path</button>'],
  ['data-notes-action="reveal" hidden>在 Finder 中显示</button>', 'data-notes-action="reveal" hidden data-i18n="desktop.common.revealInFinder">Reveal in Finder</button>'],
  ['data-notes-action="delete" hidden>删除笔记</button>', 'data-notes-action="delete" hidden data-i18n="desktop.notes.deleteNote">Delete note</button>'],
  ['data-wb-action="pinProject" hidden>置顶项目</button>', 'data-wb-action="pinProject" hidden data-i18n="desktop.workbench.pinProject">Pin project</button>'],
  ['data-wb-action="unpinProject" hidden>取消置顶</button>', 'data-wb-action="unpinProject" hidden data-i18n="desktop.workbench.unpinProject">Unpin project</button>'],
  ['data-wb-action="newSession" hidden>新建 Session</button>', 'data-wb-action="newSession" hidden data-i18n="desktop.workbench.newSession">New Session</button>'],
  ['data-wb-action="openProjectEditor" hidden>在编辑器中打开</button>', 'data-wb-action="openProjectEditor" hidden data-i18n="desktop.workbench.openInEditor">Open in editor</button>'],
  ['data-wb-action="mountNote" hidden>挂载笔记</button>', 'data-wb-action="mountNote" hidden data-i18n="desktop.workbench.mountNote">Mount note</button>'],
  ['data-wb-action="renameProject" hidden>重命名项目</button>', 'data-wb-action="renameProject" hidden data-i18n="desktop.workbench.renameProject">Rename project</button>'],
  ['data-wb-action="codexApp" hidden>在 ChatGPT 中打开</button>', 'data-wb-action="codexApp" hidden data-i18n="desktop.workbench.openInChatGpt">Open in ChatGPT</button>'],
  ['data-wb-action="preview" hidden>预览</button>', 'data-wb-action="preview" hidden data-i18n="desktop.workbench.preview">Preview</button>'],
  ['data-wb-action="rename" hidden>重命名</button>', 'data-wb-action="rename" hidden data-i18n="desktop.common.rename">Rename</button>'],
  ['data-wb-action="remove" hidden>从面板移除</button>', 'data-wb-action="remove" hidden data-i18n="desktop.workbench.removeFromPanel">Remove from panel</button>'],
  ['data-chat-action="copy">复制</button>', 'data-chat-action="copy" data-i18n="desktop.common.copy">Copy</button>'],
  ['data-chat-action="resend">重新发送</button>', 'data-chat-action="resend" data-i18n="desktop.common.resend">Resend</button>'],
  ['id="wbRenameTitle">重命名 Session</p>', 'id="wbRenameTitle" data-i18n="desktop.workbench.renameSession">Rename Session</p>'],
  ['id="btnWbRenameAuto">自动重命名</button>', 'id="btnWbRenameAuto" data-i18n="desktop.workbench.autoRename">Auto rename</button>'],
  ['data-wb-rename-cancel>取消</button>', 'data-wb-rename-cancel data-i18n="desktop.common.cancel">Cancel</button>'],
  ['id="btnWbRenameConfirm">确定</button>', 'id="btnWbRenameConfirm" data-i18n="desktop.common.confirm">Confirm</button>'],
  ['id="agentRenameTitle">重命名对话</p>', 'id="agentRenameTitle" data-i18n="desktop.agent.renameDialogTitle">Rename chat</p>'],
  ['data-ask-rename-cancel>取消</button>', 'data-ask-rename-cancel data-i18n="desktop.common.cancel">Cancel</button>'],
  ['id="btnAgentRenameConfirm">确定</button>', 'id="btnAgentRenameConfirm" data-i18n="desktop.common.confirm">Confirm</button>'],
];

for (const [from, to] of attrMap) {
  html = html.split(from).join(to);
}

// uiLanguage row in general settings
if (!html.includes('name="uiLanguage"')) {
  html = html.replace(
    `<section class="settings-group">
                    <h3 class="settings-group-title">外观</h3>`,
    `<section class="settings-group">
                    <h3 class="settings-group-title" data-i18n="desktop.settings.appearance">Appearance</h3>`
  );
  html = html.replace(
    `<span class="settings-row-title">主题</span>
                          <span class="settings-row-desc">切换应用浅色、深色或跟随系统</span>`,
    `<span class="settings-row-title" data-i18n="desktop.settings.theme">Theme</span>
                          <span class="settings-row-desc" data-i18n="desktop.settings.themeDesc">Light, dark, or follow system</span>`
  );
  html = html.replace(
    `<option value="system">跟随系统</option>
                          <option value="light">浅色</option>
                          <option value="dark">深色</option>`,
    `<option value="system" data-i18n="desktop.settings.themeSystem">Follow system</option>
                          <option value="light" data-i18n="desktop.settings.themeLight">Light</option>
                          <option value="dark" data-i18n="desktop.settings.themeDark">Dark</option>`
  );
  html = html.replace(
    `</div>
                    </div>
                  </section>
                </div>
              </div>

              <div id="settingsPaneModels"`,
    `</div>
                      <div class="settings-row">
                        <div class="settings-row-label">
                          <span class="settings-row-title" data-i18n="settings.fieldUiLanguageLabel">UI Language</span>
                          <span class="settings-row-desc" data-i18n="desktop.settings.fieldUiLanguageDescription">Desktop UI language. Auto follows system.</span>
                        </div>
                        <select name="uiLanguage" class="settings-row-control"></select>
                      </div>
                    </div>
                  </section>
                </div>
              </div>

              <div id="settingsPaneModels"`
  );
}

html = html.replace(
  '<script src="./app.js"></script>',
  `<script src="./i18n.js"></script>
    <script src="./refreshLocalizedUi.js"></script>
    <script src="./app.js"></script>`
);

writeFileSync(path, html);
console.log("Patched index.html");