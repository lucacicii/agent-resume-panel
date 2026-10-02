import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { useCallback, useEffect, useState } from "react";
import { desktopApi } from "../../bridge";
import { Status, type StatusKind } from "../../components/Status";
import { confirmAction, confirmDestructive } from "../../confirmAction";
import type {
  ThunderModelsConfig,
  ThunderRoleRecord,
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

    <RolesSection t={t} />
    <ModelsSection t={t} />
  </>;
}

// ── Roles editor ─────────────────────────────────────────────────────────────

const PERMISSION_OPTIONS = ["read", "write", "bash"] as const;
const MODE_OPTIONS = ["never", "shell_only", "mutations", "always"] as const;

function getPermissionLabel(perm: string): string {
  switch (perm) {
    case "read":
      return "read · 只读";
    case "write":
      return "write · 可写文件";
    case "bash":
      return "bash · 完整+Shell";
    default:
      return perm;
  }
}

function getModeLabel(mode: string): string {
  switch (mode) {
    case "":
    case "never":
    case "yolo":
    case "plan":
      return "never · 无需审批";
    case "shell_only":
    case "accept_edits":
      return "shell_only · 仅Shell审批";
    case "mutations":
    case "ask":
      return "mutations · 改写与Shell审批";
    case "always":
    case "manual":
      return "always · 步步全审批";
    default:
      return mode;
  }
}

function getAvailableModes(permission: string): readonly string[] {
  if (permission === "read") {
    return ["never", "always"];
  }
  if (permission === "write") {
    return ["never", "mutations", "always"];
  }
  return ["never", "shell_only", "mutations", "always"];
}

function personaToText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join("\n");
  return typeof value === "string" ? value : "";
}

function textToPersona(text: string, original: unknown): string | string[] {
  // Preserve the authored shape: arrays stay arrays (JSONL stays readable).
  if (Array.isArray(original)) return text.split("\n");
  return text;
}

function triggersToText(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(", ") : "";
}

function textToTriggers(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function RolesSection({ t }: { t: Translate }) {
  const [records, setRecords] = useState<ThunderRoleRecord[] | null>(null);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await desktopApi().thunderReadRolesFile();
      setRecords(Array.isArray(list) ? list : []);
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
    // Edits made elsewhere (hand edits, another window) reload the list.
    const unsub = desktopApi().onThunderRolesChanged?.(() => void load());
    return () => unsub?.();
  }, [load]);

  const patchRaw = (id: string, patch: Record<string, unknown>) => {
    setRecords((prev) =>
      prev?.map((record) =>
        String(record.raw.id) === id ? { ...record, raw: { ...record.raw, ...patch } } : record
      ) ?? prev
    );
  };

  const save = async () => {
    if (!records) return;
    setBusy(true);
    try {
      await desktopApi().thunderWriteRolesFile({ records });
      setStatus({ text: t("desktop.settings.thunderRolesSaved"), kind: "ok" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const resetBuiltin = async (id: string) => {
    if (!(await confirmAction(t("desktop.settings.thunderRolesResetConfirm", id)))) return;
    try {
      await desktopApi().thunderResetBuiltinRole({ id });
      await load();
      setStatus({ text: t("desktop.settings.thunderRolesResetDone", id), kind: "ok" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  };

  const addRole = () => {
    const id = `role-${Math.random().toString(36).slice(2, 7)}`;
    setRecords((prev) => [
      ...(prev ?? []),
      {
        raw: { id, name: "New Role", permission: "write", mode: "mutations", enabled: true },
        builtin: false
      }
    ]);
    setExpanded(id);
  };

  const removeRole = async (id: string) => {
    if (!(await confirmDestructive(
      t("desktop.settings.thunderRolesDeleteConfirm", id),
      t("desktop.common.remove")
    ))) return;
    setRecords((prev) => prev?.filter((record) => String(record.raw.id) !== id) ?? prev);
  };

  return (
    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.thunderRolesTitle")}</h3>
      <div className="settings-group-body">
        <p className="settings-callout">{t("desktop.settings.thunderRolesDesc")}</p>

        {records === null ? (
          <p className="settings-footnote">…</p>
        ) : records.length === 0 ? (
          <p className="settings-footnote">{t("desktop.settings.thunderRolesEmpty")}</p>
        ) : (
          <div className="settings-roles-list">
            {records.map((record) => {
              const id = String(record.raw.id ?? "");
              const isOpen = expanded === id;
              return (
                <div key={id} className={`tb-role-card${record.builtin ? " is-builtin" : ""}`}>
                  <div className="tb-role-card-head">
                    {record.builtin ? (
                      <span className="tb-role-badge">{t("desktop.settings.thunderRolesBuiltin")}</span>
                    ) : null}
                    <input
                      className="tb-role-id"
                      value={id}
                      spellCheck={false}
                      disabled={record.builtin}
                      title={record.builtin ? t("desktop.settings.thunderRolesIdLocked") : undefined}
                      onChange={(event) => {
                        // Renaming rewrites the id in place; duplicates are rejected on save.
                        setRecords((prev) =>
                          prev?.map((item) =>
                            item === record ? { ...item, raw: { ...item.raw, id: event.target.value } } : item
                          ) ?? prev
                        );
                      }}
                    />
                    <input
                      value={String(record.raw.name ?? "")}
                      placeholder={t("desktop.settings.thunderRolesName")}
                      onChange={(event) => patchRaw(id, { name: event.target.value })}
                    />
                    <label className="tb-role-select-group" title={t("desktop.settings.thunderRolesPermission")}>
                      <span className="tb-role-select-label">权限</span>
                      <select
                        value={String(record.raw.permission ?? "write")}
                        onChange={(event) => {
                          const newPerm = event.target.value;
                          const currentMode = String(record.raw.mode ?? "never");
                          const validModes = getAvailableModes(newPerm);
                          const nextMode = validModes.includes(currentMode) ? currentMode : "never";
                          patchRaw(id, { permission: newPerm, mode: nextMode });
                        }}
                      >
                        {PERMISSION_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {getPermissionLabel(option)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label
                      className="tb-role-select-group"
                      title={
                        record.raw.permission === "read"
                          ? "只读角色无写操作与终端命令，自动无需审批直接放行（如需全量审计可切换为 always）。"
                          : t("desktop.settings.thunderRolesMode")
                      }
                    >
                      <span className="tb-role-select-label">审批</span>
                      <select
                        value={String(record.raw.mode ?? "never")}
                        onChange={(event) => patchRaw(id, { mode: event.target.value })}
                      >
                        {getAvailableModes(String(record.raw.permission ?? "write")).map((option) => (
                          <option key={option} value={option}>
                            {getModeLabel(option)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="tb-role-toggle">
                      <input
                        type="checkbox"
                        checked={record.raw.enabled !== false}
                        onChange={(event) => patchRaw(id, { enabled: event.target.checked })}
                      />
                      {t("desktop.settings.thunderRolesEnabled")}
                    </label>
                    <button type="button" className="tool-btn" onClick={() => setExpanded(isOpen ? null : id)}>
                      {isOpen ? t("desktop.settings.thunderRolesCollapse") : t("desktop.settings.thunderRolesExpand")}
                    </button>
                    {record.builtin ? (
                      <button type="button" className="tool-btn" onClick={() => void resetBuiltin(id)}>
                        {t("desktop.settings.thunderRolesReset")}
                      </button>
                    ) : (
                      <button type="button" className="tool-btn" onClick={() => void removeRole(id)}>
                        {t("desktop.common.remove")}
                      </button>
                    )}
                  </div>

                  {isOpen ? (
                    <div className="tb-role-card-body">
                      <label className="settings-field">
                        <span className="settings-field-label">{t("desktop.settings.thunderRolesDescription")}</span>
                        <input
                          value={String(record.raw.description ?? "")}
                          onChange={(event) => patchRaw(id, { description: event.target.value })}
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field-label">{t("desktop.settings.thunderRolesAliases")}</span>
                        <input
                          value={Array.isArray(record.raw.aliases) ? record.raw.aliases.join(", ") : ""}
                          placeholder="p, plan-b"
                          onChange={(event) =>
                            patchRaw(id, {
                              aliases: textToTriggers(event.target.value)
                            })
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field-label">{t("desktop.settings.thunderRolesTriggers")}</span>
                        <input
                          value={triggersToText(record.raw.triggers)}
                          placeholder={t("desktop.settings.thunderRolesTriggersPlaceholder")}
                          onChange={(event) => patchRaw(id, { triggers: textToTriggers(event.target.value) })}
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field-label">{t("desktop.settings.thunderRolesPersona")}</span>
                        <textarea
                          rows={6}
                          value={personaToText(record.raw.persona)}
                          onChange={(event) =>
                            patchRaw(id, { persona: textToPersona(event.target.value, record.raw.persona) })
                          }
                        />
                      </label>
                      <div className="tb-role-card-toggles">
                        <label className="tb-role-toggle">
                          <input
                            type="checkbox"
                            checked={Boolean(record.raw.askUser)}
                            onChange={(event) => patchRaw(id, { askUser: event.target.checked })}
                          />
                          {t("desktop.settings.thunderRolesAskUser")}
                        </label>
                        <label className="tb-role-toggle">
                          <input
                            type="checkbox"
                            checked={Boolean(record.raw.exitGate)}
                            onChange={(event) => patchRaw(id, { exitGate: event.target.checked })}
                          />
                          {t("desktop.settings.thunderRolesExitGate")}
                        </label>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <div className="settings-path-row">
          <button type="button" className="tool-btn" onClick={addRole} disabled={records === null}>
            {t("desktop.settings.thunderRolesAdd")}
          </button>
          <button type="button" className="tool-btn" onClick={() => void save()} disabled={busy || records === null}>
            {t("desktop.settings.thunderRolesSave")}
          </button>
        </div>
        {status.text ? <Status kind={status.kind}>{status.text}</Status> : null}
        <p className="settings-footnote">{t("desktop.settings.thunderRolesFootnote")}</p>
      </div>
    </section>
  );
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
                      {isOpen ? t("desktop.settings.thunderRolesCollapse") : t("desktop.settings.thunderRolesExpand")}
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
