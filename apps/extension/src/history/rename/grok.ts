import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentSession } from "../types";
import { isNodeError } from "../jsonl";

interface GrokSummary {
  info?: {
    id?: string;
  };
  generated_title?: string;
}

export async function renameGrokSession(grokHome: string, session: AgentSession, title: string): Promise<void> {
  const summaryPath = await findSummaryPath(path.join(grokHome, "sessions"), session.id);
  if (!summaryPath) {
    throw new Error(`Grok summary.json not found for session ${session.id}.`);
  }

  const summary = JSON.parse(await fs.readFile(summaryPath, "utf8")) as GrokSummary;
  summary.generated_title = title;
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

async function findSummaryPath(root: string, sessionId: string): Promise<string | undefined> {
  const summaryPaths = await listSummaryFiles(root);
  for (const summaryPath of summaryPaths) {
    let summary: GrokSummary;
    try {
      summary = JSON.parse(await fs.readFile(summaryPath, "utf8")) as GrokSummary;
    } catch {
      continue;
    }

    const id = summary.info?.id?.trim() || path.basename(path.dirname(summaryPath));
    if (id === sessionId) {
      return summaryPath;
    }
  }

  return undefined;
}

async function listSummaryFiles(root: string): Promise<string[]> {
  const output: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && entry.name === "summary.json") {
        output.push(fullPath);
      }
    }
  }

  await visit(root);
  return output;
}