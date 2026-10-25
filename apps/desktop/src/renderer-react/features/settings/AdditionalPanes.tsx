import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { desktopApi } from "../../bridge";
import { SegmentedControl } from "../../components/SegmentedControl";
import { SelectRow, ToggleRow } from "../../components/SettingRows";
import { Status, type StatusKind } from "../../components/Status";
import { confirmAction, confirmDestructive } from "../../confirmAction";
import { WORKBENCH_TERMINAL_THEME_IDS } from "../workbench/terminalThemes";
import type { NotesDraft, StorageDraft, WorkbenchDraft } from "./model";
import { formatShortcutForDisplay, WORKBENCH_NEW_SESSION_TARGET_OPTIONS } from "./model";

type Translate = (key: string, ...args: Array<string | number>) => string;
type BackupProgress = { operation: "export" | "import"; phase: "preparing" | "snapshotting" | "collecting" | "archiving" | "validating" | "merging" | "uploading" | "downloading" | "finalizing" | "complete"; percent: number };

const TERMINAL_THEME_LABEL_KEYS: Record<string, string> = {
  "follow-app": "desktop.settings.terminalThemeFollowApp",
  "default-dark": "desktop.settings.terminalThemeDefaultDark",
  "default-light": "desktop.settings.terminalThemeDefaultLight",
  "solarized-dark": "desktop.settings.terminalThemeSolarizedDark",
  "solarized-light": "desktop.settings.terminalThemeSolarizedLight",
  "one-dark": "desktop.settings.terminalThemeOneDark",
  dracula: "desktop.settings.terminalThemeDracula"
};

function terminalThemeLabelKey(id: string): string {
  return TERMINAL_THEME_LABEL_KEYS[id] || "desktop.settings.terminalThemeDefaultDark";
}

/**
 * IPC rejections arrive as `Error invoking remote method 'x': WebdavError: …`.
 * Strip the transport wrapper so the pane shows the message the main process wrote.
 */
function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/, "")
    .replace(/^[A-Za-z]+Error:\s*/, "");
}

export function WorkbenchPane({ draft, setDraft, commit, t }: { draft: WorkbenchDraft; setDraft: (value: WorkbenchDraft) => void; commit: (value: WorkbenchDraft) => void; t: Translate }) {
  /**
   * Immediate controls (toggles, selects, list add/remove of concrete values) commit
   * right away. Text inputs and placeholder-row "add" buttons pass `{ commit: false }`;
   * inputs commit on blur, placeholder rows commit once their fields are filled.
   */
  const update = <K extends keyof WorkbenchDraft>(key: K, value: WorkbenchDraft[K], options?: { commit?: boolean }) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (options?.commit !== false) commit(next);
  };
  const slashPhrases = draft.composerSlashPhrases ?? [];
  const workspacePacks = draft.composerMentions ?? [];
  /** A pack is an id plus the directory it points at. */
  const updatePack = (index: number, patch: Partial<{ id: string; cwd: string }>, commitNow: boolean) => {
    const next = workspacePacks.map((pack, packIndex) => packIndex === index
      ? {
          id: patch.id !== undefined ? patch.id.replace(/^@+/, "") : pack.id,
          cwd: patch.cwd !== undefined ? patch.cwd : pack.cwd
        }
      : pack);
    const nextDraft = { ...draft, composerMentions: next };
    setDraft(nextDraft);
    if (commitNow) commit(nextDraft);
  };
  return <>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.newSessionGroup")}</h3><div className="settings-group-body">
      <SelectRow
        title={t("desktop.settings.defaultAgent")}
        description={t("desktop.settings.defaultAgentDesc")}
        value={draft.defaultNewSessionTarget}
        onChange={(value) => {
          const next = { ...draft, defaultNewSessionTarget: value };
          if (value.startsWith("cli:")) {
            next.defaultProvider = value.slice(4) as WorkbenchDraft["defaultProvider"];
          }
          setDraft(next);
          commit(next);
        }}
      >
        <option value="">{t("desktop.settings.newSessionTarget.askEveryTime")}</option>
        <optgroup label={t("desktop.settings.newSessionGroupCli")}>
          {WORKBENCH_NEW_SESSION_TARGET_OPTIONS.filter((option) => option.group === "cli").map((option) => (
            <option key={option.value} value={option.value}>{t(`desktop.settings.newSessionTarget.${option.value.replace(":", "_")}`)}</option>
          ))}
        </optgroup>
        <optgroup label={t("desktop.settings.newSessionGroupAcp")}>
          {WORKBENCH_NEW_SESSION_TARGET_OPTIONS.filter((option) => option.group === "acp").map((option) => (
            <option key={option.value} value={option.value}>{t(`desktop.settings.newSessionTarget.${option.value.replace(":", "_")}`)}</option>
          ))}
        </optgroup>
        <optgroup label={t("desktop.settings.newSessionGroupThunder")}>
          {WORKBENCH_NEW_SESSION_TARGET_OPTIONS.filter((option) => option.group === "thunder").map((option) => (
            <option key={option.value} value={option.value}>{t(`desktop.settings.newSessionTarget.${option.value.replace(":", "_")}`)}</option>
          ))}
        </optgroup>
      </SelectRow>
      <ToggleRow
        title={t("desktop.settings.newSessionYolo")}
        description={t("desktop.settings.newSessionYoloDesc")}
        checked={draft.newSessionYolo}
        onChange={(value) => update("newSessionYolo", value)}
      />
      <SelectRow
        title={t("desktop.settings.acpAutoApprove")}
        description={t("desktop.settings.acpAutoApproveDesc")}
        value={draft.acpAutoApprovePermissions}
        onChange={(value) => update("acpAutoApprovePermissions", value as WorkbenchDraft["acpAutoApprovePermissions"])}
      >
        <option value="ask">{t("desktop.settings.acpAutoApproveAsk")}</option>
        <option value="allowAll">{t("desktop.settings.acpAutoApproveAllowAll")}</option>
      </SelectRow>
      <ToggleRow
        title={t("desktop.settings.acpExperimentalGrokVendorUi")}
        description={t("desktop.settings.acpExperimentalGrokVendorUiDesc")}
        checked={draft.acpExperimentalGrokVendorUi}
        onChange={(value) => update("acpExperimentalGrokVendorUi", value)}
      />
      <label className="settings-field"><span className="settings-field-label">{t("desktop.settings.scratchDir")}</span><input value={draft.scratchDir} placeholder="~/.agent-resume-panel/.desktop/scratch" onChange={(event) => update("scratchDir", event.target.value, { commit: false })} onBlur={() => commit(draft)} /></label>
    </div></section>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.composerSlashGroup")}</h3><div className="settings-group-body">
      <p className="settings-footnote">{t("desktop.settings.composerSlashDesc")}</p>
      <div className="settings-slash-presets-row">
        <span className="settings-footnote muted" style={{ marginRight: "var(--space-1)" }}>Quick presets:</span>
        {[
          { trigger: "commit", description: "Draft commit message", phrase: "Review the current git changes and draft a concise conventional commit message." },
          { trigger: "review", description: "Code review", phrase: "Review the current diff for potential bugs, performance regressions, and security issues." },
          { trigger: "test", description: "Run tests", phrase: "Run the test suite, analyze any failures, and recommend targeted fixes." },
          { trigger: "explain", description: "Architecture overview", phrase: "Explain the architecture, design decisions, and core workflows of this module." }
        ].map((preset) => {
          const exists = slashPhrases.some((p) => p.trigger.toLowerCase() === preset.trigger);
          return (
            <button
              key={preset.trigger}
              type="button"
              className="settings-slash-preset-btn"
              disabled={exists}
              onClick={() => {
                if (exists) return;
                const next = [...slashPhrases, preset];
                update("composerSlashPhrases", next);
              }}
              title={exists ? "Already added" : `Add /${preset.trigger} preset`}
            >
              +{`/${preset.trigger}`}
            </button>
          );
        })}
      </div>
      {slashPhrases.length === 0 ? <p className="settings-footnote muted">{t("desktop.settings.composerSlashEmpty")}</p> : null}
      {slashPhrases.map((item, index) => (
        <div className="settings-item settings-slash-card" key={`slash-${index}`}>
          <div className="settings-item-row settings-slash-header">
            <span className="settings-item-prefix settings-slash-prefix" aria-hidden="true">/</span>
            <input
              className="settings-item-name settings-slash-trigger-input"
              value={item.trigger}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label={t("desktop.settings.composerSlashTrigger")}
              placeholder={t("desktop.settings.composerSlashTriggerPlaceholder")}
              onChange={(event) => {
                const next = slashPhrases.map((phrase, phraseIndex) => phraseIndex === index ? { ...phrase, trigger: event.target.value.replace(/^\/+/, "") } : phrase);
                update("composerSlashPhrases", next, { commit: false });
              }}
              onBlur={() => commit(draft)}
            />
            <input
              className="settings-item-note settings-slash-desc-input"
              value={item.description ?? ""}
              spellCheck={false}
              aria-label={t("desktop.settings.composerSlashDescription")}
              placeholder={t("desktop.settings.composerSlashDescriptionPlaceholder")}
              onChange={(event) => {
                const next = slashPhrases.map((phrase, phraseIndex) => phraseIndex === index ? { ...phrase, description: event.target.value } : phrase);
                update("composerSlashPhrases", next, { commit: false });
              }}
              onBlur={() => commit(draft)}
            />
            <button
              type="button"
              className="tool-btn settings-item-icon"
              aria-label={t("desktop.settings.composerSlashRemove")}
              title={t("desktop.settings.composerSlashRemove")}
              onClick={() => update("composerSlashPhrases", slashPhrases.filter((_, phraseIndex) => phraseIndex !== index))}
            ><ThemeIcon name="trash" size={ICON_SIZE.dense} aria-hidden="true" /></button>
          </div>
          <div className="settings-slash-body-wrap">
            <textarea
              className="settings-item-body settings-slash-textarea"
              rows={3}
              maxLength={4000}
              spellCheck={false}
              value={item.phrase}
              aria-label={t("desktop.settings.composerSlashPhrase")}
              placeholder={t("desktop.settings.composerSlashPhrasePlaceholder")}
              onChange={(event) => {
                const next = slashPhrases.map((phrase, phraseIndex) => phraseIndex === index ? { ...phrase, phrase: event.target.value } : phrase);
                update("composerSlashPhrases", next, { commit: false });
              }}
              onBlur={() => commit(draft)}
            />
            <div className="settings-slash-footer">
              <span className="settings-slash-preview-tag">
                Composer preview: <code className="settings-slash-preview-code">/{item.trigger || "trigger"}</code>
                {item.description ? ` (${item.description})` : ""}
              </span>
              <span className="settings-footnote muted" style={{ fontSize: "11px" }}>
                {item.phrase.length} / 4000
              </span>
            </div>
          </div>
        </div>
      ))}
      <div className="settings-action-row" style={{ marginTop: "var(--space-1)" }}>
        <button
          type="button"
          className="tool-btn"
          onClick={() => update("composerSlashPhrases", [...slashPhrases, { trigger: "", phrase: "" }], { commit: false })}
        ><ThemeIcon name="plus" size={ICON_SIZE.dense} aria-hidden="true" />{t("desktop.settings.composerSlashAdd")}</button>
      </div>
    </div></section>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.workspaceMentionsGroup")}</h3>
      <p className="settings-footnote muted">{t("desktop.settings.workspaceMentionsHint")}</p>
      <div className="settings-group-body">
      {workspacePacks.length === 0 ? <p className="settings-footnote muted">{t("desktop.settings.workspaceMentionsEmpty")}</p> : null}
      {workspacePacks.map((pack, index) => (
        <div className="settings-item settings-slash-card" key={`pack-${index}`}>
          <div className="settings-item-row settings-slash-header">
            <span className="settings-item-prefix settings-slash-prefix" aria-hidden="true">@</span>
            <input
              className="settings-item-name settings-slash-trigger-input"
              value={pack.id}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label={t("desktop.settings.workspaceMentionId")}
              placeholder="anfeng"
              onChange={(event) => updatePack(index, { id: event.target.value }, false)}
              onBlur={() => commit(draft)}
            />
            <button
              type="button"
              className="tool-btn settings-item-icon"
              aria-label={t("desktop.settings.workspaceMentionRemove")}
              title={t("desktop.settings.workspaceMentionRemove")}
              onClick={() => update("composerMentions", workspacePacks.filter((_, packIndex) => packIndex !== index))}
            ><ThemeIcon name="trash" size={ICON_SIZE.dense} aria-hidden="true" /></button>
          </div>
          <div className="settings-slash-body-wrap">
            <input
              className="settings-item-body"
              value={pack.cwd}
              spellCheck={false}
              aria-label={t("desktop.settings.workspaceMentionCwd")}
              placeholder="~/wb/wlgk/anfeng"
              onChange={(event) => updatePack(index, { cwd: event.target.value }, false)}
              onBlur={() => commit(draft)}
            />
          </div>
        </div>
      ))}
      <div className="settings-action-row" style={{ marginTop: "var(--space-1)" }}>
        <button
          type="button"
          className="tool-btn"
          onClick={() => update("composerMentions", [...workspacePacks, { id: "", cwd: "" }], { commit: false })}
        ><ThemeIcon name="plus" size={ICON_SIZE.dense} aria-hidden="true" />{t("desktop.settings.workspaceMentionAdd")}</button>
      </div>
    </div></section>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.embeddedEditorGroup")}</h3><div className="settings-group-body">
      <ToggleRow title={t("desktop.settings.editorEditable")} description={t("desktop.settings.editorEditableDesc")} checked={draft.editorEditable} onChange={(value) => update("editorEditable", value)} />
      <label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{t("desktop.settings.editorFontSize")}</span><span className="settings-row-desc">{t("desktop.settings.editorFontSizeDesc")}</span></span><label className="settings-number-control"><input className="settings-number-input" type="number" min="11" max="24" value={draft.editorFontSize} onChange={(event) => update("editorFontSize", Number(event.target.value), { commit: false })} onBlur={() => commit(draft)} /><span aria-hidden="true">px</span></label></label>
      <ToggleRow title={t("desktop.settings.editorWordWrap")} description={t("desktop.settings.editorWordWrapDesc")} checked={draft.editorWordWrap} onChange={(value) => update("editorWordWrap", value)} />
      <SelectRow title={t("desktop.settings.editorTabSize")} description={t("desktop.settings.editorTabSizeDesc")} value={draft.editorTabSize} onChange={(value) => update("editorTabSize", Number(value) as WorkbenchDraft["editorTabSize"])}><option value="2">{t("desktop.settings.editorTabSize2")}</option><option value="4">{t("desktop.settings.editorTabSize4")}</option><option value="8">{t("desktop.settings.editorTabSize8")}</option></SelectRow>
      <SelectRow title={t("desktop.settings.editorAutoSaveDelay")} description={t("desktop.settings.editorAutoSaveDelayDesc")} value={draft.editorAutoSaveDelayMs} onChange={(value) => update("editorAutoSaveDelayMs", Number(value) as WorkbenchDraft["editorAutoSaveDelayMs"])}><option value="300">{t("desktop.settings.editorAutoSaveDelay300")}</option><option value="600">{t("desktop.settings.editorAutoSaveDelay600")}</option><option value="1000">{t("desktop.settings.editorAutoSaveDelay1000")}</option><option value="2000">{t("desktop.settings.editorAutoSaveDelay2000")}</option></SelectRow>
    </div></section>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.transcriptGroup")}</h3><div className="settings-group-body">
      <label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{t("desktop.settings.transcriptFontSize")}</span><span className="settings-row-desc">{t("desktop.settings.transcriptFontSizeDesc")}</span></span><label className="settings-number-control"><input className="settings-number-input" type="number" min="11" max="24" value={draft.transcriptFontSize} onChange={(event) => update("transcriptFontSize", Number(event.target.value), { commit: false })} onBlur={() => commit(draft)} /><span aria-hidden="true">px</span></label></label>
    </div></section>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.editorTerminal")}</h3><div className="settings-group-body">
      <SelectRow title={t("desktop.settings.terminalMode")} description={t("desktop.settings.terminalModeDesc")} value={draft.terminalMode} onChange={(value) => update("terminalMode", value as WorkbenchDraft["terminalMode"])}><option value="xterm">{t("desktop.settings.terminalXterm")}</option><option value="external-system">{t("desktop.settings.terminalExternal")}</option></SelectRow>
      <SelectRow
        title={t("desktop.settings.terminalTheme")}
        description={t("desktop.settings.terminalThemeDesc")}
        value={draft.terminalTheme}
        onChange={(value) => update("terminalTheme", value as WorkbenchDraft["terminalTheme"])}
      >
        {WORKBENCH_TERMINAL_THEME_IDS.map((id) => (
          <option key={id} value={id}>{t(terminalThemeLabelKey(id))}</option>
        ))}
      </SelectRow>
      <SelectRow
        title={t("desktop.settings.editorTheme")}
        description={t("desktop.settings.editorThemeDesc")}
        value={draft.editorTheme}
        onChange={(value) => update("editorTheme", value as WorkbenchDraft["editorTheme"])}
      >
        <option value="follow-app">{t("desktop.settings.editorThemeFollowApp")}</option>
        <option value="light">{t("desktop.settings.editorThemeLight")}</option>
        <option value="dark">{t("desktop.settings.editorThemeDark")}</option>
      </SelectRow>
      {draft.terminalMode === "xterm" ? (
        <SelectRow
          title={t("desktop.settings.terminalRenderer")}
          description={t("desktop.settings.terminalRendererDesc")}
          value={draft.terminalRenderer}
          onChange={(value) => update("terminalRenderer", value as WorkbenchDraft["terminalRenderer"])}
        >
          <option value="webgl">{t("desktop.settings.terminalRendererWebgl")}</option>
          <option value="canvas">{t("desktop.settings.terminalRendererCanvas")}</option>
        </SelectRow>
      ) : null}
      {draft.terminalMode === "external-system" ? <SelectRow title={t("desktop.settings.externalLaunch")} description={t("desktop.settings.externalLaunchDesc")} value={draft.externalLaunchMode} onChange={(value) => update("externalLaunchMode", value as WorkbenchDraft["externalLaunchMode"])}><option value="executeCommand">{t("desktop.settings.launchExecute")}</option><option value="pasteCommand">{t("desktop.settings.launchPaste")}</option><option value="copyCommand">{t("desktop.settings.launchCopy")}</option></SelectRow> : null}
      <SelectRow title={t("desktop.settings.cmdT")} description={t("desktop.settings.cmdTDesc")} value={draft.cmdTAction} onChange={(value) => update("cmdTAction", value as WorkbenchDraft["cmdTAction"])}><option value="newTerminal">{t("desktop.settings.cmdTNewTerminal")}</option><option value="newSession">{t("desktop.settings.cmdTNewSession")}</option></SelectRow>
    </div></section>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.gitCommitMessageGroup")}</h3><div className="settings-group-body">
      <SelectRow title={t("desktop.settings.gitCommitMessageStyle")} description={t("desktop.settings.gitCommitMessageStyleDesc")} value={draft.gitCommitMessageStyle} onChange={(value) => update("gitCommitMessageStyle", value as WorkbenchDraft["gitCommitMessageStyle"])}><option value="conventional">{t("desktop.settings.gitCommitMessageStyleConventional")}</option><option value="gitmoji">{t("desktop.settings.gitCommitMessageStyleGitmoji")}</option><option value="custom">{t("desktop.settings.gitCommitMessageStyleCustom")}</option></SelectRow>
      {draft.gitCommitMessageStyle === "custom" ? <label className="settings-field"><span className="settings-field-label">{t("desktop.settings.gitCommitCustomInstructions")}</span><span className="settings-field-desc muted">{t("desktop.settings.gitCommitCustomInstructionsDesc")}</span><textarea rows={6} maxLength={4000} spellCheck value={draft.gitCommitCustomInstructions} onChange={(event) => update("gitCommitCustomInstructions", event.target.value, { commit: false })} onBlur={() => commit(draft)} /></label> : null}
    </div></section>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.gitNestedScanGroup")}</h3><div className="settings-group-body">
      <SelectRow title={t("desktop.settings.gitNestedScanMaxDepth")} description={t("desktop.settings.gitNestedScanMaxDepthDesc")} value={draft.gitNestedScanMaxDepth} onChange={(value) => update("gitNestedScanMaxDepth", Number(value))}>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</SelectRow>
      <label className="settings-field"><span className="settings-field-label">{t("desktop.settings.gitNestedScanIgnoreDirs")}</span><span className="settings-field-desc muted">{t("desktop.settings.gitNestedScanIgnoreDirsDesc")}</span><textarea rows={5} spellCheck={false} placeholder={"node_modules\ndist"} value={draft.gitNestedScanIgnoreDirs} onChange={(event) => update("gitNestedScanIgnoreDirs", event.target.value, { commit: false })} onBlur={() => commit(draft)} /></label>
    </div></section>
  </>;
}

export function BackupPane({ t }: { t: Translate }) {
  type Target = "local-file" | "icloud-drive" | "webdav";
  const [target, setTarget] = useState<Target>("local-file");
  const [targetStatus, setTargetStatus] = useState<Awaited<ReturnType<ReturnType<typeof desktopApi>["backupTargetStatus"]>>>([]);
  const [storedItems, setStoredItems] = useState<Awaited<ReturnType<ReturnType<typeof desktopApi>["backupListStored"]>>>([]);
  const [selectedId, setSelectedId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  // Native conversations dominate the archive and make uploads slow and fragile;
  // keep them opt-in so the default backup stays small enough to finish.
  const [includeNativeConversations, setIncludeNativeConversations] = useState(false);
  const [pendingImport, setPendingImport] = useState<Awaited<ReturnType<ReturnType<typeof desktopApi>["backupSelectImport"]>>>(null);
  const [pendingPassword, setPendingPassword] = useState("");
  const [restoreNativeConversations, setRestoreNativeConversations] = useState(false);
  const [legacyPassword, setLegacyPassword] = useState("");
  const [backupStatus, setBackupStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupProgress, setBackupProgress] = useState<BackupProgress | null>(null);
  const [webdav, setWebdav] = useState({ url: "", username: "", folder: "", password: "", hasPassword: false });
  const [revealWebdavPassword, setRevealWebdavPassword] = useState(false);
  const [webdavBusy, setWebdavBusy] = useState(false);
  const status = targetStatus.find((item) => item.target === target);
  const selected = storedItems.find((item) => item.backupId === selectedId);

  const refreshStored = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    let canceled = false;
    void (async () => {
      const api = desktopApi();
      try {
        const statuses = await api.backupTargetStatus();
        if (canceled) return;
        setTargetStatus(statuses);
        // Local ZIP has no list; the other targets keep their backups remotely.
        const items = target === "local-file" ? [] : await api.backupListStored({ target });
        if (canceled) return;
        setStoredItems(items);
        setSelectedId((current) => items.some((item) => item.backupId === current) ? current : items[0]?.backupId || "");
      } catch (error) {
        if (!canceled) setBackupStatus({ text: errorMessage(error), kind: "error" });
      }
    })();
    return () => { canceled = true; };
  }, [target, refreshKey]);

  useEffect(() => {
    let canceled = false;
    void desktopApi().backupWebdavGetConfig().then((config) => {
      if (canceled) return;
      setWebdav((current) => ({ ...current, url: config.url, username: config.username, folder: config.folder, hasPassword: config.hasPassword }));
    }).catch(() => undefined);
    return () => { canceled = true; };
  }, []);

  useEffect(() => {
    const api = desktopApi();
    return typeof api.onBackupProgress === "function" ? api.onBackupProgress((event) => setBackupProgress(event)) : undefined;
  }, []);

  const showPreview = (preview: NonNullable<typeof pendingImport>) => {
    setPendingImport(preview);
    setRestoreNativeConversations(false);
    setBackupStatus({ text: t("desktop.backup.ready", preview.fileCount), kind: "ok" });
  };

  const exportData = async () => {
    setBackupProgress({ operation: "export", phase: "preparing", percent: 0 });
    setBackupBusy(true);
    try {
      const result = await desktopApi().backupExport({ target, includeNativeConversations });
      const exportedText = target === "icloud-drive"
        ? t("desktop.backup.icloudSaved", result.fileCount || 0)
        : target === "webdav"
          ? t("desktop.backup.webdavSavedResult", result.fileCount || 0)
          : t("desktop.backup.exported", result.fileCount || 0);
      const warningText = result.warnings?.length ? ` ${result.warnings.join(" ")}` : "";
      setBackupStatus(result.canceled
        ? { text: t("desktop.backup.exportCanceled") }
        : { text: `${exportedText}${warningText}`, kind: result.warnings?.length ? "warning" : "ok" });
      if (target !== "local-file" && !result.canceled) refreshStored();
    } catch (error) {
      setBackupStatus({ text: errorMessage(error), kind: "error" });
    } finally {
      setBackupBusy(false);
    }
  };

  const selectLocalImport = async () => {
    // A file picker reports no progress; clear the last run's bar so a stale
    // percentage is not shown while the dialog is open.
    setBackupProgress(null);
    setBackupBusy(true);
    try {
      const preview = await desktopApi().backupSelectImport();
      if (!preview) setBackupStatus({ text: t("desktop.backup.importCanceled") });
      else {
        setPendingPassword("");
        showPreview(preview);
      }
    } catch (error) {
      setBackupStatus({ text: errorMessage(error), kind: "error" });
    } finally {
      setBackupBusy(false);
    }
  };

  const selectStoredImport = async () => {
    if (!selected) return;
    // Only backups written by older releases are encrypted and need a password.
    if (selected.encrypted && !legacyPassword) {
      setBackupStatus({ text: t("desktop.backup.legacyPasswordRequired"), kind: "error" });
      return;
    }
    const password = selected.encrypted ? legacyPassword : "";
    setBackupBusy(true);
    setBackupProgress({ operation: "import", phase: "downloading", percent: 0 });
    try {
      const preview = await desktopApi().backupSelectStoredImport({ target, backupId: selected.backupId, ...(password ? { password } : {}) });
      setPendingPassword(password);
      showPreview(preview);
      setLegacyPassword("");
    } catch (error) {
      setBackupStatus({ text: errorMessage(error), kind: "error" });
    } finally {
      setBackupBusy(false);
    }
  };

  const mergeImport = async () => {
    if (!pendingImport) return;
    if (!(await confirmDestructive(t("desktop.backup.importConfirm", pendingImport.fileCount), t("desktop.common.confirm")))) return;
    setBackupProgress({ operation: "import", phase: "preparing", percent: 0 });
    setBackupBusy(true);
    try {
      const result = await desktopApi().backupImport({
        importToken: pendingImport.importToken,
        restoreNativeConversations,
        ...(pendingPassword ? { password: pendingPassword } : {})
      });
      setPendingImport(null);
      setPendingPassword("");
      setBackupStatus({ text: t("desktop.backup.imported", result.fileCount || 0), kind: "ok" });
    } catch (error) {
      setBackupStatus({ text: errorMessage(error), kind: "error" });
    } finally {
      setBackupBusy(false);
    }
  };

  const saveWebdav = async () => {
    setWebdavBusy(true);
    try {
      const view = await desktopApi().backupWebdavSaveConfig({
        url: webdav.url,
        username: webdav.username,
        folder: webdav.folder,
        ...(webdav.password ? { password: webdav.password } : {})
      });
      setWebdav((current) => ({ ...current, url: view.url, username: view.username, folder: view.folder, hasPassword: view.hasPassword, password: "" }));
      setBackupStatus({ text: t("desktop.backup.webdavSaved"), kind: "ok" });
      refreshStored();
    } catch (error) {
      setBackupStatus({ text: errorMessage(error), kind: "error" });
    } finally {
      setWebdavBusy(false);
    }
  };

  const testWebdav = async () => {
    setWebdavBusy(true);
    setBackupStatus({ text: t("desktop.backup.webdavTesting") });
    try {
      // Draft values only; nothing is saved by a test.
      const result = await desktopApi().backupWebdavTest({
        url: webdav.url,
        username: webdav.username,
        folder: webdav.folder,
        ...(webdav.password ? { password: webdav.password } : {})
      });
      setBackupStatus(result.ok
        ? { text: `${t("desktop.backup.webdavTestOk")} ${result.message}`, kind: "ok" }
        : { text: `${t("desktop.backup.webdavTestFailed")} ${result.message}`, kind: "error" });
    } catch (error) {
      setBackupStatus({ text: errorMessage(error), kind: "error" });
    } finally {
      setWebdavBusy(false);
    }
  };

  const visibleItems = storedItems.slice(0, 10);
  const providerSummary = pendingImport?.providers
    .filter((provider) => provider.fileCount > 0)
    .map((provider) => `${provider.provider} ${Math.ceil(provider.totalBytes / 1024 / 1024)} MB${provider.excludedBytes ? ` · ${t("desktop.backup.excludedHistory", Math.ceil(provider.excludedBytes / 1024 / 1024))}` : ""}`)
    .join(", ");
  const targetLabel = target === "local-file" ? t("desktop.backup.local") : target === "icloud-drive" ? t("desktop.backup.icloud") : t("desktop.backup.webdav");
  return (
    <section className="settings-group settings-group-action">
      <h3 className="settings-group-title">{t("desktop.backup.title")}</h3>
      <div className="settings-group-body">
        <p className="settings-footnote">{t("desktop.backup.description")}</p>
        <SegmentedControl
          value={target}
          options={["local-file", "icloud-drive", "webdav"] as const}
          onChange={setTarget}
          getLabel={(value) => value === "local-file" ? t("desktop.backup.local") : value === "icloud-drive" ? t("desktop.backup.icloud") : t("desktop.backup.webdav")}
          aria-label={t("desktop.backup.destination")}
          className="settings-backup-target"
        />
        {target === "webdav" ? <div className="settings-backup-webdav">
          <div className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{t("desktop.backup.webdavTitle")}</span></span></div>
          <label className="settings-field"><span className="settings-field-label">{t("desktop.backup.webdavUrl")}</span><input type="url" spellCheck={false} placeholder={t("desktop.backup.webdavUrlPlaceholder")} value={webdav.url} disabled={webdavBusy} onChange={(event) => setWebdav((current) => ({ ...current, url: event.target.value }))} /></label>
          <label className="settings-field"><span className="settings-field-label">{t("desktop.backup.webdavUsername")}</span><input type="text" autoComplete="username" spellCheck={false} value={webdav.username} disabled={webdavBusy} onChange={(event) => setWebdav((current) => ({ ...current, username: event.target.value }))} /></label>
          <label className="settings-field"><span className="settings-field-label">{t("desktop.backup.webdavPassword")}</span><span className="settings-field-input-wrap">
            <input
              type={revealWebdavPassword ? "text" : "password"}
              autoComplete="current-password"
              value={webdav.password}
              disabled={webdavBusy}
              placeholder={webdav.hasPassword ? t("desktop.backup.webdavPasswordSaved") : ""}
              onChange={(event) => setWebdav((current) => ({ ...current, password: event.target.value }))}
            />
            <button
              type="button"
              className="settings-field-reveal notes-icon-btn"
              aria-label={revealWebdavPassword ? t("desktop.settings.hideApiKey") : t("desktop.settings.showApiKey")}
              aria-pressed={revealWebdavPassword}
              onClick={(event) => { event.preventDefault(); setRevealWebdavPassword((current) => !current); }}
            >
              {revealWebdavPassword ? <ThemeIcon name="eye-off" size={ICON_SIZE.default} aria-hidden="true" /> : <ThemeIcon name="eye" size={ICON_SIZE.default} aria-hidden="true" />}
            </button>
          </span></label>
          <label className="settings-field"><span className="settings-field-label">{t("desktop.backup.webdavFolder")}</span><input type="text" spellCheck={false} placeholder={t("desktop.backup.webdavFolderPlaceholder")} value={webdav.folder} disabled={webdavBusy} onChange={(event) => setWebdav((current) => ({ ...current, folder: event.target.value }))} /></label>
          <div className="settings-action-row">
            <button type="button" className="tool-btn" disabled={webdavBusy || backupBusy} onClick={() => void saveWebdav()}>{t("desktop.backup.webdavSave")}</button>
            <button type="button" className="tool-btn" disabled={webdavBusy || backupBusy} onClick={() => void testWebdav()}>{t("desktop.backup.webdavTest")}</button>
          </div>
        </div> : null}
        <label className="settings-row">
          <span className="settings-row-label"><span className="settings-row-title">{t("desktop.backup.includeNative")}</span><span className="settings-row-desc">{t("desktop.backup.includeNativeDesc")}</span></span>
          <span className="settings-toggle"><input type="checkbox" role="switch" checked={includeNativeConversations} disabled={backupBusy} onChange={(event) => setIncludeNativeConversations(event.target.checked)} /><span className="settings-toggle-track" aria-hidden="true" /></span>
        </label>
        {target === "local-file" ? <p className="settings-callout">{t("desktop.backup.localWarning")}</p> : <p className={`settings-callout${status?.available ? "" : " is-error"}`}>{status?.available ? target === "webdav" ? t("desktop.backup.webdavReady", status.location || "") : t("desktop.backup.icloudReady") : status?.reason || (target === "webdav" ? t("desktop.backup.webdavNotConfigured") : t("desktop.backup.icloudUnavailable"))}</p>}
        {target !== "local-file" ? <p className="settings-callout is-error">{t("desktop.backup.plaintextWarning")}</p> : null}
        {target === "local-file" ? <div className="settings-action-row">
          <button type="button" className="tool-btn" disabled={backupBusy} onClick={() => void exportData()}><ThemeIcon name="download" size={ICON_SIZE.default} aria-hidden="true" />{t("desktop.backup.export")}</button>
          <button type="button" className="tool-btn" disabled={backupBusy} onClick={() => void selectLocalImport()}><ThemeIcon name="upload" size={ICON_SIZE.default} aria-hidden="true" />{t("desktop.backup.import")}</button>
        </div> : <>
          <div className="settings-action-row"><button type="button" className="tool-btn" disabled={backupBusy || !status?.available} onClick={() => void exportData()}><ThemeIcon name="cloud" size={ICON_SIZE.default} aria-hidden="true" />{target === "webdav" ? t("desktop.backup.webdavBackup") : t("desktop.backup.icloudBackup")}</button></div>
          <div className="settings-backup-list" aria-label={target === "webdav" ? t("desktop.backup.webdavRecent") : t("desktop.backup.icloudRecent")}>
            <div className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{target === "webdav" ? t("desktop.backup.webdavRecent") : t("desktop.backup.icloudRecent")}</span><span className="settings-row-desc">{storedItems.length ? target === "webdav" ? t("desktop.backup.webdavRetention") : t("desktop.backup.icloudRetention") : target === "webdav" ? t("desktop.backup.webdavEmpty") : t("desktop.backup.icloudEmpty")}</span></span></div>
            {visibleItems.map((item) => <button type="button" className={`settings-backup-item${item.backupId === selectedId ? " active" : ""}`} aria-pressed={item.backupId === selectedId} disabled={backupBusy} key={item.backupId} onClick={() => { setSelectedId(item.backupId); setLegacyPassword(""); }}><span>{new Date(item.createdAtMs).toLocaleString()}</span><small>{item.sourceMachineId.slice(0, 8)} · {item.metadataComplete ? `${item.nativeConversationFileCount} ${t("desktop.backup.nativeFiles")}` : t("desktop.backup.metadataUnavailable")}</small></button>)}
          </div>
          {selected?.encrypted ? <>
            <p className="settings-callout">{t("desktop.backup.legacyEncrypted")}</p>
            <label className="settings-field"><span className="settings-field-label">{t("desktop.backup.legacyPassword")}</span><input type="password" autoComplete="current-password" value={legacyPassword} disabled={backupBusy} onChange={(event) => setLegacyPassword(event.target.value)} /></label>
          </> : null}
          <div className="settings-action-row"><button type="button" className="tool-btn" disabled={backupBusy || !status?.available || !selected} onClick={() => void selectStoredImport()}><ThemeIcon name="upload" size={ICON_SIZE.default} aria-hidden="true" />{target === "webdav" ? t("desktop.backup.webdavRestore") : t("desktop.backup.icloudRestore")}</button></div>
        </>}
        {backupBusy && backupProgress ? <div className="settings-backup-progress" role="status" aria-live="polite"><div className="settings-backup-progress-head"><span>{t(`desktop.backup.progress.${backupProgress.phase}`)}</span><span>{backupProgress.percent}%</span></div><div className="settings-backup-progress-track" role="progressbar" aria-label={t("desktop.backup.progress.label")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={backupProgress.percent}><div className="settings-backup-progress-bar" style={{ width: `${backupProgress.percent}%` }} /></div></div> : null}
        {pendingImport ? <div className="settings-backup-preview">
          <p className="settings-footnote">{t("desktop.backup.summary", pendingImport.fileCount, Math.ceil(pendingImport.totalBytes / 1024 / 1024))}</p>
          <p className="settings-footnote">{t("desktop.backup.nativeSummary", pendingImport.nativeConversationFileCount, Math.ceil(pendingImport.nativeConversationBytes / 1024 / 1024))}{providerSummary ? ` · ${providerSummary}` : ""}</p>
          {pendingImport.warnings.map((warning) => <p className="settings-footnote" key={warning}>{warning}</p>)}
          {pendingImport.nativeConversationFileCount > 0 ? <label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{t("desktop.backup.restoreNative")}</span><span className="settings-row-desc">{t("desktop.backup.restoreNativeDesc")}</span></span><span className="settings-toggle"><input type="checkbox" role="switch" checked={restoreNativeConversations} disabled={backupBusy} onChange={(event) => setRestoreNativeConversations(event.target.checked)} /><span className="settings-toggle-track" aria-hidden="true" /></span></label> : null}
          <p className="settings-footnote">{t("desktop.backup.importTarget", targetLabel)}</p>
          <button type="button" className="tool-btn" disabled={backupBusy} onClick={() => void mergeImport()}>{t("desktop.backup.merge")}</button>
        </div> : null}
        <Status kind={backupStatus.kind}>{backupStatus.text}</Status>
      </div>
    </section>
  );
}

export function StoragePane({ draft, setDraft, commit, t }: { draft: StorageDraft; setDraft: (value: StorageDraft) => void; commit: (value: StorageDraft) => void; t: Translate }) {
  const [advanced, setAdvanced] = useState(false);
  /** Path inputs commit on blur. */
  const update = <K extends keyof StorageDraft>(key: K, value: StorageDraft[K], options?: { commit?: boolean }) => { const next = { ...draft, [key]: value }; setDraft(next); if (options?.commit !== false) commit(next); };
  const paths: Array<[keyof StorageDraft, string, string]> = [["codexHome", "desktop.settings.codexHome", "~/.codex"], ["claudeHome", "desktop.settings.claudeHome", "~/.claude"], ["antigravityHome", "desktop.settings.antigravityHome", "~/.gemini"], ["grokHome", "desktop.settings.grokHome", "~/.grok"], ["opencodeHome", "desktop.settings.opencodeHome", "~/.local/share/opencode"], ["piHome", "desktop.settings.piHome", "~/.pi/agent"], ["primeHome", "desktop.settings.primeHome", "~/.prime/agent"], ["ompHome", "desktop.settings.ompHome", "~/.omp/agent"], ["cursorHome", "Cursor CLI home", "~/.cursor"], ["cursorIdeUserDataHome", "Cursor IDE user data home", "Platform default"]];
  return <>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.appData")}</h3><div className="settings-group-body"><p className="settings-footnote">{t("desktop.settings.appDataFootnote")}</p><label className="settings-field"><span className="settings-field-label">{t("desktop.settings.panelHome")}</span><input placeholder="~/.agent-resume-panel" value={draft.panelHome} onChange={(event) => update("panelHome", event.target.value, { commit: false })} onBlur={() => commit(draft)} /></label><p className="settings-footnote">{t("desktop.settings.panelHomeFootnote")}</p><div className="settings-path-row"><button type="button" className="tool-btn" onClick={() => void desktopApi().settingsOpenPanelHome()}>{t("desktop.common.revealInFinder")}</button></div></div></section>
    <section className={`settings-group settings-disclosure${advanced ? "" : " collapsed"}`}><button type="button" className="settings-disclosure-head" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}><span className="settings-disclosure-chevron" aria-hidden="true" /><span className="settings-disclosure-title">{t("desktop.settings.agentHomesAdvanced")}</span></button>{advanced ? <div className="settings-disclosure-body">{paths.map(([key, label, placeholder]) => <label className="settings-field" key={key}><span className="settings-field-label">{label.startsWith("desktop.") ? t(label) : label}</span><input placeholder={placeholder} value={draft[key]} onChange={(event) => update(key, event.target.value, { commit: false })} onBlur={() => commit(draft)} /></label>)}</div> : null}</section>
  </>;
}

function captureShortcutFromKeyDown(event: KeyboardEvent<HTMLInputElement>): string | null {
  if (event.key === "Tab" || event.key === "Escape") return null;
  event.preventDefault();
  if (event.repeat || ["Meta", "Control", "Alt", "Shift"].includes(event.key)) return null;
  const modifiers: string[] = [];
  if (event.metaKey || event.ctrlKey) modifiers.push("CommandOrControl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (!modifiers.length) return null;
  const code = event.code || "";
  const key = /^Key([A-Z])$/.exec(code)?.[1]
    || /^Digit([0-9])$/.exec(code)?.[1]
    || (/^F([1-9]|1[0-9]|2[0-4])$/.test(code) ? code : "")
    || (event.key.length === 1 ? event.key.toUpperCase() : "");
  if (!key) return null;
  return [...modifiers, key].join("+");
}

export function NotesPane({ draft, setDraft, commit, t }: { draft: NotesDraft; setDraft: (value: NotesDraft) => void; commit: (value: NotesDraft) => void; t: Translate }) {
  const updateField = <K extends keyof NotesDraft>(key: K, value: NotesDraft[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    commit(next);
  };
  return (
    <>
      <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.notesGroup")}</h3><div className="settings-group-body"><p className="settings-footnote">{t("desktop.settings.notesFootnote")}</p><div className="settings-path-row"><code className="settings-path-display">{t("desktop.settings.notesPath")}</code><button type="button" className="tool-btn" onClick={() => void desktopApi().notesOpenFolder()}>{t("desktop.common.revealInFinder")}</button></div></div></section>
      <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.standaloneNoteGroup")}</h3><div className="settings-group-body">
        <p className="settings-footnote">{t("desktop.settings.standaloneNoteShortcutDesc")}</p>
        <label className="settings-field"><span className="settings-field-label">{t("desktop.settings.standaloneNoteShortcut")}</span><input
          value={formatShortcutForDisplay(draft.newStandaloneNoteShortcut)}
          placeholder="⌘D"
          readOnly
          aria-label={t("desktop.settings.standaloneNoteShortcut")}
          onKeyDown={(event) => {
            const next = captureShortcutFromKeyDown(event);
            if (next) updateField("newStandaloneNoteShortcut", next);
          }}
        /></label>
        <div className="settings-action-row"><button type="button" className="ghost-btn" onClick={() => updateField("newStandaloneNoteShortcut", "CommandOrControl+D")}>{t("desktop.settings.standaloneNoteShortcutReset")}</button><button type="button" className="ghost-btn" onClick={() => updateField("newStandaloneNoteShortcut", "")}>{t("desktop.settings.standaloneNoteShortcutDisable")}</button></div>
        <p className="settings-footnote">{t("desktop.settings.recentStandaloneNoteShortcutDesc")}</p>
        <label className="settings-field"><span className="settings-field-label">{t("desktop.settings.recentStandaloneNoteShortcut")}</span><input
          value={formatShortcutForDisplay(draft.recentStandaloneNoteShortcut)}
          placeholder="⌘⇧D"
          readOnly
          aria-label={t("desktop.settings.recentStandaloneNoteShortcut")}
          onKeyDown={(event) => {
            const next = captureShortcutFromKeyDown(event);
            if (next) updateField("recentStandaloneNoteShortcut", next);
          }}
        /></label>
        <div className="settings-action-row"><button type="button" className="ghost-btn" onClick={() => updateField("recentStandaloneNoteShortcut", "CommandOrControl+Shift+D")}>{t("desktop.settings.recentStandaloneNoteShortcutReset")}</button><button type="button" className="ghost-btn" onClick={() => updateField("recentStandaloneNoteShortcut", "")}>{t("desktop.settings.standaloneNoteShortcutDisable")}</button></div>
      </div></section>
    </>
  );
}

function formatNumber(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "-" : value.toLocaleString();
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString();
}

export type UsageDetailTab = "byDay" | "schedule" | "llm";

type AppErrorLogRow = Awaited<ReturnType<ReturnType<typeof desktopApi>["logsList"]>>[number];

const USAGE_DETAIL_TABS = ["byDay", "schedule", "llm"] as const satisfies readonly UsageDetailTab[];

export function LogsPane({ t }: { t: Translate }) {
  const [entries, setEntries] = useState<AppErrorLogRow[]>([]);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus({ text: t("desktop.logs.loading") });
    try {
      const rows = await desktopApi().logsList({ limit: 200 });
      setEntries(rows);
      setStatus({ text: t("desktop.logs.summaryStatus", rows.length), kind: "ok" });
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: "error" });
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const clear = async () => {
    if (!(await confirmDestructive(t("desktop.logs.clearConfirm"), t("desktop.common.clear")))) {
      return;
    }
    setBusy(true);
    try {
      await desktopApi().logsClear();
      setExpandedId(null);
      await load();
      setStatus({ text: t("desktop.logs.cleared"), kind: "ok" });
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-pane-body settings-usage-body">
      <div className="settings-usage-toolbar">
        <div className="settings-usage-toolbar-left">
          <button type="button" className="ghost-btn" disabled={busy} onClick={() => void load()}>
            {t("desktop.common.refresh")}
          </button>
          <button type="button" className="ghost-btn" disabled={busy} onClick={() => void clear()}>
            {t("desktop.logs.clear")}
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={busy}
            onClick={() => void desktopApi().logsOpenDir()}
          >
            {t("desktop.common.revealInFinder")}
          </button>
        </div>
        {status.text ? <Status kind={status.kind}>{status.text}</Status> : null}
      </div>
      <p className="settings-footnote">{t("desktop.logs.footnote")}</p>
      <div className="table-wrap compact usage-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("desktop.logs.colTime")}</th>
              <th>{t("desktop.logs.colLevel")}</th>
              <th>{t("desktop.logs.colSource")}</th>
              <th>{t("desktop.logs.colMessage")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.length ? (
              entries.map((entry) => {
                const open = expandedId === entry.id;
                return (
                  <tr
                    key={entry.id}
                    className={open ? "is-selected" : undefined}
                    title={entry.detail || entry.message}
                    onClick={() => setExpandedId(open ? null : entry.id)}
                    style={{ cursor: entry.detail ? "pointer" : undefined }}
                  >
                    <td>{formatTime(entry.createdAtMs)}</td>
                    <td>{entry.level}</td>
                    <td>{entry.source}</td>
                    <td>
                      <div>{entry.message}</div>
                      {open && entry.detail ? (
                        <pre className="settings-footnote" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>
                          {entry.detail}
                        </pre>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4} className="muted">
                  {t("desktop.logs.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function UsagePane({ t, initialDetailTab }: { t: Translate; initialDetailTab?: UsageDetailTab }) {
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<UsageDetailTab>(initialDetailTab ?? "byDay");
  const [data, setData] = useState<{
    summary: Awaited<ReturnType<ReturnType<typeof desktopApi>["usageSummary"]>>;
    events: Awaited<ReturnType<ReturnType<typeof desktopApi>["usageListEvents"]>>;
    runs: Awaited<ReturnType<ReturnType<typeof desktopApi>["usageListScheduleRuns"]>>;
  } | null>(null);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });

  useEffect(() => {
    if (initialDetailTab) {
      setTab(initialDetailTab);
    }
  }, [initialDetailTab]);

  const load = useCallback(async () => {
    setStatus({ text: t("desktop.usage.loading") });
    try {
      const [summary, events, runs] = await Promise.all([
        desktopApi().usageSummary({ days }),
        desktopApi().usageListEvents({ days, limit: 80 }),
        desktopApi().usageListScheduleRuns({ days, limit: 80 }),
      ]);
      setData({ summary, events, runs });
      setStatus({ text: t("desktop.usage.summaryStatus", days, summary.eventCount), kind: "ok" });
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: "error" });
    }
  }, [days, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = data?.summary;

  const detail = useMemo(() => {
    if (tab === "byDay") {
      return {
        headings: [
          t("desktop.usage.colDate"),
          t("desktop.usage.colTokens"),
          t("desktop.usage.colCalls"),
          t("desktop.usage.colScheduleRuns"),
        ],
        rows:
          summary?.byDay.map((item) => [
            item.day,
            formatNumber(item.totalTokens),
            formatNumber(item.events),
            formatNumber(item.scheduleRuns),
          ]) || [],
        empty: t("desktop.usage.noData"),
      };
    }
    if (tab === "schedule") {
      return {
        headings: [
          t("desktop.usage.colTime"),
          t("desktop.usage.colLevel"),
          t("desktop.usage.colPeriod"),
          t("desktop.usage.colStatus"),
          t("desktop.usage.colTokens"),
          t("desktop.usage.colError"),
        ],
        rows:
          data?.runs.map((item) => [
            formatTime(item.startedAtMs),
            item.level,
            item.periodKey,
            item.status,
            formatNumber(item.totalTokens),
            item.error || "",
          ]) || [],
        empty: t("desktop.usage.noScheduleRuns"),
      };
    }
    return {
      headings: [
        t("desktop.usage.colTime"),
        t("desktop.usage.colKind"),
        t("desktop.usage.colSource"),
        t("desktop.usage.colModel"),
        t("desktop.usage.colTokens"),
        t("desktop.usage.colMs"),
      ],
      rows:
        data?.events.map((item) => [
          formatTime(item.createdAtMs),
          item.kind,
          `${item.source}${item.jobKey ? ` · ${item.jobKey}` : ""}`,
          item.model || "",
          formatNumber(item.totalTokens),
          formatNumber(item.durationMs),
        ]) || [],
      empty: t("desktop.usage.noLlmEvents"),
    };
  }, [data?.events, data?.runs, summary?.byDay, t, tab]);

  const tabLabel = (value: UsageDetailTab): string => {
    if (value === "byDay") return t("desktop.usage.byDay");
    if (value === "schedule") return t("desktop.usage.scheduleLog");
    return t("desktop.usage.llmDetails");
  };

  return (
    <div className="settings-pane-body settings-usage-body">
      <div className="settings-usage-toolbar">
        <div className="settings-usage-toolbar-left">
          <label className="settings-inline-label">
            <span>{t("desktop.usage.scope")}</span>
            <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
              <option value="7">{t("desktop.usage.last7")}</option>
              <option value="30">{t("desktop.usage.last30")}</option>
              <option value="90">{t("desktop.usage.last90")}</option>
            </select>
          </label>
          <button type="button" className="ghost-btn" onClick={() => void load()}>
            {t("desktop.common.refresh")}
          </button>
        </div>
        {status.text ? <Status kind={status.kind}>{status.text}</Status> : null}
      </div>

      <div className="usage-kpis" role="group" aria-label={t("desktop.usage.totalTokens")}>
        <div className="usage-card">
          <div className="label">{t("desktop.usage.totalTokens")}</div>
          <div className="value">{formatNumber(summary?.totalTokens)}</div>
        </div>
        <div className="usage-card">
          <div className="label">{t("desktop.usage.promptCompletion")}</div>
          <div className="value usage-value-pair">
            <span>{formatNumber(summary?.promptTokens)}</span>
            <span className="usage-value-sep">/</span>
            <span>{formatNumber(summary?.completionTokens)}</span>
          </div>
        </div>
        <div className="usage-card">
          <div className="label">{t("desktop.usage.chatEmbed")}</div>
          <div className="value usage-value-pair">
            <span>{formatNumber(summary?.chatTokens)}</span>
            <span className="usage-value-sep">/</span>
            <span>{formatNumber(summary?.embeddingTokens)}</span>
          </div>
        </div>
        <div className="usage-card">
          <div className="label">{t("desktop.usage.events")}</div>
          <div className="value">{formatNumber(summary?.eventCount)}</div>
        </div>
      </div>

      <section className="usage-sources" aria-label={t("desktop.usage.bySource")}>
        <div className="usage-sources-label">{t("desktop.usage.bySource")}</div>
        <div className="usage-sources-list">
          {summary?.bySource.length
            ? summary.bySource.map((item) => (
                <div className="usage-source-chip" key={item.source} title={`${item.source}: ${formatNumber(item.totalTokens)} · ${formatNumber(item.events)}`}>
                  <span className="usage-source-name">{item.source}</span>
                  <span className="usage-source-tokens">{formatNumber(item.totalTokens)}</span>
                </div>
              ))
            : <span className="muted">{t("desktop.usage.noData")}</span>}
        </div>
      </section>

      <div className="usage-detail">
        <SegmentedControl
          value={tab}
          options={USAGE_DETAIL_TABS}
          onChange={setTab}
          getLabel={tabLabel}
          aria-label={t("desktop.usage.detailTabs")}
          className="usage-detail-tabs sidebar-project-filter-segmented"
        />
        <UsageTable headings={detail.headings} rows={detail.rows} empty={detail.empty} />
      </div>
    </div>
  );
}

function UsageTable({ headings, rows, empty }: { headings: string[]; rows: string[][]; empty: string }) {
  return (
    <div className="table-wrap compact usage-table-wrap">
      <table>
        <thead>
          <tr>
            {headings.map((heading) => (
              <th key={heading}>{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, index) => (
              <tr key={index}>
                {row.map((value, cell) => (
                  <td key={cell}>{value}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headings.length} className="muted">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function AboutPane({ t }: { t: Translate }) {
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<Awaited<ReturnType<ReturnType<typeof desktopApi>["checkForUpdate"]>> | null>(null);
  const [checking, setChecking] = useState(false);
  const check = useCallback(async (force = false) => { setChecking(true); try { setUpdate(await desktopApi().checkForUpdate({ force })); } finally { setChecking(false); } }, []);
  useEffect(() => { void desktopApi().getAppVersion().then(setVersion); void check(); }, [check]);
  const available = Boolean(update?.ok && update.updateAvailable && update.latestVersion && update.latestVersion !== update.currentVersion);
  const updateUrl = update?.ok ? update.downloadUrl || update.releaseUrl || "" : "";
  const open = (url: string) => void desktopApi().openExternalUrl(url);
  const resource = (title: string, description: string, icon: ReactNode, url: string, primary = false) => <button type="button" className={`settings-about-row${primary ? " settings-about-row-primary" : ""}`} onClick={() => open(url)}><span className="settings-about-row-icon" aria-hidden="true">{icon}</span><span className="settings-about-row-text"><span className="settings-about-row-title">{title}</span><span className="settings-about-row-desc">{description}</span></span><ThemeIcon name="external-link" className="settings-about-row-external" size={ICON_SIZE.dense} aria-hidden="true" /></button>;
  return <div className="settings-pane-body settings-about-body"><header className="settings-about-hero"><div className="settings-about-app-icon" aria-hidden="true"><img className="settings-about-app-icon-img" src="../resources/icon.png" alt="" width="72" height="72" decoding="async" /></div><h3 className="settings-about-app-name">Agent Resume</h3><p className="settings-about-version">{t("desktop.settings.aboutVersionLabel")} {version || "-"}</p><p className="settings-about-tagline">{t("desktop.settings.aboutTagline")}</p></header>{checking || update ? <div className={`settings-about-update${available ? " is-available" : ""}`}><p className="settings-about-update-text">{checking ? t("desktop.settings.updateChecking") : !update?.ok ? t("desktop.settings.updateCheckFailed") : available ? t("desktop.settings.updateAvailable", update.latestVersion || "") : t("desktop.settings.updateUpToDate")}</p><div className="settings-about-update-actions">{available && updateUrl ? <button type="button" className="btn primary" onClick={() => open(updateUrl)}>{t("desktop.settings.updateDownload")}</button> : null}<button type="button" className="btn ghost" onClick={() => void check(true)}>{t("desktop.settings.updateRecheck")}</button></div></div> : null}<section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.aboutResources")}</h3><div className="settings-group-body settings-group-body-rows settings-about-rows">{resource(t("desktop.settings.linkDocumentation"), t("desktop.settings.linkDocumentationDesc"), <ThemeIcon name="file-text" size={ICON_SIZE.prominent} />, "https://github.com/lucacicii/agent-resume-panel/blob/develop/docs/desktop/README.md")}{resource(t("desktop.settings.linkExtensionDoc"), t("desktop.settings.linkExtensionDocDesc"), <ThemeIcon name="external-link" size={ICON_SIZE.prominent} />, "https://github.com/lucacicii/agent-resume-panel/blob/develop/docs/panel/README.md")}</div></section><section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.aboutFeedback")}</h3><div className="settings-group-body settings-group-body-rows settings-about-rows">{resource(t("desktop.settings.linkReportIssue"), t("desktop.settings.linkReportIssueDesc"), <ThemeIcon name="message-square-warning" size={ICON_SIZE.prominent} />, "https://github.com/lucacicii/agent-resume-panel/issues", true)}</div></section><aside className="settings-about-privacy"><ThemeIcon name="shield-check" className="settings-about-privacy-icon" size={ICON_SIZE.default} aria-hidden="true" /><p>{t("desktop.settings.footerHint")}</p></aside></div>;
}
