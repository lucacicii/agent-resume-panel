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
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { Status, type StatusKind } from "../../components/Status";
import { confirmAction, confirmDestructive } from "../../confirmAction";

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
      if (!(await confirmAction(t(`desktop.settings.agentStatus.${action}Confirm`, integration.label)))) return;
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
    if (daemon?.running && !(await confirmDestructive(t("desktop.settings.agentStatus.stopDaemonConfirm"), t("desktop.common.confirm")))) return;
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

  const toggleLoginAgent = useCallback(async () => {
    setBusy("loginAgent");
    try {
      const call = daemon?.launchAgentInstalled
        ? desktopApi().agentStatusUninstallLaunchAgent
        : desktopApi().agentStatusInstallLaunchAgent;
      const next = await call?.();
      setDaemon(next ?? null);
      setStatus({
        text: daemon?.launchAgentInstalled
          ? t("desktop.settings.agentStatus.loginAgentRemoved")
          : t("desktop.settings.agentStatus.loginAgentAdded"),
        kind: "ok"
      });
      await refresh();
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setBusy(null);
    }
  }, [daemon?.launchAgentInstalled, refresh, t]);

  return (
    <>
      <section className="settings-group">
        <h3 className="settings-group-title">{t("desktop.settings.agentStatus.daemonTitle")}</h3>
        <div className="settings-group-body">
          <p className="settings-footnote">{t("desktop.settings.agentStatus.daemonDesc")}</p>

          <div className="settings-agent-status-hero">
            <div className="settings-agent-status-hero-left">
              <span className={`settings-agent-status-dot${daemon?.running ? " is-on" : ""}`} aria-hidden="true" />
              <div>
                <div className="settings-agent-status-title">
                  {daemon?.running
                    ? t("desktop.settings.agentStatus.daemonRunning", daemon.pid ?? 0, daemon.apiVersion ?? 0)
                    : t("desktop.settings.agentStatus.daemonStopped")}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="tool-btn"
              disabled={busy === "daemon"}
              onClick={() => void toggleDaemon()}
            >
              {daemon?.running ? (
                <>
                  <ThemeIcon name="square" size={ICON_SIZE.dense} aria-hidden="true" />
                  {t("desktop.settings.agentStatus.stopDaemon")}
                </>
              ) : (
                <>
                  <ThemeIcon name="play" size={ICON_SIZE.dense} aria-hidden="true" />
                  {t("desktop.settings.agentStatus.startDaemon")}
                </>
              )}
            </button>
          </div>

          {daemon ? (
            <div className="settings-agent-status-grid">
              <div className="settings-agent-status-stat-card">
                <span className="settings-agent-status-stat-label">{t("desktop.settings.agentStatus.factPanels")}</span>
                <span className="settings-agent-status-stat-value">{daemon.paneCount ?? 0}</span>
              </div>
              <div className="settings-agent-status-stat-card">
                <span className="settings-agent-status-stat-label">{t("desktop.settings.agentStatus.factSubscribers")}</span>
                <span className="settings-agent-status-stat-value">{daemon.subscriberCount ?? 0}</span>
              </div>
              <div className="settings-agent-status-stat-card">
                <span className="settings-agent-status-stat-label">{t("desktop.settings.agentStatus.factLoginAgent")}</span>
                <span className="settings-agent-status-stat-value">
                  <span>
                    {daemon.launchAgentInstalled
                      ? t("desktop.settings.agentStatus.loginAgentOn")
                      : t("desktop.settings.agentStatus.loginAgentOff")}
                  </span>
                  <button
                    type="button"
                    className="ghost-btn"
                    style={{ fontSize: "11px", padding: "2px 8px" }}
                    disabled={busy === "loginAgent"}
                    onClick={() => void toggleLoginAgent()}
                  >
                    {daemon.launchAgentInstalled
                      ? t("desktop.settings.agentStatus.loginAgentRemove")
                      : t("desktop.settings.agentStatus.loginAgentAdd")}
                  </button>
                </span>
              </div>
              <div className="settings-agent-status-stat-card">
                <span className="settings-agent-status-stat-label">{t("desktop.settings.agentStatus.factSocket")}</span>
                <span className="settings-agent-status-stat-value settings-path-display" style={{ fontSize: "11px" }}>
                  {daemon.socketPath}
                </span>
              </div>
              <div className="settings-agent-status-stat-card" style={{ gridColumn: "1 / -1" }}>
                <span className="settings-agent-status-stat-label">{t("desktop.settings.agentStatus.factManifests")}</span>
                <span className="settings-agent-status-stat-value" style={{ fontSize: "12px", fontWeight: 400 }}>
                  {(daemon.manifests ?? [])
                    .map((manifest) => `${manifest.id}@${manifest.version} (${manifest.rules})`)
                    .join(", ") || "—"}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="settings-group">
        <h3 className="settings-group-title">{t("desktop.settings.agentStatus.hooksTitle")}</h3>
        <div className="settings-group-body settings-group-body-rows">
          <p className="settings-footnote" style={{ paddingBottom: "var(--space-2)" }}>{t("desktop.settings.agentStatus.hooksDesc")}</p>
          {integrations.map((integration) => {
            const badgeClass = integration.installed
              ? "installed"
              : integration.detected
                ? "available"
                : "missing";
            const badgeLabel = integration.installed
              ? t("desktop.settings.agentStatus.hookInstalled")
              : integration.detected
                ? t("desktop.settings.agentStatus.hookAvailable")
                : t("desktop.settings.agentStatus.hookMissing");

            return (
              <div className="settings-row" key={integration.id}>
                <div className="settings-row-label">
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <span className="settings-row-title">{integration.label}</span>
                    <span className={`settings-agent-status-badge ${badgeClass}`}>{badgeLabel}</span>
                  </div>
                  <span className="settings-row-desc settings-path-display" style={{ marginTop: "2px" }}>
                    {integration.detail}
                  </span>
                </div>
                <div className="settings-row-control">
                  <button
                    type="button"
                    className="tool-btn"
                    disabled={busy === integration.id || (!integration.detected && !integration.installed)}
                    onClick={() => void toggle(integration)}
                  >
                    {integration.installed ? (
                      <>
                        <ThemeIcon name="trash" size={ICON_SIZE.dense} aria-hidden="true" />
                        {t("desktop.settings.agentStatus.uninstall")}
                      </>
                    ) : (
                      <>
                        <ThemeIcon name="plus" size={ICON_SIZE.dense} aria-hidden="true" />
                        {t("desktop.settings.agentStatus.install")}
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="settings-group">
        <h3 className="settings-group-title">{t("desktop.settings.agentStatus.panesTitle")}</h3>
        <div className="settings-group-body">
          <p className="settings-footnote">{t("desktop.settings.agentStatus.panesDesc")}</p>
          {panes.length === 0 ? (
            <p className="settings-footnote muted">{t("desktop.settings.agentStatus.panesEmpty")}</p>
          ) : (
            <div className="settings-agent-status-panes-list">
              {panes.map((pane) => (
                <div
                  className={`settings-agent-status-pane-row${selected === pane.paneId ? " active" : ""}`}
                  key={pane.paneId}
                >
                  <div className="settings-agent-status-pane-info">
                    <span className="settings-agent-status-pane-title">
                      <ThemeIcon name="terminal" size={ICON_SIZE.dense} />
                      {t("desktop.settings.agentStatus.paneLabel", pane.paneId)}
                    </span>
                    <span className="settings-agent-status-pane-meta">
                      <strong>{pane.agent}</strong> · <span className="settings-state-pill">{pane.state}</span> · {pane.source}
                      {pane.matchedRule ? ` · ${pane.matchedRule.id}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`tool-btn${selected === pane.paneId ? " active" : ""}`}
                    onClick={() => void inspect(pane.paneId)}
                  >
                    <ThemeIcon name="search" size={ICON_SIZE.dense} />
                    {t("desktop.settings.agentStatus.inspect")}
                  </button>
                </div>
              ))}
            </div>
          )}

          {selected !== null ? (
            <div className="settings-agent-status-inspector">
              <div className="settings-agent-status-inspector-head">
                <h4 style={{ margin: 0, fontSize: "var(--font-size-headline)" }}>
                  {t("desktop.settings.agentStatus.inspectorTitle", selected)}
                </h4>
                <button
                  type="button"
                  className="ghost-btn"
                  style={{ fontSize: "11px", padding: "2px 8px" }}
                  onClick={() => setSelected(null)}
                >
                  <ThemeIcon name="close" size={ICON_SIZE.dense} />
                </button>
              </div>

              {explain ? (
                <p className="settings-footnote">
                  <strong>{explain.state}</strong> · {explain.source} · {explain.authority}
                  {explain.reason ? ` — ${explain.reason}` : ""}
                </p>
              ) : (
                <p className="settings-footnote muted">{t("desktop.settings.agentStatus.inspectorEmpty")}</p>
              )}

              {explain?.manifests?.length ? (
                <p className="settings-footnote settings-path-display">
                  {t("desktop.settings.agentStatus.inspectorLayers")}:{" "}
                  {explain.manifests.map((layer) => `${layer.id}@${layer.version} (${layer.source})`).join(" → ")}
                </p>
              ) : null}

              {explain?.screenSkipped ? (
                <p className="settings-footnote muted">{t("desktop.settings.agentStatus.inspectorSkipped", explain.screenSkipped)}</p>
              ) : null}

              {explain?.evaluated?.length ? (
                <div style={{ overflowX: "auto" }}>
                  <table className="settings-agent-status-rule-table">
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
                          <td><code>{row.id}</code></td>
                          <td>{row.manifest}</td>
                          <td><span className="settings-state-pill">{row.state}</span></td>
                          <td>{row.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {screen?.screenText ? (
                <details style={{ marginTop: "var(--space-2-5)" }}>
                  <summary className="settings-footnote" style={{ cursor: "pointer", fontWeight: 500 }}>
                    {t("desktop.settings.agentStatus.inspectorScreen")}
                  </summary>
                  <pre className="settings-agent-status-screen-box">{screen.screenText}</pre>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {status.text ? (
        <div style={{ padding: "var(--space-2) 0" }}>
          <Status kind={status.kind}>{status.text}</Status>
        </div>
      ) : null}
    </>
  );
}
