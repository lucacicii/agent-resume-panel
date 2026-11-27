import { TextDecoder } from "node:util";
import * as vscode from "vscode";
import type { HcAttachStream } from "../herdr/hcClient";
import type { HerdrSessionTracker } from "../herdr/herdrSessionTracker";
import type { HcTerminal } from "../herdr/types";
import {
  deriveSpaceNameFromFolder,
  isHerdrNameConflictError,
  resolveUniqueHerdrTerminalName
} from "../herdr/naming";
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

export function shouldStartNewSessionInHerdr(_projectPath?: string): boolean {
  if (!activeTracker || !activeTracker.isDaemonAvailable()) {
    return false;
  }
  const config = vscode.workspace.getConfiguration("agentResume");
  if (!config.get<boolean>("herdrEnabled", true)) {
    return false;
  }
  const mode = config.get<string>("herdrNewSessionMode", "auto");
  return mode !== "never";
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
  const pendingInput: string[] = [];
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
          attached.focus(true);
          if (pendingInput.length > 0) {
            const queued = pendingInput.splice(0, pendingInput.length);
            for (const chunk of queued) {
              attached.writeData(chunk);
            }
          }
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
      if (stream) {
        stream.writeData(data);
      } else {
        pendingInput.push(data);
      }
    },
    setDimensions: (dims) => {
      stream?.resize(dims.columns, dims.rows);
    }
  };

  const terminal = vscode.window.createTerminal({
    name: `Herdr: ${title} (${address})`,
    pty,
    location: terminalLocation(),
    iconPath: new vscode.ThemeIcon("terminal"),
    isTransient: true
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
  const liveSet = new Set(
    activeTracker
      .getTerminals()
      .filter((term) => term.state === "live")
      .map((term) => term.address)
  );
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
    } else if (session.projectPath && tracker.herdrApp.isAvailable()) {
      const ensured = await tracker.herdrApp
        .ensureSpaceForTerminal(
          deriveSpaceNameFromFolder(session.projectPath),
          session.projectPath,
          address
        )
        .catch(() => undefined);
      if (ensured?.spaceId) {
        spaceId = ensured.spaceId;
      }
    }

    await tracker.markLaunchedInHerdr(session, { address, spaceId });
    void tracker.refresh();
  }

  await openHerdrTerminalByAddress(tracker, address, spaceId, session.title);
  return true;
}

async function openHerdrTerminalByAddress(
  tracker: HerdrSessionTracker,
  address: string,
  spaceId: string | undefined,
  title: string
): Promise<void> {
  const display = vscode.workspace
    .getConfiguration("agentResume")
    .get<string>("herdrResumeDisplay", "auto");

  if (display === "herdrApp" && tracker.herdrApp.isAvailable()) {
    if (spaceId) {
      await tracker.herdrApp.selectSpace(spaceId).catch(() => undefined);
    }
    await tracker.herdrApp.activateHerdrApp();
    return;
  }

  const bridgeApi = tracker.getBridgeApi();
  if (display === "auto" && bridgeApi) {
    try {
      await bridgeApi.openTerminal(address);
      return;
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
      return;
    } catch {
      // fall back to built-in Pseudoterminal if command fails
    }
  }

  const shortTitle = title.length > 32 ? `${title.slice(0, 31)}...` : title;
  openBuiltInHerdrPseudoterminal(tracker, address, shortTitle);
}

function herdrSessionLabel(session: Pick<AgentSession, "provider" | "id">): string {
  return `${session.provider}:id:${session.id}`;
}

function describeHerdrTerminal(term: HcTerminal): string {
  const name = term.name?.trim() || term.title?.trim() || term.address;
  return term.state ? `${name} · ${term.state}` : name;
}

export async function revealHerdrTerminal(session: AgentSession): Promise<boolean> {
  const tracker = activeTracker;
  if (!tracker || !tracker.isDaemonAvailable()) {
    vscode.window.showWarningMessage(t("warning.herdrDaemonOffline"));
    return false;
  }
  const match = tracker.resolve(session);
  if (match?.kind !== "live" || !match.address) {
    vscode.window.showWarningMessage(t("warning.herdrNoLiveTerminal"));
    return false;
  }
  await openHerdrTerminalByAddress(tracker, match.address, match.spaceId, session.title);
  return true;
}

export async function linkHerdrTerminal(session: AgentSession): Promise<boolean> {
  const tracker = activeTracker;
  if (!tracker || !tracker.isDaemonAvailable()) {
    vscode.window.showWarningMessage(t("warning.herdrDaemonOffline"));
    return false;
  }
  const live = tracker.getTerminals().filter((term) => term.state === "live");
  if (live.length === 0) {
    vscode.window.showWarningMessage(t("warning.herdrNoLiveTerminal"));
    return false;
  }
  const picked = await vscode.window.showQuickPick(
    live.map((term) => ({
      label: describeHerdrTerminal(term),
      description: term.cwd ?? "",
      detail: term.address,
      term
    })),
    {
      title: t("dialog.linkHerdrTerminalTitle"),
      placeHolder: t("dialog.linkHerdrTerminalPlaceholder"),
      matchOnDescription: true,
      matchOnDetail: true
    }
  );
  if (!picked) {
    return false;
  }
  const address = picked.term.address;
  const running = tracker.runsOtherSession(picked.term, session);
  if (running) {
    // The terminal demonstrably runs another session, so the label would be a lie that the next
    // `/new`-aware lookup contradicts; say so instead of writing it and looking successful.
    vscode.window.showWarningMessage(
      t("warning.herdrTerminalRunsOtherSession", session.provider, running)
    );
    return false;
  }
  try {
    await tracker.client.setLabels(address, { "alma.session": herdrSessionLabel(session) });
  } catch (error) {
    vscode.window.showErrorMessage(
      t("error.herdrLabelWriteFailed", error instanceof Error ? error.message : String(error))
    );
    return false;
  }
  const spaceId = tracker.getSpaceByFolder(picked.term.cwd || session.projectPath || "")?.id;
  await tracker.markLaunchedInHerdr(session, { address, spaceId });
  void tracker.refresh();
  vscode.window.showInformationMessage(t("notification.herdrLinked", picked.label));
  return true;
}

export async function unlinkHerdrTerminal(session: AgentSession): Promise<boolean> {
  const tracker = activeTracker;
  if (!tracker || !tracker.isDaemonAvailable()) {
    vscode.window.showWarningMessage(t("warning.herdrDaemonOffline"));
    return false;
  }
  // One session can be labelled onto several terminals, and a finished terminal's label keeps
  // resurrecting the badge through recordMatchedFromTerminals, so clear every label naming it.
  const addresses = tracker.labeledTerminals(session).map((term) => term.address);
  for (const address of addresses) {
    try {
      await tracker.client.setLabels(address, { "alma.session": "" });
    } catch (error) {
      vscode.window.showErrorMessage(
        t("error.herdrLabelWriteFailed", error instanceof Error ? error.message : String(error))
      );
      return false;
    }
  }
  await tracker.forgetSession(session);
  if (addresses.length > 0) {
    await tracker.refresh();
    const remaining = tracker.labeledTerminals(session).length;
    if (remaining > 0) {
      vscode.window.showWarningMessage(t("warning.herdrUnlinkLabelStuck", remaining));
    }
  }
  vscode.window.showInformationMessage(
    addresses.length > 0
      ? t("notification.herdrUnlinkedMany", addresses.length)
      : t("notification.herdrUnlinked")
  );
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

  const liveNames = tracker
    .getTerminals()
    .filter((term) => term.state === "live" && term.name)
    .map((term) => term.name as string);
  const uniqueName = resolveUniqueHerdrTerminalName(options.name, liveNames);
  const targetSpaceId =
    options.spaceId ||
    (options.cwd ? tracker.getSpaceByFolder(options.cwd)?.id : undefined);
  const display = vscode.workspace
    .getConfiguration("agentResume")
    .get<string>("herdrResumeDisplay", "auto");

  const bridgeApi = tracker.getBridgeApi();
  if (display === "auto" && bridgeApi) {
    let res: { address: string; spaceId?: string };
    try {
      res = await bridgeApi.runAndOpen({
        cwd: options.cwd || undefined,
        line: options.command,
        name: uniqueName,
        labels: options.labels,
        spaceId: targetSpaceId
      });
    } catch (err) {
      if (uniqueName && isHerdrNameConflictError(err)) {
        res = await bridgeApi.runAndOpen({
          cwd: options.cwd || undefined,
          line: options.command,
          name: undefined,
          labels: options.labels,
          spaceId: targetSpaceId
        });
      } else {
        throw err;
      }
    }
    if (!res.spaceId && options.cwd && tracker.herdrApp.isAvailable()) {
      await tracker.herdrApp
        .ensureSpaceForTerminal(
          deriveSpaceNameFromFolder(options.cwd),
          options.cwd,
          res.address
        )
        .catch(() => undefined);
      await tracker.refresh();
    }
    return true;
  }

  let created;
  try {
    created = await tracker.client.runTerminal({
      cwd: options.cwd || undefined,
      line: options.command,
      name: uniqueName,
      keep: true,
      labels: options.labels
    });
  } catch (err) {
    if (uniqueName && isHerdrNameConflictError(err)) {
      created = await tracker.client.runTerminal({
        cwd: options.cwd || undefined,
        line: options.command,
        name: undefined,
        keep: true,
        labels: options.labels
      });
    } else {
      throw err;
    }
  }

  let resolvedSpaceId = targetSpaceId;
  if (tracker.herdrApp.isAvailable()) {
    if (resolvedSpaceId) {
      await tracker.herdrApp.keepTerminalInSpace(created.address, resolvedSpaceId).catch(() => undefined);
    } else if (options.cwd) {
      const ensured = await tracker.herdrApp
        .ensureSpaceForTerminal(
          deriveSpaceNameFromFolder(options.cwd),
          options.cwd,
          created.address
        )
        .catch(() => undefined);
      if (ensured?.spaceId) {
        resolvedSpaceId = ensured.spaceId;
      }
    }
  }
  void tracker.refresh();

  if (display === "herdrApp" && tracker.herdrApp.isAvailable()) {
    if (resolvedSpaceId) {
      await tracker.herdrApp.selectSpace(resolvedSpaceId).catch(() => undefined);
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
