import { COMMIT_INSTRUCTION_MAX_CHARS, type CommitMessageStyle } from "../git/prompts";
import {
  ARP_CONFIG_VERSION,
  type ArpConfig,
  type ArpGitCommitMessageConfig,
  type ArpImConfig,
  type ArpSharedConfig,
  type ArpWorkbenchConfig,
  type ArpWorkbenchGitConfig
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseVersion(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return ARP_CONFIG_VERSION;
}

function parseCommitMessageStyle(value: unknown): CommitMessageStyle | undefined {
  return value === "conventional" || value === "gitmoji" || value === "custom" ? value : undefined;
}

function parseInstructions(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, COMMIT_INSTRUCTION_MAX_CHARS);
}

function normalizeGitCommitMessage(value: unknown): ArpGitCommitMessageConfig | undefined {
  if (!isRecord(value)) return undefined;
  const commitMessage: ArpGitCommitMessageConfig = {};
  const style = parseCommitMessageStyle(value.style);
  const customInstructions = parseInstructions(value.customInstructions);
  const extraInstructions = parseInstructions(value.extraInstructions);
  if (style) commitMessage.style = style;
  if (customInstructions) commitMessage.customInstructions = customInstructions;
  if (extraInstructions) commitMessage.extraInstructions = extraInstructions;
  return Object.keys(commitMessage).length ? commitMessage : undefined;
}

function normalizeWorkbenchGit(value: unknown): ArpWorkbenchGitConfig | undefined {
  if (!isRecord(value)) return undefined;
  const commitMessage = normalizeGitCommitMessage(value.commitMessage);
  if (!commitMessage) return undefined;
  return { commitMessage };
}

function normalizeWorkbench(value: unknown): ArpWorkbenchConfig | undefined {
  if (!isRecord(value)) return undefined;
  const git = normalizeWorkbenchGit(value.git);
  if (!git) return undefined;
  return { git };
}

function normalizeShared(value: unknown): ArpSharedConfig | undefined {
  if (!isRecord(value)) return undefined;
  return undefined;
}

function normalizeIm(value: unknown): ArpImConfig | undefined {
  if (!isRecord(value)) return undefined;
  return undefined;
}

/** Drop unknown keys / invalid values. Returns null when `raw` is not an object. */
export function normalizeArpConfig(raw: unknown): ArpConfig | null {
  if (!isRecord(raw)) return null;
  const config: ArpConfig = { version: parseVersion(raw.version) };
  const shared = normalizeShared(raw.shared);
  const workbench = normalizeWorkbench(raw.workbench);
  const im = normalizeIm(raw.im);
  if (shared) config.shared = shared;
  if (workbench) config.workbench = workbench;
  if (im) config.im = im;
  return config;
}
