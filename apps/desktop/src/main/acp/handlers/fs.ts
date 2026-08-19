import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export type PlanWriteListener = (info: { path: string; content: string }) => void;

let planWriteListener: PlanWriteListener | null = null;

export function setPlanWriteListener(listener: PlanWriteListener | null): void {
  planWriteListener = listener;
}

/** Heuristic: Grok session plans and common agent plan filenames. */
export function isPlanFilePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const base = path.basename(normalized).toLowerCase();
  if (base === "plan.md" || base.endsWith(".plan.md")) return true;
  // Grok Build: ~/.grok/sessions/<...>/plan.md
  if (normalized.includes("/.grok/sessions/") && base === "plan.md") return true;
  return false;
}

/** Allow re-read of plan files under home (sessions / agent data). */
export function isReadablePlanPath(filePath: string): boolean {
  if (!isPlanFilePath(filePath)) return false;
  const resolved = path.resolve(filePath);
  const home = path.resolve(os.homedir());
  const relative = path.relative(home, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  return true;
}

export async function readTextFile(params: {
  path: string;
  line?: number | null;
  limit?: number | null;
}): Promise<{ content: string }> {
  const raw = await fs.readFile(params.path, "utf8");
  if (params.line == null) {
    return { content: raw };
  }
  const lines = raw.split("\n");
  const start = Math.max(0, params.line - 1);
  const limit = params.limit ?? lines.length;
  return { content: lines.slice(start, start + limit).join("\n") };
}

export async function writeTextFile(params: { path: string; content: string }): Promise<Record<string, never>> {
  await fs.mkdir(path.dirname(params.path), { recursive: true });
  await fs.writeFile(params.path, params.content, "utf8");
  if (isPlanFilePath(params.path) && planWriteListener) {
    try {
      planWriteListener({ path: params.path, content: params.content });
    } catch {
      // UI notification must not fail the agent write.
    }
  }
  return {};
}

export async function readPlanFile(filePath: string): Promise<{ content: string; path: string }> {
  if (!isReadablePlanPath(filePath)) {
    throw new Error("Plan path is not allowed.");
  }
  const content = await fs.readFile(path.resolve(filePath), "utf8");
  return { content, path: path.resolve(filePath) };
}
