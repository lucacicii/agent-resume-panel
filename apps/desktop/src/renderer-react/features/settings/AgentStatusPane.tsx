/**
 * Settings → Background status.
 *
 * Two jobs in one pane:
 *   1. install/remove the hook that lets an agent report its own state, and
 *   2. show what the background plane is actually doing — daemon health, every
 *      pane it knows about, and for any pane the rule-by-rule explanation plus
 *      the exact screen text the rules ran against.
 *
 * It is the only place a user can see that status detection is working, so it
 * reports facts (pid, api version, manifests, matched rule) rather than a
 * reassuring summary.
 */

import { useCallback, useEffect, useState } from "react";
import type { AgentIntegrationStatus } from "../../../main/agentStatus/integrations";
import type { AgentStatusDaemonStatus } from "../../../main/agentStatus/lifecycle";
import type { DetectionExplain, PaneScreenDump, PaneStatus } from "../../../shared/agentStatusTypes";
import { desktopApi } from "../../bridge";
import { ThemeIcon } from "../../components/ThemeIcon";
import { Status, type StatusKind } from "../../components/Status";

type Translate = (key: string, ...args: Array<string | number>) => string;

export function AgentStatusPane({ t }: { t: Translate }) {
  const [integrations, setIntegrations] = useState<AgentIntegrationStatus[]>([]);
  const [daemon, setDaemon] = useState<AgentStatusDaemonStatus | null>(null);
  const [panes, setPanes] = useState<PaneStatus[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [explain, setExplain] = useState<DetectionExplain | null>(null);
  const [screen, setScreen] = useState<PaneScreenDump | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });

  const refresh = useCallback(async () => {
    try {
      const [rows, health, known] = await Promise.all([
        desktopApi().agentStatusListIntegrations?.() ?? [],
        desktopApi().agentStatusDaemonStatus?.() ?? null,
        desktopApi().agentStatusPanes?.() ?? []
      ]);
      setIntegrations(rows);
      setDaemon(health);
      setPanes(known);
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const inspect = useCallback(async (paneId: number) => {
    setSelected(paneId);
    setExplain(null);
    setScreen(null);
    try {
      const [detail, dump] = await Promise.all([
        desktopApi().agentStatusExplain?.({ paneId }) ?? null,
        desktopApi().agentStatusScreen?.({ paneId }) ?? null
      ]);
      setExplain(detail);
      setScreen(dump);
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, []);

  const toggle = useCallback(
    async (integration: AgentIntegrationStatus) => {
      const action = integration.installed ? "uninstall" : "install";
      if (!window.confirm(t(`desktop.settings.agentStatus.${action}Confirm`, integration.label))) return;
      setBusy(integration.id);
      try {
        const call = integration.installed
          ? desktopApi().agentStatusUninstallIntegration
          : desktopApi().agentStatusInstallIntegration;
        await call?.({ id: integration.id });
        setStatus({
          text: t(`desktop.settings.agentStatus.${action}Done`, integration.label),
          kind: "ok"
        });
        await refresh();
      } catch (error) {
        setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
      } finally {
        setBusy(null);
      }
    },
    [refresh, t]
  );

  const toggleDaemon = useCallback(async () => {
    if (daemon?.running && !window.confirm(t("desktop.settings.agentStatus.stopDaemonConfirm"))) return;
    setBusy("daemon");
    try {
      const call = daemon?.running ? desktopApi().agentStatusStopDaemon : desktopApi().agentStatusStartDaemon;
      const next = await call?.();
      setDaemon(next ?? null);
      await refresh();
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setBusy(null);
    }
  }, [daemon?.running, refresh, t]);

  return (
    <div className="settings-agent-status">
      <section>
        <h3>{t("desktop.settings.agentStatus.daemonTitle")}</h3>
        <p className="muted">{t("desktop.settings.agentStatus.daemonDesc")}</p>
        <div className="settings-agent-status-row">
          <span className={`settings-agent-status-dot${daemon?.running ? " is-on" : ""}`} aria-hidden="true" />
          <span>
            {daemon?.running
              ? t("desktop.settings.agentStatus.daemonRunning", daemon.pid ?? 0, daemon.apiVersion ?? 0)
              : t("desktop.settings.agentStatus.daemonStopped")}
          </span>
          <button type="button" className="btn" disabled={busy === "daemon"} onClick={() => void toggleDaemon()}>
            {daemon?.running ? t("desktop.settings.agentStatus.stopDaemon") : t("desktop.settings.agentStatus.startDaemon")}
          </button>
        </div>
        {daemon ? (
          <dl className="settings-agent-status-facts">
            <div>
              <dt>{t("desktop.settings.agentStatus.factPanels")}</dt>
              <dd>{daemon.paneCount ?? 0}</dd>
            </div>
            <div>
              <dt>{t("desktop.settings.agentStatus.factSubscribers")}</dt>
              <dd>{daemon.subscriberCount ?? 0}</dd>
            </div>
            <div>
              <dt>{t("desktop.settings.agentStatus.factLoginAgent")}</dt>
              <dd>{daemon.launchAgentInstalled ? t("desktop.common.confirm") : "—"}</dd>
            </div>
            <div>
              <dt>{t("desktop.settings.agentStatus.factSocket")}</dt>
              <dd className="settings-agent-status-path">{daemon.socketPath}</dd>
            </div>
            <div>
              <dt>{t("desktop.settings.agentStatus.factManifests")}</dt>
              <dd>
                {(daemon.manifests ?? [])
                  .map((manifest) => `${manifest.id}@${manifest.version} (${manifest.rules})`)
                  .join(", ") || "—"}
              </dd>
            </div>
          </dl>
        ) : null}
      </section>

      <section>
        <h3>{t("desktop.settings.agentStatus.hooksTitle")}</h3>
        <p className="muted">{t("desktop.settings.agentStatus.hooksDesc")}</p>
        <ul className="settings-agent-status-list">
          {integrations.map((integration) => (
            <li key={integration.id}>
              <div>
                <strong>{integration.label}</strong>
                <span className="muted">
                  {integration.installed
                    ? t("desktop.settings.agentStatus.hookInstalled")
                    : integration.detected
                      ? t("desktop.settings.agentStatus.hookAvailable")
                      : t("desktop.settings.agentStatus.hookMissing")}
                </span>
                <span className="settings-agent-status-detail muted">{integration.detail}</span>
              </div>
              <button
                type="button"
                className="btn"
                disabled={busy === integration.id || (!integration.detected && !integration.installed)}
                onClick={() => void toggle(integration)}
              >
                {integration.installed
                  ? t("desktop.settings.agentStatus.uninstall")
                  : t("desktop.settings.agentStatus.install")}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>{t("desktop.settings.agentStatus.panesTitle")}</h3>
        <p className="muted">{t("desktop.settings.agentStatus.panesDesc")}</p>
        {panes.length === 0 ? (
          <p className="muted">{t("desktop.settings.agentStatus.panesEmpty")}</p>
        ) : (
          <ul className="settings-agent-status-list">
            {panes.map((pane) => (
              <li key={pane.paneId}>
                <div>
                  <strong>
                    <ThemeIcon name="terminal" size={12} /> {t("desktop.settings.agentStatus.paneLabel", pane.paneId)}
                  </strong>
                  <span className="muted">
                    {pane.agent} · {pane.state} · {pane.source}
                    {pane.matchedRule ? ` · ${pane.matchedRule.id}` : ""}
                  </span>
                </div>
                <button type="button" className="btn" onClick={() => void inspect(pane.paneId)}>
                  {t("desktop.settings.agentStatus.inspect")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected !== null ? (
          <div className="settings-agent-status-inspector">
            <h4>{t("desktop.settings.agentStatus.inspectorTitle", selected)}</h4>
            {explain ? (
              <p className="muted">
                {explain.state} · {explain.source} · {explain.authority}
                {explain.reason ? ` — ${explain.reason}` : ""}
              </p>
            ) : (
              <p className="muted">{t("desktop.settings.agentStatus.inspectorEmpty")}</p>
            )}
            {explain?.manifests?.length ? (
              <p className="settings-agent-status-path">
                {t("desktop.settings.agentStatus.inspectorLayers")}:{" "}
                {explain.manifests.map((layer) => `${layer.id}@${layer.version} (${layer.source})`).join(" → ")}
              </p>
            ) : null}
            {explain?.screenSkipped ? (
              <p className="muted">{t("desktop.settings.agentStatus.inspectorSkipped", explain.screenSkipped)}</p>
            ) : null}
            {explain?.evaluated?.length ? (
              <table className="settings-agent-status-rules">
                <thead>
                  <tr>
                    <th>{t("desktop.settings.agentStatus.ruleColumn")}</th>
                    <th>{t("desktop.settings.agentStatus.ruleManifest")}</th>
                    <th>{t("desktop.settings.agentStatus.ruleState")}</th>
                    <th>{t("desktop.settings.agentStatus.ruleReason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {explain.evaluated.map((row) => (
                    <tr key={`${row.manifest}:${row.id}`} className={row.matched ? "is-match" : ""}>
                      <td>{row.id}</td>
                      <td>{row.manifest}</td>
                      <td>{row.state}</td>
                      <td>{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {screen?.screenText ? (
              <details>
                <summary>{t("desktop.settings.agentStatus.inspectorScreen")}</summary>
                <pre className="settings-agent-status-screen">{screen.screenText}</pre>
              </details>
            ) : null}
          </div>
        ) : null}
      </section>

      <Status kind={status.kind}>{status.text}</Status>
    </div>
  );
}
