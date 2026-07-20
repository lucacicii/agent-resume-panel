import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Stable per-machine id for project_local_paths.
 * Stored outside panelHome so cloud-sync of ~/.agent-resume-panel does not clone identity.
 */
export function machineIdFilePath(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "agent-resume-panel", "machine-id");
  }
  if (process.platform === "win32") {
    const base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "agent-resume-panel", "machine-id");
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "agent-resume-panel", "machine-id");
}

let cachedMachineId: string | null = null;

export async function getMachineId(): Promise<string> {
  if (cachedMachineId) {
    return cachedMachineId;
  }
  const filePath = machineIdFilePath();
  try {
    const existing = (await fs.readFile(filePath, "utf8")).trim();
    if (existing) {
      cachedMachineId = existing;
      return existing;
    }
  } catch {
    // create below
  }
  const id = randomUUID();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${id}\n`, "utf8");
  cachedMachineId = id;
  return id;
}

/** Test helper — clears in-memory cache. */
export function resetMachineIdCache(): void {
  cachedMachineId = null;
}
