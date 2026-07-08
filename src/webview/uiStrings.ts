import { t } from "../i18n";

export function getSettingsUiStrings(): Record<string, string> {
  return {
    navTitle: t("webview.settings.navTitle"),
    loading: t("webview.settings.loading"),
    buttonSave: t("webview.settings.buttonSave"),
    buttonTestConnection: t("webview.settings.buttonTestConnection"),
    buttonResetDefaults: t("webview.settings.buttonResetDefaults"),
    navProjectMenu: t("webview.settings.navProjectMenu"),
    navSessionMenu: t("webview.settings.navSessionMenu"),
    projectMenuTitle: t("webview.settings.projectMenuTitle"),
    projectMenuDescription: t("webview.settings.projectMenuDescription"),
    sessionMenuTitle: t("webview.settings.sessionMenuTitle"),
    sessionMenuDescription: t("webview.settings.sessionMenuDescription"),
    hintTestConnection: t("webview.settings.hintTestConnection"),
    hintProjectMenu: t("webview.settings.hintProjectMenu"),
    hintSessionMenu: t("webview.settings.hintSessionMenu"),
    llmTip: t("webview.settings.llmTip"),
    apiKeyLabel: t("webview.settings.apiKeyLabel"),
    apiKeyDescriptionConfigured: t("webview.settings.apiKeyDescriptionConfigured"),
    apiKeyDescriptionEmpty: t("webview.settings.apiKeyDescriptionEmpty"),
    apiKeyPlaceholderConfigured: t("webview.settings.apiKeyPlaceholderConfigured"),
    apiKeyPlaceholderEmpty: t("webview.settings.apiKeyPlaceholderEmpty"),
    passwordToggleShow: t("webview.settings.passwordToggleShow"),
    passwordToggleHide: t("webview.settings.passwordToggleHide"),
    dragHandleTitle: t("webview.settings.dragHandleTitle"),
    statusSaved: t("webview.settings.statusSaved"),
    statusSaveFailed: t("webview.settings.statusSaveFailed")
  };
}

export function getSessionSearchUiStrings(): Record<string, string> {
  return {
    placeholder: t("webview.search.placeholder"),
    sectionProjects: t("webview.search.sectionProjects"),
    sectionSessions: t("webview.search.sectionSessions"),
    chipAllProjects: t("webview.search.chipAllProjects"),
    chipAllProjectsTooltip: t("webview.search.chipAllProjectsTooltip"),
    emptyNoMatchProject: t("webview.search.emptyNoMatchProject"),
    emptyNoMatchSearch: t("webview.search.emptyNoMatchSearch"),
    actionPreview: t("webview.search.actionPreview"),
    actionPreviewTooltip: t("webview.search.actionPreviewTooltip"),
    actionRename: t("webview.search.actionRename"),
    actionRenameTooltip: t("webview.search.actionRenameTooltip"),
    actionRemove: t("webview.search.actionRemove"),
    actionRemoveTooltip: t("webview.search.actionRemoveTooltip"),
    actionRemoveAria: t("webview.search.actionRemoveAria")
  };
}

export function getSessionPreviewUiStrings(): Record<string, string> {
  return {
    loadingTitle: t("webview.preview.loadingTitle"),
    loadingConversation: t("webview.preview.loadingConversation"),
    defaultTitle: t("webview.preview.defaultTitle"),
    failedTitle: t("webview.preview.failedTitle"),
    failedLoad: t("webview.preview.failedLoad"),
    buttonResume: t("webview.preview.buttonResume"),
    buttonResumeWith: t("webview.preview.buttonResumeWith"),
    buttonSummarize: t("webview.preview.buttonSummarize"),
    buttonAutoRename: t("webview.preview.buttonAutoRename"),
    buttonHandoff: t("webview.preview.buttonHandoff"),
    buttonRename: t("webview.preview.buttonRename"),
    buttonClose: t("webview.preview.buttonClose"),
    ariaResume: t("webview.preview.ariaResume"),
    ariaResumeWith: t("webview.preview.ariaResumeWith"),
    ariaSummarize: t("webview.preview.ariaSummarize"),
    ariaAutoRename: t("webview.preview.ariaAutoRename"),
    ariaHandoff: t("webview.preview.ariaHandoff"),
    ariaRename: t("webview.preview.ariaRename"),
    ariaClose: t("webview.preview.ariaClose"),
    roleUser: t("webview.preview.roleUser"),
    roleAssistant: t("webview.preview.roleAssistant"),
    noticeTruncated: t("webview.preview.noticeTruncated"),
    noticeLlmSetup: t("webview.preview.noticeLlmSetup"),
    noticeOpenLlmSettings: t("webview.preview.noticeOpenLlmSettings"),
    tooltipLlmRequired: t("webview.preview.tooltipLlmRequired"),
    summarizing: t("webview.preview.summarizing"),
    summarizeFailed: t("webview.preview.summarizeFailed")
  };
}

export function getSessionManagerUiStrings(): Record<string, string> {
  return {
    searchPlaceholder: t("webview.manager.searchPlaceholder"),
    ageFilterLabel: t("webview.manager.ageFilterLabel"),
    ageFilterAll: t("webview.manager.ageFilterAll"),
    ageFilter7days: t("webview.manager.ageFilter7days"),
    ageFilter30days: t("webview.manager.ageFilter30days"),
    ageFilter90days: t("webview.manager.ageFilter90days"),
    buttonResync: t("webview.manager.buttonResync"),
    buttonExport: t("webview.manager.buttonExport"),
    buttonRemoveFromPanel: t("webview.manager.buttonRemoveFromPanel"),
    selectFiltered: t("webview.manager.selectFiltered"),
    columnProvider: t("webview.manager.columnProvider"),
    columnTitleSummary: t("webview.manager.columnTitleSummary"),
    columnProject: t("webview.manager.columnProject"),
    columnUpdated: t("webview.manager.columnUpdated"),
    stats: t("webview.manager.stats"),
    emptyNoMatch: t("webview.manager.emptyNoMatch"),
    removeAction: t("webview.manager.removeAction")
  };
}

export function getAcpChatUiStrings(): Record<string, string> {
  return {
    defaultTitle: t("webview.acpChat.defaultTitle"),
    toolCallsSummary: t("webview.acpChat.toolCallsSummary"),
    toolCallsDone: t("webview.acpChat.toolCallsDone"),
    noDetailsYet: t("webview.acpChat.noDetailsYet"),
    inputPlaceholder: t("webview.acpChat.inputPlaceholder"),
    inputPlaceholderWithImages: t("webview.acpChat.inputPlaceholderWithImages"),
    statusConnecting: t("webview.acpChat.statusConnecting"),
    statusRunning: t("webview.acpChat.statusRunning"),
    statusReady: t("webview.acpChat.statusReady")
  };
}