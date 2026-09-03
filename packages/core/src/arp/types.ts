import type { CommitMessageStyle } from "../git/prompts";

/** Schema version currently understood by the loader. Missing `version` is treated as 1. */
export const ARP_CONFIG_VERSION = 1;
export const ARP_DIR_NAME = ".arp";
export const ARP_CONFIG_FILE_NAME = "config.json";

/**
 * Cross-module project facts (language, display name, …).
 * Slot only: add named fields here when more than one module must read them.
 */
export type ArpSharedConfig = {
  readonly _slot?: never;
};

/**
 * IM-only project settings.
 * Slot only: do not read `workbench.*` from IM, or `im.*` from Workbench.
 */
export type ArpImConfig = {
  readonly _slot?: never;
};

export type ArpGitCommitMessageConfig = {
  style?: CommitMessageStyle;
  /** Format rules used when `style` is `custom`. */
  customInstructions?: string;
  /** Appended to the selected style (including custom). */
  extraInstructions?: string;
};

export type ArpWorkbenchGitConfig = {
  commitMessage?: ArpGitCommitMessageConfig;
};

export type ArpWorkbenchConfig = {
  git?: ArpWorkbenchGitConfig;
};

/**
 * Project-level Agent Resume config at `<repo>/.arp/config.json`.
 * Unknown top-level keys are ignored. Missing groups mean “unset”, not empty override.
 */
export type ArpConfig = {
  version: number;
  shared?: ArpSharedConfig;
  workbench?: ArpWorkbenchConfig;
  im?: ArpImConfig;
};
