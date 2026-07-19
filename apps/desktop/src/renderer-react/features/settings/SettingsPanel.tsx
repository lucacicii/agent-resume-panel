import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelSettings } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { Status, type StatusKind } from "../../components/Status";
import { useI18n } from "../../i18n";
import { AboutPane, ReportPane, StoragePane, UsagePane, WorkbenchPane } from "./AdditionalPanes";
import {
  generalDraftFromSettings, generalPatch, modelsDraftFromSettings, modelsPatch, reportDraftFromSettings, reportPatch,
  sessionsDraftFromSettings, sessionsPatch, storageDraftFromSettings, storagePatch, workbenchDraftFromSettings, workbenchPatch,
  type GeneralDraft, type ModelsDraft, type ReportDraft, type SessionsDraft, type StorageDraft, type WorkbenchDraft
} from "./model";

type Pane = "general" | "models" | "sessions" | "workbench" | "report" | "storage" | "usage" | "about";
type Draft = GeneralDraft | ModelsDraft | SessionsDraft | WorkbenchDraft | ReportDraft | StorageDraft;

const panes: Array<{ id: Pane; key: string; desc: string }> = [
  { id: "general", key: "desktop.settings.paneGeneral", desc: "desktop.settings.paneGeneralDesc" },
  { id: "models", key: "desktop.settings.paneModels", desc: "desktop.settings.paneModelsDesc" },
  { id: "sessions", key: "desktop.settings.paneSessions", desc: "desktop.settings.paneSessionsDesc" },
  { id: "workbench", key: "desktop.settings.paneWorkbench", desc: "desktop.settings.paneWorkbenchDesc" },
  { id: "report", key: "desktop.settings.paneReport", desc: "desktop.settings.paneReportDesc" },
  { id: "storage", key: "desktop.settings.paneStorage", desc: "desktop.settings.paneStorageDesc" },
  { id: "usage", key: "desktop.settings.paneUsage", desc: "desktop.settings.paneUsageDesc" },
  { id: "about", key: "desktop.settings.paneAbout", desc: "desktop.settings.paneAboutDesc" }
];

function asPane(value: unknown): Pane {
  return panes.some((pane) => pane.id === value) ? value as Pane : "general";
}

export function SettingsPanel(): React.ReactPortal | null {
  const { t } = useI18n();
  const host = document.getElementById("react-settings");
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<Pane>("general");
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [general, setGeneral] = useState<GeneralDraft | null>(null);
  const [models, setModels] = useState<ModelsDraft | null>(null);
  const [sessions, setSessions] = useState<SessionsDraft | null>(null);
  const [workbench, setWorkbench] = useState<WorkbenchDraft | null>(null);
  const [report, setReport] = useState<ReportDraft | null>(null);
  const [storage, setStorage] = useState<StorageDraft | null>(null);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const timer = useRef<number | null>(null);

  const hydrate = useCallback((next: PanelSettings) => {
    setSettings(next);
    setGeneral(generalDraftFromSettings(next));
    setModels(modelsDraftFromSettings(next));
    setSessions(sessionsDraftFromSettings(next));
    setWorkbench(workbenchDraftFromSettings(next));
    setReport(reportDraftFromSettings(next));
    setStorage(storageDraftFromSettings(next));
  }, []);

  const load = useCallback(async () => hydrate(await desktopApi().getSettings()), [hydrate]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      setPane(asPane(event instanceof CustomEvent ? event.detail : "general"));
      setOpen(true);
      void load().catch((error: unknown) => setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }));
    };
    window.addEventListener("agent-resume:settings-open", onOpen);
    return () => {
      window.removeEventListener("agent-resume:settings-open", onOpen);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [load]);

  const save = useCallback(async (next: PanelSettings, section: Exclude<Pane, "usage" | "about">) => {
    setStatus({ text: t("desktop.settings.saving") });
    try {
      const result = await desktopApi().saveSettings(next, { triggerSync: section === "sessions" || section === "storage" });
      hydrate(result.settings);
      window.dispatchEvent(new CustomEvent("agent-resume:settings-saved", { detail: { settings: result.settings, section, sync: result.sync } }));
      setStatus({ text: t("desktop.settings.saved", result.schedulerEnabled ? t("desktop.settings.schedulerOn") : t("desktop.settings.schedulerOff")), kind: "ok" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, [hydrate, t]);

  const scheduleSave = (section: Exclude<Pane, "usage" | "about">, draft: Draft) => {
    if (!settings) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const patch = section === "general" ? generalPatch(settings, draft as GeneralDraft)
        : section === "models" ? modelsPatch(settings, draft as ModelsDraft)
        : section === "sessions" ? sessionsPatch(settings, draft as SessionsDraft)
        : section === "workbench" ? workbenchPatch(settings, draft as WorkbenchDraft)
        : section === "report" ? reportPatch(settings, draft as ReportDraft)
        : storagePatch(settings, draft as StorageDraft);
      void save({ ...settings, ...patch }, section);
    }, 450);
  };

  if (!host || !open || !settings || !general || !models || !sessions || !workbench || !report || !storage) return null;
  const current = panes.find((item) => item.id === pane) || panes[0];
  const close = () => { setOpen(false); window.dispatchEvent(new Event("agent-resume:settings-closed")); };
  const body = pane === "general" ? <GeneralPane draft={general} setDraft={(value) => setGeneral(value)} scheduleSave={(draft) => scheduleSave("general", draft)} t={t} />
    : pane === "models" ? <ModelsPane draft={models} setDraft={(value) => setModels(value)} scheduleSave={(draft) => scheduleSave("models", draft)} t={t} />
    : pane === "sessions" ? <SessionsPane draft={sessions} setDraft={(value) => setSessions(value)} scheduleSave={(draft) => scheduleSave("sessions", draft)} t={t} />
    : pane === "workbench" ? <WorkbenchPane draft={workbench} setDraft={(value) => setWorkbench(value)} scheduleSave={(draft) => scheduleSave("workbench", draft)} t={t} />
    : pane === "report" ? <ReportPane draft={report} setDraft={(value) => setReport(value)} scheduleSave={(draft) => scheduleSave("report", draft)} t={t} />
    : pane === "storage" ? <StoragePane draft={storage} setDraft={(value) => setStorage(value)} scheduleSave={(draft) => scheduleSave("storage", draft)} t={t} />
    : pane === "usage" ? <UsagePane t={t} /> : <AboutPane t={t} />;

  return createPortal(<section className="panel active react-settings-panel"><div className="toolbar"><h2 className="quiet-title">{t("desktop.settings.title")}</h2><button type="button" className="ghost-btn" onClick={close}>{t("desktop.settings.done")}</button></div><div className="settings-layout"><aside className="settings-nav" aria-label={t("desktop.settings.navLabel")}>{panes.map((item) => <button type="button" className={`settings-nav-item${pane === item.id ? " active" : ""}`} key={item.id} onClick={() => setPane(item.id)}>{t(item.key)}</button>)}</aside><div className="settings-main"><header className="settings-content-header"><div className="settings-content-header-text"><h2 className="settings-pane-title">{t(current.key)}</h2><p className="settings-pane-desc">{t(current.desc)}</p></div>{pane !== "usage" && pane !== "about" ? <div className="settings-header-actions"><Status kind={status.kind}>{status.text}</Status></div> : null}</header><div className="form settings-form"><div className={`settings-pane${pane === "usage" ? " settings-pane-usage" : pane === "about" ? " settings-pane-about" : ""}`}>{pane === "usage" || pane === "about" ? body : <div className="settings-pane-body">{body}</div>}</div></div>{pane === "usage" || pane === "about" ? <div className="settings-header-actions react-settings-status"><Status kind={status.kind}>{status.text}</Status></div> : null}</div></div></section>, host);
}

function GeneralPane({ draft, setDraft, scheduleSave, t }: { draft: GeneralDraft; setDraft: (value: GeneralDraft) => void; scheduleSave: (draft: GeneralDraft) => void; t: (key: string, ...args: Array<string | number>) => string }) {
  const update = <K extends keyof GeneralDraft>(key: K, value: GeneralDraft[K]) => { const next = { ...draft, [key]: value }; setDraft(next); if (key === "desktopTheme") window.dispatchEvent(new CustomEvent("agent-resume:theme-change", { detail: value })); scheduleSave(next); };
  return <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.appearance")}</h3><div className="settings-group-body"><label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{t("desktop.settings.theme")}</span><span className="settings-row-desc">{t("desktop.settings.themeDesc")}</span></span><select className="settings-row-control" value={draft.desktopTheme} onChange={(event) => update("desktopTheme", event.target.value as GeneralDraft["desktopTheme"])}><option value="system">{t("desktop.settings.themeSystem")}</option><option value="light">{t("desktop.settings.themeLight")}</option><option value="dark">{t("desktop.settings.themeDark")}</option></select></label><label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">UI Language</span><span className="settings-row-desc">{t("desktop.settings.fieldUiLanguageDescription")}</span></span><select className="settings-row-control" value={draft.uiLanguage} onChange={(event) => update("uiLanguage", event.target.value as GeneralDraft["uiLanguage"])}><option value="auto">{t("desktop.settings.fieldUiLanguageOptionAuto")}</option><option value="en">English</option><option value="zh-cn">简体中文</option><option value="ja">日本語</option></select></label></div></section>;
}

function ModelsPane({ draft, setDraft, scheduleSave, t }: { draft: ModelsDraft; setDraft: (value: ModelsDraft) => void; scheduleSave: (draft: ModelsDraft) => void; t: (key: string, ...args: Array<string | number>) => string }) {
  const update = <K extends keyof ModelsDraft>(key: K, value: ModelsDraft[K]) => { const next = { ...draft, [key]: value }; setDraft(next); scheduleSave(next); };
  const fields = [["llmBaseUrl", "desktop.settings.baseUrl", "text"], ["llmModel", "desktop.settings.model", "text"], ["llmApiKey", "desktop.settings.apiKey", "password"], ["chatBaseUrl", "desktop.settings.baseUrl", "text"], ["chatModel", "desktop.settings.chatModel", "text"], ["chatApiKey", "desktop.settings.apiKey", "password"], ["embBaseUrl", "desktop.settings.baseUrlOptional", "text"], ["embModel", "desktop.settings.model", "text"], ["embApiKey", "desktop.settings.apiKeyOptional", "password"]] as const;
  return <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.toolLlm")}</h3><div className="settings-group-body">{fields.map(([key, label, type]) => <label className="settings-field" key={key}><span className="settings-field-label">{t(label)}</span><input type={type} value={draft[key]} onChange={(event) => update(key, event.target.value)} /></label>)}<label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{t("desktop.settings.outputLanguage")}</span><span className="settings-row-desc">{t("desktop.settings.fieldOutputLanguageDescription")}</span></span><select className="settings-row-control" value={draft.llmLang} onChange={(event) => update("llmLang", event.target.value as ModelsDraft["llmLang"])}><option value="auto">{t("desktop.settings.fieldOutputLanguageOptionAuto")}</option><option value="en">English</option><option value="zh-cn">简体中文</option><option value="ja">日本語</option></select></label></div></section>;
}

function SessionsPane({ draft, setDraft, scheduleSave, t }: { draft: SessionsDraft; setDraft: (value: SessionsDraft) => void; scheduleSave: (draft: SessionsDraft) => void; t: (key: string, ...args: Array<string | number>) => string }) {
  const update = <K extends keyof SessionsDraft>(key: K, value: SessionsDraft[K]) => { const next = { ...draft, [key]: value }; setDraft(next); scheduleSave(next); };
  const toggles = [["showArchivedCodex", "desktop.settings.showArchivedCodex"], ["showSubagentCodex", "desktop.settings.showSubagentCodex"], ["showArchivedOpenCode", "desktop.settings.showArchivedOpenCode"], ["showSubagentGrok", "desktop.settings.showSubagentGrok"], ["hideCronAlma", "desktop.settings.hideCronAlma"], ["hideChannelAlma", "desktop.settings.hideChannelAlma"], ["showIncognitoAlma", "desktop.settings.showIncognitoAlma"]] as const;
  return <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.sync")}</h3><div className="settings-group-body"><label className="settings-field"><span className="settings-field-label">{t("desktop.settings.syncMax")}</span><input type="number" min="1" max="50000" value={draft.maxItems} onChange={(event) => update("maxItems", Number(event.target.value))} /></label><label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{t("desktop.settings.stalePolicy")}</span><span className="settings-row-desc">{t("desktop.settings.stalePolicyDesc")}</span></span><select className="settings-row-control" value={draft.stalePolicy} onChange={(event) => update("stalePolicy", event.target.value === "purge" ? "purge" : "off")}><option value="off">{t("desktop.settings.staleOff")}</option><option value="purge">{t("desktop.settings.stalePurge")}</option></select></label>{toggles.map(([key, label]) => <label className="settings-row" key={key}><span className="settings-row-label"><span className="settings-row-title">{t(label)}</span></span><span className="settings-toggle"><input type="checkbox" role="switch" checked={draft[key]} onChange={(event) => update(key, event.target.checked)} /><span className="settings-toggle-track" aria-hidden="true" /></span></label>)}</div></section>;
}
