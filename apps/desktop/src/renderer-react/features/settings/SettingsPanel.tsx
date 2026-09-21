import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { NativeMenuSelect } from "../../components/NativeMenuSelect";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { appearanceStateFromSettings } from "../../themes";
import type { AiProvider, ModelKind, ModelSelection, PanelSettings, ProviderModel } from "@agent-resume/core";
import { listProviderModels } from "./providerPool";
import { desktopApi } from "../../bridge";
import { Status, type StatusKind } from "../../components/Status";
import { useI18n } from "../../i18n";
import { confirmAction, confirmDestructive } from "../../confirmAction";
import { AboutPane, BackupPane, LogsPane, NotesPane, StoragePane, UsagePane, WorkbenchPane, type UsageDetailTab } from "./AdditionalPanes";
import { SelectionSettingsPane } from "./SelectionSettingsPane";
import { AgentStatusPane } from "./AgentStatusPane";
import { McpPane } from "./McpPane";
import {
  embeddingSearchIdentityChanged,
  generalDraftFromSettings,
  generalPatch,
  providersDraftFromSettings,
  providersPatch,
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
  type SessionsDraft,
  type StorageDraft,
  type WorkbenchDraft
} from "./model";

type Pane = "general" | "providers" | "sessions" | "workbench" | "selection" | "notes" | "storage" | "mcp" | "agentStatus" | "usage" | "logs" | "backup" | "about";
type EditablePane = Exclude<Pane, "mcp" | "usage" | "logs" | "backup" | "about" | "selection" | "agentStatus">;

type EditableDraft = GeneralDraft | ProvidersDraft | SessionsDraft | WorkbenchDraft | NotesDraft | StorageDraft;

function savedDraftFor(section: EditablePane, base: PanelSettings): EditableDraft {
  return section === "general" ? generalDraftFromSettings(base)
    : section === "providers" ? providersDraftFromSettings(base)
    : section === "sessions" ? sessionsDraftFromSettings(base)
    : section === "workbench" ? workbenchDraftFromSettings(base)
    : section === "notes" ? notesDraftFromSettings(base)
    : storageDraftFromSettings(base);
}

function sectionPatch(section: EditablePane, base: PanelSettings, draft: EditableDraft): Partial<PanelSettings> {
  return section === "general" ? generalPatch(base, draft as GeneralDraft)
    : section === "providers" ? providersPatch(base, draft as ProvidersDraft)
    : section === "sessions" ? sessionsPatch(base, draft as SessionsDraft)
    : section === "workbench" ? workbenchPatch(base, draft as WorkbenchDraft)
    : section === "notes" ? notesPatch(base, draft as NotesDraft)
    : storagePatch(base, draft as StorageDraft);
}

type SettingsPanelProps = {
  /** Pane to select when the window opens (from `?pane=`). */
  initialPane?: string;
};

const panes: Array<{ id: Pane; key: string; desc: string }> = [
  { id: "general", key: "desktop.settings.paneGeneral", desc: "desktop.settings.paneGeneralDesc" },
  { id: "providers", key: "desktop.settings.paneProviders", desc: "desktop.settings.paneProvidersDesc" },
  { id: "sessions", key: "desktop.settings.paneSessions", desc: "desktop.settings.paneSessionsDesc" },
  { id: "workbench", key: "desktop.settings.paneWorkbench", desc: "desktop.settings.paneWorkbenchDesc" },
  { id: "selection", key: "desktop.settings.paneSelection", desc: "desktop.settings.paneSelectionDesc" },
  { id: "notes", key: "desktop.settings.paneNotes", desc: "desktop.settings.paneNotesDesc" },
  { id: "storage", key: "desktop.settings.paneStorage", desc: "desktop.settings.paneStorageDesc" },
  { id: "mcp", key: "desktop.settings.paneMcp", desc: "desktop.settings.paneMcpDesc" },
  { id: "agentStatus", key: "desktop.settings.paneAgentStatus", desc: "desktop.settings.paneAgentStatusDesc" },
  { id: "usage", key: "desktop.settings.paneUsage", desc: "desktop.settings.paneUsageDesc" },
  { id: "logs", key: "desktop.settings.paneLogs", desc: "desktop.settings.paneLogsDesc" },
  { id: "backup", key: "desktop.settings.paneBackup", desc: "desktop.settings.paneBackupDesc" },
  { id: "about", key: "desktop.settings.paneAbout", desc: "desktop.settings.paneAboutDesc" }
];

function asPane(value: unknown): Pane {
  return panes.some((pane) => pane.id === value) ? value as Pane : "general";
}

export function SettingsPanel({
  initialPane
}: SettingsPanelProps): React.ReactPortal | null {
  const { t } = useI18n();
  const host = document.getElementById("react-settings");
  const [pane, setPane] = useState<Pane>(() => asPane(initialPane));
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [general, setGeneral] = useState<GeneralDraft | null>(null);
  const [providers, setProviders] = useState<ProvidersDraft | null>(null);
  const [sessions, setSessions] = useState<SessionsDraft | null>(null);
  const [workbench, setWorkbench] = useState<WorkbenchDraft | null>(null);
  const [storage, setStorage] = useState<StorageDraft | null>(null);
  const [notes, setNotes] = useState<NotesDraft | null>(null);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [usageDetailTab, setUsageDetailTab] = useState<UsageDetailTab | undefined>(undefined);
  const lastSavedSettings = useRef<PanelSettings | null>(null);
  const settingsRef = useRef<PanelSettings | null>(null);
  const saveChain = useRef(Promise.resolve());
  /** Draft snapshot already persisted server-side, used to skip no-op commits. */
  const syncedDraftRef = useRef<Record<EditablePane, string> | null>(null);

  /** Reset every pane draft from `next`, keeping edits made after `committed` was queued. */
  const applySaved = useCallback((next: PanelSettings, committed?: { section: EditablePane; draft: EditableDraft }) => {
    lastSavedSettings.current = next;
    settingsRef.current = next;
    setSettings(next);
    const syncedDraft = (section: EditablePane): EditableDraft =>
      committed?.section === section ? committed.draft : savedDraftFor(section, next);
    syncedDraftRef.current = {
      general: JSON.stringify(syncedDraft("general")),
      providers: JSON.stringify(syncedDraft("providers")),
      sessions: JSON.stringify(syncedDraft("sessions")),
      workbench: JSON.stringify(syncedDraft("workbench")),
      notes: JSON.stringify(syncedDraft("notes")),
      storage: JSON.stringify(syncedDraft("storage"))
    };
    const keepIfEdited = <D,>(section: EditablePane, prev: D | null, freshDraft: D): D =>
      committed?.section === section && prev !== null && JSON.stringify(prev) !== JSON.stringify(committed.draft)
        ? prev
        : freshDraft;
    setGeneral((prev) => keepIfEdited("general", prev, generalDraftFromSettings(next)));
    setProviders((prev) => keepIfEdited("providers", prev, providersDraftFromSettings(next)));
    setSessions((prev) => keepIfEdited("sessions", prev, sessionsDraftFromSettings(next)));
    setWorkbench((prev) => keepIfEdited("workbench", prev, workbenchDraftFromSettings(next)));
    setNotes((prev) => keepIfEdited("notes", prev, notesDraftFromSettings(next)));
    setStorage((prev) => keepIfEdited("storage", prev, storageDraftFromSettings(next)));
  }, []);

  const hydrate = useCallback((next: PanelSettings) => applySaved(next), [applySaved]);

  const load = useCallback(async () => hydrate(await desktopApi().getSettings()), [hydrate]);

  const applyOpen = useCallback((nextPane: unknown) => {
    setPane(asPane(nextPane));
    void load().catch((error: unknown) =>
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" })
    );
  }, [load]);

  // The window loads its own data on mount: it is opened by the main process, so
  // there is no "open" event to wait for.
  useEffect(() => {
    void load().catch((error: unknown) =>
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" })
    );
  }, [load]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      applyOpen(event instanceof CustomEvent ? event.detail : "general");
    };
    window.addEventListener("agent-resume:settings-open", onOpen);
    const stopNavigate =
      typeof desktopApi().onSettingsNavigate === "function"
        ? desktopApi().onSettingsNavigate((payload) => applyOpen(payload?.pane))
        : () => undefined;
    return () => {
      window.removeEventListener("agent-resume:settings-open", onOpen);
      stopNavigate();
    };
  }, [applyOpen]);

  /**
   * Auto-save one pane draft. Commits run sequentially so rapid edits never
   * overwrite each other with a stale snapshot; no-op edits are skipped.
   */
  const performCommit = useCallback(async (section: EditablePane, nextDraft: EditableDraft) => {
    const base = settingsRef.current;
    if (!base) return;
    if (JSON.stringify(nextDraft) === syncedDraftRef.current?.[section]) return;
    const patch = sectionPatch(section, base, nextDraft);
    if (JSON.stringify({ ...base, ...patch }) === JSON.stringify(base)) return;
    if (section === "providers" && embeddingSearchIdentityChanged(base, nextDraft as ProvidersDraft)) {
      if (!(await confirmAction(t("desktop.settings.embeddingModelChangeConfirm")))) {
        setProviders(providersDraftFromSettings(base));
        setStatus({ text: t("desktop.settings.embeddingModelChangeCancelled"), kind: "error" });
        return;
      }
    }
    setStatus({ text: t("desktop.settings.saving") });
    try {
      const result = await desktopApi().saveSettings({ ...base, ...patch }, {
        triggerSync: section === "sessions" || section === "storage",
        section
      });
      applySaved(result.settings, { section, draft: nextDraft });
      setStatus({ text: t("desktop.settings.saved", ""), kind: "ok" });
    } catch (error) {
      const last = lastSavedSettings.current;
      if (last) {
        if (section === "general") {
          setGeneral(generalDraftFromSettings(last));
          window.dispatchEvent(new CustomEvent("agent-resume:appearance-change", {
            detail: appearanceStateFromSettings(last)
          }));
        } else if (section === "providers") setProviders(providersDraftFromSettings(last));
        else if (section === "sessions") setSessions(sessionsDraftFromSettings(last));
        else if (section === "workbench") setWorkbench(workbenchDraftFromSettings(last));
        else if (section === "notes") setNotes(notesDraftFromSettings(last));
        else setStorage(storageDraftFromSettings(last));
      }
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, [applySaved, t]);

  const commit = useCallback((section: EditablePane, nextDraft: EditableDraft) => {
    saveChain.current = saveChain.current.then(() => performCommit(section, nextDraft));
  }, [performCommit]);


  const requestPaneChange = useCallback((next: Pane) => {
    if (next === pane) return;
    if (next !== "usage") setUsageDetailTab(undefined);
    setPane(next);
  }, [pane]);

  const doClose = useCallback(() => {
    window.dispatchEvent(new Event("agent-resume:settings-closed"));
  }, []);

  const requestClose = useCallback(() => {
    // Blur the focused control first so an input commits before the panel closes.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    doClose();
    window.close();
  }, [doClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

  if (!host || !settings || !general || !providers || !sessions || !workbench || !notes || !storage) return null;
  const current = panes.find((item) => item.id === pane) || panes[0];
  const body = pane === "general" ? <GeneralPane draft={general} setDraft={setGeneral} commit={(value) => commit("general", value)} t={t} />
    : pane === "providers" ? <ProvidersPane draft={providers} setDraft={setProviders} commit={(value) => commit("providers", value)} t={t} />
    : pane === "sessions" ? <SessionsPane draft={sessions} setDraft={setSessions} commit={(value) => commit("sessions", value)} t={t} />
    : pane === "workbench" ? <WorkbenchPane draft={workbench} setDraft={setWorkbench} commit={(value) => commit("workbench", value)} t={t} />
    : pane === "selection" ? <SelectionSettingsPane t={t} />
    : pane === "notes" ? <NotesPane draft={notes} setDraft={setNotes} commit={(value) => commit("notes", value)} t={t} />
    : pane === "storage" ? <StoragePane draft={storage} setDraft={setStorage} commit={(value) => commit("storage", value)} t={t} />
    : pane === "mcp" ? <McpPane t={t} />
    : pane === "agentStatus" ? <AgentStatusPane t={t} />
    : pane === "usage" ? <UsagePane t={t} initialDetailTab={usageDetailTab} />
    : pane === "logs" ? <LogsPane t={t} />
    : pane === "backup" ? <BackupPane t={t} /> : <AboutPane t={t} />;

  return createPortal(
    <div className="settings-window" aria-label={t("desktop.settings.title")}>
      <section className="panel active react-settings-panel">
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
                    <div className="form settings-form">
            <div
              className={`settings-pane${pane === "usage" || pane === "logs" ? " settings-pane-usage" : pane === "about" ? " settings-pane-about" : ""}`}
            >
              {pane === "usage" || pane === "logs" || pane === "about" || pane === "mcp" || pane === "backup" || pane === "agentStatus" ? body : <div className="settings-pane-body">{body}</div>}
            </div>
          </div>
          {pane === "about" ? (
            <div className="settings-header-actions react-settings-status">
              <Status kind={status.kind}>{status.text}</Status>
            </div>
          ) : null}
        </div>
      </div>
    </section>
    </div>,
    host
  );
}

function GeneralPane({ draft, setDraft, commit, t }: { draft: GeneralDraft; setDraft: (value: GeneralDraft) => void; commit: (value: GeneralDraft) => void; t: (key: string, ...args: Array<string | number>) => string }) {
  const preview = (next: GeneralDraft) => window.dispatchEvent(new CustomEvent("agent-resume:appearance-change", {
    detail: appearanceStateFromSettings({ desktop: { theme: next.desktopTheme } })
  }));
  const update = <K extends keyof GeneralDraft>(key: K, value: GeneralDraft[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next); preview(next); commit(next);
  };
  return <>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.appearance")}</h3><div className="settings-group-body">
      <div className="settings-theme-field"><span className="settings-field-label">{t("desktop.settings.theme")}</span><span className="settings-field-desc muted">{t("desktop.settings.themeDesc")}</span><div className="theme-mode-control" role="radiogroup" aria-label={t("desktop.settings.theme")}>{(["system", "light", "dark"] as const).map((mode) => <button type="button" role="radio" aria-checked={draft.desktopTheme === mode} className={draft.desktopTheme === mode ? "is-selected" : ""} key={mode} onClick={() => update("desktopTheme", mode)}>{t(mode === "system" ? "desktop.settings.themeSystem" : mode === "light" ? "desktop.settings.themeLight" : "desktop.settings.themeDark")}</button>)}</div></div>
      <label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">UI Language</span><span className="settings-row-desc">{t("desktop.settings.fieldUiLanguageDescription")}</span></span><NativeMenuSelect className="settings-row-control" ariaLabel="UI Language" title="UI Language" value={draft.uiLanguage} options={[{ value: "auto", label: t("desktop.settings.fieldUiLanguageOptionAuto") }, { value: "en", label: "English" }, { value: "zh-cn", label: "简体中文" }, { value: "ja", label: "日本語" }]} onChange={(value) => update("uiLanguage", value as GeneralDraft["uiLanguage"])} /></label>
    </div></section>
    <section className="settings-group"><h3 className="settings-group-title">{t("desktop.settings.notificationsGroup")}</h3><div className="settings-group-body"><label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{t("desktop.settings.notificationsAutoClear")}</span><span className="settings-row-desc">{t("desktop.settings.notificationsAutoClearDesc")}</span></span><NativeMenuSelect className="settings-row-control" ariaLabel={t("desktop.settings.notificationsAutoClear")} title={t("desktop.settings.notificationsAutoClear")} value={String(draft.notifications.autoClearMinutes)} options={[{ value: "15", label: t("desktop.settings.autoClearMinutes.15") }, { value: "30", label: t("desktop.settings.autoClearMinutes.30") }, { value: "60", label: t("desktop.settings.autoClearMinutes.60") }, { value: "240", label: t("desktop.settings.autoClearMinutes.240") }, { value: "1440", label: t("desktop.settings.autoClearMinutes.1440") }, { value: "0", label: t("desktop.settings.autoClearMinutes.0") }]} onChange={(value) => update("notifications", { ...draft.notifications, autoClearMinutes: Number(value) })} /></label></div></section>
  </>;
}


type ModelTestKind = "text" | "embedding";

function ProvidersPane({ draft, setDraft, commit, t }: { draft: ProvidersDraft; setDraft: (value: ProvidersDraft) => void; commit: (value: ProvidersDraft) => void; t: (key: string, ...args: Array<string | number>) => string }) {
  const [selectedProviderId, setSelectedProviderId] = useState(draft.providers[0]?.id ?? "");
  const [testKind, setTestKind] = useState<ModelTestKind>("text");
  const [testing, setTesting] = useState<ModelTestKind | null>(null);
  const [testStatus, setTestStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedByProvider, setFetchedByProvider] = useState<Record<string, ProviderModel[]>>({});
  const [revealedApiKey, setRevealedApiKey] = useState(false);
  const [newModelId, setNewModelId] = useState("");
  const [newModelKind, setNewModelKind] = useState<ModelKind>("text");

  /** Immediate controls commit right away; text inputs pass `{ commit: false }` and commit on blur. */
  const update = <K extends keyof ProvidersDraft>(key: K, value: ProvidersDraft[K], options?: { commit?: boolean }) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (options?.commit !== false) commit(next);
  };

  const poolAsSettings = draft.providers;
  const poolFor = (kind: ModelKind) => listProviderModels(poolAsSettings, kind);

  const selectedProvider = draft.providers.find((entry) => entry.id === selectedProviderId) ?? draft.providers[0] ?? null;

  const patchProvider = (providerId: string, patch: (provider: AiProvider) => AiProvider, options?: { commit?: boolean }) => {
    update("providers", draft.providers.map((entry) => entry.id === providerId ? patch({ ...entry, models: [...entry.models] }) : entry), options);
  };

  const addProvider = () => {
    const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `provider-${Date.now()}`;
    const provider: AiProvider = { id, name: t("desktop.settings.providerNewName"), baseUrl: "https://api.openai.com/v1", models: [] };
    update("providers", [...draft.providers, provider]);
    setSelectedProviderId(id);
  };

  const removeProvider = async (providerId: string) => {
    if (!(await confirmDestructive(t("desktop.settings.providerRemoveConfirm"), t("desktop.common.remove")))) return;
    const providers = draft.providers.filter((entry) => entry.id !== providerId);
    const clearIfSelected = (selection: ModelSelection) => selection.providerId === providerId ? {} : selection;
    const next = {
      ...draft,
      providers,
      toolSelection: clearIfSelected(draft.toolSelection),
      chatSelection: clearIfSelected(draft.chatSelection),
      embeddingSelection: clearIfSelected(draft.embeddingSelection),
      imageSelection: clearIfSelected(draft.imageSelection),
      gitCommitSelection: clearIfSelected(draft.gitCommitSelection),
      sessionRenameSelection: clearIfSelected(draft.sessionRenameSelection),
      sessionSummarySelection: clearIfSelected(draft.sessionSummarySelection),
      reportSelection: clearIfSelected(draft.reportSelection),
      gtdSelection: clearIfSelected(draft.gtdSelection),
      translateSelection: clearIfSelected(draft.translateSelection)
    };
    setDraft(next);
    commit(next);
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
      const textKeys = [
        "toolSelection",
        "chatSelection",
        "gitCommitSelection",
        "sessionRenameSelection",
        "sessionSummarySelection",
        "reportSelection",
        "gtdSelection",
        "translateSelection"
      ] as const;
      for (const key of textKeys) {
        if (!draft[key]?.providerId) {
          nextDraft[key] = { providerId: selectedProvider.id, modelId: id };
        }
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
    commit(nextDraft);
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
    onChange: (value: ModelSelection) => void,
    placeholderOverride?: string,
    testIdOverride?: string
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
          <NativeMenuSelect
            className="settings-row-control"
            testId={testIdOverride || `settings-model-select-${kind}`}
            ariaLabel={t(labelKey)}
            title={t(labelKey)}
            value={value}
            options={[
              { value: "", label: placeholderOverride || t("desktop.settings.modelPlaceholder") },
              ...options.map((option) => ({ value: `${option.providerId}:${option.modelId}`, label: `${option.providerName} / ${option.modelId}` }))
            ]}
            onChange={(next) => {
              if (!next) {
                onChange({});
                return;
              }
              const [providerId, modelId] = next.split(":");
              onChange({ providerId: providerId || undefined, modelId: modelId || undefined });
            }}
          />
        ) : (
          <span className="settings-row-control settings-row-hint">{emptyHint}</span>
        )}
      </label>
    );
  };

  const modelCount = selectedProvider?.models.length ?? 0;
  return <>
    <section className="settings-group">
      <div className="settings-group-header">
        <h3 className="settings-group-title">{t("desktop.settings.providerList")}</h3>
        <button
          type="button"
          className="ghost-btn"
          data-testid="settings-add-provider"
          onClick={addProvider}
        >
          + {t("desktop.settings.providerAdd")}
        </button>
      </div>
      <div className="settings-group-body">
        <div className="settings-provider-layout">
          <aside className="settings-provider-list" aria-label={t("desktop.settings.providerListLabel")}>
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
                onClick={() => void removeProvider(provider.id)}
              >
                <ThemeIcon name="trash" size={ICON_SIZE.dense} aria-hidden="true" />
              </button>
            </div>
          ))
        )}
      </aside>
      <div className="settings-provider-detail">
            {selectedProvider ? (
              <>
                <label className="settings-field">
                  <span className="settings-field-label">{t("desktop.settings.providerName")}</span>
                  <input
                    type="text"
                    data-testid="settings-provider-name"
                    value={selectedProvider.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      patchProvider(selectedProvider.id, (provider) => ({ ...provider, name }), { commit: false });
                    }}
                    onBlur={() => commit(draft)}
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
                      patchProvider(selectedProvider.id, (provider) => ({ ...provider, baseUrl }), { commit: false });
                    }}
                    onBlur={() => commit(draft)}
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
                        patchProvider(selectedProvider.id, (provider) => ({ ...provider, apiKey }), { commit: false });
                      }}
                      onBlur={() => commit(draft)}
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
                      {revealedApiKey ? <ThemeIcon name="eye-off" size={ICON_SIZE.default} aria-hidden="true" /> : <ThemeIcon name="eye" size={ICON_SIZE.default} aria-hidden="true" />}
                    </button>
                  </span>
                </label>
                <div className="settings-provider-actions">
                  <NativeMenuSelect
                    className="settings-row-control settings-provider-test-kind"
                    testId="settings-provider-test-kind"
                    ariaLabel={t("desktop.settings.testConnectionKind")}
                    title={t("desktop.settings.testConnectionKind")}
                    value={testKind}
                    options={[
                      { value: "text", label: t("desktop.settings.modelKindText") },
                      { value: "embedding", label: t("desktop.settings.modelKindEmbedding") }
                    ]}
                    onChange={(value) => setTestKind(value as ModelTestKind)}
                  />
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
                <div className="settings-provider-models">
                  <span className="settings-field-label">{t("desktop.settings.providerModels")}</span>
                  <p className="settings-footnote">{t("desktop.settings.providerModelsFootnote")}</p>
                  {modelCount === 0 ? (
                  <p className="settings-footnote">{t("desktop.settings.providerNoModels")}</p>
                ) : (
                  <div className="settings-provider-models-list">
                    {selectedProvider.models.map((model) => (
                      <div className="settings-provider-model-row" key={model.id}>
                        <span className="settings-provider-model-kind">{kindLabel(model.kind)}</span>
                        <span className="settings-provider-model-id" title={model.id}>{model.id}</span>
                        <NativeMenuSelect
                          className="settings-row-control settings-provider-model-kind-select"
                          testId={`settings-provider-model-kind-${model.id}`}
                          ariaLabel={t("desktop.settings.modelKind")}
                          title={t("desktop.settings.modelKind")}
                          value={model.kind}
                          options={[
                            { value: "text", label: t("desktop.settings.modelKindText") },
                            { value: "image", label: t("desktop.settings.modelKindImage") },
                            { value: "embedding", label: t("desktop.settings.modelKindEmbedding") }
                          ]}
                          onChange={(value) => {
                            const kind = value as ModelKind;
                            patchProvider(selectedProvider.id, (provider) => ({
                              ...provider,
                              models: provider.models.map((entry) => entry.id === model.id ? { ...entry, kind } : entry)
                            }));
                          }}
                        />
                        <button
                          type="button"
                          className="settings-provider-remove"
                          data-testid={`settings-remove-model-${model.id}`}
                          aria-label={t("desktop.settings.modelRemove")}
                          title={t("desktop.settings.modelRemove")}
                          onClick={() => removeModel(model.id)}
                        >
                          <ThemeIcon name="trash" size={ICON_SIZE.dense} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="settings-provider-add-model">
                  {selectedProvider && (fetchedByProvider[selectedProvider.id] ?? []).filter((m) => !selectedProvider.models.some((existing) => existing.id === m.id)).length > 0 ? (
                    <NativeMenuSelect
                      className="settings-row-control settings-provider-add-model-select"
                      testId="settings-add-model-select"
                      ariaLabel={t("desktop.settings.selectFetchedModel", (fetchedByProvider[selectedProvider.id] ?? []).filter((m) => !selectedProvider.models.some((existing) => existing.id === m.id)).length)}
                      value={((fetchedByProvider[selectedProvider.id] ?? []).find((m) => m.id === newModelId)?.id) ?? ""}
                      options={[
                        { value: "", label: t("desktop.settings.selectFetchedModel", (fetchedByProvider[selectedProvider.id] ?? []).filter((m) => !selectedProvider.models.some((existing) => existing.id === m.id)).length) },
                        ...(fetchedByProvider[selectedProvider.id] ?? []).filter((m) => !selectedProvider.models.some((existing) => existing.id === m.id)).map((model) => ({ value: model.id, label: `${model.id} (${kindLabel(model.kind)})` }))
                      ]}
                      onChange={(value) => {
                        setNewModelId(value);
                        const matched = (fetchedByProvider[selectedProvider.id] ?? []).find((m) => m.id === value);
                        if (matched) setNewModelKind(matched.kind);
                      }}
                    />
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
                  <NativeMenuSelect
                    className="settings-row-control settings-provider-add-model-kind"
                    testId="settings-add-model-kind"
                    ariaLabel={t("desktop.settings.modelKind")}
                    title={t("desktop.settings.modelKind")}
                    value={newModelKind}
                    options={[
                      { value: "text", label: t("desktop.settings.modelKindText") },
                      { value: "image", label: t("desktop.settings.modelKindImage") },
                      { value: "embedding", label: t("desktop.settings.modelKindEmbedding") }
                    ]}
                    onChange={(value) => setNewModelKind(value as ModelKind)}
                  />
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
              </>
            ) : (
              <p className="settings-footnote">{t("desktop.settings.providerDetailEmpty")}</p>
            )}
          </div>
        </div>
      </div>
    </section>
    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.specificFeatureModels")}</h3>
      <div className="settings-group-body">
        <p className="settings-footnote">{t("desktop.settings.specificFeatureModelsFootnote")}</p>
        {selectionRow(
          "desktop.settings.chatModelUse",
          "desktop.settings.chatModelUseDesc",
          "text",
          draft.chatSelection,
          (value) => update("chatSelection", value),
          t("desktop.settings.modelPlaceholder"),
          "settings-model-select-chat"
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
          "desktop.settings.gitCommitModelUse",
          "desktop.settings.gitCommitModelUseDesc",
          "text",
          draft.gitCommitSelection,
          (value) => update("gitCommitSelection", value),
          t("desktop.settings.modelPlaceholder"),
          "settings-model-select-git-commit"
        )}
        {selectionRow(
          "desktop.settings.sessionRenameModelUse",
          "desktop.settings.sessionRenameModelUseDesc",
          "text",
          draft.sessionRenameSelection,
          (value) => update("sessionRenameSelection", value),
          t("desktop.settings.modelPlaceholder"),
          "settings-model-select-session-rename"
        )}
        {selectionRow(
          "desktop.settings.sessionSummaryModelUse",
          "desktop.settings.sessionSummaryModelUseDesc",
          "text",
          draft.sessionSummarySelection,
          (value) => update("sessionSummarySelection", value),
          t("desktop.settings.modelPlaceholder"),
          "settings-model-select-session-summary"
        )}
        {selectionRow(
          "desktop.settings.reportModelUse",
          "desktop.settings.reportModelUseDesc",
          "text",
          draft.reportSelection,
          (value) => update("reportSelection", value),
          t("desktop.settings.modelPlaceholder"),
          "settings-model-select-report"
        )}
        <label className="settings-row">
          <span className="settings-row-label">
            <span className="settings-row-title">{t("desktop.settings.outputLanguage")}</span>
            <span className="settings-row-desc">{t("desktop.settings.fieldOutputLanguageDescription")}</span>
          </span>
          <NativeMenuSelect className="settings-row-control" ariaLabel={t("desktop.settings.outputLanguage")} title={t("desktop.settings.outputLanguage")} value={draft.toolOutputLanguage} options={[{ value: "auto", label: t("desktop.settings.fieldOutputLanguageOptionAuto") }, { value: "en", label: "English" }, { value: "zh-cn", label: "简体中文" }, { value: "ja", label: "日本語" }]} onChange={(value) => update("toolOutputLanguage", value as typeof draft.toolOutputLanguage)} />
        </label>
        {selectionRow(
          "desktop.settings.gtdModelUse",
          "desktop.settings.gtdModelUseDesc",
          "text",
          draft.gtdSelection,
          (value) => update("gtdSelection", value),
          t("desktop.settings.modelPlaceholder"),
          "settings-model-select-gtd"
        )}
        {selectionRow(
          "desktop.settings.translateModelUse",
          "desktop.settings.translateModelUseDesc",
          "text",
          draft.translateSelection,
          (value) => update("translateSelection", value),
          t("desktop.settings.modelPlaceholder"),
          "settings-model-select-translate"
        )}
        {selectionRow(
          "desktop.settings.embeddingModelUse",
          "desktop.settings.embeddingModelUseDesc",
          "embedding",
          draft.embeddingSelection,
          (value) => update("embeddingSelection", value),
          t("desktop.settings.modelPlaceholder"),
          "settings-model-select-embedding"
        )}
        {selectionRow(
          "desktop.settings.imageModelUse",
          "desktop.settings.imageModelUseDesc",
          "image",
          draft.imageSelection,
          (value) => update("imageSelection", value),
          t("desktop.settings.modelPlaceholder"),
          "settings-model-select-image"
        )}
      </div>
    </section>
  </>;
}

function SessionsPane({ draft, setDraft, commit, t }: { draft: SessionsDraft; setDraft: (value: SessionsDraft) => void; commit: (value: SessionsDraft) => void; t: (key: string, ...args: Array<string | number>) => string }) {
  /** Number inputs commit on blur; every other control commits immediately. */
  const update = <K extends keyof SessionsDraft>(key: K, value: SessionsDraft[K], options?: { commit?: boolean }) => { const next = { ...draft, [key]: value }; setDraft(next); if (options?.commit !== false) commit(next); };
  const toggles = [["showArchivedCodex", "desktop.settings.showArchivedCodex"], ["showSubagentCodex", "desktop.settings.showSubagentCodex"], ["showArchivedOpenCode", "desktop.settings.showArchivedOpenCode"], ["showSubagentGrok", "desktop.settings.showSubagentGrok"]] as const;
  return <>
    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.sync")}</h3>
      <div className="settings-group-body">
        <label className="settings-field"><span className="settings-field-label">{t("desktop.settings.syncMax")}</span><input type="number" min="1" max="50000" value={draft.maxItems} onChange={(event) => update("maxItems", Number(event.target.value), { commit: false })} onBlur={() => commit(draft)} /></label>
        <label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{t("desktop.settings.stalePolicy")}</span><span className="settings-row-desc">{t("desktop.settings.stalePolicyDesc")}</span></span><NativeMenuSelect className="settings-row-control" ariaLabel={t("desktop.settings.stalePolicy")} title={t("desktop.settings.stalePolicy")} value={draft.stalePolicy} options={[{ value: "off", label: t("desktop.settings.staleOff") }, { value: "purge", label: t("desktop.settings.stalePurge") }]} onChange={(value) => update("stalePolicy", value === "purge" ? "purge" : "off")} /></label>
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
          <input type="number" min="0" max="1440" disabled={!draft.summaryAutoEnabled} value={draft.summaryStaleDelayMinutes} onChange={(event) => update("summaryStaleDelayMinutes", Number(event.target.value), { commit: false })} onBlur={() => commit(draft)} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.summaryMissingDelay")}</span>
          <span className="settings-field-hint">{t("desktop.settings.summaryMissingDelayHint")}</span>
          <input type="number" min="0" max="1440" disabled={!draft.summaryAutoEnabled} value={draft.summaryMissingDelayMinutes} onChange={(event) => update("summaryMissingDelayMinutes", Number(event.target.value), { commit: false })} onBlur={() => commit(draft)} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.summaryAutoMaxPerTick")}</span>
          <span className="settings-field-hint">{t("desktop.settings.summaryAutoMaxPerTickHint")}</span>
          <input type="number" min="1" max="50" disabled={!draft.summaryAutoEnabled} value={draft.summaryAutoMaxPerTick} onChange={(event) => update("summaryAutoMaxPerTick", Number(event.target.value), { commit: false })} onBlur={() => commit(draft)} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.summaryAutoConcurrency")}</span>
          <span className="settings-field-hint">{t("desktop.settings.summaryAutoConcurrencyHint")}</span>
          <input type="number" min="1" max="3" disabled={!draft.summaryAutoEnabled} value={draft.summaryAutoConcurrency} onChange={(event) => update("summaryAutoConcurrency", Number(event.target.value), { commit: false })} onBlur={() => commit(draft)} />
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
          <input type="number" min="0" max="1440" disabled={!draft.embeddingIndexEnabled} value={draft.embeddingQuietDelayMinutes} onChange={(event) => update("embeddingQuietDelayMinutes", Number(event.target.value), { commit: false })} onBlur={() => commit(draft)} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.embeddingIndexMaxPerTick")}</span>
          <span className="settings-field-hint">{t("desktop.settings.embeddingIndexMaxPerTickHint")}</span>
          <input type="number" min="1" max="50" disabled={!draft.embeddingIndexEnabled} value={draft.embeddingIndexMaxPerTick} onChange={(event) => update("embeddingIndexMaxPerTick", Number(event.target.value), { commit: false })} onBlur={() => commit(draft)} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.embeddingIndexConcurrency")}</span>
          <span className="settings-field-hint">{t("desktop.settings.embeddingIndexConcurrencyHint")}</span>
          <input type="number" min="1" max="4" disabled={!draft.embeddingIndexEnabled} value={draft.embeddingIndexConcurrency} onChange={(event) => update("embeddingIndexConcurrency", Number(event.target.value), { commit: false })} onBlur={() => commit(draft)} />
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
          <input type="number" min="0" max="1440" disabled={!draft.transcriptIndexEnabled} value={draft.transcriptQuietDelayMinutes} onChange={(event) => update("transcriptQuietDelayMinutes", Number(event.target.value), { commit: false })} onBlur={() => commit(draft)} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.transcriptIndexMaxPerTick")}</span>
          <span className="settings-field-hint">{t("desktop.settings.transcriptIndexMaxPerTickHint")}</span>
          <input type="number" min="1" max="20" disabled={!draft.transcriptIndexEnabled} value={draft.transcriptIndexMaxPerTick} onChange={(event) => update("transcriptIndexMaxPerTick", Number(event.target.value), { commit: false })} onBlur={() => commit(draft)} />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.transcriptIndexConcurrency")}</span>
          <span className="settings-field-hint">{t("desktop.settings.transcriptIndexConcurrencyHint")}</span>
          <input type="number" min="1" max="3" disabled={!draft.transcriptIndexEnabled} value={draft.transcriptIndexConcurrency} onChange={(event) => update("transcriptIndexConcurrency", Number(event.target.value), { commit: false })} onBlur={() => commit(draft)} />
        </label>
      </div>
    </section>
  </>;
}
