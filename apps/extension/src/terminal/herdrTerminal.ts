import { TextDecoder } from "node:util";
import * as vscode from "vscode";
import type { HcAttachStream } from "../herdr/hcClient";
import type { HerdrSessionTracker } from "../herdr/herdrSessionTracker";
import type { AgentSession } from "../history";
import { t } from "../i18n";
import { buildResumeCommand } from "./commandBuilder";

const PERSISTED_HERDR_TERMINALS_KEY = "agentResume.openHerdrTerminals.v1";

interface PersistedHerdrTerminal {
  address: string;
  title: string;
}

let activeTracker: HerdrSessionTracker | undefined;
let workspaceState: vscode.Memento | undefined;
let isDisposing = false;
const attachedTerminals = new Map<string, vscode.Terminal>();
const attachedTerminalMeta = new Map<string, string>();

export function setHerdrSessionTracker(tracker: HerdrSessionTracker | undefined): void {
  activeTracker = tracker;
}

export function setHerdrTerminalWorkspaceState(state: vscode.Memento | undefined): void {
  workspaceState = state;
  isDisposing = false;
}

export function disposeBuiltInHerdrTerminals(): void {
  isDisposing = true;
  for (const terminal of attachedTerminals.values()) {
    terminal.dispose();
  }
  attachedTerminals.clear();
  attachedTerminalMeta.clear();
}

function persistAttachedTerminals(): void {
  if (!workspaceState || isDisposing) {
    return;
  }
  const items: PersistedHerdrTerminal[] = Array.from(attachedTerminalMeta.entries()).map(
    ([address, title]) => ({ address, title })
  );
  void workspaceState.update(PERSISTED_HERDR_TERMINALS_KEY, items);
}

export function getHerdrSessionTracker(): HerdrSessionTracker | undefined {
  return activeTracker;
}

export function shouldAutoResumeInHerdr(session: AgentSession): boolean {
  if (!activeTracker || !activeTracker.isDaemonAvailable()) {
    return false;
  }
  const config = vscode.workspace.getConfiguration("agentResume");
  if (!config.get<boolean>("herdrEnabled", true)) {
    return false;
  }
  if (!config.get<boolean>("autoResumeHerdrSessions", true)) {
    return false;
  }
  return Boolean(activeTracker.resolve(session));
}

export function shouldStartNewSessionInHerdr(projectPath: string): boolean {
  if (!activeTracker || !activeTracker.isDaemonAvailable()) {
    return false;
  }
  const config = vscode.workspace.getConfiguration("agentResume");
  if (!config.get<boolean>("herdrEnabled", true)) {
    return false;
  }
  const mode = config.get<string>("herdrNewSessionMode", "auto");
  if (mode === "never") {
    return false;
  }
  if (mode === "always") {
    return true;
  }
  return Boolean(projectPath && activeTracker.getSpaceByFolder(projectPath));
}

export function shouldUseHerdrForHandoff(): boolean {
  if (!activeTracker || !activeTracker.isDaemonAvailable()) {
    return false;
  }
  const config = vscode.workspace.getConfiguration("agentResume");
  return config.get<boolean>("herdrEnabled", true) && config.get<boolean>("herdrHandoff", true);
}

function terminalLocation(): vscode.TerminalOptions["location"] {
  const config = vscode.workspace.getConfiguration("agentResume");
  const configured = config.get<string>("terminalLocation", "editorBeside");
  if (configured === "panel") {
    return vscode.TerminalLocation.Panel;
  }
  return { viewColumn: vscode.ViewColumn.Beside };
}

function openBuiltInHerdrPseudoterminal(
  tracker: HerdrSessionTracker,
  address: string,
  title: string
): void {
  const existing = attachedTerminals.get(address);
  if (existing) {
    existing.show(false);
    return;
  }

  const writeEmitter = new vscode.EventEmitter<string>();
  const closeEmitter = new vscode.EventEmitter<number | void>();
  const decoder = new TextDecoder("utf-8");
  let stream: HcAttachStream | undefined;
  let disposed = false;

  const pty: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,
    open: (dims) => {
      void (async () => {
        try {
          const cols = dims?.columns && dims.columns > 0 ? dims.columns : 120;
          const rows = dims?.rows && dims.rows > 0 ? dims.rows : 36;
          const attached = await tracker.client.attach({
            terminal: address,
            cols,
            rows,
            history: 1000,
            resize_notifications: true
          });
          if (disposed) {
            attached.close();
            return;
          }
          stream = attached;
          attached.on("data", (chunk: Buffer) => {
            const text = decoder.decode(chunk, { stream: true });
            if (text) {
              writeEmitter.fire(text);
            }
          });
          attached.on("close", (reason: string) => {
            const tail = decoder.decode();
            if (tail) {
              writeEmitter.fire(tail);
            }
            writeEmitter.fire(`\r\n\x1b[90m[herdr-core detached: ${reason}]\x1b[0m\r\n`);
            stream = undefined;
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          writeEmitter.fire(`\x1b[31m[herdr-core attach failed: ${msg}]\x1b[0m\r\n`);
        }
      })();
    },
    close: () => {
      disposed = true;
      attachedTerminals.delete(address);
      attachedTerminalMeta.delete(address);
      persistAttachedTerminals();
      stream?.close();
      stream = undefined;
      writeEmitter.dispose();
      closeEmitter.dispose();
    },
    handleInput: (data) => {
      stream?.writeData(data);
    },
    setDimensions: (dims) => {
      stream?.resize(dims.columns, dims.rows);
    }
  };

  const terminal = vscode.window.createTerminal({
    name: `Herdr: ${title} (${address})`,
    pty,
    location: terminalLocation(),
    iconPath: new vscode.ThemeIcon("terminal")
  });
  attachedTerminals.set(address, terminal);
  attachedTerminalMeta.set(address, title);
  persistAttachedTerminals();
  terminal.show(false);
}

export async function restoreBuiltInHerdrTerminals(): Promise<void> {
  if (!activeTracker || !activeTracker.isDaemonAvailable() || !workspaceState || isDisposing) {
    return;
  }
  const saved = workspaceState.get<PersistedHerdrTerminal[]>(PERSISTED_HERDR_TERMINALS_KEY);
  if (!saved?.length) {
    return;
  }
  const liveSet = new Set(activeTracker.getTerminals().map((term) => term.address));
  for (const item of saved) {
    if (!item?.address || isDisposing) {
      continue;
    }
    if (!liveSet.has(item.address)) {
      attachedTerminalMeta.delete(item.address);
      continue;
    }
    if (!attachedTerminals.has(item.address)) {
      openBuiltInHerdrPseudoterminal(activeTracker, item.address, item.title || item.address);
    }
  }
  persistAttachedTerminals();
}

export async function openHerdrResume(
  session: AgentSession,
  _context?: vscode.ExtensionContext
): Promise<boolean> {
  if (session.provider === "cursor-ide" || session.provider === "chat") {
    vscode.window.showWarningMessage(t("warning.herdrUnsupportedSession"));
    return false;
  }

  const tracker = activeTracker;
  if (!tracker || !tracker.isDaemonAvailable()) {
    vscode.window.showWarningMessage(t("warning.herdrDaemonOffline"));
    return false;
  }

  const match = tracker.resolve(session);
  let address = match?.kind === "live" ? match.address : undefined;
  let spaceId = match?.spaceId;

  if (!address) {
    const cmd = buildResumeCommand(session);
    const labels: Record<string, string> = {
      "alma.session": `${session.provider}:id:${session.id}`
    };
    if (session.projectPath) {
      labels.workspace = session.projectPath;
    }

    const created = await tracker.client.runTerminal({
      cwd: session.projectPath || undefined,
      line: cmd,
      keep: true,
      labels
    });
    address = created.address;

    const targetSpaceId =
      spaceId ||
      (session.projectPath ? tracker.getSpaceByFolder(session.projectPath)?.id : undefined);
    if (targetSpaceId) {
      spaceId = targetSpaceId;
      if (tracker.herdrApp.isAvailable()) {
        await tracker.herdrApp.keepTerminalInSpace(address, targetSpaceId).catch(() => undefined);
      }
    }

    await tracker.markLaunchedInHerdr(session, { address, spaceId });
    void tracker.refresh();
  }

  const display = vscode.workspace
    .getConfiguration("agentResume")
    .get<string>("herdrResumeDisplay", "auto");

  if (display === "herdrApp" && tracker.herdrApp.isAvailable()) {
    if (spaceId) {
      await tracker.herdrApp.selectSpace(spaceId).catch(() => undefined);
    }
    await tracker.herdrApp.activateHerdrApp();
    return true;
  }

  const bridgeApi = tracker.getBridgeApi();
  if (display === "auto" && bridgeApi) {
    try {
      await bridgeApi.openTerminal(address);
      return true;
    } catch {
      // fall back to built-in Pseudoterminal
    }
  }

  const hasHerdrBridge = Boolean(
    vscode.extensions.getExtension("lucacicii.herdr-core-bridge") ??
      vscode.extensions.getExtension("lucacicii.herdr-bridge")
  );
  if (display === "auto" && hasHerdrBridge) {
    try {
      await vscode.commands.executeCommand("herdrBridge.openTerminal", address);
      return true;
    } catch {
      // fall back to built-in Pseudoterminal if command fails
    }
  }

  const shortTitle = session.title.length > 32 ? `${session.title.slice(0, 31)}...` : session.title;
  openBuiltInHerdrPseudoterminal(tracker, address, shortTitle);
  return true;
}

export async function launchCommandInHerdr(options: {
  cwd: string;
  command: string;
  name?: string;
  labels?: Record<string, string>;
  spaceId?: string;
}): Promise<boolean> {
  const tracker = activeTracker;
  if (!tracker || !tracker.isDaemonAvailable()) {
    return false;
  }

  const targetSpaceId =
    options.spaceId ||
    (options.cwd ? tracker.getSpaceByFolder(options.cwd)?.id : undefined);
  const display = vscode.workspace
    .getConfiguration("agentResume")
    .get<string>("herdrResumeDisplay", "auto");

  const bridgeApi = tracker.getBridgeApi();
  if (display === "auto" && bridgeApi) {
    await bridgeApi.runAndOpen({
      cwd: options.cwd || undefined,
      line: options.command,
      name: options.name,
      labels: options.labels,
      spaceId: targetSpaceId
    });
    return true;
  }

  const created = await tracker.client.runTerminal({
    cwd: options.cwd || undefined,
    line: options.command,
    name: options.name,
    keep: true,
    labels: options.labels
  });

  if (targetSpaceId && tracker.herdrApp.isAvailable()) {
    await tracker.herdrApp.keepTerminalInSpace(created.address, targetSpaceId).catch(() => undefined);
  }
  void tracker.refresh();

  if (display === "herdrApp" && tracker.herdrApp.isAvailable()) {
    if (targetSpaceId) {
      await tracker.herdrApp.selectSpace(targetSpaceId).catch(() => undefined);
    }
    await tracker.herdrApp.activateHerdrApp();
    return true;
  }

  openBuiltInHerdrPseudoterminal(tracker, created.address, options.name || created.address);
  return true;
}

export async function sendTextToActiveHerdrTerminal(text: string): Promise<boolean> {
  const tracker = activeTracker;
  if (!tracker || !tracker.isDaemonAvailable()) {
    vscode.window.showWarningMessage(t("warning.herdrDaemonOffline"));
    return false;
  }

  const bridgeApi = tracker.getBridgeApi();
  if (bridgeApi) {
    const sent = await bridgeApi.sendTextToActive(text);
    if (sent) {
      return true;
    }
  }

  const list = await tracker.client.listTerminals(false);
  const live = list.terminals ?? [];
  if (live.length === 0) {
    vscode.window.showInformationMessage(t("warning.herdrNoLiveTerminal"));
    return false;
  }

  const target =
    live.length === 1
      ? live[0]
      : await vscode.window
          .showQuickPick(
            live.map((term) => ({
              label: term.name?.trim() || term.title?.trim() || term.address,
              description: `${term.address} · ${term.status?.state ?? term.state}`,
              detail: term.cwd,
              term
            })),
            { placeHolder: t("quickpick.selectHerdrTerminalToSend") }
          )
          .then((picked) => picked?.term);

  if (!target) {
    return false;
  }

  await tracker.client.call("terminal.send", { terminal: target.address, text, force: false });
  return true;
}
