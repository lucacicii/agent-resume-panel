import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadSettings, effectivePanelHome } from "./store";
import {
  buildMentionPrompt,
  normalizeWorkbenchComposerMentions,
  resolveMention
} from "./mentions";
import type { WorkbenchComposerMention } from "./types";
import {
  buildNewSessionCommand,
  supportsSessionContext,
  type NewSessionExecutionMode
} from "../terminal/commands";
import { desktopDataDir } from "../panelHome";
import type { AgentProvider } from "../catalog/types";

const USAGE = `Usage:
  arpm list
  arpm prompt <id>
  arpm go <id> [--print-cwd] [--launch] [--provider <cli-provider>] [--yolo]
  arpm run [--provider <cli-provider>] [--note <work-item-id>] [--yolo]

Workspace packs live in ~/.agent-resume-panel/settings.desktop.json
under workbench.composerMentions.

"arpm run" starts an agent in the current directory. With --note it also hands
the work item's context (address table, background knowledge) to the session.`;

function mentionList(mentions: WorkbenchComposerMention[]): string {
  if (!mentions.length) return "No workspace mentions configured.";
  return mentions
    .map((mention) => {
      const refs = mention.roots.filter((root) => root.role === "reference").map((root) => root.path);
      const refPart = refs.length ? `\n  reference:\n${refs.map((item) => `    ${item}`).join("\n")}` : "";
      return `${mention.id}\n  cwd: ${mention.cwd}${refPart}`;
    })
    .join("\n\n");
}

async function loadMentions(): Promise<WorkbenchComposerMention[]> {
  const settings = await loadSettings(process.env.AGENT_RESUME_PANEL_HOME || undefined);
  return normalizeWorkbenchComposerMentions(settings.workbench?.composerMentions);
}

function requireMention(mentions: WorkbenchComposerMention[], id: string): WorkbenchComposerMention {
  const mention = resolveMention(mentions, id);
  if (!mention) {
    throw new Error(`Unknown mention: ${id}`);
  }
  return mention;
}

const CLI_PROVIDERS = new Set<string>([
  "codex",
  "claude",
  "grok",
  "agy",
  "opencode",
  "pi",
  "prime",
  "cursor"
]);

function parseGoFlags(args: string[]): {
  id: string;
  printCwd: boolean;
  launch: boolean;
  provider: AgentProvider;
  yolo: boolean;
} {
  let printCwd = false;
  let launch = false;
  let yolo = false;
  let provider: AgentProvider = "codex";
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--print-cwd") {
      printCwd = true;
      continue;
    }
    if (arg === "--launch") {
      launch = true;
      continue;
    }
    if (arg === "--yolo") {
      yolo = true;
      continue;
    }
    if (arg === "--provider") {
      const next = args[i + 1];
      if (!next || !CLI_PROVIDERS.has(next)) {
        throw new Error("`--provider` requires a CLI agent (codex, claude, grok, agy, opencode, pi, prime, cursor).");
      }
      provider = next as AgentProvider;
      i += 1;
      continue;
    }
    rest.push(arg);
  }
  const id = rest[0]?.trim() || "";
  if (!id || rest.length > 1) {
    throw new Error("Usage: arpm go <id> [--print-cwd] [--launch] [--provider <cli-provider>] [--yolo]");
  }
  return { id, printCwd, launch, provider, yolo };
}

function parseRunFlags(args: string[]): {
  provider?: AgentProvider;
  noteId?: string;
  yolo: boolean;
} {
  let provider: AgentProvider | undefined;
  let noteId: string | undefined;
  let yolo = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--yolo") {
      yolo = true;
      continue;
    }
    if (arg === "--provider" || arg === "--note") {
      const next = args[i + 1]?.trim();
      if (!next) throw new Error(`\`${arg}\` requires a value.`);
      if (arg === "--provider") {
        if (!CLI_PROVIDERS.has(next)) {
          throw new Error("`--provider` requires a CLI agent (codex, claude, grok, agy, opencode, pi, prime, cursor).");
        }
        provider = next as AgentProvider;
      } else {
        noteId = next;
      }
      i += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return { provider, noteId, yolo };
}

/** The context block a work item hands to its sessions. */
export function workItemContextPath(panelHome: string, noteId: string): string {
  return path.join(desktopDataDir(panelHome), "workspaces", noteId, "AGENTS.md");
}

/**
 * What `arpm run` executes. The session keeps the current directory — the panel
 * opens the terminal in the work item's repository or in its neutral workspace —
 * and the work item's context arrives through the agent's own
 * append-system-prompt channel either way.
 */
export async function planArpmRun(input: {
  args: string[];
  cwd: string;
  panelHome: string;
  settings: Awaited<ReturnType<typeof loadSettings>>;
}): Promise<{ command: string; warning?: string }> {
  const flags = parseRunFlags(input.args);
  const configured = String(input.settings.workbench?.defaultNewSessionProvider || "").trim();
  const provider = flags.provider ?? ((configured || "codex") as AgentProvider);
  if (!CLI_PROVIDERS.has(provider)) {
    throw new Error(`\`${provider}\` is not a CLI agent. Pass --provider <cli-provider>.`);
  }

  let contextFile: string | undefined;
  let warning: string | undefined;
  if (flags.noteId) {
    contextFile = workItemContextPath(input.panelHome, flags.noteId);
    if (!(await fs.stat(contextFile).then(() => true).catch(() => false))) {
      throw new Error(
        `No agent context for work item ${flags.noteId} yet. Start a session for it from Agent Resume first.`
      );
    }
    if (!supportsSessionContext(provider)) {
      warning = `${provider} has no session instruction flag; the work item context is not injected.`;
      contextFile = undefined;
    }
  }

  const mode: NewSessionExecutionMode = flags.yolo ? "yolo" : "standard";
  return { command: buildNewSessionCommand(provider, input.cwd, mode, contextFile), warning };
}

function spawnDetached(command: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: "inherit",
      detached: false
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`Command exited with code ${code}`));
    });
  });
}

export async function runArpmCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "-h" || command === "--help" || command === "help") {
    console.log(USAGE);
    return command ? 0 : 1;
  }

  try {
    const mentions = await loadMentions();
    if (command === "list") {
      console.log(mentionList(mentions));
      return 0;
    }
    if (command === "prompt") {
      const id = rest[0]?.trim() || "";
      if (!id || rest.length > 1) {
        throw new Error("Usage: arpm prompt <id>");
      }
      console.log(buildMentionPrompt(requireMention(mentions, id)));
      return 0;
    }
    if (command === "go") {
      const flags = parseGoFlags(rest);
      const mention = requireMention(mentions, flags.id);
      if (flags.printCwd) {
        console.log(mention.cwd);
        return 0;
      }
      console.log(buildMentionPrompt(mention));
      if (flags.launch) {
        const mode: NewSessionExecutionMode = flags.yolo ? "yolo" : "standard";
        const commandLine = buildNewSessionCommand(flags.provider, mention.cwd, mode);
        await spawnDetached(commandLine, mention.cwd);
        return 0;
      }
      console.log(`cd ${shellSingleQuote(mention.cwd)}`);
      return 0;
    }
    if (command === "run") {
      const settings = await loadSettings(process.env.AGENT_RESUME_PANEL_HOME || undefined);
      const plan = await planArpmRun({
        args: rest,
        cwd: process.cwd(),
        panelHome: effectivePanelHome(settings, process.env.AGENT_RESUME_PANEL_HOME || undefined),
        settings
      });
      if (plan.warning) console.error(plan.warning);
      await spawnDetached(plan.command, process.cwd());
      return 0;
    }
    throw new Error(USAGE);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
