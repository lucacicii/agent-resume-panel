import * as fs from "node:fs/promises";
import * as path from "node:path";
import { normalizeArpConfig } from "./normalize";
import { ARP_CONFIG_FILE_NAME, ARP_DIR_NAME, type ArpConfig } from "./types";

export function arpConfigPath(projectRoot: string): string {
  return path.join(projectRoot, ARP_DIR_NAME, ARP_CONFIG_FILE_NAME);
}

/**
 * Read `<projectRoot>/.arp/config.json`.
 * Missing files, invalid JSON, and non-objects all return null (unset).
 * Does not walk parent directories and does not create the file.
 */
export async function loadArpConfig(projectRoot: string): Promise<ArpConfig | null> {
  const root = projectRoot.trim();
  if (!root) return null;
  const file = arpConfigPath(root);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  return normalizeArpConfig(parsed);
}
