import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, ExternalLink, FileText, MessageSquareWarning, ShieldCheck, Upload } from "lucide-react";
import type { PanelSettings } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Status, type StatusKind } from "../../components/Status";
import type { WorkbenchProjectContextMenuAction } from "@agent-resume/core";
import { WORKBENCH_TERMINAL_THEME_IDS } from "../workbench/terminalThemes";
import type { ReportDraft, StorageDraft, WorkbenchDraft } from "./model";
import { ALL_WORKBENCH_PROJECT_CONTEXT_MENU, WORKBENCH_NEW_SESSION_TARGET_OPTIONS } from "./model";

type Translate = (key: string, ...args: Array<string | number>) => string;

const TERMINAL_THEME_LABEL_KEYS: Record<string, string> = {
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

function ToggleRow({ title, description, checked, onChange }: { title: string; description?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{title}</span>{description ? <span className="settings-row-desc">{description}</span> : null}</span><span className="settings-toggle"><input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="settings-toggle-track" aria-hidden="true" /></span></label>;
}

function SelectRow({ title, description, value, onChange, children }: { title: string; description?: string; value: string | number; onChange: (value: string) => void; children: ReactNode }) {
  return <label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{title}</span>{description ? <span className="settings-row-desc">{description}</span> : null}</span><select className="settings-row-control" value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;
}

export function WorkbenchPane({ draft, setDraft, scheduleSave, t }: { draft: WorkbenchDraft; setDraft: (value: WorkbenchDraft) => void; scheduleSave: (value: WorkbenchDraft) => void; t: Translate }) {
  const update = <K extends keyof WorkbenchDraft>(key: K, value: WorkbenchDraft[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    scheduleSave(next);
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
          scheduleSave(next);
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
      </SelectRow>
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
      <label className="settings-field"><span className="settings-field-label">{t("desktop.settings.scratchDir")}</span><input value={draft.scratchDir} placeholder="~/.agent-resume-panel/.desktop/scratch" onChange={(event) => update("scratchDir", event.target.value)} /></label>
    </div></section>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.embeddedEditorGroup")}</h3><div className="settings-group-body">
      <ToggleRow title={t("desktop.settings.editorEditable")} description={t("desktop.settings.editorEditableDesc")} checked={draft.editorEditable} onChange={(value) => update("editorEditable", value)} />
      <label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{t("desktop.settings.editorFontSize")}</span><span className="settings-row-desc">{t("desktop.settings.editorFontSizeDesc")}</span></span><label className="settings-number-control"><input className="settings-number-input" type="number" min="11" max="24" value={draft.editorFontSize} onChange={(event) => update("editorFontSize", Number(event.target.value))} /><span aria-hidden="true">px</span></label></label>
      <ToggleRow title={t("desktop.settings.editorWordWrap")} description={t("desktop.settings.editorWordWrapDesc")} checked={draft.editorWordWrap} onChange={(value) => update("editorWordWrap", value)} />
      <SelectRow title={t("desktop.settings.editorTabSize")} description={t("desktop.settings.editorTabSizeDesc")} value={draft.editorTabSize} onChange={(value) => update("editorTabSize", Number(value) as WorkbenchDraft["editorTabSize"])}><option value="2">{t("desktop.settings.editorTabSize2")}</option><option value="4">{t("desktop.settings.editorTabSize4")}</option><option value="8">{t("desktop.settings.editorTabSize8")}</option></SelectRow>
      <SelectRow title={t("desktop.settings.editorAutoSaveDelay")} description={t("desktop.settings.editorAutoSaveDelayDesc")} value={draft.editorAutoSaveDelayMs} onChange={(value) => update("editorAutoSaveDelayMs", Number(value) as WorkbenchDraft["editorAutoSaveDelayMs"])}><option value="300">{t("desktop.settings.editorAutoSaveDelay300")}</option><option value="600">{t("desktop.settings.editorAutoSaveDelay600")}</option><option value="1000">{t("desktop.settings.editorAutoSaveDelay1000")}</option><option value="2000">{t("desktop.settings.editorAutoSaveDelay2000")}</option></SelectRow>
    </div></section>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.editorTerminal")}</h3><div className="settings-group-body">
      <SelectRow title={t("desktop.settings.projectEditor")} description={t("desktop.settings.projectEditorDesc")} value={draft.projectEditor} onChange={(value) => update("projectEditor", value as WorkbenchDraft["projectEditor"])}><option value="auto">{t("desktop.settings.editorAuto")}</option><option value="vscode">VS Code</option><option value="vscodium">VSCodium</option><option value="cursor">Cursor</option><option value="windsurf">Windsurf</option></SelectRow>
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
      {draft.gitCommitMessageStyle === "custom" ? <label className="settings-field"><span className="settings-field-label">{t("desktop.settings.gitCommitCustomInstructions")}</span><span className="settings-field-desc muted">{t("desktop.settings.gitCommitCustomInstructionsDesc")}</span><textarea rows={6} maxLength={4000} spellCheck={false} value={draft.gitCommitCustomInstructions} onChange={(event) => update("gitCommitCustomInstructions", event.target.value)} /></label> : null}
    </div></section>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.gitNestedScanGroup")}</h3><div className="settings-group-body">
      <SelectRow title={t("desktop.settings.gitNestedScanMaxDepth")} description={t("desktop.settings.gitNestedScanMaxDepthDesc")} value={draft.gitNestedScanMaxDepth} onChange={(value) => update("gitNestedScanMaxDepth", Number(value))}>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</SelectRow>
      <label className="settings-field"><span className="settings-field-label">{t("desktop.settings.gitNestedScanIgnoreDirs")}</span><span className="settings-field-desc muted">{t("desktop.settings.gitNestedScanIgnoreDirsDesc")}</span><textarea rows={5} spellCheck={false} placeholder={"node_modules\ndist"} value={draft.gitNestedScanIgnoreDirs} onChange={(event) => update("gitNestedScanIgnoreDirs", event.target.value)} /></label>
    </div></section>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.projectContextMenuGroup")}</h3><div className="settings-group-body">
      <p className="settings-footnote">{t("desktop.settings.projectContextMenuDesc")}</p>
      {ALL_WORKBENCH_PROJECT_CONTEXT_MENU.map((action) => {
        const checked = draft.projectContextMenu.includes(action);
        return <ToggleRow
          key={action}
          title={t(`desktop.settings.projectMenu.${action}`)}
          description={t(`desktop.settings.projectMenu.${action}Desc`)}
          checked={checked}
          onChange={(value) => {
            const next = value
              ? [...draft.projectContextMenu.filter((item) => item !== action), action]
              : draft.projectContextMenu.filter((item) => item !== action);
            // Preserve stable display order from ALL_ list
            const ordered = ALL_WORKBENCH_PROJECT_CONTEXT_MENU.filter((item) => next.includes(item));
            update("projectContextMenu", ordered as WorkbenchProjectContextMenuAction[]);
          }}
        />;
      })}
    </div></section>
  </>;
}

type ScheduleRunRow = Awaited<ReturnType<ReturnType<typeof desktopApi>["usageListScheduleRuns"]>>[number];

function scheduleLevelLabel(level: string, t: Translate): string {
  if (level === "weekly") return t("desktop.report.digestWeekly");
  if (level === "monthly") return t("desktop.report.digestMonthly");
  if (level === "daily") return t("desktop.report.digestDaily");
  return level;
}

function formatScheduleRunSummary(run: ScheduleRunRow, t: Translate): { text: string; kind?: StatusKind } {
  const level = scheduleLevelLabel(run.level, t);
  const when = formatTime(run.startedAtMs);
  if (run.status === "running") {
    return { text: t("desktop.settings.scheduleLastRunRunning", level, run.periodKey, when) };
  }
  if (run.status === "ok") {
    return { text: t("desktop.settings.scheduleLastRunOk", level, run.periodKey, when), kind: "ok" };
  }
  const err = (run.error || "").trim() || t("desktop.common.unknownError");
  return { text: t("desktop.settings.scheduleLastRunError", level, run.periodKey, when, err), kind: "error" };
}

export function ReportPane({
  draft,
  setDraft,
  scheduleSave,
  t,
  onOpenScheduleLog
}: {
  draft: ReportDraft;
  setDraft: (value: ReportDraft) => void;
  scheduleSave: (value: ReportDraft) => void;
  t: Translate;
  onOpenScheduleLog?: () => void;
}) {
  const [maxDays, setMaxDays] = useState(400);
  const [skipExisting, setSkipExisting] = useState(true);
  const [skipEmbedding, setSkipEmbedding] = useState(true);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [lastRun, setLastRun] = useState<ScheduleRunRow | null>(null);
  const [lastRunLoaded, setLastRunLoaded] = useState(false);
  const [lastRunError, setLastRunError] = useState("");

  const loadLastRun = useCallback(async () => {
    try {
      const runs = await desktopApi().usageListScheduleRuns({ days: 90, limit: 1 });
      setLastRun(runs[0] ?? null);
      setLastRunError("");
    } catch (error) {
      setLastRun(null);
      setLastRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setLastRunLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadLastRun();
  }, [loadLastRun, draft.enabled]);

  const update = <K extends keyof ReportDraft>(key: K, value: ReportDraft[K]) => {
    if (key === "enabled" && value && !draft.enabled && !window.confirm(t("desktop.settings.memoryEnableConfirm"))) return;
    const next = { ...draft, [key]: value };
    setDraft(next);
    scheduleSave(next);
  };
  const preview = async () => {
    setStatus({ text: t("desktop.backfill.scanning") });
    try {
      const value = await desktopApi().previewBackfillDigests({ maxDays, skipExisting });
      setStatus({ text: t("desktop.backfill.preview", value.sessionRowsScanned, value.days.length, value.weeks.length, value.months.length, value.estimatedLlmCalls, value.days.length ? t("desktop.backfill.previewRange", value.days[0], value.days[value.days.length - 1]) : t("desktop.backfill.noActivity")), kind: value.days.length ? "ok" : "error" });
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  };
  const run = async () => {
    setStatus({ text: t("desktop.backfill.scanningShort") });
    try {
      const value = await desktopApi().previewBackfillDigests({ maxDays, skipExisting });
      const detail = value.days.length ? t("desktop.backfill.dateRange", value.days[0], value.days[value.days.length - 1]) : "";
      if (!window.confirm(t("desktop.backfill.confirm", value.sessionRowsScanned, value.days.length, value.weeks.length, value.months.length, value.estimatedLlmCalls, detail))) { setStatus({ text: t("desktop.backfill.cancelled") }); return; }
      setStatus({ text: t("desktop.backfill.running") });
      const result = await desktopApi().backfillDigests({ maxDays, skipExisting, skipEmbedding });
      const failures = result.daily.failed.length + result.weekly.failed.length + result.monthly.failed.length;
      setStatus({ text: `${t("desktop.backfill.stats", "daily", result.daily.ok.length, result.daily.skipped.length, failures ? `/fail ${failures}` : "", result.daily.planned.length)} · ${t("desktop.backfill.stats", "weekly", result.weekly.ok.length, result.weekly.skipped.length, "", result.weekly.planned.length)}`, kind: failures ? "error" : "ok" });
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  };

  const lastRunSummary = lastRun ? formatScheduleRunSummary(lastRun, t) : null;

  return <>
    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.scheduledDigests")}</h3>
      <div className="settings-group-body">
        <ToggleRow
          title={t("desktop.settings.enableSchedule")}
          description={t("desktop.settings.enableScheduleDesc")}
          checked={draft.enabled}
          onChange={(value) => update("enabled", value)}
        />
        <p className="settings-footnote">{t("desktop.settings.scheduleRuntimeNote")}</p>
        {draft.enabled ? (
          <div className="settings-schedule-fields">
            <label className="settings-field">
              <span className="settings-field-label">{t("desktop.settings.dailyHour")}</span>
              <input type="number" min="0" max="23" value={draft.dailyHour} onChange={(event) => update("dailyHour", Number(event.target.value))} />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">{t("desktop.settings.weeklyHour")}</span>
              <input type="number" min="0" max="23" value={draft.weeklyHour} onChange={(event) => update("weeklyHour", Number(event.target.value))} />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">{t("desktop.settings.monthlyHour")}</span>
              <input type="number" min="0" max="23" value={draft.monthlyHour} onChange={(event) => update("monthlyHour", Number(event.target.value))} />
            </label>
          </div>
        ) : null}
        <div className="settings-schedule-status" aria-live="polite">
          <div className="settings-schedule-status-label">{t("desktop.settings.scheduleLastRunTitle")}</div>
          {!lastRunLoaded ? (
            <Status>{t("desktop.common.loading")}</Status>
          ) : lastRunError ? (
            <Status kind="error">{lastRunError}</Status>
          ) : lastRunSummary ? (
            <Status kind={lastRunSummary.kind}>{lastRunSummary.text}</Status>
          ) : (
            <Status>{t("desktop.settings.scheduleLastRunNone")}</Status>
          )}
          <div className="settings-action-row">
            <button type="button" className="tool-btn" onClick={() => void loadLastRun()}>
              {t("desktop.settings.scheduleRefreshStatus")}
            </button>
            {onOpenScheduleLog ? (
              <button type="button" className="tool-btn" onClick={onOpenScheduleLog}>
                {t("desktop.settings.scheduleViewLog")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
    <section className="settings-group settings-group-action">
      <h3 className="settings-group-title">{t("desktop.settings.backfillTitle")}</h3>
      <div className="settings-group-body">
        <p className="settings-callout">{t("desktop.settings.backfillCallout")}</p>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.backfillMaxDays")}</span>
          <input type="number" min="1" max="2000" value={maxDays} onChange={(event) => setMaxDays(Math.max(1, Math.min(2000, Number(event.target.value) || 400)))} />
        </label>
        <ToggleRow title={t("desktop.settings.backfillSkipExisting")} checked={skipExisting} onChange={setSkipExisting} />
        <ToggleRow title={t("desktop.settings.backfillSkipEmbedding")} checked={skipEmbedding} onChange={setSkipEmbedding} />
        <div className="settings-action-row">
          <button type="button" className="tool-btn" onClick={() => void preview()}>{t("desktop.settings.backfillPreview")}</button>
          <button type="button" className="tool-btn" onClick={() => void run()}>{t("desktop.settings.backfillRun")}</button>
        </div>
        <Status kind={status.kind}>{status.text}</Status>
      </div>
    </section>
  </>;
}

export function BackupPane({ t }: { t: Translate }) {
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [exportPasswordConfirm, setExportPasswordConfirm] = useState("");
  const [pendingImport, setPendingImport] = useState<Awaited<ReturnType<ReturnType<typeof desktopApi>["backupSelectImport"]>>>(null);
  const [importCredentials, setImportCredentials] = useState(false);
  const [importPassword, setImportPassword] = useState("");
  const [backupStatus, setBackupStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [backupBusy, setBackupBusy] = useState(false);
  const exportData = async () => {
    if (includeCredentials && (!exportPassword || exportPassword !== exportPasswordConfirm)) {
      setBackupStatus({ text: t("desktop.backup.passwordMismatch"), kind: "error" });
      return;
    }
    setBackupBusy(true);
    try {
      const result = await desktopApi().backupExport({ includeCredentials, password: includeCredentials ? exportPassword : undefined });
      setBackupStatus(result.canceled ? { text: t("desktop.backup.exportCanceled") } : { text: t("desktop.backup.exported", result.fileCount || 0), kind: "ok" });
      setExportPassword("");
      setExportPasswordConfirm("");
    } catch (error) {
      setBackupStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setBackupBusy(false);
    }
  };
  const selectImport = async () => {
    setBackupBusy(true);
    try {
      const preview = await desktopApi().backupSelectImport();
      setPendingImport(preview);
      setImportCredentials(false);
      setImportPassword("");
      if (!preview) setBackupStatus({ text: t("desktop.backup.importCanceled") });
      else setBackupStatus({ text: t("desktop.backup.ready", preview.fileCount), kind: "ok" });
    } catch (error) {
      setBackupStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setBackupBusy(false);
    }
  };
  const mergeImport = async () => {
    if (!pendingImport) return;
    if (importCredentials && !importPassword) {
      setBackupStatus({ text: t("desktop.backup.passwordRequired"), kind: "error" });
      return;
    }
    if (!window.confirm(t("desktop.backup.importConfirm", pendingImport.fileCount))) return;
    setBackupBusy(true);
    try {
      const result = await desktopApi().backupImport({ importToken: pendingImport.importToken, includeCredentials: importCredentials, password: importCredentials ? importPassword : undefined });
      setPendingImport(null);
      setImportPassword("");
      setBackupStatus({ text: t("desktop.backup.imported", result.fileCount || 0), kind: "ok" });
    } catch (error) {
      setBackupStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setBackupBusy(false);
    }
  };
  return (
    <section className="settings-group settings-group-action"><h3 className="settings-group-title">{t("desktop.backup.title")}</h3><div className="settings-group-body"><p className="settings-footnote">{t("desktop.backup.description")}</p><label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{t("desktop.backup.includeCredentials")}</span><span className="settings-row-desc">{t("desktop.backup.includeCredentialsDesc")}</span></span><span className="settings-toggle"><input type="checkbox" role="switch" checked={includeCredentials} disabled={backupBusy} onChange={(event) => setIncludeCredentials(event.target.checked)} /><span className="settings-toggle-track" aria-hidden="true" /></span></label>{includeCredentials ? <><label className="settings-field"><span className="settings-field-label">{t("desktop.backup.password")}</span><input type="password" autoComplete="new-password" value={exportPassword} disabled={backupBusy} onChange={(event) => setExportPassword(event.target.value)} /></label><label className="settings-field"><span className="settings-field-label">{t("desktop.backup.passwordConfirm")}</span><input type="password" autoComplete="new-password" value={exportPasswordConfirm} disabled={backupBusy} onChange={(event) => setExportPasswordConfirm(event.target.value)} /></label></> : null}<div className="settings-action-row"><button type="button" className="tool-btn" disabled={backupBusy} onClick={() => void exportData()}><Download size={16} aria-hidden="true" />{t("desktop.backup.export")}</button><button type="button" className="tool-btn" disabled={backupBusy} onClick={() => void selectImport()}><Upload size={16} aria-hidden="true" />{t("desktop.backup.import")}</button></div>{pendingImport ? <div className="settings-group-body"><p className="settings-footnote">{t("desktop.backup.summary", pendingImport.fileCount, Math.ceil(pendingImport.totalBytes / 1024 / 1024))}</p>{pendingImport.credentialsEncrypted ? <label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{t("desktop.backup.importCredentials")}</span></span><span className="settings-toggle"><input type="checkbox" role="switch" checked={importCredentials} disabled={backupBusy} onChange={(event) => setImportCredentials(event.target.checked)} /><span className="settings-toggle-track" aria-hidden="true" /></span></label> : null}{pendingImport.credentialsEncrypted && importCredentials ? <label className="settings-field"><span className="settings-field-label">{t("desktop.backup.password")}</span><input type="password" autoComplete="current-password" value={importPassword} disabled={backupBusy} onChange={(event) => setImportPassword(event.target.value)} /></label> : null}<button type="button" className="tool-btn" disabled={backupBusy} onClick={() => void mergeImport()}>{t("desktop.backup.merge")}</button></div> : null}<Status kind={backupStatus.kind}>{backupStatus.text}</Status></div></section>
  );
}

export function StoragePane({ draft, setDraft, scheduleSave, t }: { draft: StorageDraft; setDraft: (value: StorageDraft) => void; scheduleSave: (value: StorageDraft) => void; t: Translate }) {
  const [advanced, setAdvanced] = useState(false);
  const update = <K extends keyof StorageDraft>(key: K, value: StorageDraft[K]) => { const next = { ...draft, [key]: value }; setDraft(next); scheduleSave(next); };
  const home = draft.panelHome.trim() || "~/.agent-resume-panel";
  const paths: Array<[keyof StorageDraft, string, string]> = [["codexHome", "desktop.settings.codexHome", "~/.codex"], ["claudeHome", "desktop.settings.claudeHome", "~/.claude"], ["antigravityHome", "desktop.settings.antigravityHome", "~/.gemini"], ["grokHome", "desktop.settings.grokHome", "~/.grok"], ["opencodeHome", "desktop.settings.opencodeHome", "~/.local/share/opencode"], ["piHome", "desktop.settings.piHome", "~/.pi/agent"], ["cursorHome", "Cursor CLI home", "~/.cursor"], ["cursorIdeUserDataHome", "Cursor IDE user data home", "Platform default"]];
  return <>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.appData")}</h3><div className="settings-group-body"><p className="settings-footnote">{t("desktop.settings.appDataFootnote")}</p><label className="settings-field"><span className="settings-field-label">{t("desktop.settings.panelHome")}</span><input placeholder="~/.agent-resume-panel" value={draft.panelHome} onChange={(event) => update("panelHome", event.target.value)} /></label><p className="settings-footnote">{t("desktop.settings.panelHomeFootnote")}</p><div className="settings-path-row"><button type="button" className="tool-btn" onClick={() => void desktopApi().settingsOpenPanelHome()}>{t("desktop.common.revealInFinder")}</button></div></div></section>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.notesGroup")}</h3><div className="settings-group-body"><p className="settings-footnote">{t("desktop.settings.notesFootnote")}</p><div className="settings-path-row"><code className="settings-path-display">{home}/notes</code><button type="button" className="tool-btn" onClick={() => void desktopApi().notesOpenFolder()}>{t("desktop.common.revealInFinder")}</button></div></div></section>
    <section className={`settings-group settings-disclosure${advanced ? "" : " collapsed"}`}><button type="button" className="settings-disclosure-head" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}><span className="settings-disclosure-chevron" aria-hidden="true" /><span className="settings-disclosure-title">{t("desktop.settings.agentHomesAdvanced")}</span></button>{advanced ? <div className="settings-disclosure-body">{paths.map(([key, label, placeholder]) => <label className="settings-field" key={key}><span className="settings-field-label">{label.startsWith("desktop.") ? t(label) : label}</span><input placeholder={placeholder} value={draft[key]} onChange={(event) => update(key, event.target.value)} /></label>)}</div> : null}</section>
  </>;
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
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const clear = async () => {
    if (!window.confirm(t("desktop.logs.clearConfirm"))) {
      return;
    }
    setBusy(true);
    try {
      await desktopApi().logsClear();
      setExpandedId(null);
      await load();
      setStatus({ text: t("desktop.logs.cleared"), kind: "ok" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
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
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
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
  const resource = (title: string, description: string, icon: ReactNode, url: string, primary = false) => <button type="button" className={`settings-about-row${primary ? " settings-about-row-primary" : ""}`} onClick={() => open(url)}><span className="settings-about-row-icon" aria-hidden="true">{icon}</span><span className="settings-about-row-text"><span className="settings-about-row-title">{title}</span><span className="settings-about-row-desc">{description}</span></span><ExternalLink className="settings-about-row-external" size={14} aria-hidden="true" /></button>;
  return <div className="settings-pane-body settings-about-body"><header className="settings-about-hero"><div className="settings-about-app-icon" aria-hidden="true"><img className="settings-about-app-icon-img" src="../resources/icon.png" alt="" width="72" height="72" decoding="async" /></div><h3 className="settings-about-app-name">Agent Resume</h3><p className="settings-about-version">{t("desktop.settings.aboutVersionLabel")} {version || "-"}</p><p className="settings-about-tagline">{t("desktop.settings.aboutTagline")}</p></header>{checking || update ? <div className={`settings-about-update${available ? " is-available" : ""}`}><p className="settings-about-update-text">{checking ? t("desktop.settings.updateChecking") : !update?.ok ? t("desktop.settings.updateCheckFailed") : available ? t("desktop.settings.updateAvailable", update.latestVersion || "") : t("desktop.settings.updateUpToDate")}</p><div className="settings-about-update-actions">{available && updateUrl ? <button type="button" className="btn primary" onClick={() => open(updateUrl)}>{t("desktop.settings.updateDownload")}</button> : null}<button type="button" className="btn ghost" onClick={() => void check(true)}>{t("desktop.settings.updateRecheck")}</button></div></div> : null}<section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.aboutResources")}</h3><div className="settings-group-body settings-group-body-rows settings-about-rows">{resource(t("desktop.settings.linkDocumentation"), t("desktop.settings.linkDocumentationDesc"), <FileText size={18} />, "https://github.com/thunder-luc/agent-resume-desktop-doc#readme")}{resource(t("desktop.settings.linkExtensionDoc"), t("desktop.settings.linkExtensionDocDesc"), <ExternalLink size={18} />, "https://github.com/thunder-luc/agent-resume-panel-doc#readme")}</div></section><section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.aboutFeedback")}</h3><div className="settings-group-body settings-group-body-rows settings-about-rows">{resource(t("desktop.settings.linkReportIssue"), t("desktop.settings.linkReportIssueDesc"), <MessageSquareWarning size={18} />, "https://github.com/thunder-luc/agent-resume-desktop-doc/issues", true)}</div></section><aside className="settings-about-privacy"><ShieldCheck className="settings-about-privacy-icon" size={16} aria-hidden="true" /><p>{t("desktop.settings.footerHint")}</p></aside></div>;
}
