import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { useCallback, useEffect, useState } from "react";
import { desktopApi } from "../../bridge";
import { Status, type StatusKind } from "../../components/Status";
import { confirmAction, confirmDestructive } from "../../confirmAction";
import type {
  ThunderModelsConfig,
  ThunderModelsProvider
} from "@agent-resume/core";
import type { ThunderDraft } from "./model";

type Translate = (key: string, ...args: Array<string | number>) => string;

type DaemonStatus = Awaited<ReturnType<ReturnType<typeof desktopApi>["thunderGetStatus"]>>;

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
  const [status, setStatus] = useState<DaemonStatus | null>(null);
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
      <h3 className="settings-group-title">{t("desktop.settings.thunderLocation")}</h3>
      <div className="settings-group-body">
        <p className="settings-callout">{t("desktop.settings.thunderLocationDesc")}</p>
        <label className="settings-field">
          <span className="settings-field-label">{t("desktop.settings.thunderRepoPath")}</span>
          <input
            value={draft.repoPath}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={t("desktop.settings.thunderRepoPathPlaceholder")}
            onChange={(event) => update({ repoPath: event.target.value }, { commit: false })}
            onBlur={() => commit(draft)}
          />
        </label>
        <div className="settings-path-row">
          <button type="button" className="tool-btn" onClick={() => void browseRepo()}>{t("desktop.settings.thunderBrowse")}</button>
        </div>
        <p className="settings-footnote">{t("desktop.settings.thunderRepoPathDesc")}</p>
        <label className="settings-field">
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
        </label>
        <p className="settings-footnote">{t("desktop.settings.thunderDaemonPathDesc")}</p>
        <label className="settings-field">
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
        </label>
        <p className="settings-footnote">{t("desktop.settings.thunderTuiPathDesc")}</p>
      </div>
    </section>

    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.thunderStatusTitle")}</h3>
      <div className="settings-group-body settings-group-body-rows">
        <div className="settings-row">
          <span className="settings-row-label">
            <span className="settings-row-title">
              <span className={`tb-status-dot${available ? " online" : " offline"}`} /> {state}
            </span>
            <span className="settings-row-desc">
              {source ? t("desktop.settings.thunderSource", source) : t("desktop.settings.thunderSourceUnknown")}
            </span>
          </span>
          <span className="settings-row-control">
            <button type="button" className="tool-btn" aria-label={t("desktop.settings.thunderCheck")} disabled={checking} onClick={() => void check()}>
              <ThemeIcon name="refresh" size={ICON_SIZE.default} />{t("desktop.settings.thunderCheck")}
            </button>
          </span>
        </div>

        {daemonPath ? (
          <div className="settings-row">
            <span className="settings-row-label">
              <span className="settings-row-title">{t("desktop.settings.thunderResolvedDaemon")}</span>
              <span className="settings-row-desc">{daemonPath}</span>
            </span>
          </div>
        ) : null}

        {status?.tuiPath ? (
          <div className="settings-row">
            <span className="settings-row-label">
              <span className="settings-row-title">{t("desktop.settings.thunderResolvedTui")}</span>
              <span className="settings-row-desc">{status.tuiPath}</span>
            </span>
          </div>
        ) : null}

        {status?.repoPath ? (
          <div className="settings-row">
            <span className="settings-row-label">
              <span className="settings-row-title">{t("desktop.settings.thunderResolvedRepo")}</span>
              <span className="settings-row-desc">{status.repoPath}</span>
            </span>
          </div>
        ) : null}

        {models.length ? (
          <div className="settings-row">
            <span className="settings-row-label">
              <span className="settings-row-title">{t("desktop.settings.thunderModels")}</span>
              <span className="settings-row-desc">{models.map((model) => model.selection_id || model.id).join(" · ")}</span>
            </span>
          </div>
        ) : null}

        {status?.error ? <Status kind="error">{status.error}</Status> : null}
        {message.text ? <Status kind={message.kind}>{message.text}</Status> : null}

        {!daemonPath && status?.candidates?.length ? (
          <details>
            <summary>{t("desktop.settings.thunderCandidates", status.candidates.length)}</summary>
            <ul className="settings-footnote">
              {status.candidates.map((candidate) => <li key={candidate}><code>{candidate}</code></li>)}
            </ul>
          </details>
        ) : null}

        <p className="settings-footnote">{t("desktop.settings.thunderModelsFootnote")}</p>
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
  const [expanded, setExpanded] = useState<string | null>(null);

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
    setExpanded(id);
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
      <h3 className="settings-group-title">{t("desktop.settings.thunderModelsTitle")}</h3>
      <div className="settings-group-body">
        <p className="settings-callout">{t("desktop.settings.thunderModelsDesc")}</p>

        {config === null ? (
          <p className="settings-footnote">…</p>
        ) : Object.keys(config.providers).length === 0 ? (
          <p className="settings-footnote">{t("desktop.settings.thunderModelsEmpty")}</p>
        ) : (
          <div className="settings-roles-list">
            {Object.entries(config.providers).map(([pid, provider]) => {
              const models = provider.models ?? [];
              const isOpen = expanded === pid;
              return (
                <div key={pid} className="tb-role-card">
                  <div className="tb-role-card-head">
                    <span className="tb-role-badge">{pid}</span>
                    <input
                      value={String(provider.name ?? "")}
                      placeholder={t("desktop.settings.thunderModelsProviderName")}
                      onChange={(event) => patchProvider(pid, { name: event.target.value })}
                    />
                    <input
                      value={String(provider.api ?? "")}
                      placeholder="api"
                      onChange={(event) => patchProvider(pid, { api: event.target.value })}
                    />
                    <input
                      value={String(provider.baseUrl ?? "")}
                      placeholder="baseUrl"
                      onChange={(event) => patchProvider(pid, { baseUrl: event.target.value })}
                    />
                    <input
                      type="password"
                      value={String(provider.apiKey ?? "")}
                      placeholder="apiKey"
                      autoComplete="off"
                      onChange={(event) => patchProvider(pid, { apiKey: event.target.value })}
                    />
                    <span className="settings-footnote">{t("desktop.settings.thunderModelsCount", models.length)}</span>
                    <button type="button" className="tool-btn" onClick={() => setExpanded(isOpen ? null : pid)}>
                      {isOpen ? t("desktop.settings.thunderCollapse") : t("desktop.settings.thunderExpand")}
                    </button>
                    <button type="button" className="tool-btn" onClick={() => void removeProvider(pid)}>
                      {t("desktop.common.remove")}
                    </button>
                  </div>

                  {isOpen ? (
                    <div className="tb-role-card-body">
                      {models.length === 0 ? (
                        <p className="settings-footnote">{t("desktop.settings.thunderModelsNoModels")}</p>
                      ) : (
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
                                <td title={String(model?.id ?? "")}>{String(model?.name ?? model?.id ?? "")}</td>
                                <td>{typeof model?.contextWindow === "number" ? model.contextWindow.toLocaleString() : "—"}</td>
                                <td>{model?.reasoning ? "✓" : "—"}</td>
                                <td>{String(model?.defaultThinkingLevel ?? "—")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {config && utilityOptions.length > 0 ? (
          <label className="settings-field">
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

        <div className="settings-path-row">
          <button type="button" className="tool-btn" onClick={addProvider} disabled={config === null}>
            {t("desktop.settings.thunderModelsAddProvider")}
          </button>
          <button type="button" className="tool-btn" onClick={() => void save()} disabled={busy || config === null}>
            {t("desktop.settings.thunderModelsSave")}
          </button>
        </div>
        {status.text ? <Status kind={status.kind}>{status.text}</Status> : null}
        <p className="settings-footnote">{t("desktop.settings.thunderModelsEditorFootnote")}</p>
      </div>
    </section>
  );
}
