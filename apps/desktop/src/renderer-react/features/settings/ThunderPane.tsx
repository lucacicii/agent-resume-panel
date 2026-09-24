import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { useCallback, useEffect, useState } from "react";
import { desktopApi } from "../../bridge";
import { Status, type StatusKind } from "../../components/Status";
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
  </>;
}
