import { ThemeIcon } from "../../components/ThemeIcon";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { appearanceStateFromSettings } from "../../themes";
import type { AiProvider, ModelKind, ModelSelection, PanelSettings, ProviderModel } from "@agent-resume/core";
import { listProviderModels } from "./providerPool";
import { desktopApi } from "../../bridge";
import { Status, type StatusKind } from "../../components/Status";
import { useI18n } from "../../i18n";
import { AboutPane, BackupPane, LogsPane, NotesPane, ReportPane, StoragePane, UsagePane, WorkbenchPane, type UsageDetailTab } from "./AdditionalPanes";
import { ImSettingsPane } from "./ImSettingsPane";
import { McpPane } from "./McpPane";
import {
  embeddingSearchIdentityChanged,
  generalDraftFromSettings,
  generalPatch,
  providersDraftFromSettings,
  providersPatch,
  reportDraftFromSettings,
  reportPatch,
  notesDraftFromSettings,
  notesPatch,
  sessionsDraftFromSettings,
  sessionsPatch,
  storageDraftFromSettings,
  storagePatch,
  workbenchDraftFromSettings,
  workbenchPatch,
  type GeneralDraft,
  type ProvidersDraft,
  type NotesDraft,
  type ReportDraft,
  type SessionsDraft,
  type StorageDraft,
  type WorkbenchDraft
} from "./model";

type Pane = "general" | "providers" | "sessions" | "workbench" | "im" | "notes" | "report" | "storage" | "mcp" | "usage" | "logs" | "backup" | "about";
type EditablePane = Exclude<Pane, "mcp" | "usage" | "logs" | "backup" | "about" | "im">;

function isEditablePane(value: Pane): value is EditablePane {
  return value !== "mcp" && value !== "usage" && value !== "logs" && value !== "backup" && value !== "about" && value !== "im";
}

export type SettingsPanelProps = {
  /** Production path is always "window" (auxiliary BrowserWindow). */
  variant?: "window" | "embedded";
  initialPane?: string;
};

const panes: Array<{ id: Pane; key: string; desc: string }> = [
  { id: "general", key: "desktop.settings.paneGeneral", desc: "desktop.settings.paneGeneralDesc" },
  { id: "providers", key: "desktop.settings.paneProviders", desc: "desktop.settings.paneProvidersDesc" },
  { id: "sessions", key: "desktop.settings.paneSessions", desc: "desktop.settings.paneSessionsDesc" },
  { id: "workbench", key: "desktop.settings.paneWorkbench", desc: "desktop.settings.paneWorkbenchDesc" },
  { id: "im", key: "desktop.settings.paneIm", desc: "desktop.settings.paneImDesc" },
  { id: "notes", key: "desktop.settings.paneNotes", desc: "desktop.settings.paneNotesDesc" },
  { id: "report", key: "desktop.settings.paneReport", desc: "desktop.settings.paneReportDesc" },
  { id: "storage", key: "desktop.settings.paneStorage", desc: "desktop.settings.paneStorageDesc" },
  { id: "mcp", key: "desktop.settings.paneMcp", desc: "desktop.settings.paneMcpDesc" },
  { id: "usage", key: "desktop.settings.paneUsage", desc: "desktop.settings.paneUsageDesc" },
  { id: "logs", key: "desktop.settings.paneLogs", desc: "desktop.settings.paneLogsDesc" },
  { id: "backup", key: "desktop.settings.paneBackup", desc: "desktop.settings.paneBackupDesc" },
  { id: "about", key: "desktop.settings.paneAbout", desc: "desktop.settings.paneAboutDesc" }
];

function asPane(value: unknown): Pane {
  return panes.some((pane) => pane.id === value) ? value as Pane : "general";
}

export function SettingsPanel({
  variant = "window",
  initialPane
}: SettingsPanelProps): React.ReactPortal | null {
  const { t } = useI18n();
  const host = document.getElementById("react-settings");
  const isWindow = variant === "window";
  const [open, setOpen] = useState(isWindow);
  const [pane, setPane] = useState<Pane>(() => asPane(initialPane));
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [general, setGeneral] = useState<GeneralDraft | null>(null);
  const [providers, setProviders] = useState<ProvidersDraft | null>(null);
  const [sessions, setSessions] = useState<SessionsDraft | null>(null);
  const [workbench, setWorkbench] = useState<WorkbenchDraft | null>(null);
  const [report, setReport] = useState<ReportDraft | null>(null);
  const [storage, setStorage] = useState<StorageDraft | null>(null);
  const [notes, setNotes] = useState<NotesDraft | null>(null);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [usageDetailTab, setUsageDetailTab] = useState<UsageDetailTab | undefined>(undefined);
  const [savingSection, setSavingSection] = useState<EditablePane | null>(null);
  const [pendingPane, setPendingPane] = useState<Pane | null>(null);
  const [pendingClose, setPendingClose] = useState(false);
  const lastSavedSettings = useRef<PanelSettings | null>(null);
  const paneRef = useRef(pane);

  const hydrate = useCallback((next: PanelSettings) => {
    lastSavedSettings.current = next;
    setSettings(next);
    setGeneral(generalDraftFromSettings(next));
    setProviders(providersDraftFromSettings(next));
    setSessions(sessionsDraftFromSettings(next));
    setWorkbench(workbenchDraftFromSettings(next));
    setReport(reportDraftFromSettings(next));
    setStorage(storageDraftFromSettings(next));
    setNotes(notesDraftFromSettings(next));
  }, []);

  const load = useCallback(async () => hydrate(await desktopApi().getSettings()), [hydrate]);

  const isDirtyForPane = useCallback((value: Pane): boolean => {
    if (!isEditablePane(value) || !lastSavedSettings.current) return false;
    const base = lastSavedSettings.current;
    if (value === "general") return JSON.stringify(general) !== JSON.stringify(generalDraftFromSettings(base));
    if (value === "providers") return JSON.stringify(providers) !== JSON.stringify(providersDraftFromSettings(base));
    if (value === "sessions") return JSON.stringify(sessions) !== JSON.stringify(sessionsDraftFromSettings(base));
    if (value === "workbench") return JSON.stringify(workbench) !== JSON.stringify(workbenchDraftFromSettings(base));
    if (value === "notes") return JSON.stringify(notes) !== JSON.stringify(notesDraftFromSettings(base));
    if (value === "report") return JSON.stringify(report) !== JSON.stringify(reportDraftFromSettings(base));
    if (value === "storage") return JSON.stringify(storage) !== JSON.stringify(storageDraftFromSettings(base));
    return false;
  }, [general, providers, sessions, workbench, notes, report, storage]);

  paneRef.current = pane;
  const isDirtyForPaneRef = useRef(isDirtyForPane);
  isDirtyForPaneRef.current = isDirtyForPane;

  useEffect(() => {
    if (isWindow) {
      void load().catch((error: unknown) =>
        setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" })
      );
      const stopNavigate =
        typeof desktopApi().onSettingsNavigate === "function"
          ? desktopApi().onSettingsNavigate((payload) => {
              const next = asPane(payload?.pane);
              if (isDirtyForPaneRef.current(paneRef.current)) {
                setPendingPane(next);
                return;
              }
              setPane(next);
            })
          : () => undefined;
      return () => {
        stopNavigate();
      };
    }

    const onOpen = (event: Event) => {
      setPane(asPane(event instanceof CustomEvent ? event.detail : "general"));
      setOpen(true);
      void load().catch((error: unknown) =>
        setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" })
      );
    };
    const onTabChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== "settings") {
        if (isDirtyForPaneRef.current(paneRef.current)) {
          setPendingClose(true);
          return;
        }
        setOpen(false);
      }
    };
    window.addEventListener("agent-resume:settings-open", onOpen);
    window.addEventListener("agent-resume:tab-change", onTabChange);
    return () => {
      window.removeEventListener("agent-resume:settings-open", onOpen);
      window.removeEventListener("agent-resume:tab-change", onTabChange);
    };
  }, [isWindow, load]);

  const save = useCallback(async (next: PanelSettings, section: EditablePane) => {
    setSavingSection(section);
    setStatus({ text: t("desktop.settings.saving") });
    try {
      const result = await desktopApi().saveSettings(next, {
        triggerSync: section === "sessions" || section === "storage",
        section
      });
      hydrate(result.settings);
      // Window mode: main window receives settings via IPC broadcast only (K17)
      if (!isWindow) {
        window.dispatchEvent(
          new CustomEvent("agent-resume:settings-saved", {
            detail: { settings: result.settings, section, sync: result.sync }
          })
        );
      }
      setStatus({
        text: t(
          "desktop.settings.saved",
          result.schedulerEnabled ? t("desktop.settings.schedulerOn") : t("desktop.settings.schedulerOff")
        ),
        kind: "ok"
      });
    } catch (error) {
      const last = lastSavedSettings.current;
      if (last) {
        hydrate(last);
        window.dispatchEvent(new CustomEvent("agent-resume:appearance-change", {
          detail: appearanceStateFromSettings(last)
        }));
      }
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setSavingSection(null);
    }
  }, [hydrate, isWindow, t]);

  const currentDraft = useCallback((section: EditablePane): GeneralDraft | ProvidersDraft | SessionsDraft | WorkbenchDraft | NotesDraft | ReportDraft | StorageDraft | null => {
    if (section === "general") return general;
    if (section === "providers") return providers;
    if (section === "sessions") return sessions;
    if (section === "workbench") return workbench;
    if (section === "notes") return notes;
    if (section === "report") return report;
    return storage;
  }, [general, providers, sessions, workbench, notes, report, storage]);

  const savedDraftFor = useCallback((section: EditablePane) => {
    const base = lastSavedSettings.current;
    if (!base) return null;
    if (section === "general") return generalDraftFromSettings(base);
    if (section === "providers") return providersDraftFromSettings(base);
    if (section === "sessions") return sessionsDraftFromSettings(base);
    if (section === "workbench") return workbenchDraftFromSettings(base);
    if (section === "notes") return notesDraftFromSettings(base);
    if (section === "report") return reportDraftFromSettings(base);
    return storageDraftFromSettings(base);
  }, []);

  const isDirty = useCallback((section: EditablePane): boolean => {
    const cur = currentDraft(section);
    const saved = savedDraftFor(section);
    if (!cur || !saved) return false;
    return JSON.stringify(cur) !== JSON.stringify(saved);
  }, [currentDraft, savedDraftFor]);

  const hasAnyDirty = useCallback((): boolean => {
    const sections: EditablePane[] = ["general", "providers", "sessions", "workbench", "notes", "report", "storage"];
    return sections.some((s) => isDirty(s));
  }, [isDirty]);

  const handleSave = useCallback(async (section: EditablePane) => {
    if (!settings) return;
    const draft = currentDraft(section);
    if (!draft) return;
    if (section === "providers") {
      const providersDraft = draft as ProvidersDraft;
      if (embeddingSearchIdentityChanged(settings, providersDraft)) {
        if (!window.confirm(t("desktop.settings.embeddingModelChangeConfirm"))) {
          setProviders(providersDraftFromSettings(settings));
          setStatus({ text: t("desktop.settings.embeddingModelChangeCancelled"), kind: "error" });
          return;
        }
      }
    }
    const patch = section === "general" ? generalPatch(settings, draft as GeneralDraft)
      : section === "providers" ? providersPatch(settings, draft as ProvidersDraft)
      : section === "sessions" ? sessionsPatch(settings, draft as SessionsDraft)
      : section === "workbench" ? workbenchPatch(settings, draft as WorkbenchDraft)
      : section === "notes" ? notesPatch(settings, draft as NotesDraft)
      : section === "report" ? reportPatch(settings, draft as ReportDraft)
      : storagePatch(settings, draft as StorageDraft);
    await save({ ...settings, ...patch }, section);
  }, [settings, currentDraft, save, t]);

  const handleDiscard = useCallback((section: EditablePane) => {
    const base = lastSavedSettings.current;
    if (!base) return;
    if (section === "general") {
      setGeneral(generalDraftFromSettings(base));
      window.dispatchEvent(new CustomEvent("agent-resume:appearance-change", {
        detail: appearanceStateFromSettings(base)
      }));
    } else if (section === "providers") setProviders(providersDraftFromSettings(base));
    else if (section === "sessions") setSessions(sessionsDraftFromSettings(base));
    else if (section === "workbench") setWorkbench(workbenchDraftFromSettings(base));
    else if (section === "notes") setNotes(notesDraftFromSettings(base));
    else if (section === "report") setReport(reportDraftFromSettings(base));
    else setStorage(storageDraftFromSettings(base));
    setStatus({ text: "" });
  }, []);

  const requestPaneChange = useCallback((next: Pane) => {
    if (next === pane) return;
    if (isEditablePane(pane) && isDirty(pane)) {
      setPendingPane(next);
      return;
    }
    if (next !== "usage") setUsageDetailTab(undefined);
    setPane(next);
  }, [pane, isDirty]);

  const doClose = useCallback(() => {
    if (isWindow) {
      if (typeof desktopApi().closeSettingsWindow === "function") {
        void desktopApi().closeSettingsWindow();
      }
      return;
    }
    setOpen(false);
    window.dispatchEvent(new Event("agent-resume:settings-closed"));
  }, [isWindow]);

  const requestClose = useCallback(() => {
    if (hasAnyDirty()) {
      setPendingClose(true);
      return;
    }
    doClose();
  }, [hasAnyDirty, doClose]);

  if (!host || !open || !settings || !general || !providers || !sessions || !workbench || !notes || !report || !storage) return null;
  const current = panes.find((item) => item.id === pane) || panes[0];
  const close = requestClose;
  const editable = isEditablePane(pane);
  const dirty = editable ? isDirty(pane) : false;
  const saving = editable ? savingSection === pane : false;
  const body = pane === "general" ? <GeneralPane draft={general} setDraft={(value) => setGeneral(value)} t={t} />
    : pane === "providers" ? <ProvidersPane draft={providers} setDraft={(value) => setProviders(value)} t={t} />
    : pane === "sessions" ? <SessionsPane draft={sessions} setDraft={(value) => setSessions(value)} t={t} />
    : pane === "workbench" ? <WorkbenchPane draft={workbench} setDraft={(value) => setWorkbench(value)} t={t} />
    : pane === "im" ? <ImSettingsPane t={t} />
    : pane === "notes" ? <NotesPane draft={notes} setDraft={setNotes} t={t} />
    : pane === "report" ? (
      <ReportPane
        draft={report}
        setDraft={(value) => setReport(value)}
        t={t}
        onOpenScheduleLog={() => {
          if (isEditablePane(pane) && isDirty(pane)) {
            setPendingPane("usage" as Pane);
            return;
          }
          setUsageDetailTab("schedule");
          setPane("usage");
        }}
      />
    )
    : pane === "storage" ? <StoragePane draft={storage} setDraft={(value) => setStorage(value)} t={t} />
    : pane === "mcp" ? <McpPane t={t} />
    : pane === "usage" ? <UsagePane t={t} initialDetailTab={usageDetailTab} />
    : pane === "logs" ? <LogsPane t={t} />
    : pane === "backup" ? <BackupPane t={t} /> : <AboutPane t={t} />;

  return createPortal(
    <section className="panel active react-settings-panel">
      <div className="toolbar">
        <h2 className="quiet-title">{t("desktop.settings.title")}</h2>
        <button type="button" className="ghost-btn" onClick={close}>{t("desktop.settings.done")}</button>
      </div>
      <div className="settings-layout">
        <aside className="settings-nav" aria-label={t("desktop.settings.navLabel")}>
          {panes.map((item) => (
            <button
              type="button"
              className={`settings-nav-item${pane === item.id ? " active" : ""}`}
              key={item.id}
              onClick={() => requestPaneChange(item.id)}
            >
              {t(item.key)}
            </button>
          ))}
        </aside>
        <div className="settings-main">
          <header className="settings-content-header">
            <div className="settings-content-header-text">
              <h2 className="settings-pane-title">{t(current.key)}</h2>
              <p className="settings-pane-desc">{t(current.desc)}</p>
            </div>
            {pane !== "usage" && pane !== "logs" && pane !== "about" ? (
              <div className="settings-header-actions">
                <Status kind={status.kind}>{status.text}</Status>
              </div>
            ) : null}
          </header>
          {pendingPane || pendingClose ? (
            <div className="settings-unsaved-banner" role="alert">
              <span className="settings-unsaved-text">{t("desktop.settings.unsavedConfirm")}</span>
              <span className="settings-unsaved-actions">
                <button type="button" className="btn primary" disabled={Boolean(savingSection)} onClick={async () => {
                  const targetPane = pendingPane;
                  const doPendingClose = pendingClose;
                  if (editable && dirty) {
                    await handleSave(pane as EditablePane);
                    if (isDirty(pane as EditablePane)) return;
                  }
                  setPendingPane(null);
                  setPendingClose(false);
                  if (doPendingClose) {
                    doClose();
                  } else if (targetPane) {
                    if (targetPane !== "usage") setUsageDetailTab(undefined);
                    setPane(targetPane);
                  }
                }}>{t("desktop.settings.saveAndContinue")}</button>
                <button type="button" className="ghost-btn" onClick={() => {
                  const targetPane = pendingPane;
                  const doPendingClose = pendingClose;
                  if (editable) handleDiscard(pane as EditablePane);
                  setPendingPane(null);
                  setPendingClose(false);
                  if (doPendingClose) {
                    doClose();
                  } else if (targetPane) {
                    if (targetPane !== "usage") setUsageDetailTab(undefined);
                    setPane(targetPane);
                  }
                }}>{t("desktop.settings.discardAndContinue")}</button>
                <button type="button" className="ghost-btn" onClick={() => { setPendingPane(null); setPendingClose(false); }}>{t("desktop.settings.cancel")}</button>
              </span>
            </div>
          ) : null}
          <div className="form settings-form">
            <div
              className={`settings-pane${pane === "usage" || pane === "logs" ? " settings-pane-usage" : pane === "about" ? " settings-pane-about" : ""}`}
            >
              {pane === "usage" || pane === "logs" || pane === "about" || pane === "mcp" || pane === "backup" ? body : <div className="settings-pane-body">{pane === "im" ? body : <>{body}
                <div className="settings-pane-actions">
                  <button type="button" className="btn primary" data-testid={`settings-save-${pane}`} disabled={!dirty || saving} onClick={() => void handleSave(pane as EditablePane)}>{saving ? t("desktop.settings.saving") : t("desktop.settings.save")}</button>
                  <button type="button" className="ghost-btn" data-testid={`settings-discard-${pane}`} disabled={!dirty || saving} onClick={() => handleDiscard(pane as EditablePane)}>{t("desktop.settings.discard")}</button>
                  {dirty ? <span className="settings-unsaved-hint">{t("desktop.settings.unsavedHint")}</span> : null}
                </div></>}</div>}
            </div>
          </div>
          {pane === "about" ? (
            <div className="settings-header-actions react-settings-status">
              <Status kind={status.kind}>{status.text}</Status>
            </div>
          ) : null}
        </div>
      </div>
    </section>,
    host
  );
}

function GeneralPane({ draft, setDraft, t }: { draft: GeneralDraft; setDraft: (value: GeneralDraft) => void; t: (key: string, ...args: Array<string | number>) => string }) {
  const darkOnly = draft.visualTheme !== "classic";
  const preview = (next: GeneralDraft) => window.dispatchEvent(new CustomEvent("agent-resume:appearance-change", {
    detail: appearanceStateFromSettings({ desktop: {
      theme: next.visualTheme === "classic" ? next.desktopTheme : "dark",
      visualTheme: next.visualTheme,
      themeEffects: next.themeEffects
    } })
  }));
  const update = <K extends keyof GeneralDraft>(key: K, value: GeneralDraft[K]) => {
    const next = { ...draft, [key]: value };
    if (key === "visualTheme" && value !== "classic") next.desktopTheme = "dark";
    setDraft(next); preview(next);
  };
  const themes: Array<{ id: GeneralDraft["visualTheme"]; label: string; description: string }> = [
    { id: "classic", label: t("desktop.settings.visualThemeClassic"), description: t("desktop.settings.visualThemeClassicDesc") },
    { id: "cyberpunk", label: t("desktop.settings.visualThemeCyberpunk"), description: t("desktop.settings.visualThemeCyberpunkDesc") },
    { id: "dos", label: t("desktop.settings.visualThemeDos"), description: t("desktop.settings.visualThemeDosDesc") }
  ];
  return <>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.appearance")}</h3><div className="settings-group-body">
      <div className="settings-theme-field"><span className="settings-field-label">{t("desktop.settings.visualTheme")}</span><span className="settings-field-desc muted">{t("desktop.settings.visualThemeDesc")}</span><div className="theme-preview-grid" role="radiogroup" aria-label={t("desktop.settings.visualTheme")}>{themes.map((theme) => <button type="button" role="radio" aria-checked={draft.visualTheme === theme.id} className={`theme-preview-card theme-preview-${theme.id}${draft.visualTheme === theme.id ? " is-selected" : ""}`} key={theme.id} onClick={() => update("visualTheme", theme.id)}><span className="theme-preview-art" aria-hidden="true"><i /><i /><i /></span><span className="theme-preview-copy"><strong>{theme.label}</strong><small>{theme.description}</small></span></button>)}</div></div>
      <div className="settings-theme-field"><span className="settings-field-label">{t("desktop.settings.theme")}</span><span className="settings-field-desc muted">{darkOnly ? t("desktop.settings.themeDarkOnly") : t("desktop.settings.themeDesc")}</span><div className="theme-mode-control" role="radiogroup" aria-label={t("desktop.settings.theme")}>{(["system", "light", "dark"] as const).map((mode) => <button type="button" role="radio" aria-checked={draft.desktopTheme === mode} disabled={darkOnly && mode !== "dark"} className={draft.desktopTheme === mode ? "is-selected" : ""} key={mode} onClick={() => update("desktopTheme", mode)}>{t(mode === "system" ? "desktop.settings.themeSystem" : mode === "light" ? "desktop.settings.themeLight" : "desktop.settings.themeDark")}</button>)}</div></div>
      <div className="settings-theme-field"><span className="settings-field-label">{t("desktop.settings.themeEffects")}</span><span className="settings-field-desc muted">{t("desktop.settings.themeEffectsDesc")}</span><div className="theme-mode-control" role="radiogroup" aria-label={t("desktop.settings.themeEffects")}>{(["full", "reduced"] as const).map((effects) => <button type="button" role="radio" aria-checked={draft.themeEffects === effects} className={draft.themeEffects === effects ? "is-selected" : ""} key={effects} onClick={() => update("themeEffects", effects)}>{t(effects === "full" ? "desktop.settings.themeEffectsFull" : "desktop.settings.themeEffectsReduced")}</button>)}</div></div>
      <label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">UI Language</span><span className="settings-row-desc">{t("desktop.settings.fieldUiLanguageDescription")}</span></span><select className="settings-row-control" value={draft.uiLanguage} onChange={(event) => update("uiLanguage", event.target.value as GeneralDraft["uiLanguage"])}><option value="auto">{t("desktop.settings.fieldUiLanguageOptionAuto")}</option><option value="en">English</option><option value="zh-cn">简体中文</option><option value="ja">日本語</option></select></label>
    </div></section>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.agentActions")}</h3><div className="settings-group-body"><label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{t("desktop.settings.alwaysAllowAgentWrites")}</span><span className="settings-row-desc">{t("desktop.settings.alwaysAllowAgentWritesDesc")}</span></span><span className="settings-toggle"><input type="checkbox" role="switch" checked={draft.alwaysAllowAgentNonDestructiveOperations} onChange={(event) => update("alwaysAllowAgentNonDestructiveOperations", event.target.checked)} /><span className="settings-toggle-track" aria-hidden="true" /></span></label></div></section>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.notificationsGroup")}</h3><p className="settings-group-desc muted">{t("desktop.settings.notificationsGroupDesc")}</p><div className="settings-group-body"><label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{t("desktop.settings.notificationsAutoClear")}</span><span className="settings-row-desc">{t("desktop.settings.notificationsAutoClearDesc")}</span></span><select className="settings-row-control" value={draft.notifications.autoClearMinutes} onChange={(event) => update("notifications", { ...draft.notifications, autoClearMinutes: Number(event.target.value) })}><option value="15">{t("desktop.settings.autoClearMinutes.15")}</option><option value="30">{t("desktop.settings.autoClearMinutes.30")}</option><option value="60">{t("desktop.settings.autoClearMinutes.60")}</option><option value="240">{t("desktop.settings.autoClearMinutes.240")}</option><option value="1440">{t("desktop.settings.autoClearMinutes.1440")}</option><option value="0">{t("desktop.settings.autoClearMinutes.0")}</option></select></label></div></section>
  </>;
}

type ModelTestKind = "text" | "embedding";

function ProvidersPane({ draft, setDraft, t }: { draft: ProvidersDraft; setDraft: (value: ProvidersDraft) => void; t: (key: string, ...args: Array<string | number>) => string }) {
  const [selectedProviderId, setSelectedProviderId] = useState(draft.providers[0]?.id ?? "");
  const [testKind, setTestKind] = useState<ModelTestKind>("text");
  const [testing, setTesting] = useState<ModelTestKind | null>(null);
  const [testStatus, setTestStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedByProvider, setFetchedByProvider] = useState<Record<string, ProviderModel[]>>({});
  const [revealedApiKey, setRevealedApiKey] = useState(false);
  const [newModelId, setNewModelId] = useState("");
  const [newModelKind, setNewModelKind] = useState<ModelKind>("text");

  const update = <K extends keyof ProvidersDraft>(key: K, value: ProvidersDraft[K]) => setDraft({ ...draft, [key]: value });

  const poolAsSettings = draft.providers;
  const poolFor = (kind: ModelKind) => listProviderModels(poolAsSettings, kind);

  const selectedProvider = draft.providers.find((entry) => entry.id === selectedProviderId) ?? draft.providers[0] ?? null;

  const patchProvider = (providerId: string, patch: (provider: AiProvider) => AiProvider) => {
    update("providers", draft.providers.map((entry) => entry.id === providerId ? patch({ ...entry, models: [...entry.models] }) : entry));
  };

  const addProvider = () => {
    const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `provider-${Date.now()}`;
    const provider: AiProvider = { id, name: t("desktop.settings.providerNewName"), baseUrl: "https://api.openai.com/v1", models: [] };
    update("providers", [...draft.providers, provider]);
    setSelectedProviderId(id);
  };

  const removeProvider = (providerId: string) => {
    if (!window.confirm(t("desktop.settings.providerRemoveConfirm"))) return;
    const providers = draft.providers.filter((entry) => entry.id !== providerId);
    const clearIfSelected = (selection: ModelSelection) => selection.providerId === providerId ? {} : selection;
    setDraft({
      ...draft,
      providers,
      toolSelection: clearIfSelected(draft.toolSelection),
      chatSelection: clearIfSelected(draft.chatSelection),
      embeddingSelection: clearIfSelected(draft.embeddingSelection),
      imageSelection: clearIfSelected(draft.imageSelection)
    });
    if (selectedProviderId === providerId) {
      setSelectedProviderId(providers[0]?.id ?? "");
    }
  };

  const runTest = async () => {
    if (!selectedProvider) return;
    const kind = testKind;
    setTesting(kind);
    setTestStatus({ text: t("desktop.settings.testConnectionTesting") });
    const candidates = poolFor(kind).filter((entry) => entry.providerId === selectedProvider.id);
    const selection = kind === "embedding" ? draft.embeddingSelection : draft.toolSelection;
    const modelId = candidates.find((entry) => entry.modelId === selection.modelId)?.modelId ?? candidates[0]?.modelId ?? "";
    try {
      const result = await desktopApi().providersTestConnection({
        kind,
        provider: { name: selectedProvider.name, baseUrl: selectedProvider.baseUrl, apiKey: selectedProvider.apiKey ?? "" },
        modelId
      });
      setTestStatus({ text: result.message, kind: result.ok ? "ok" : "error" });
    } catch (error) {
      setTestStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setTesting(null);
    }
  };

  const fetchModels = async () => {
    if (!selectedProvider) return;
    setFetchingModels(true);
    setTestStatus({ text: t("desktop.settings.providerFetchingModels") });
    try {
      const result = await desktopApi().providersFetchModels({
        baseUrl: selectedProvider.baseUrl,
        apiKey: selectedProvider.apiKey ?? ""
      });
      if (!result.ok || !result.models) {
        setTestStatus({ text: result.message || t("desktop.settings.providerFetchFailed"), kind: "error" });
        return;
      }
      const fetched = result.models;
      setFetchedByProvider((prev) => ({ ...prev, [selectedProvider.id]: fetched }));
      setTestStatus({ text: t("desktop.settings.providerFetchedModels", fetched.length), kind: "ok" });
      const unadded = fetched.filter((m) => !selectedProvider.models.some((existing) => existing.id === m.id));
      if (unadded.length > 0) {
        setNewModelId(unadded[0].id);
        setNewModelKind(unadded[0].kind);
      }
    } catch (error) {
      setTestStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setFetchingModels(false);
    }
  };

  const addModel = () => {
    const id = newModelId.trim();
    if (!id || !selectedProvider) return;
    const nextProviders = draft.providers.map((entry) =>
      entry.id === selectedProvider.id
        ? entry.models.some((model) => model.id === id)
          ? entry
          : { ...entry, models: [...entry.models, { id, kind: newModelKind }] }
        : entry
    );
    const nextDraft: ProvidersDraft = {
      ...draft,
      providers: nextProviders
    };
    if (newModelKind === "text") {
      if (!draft.toolSelection?.providerId) {
        nextDraft.toolSelection = { providerId: selectedProvider.id, modelId: id };
      }
      if (!draft.chatSelection?.providerId) {
        nextDraft.chatSelection = { providerId: selectedProvider.id, modelId: id };
      }
    } else if (newModelKind === "embedding") {
      if (!draft.embeddingSelection?.providerId) {
        nextDraft.embeddingSelection = { providerId: selectedProvider.id, modelId: id };
      }
    } else if (newModelKind === "image") {
      if (!draft.imageSelection?.providerId) {
        nextDraft.imageSelection = { providerId: selectedProvider.id, modelId: id };
      }
    }
    setDraft(nextDraft);
    setNewModelId("");
  };

  const removeModel = (modelId: string) => {
    if (!selectedProvider) return;
    patchProvider(selectedProvider.id, (provider) => ({
      ...provider,
      models: provider.models.filter((model) => model.id !== modelId)
    }));
  };

  const kindLabel = (kind: ModelKind) =>
    kind === "image"
      ? t("desktop.settings.modelKindImage")
      : kind === "embedding"
        ? t("desktop.settings.modelKindEmbedding")
        : t("desktop.settings.modelKindText");

  const providerMeta = (provider: AiProvider) => {
    const text = provider.models.filter((model) => model.kind === "text").length;
    const image = provider.models.filter((model) => model.kind === "image").length;
    const embedding = provider.models.filter((model) => model.kind === "embedding").length;
    const parts: string[] = [];
    if (text) parts.push(`${text} · ${t("desktop.settings.modelKindText")}`);
    if (image) parts.push(`${image} · ${t("desktop.settings.modelKindImage")}`);
    if (embedding) parts.push(`${embedding} · ${t("desktop.settings.modelKindEmbedding")}`);
    return parts.length ? parts.join("  ") : t("desktop.settings.providerNoModels");
  };

  const selectionRow = (
    labelKey: string,
    descKey: string,
    kind: ModelKind,
    selection: ModelSelection,
    onChange: (value: ModelSelection) => void
  ) => {
    const options = listProviderModels(draft.providers, kind);
    const value = selection.providerId && selection.modelId && options.some(
      (entry) => entry.providerId === selection.providerId && entry.modelId === selection.modelId
    )
      ? `${selection.providerId}:${selection.modelId}`
      : "";
    const emptyHint =
      kind === "embedding"
        ? t("desktop.settings.noEmbeddingModelsHint")
        : kind === "image"
          ? t("desktop.settings.noImageModelsHint")
          : t("desktop.settings.noTextModelsHint");
    return (
      <label className="settings-row" key={labelKey}>
        <span className="settings-row-label">
          <span className="settings-row-title">{t(labelKey)}</span>
          <span className="settings-row-desc">{t(descKey)}</span>
        </span>
        {options.length ? (
          <select
            className="settings-row-control"
            data-testid={`settings-model-select-${kind}`}
            value={value}
            onChange={(event) => {
              const [providerId, modelId] = event.target.value.split(":");
              onChange({ providerId, modelId });
            }}
          >
            <option value="">{t("desktop.settings.modelPlaceholder")}</option>
            {options.map((option) => (
              <option key={`${option.providerId}:${option.modelId}`} value={`${option.providerId}:${option.modelId}`}>
                {option.providerName} / {option.modelId}
              </option>
            ))}
          </select>
        ) : (
          <span className="settings-row-control settings-row-hint">{emptyHint}</span>
        )}
      </label>
    );
  };

  const modelCount = selectedProvider?.models.length ?? 0;
  return <>
    <div className="settings-provider-layout">
      <aside className="settings-provider-list" aria-label={t("desktop.settings.providerListLabel")}>
        <div className="settings-provider-list-header">
          <span className="settings-field-label">{t("desktop.settings.providerList")}</span>
          <button
            type="button"
            className="ghost-btn"
            data-testid="settings-add-provider"
            onClick={addProvider}
          >
            + {t("desktop.settings.providerAdd")}
          </button>
        </div>
        {draft.providers.length === 0 ? (
          <p className="settings-footnote">{t("desktop.settings.providerListEmpty")}</p>
        ) : (
          draft.providers.map((provider) => (
            <div
              key={provider.id}
              className={`settings-provider-item${provider.id === selectedProvider?.id ? " active" : ""}`}
            >
              <button
                type="button"
                className="settings-provider-item-main"
                aria-pressed={provider.id === selectedProvider?.id}
                onClick={() => setSelectedProviderId(provider.id)}
              >
                <span className="settings-provider-item-name">{provider.name || provider.baseUrl}</span>
                <span className="settings-provider-item-meta">{providerMeta(provider)}</span>
              </button>
              <button
                type="button"
                className="settings-provider-remove"
                data-testid={`settings-remove-provider-${provider.id}`}
                aria-label={t("desktop.settings.providerRemove")}
                title={t("desktop.settings.providerRemove")}
                onClick={() => removeProvider(provider.id)}
              >
                <ThemeIcon name="trash" size={14} aria-hidden="true" />
              </button>
            </div>
          ))
        )}
      </aside>
      <div className="settings-provider-detail">
        {selectedProvider ? (
          <>
            <section className="settings-group">
              <h3 className="settings-group-title">{selectedProvider.name || t("desktop.settings.providerDetail")}</h3>
              <div className="settings-group-body">
                <label className="settings-field">
                  <span className="settings-field-label">{t("desktop.settings.providerName")}</span>
                  <input
                    type="text"
                    data-testid="settings-provider-name"
                    value={selectedProvider.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      patchProvider(selectedProvider.id, (provider) => ({ ...provider, name }));
                    }}
                  />
                </label>
                <label className="settings-field">
                  <span className="settings-field-label">{t("desktop.settings.baseUrl")}</span>
                  <input
                    type="text"
                    data-testid="settings-provider-base-url"
                    value={selectedProvider.baseUrl}
                    onChange={(event) => {
                      const baseUrl = event.target.value;
                      patchProvider(selectedProvider.id, (provider) => ({ ...provider, baseUrl }));
                    }}
                  />
                </label>
                <label className="settings-field">
                  <span className="settings-field-label">{t("desktop.settings.apiKey")}</span>
                  <span className="settings-field-input-wrap">
                    <input
                      type={revealedApiKey ? "text" : "password"}
                      autoComplete="off"
                      spellCheck={false}
                      data-testid="settings-provider-api-key"
                      value={selectedProvider.apiKey ?? ""}
                      onChange={(event) => {
                        const apiKey = event.target.value;
                        patchProvider(selectedProvider.id, (provider) => ({ ...provider, apiKey }));
                      }}
                    />
                    <button
                      type="button"
                      className="settings-field-reveal notes-icon-btn"
                      data-testid="settings-provider-api-key-reveal"
                      aria-label={revealedApiKey ? t("desktop.settings.hideApiKey") : t("desktop.settings.showApiKey")}
                      aria-pressed={revealedApiKey}
                      title={revealedApiKey ? t("desktop.settings.hideApiKey") : t("desktop.settings.showApiKey")}
                      onClick={(event) => {
                        event.preventDefault();
                        setRevealedApiKey((current) => !current);
                      }}
                    >
                      {revealedApiKey ? <ThemeIcon name="eye-off" size={15} aria-hidden="true" /> : <ThemeIcon name="eye" size={15} aria-hidden="true" />}
                    </button>
                  </span>
                </label>
                <div className="settings-provider-actions">
                  <select
                    className="settings-row-control settings-provider-test-kind"
                    data-testid="settings-provider-test-kind"
                    value={testKind}
                    onChange={(event) => setTestKind(event.target.value as ModelTestKind)}
                    aria-label={t("desktop.settings.testConnectionKind")}
                  >
                    <option value="text">{t("desktop.settings.modelKindText")}</option>
                    <option value="embedding">{t("desktop.settings.modelKindEmbedding")}</option>
                  </select>
                  <button
                    type="button"
                    className="ghost-btn"
                    data-testid="settings-fetch-provider-models"
                    disabled={fetchingModels || testing !== null}
                    onClick={() => void fetchModels()}
                  >
                    {fetchingModels ? t("desktop.settings.providerFetchingModels") : t("desktop.settings.providerFetchModels")}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    data-testid="settings-test-provider"
                    disabled={fetchingModels || testing !== null || !modelCount}
                    onClick={() => void runTest()}
                  >
                    {testing ? t("desktop.settings.testConnectionTesting") : t("desktop.settings.testConnection")}
                  </button>
                  {testStatus.text ? <Status kind={testStatus.kind}>{testStatus.text}</Status> : null}
                </div>
                <p className="settings-footnote">{t("desktop.settings.providerModelsFootnote")}</p>
              </div>
            </section>
            <section className="settings-group">
              <h3 className="settings-group-title">{t("desktop.settings.providerModels")}</h3>
              <div className="settings-group-body">
                {modelCount === 0 ? (
                  <p className="settings-footnote">{t("desktop.settings.providerNoModels")}</p>
                ) : (
                  <div className="settings-provider-models-list">
                    {selectedProvider.models.map((model) => (
                      <div className="settings-provider-model-row" key={model.id}>
                        <span className="settings-provider-model-kind">{kindLabel(model.kind)}</span>
                        <span className="settings-provider-model-id" title={model.id}>{model.id}</span>
                        <select
                          className="settings-row-control settings-provider-model-kind-select"
                          data-testid={`settings-provider-model-kind-${model.id}`}
                          aria-label={t("desktop.settings.modelKind")}
                          value={model.kind}
                          onChange={(event) => {
                            const kind = event.target.value as ModelKind;
                            patchProvider(selectedProvider.id, (provider) => ({
                              ...provider,
                              models: provider.models.map((entry) => entry.id === model.id ? { ...entry, kind } : entry)
                            }));
                          }}
                        >
                          <option value="text">{t("desktop.settings.modelKindText")}</option>
                          <option value="image">{t("desktop.settings.modelKindImage")}</option>
                          <option value="embedding">{t("desktop.settings.modelKindEmbedding")}</option>
                        </select>
                        <button
                          type="button"
                          className="settings-provider-remove"
                          data-testid={`settings-remove-model-${model.id}`}
                          aria-label={t("desktop.settings.modelRemove")}
                          title={t("desktop.settings.modelRemove")}
                          onClick={() => removeModel(model.id)}
                        >
                          <ThemeIcon name="trash" size={14} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="settings-provider-add-model">
                  {selectedProvider && (fetchedByProvider[selectedProvider.id] ?? []).filter((m) => !selectedProvider.models.some((existing) => existing.id === m.id)).length > 0 ? (
                    <select
                      className="settings-row-control settings-provider-add-model-select"
                      data-testid="settings-add-model-select"
                      value={((fetchedByProvider[selectedProvider.id] ?? []).find((m) => m.id === newModelId)?.id) ?? ""}
                      onChange={(event) => {
                        const val = event.target.value;
                        setNewModelId(val);
                        const matched = (fetchedByProvider[selectedProvider.id] ?? []).find((m) => m.id === val);
                        if (matched) setNewModelKind(matched.kind);
                      }}
                      aria-label={t("desktop.settings.selectFetchedModel", (fetchedByProvider[selectedProvider.id] ?? []).filter((m) => !selectedProvider.models.some((existing) => existing.id === m.id)).length)}
                    >
                      <option value="">{t("desktop.settings.selectFetchedModel", (fetchedByProvider[selectedProvider.id] ?? []).filter((m) => !selectedProvider.models.some((existing) => existing.id === m.id)).length)}</option>
                      {(fetchedByProvider[selectedProvider.id] ?? []).filter((m) => !selectedProvider.models.some((existing) => existing.id === m.id)).map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.id} ({kindLabel(model.kind)})
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <input
                    type="text"
                    className="settings-provider-add-model-id"
                    data-testid="settings-add-model-id"
                    placeholder={(fetchedByProvider[selectedProvider.id] ?? []).length > 0 ? t("desktop.settings.orCustomModelId") : t("desktop.settings.modelAddId")}
                    value={newModelId}
                    onChange={(event) => setNewModelId(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") addModel(); }}
                  />
                  <select
                    className="settings-row-control settings-provider-add-model-kind"
                    data-testid="settings-add-model-kind"
                    aria-label={t("desktop.settings.modelKind")}
                    value={newModelKind}
                    onChange={(event) => setNewModelKind(event.target.value as ModelKind)}
                  >
                    <option value="text">{t("desktop.settings.modelKindText")}</option>
                    <option value="image">{t("desktop.settings.modelKindImage")}</option>
                    <option value="embedding">{t("desktop.settings.modelKindEmbedding")}</option>
                  </select>
                  <button
                    type="button"
                    className="ghost-btn"
                    data-testid="settings-add-model"
                    disabled={!newModelId.trim()}
                    onClick={addModel}
                  >
                    {t("desktop.settings.modelAdd")}
                  </button>
                </div>
              </div>
            </section>
          </>
        ) : (
          <p className="settings-footnote">{t("desktop.settings.providerDetailEmpty")}</p>
        )}
      </div>
    </div>
    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.useCaseModels")}</h3>
      <div className="settings-group-body">
        <p className="settings-footnote">{t("desktop.settings.useCaseModelsFootnote")}</p>
        {selectionRow(
          "desktop.settings.toolModelUse",
          "desktop.settings.toolModelUseDesc",
          "text",
          draft.toolSelection,
          (value) => update("toolSelection", value)
        )}
        <label className="settings-row">
          <span className="settings-row-label">
            <span className="settings-row-title">{t("desktop.settings.outputLanguage")}</span>
            <span className="settings-row-desc">{t("desktop.settings.fieldOutputLanguageDescription")}</span>
          </span>
          <select className="settings-row-control" value={draft.toolOutputLanguage} onChange={(event) => update("toolOutputLanguage", event.target.value as typeof draft.toolOutputLanguage)}>
            <option value="auto">{t("desktop.settings.fieldOutputLanguageOptionAuto")}</option>
            <option value="en">English</option>
            <option value="zh-cn">简体中文</option>
            <option value="ja">日本語</option>
          </select>
        </label>
        <label className="settings-row">
          <span className="settings-row-label">
            <span className="settings-row-title">{t("desktop.settings.disableThinking")}</span>
            <span className="settings-row-desc">{t("desktop.settings.disableThinkingDesc")}</span>
          </span>
          <span className="settings-toggle">
            <input type="checkbox" role="switch" checked={draft.toolDisableThinking} onChange={(event) => update("toolDisableThinking", event.target.checked)} />
            <span className="settings-toggle-track" aria-hidden="true" />
          </span>
        </label>
        {selectionRow(
          "desktop.settings.chatModelUse",
          "desktop.settings.chatModelUseDesc",
          "text",
          draft.chatSelection,
          (value) => update("chatSelection", value)
        )}
        <label className="settings-row">
          <span className="settings-row-label">
            <span className="settings-row-title">{t("desktop.settings.disableThinking")}</span>
            <span className="settings-row-desc">{t("desktop.settings.disableThinkingChatDesc")}</span>
          </span>
          <span className="settings-toggle">
            <input type="checkbox" role="switch" checked={draft.chatDisableThinking} onChange={(event) => update("chatDisableThinking", event.target.checked)} />
            <span className="settings-toggle-track" aria-hidden="true" />
          </span>
        </label>
        {selectionRow(
          "desktop.settings.embeddingModelUse",
          "desktop.settings.embeddingModelUseDesc",
          "embedding",
          draft.embeddingSelection,
          (value) => update("embeddingSelection", value)
        )}
        {selectionRow(
          "desktop.settings.imageModelUse",
          "desktop.settings.imageModelUseDesc",
          "image",
          draft.imageSelection,
          (value) => update("imageSelection", value)
        )}
      </div>
    </section>
  </>;
}

function SessionsPane({ draft, setDraft, t }: { draft: SessionsDraft; setDraft: (value: SessionsDraft) => void; t: (key: string, ...args: Array<string | number>) => string }) {
  const update = <K extends keyof SessionsDraft>(key: K, value: SessionsDraft[K]) => { const next = { ...draft, [key]: value }; setDraft(next); };
  const toggles = [["showArchivedCodex", "desktop.settings.showArchivedCodex"], ["showSubagentCodex", "desktop.settings.showSubagentCodex"], ["showArchivedOpenCode", "desktop.settings.showArchivedOpenCode"], ["showSubagentGrok", "desktop.settings.showSubagentGrok"]] as const;
  return <>
    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.sync")}</h3>
      <div className="settings-group-body">
        <label className="settings-field"><span className="settings-field-label">{t("desktop.settings.syncMax")}</span><input type="number" min="1" max="50000" value={draft.maxItems} onChange={(event) => update("maxItems", Number(event.target.value))} /></label>
        <label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{t("desktop.settings.stalePolicy")}</span><span className="settings-row-desc">{t("desktop.settings.stalePolicyDesc")}</span></span><select className="settings-row-control" value={draft.stalePolicy} onChange={(event) => update("stalePolicy", event.target.value === "purge" ? "purge" : "off")}><option value="off">{t("desktop.settings.staleOff")}</option><option value="purge">{t("desktop.settings.stalePurge")}</option></select></label>
        {toggles.map(([key, label]) => <label className="settings-row" key={key}><span className="settings-row-label"><span className="settings-row-title">{t(label)}</span></span><span className="settings-toggle"><input type="checkbox" role="switch" checked={draft[key]} onChange={(event) => update(key, event.target.checked)} /><span className="settings-toggle-track" aria-hidden="true" /></span></label>)}
      </div>
    </section>
    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.summaryAuto")}</h3>
      <div className="settings-group-body">
        <label className="settings-row">
          <span className="settings-row-label">
            <span className="settings-row-title">{t("desktop.settings.summaryAutoEnabled")}</span>
            <span className="settings-row-desc">{t("desktop.settings.summaryAutoEnabledDesc")}</span>
          </span>
          <span className="settings-toggle">
            <input type="checkbox" role="switch" checked={draft.summaryAutoEnabled} onChange={(event) => update("summaryAutoEnabled", event.target.checked)} />
            <span className="settings-toggle-track" aria-hidden="true" />
          </span>
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.summaryStaleDelay")}</span>
          <span className="settings-field-hint">{t("desktop.settings.summaryStaleDelayHint")}</span>
          <input type="number" min="0" max="1440" disabled={!draft.summaryAutoEnabled} value={draft.summaryStaleDelayMinutes} onChange={(event) => update("summaryStaleDelayMinutes", Number(event.target.value))} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.summaryMissingDelay")}</span>
          <span className="settings-field-hint">{t("desktop.settings.summaryMissingDelayHint")}</span>
          <input type="number" min="0" max="1440" disabled={!draft.summaryAutoEnabled} value={draft.summaryMissingDelayMinutes} onChange={(event) => update("summaryMissingDelayMinutes", Number(event.target.value))} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.summaryAutoMaxPerTick")}</span>
          <span className="settings-field-hint">{t("desktop.settings.summaryAutoMaxPerTickHint")}</span>
          <input type="number" min="1" max="50" disabled={!draft.summaryAutoEnabled} value={draft.summaryAutoMaxPerTick} onChange={(event) => update("summaryAutoMaxPerTick", Number(event.target.value))} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.summaryAutoConcurrency")}</span>
          <span className="settings-field-hint">{t("desktop.settings.summaryAutoConcurrencyHint")}</span>
          <input type="number" min="1" max="3" disabled={!draft.summaryAutoEnabled} value={draft.summaryAutoConcurrency} onChange={(event) => update("summaryAutoConcurrency", Number(event.target.value))} />
        </label>
      </div>
    </section>
    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.embeddingIndex")}</h3>
      <div className="settings-group-body">
        <label className="settings-row">
          <span className="settings-row-label">
            <span className="settings-row-title">{t("desktop.settings.embeddingIndexEnabled")}</span>
            <span className="settings-row-desc">{t("desktop.settings.embeddingIndexEnabledDesc")}</span>
          </span>
          <span className="settings-toggle">
            <input type="checkbox" role="switch" checked={draft.embeddingIndexEnabled} onChange={(event) => update("embeddingIndexEnabled", event.target.checked)} />
            <span className="settings-toggle-track" aria-hidden="true" />
          </span>
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.embeddingQuietDelay")}</span>
          <span className="settings-field-hint">{t("desktop.settings.embeddingQuietDelayHint")}</span>
          <input type="number" min="0" max="1440" disabled={!draft.embeddingIndexEnabled} value={draft.embeddingQuietDelayMinutes} onChange={(event) => update("embeddingQuietDelayMinutes", Number(event.target.value))} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.embeddingIndexMaxPerTick")}</span>
          <span className="settings-field-hint">{t("desktop.settings.embeddingIndexMaxPerTickHint")}</span>
          <input type="number" min="1" max="50" disabled={!draft.embeddingIndexEnabled} value={draft.embeddingIndexMaxPerTick} onChange={(event) => update("embeddingIndexMaxPerTick", Number(event.target.value))} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.embeddingIndexConcurrency")}</span>
          <span className="settings-field-hint">{t("desktop.settings.embeddingIndexConcurrencyHint")}</span>
          <input type="number" min="1" max="4" disabled={!draft.embeddingIndexEnabled} value={draft.embeddingIndexConcurrency} onChange={(event) => update("embeddingIndexConcurrency", Number(event.target.value))} />
        </label>
      </div>
    </section>
    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.transcriptIndex")}</h3>
      <div className="settings-group-body">
        <label className="settings-row">
          <span className="settings-row-label">
            <span className="settings-row-title">{t("desktop.settings.transcriptIndexEnabled")}</span>
            <span className="settings-row-desc">{t("desktop.settings.transcriptIndexEnabledDesc")}</span>
          </span>
          <span className="settings-toggle">
            <input type="checkbox" role="switch" checked={draft.transcriptIndexEnabled} onChange={(event) => update("transcriptIndexEnabled", event.target.checked)} />
            <span className="settings-toggle-track" aria-hidden="true" />
          </span>
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.transcriptQuietDelay")}</span>
          <span className="settings-field-hint">{t("desktop.settings.transcriptQuietDelayHint")}</span>
          <input type="number" min="0" max="1440" disabled={!draft.transcriptIndexEnabled} value={draft.transcriptQuietDelayMinutes} onChange={(event) => update("transcriptQuietDelayMinutes", Number(event.target.value))} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.transcriptIndexMaxPerTick")}</span>
          <span className="settings-field-hint">{t("desktop.settings.transcriptIndexMaxPerTickHint")}</span>
          <input type="number" min="1" max="20" disabled={!draft.transcriptIndexEnabled} value={draft.transcriptIndexMaxPerTick} onChange={(event) => update("transcriptIndexMaxPerTick", Number(event.target.value))} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.transcriptIndexConcurrency")}</span>
          <span className="settings-field-hint">{t("desktop.settings.transcriptIndexConcurrencyHint")}</span>
          <input type="number" min="1" max="3" disabled={!draft.transcriptIndexEnabled} value={draft.transcriptIndexConcurrency} onChange={(event) => update("transcriptIndexConcurrency", Number(event.target.value))} />
        </label>
      </div>
    </section>
    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.autoTagging")}</h3>
      <div className="settings-group-body">
        <label className="settings-row">
          <span className="settings-row-label">
            <span className="settings-row-title">{t("desktop.settings.autoTaggingEnabled")}</span>
            <span className="settings-row-desc">{t("desktop.settings.autoTaggingEnabledDesc")}</span>
          </span>
          <span className="settings-toggle">
            <input type="checkbox" role="switch" checked={draft.autoTaggingEnabled} onChange={(event) => update("autoTaggingEnabled", event.target.checked)} />
            <span className="settings-toggle-track" aria-hidden="true" />
          </span>
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.autoTagHalfLifeDays")}</span>
          <span className="settings-field-hint">{t("desktop.settings.autoTagHalfLifeDaysHint")}</span>
          <input type="number" min="1" max="90" disabled={!draft.autoTaggingEnabled} value={draft.autoTagHalfLifeDays} onChange={(event) => update("autoTagHalfLifeDays", Number(event.target.value))} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.autoTagPruneThreshold")}</span>
          <span className="settings-field-hint">{t("desktop.settings.autoTagPruneThresholdHint")}</span>
          <input type="number" min="0.01" max="1" step="0.01" disabled={!draft.autoTaggingEnabled} value={draft.autoTagPruneThreshold} onChange={(event) => update("autoTagPruneThreshold", Number(event.target.value))} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.autoTagMaxTagsPerItem")}</span>
          <span className="settings-field-hint">{t("desktop.settings.autoTagMaxTagsPerItemHint")}</span>
          <input type="number" min="3" max="10" disabled={!draft.autoTaggingEnabled} value={draft.autoTagMaxTagsPerItem} onChange={(event) => update("autoTagMaxTagsPerItem", Number(event.target.value))} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.autoTagHitBoost")}</span>
          <span className="settings-field-hint">{t("desktop.settings.autoTagHitBoostHint")}</span>
          <input type="number" min="0.1" max="5" step="0.1" disabled={!draft.autoTaggingEnabled} value={draft.autoTagHitBoost} onChange={(event) => update("autoTagHitBoost", Number(event.target.value))} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.autoTagConsensusFactor")}</span>
          <span className="settings-field-hint">{t("desktop.settings.autoTagConsensusFactorHint")}</span>
          <input type="number" min="0.1" max="2" step="0.1" disabled={!draft.autoTaggingEnabled} value={draft.autoTagConsensusFactor} onChange={(event) => update("autoTagConsensusFactor", Number(event.target.value))} />
        </label>
      </div>
    </section>
  </>;
}
