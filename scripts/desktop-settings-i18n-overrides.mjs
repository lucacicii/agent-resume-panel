/** Desktop-only settings strings for ja locale (merged after catalog + aliases). */

const LOCALES = ["ja"];

/** @param {string} jaValue Japanese translation. */
function row(jaValue) {
  return { ja: jaValue };
}

/** @type {Record<string, Record<string, string>>} */
export const overridesByKey = {
  "desktop.settings.done": row("完了"),
  "desktop.settings.navLabel": row("設定メニュー"),
  "desktop.settings.paneModels": row("モデル"),
  "desktop.settings.paneWorkbench": row("ワークベンチ"),
  "desktop.settings.paneReport": row("レポート"),
  "desktop.tabs.report": row("レポート"),
  "desktop.settings.paneUsage": row("使用量"),
  "desktop.settings.paneAbout": row("About"),
  "desktop.settings.paneGeneralDesc": row("外観と日常の設定"),
  "desktop.settings.paneModelsDesc": row("ツール LLM、チャット、Embedding"),
  "desktop.settings.paneSessionsDesc": row("同期ポリシーとセッション一覧の表示"),
  "desktop.settings.paneWorkbenchDesc": row("新規セッション、エディター、ターミナル"),
  "desktop.settings.paneReportDesc": row("定期 digest と履歴の一括生成"),
  "desktop.settings.paneStorageDesc": row("Panel home、ノート、Agent データディレクトリ"),
  "desktop.settings.paneUsageDesc": row("LLM 呼び出しと定期タスクの統計"),
  "desktop.settings.paneAboutDesc": row("ドキュメントとフィードバック"),
  "desktop.settings.appearance": row("外観"),
  "desktop.settings.theme": row("テーマ"),
  "desktop.settings.themeDesc": row("ライト、ダーク、またはシステムに従う"),
  "desktop.settings.themeSystem": row("システムに従う"),
  "desktop.settings.themeLight": row("ライト"),
  "desktop.settings.themeDark": row("ダーク"),
  "desktop.settings.chatModel": row("チャットモデル"),
  "desktop.settings.chatModelFootnote": row("Ask / Meta-Agent チャット用。既定はツール LLM。より強いモデルも可。"),
  "desktop.settings.embedding": row("Embedding"),
  "desktop.settings.embeddingFootnote": row("Base URL / API Key は任意。未設定時はツール LLM の設定を使用。"),
  "desktop.settings.baseUrlOptional": row("Base URL（任意）"),
  "desktop.settings.apiKeyOptional": row("API Key（任意）"),
  "desktop.settings.settingsPathFootnote": row("~/.agent-resume-panel/settings.json に書き込み（VS Code 拡張と共有）。"),
  "desktop.settings.unhideAllDesc": row("パネルから削除した session は catalog で非表示になります。復元しても Agent から再インポートしません。"),
  "desktop.settings.stalePolicyDesc": row("purge は最新同期で更新されなかった catalog 行を削除します。オフですべて保持します。"),
  "desktop.settings.unhideAllBtn": row("非表示 session を復元"),
  "desktop.settings.unhideAllConfirm": row("catalog の非表示 session をすべて表示に戻しますか？Agent からの再インポートは行いません。"),
  "desktop.settings.unhideAllDone": row("非表示 session を {0} 件復元しました"),
  "desktop.settings.sync": row("同期"),
  "desktop.workbench.allSessionsCount": row("全部 Sessions（{0}）"),
  "desktop.workbench.allSessionsWithTotal": row("全部 Sessions（{0} / {1}）"),
  "desktop.workbench.listMetaWithTotal": row("{0} · {1} / {2} 条"),
  "desktop.settings.staleOff": row("オフ"),
  "desktop.settings.stalePurge": row("削除"),
  "desktop.settings.visibilityFootnote": row("各プロバイダーのアーカイブ／サブエージェント session の一覧表示を制御します。"),
  "desktop.settings.newSessionGroup": row("新規 Session"),
  "desktop.settings.scratchDir": row("一時ディレクトリ"),
  "desktop.settings.projectEditor": row("プロジェクトエディター"),
  "desktop.settings.projectEditorDesc": row("ワークベンチからプロジェクトを開くときに使うエディター"),
  "desktop.settings.editorAuto": row("自動検出"),
  "desktop.settings.terminalXterm": row("内蔵ターミナル (xterm.js)"),
  "desktop.settings.terminalExternal": row("システム既定のターミナル"),
  "desktop.settings.launchExecute": row("再開コマンドを自動実行"),
  "desktop.settings.launchPaste": row("開いた後にコマンドを貼り付け"),
  "desktop.settings.launchCopy": row("コマンドのみコピー"),
  "desktop.settings.cmdT": row("⌘T ショートカット"),
  "desktop.settings.cmdTDesc": row("ワークベンチで ⌘T（Windows は Ctrl+T）を押したときの動作"),
  "desktop.settings.cmdTNewTerminal": row("新規 Terminal"),
  "desktop.settings.cmdTNewSession": row("新規 Session"),
  "desktop.settings.scheduledDigests": row("定期 digest"),
  "desktop.settings.enableSchedule": row("定期分析を有効化"),
  "desktop.settings.enableScheduleDesc": row("指定時刻にツール LLM を呼び出し、日/週/月 digest を生成"),
  "desktop.settings.dailyHour": row("日次の時刻"),
  "desktop.settings.weeklyHour": row("週次の時刻（月）"),
  "desktop.settings.monthlyHour": row("月次の時刻（1日）"),
  "desktop.settings.backfillTitle": row("履歴 digest の一括生成"),
  "desktop.settings.backfillCallout": row("catalog の全 session 日付を走査し、日→週→月の順で一括生成。多数の LLM 呼び出しがあり、費用と時間がかかる場合があります。"),
  "desktop.settings.backfillMaxDays": row("最大日数"),
  "desktop.settings.backfillSkipExisting": row("既存の成功 digest をスキップ"),
  "desktop.settings.backfillSkipEmbedding": row("embedding をスキップ"),
  "desktop.settings.backfillPreview": row("範囲をプレビュー"),
  "desktop.settings.backfillRun": row("一括生成を開始"),
  "desktop.settings.appData": row("アプリデータ"),
  "desktop.settings.appDataFootnote": row("catalog.db、acp/、notes/ は Panel home 配下にあります。"),
  "desktop.settings.panelHomeFootnote": row("表示は保存済みパスを使用。変更は自動保存されます。"),
  "desktop.settings.notesGroup": row("ノート"),
  "desktop.settings.notesFootnote": row("ノートは Markdown ファイル。Finder / Obsidian で編集できます。"),
  "desktop.settings.agentHomesAdvanced": row("Agent データディレクトリ（詳細）"),
  "desktop.settings.saving": row("保存中…"),
  "desktop.settings.saved": row("保存済み{0}"),
  "desktop.settings.schedulerOn": row(" · 定期 ON"),
  "desktop.settings.schedulerOff": row(" · 定期 OFF"),
  "desktop.settings.memoryEnableConfirm": row("定期分析を有効にすると、設定時刻に session データを読み取り、ツール LLM / embedding API を呼び出します。費用が発生する場合があります。続行しますか？"),
  "desktop.settings.aboutFeedback": row("フィードバック"),
  "desktop.settings.aboutResources": row("リソース"),
  "desktop.settings.aboutTagline": row("コーディング Agent 向け Session OS + Memory"),
  "desktop.settings.aboutVersionLabel": row("Desktop"),
  "desktop.settings.linkDocumentationDesc": row("ユーザーガイドと機能概要"),
  "desktop.settings.linkExtensionDoc": row("VS Code 拡張ドキュメント"),
  "desktop.settings.linkExtensionDocDesc": row("VS Code サイドバー拡張機能"),
  "desktop.settings.linkReportIssueDesc": row("GitHub でバグ報告と機能要望"),
};

/** @returns {Record<string, Record<string, string>>} locale → key → value */
export function overridesByLocale() {
  const out = {};
  for (const locale of LOCALES) {
    out[locale] = {};
  }
  for (const [key, perLocale] of Object.entries(overridesByKey)) {
    for (const [locale, value] of Object.entries(perLocale)) {
      out[locale][key] = value;
    }
  }
  return out;
}
