import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentProvider, AgentSession } from "../history/types";
import type { HcTerminal, HerdrRecordedSession, HerdrSessionMatch } from "./types";

/** Resolves the session a live terminal is running right now, per provider home. */
export type RunningSessionResolver = (term: HcTerminal, provider: string) => string | undefined;

export function herdrSessionKey(provider: string, id: string): string {
  return `${provider}:${id}`;
}

export function normalizeDirPath(dir?: string): string {
  if (!dir) {
    return "";
  }
  const trimmed = dir.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return fs.realpathSync(trimmed);
  } catch {
    return path.resolve(trimmed);
  }
}

export function cleanTerminalTitle(title: string): string {
  if (!title) {
    return "";
  }
  let cleaned = title.replace(/[\u{e000}-\u{f8ff}]/gu, " ");
  cleaned = cleaned.replace(/^(?:π\s*(?:[>»\-•·⏳⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*)*)/u, "");
  cleaned = cleaned.replace(/^(?:PASS|FAIL|DONE|WAIT):\s*/i, "");
  return cleaned.replace(/\s+/g, " ").trim();
}

export function detectTerminalProvider(term: HcTerminal): AgentProvider | undefined {
  const sessionLabel = term.labels?.["alma.session"];
  if (sessionLabel) {
    const prefix = sessionLabel.split(":")[0]?.trim().toLowerCase();
    if (prefix) {
      return normalizeProviderAlias(prefix);
    }
  }

  const raw =
    term.status?.app ||
    term.template ||
    term.foreground?.name ||
    (term.argv?.[0] ? path.basename(term.argv[0]) : "");
  if (!raw) {
    return undefined;
  }
  return normalizeProviderAlias(raw.toLowerCase());
}

function normalizeProviderAlias(norm: string): AgentProvider | undefined {
  if (norm.includes("claude")) {
    return "claude";
  }
  if (norm.includes("codex")) {
    return "codex";
  }
  if (norm === "omp" || norm.startsWith("omp ")) {
    return "omp";
  }
  if (norm === "pi" || norm.startsWith("pi ")) {
    return "pi";
  }
  if (norm === "agy" || norm.includes("antigravity")) {
    return "agy";
  }
  if (norm.includes("opencode")) {
    return "opencode";
  }
  if (norm.includes("grok")) {
    return "grok";
  }
  if (norm.includes("cursor")) {
    return "cursor";
  }
  if (norm.includes("prime")) {
    return "prime";
  }
  return undefined;
}

export function extractSessionIdFromTerminal(
  term: HcTerminal
): { provider?: string; id: string } | undefined {
  const alma = term.labels?.["alma.session"]?.trim();
  if (alma) {
    // Expected format: "<provider>:id:<id>" or "<provider>:<id>"
    const parts = alma.split(":");
    if (parts.length >= 3 && parts[1] === "id") {
      const id = parts.slice(2).join(":").trim();
      if (id) {
        return { provider: normalizeProviderAlias(parts[0].toLowerCase()), id };
      }
    } else if (parts.length === 2 && parts[1].trim()) {
      return { provider: normalizeProviderAlias(parts[0].toLowerCase()), id: parts[1].trim() };
    }
  }

  const argv = [...(term.foreground?.argv ?? []), ...(term.argv ?? [])];
  if (argv.length === 0) {
    return undefined;
  }
  const detectedProvider = detectTerminalProvider(term);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (
      (arg === "--resume" ||
        arg === "-r" ||
        arg === "--session" ||
        arg === "--conversation") &&
      argv[i + 1] &&
      !argv[i + 1].startsWith("-")
    ) {
      return { provider: detectedProvider, id: argv[i + 1] };
    }

    for (const prefix of ["--resume=", "--session=", "--conversation="]) {
      if (arg.startsWith(prefix)) {
        const val = arg.slice(prefix.length).trim();
        if (val) {
          return { provider: detectedProvider, id: val };
        }
      }
    }

    // codex resume [--cd <dir>] <id>
    if (arg === "resume" && detectedProvider === "codex") {
      for (let j = i + 1; j < argv.length; j++) {
        const next = argv[j];
        if (next === "--cd" || next === "-C") {
          j++;
          continue;
        }
        if (!next.startsWith("-")) {
          return { provider: "codex", id: next };
        }
      }
    }
  }

  return undefined;
}

function buildMatchFromTerminal(
  term: HcTerminal,
  spaceNames: Map<string, string>
): HerdrSessionMatch {
  const spaceId = term.labels?.["herdr.space"];
  const spaceName =
    (spaceId ? spaceNames.get(spaceId) : undefined) ||
    term.labels?.where?.split(" / ")[0]?.trim() ||
    undefined;

  return {
    kind: term.state === "live" ? "live" : "finished",
    address: term.address,
    spaceId,
    spaceName,
    agentState: term.status?.state ?? (term.state === "live" ? "idle" : "done"),
    statusMsg: term.status?.msg,
    statusMs: term.status_ms ?? term.finished_ms ?? term.created_ms
  };
}

export function matchSessionToHerdr(
  session: Pick<AgentSession, "provider" | "id" | "title" | "projectPath" | "nativeProjectPath">,
  terminals: HcTerminal[],
  spaceNames: Map<string, string>,
  recordedMap: Map<string, HerdrRecordedSession>,
  resolveRunning?: RunningSessionResolver
): HerdrSessionMatch | undefined {
  // Prefer live terminals over finished ones.
  const ordered = [...terminals].sort((a, b) => {
    if (a.state === "live" && b.state !== "live") return -1;
    if (a.state !== "live" && b.state === "live") return 1;
    return (b.status_ms ?? b.created_ms) - (a.status_ms ?? a.created_ms);
  });

  // 1. Exact session ID match (alma.session or argv resume flag).
  // A label goes stale when the TUI runs `/new` inside the same PTY: it keeps naming the
  // session that just ended. When the terminal's provider can tell us what it is running
  // right now, trust that over the label.
  for (const term of ordered) {
    const extracted = extractSessionIdFromTerminal(term);
    if (!extracted) {
      continue;
    }
    if (extracted.id !== session.id) {
      continue;
    }
    const labelProvider = extracted.provider ?? session.provider;
    if (extracted.provider && extracted.provider !== session.provider) {
      continue;
    }
    const running = resolveRunning?.(term, labelProvider);
    if (running && running !== session.id) {
      continue;
    }
    return buildMatchFromTerminal(term, spaceNames);
  }

  // 1b. Follow the terminal: a live terminal whose tracked session is this one, whatever
  // its label says (covers the session adopted after `/new`).
  if (resolveRunning) {
    for (const term of ordered) {
      if (term.state !== "live") {
        continue;
      }
      if (detectTerminalProvider(term) !== session.provider) {
        continue;
      }
      if (resolveRunning(term, session.provider) === session.id) {
        return buildMatchFromTerminal(term, spaceNames);
      }
    }
  }

  // 2. Fallback: canonical directory + provider + title overlap
  const targetDirs = new Set(
    [session.projectPath, session.nativeProjectPath]
      .map((p) => normalizeDirPath(p))
      .filter(Boolean)
  );
  const normalizedTitle = session.title.trim().toLowerCase();

  if (targetDirs.size > 0 && normalizedTitle.length >= 8) {
    for (const term of ordered) {
      if (detectTerminalProvider(term) !== session.provider) {
        continue;
      }
      const running = resolveRunning?.(term, session.provider);
      if (running && running !== session.id) {
        continue;
      }
      const termDirs = [
        normalizeDirPath(term.foreground?.cwd),
        normalizeDirPath(term.cwd),
        normalizeDirPath(term.labels?.workspace)
      ].filter(Boolean);

      if (!termDirs.some((d) => targetDirs.has(d))) {
        continue;
      }

      const termTitle = cleanTerminalTitle(term.title).toLowerCase();
      if (
        termTitle.length >= 8 &&
        (termTitle.includes(normalizedTitle) || normalizedTitle.includes(termTitle))
      ) {
        return buildMatchFromTerminal(term, spaceNames);
      }
    }
  }

  // 3. Recorded historical Herdr session
  const recorded = recordedMap.get(herdrSessionKey(session.provider, session.id));
  if (recorded) {
    return {
      kind: "recorded",
      address: recorded.lastAddress,
      spaceId: recorded.spaceId,
      spaceName:
        (recorded.spaceId ? spaceNames.get(recorded.spaceId) : undefined) ?? recorded.spaceName,
      statusMs: recorded.updatedAt
    };
  }

  return undefined;
}
