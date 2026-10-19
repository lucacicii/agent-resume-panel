import * as fs from "node:fs";
import type { AgentProvider } from "../catalog/types";
import { defaultShellKind, quoteCmd, quotePosix, quotePowerShell, shellQuoteFor, type ShellKind } from "../platform";

/**
 * Agent launch commands.
 *
 * Two output shapes are produced from the same provider table:
 *
 *   - `build*Argv` — an argv array. No shell parses it, so paths with spaces,
 *     quotes, `&`, `%` or parentheses are safe. Preferred everywhere the caller
 *     spawns the process itself (Desktop PTY, ACP, arpm).
 *   - `build*Command` — a command line for a specific shell dialect. Used when
 *     the text is typed into a terminal the app does not own (external terminal,
 *     clipboard, extension `sendText`).
 *
 * The task-context file is read here and passed as one argument. It used to be
 * injected as `$(cat '…')`, which only POSIX shells expand: cmd.exe runs it as
 * literal text, and PowerShell flattens the multi-line block into one line.
 */

export type CommandShell = ShellKind;

/** Resume runs in the session's assigned project (user-move aware). */
export function buildResumeArgv(session: { id: string; provider: AgentProvider; projectPath: string }, contextFile?: string): string[] {
  return withSessionContextArgv(resumeArgvFor(session), session.provider, contextFile);
}

function resumeArgvFor(session: { id: string; provider: AgentProvider; projectPath: string }): string[] {
  const cwd = session.projectPath;
  switch (session.provider) {
    case "codex":
      return ["codex", "resume", "--cd", cwd, session.id];
    case "agy":
      return ["agy", "--conversation", session.id];
    case "grok":
      return ["grok", "--cwd", cwd, "--resume", session.id];
    case "opencode":
      return ["opencode", "--session", session.id];
    case "pi":
      return ["pi", "--session", session.id];
    case "prime":
      return ["prime-agent", "--resume", session.id];
    case "omp":
      return ["omp", "-r", session.id];
    case "cursor":
      return ["cursor-agent", "--workspace", cwd, "--resume", session.id];
    case "cursor-ide":
      throw new Error("Cursor IDE chats cannot be resumed by command; open the project in Cursor instead.");
    default:
      return ["claude", "--resume", session.id];
  }
}

export type NewSessionExecutionMode = "standard" | "yolo";

export function supportsNewSessionYoloMode(provider: AgentProvider): boolean {
  return (
    provider === "codex" ||
    provider === "claude" ||
    provider === "agy" ||
    provider === "grok" ||
    provider === "opencode" ||
    provider === "prime" ||
    provider === "omp" ||
    provider === "cursor"
  );
}

export function buildNewSessionArgv(
  provider: AgentProvider,
  projectPath: string,
  mode: NewSessionExecutionMode,
  contextFile?: string
): string[] {
  return withSessionContextArgv(newSessionArgvFor(provider, projectPath, mode), provider, contextFile);
}

function newSessionArgvFor(
  provider: AgentProvider,
  projectPath: string,
  mode: NewSessionExecutionMode
): string[] {
  if (mode === "yolo") {
    switch (provider) {
      case "codex":
        return ["codex", "--cd", projectPath, "--dangerously-bypass-approvals-and-sandbox"];
      case "claude":
        return ["claude", "--dangerously-skip-permissions"];
      case "agy":
        return ["agy", "--dangerously-skip-permissions"];
      case "grok":
        return ["grok", "--cwd", projectPath, "--permission-mode", "bypassPermissions", "--sandbox", "off"];
      case "opencode":
        return ["opencode", projectPath, "--auto"];
      case "prime":
        return ["prime-agent", "--autonomous"];
      case "omp":
        return ["omp", "--auto-approve"];
      case "cursor":
        return ["cursor-agent", "--workspace", projectPath, "--yolo", "--sandbox", "disabled", "--approve-mcps"];
      default:
        throw new Error(`YOLO mode is not supported for provider: ${provider}.`);
    }
  }

  switch (provider) {
    case "codex":
      return ["codex", "--cd", projectPath];
    case "agy":
      return ["agy"];
    case "grok":
      return ["grok", "--cwd", projectPath];
    case "opencode":
      return ["opencode", projectPath];
    case "pi":
      return ["pi"];
    case "prime":
      return ["prime-agent"];
    case "omp":
      return ["omp"];
    case "cursor":
      return ["cursor-agent", "--workspace", projectPath];
    case "cursor-ide":
      throw new Error("Cursor IDE chats cannot be created from the terminal.");
    default:
      return ["claude"];
  }
}

/**
 * Arguments that hand one session the contents of `contextFile` as extra
 * system prompt text. Returns [] for providers without a verified flag.
 */
export function sessionContextArgs(provider: AgentProvider, contextFile: string): string[] {
  const text = readContextFile(contextFile);
  if (text == null) return [];
  if (provider === "codex") {
    // `-c` values are TOML when they parse, literal text otherwise. The block
    // starts with an HTML comment, so it always arrives as literal text.
    return ["-c", `developer_instructions=${text}`];
  }
  if (provider === "claude" || provider === "pi" || provider === "prime" || provider === "omp") {
    return ["--append-system-prompt", text];
  }
  return [];
}

/** Whether `sessionContextArgs` can deliver context for this provider. */
export function supportsSessionContext(provider: AgentProvider): boolean {
  return (
    provider === "codex" ||
    provider === "claude" ||
    provider === "pi" ||
    provider === "prime" ||
    provider === "omp"
  );
}

function readContextFile(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function withSessionContextArgv(argv: string[], provider: AgentProvider, contextFile?: string): string[] {
  const file = contextFile?.trim();
  if (!file) return argv;
  return [...argv, ...sessionContextArgs(provider, file)];
}

// ------------------------------------------------------------ command strings

/**
 * Render an argv as a command line for `shell`.
 *
 * `platform` only selects the default dialect when the caller does not know
 * the target shell.
 */
export function buildResumeCommand(
  session: { id: string; provider: AgentProvider; projectPath: string },
  contextFile?: string,
  shell: CommandShell = defaultShellKind()
): string {
  return joinForShell(buildResumeArgv(session, contextFile), shell);
}

export function buildNewSessionCommand(
  provider: AgentProvider,
  projectPath: string,
  mode: NewSessionExecutionMode,
  contextFile?: string,
  shell: CommandShell = defaultShellKind()
): string {
  return joinForShell(buildNewSessionArgv(provider, projectPath, mode, contextFile), shell);
}

/**
 * Render an argv as a command line for `shell`.
 *
 * The executable is not quoted unless it must be: PowerShell parses a leading
 * `'claude'` as a string literal and never invokes it. Flags stay bare too —
 * `'--cd'` is a valid string argument but reads like noise in a copied command.
 */
export function joinForShell(argv: readonly string[], shell: CommandShell): string {
  if (argv.length === 0) return "";
  const [file, ...args] = argv;
  return [quoteExecutable(file!, shell), ...args.map((part) => quoteArgument(part, shell))].join(" ");
}

function quoteExecutable(file: string, shell: CommandShell): string {
  if (!/[\s'"&<>|^()]/.test(file)) return file;
  if (shell === "cmd") return quoteCmd(file);
  if (shell === "powershell") return `& ${quotePowerShell(file)}`;
  return quotePosix(file);
}

/** Flags and plain words stay bare; anything a shell would split is quoted. */
function quoteArgument(value: string, shell: CommandShell): string {
  if (/^--?[A-Za-z0-9][A-Za-z0-9-]*$/.test(value)) return value;
  if (shell === "cmd") return quoteCmd(value);
  if (shell === "powershell") return quotePowerShell(value);
  return quotePosix(value);
}

/**
 * Quote a path for a shell. Kept as the one entry point for callers that build
 * their own command lines (Thunder TUI, drag-and-drop into a pane).
 */
export function shellQuote(value: string, shell: CommandShell = defaultShellKind()): string {
  return shellQuoteFor(shell, value);
}

/** Kept for the arpm `cd` hint, which is always a PowerShell/POSIX command line. */
export function powerShellQuote(value: string): string {
  return quotePowerShell(value);
}
