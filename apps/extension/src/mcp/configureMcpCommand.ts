import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { resolvePanelHome } from "@agent-resume/core/extension";
import { PANEL_DOC_MCP } from "../constants/docLinks";
import { t } from "../i18n";
import {
  type DetectedMcpClient,
  type McpLaunchSpec,
  buildAgentSelfInstallPrompt,
  buildMcpConfigSnippet,
  detectMcpClients,
  readRegisteredMcpSpec,
  removeMcpClientConfig,
  upsertMcpClientConfig
} from "./configWriters";
import { type McpProbeResult, probeMcpStdioServer } from "./probeMcp";

const execFileAsync = promisify(execFile);
const MCP_CLI_COMMAND = "agent-resume-mcp";
const BUNDLED_MCP_FILENAME = "agent-resume-mcp.cjs";

export interface McpStatusSummary {
  bundleInstalled: boolean;
  bundlePath: string;
  registeredClients: Array<{ id: string; label: string; configPath: string }>;
  detectedClients: Array<{ id: string; label: string; configPath: string; installed: boolean; registered: boolean }>;
}

async function findExecutableOnPath(command: string): Promise<string | undefined> {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(probe, [command], { timeout: 2_000 });
    const first = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return first || undefined;
  } catch {
    return undefined;
  }
}

function resolveBundledMcpSource(extensionPath: string): string | undefined {
  const candidates = [
    path.join(extensionPath, "out", "mcp-server.cjs"),
    path.resolve(extensionPath, "..", "..", "packages", "mcp", "dist", BUNDLED_MCP_FILENAME),
    path.resolve(extensionPath, "..", "packages", "mcp", "dist", BUNDLED_MCP_FILENAME)
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function findWorkspaceMcpCli(extensionPath: string): string | undefined {
  const candidates = [
    path.resolve(extensionPath, "..", "..", "packages", "mcp", "dist", "cli.js"),
    path.resolve(extensionPath, "..", "packages", "mcp", "dist", "cli.js")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function resolveConfiguredPanelHome(config: vscode.WorkspaceConfiguration): {
  panelHome: string;
  env: Record<string, string> | undefined;
} {
  const configuredPanelHome = config.get<string>("panelHome", "").trim();
  const defaultResolved = resolvePanelHome();
  const currentResolved = resolvePanelHome(configuredPanelHome || undefined);
  return {
    panelHome: currentResolved,
    env: currentResolved !== defaultResolved ? { AGENT_RESUME_PANEL_HOME: currentResolved } : undefined
  };
}

export function getInstalledBundledMcpPath(panelHome: string = resolvePanelHome()): string {
  return path.join(panelHome, "bin", BUNDLED_MCP_FILENAME);
}

/**
 * Keeps ~/.agent-resume-panel/bin/agent-resume-mcp.cjs up to date after extension upgrades
 * if the user previously installed the bundled MCP runtime.
 */
export function syncBundledMcpIfInstalled(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration("agentResume");
  const { panelHome } = resolveConfiguredPanelHome(config);
  const target = getInstalledBundledMcpPath(panelHome);
  if (!fs.existsSync(target)) {
    return;
  }
  const source = resolveBundledMcpSource(context.extensionPath);
  if (!source) {
    return;
  }
  try {
    const srcStat = fs.statSync(source);
    const dstStat = fs.statSync(target);
    if (srcStat.size === dstStat.size && srcStat.mtimeMs <= dstStat.mtimeMs) {
      return;
    }
    fs.copyFileSync(source, target);
    if (process.platform !== "win32") {
      fs.chmodSync(target, 0o755);
    }
  } catch {
    // Non-fatal background sync
  }
}

export function installBundledMcpServer(context: vscode.ExtensionContext, panelHome: string): string {
  const source = resolveBundledMcpSource(context.extensionPath);
  if (!source) {
    throw new Error("Bundled MCP runtime (out/mcp-server.cjs) was not found in the extension.");
  }
  const target = getInstalledBundledMcpPath(panelHome);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  if (process.platform !== "win32") {
    fs.chmodSync(target, 0o755);
  }
  return target;
}

async function resolveStableNodeCommand(): Promise<string> {
  const home = os.homedir();
  const candidates =
    process.platform === "win32"
      ? [await findExecutableOnPath("node")]
      : [
          path.join(home, ".local", "bin", "node"),
          path.join(home, ".local", "share", "fnm", "aliases", "default", "bin", "node"),
          "/opt/homebrew/bin/node",
          "/usr/local/bin/node",
          await findExecutableOnPath("node")
        ];

  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) {
      continue;
    }
    if (candidate.includes("fnm_multishells")) {
      try {
        return fs.realpathSync(candidate);
      } catch {
        continue;
      }
    }
    return candidate;
  }
  return "node";
}

export function getMcpStatusSummary(): McpStatusSummary {
  const config = vscode.workspace.getConfiguration("agentResume");
  const { panelHome } = resolveConfiguredPanelHome(config);
  const bundlePath = getInstalledBundledMcpPath(panelHome);
  const detectedClients = detectMcpClients();
  return {
    bundleInstalled: fs.existsSync(bundlePath),
    bundlePath,
    registeredClients: detectedClients
      .filter((c) => c.registered)
      .map((c) => ({ id: c.id, label: c.label, configPath: c.configPath })),
    detectedClients: detectedClients.map((c) => ({
      id: c.id,
      label: c.label,
      configPath: c.configPath,
      installed: c.installed,
      registered: c.registered
    }))
  };
}

export interface McpToolInfo {
  name: string;
  description: string;
}

export interface McpVerificationResult {
  status: McpStatusSummary;
  probe?: McpProbeResult;
  checkedTargetLabel?: string;
  brokenClients: Array<{ id: string; label: string; reason: string }>;
}

export function getMcpToolsCatalog(): McpToolInfo[] {
  return [
    { name: "search_agent_resume", description: t("webview.settings.mcpToolSearchDesc") },
    { name: "list_notes", description: t("webview.settings.mcpToolListNotesDesc") },
    { name: "read_note", description: t("webview.settings.mcpToolReadNoteDesc") },
    { name: "list_sessions", description: t("webview.settings.mcpToolListSessionsDesc") },
    { name: "get_session", description: t("webview.settings.mcpToolGetSessionDesc") },
    { name: "list_projects", description: t("webview.settings.mcpToolListProjectsDesc") }
  ];
}

export async function verifyMcpRegistration(context: vscode.ExtensionContext): Promise<McpVerificationResult> {
  const status = getMcpStatusSummary();
  const detectedClients = detectMcpClients();
  const brokenClients: Array<{ id: string; label: string; reason: string }> = [];
  let specToProbe: McpLaunchSpec | undefined;
  let checkedTargetLabel: string | undefined;

  for (const client of detectedClients) {
    if (!client.registered) {
      continue;
    }
    const spec = readRegisteredMcpSpec(client);
    if (!spec) {
      brokenClients.push({
        id: client.id,
        label: client.label,
        reason: "Missing or invalid command in config"
      });
      continue;
    }
    const scriptArg = spec.args.find((a) => /\.(?:c|m)?js$/i.test(a));
    if (scriptArg && !fs.existsSync(scriptArg)) {
      brokenClients.push({
        id: client.id,
        label: client.label,
        reason: `Script not found: ${scriptArg}`
      });
      continue;
    }
    if (!specToProbe) {
      specToProbe = spec;
      checkedTargetLabel = client.label;
    }
  }

  if (!specToProbe) {
    const config = vscode.workspace.getConfiguration("agentResume");
    const { panelHome, env } = resolveConfiguredPanelHome(config);
    const installed = getInstalledBundledMcpPath(panelHome);
    const fallback = fs.existsSync(installed) ? installed : resolveBundledMcpSource(context.extensionPath);
    if (fallback) {
      specToProbe = {
        command: await resolveStableNodeCommand(),
        args: [fallback],
        env
      };
      checkedTargetLabel = fs.existsSync(installed) ? "Local Runtime" : "Built-in Runtime";
    }
  }

  const probe = specToProbe ? await probeMcpStdioServer(specToProbe) : undefined;
  return {
    status,
    probe,
    checkedTargetLabel,
    brokenClients
  };
}

export async function openMcpDocumentation(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(PANEL_DOC_MCP));
}

interface LaunchChoiceItem extends vscode.QuickPickItem {
  resolveSpec: () => Promise<McpLaunchSpec>;
}

async function pickLaunchSpec(context: vscode.ExtensionContext): Promise<McpLaunchSpec | undefined> {
  const config = vscode.workspace.getConfiguration("agentResume");
  const { panelHome, env } = resolveConfiguredPanelHome(config);

  const bundledSource = resolveBundledMcpSource(context.extensionPath);
  const onPath = await findExecutableOnPath(MCP_CLI_COMMAND);
  const localBin = path.join(os.homedir(), ".local", "bin", MCP_CLI_COMMAND);
  const hasLocalBin = fs.existsSync(localBin);
  const workspaceCli = findWorkspaceMcpCli(context.extensionPath);

  const items: LaunchChoiceItem[] = [];

  if (bundledSource) {
    const installedTarget = getInstalledBundledMcpPath(panelHome);
    items.push({
      label: `$(star-full) ${t("quickpick.mcpLaunchBundledLabel")}`,
      description: t("quickpick.mcpLaunchBundledDescription"),
      detail: installedTarget,
      resolveSpec: async () => {
        const installedPath = installBundledMcpServer(context, panelHome);
        const nodeCommand = await resolveStableNodeCommand();
        return { command: nodeCommand, args: [installedPath], env };
      }
    });
  }

  if (onPath) {
    items.push({
      label: `$(terminal) ${MCP_CLI_COMMAND}`,
      description: t("quickpick.mcpLaunchPathDetected"),
      detail: onPath,
      resolveSpec: async () => ({ command: MCP_CLI_COMMAND, args: [], env })
    });
  } else if (hasLocalBin) {
    items.push({
      label: `$(terminal) ${localBin}`,
      description: t("quickpick.mcpLaunchLocalBin"),
      detail: localBin,
      resolveSpec: async () => ({ command: localBin, args: [], env })
    });
  }

  if (workspaceCli) {
    items.push({
      label: `$(file-code) node packages/mcp/dist/cli.js`,
      description: t("quickpick.mcpLaunchWorkspaceCli"),
      detail: workspaceCli,
      resolveSpec: async () => ({ command: await resolveStableNodeCommand(), args: [workspaceCli], env })
    });
  }

  if (items.length === 0) {
    throw new Error("Bundled MCP runtime (out/mcp-server.cjs) was not found in the extension.");
  }

  if (items.length === 1) {
    return items[0].resolveSpec();
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: t("quickpick.mcpLaunchTitle"),
    placeHolder: t("quickpick.mcpLaunchPlaceHolder")
  });
  return picked ? picked.resolveSpec() : undefined;
}

interface ClientPickItem extends vscode.QuickPickItem {
  client: DetectedMcpClient;
}

function buildClientDescription(client: DetectedMcpClient): string {
  if (client.registered) {
    return t("quickpick.mcpStatusRegistered");
  }
  if (client.installed) {
    return t("quickpick.mcpStatusDetected");
  }
  return t("quickpick.mcpStatusNotDetected");
}

async function handleRegisterFlow(context: vscode.ExtensionContext, clients: DetectedMcpClient[]): Promise<void> {
  const anyRegistered = clients.some((c) => c.registered);
  const picks = await vscode.window.showQuickPick<ClientPickItem>(
    clients.map((client) => ({
      label: client.label,
      description: buildClientDescription(client),
      detail: client.configPath,
      picked: anyRegistered ? client.registered : client.installed,
      client
    })),
    {
      canPickMany: true,
      title: t("quickpick.mcpSelectClientsRegisterTitle"),
      placeHolder: t("quickpick.mcpSelectClientsRegisterPlaceHolder")
    }
  );
  if (!picks || picks.length === 0) {
    return;
  }

  const spec = await pickLaunchSpec(context);
  if (!spec) {
    return;
  }

  const succeeded: string[] = [];
  const failed: string[] = [];
  for (const item of picks) {
    try {
      upsertMcpClientConfig(item.client, spec);
      succeeded.push(item.client.label);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      failed.push(`${item.client.label}: ${msg}`);
    }
  }

  if (succeeded.length > 0) {
    void vscode.window.showInformationMessage(t("notification.mcpRegisteredClients", succeeded.join(", ")));
  }
  if (failed.length > 0) {
    void vscode.window.showErrorMessage(t("error.mcpConfigWriteFailed", failed.join("; ")));
  }
}

async function handleUnregisterFlow(clients: DetectedMcpClient[]): Promise<void> {
  const registeredClients = clients.filter((c) => c.registered);
  if (registeredClients.length === 0) {
    void vscode.window.showInformationMessage(t("notification.mcpNoRegisteredClients"));
    return;
  }

  const picks = await vscode.window.showQuickPick<ClientPickItem>(
    registeredClients.map((client) => ({
      label: client.label,
      description: t("quickpick.mcpStatusRegistered"),
      detail: client.configPath,
      picked: true,
      client
    })),
    {
      canPickMany: true,
      title: t("quickpick.mcpSelectClientsUnregisterTitle"),
      placeHolder: t("quickpick.mcpSelectClientsUnregisterPlaceHolder")
    }
  );
  if (!picks || picks.length === 0) {
    return;
  }

  const removed: string[] = [];
  const failed: string[] = [];
  for (const item of picks) {
    try {
      if (removeMcpClientConfig(item.client)) {
        removed.push(item.client.label);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      failed.push(`${item.client.label}: ${msg}`);
    }
  }

  // Clean up installed bundled runtime if no clients remain registered
  if (detectMcpClients().every((c) => !c.registered)) {
    const config = vscode.workspace.getConfiguration("agentResume");
    const { panelHome } = resolveConfiguredPanelHome(config);
    const installed = getInstalledBundledMcpPath(panelHome);
    try {
      if (fs.existsSync(installed)) {
        fs.rmSync(installed, { force: true });
      }
    } catch {
      // ignore cleanup failure
    }
  }

  if (removed.length > 0) {
    void vscode.window.showInformationMessage(t("notification.mcpUnregisteredClients", removed.join(", ")));
  }
  if (failed.length > 0) {
    void vscode.window.showErrorMessage(t("error.mcpConfigWriteFailed", failed.join("; ")));
  }
}

export async function copyAgentInstallPrompt(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentResume");
  const { panelHome, env } = resolveConfiguredPanelHome(config);
  const bundledSource = resolveBundledMcpSource(context.extensionPath);

  let spec: McpLaunchSpec | undefined;
  if (bundledSource) {
    const installedPath = installBundledMcpServer(context, panelHome);
    const nodeCommand = await resolveStableNodeCommand();
    spec = { command: nodeCommand, args: [installedPath], env };
  } else {
    spec = await pickLaunchSpec(context);
  }

  if (!spec) {
    return;
  }

  const prompt = buildAgentSelfInstallPrompt(spec);
  await vscode.env.clipboard.writeText(prompt);
  void vscode.window.showInformationMessage(t("notification.mcpAgentPromptCopied"));
}

async function handleCopySnippetFlow(context: vscode.ExtensionContext): Promise<void> {
  const spec = await pickLaunchSpec(context);
  if (!spec) {
    return;
  }
  const snippet = buildMcpConfigSnippet(spec);
  await vscode.env.clipboard.writeText(snippet);
  void vscode.window.showInformationMessage(t("notification.mcpSnippetCopied"));
}

export async function configureMcpCommand(context: vscode.ExtensionContext): Promise<void> {
  const clients = detectMcpClients();
  const registeredCount = clients.filter((c) => c.registered).length;
  const detectedCount = clients.filter((c) => c.installed).length;

  type ActionId = "register" | "prompt" | "unregister" | "copy" | "docs";
  const actions: Array<vscode.QuickPickItem & { id: ActionId }> = [
    {
      id: "register",
      label: `$(plug) ${t("quickpick.mcpActionRegisterLabel")}`,
      description: t("quickpick.mcpActionRegisterDescription", detectedCount, registeredCount)
    },
    {
      id: "prompt",
      label: `$(sparkle) ${t("quickpick.mcpActionCopyPromptLabel")}`,
      description: t("quickpick.mcpActionCopyPromptDescription")
    },
    {
      id: "unregister",
      label: `$(trash) ${t("quickpick.mcpActionUnregisterLabel")}`,
      description: t("quickpick.mcpActionUnregisterDescription", registeredCount)
    },
    {
      id: "copy",
      label: `$(copy) ${t("quickpick.mcpActionCopySnippetLabel")}`,
      description: t("quickpick.mcpActionCopySnippetDescription")
    },
    {
      id: "docs",
      label: `$(book) ${t("quickpick.mcpActionDocsLabel")}`,
      description: t("quickpick.mcpActionDocsDescription")
    }
  ];

  const picked = await vscode.window.showQuickPick(actions, {
    title: t("quickpick.mcpMenuTitle"),
    placeHolder: t("quickpick.mcpMenuPlaceHolder")
  });
  if (!picked) {
    return;
  }

  if (picked.id === "register") {
    await handleRegisterFlow(context, clients);
  } else if (picked.id === "prompt") {
    await copyAgentInstallPrompt(context);
  } else if (picked.id === "unregister") {
    await handleUnregisterFlow(clients);
  } else if (picked.id === "copy") {
    await handleCopySnippetFlow(context);
  } else {
    await openMcpDocumentation();
  }
}
