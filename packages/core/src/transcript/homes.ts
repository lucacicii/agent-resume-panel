import { expandHome } from "../pathUtils";
import * as os from "node:os";
import * as path from "node:path";

export const DEFAULT_AGENT_HOMES = {
  codexHome: "~/.codex",
  claudeHome: "~/.claude",
  antigravityHome: "~/.gemini",
  grokHome: "~/.grok",
  opencodeHome: "~/.local/share/opencode",
  piHome: "~/.pi/agent",
  primeHome: "~/.prime/agent",
  ompHome: "~/.omp/agent",
  cursorHome: "~/.cursor"
} as const;

export type AgentHomeKey = keyof typeof DEFAULT_AGENT_HOMES;

export interface AgentHomesSettings {
  codexHome?: string;
  claudeHome?: string;
  antigravityHome?: string;
  grokHome?: string;
  opencodeHome?: string;
  piHome?: string;
  primeHome?: string;
  ompHome?: string;
  cursorHome?: string;
  cursorIdeUserDataHome?: string;
  almaHome?: string;
}

export function defaultAgentHomeValue(key: AgentHomeKey): string {
  return DEFAULT_AGENT_HOMES[key];
}

export function agentHomeDiffersFromDefault(key: AgentHomeKey, value?: string): boolean {
  const raw = value?.trim();
  if (!raw) {
    return false;
  }
  return expandHome(raw) !== expandHome(DEFAULT_AGENT_HOMES[key]);
}

export function sanitizeAgentHomes(homes?: AgentHomesSettings): AgentHomesSettings | undefined {
  if (!homes) {
    return undefined;
  }

  const out: AgentHomesSettings = {};
  for (const key of Object.keys(DEFAULT_AGENT_HOMES) as AgentHomeKey[]) {
    const raw = homes[key]?.trim();
    if (raw && agentHomeDiffersFromDefault(key, raw)) {
      out[key] = raw;
    }
  }
  const cursorIdeUserDataHome = homes.cursorIdeUserDataHome?.trim();
  if (cursorIdeUserDataHome) {
    out.cursorIdeUserDataHome = cursorIdeUserDataHome;
  }
  const almaHome = homes.almaHome?.trim();
  if (almaHomeDiffersFromDefault(almaHome)) {
    out.almaHome = almaHome;
  }

  return Object.keys(out).length ? out : undefined;
}

export function almaHomeDiffersFromDefault(value?: string): boolean {
  const raw = value?.trim();
  if (!raw) {
    return false;
  }
  return expandHome(raw) !== expandHome(defaultAlmaHome());
}

export function defaultCursorIdeUserDataHome(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Cursor", "User");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Cursor", "User");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Cursor", "User");
}

export function defaultAlmaHome(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "alma");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "alma");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "alma");
}
