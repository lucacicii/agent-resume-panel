import { ThemeIcon } from "../../components/ThemeIcon";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { appearanceStateFromSettings } from "../../themes";
import type { PanelSettings } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { Status, type StatusKind } from "../../components/Status";
import { useI18n } from "../../i18n";
import { AboutPane, BackupPane, LogsPane, NotesPane, ReportPane, StoragePane, UsagePane, WorkbenchPane, type UsageDetailTab } from "./AdditionalPanes";
import { McpPane } from "./McpPane";
import {
  embeddingSearchIdentityChanged,
  generalDraftFromSettings,
  generalPatch,
  modelsDraftFromSettings,
  modelsPatch,
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
  type ModelsDraft,
  type NotesDraft,
  type ReportDraft,
  type SessionsDraft,
  type StorageDraft,
  type WorkbenchDraft
} from "./model";

type ModelsFieldKey = "llmBaseUrl" | "llmModel" | "llmApiKey" | "chatBaseUrl" | "chatModel" | "chatApiKey" | "embBaseUrl" | "embModel" | "embApiKey";
type ModelsApiKeyField = "llmApiKey" | "chatApiKey" | "embApiKey";

type Pane = "general" | "models" | "sessions" | "workbench" | "notes" | "report" | "storage" | "mcp" | "usage" | "logs" | "backup" | "about";
type Draft = GeneralDraft | ModelsDraft | SessionsDraft | WorkbenchDraft | NotesDraft | ReportDraft | StorageDraft;
type EditablePane = Exclude<Pane, "mcp" | "usage" | "logs" | "backup" | "about">;

export type SettingsPanelProps = {
  /** Production path is always "window" (auxiliary BrowserWindow). */
  variant?: "window" | "embedded";
  initialPane?: string;
};

const panes: Array<{ id: Pane; key: string; desc: string }> = [
  { id: "general", key: "desktop.settings.paneGeneral", desc: "desktop.settings.paneGeneralDesc" },
  { id: "models", key: "desktop.settings.paneModels", desc: "desktop.settings.paneModelsDesc" },
  { id: "sessions", key: "desktop.settings.paneSessions", desc: "desktop.settings.paneSessionsDesc" },
  { id: "workbench", key: "desktop.settings.paneWorkbench", desc: "desktop.settings.paneWorkbenchDesc" },
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
  const [models, setModels] = useState<ModelsDraft | null>(null);
  const [sessions, setSessions] = useState<SessionsDraft | null>(null);
  const [workbench, setWorkbench] = useState<WorkbenchDraft | null>(null);
  const [report, setReport] = useState<ReportDraft | null>(null);
  const [storage, setStorage] = useState<StorageDraft | null>(null);
  const [notes, setNotes] = useState<NotesDraft | null>(null);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [usageDetailTab, setUsageDetailTab] = useState<UsageDetailTab | undefined>(undefined);
  const timer = useRef<number | null>(null);
  const lastSavedSettings = useRef<PanelSettings | null>(null);

  const hydrate = useCallback((next: PanelSettings) => {
    lastSavedSettings.current = next;
    setSettings(next);
    setGeneral(generalDraftFromSettings(next));
    setModels(modelsDraftFromSettings(next));
    setSessions(sessionsDraftFromSettings(next));
    setWorkbench(workbenchDraftFromSettings(next));
    setReport(reportDraftFromSettings(next));
    setStorage(storageDraftFromSettings(next));
    setNotes(notesDraftFromSettings(next));
  }, []);

  const load = useCallback(async () => hydrate(await desktopApi().getSettings()), [hydrate]);

  useEffect(() => {
    if (isWindow) {
      void load().catch((error: unknown) =>
        setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" })
      );
      const stopNavigate =
        typeof desktopApi().onSettingsNavigate === "function"
          ? desktopApi().onSettingsNavigate((payload) => {
              setPane(asPane(payload?.pane));
            })
          : () => undefined;
      return () => {
        stopNavigate();
        if (timer.current) window.clearTimeout(timer.current);
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
        setOpen(false);
      }
    };
    window.addEventListener("agent-resume:settings-open", onOpen);
    window.addEventListener("agent-resume:tab-change", onTabChange);
    return () => {
      window.removeEventListener("agent-resume:settings-open", onOpen);
      window.removeEventListener("agent-resume:tab-change", onTabChange);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [isWindow, load]);

  const save = useCallback(async (next: PanelSettings, section: EditablePane) => {
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
    }
  }, [hydrate, isWindow, t]);

  const scheduleSave = (section: EditablePane, draft: Draft) => {
    if (!settings) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (section === "models") {
        const modelsDraft = draft as ModelsDraft;
        if (embeddingSearchIdentityChanged(settings, modelsDraft)) {
          // Strong confirm: switching embedding space orphans old vectors until re-index.
          if (!window.confirm(t("desktop.settings.embeddingModelChangeConfirm"))) {
            setModels(modelsDraftFromSettings(settings));
            setStatus({ text: t("desktop.settings.embeddingModelChangeCancelled"), kind: "error" });
            return;
          }
        }
      }
      const patch = section === "general" ? generalPatch(settings, draft as GeneralDraft)
        : section === "models" ? modelsPatch(settings, draft as ModelsDraft)
        : section === "sessions" ? sessionsPatch(settings, draft as SessionsDraft)
        : section === "workbench" ? workbenchPatch(settings, draft as WorkbenchDraft)
        : section === "notes" ? notesPatch(settings, draft as NotesDraft)
        : section === "report" ? reportPatch(settings, draft as ReportDraft)
        : storagePatch(settings, draft as StorageDraft);
      void save({ ...settings, ...patch }, section);
    }, 450);
  };

  if (!host || !open || !settings || !general || !models || !sessions || !workbench || !notes || !report || !storage) return null;
  const current = panes.find((item) => item.id === pane) || panes[0];
  const close = () => {
    if (isWindow) {
      if (typeof desktopApi().closeSettingsWindow === "function") {
        void desktopApi().closeSettingsWindow();
      }
      return;
    }
    setOpen(false);
    window.dispatchEvent(new Event("agent-resume:settings-closed"));
  };
  const body = pane === "general" ? <GeneralPane draft={general} setDraft={(value) => setGeneral(value)} scheduleSave={(draft) => scheduleSave("general", draft)} t={t} />
    : pane === "models" ? <ModelsPane draft={models} setDraft={(value) => setModels(value)} scheduleSave={(draft) => scheduleSave("models", draft)} t={t} />
    : pane === "sessions" ? <SessionsPane draft={sessions} setDraft={(value) => setSessions(value)} scheduleSave={(draft) => scheduleSave("sessions", draft)} t={t} />
    : pane === "workbench" ? <WorkbenchPane draft={workbench} setDraft={(value) => setWorkbench(value)} scheduleSave={(draft) => scheduleSave("workbench", draft)} t={t} />
    : pane === "notes" ? <NotesPane draft={notes} setDraft={setNotes} scheduleSave={(draft) => scheduleSave("notes", draft)} t={t} />
    : pane === "report" ? (
      <ReportPane
        draft={report}
        setDraft={(value) => setReport(value)}
        scheduleSave={(draft) => scheduleSave("report", draft)}
        t={t}
        onOpenScheduleLog={() => {
          setUsageDetailTab("schedule");
          setPane("usage");
        }}
      />
    )
    : pane === "storage" ? <StoragePane draft={storage} setDraft={(value) => setStorage(value)} scheduleSave={(draft) => scheduleSave("storage", draft)} t={t} />
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
              onClick={() => {
                if (item.id !== "usage") {
                  setUsageDetailTab(undefined);
                }
                setPane(item.id);
              }}
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
          <div className="form settings-form">
            <div
              className={`settings-pane${pane === "usage" || pane === "logs" ? " settings-pane-usage" : pane === "about" ? " settings-pane-about" : ""}`}
            >
              {pane === "usage" || pane === "logs" || pane === "about" ? body : <div className="settings-pane-body">{body}</div>}
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

function GeneralPane({ draft, setDraft, scheduleSave, t }: { draft: GeneralDraft; setDraft: (value: GeneralDraft) => void; scheduleSave: (draft: GeneralDraft) => void; t: (key: string, ...args: Array<string | number>) => string }) {
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
    setDraft(next); preview(next); scheduleSave(next);
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
  </>;
}

type ModelTestKind = "tool" | "chat" | "embedding";

function ModelsPane({ draft, setDraft, scheduleSave, t }: { draft: ModelsDraft; setDraft: (value: ModelsDraft) => void; scheduleSave: (draft: ModelsDraft) => void; t: (key: string, ...args: Array<string | number>) => string }) {
  const [testing, setTesting] = useState<ModelTestKind | null>(null);
  const [testStatus, setTestStatus] = useState<Partial<Record<ModelTestKind, { text: string; kind?: StatusKind }>>>({});
  const [revealedApiKeys, setRevealedApiKeys] = useState<Partial<Record<ModelsApiKeyField, boolean>>>({});
  const update = <K extends keyof ModelsDraft>(key: K, value: ModelsDraft[K]) => { const next = { ...draft, [key]: value }; setDraft(next); scheduleSave(next); };
  const toggleApiKeyReveal = (key: ModelsApiKeyField) => {
    setRevealedApiKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const fields = (items: ReadonlyArray<readonly [ModelsFieldKey, string, "text" | "password"]>) =>
    items.map(([key, label, type]) => {
      if (type !== "password") {
        return (
          <label className="settings-field" key={key}>
            <span className="settings-field-label">{t(label)}</span>
            <input type="text" value={draft[key]} onChange={(event) => update(key, event.target.value)} />
          </label>
        );
      }
      const apiKey = key as ModelsApiKeyField;
      const revealed = Boolean(revealedApiKeys[apiKey]);
      const revealLabel = revealed ? t("desktop.settings.hideApiKey") : t("desktop.settings.showApiKey");
      return (
        <label className="settings-field" key={key}>
          <span className="settings-field-label">{t(label)}</span>
          <span className="settings-field-input-wrap">
            <input
              type={revealed ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={draft[key]}
              onChange={(event) => update(key, event.target.value)}
              data-testid={`settings-api-key-${apiKey}`}
            />
            <button
              type="button"
              className="settings-field-reveal notes-icon-btn"
              data-testid={`settings-api-key-reveal-${apiKey}`}
              aria-label={revealLabel}
              aria-pressed={revealed}
              title={revealLabel}
              onClick={(event) => {
                event.preventDefault();
                toggleApiKeyReveal(apiKey);
              }}
            >
              {revealed ? <ThemeIcon name="eye-off" size={15} aria-hidden="true" /> : <ThemeIcon name="eye" size={15} aria-hidden="true" />}
            </button>
          </span>
        </label>
      );
    });
  const runTest = async (kind: ModelTestKind) => {
    setTesting(kind);
    setTestStatus((prev) => ({ ...prev, [kind]: { text: t("desktop.settings.testConnectionTesting") } }));
    try {
      const result = await desktopApi().testModelConnection({ kind, draft });
      setTestStatus((prev) => ({
        ...prev,
        [kind]: { text: result.message, kind: result.ok ? "ok" : "error" }
      }));
    } catch (error) {
      setTestStatus((prev) => ({
        ...prev,
        [kind]: { text: error instanceof Error ? error.message : String(error), kind: "error" }
      }));
    } finally {
      setTesting(null);
    }
  };
  const testBlock = (kind: ModelTestKind) => {
    const status = testStatus[kind];
    const busy = testing === kind;
    return (
      <div className="settings-test-connection">
        <p className="settings-footnote">{t("desktop.settings.testConnectionHint")}</p>
        <button
          type="button"
          className="ghost-btn"
          data-testid={`settings-test-model-${kind}`}
          disabled={testing !== null}
          onClick={() => void runTest(kind)}
        >
          {busy ? t("desktop.settings.testConnectionTesting") : t("desktop.settings.testConnection")}
        </button>
        {status?.text ? <Status kind={status.kind}>{status.text}</Status> : null}
      </div>
    );
  };
  return <>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.toolLlm")}</h3><div className="settings-group-body"><p className="settings-footnote">{t("desktop.settings.toolLlmFootnote")}</p>{fields([["llmBaseUrl", "desktop.settings.baseUrl", "text"], ["llmModel", "desktop.settings.model", "text"], ["llmApiKey", "desktop.settings.apiKey", "password"]])}<label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{t("desktop.settings.outputLanguage")}</span><span className="settings-row-desc">{t("desktop.settings.fieldOutputLanguageDescription")}</span></span><select className="settings-row-control" value={draft.llmLang} onChange={(event) => update("llmLang", event.target.value as ModelsDraft["llmLang"])}><option value="auto">{t("desktop.settings.fieldOutputLanguageOptionAuto")}</option><option value="en">English</option><option value="zh-cn">简体中文</option><option value="ja">日本語</option></select></label>{testBlock("tool")}</div></section>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.chatLlm")}</h3><div className="settings-group-body"><p className="settings-footnote">{t("desktop.settings.chatModelFootnote")}</p>{fields([["chatBaseUrl", "desktop.settings.baseUrl", "text"], ["chatModel", "desktop.settings.model", "text"], ["chatApiKey", "desktop.settings.apiKey", "password"]])}{testBlock("chat")}</div></section>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.embedding")}</h3><div className="settings-group-body"><p className="settings-footnote">{t("desktop.settings.embeddingFootnote")}</p>{fields([["embBaseUrl", "desktop.settings.baseUrlOptional", "text"], ["embModel", "desktop.settings.model", "text"], ["embApiKey", "desktop.settings.apiKeyOptional", "password"]])}{testBlock("embedding")}</div></section>
  </>;
}

function SessionsPane({ draft, setDraft, scheduleSave, t }: { draft: SessionsDraft; setDraft: (value: SessionsDraft) => void; scheduleSave: (draft: SessionsDraft) => void; t: (key: string, ...args: Array<string | number>) => string }) {
  const update = <K extends keyof SessionsDraft>(key: K, value: SessionsDraft[K]) => { const next = { ...draft, [key]: value }; setDraft(next); scheduleSave(next); };
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
  </>;
}
