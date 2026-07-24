import { useCallback, useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import type { McpClientInfo } from "../../../main/mcpRegistration";
import type { PanelSettings } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { Status, type StatusKind } from "../../components/Status";

type Translate = (key: string, ...args: Array<string | number>) => string;

export function McpPane({
  t,
  settings,
  onSaveSettings
}: {
  t: Translate;
  settings: PanelSettings;
  onSaveSettings: (settings: PanelSettings) => Promise<void>;
}) {
  const [clients, setClients] = useState<McpClientInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setClients(await desktopApi().listMcpClients());
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const confirmWriteAccess = () => window.confirm(t("desktop.settings.mcpWriteConfirm"));

  const register = async (client: McpClientInfo) => {
    if (!confirmWriteAccess()) return;
    setBusy(client.id);
    try {
      await desktopApi().registerMcpClient({ clientId: client.id, replace: client.registered });
      setStatus({ text: t("desktop.settings.mcpRegistered", client.label), kind: "ok" });
      await refresh();
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (client: McpClientInfo) => {
    if (!window.confirm(t("desktop.settings.mcpRemoveConfirm", client.label))) return;
    setBusy(client.id);
    try {
      await desktopApi().removeMcpClient({ clientId: client.id });
      setStatus({ text: t("desktop.settings.mcpRemoved", client.label), kind: "ok" });
      await refresh();
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setBusy(null);
    }
  };

  const registerAll = async () => {
    if (!confirmWriteAccess()) return;
    setBusy("all");
    try {
      const result = await desktopApi().registerAllMcpClients();
      setStatus({
        text: result.failed.length
          ? t("desktop.settings.mcpRegisterPartial", result.registered.length, result.failed.length)
          : t("desktop.settings.mcpRegisterAllDone", result.registered.length),
        kind: result.failed.length ? "error" : "ok"
      });
      await refresh();
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setBusy(null);
    }
  };

  const copyManualConfig = async () => {
    try {
      await navigator.clipboard.writeText(await desktopApi().getMcpManualConfig());
      setStatus({ text: t("desktop.settings.mcpCopied"), kind: "ok" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  };

  const updateExecutionTracking = async (enabled: boolean) => {
    setBusy("execution-tracking");
    try {
      await onSaveSettings({
        ...settings,
        desktop: { ...settings.desktop, autoSessionExecutionNotes: enabled }
      });
    } finally {
      setBusy(null);
    }
  };

  return <>
    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.mcpServiceTitle")}</h3>
      <div className="settings-group-body">
        <p className="settings-callout">{t("desktop.settings.mcpServiceDesc")}</p>
        <p className="settings-footnote">{t("desktop.settings.mcpWriteWarning")}</p>
        <div className="settings-action-row">
          <button type="button" className="tool-btn" disabled={busy !== null || loading} onClick={() => void registerAll()}>{t("desktop.settings.mcpRegisterAll")}</button>
          <button type="button" className="tool-btn" aria-label={t("desktop.settings.mcpRefresh")} disabled={busy !== null} onClick={() => void refresh()}><RefreshCw size={15} /></button>
        </div>
        <Status kind={status.kind}>{status.text}</Status>
      </div>
    </section>
    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.mcpExecutionTitle")}</h3>
      <div className="settings-group-body">
        <label className="settings-row">
          <span className="settings-row-label">
            <span className="settings-row-title">{t("desktop.settings.mcpExecutionTracking")}</span>
            <span className="settings-row-desc">{t("desktop.settings.mcpExecutionTrackingDesc")}</span>
          </span>
          <span className="settings-toggle">
            <input type="checkbox" role="switch" checked={settings.desktop?.autoSessionExecutionNotes === true} disabled={busy !== null} onChange={(event) => void updateExecutionTracking(event.target.checked)} />
            <span className="settings-toggle-track" aria-hidden="true" />
          </span>
        </label>
      </div>
    </section>
    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.mcpClientsTitle")}</h3>
      <div className="settings-group-body settings-group-body-rows">
        {loading ? <Status>{t("desktop.common.loading")}</Status> : clients.map((client) => (
          <div className="settings-row" key={client.id}>
            <span className="settings-row-label">
              <span className="settings-row-title">{client.label}</span>
              <span className="settings-row-desc">{client.registered ? t("desktop.settings.mcpStatusRegistered") : client.detected ? t("desktop.settings.mcpStatusDetected") : t("desktop.settings.mcpStatusNotDetected")}</span>
            </span>
            <span className="settings-row-control settings-mcp-actions">
              {client.mode === "automatic" ? <>
                <button type="button" className="tool-btn" disabled={!client.detected || busy !== null} onClick={() => void register(client)}>{client.registered ? t("desktop.settings.mcpUpdate") : t("desktop.settings.mcpRegister")}</button>
                {client.registered ? <button type="button" className="tool-btn" disabled={busy !== null} onClick={() => void remove(client)}>{t("desktop.settings.mcpRemove")}</button> : null}
              </> : <button type="button" className="tool-btn" disabled={busy !== null} onClick={() => void copyManualConfig()}><Copy size={14} />{t("desktop.settings.mcpCopyConfig")}</button>}
            </span>
          </div>
        ))}
      </div>
    </section>
  </>;
}
