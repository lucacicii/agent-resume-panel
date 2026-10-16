import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { useCallback, useEffect, useState } from "react";
import { desktopApi } from "../../bridge";
import { Status, type StatusKind } from "../../components/Status";
import { confirmDestructive } from "../../confirmAction";
import type {
  ThunderModelInfo,
  ThunderModelsConfig,
  ThunderModelsProvider
} from "@agent-resume/core";
import type { ThunderDraft } from "./model";

type Translate = (key: string, ...args: Array<string | number>) => string;

export interface ThunderDaemonStatus {
  available: boolean;
  repoPath: string | null;
  daemonPath: string | null;
  tuiPath?: string | null;
  models: ThunderModelInfo[];
  source?: string;
  candidates?: string[];
  error?: string;
}
/**
 * Settings → Thunder: where the external Thunder daemon lives and whether the app
 * can actually run it. Discovery itself lives in `main/thunder/daemonResolver.ts`;
 * this pane only shows the outcome and stores explicit overrides.
 */
export function ThunderPane({ draft, setDraft, commit, t }: {
  draft: ThunderDraft;
  setDraft: (value: ThunderDraft) => void;
  commit: (value: ThunderDraft) => void;
  t: Translate;
}) {
  const [status, setStatus] = useState<ThunderDaemonStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind?: StatusKind }>({ text: "" });

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await desktopApi().thunderGetStatus());
      setMessage({ text: "" });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  // Saving settings restarts the daemon in the main process; re-check once it settles.
  useEffect(() => {
    const onSaved = () => { window.setTimeout(() => void check(), 500); };
    window.addEventListener("agent-resume:settings-saved", onSaved);
    return () => window.removeEventListener("agent-resume:settings-saved", onSaved);
  }, [check]);

  const update = (patch: Partial<ThunderDraft>, options?: { commit?: boolean }) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (options?.commit !== false) commit(next);
  };

  const browseRepo = async () => {
    if (typeof desktopApi().pickDirectory !== "function") return;
    const result = await desktopApi().pickDirectory({ title: t("desktop.settings.thunderRepoPath") });
    if (result.ok) update({ repoPath: result.path });
  };

  const available = Boolean(status?.available);
  const daemonPath = status?.daemonPath || "";
  const models = status?.models ?? [];
  // `none` is the resolver's "nothing matched" marker, not a discovery rule.
  const source = status?.source && status.source !== "none" ? status.source : "";
  const state = available
    ? t("desktop.settings.thunderStateOnline", models.length)
    : daemonPath
      ? t("desktop.settings.thunderStateNotRunning")
      : t("desktop.settings.thunderStateNotFound");

  return <>
    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.thunderStatusTitle")}</h3>
      <div className="settings-group-body">
        <div className="settings-thunder-hero">
          <div className="settings-thunder-hero-left">
            <span className={`settings-thunder-status-dot ${available ? "online" : "offline"}`} />
            <div>
              <div className="settings-thunder-hero-title">
                <span>{state}</span>
                {source ? <span className="settings-thunder-source-badge">{source}</span> : null}
              </div>
              <span className="settings-footnote muted">
                {source ? t("desktop.settings.thunderSource", source) : t("desktop.settings.thunderSourceUnknown")}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="tool-btn"
            aria-label={t("desktop.settings.thunderCheck")}
            disabled={checking}
            onClick={() => void check()}
          >
            <ThemeIcon name="refresh" size={ICON_SIZE.default} />
            {t("desktop.settings.thunderCheck")}
          </button>
        </div>

        <div className="settings-agent-status-grid">
          {daemonPath ? (
            <div className="settings-agent-status-stat-card">
              <span className="settings-agent-status-stat-label">{t("desktop.settings.thunderResolvedDaemon")}</span>
              <span className="settings-agent-status-stat-value settings-path-display" style={{ fontSize: "11px" }}>
                {daemonPath}
              </span>
            </div>
          ) : null}

          {status?.tuiPath ? (
            <div className="settings-agent-status-stat-card">
              <span className="settings-agent-status-stat-label">{t("desktop.settings.thunderResolvedTui")}</span>
              <span className="settings-agent-status-stat-value settings-path-display" style={{ fontSize: "11px" }}>
                {status.tuiPath}
              </span>
            </div>
          ) : null}

          {status?.repoPath ? (
            <div className="settings-agent-status-stat-card">
              <span className="settings-agent-status-stat-label">{t("desktop.settings.thunderResolvedRepo")}</span>
              <span className="settings-agent-status-stat-value settings-path-display" style={{ fontSize: "11px" }}>
                {status.repoPath}
              </span>
            </div>
          ) : null}

          {models.length ? (
            <div className="settings-agent-status-stat-card" style={{ gridColumn: "1 / -1" }}>
              <span className="settings-agent-status-stat-label">{t("desktop.settings.thunderModels")} ({models.length})</span>
              <span className="settings-agent-status-stat-value" style={{ fontSize: "12px", fontWeight: 400, flexWrap: "wrap" }}>
                {models.map((model) => model.selection_id || model.id).join(" · ")}
              </span>
            </div>
          ) : null}
        </div>

        {status?.error ? <Status kind="error">{status.error}</Status> : null}
        {message.text ? <Status kind={message.kind}>{message.text}</Status> : null}

        {!daemonPath && status?.candidates?.length ? (
          <details style={{ marginTop: "var(--space-2)" }}>
            <summary className="settings-footnote" style={{ cursor: "pointer", fontWeight: 500 }}>
              {t("desktop.settings.thunderCandidates", status.candidates.length)}
            </summary>
            <ul className="settings-footnote" style={{ marginTop: "var(--space-1)" }}>
              {status.candidates.map((candidate) => <li key={candidate}><code>{candidate}</code></li>)}
            </ul>
          </details>
        ) : null}
      </div>
    </section>

    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.thunderLocation")}</h3>
      <div className="settings-group-body">
        <p className="settings-footnote">{t("desktop.settings.thunderLocationDesc")}</p>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.thunderRepoPath")}</span>
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
            <input
              style={{ flex: "1 1 auto" }}
              value={draft.repoPath}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder={t("desktop.settings.thunderRepoPathPlaceholder")}
              onChange={(event) => update({ repoPath: event.target.value }, { commit: false })}
              onBlur={() => commit(draft)}
            />
            <button type="button" className="tool-btn" onClick={() => void browseRepo()}>
              <ThemeIcon name="folder-open" size={ICON_SIZE.dense} aria-hidden="true" />
              {t("desktop.settings.thunderBrowse")}
            </button>
          </div>
          <span className="settings-field-hint muted">{t("desktop.settings.thunderRepoPathDesc")}</span>
        </label>

        <label className="settings-field" style={{ marginTop: "var(--space-2)" }}>
          <span className="settings-field-label">{t("desktop.settings.thunderDaemonPath")}</span>
          <input
            value={draft.daemonPath}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={t("desktop.settings.thunderDaemonPathPlaceholder")}
            onChange={(event) => update({ daemonPath: event.target.value }, { commit: false })}
            onBlur={() => commit(draft)}
          />
          <span className="settings-field-hint muted">{t("desktop.settings.thunderDaemonPathDesc")}</span>
        </label>

        <label className="settings-field" style={{ marginTop: "var(--space-2)" }}>
          <span className="settings-field-label">{t("desktop.settings.thunderTuiPath")}</span>
          <input
            value={draft.tuiPath || ""}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={t("desktop.settings.thunderTuiPathPlaceholder")}
            onChange={(event) => update({ tuiPath: event.target.value }, { commit: false })}
            onBlur={() => commit(draft)}
          />
          <span className="settings-field-hint muted">{t("desktop.settings.thunderTuiPathDesc")}</span>
        </label>
      </div>
    </section>

    <ModelsSection t={t} />
  </>;
}

// ── Models editor ────────────────────────────────────────────────────────────

function ModelsSection({ t }: { t: Translate }) {
  const [config, setConfig] = useState<ThunderModelsConfig | null>(null);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const value = await desktopApi().thunderReadModelsConfig();
      setConfig({ providers: value?.providers ?? {}, utilityModel: value?.utilityModel });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
    const unsub = desktopApi().onThunderModelsChanged?.(() => void load());
    return () => unsub?.();
  }, [load]);

  const patchProvider = (id: string, patch: Partial<ThunderModelsProvider>) => {
    setConfig((prev) =>
      prev
        ? {
            ...prev,
            providers: {
              ...prev.providers,
              [id]: { ...(prev.providers[id] ?? {}), ...patch }
            }
          }
        : prev
    );
  };

  const addProvider = () => {
    const id = `provider-${Math.random().toString(36).slice(2, 6)}`;
    setConfig((prev) =>
      prev ? { ...prev, providers: { ...prev.providers, [id]: { name: id, api: "openai-completions" } } } : prev
    );
    setExpanded((prev) => ({ ...prev, [id]: true }));
  };

  const removeProvider = async (id: string) => {
    if (!(await confirmDestructive(
      t("desktop.settings.thunderModelsDeleteProviderConfirm", id),
      t("desktop.common.remove")
    ))) return;
    setConfig((prev) => {
      if (!prev) return prev;
      const providers = { ...prev.providers };
      delete providers[id];
      return { ...prev, providers };
    });
  };

  const save = async () => {
    if (!config) return;
    setBusy(true);
    try {
      await desktopApi().thunderWriteModelsConfig({ config });
      setStatus({ text: t("desktop.settings.thunderModelsSaved"), kind: "ok" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const utilityOptions = (() => {
    if (!config) return [];
    const options: Array<{ value: string; label: string }> = [];
    for (const [pid, provider] of Object.entries(config.providers)) {
      for (const model of provider.models ?? []) {
        const mid = String(model?.id ?? "");
        if (!mid) continue;
        const value = `${pid}/${mid}`;
        options.push({ value, label: String(model?.name ?? mid) + " — " + value });
      }
    }
    return options;
  })();

  return (
    <section className="settings-group">
      <div className="settings-group-header">
        <h3 className="settings-group-title">{t("desktop.settings.thunderModelsTitle")}</h3>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <button type="button" className="ghost-btn" onClick={addProvider} disabled={config === null}>
            + {t("desktop.settings.thunderModelsAddProvider")}
          </button>
          <button type="button" className="tool-btn" onClick={() => void save()} disabled={busy || config === null}>
            <ThemeIcon name="save" size={ICON_SIZE.dense} aria-hidden="true" />
            {t("desktop.settings.thunderModelsSave")}
          </button>
        </div>
      </div>
      <div className="settings-group-body">
        <p className="settings-footnote">{t("desktop.settings.thunderModelsDesc")}</p>

        {config === null ? (
          <p className="settings-footnote">…</p>
        ) : Object.keys(config.providers).length === 0 ? (
          <p className="settings-footnote muted">{t("desktop.settings.thunderModelsEmpty")}</p>
        ) : (
          <div className="settings-roles-list">
            {Object.entries(config.providers).map(([pid, provider]) => {
              const models = provider.models ?? [];
              const isOpen = expanded[pid] ?? true;
              return (
                <div key={pid} className="settings-thunder-provider-card tb-role-card">
                  <div className="settings-thunder-provider-header tb-role-card-head">
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                      <span className="tb-role-badge">{pid}</span>
                      <strong style={{ fontSize: "13px" }}>{String(provider.name || pid)}</strong>
                      <span className="settings-footnote muted">{t("desktop.settings.thunderModelsCount", models.length)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1-5)" }}>
                      <button
                        type="button"
                        className="tool-btn"
                        onClick={() => setExpanded((prev) => ({ ...prev, [pid]: !isOpen }))}
                      >
                        {isOpen ? t("desktop.settings.thunderCollapse") : t("desktop.settings.thunderExpand")}
                      </button>
                      <button
                        type="button"
                        className="tool-btn"
                        onClick={() => void removeProvider(pid)}
                        title={t("desktop.common.remove")}
                      >
                        <ThemeIcon name="trash" size={ICON_SIZE.dense} aria-hidden="true" />
                        {t("desktop.common.remove")}
                      </button>
                    </div>
                  </div>

                  <div className="settings-thunder-provider-grid">
                    <label className="settings-field">
                      <span className="settings-field-label">{t("desktop.settings.thunderModelsProviderName")}</span>
                      <input
                        value={String(provider.name ?? "")}
                        placeholder={t("desktop.settings.thunderModelsProviderName")}
                        onChange={(event) => patchProvider(pid, { name: event.target.value })}
                      />
                    </label>
                    <label className="settings-field">
                      <span className="settings-field-label">API Protocol</span>
                      <input
                        value={String(provider.api ?? "")}
                        placeholder="api"
                        onChange={(event) => patchProvider(pid, { api: event.target.value })}
                      />
                    </label>
                    <label className="settings-field">
                      <span className="settings-field-label">{t("desktop.settings.baseUrl")}</span>
                      <input
                        value={String(provider.baseUrl ?? "")}
                        placeholder="baseUrl"
                        onChange={(event) => patchProvider(pid, { baseUrl: event.target.value })}
                      />
                    </label>
                    <label className="settings-field">
                      <span className="settings-field-label">{t("desktop.settings.apiKey")}</span>
                      <input
                        type="password"
                        value={String(provider.apiKey ?? "")}
                        placeholder="apiKey"
                        autoComplete="off"
                        onChange={(event) => patchProvider(pid, { apiKey: event.target.value })}
                      />
                    </label>
                  </div>

                  {isOpen && models.length > 0 ? (
                    <div className="tb-role-card-body" style={{ padding: "0 var(--space-3) var(--space-3)" }}>
                      <table className="tb-models-table">
                        <thead>
                          <tr>
                            <th>{t("desktop.settings.thunderModelsModel")}</th>
                            <th>{t("desktop.settings.thunderModelsContext")}</th>
                            <th>{t("desktop.settings.thunderModelsReasoning")}</th>
                            <th>{t("desktop.settings.thunderModelsDefaultThinking")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {models.map((model, index) => (
                            <tr key={`${pid}-${String(model?.id ?? index)}`}>
                              <td title={String(model?.id ?? "")}><strong>{String(model?.name ?? model?.id ?? "")}</strong></td>
                              <td>{typeof model?.contextWindow === "number" ? model.contextWindow.toLocaleString() : "—"}</td>
                              <td>{model?.reasoning ? "✓" : "—"}</td>
                              <td>{String(model?.defaultThinkingLevel ?? "—")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {config && utilityOptions.length > 0 ? (
          <label className="settings-field" style={{ marginTop: "var(--space-3)" }}>
            <span className="settings-field-label">{t("desktop.settings.thunderModelsUtility")}</span>
            <select
              value={config.utilityModel ?? ""}
              onChange={(event) =>
                setConfig((prev) => (prev ? { ...prev, utilityModel: event.target.value } : prev))
              }
            >
              <option value="">—</option>
              {utilityOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        ) : null}

        {status.text ? (
          <div style={{ marginTop: "var(--space-2)" }}>
            <Status kind={status.kind}>{status.text}</Status>
          </div>
        ) : null}
        <p className="settings-footnote muted" style={{ marginTop: "var(--space-2)" }}>{t("desktop.settings.thunderModelsEditorFootnote")}</p>
      </div>
    </section>
  );
}
