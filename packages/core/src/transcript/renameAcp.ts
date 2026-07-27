import * as fs from "node:fs/promises";
import * as path from "node:path";

interface AcpSessionRow {
  id?: string;
  title?: string;
  [key: string]: unknown;
}

/**
 * Update title on panelHome/acp/sessions.jsonl for an ACP chat id.
 * Last write wins per id (same model as desktop store).
 */
export async function renameAcpSessionInStore(
  panelHome: string,
  sessionId: string,
  newTitle: string
): Promise<void> {
  const title = newTitle.replace(/\s+/g, " ").trim().slice(0, 180);
  if (!title) {
    throw new Error("Session title cannot be empty.");
  }
  const id = sessionId.trim();
  if (!id) {
    throw new Error("Session id cannot be empty.");
  }

  const sessionsPath = path.join(panelHome, "acp", "sessions.jsonl");
  let raw = "";
  try {
    raw = await fs.readFile(sessionsPath, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      throw new Error(`ACP session not found: ${id}`);
    }
    throw error;
  }

  const byId = new Map<string, AcpSessionRow>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as AcpSessionRow;
      if (row.id) byId.set(row.id, row);
    } catch {
      /* skip */
    }
  }

  const existing = byId.get(id);
  if (!existing) {
    throw new Error(`ACP session not found: ${id}`);
  }
  byId.set(id, { ...existing, title, updatedAt: Date.now() });

  const lines = [...byId.values()]
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .map((row) => JSON.stringify(row));
  await fs.mkdir(path.dirname(sessionsPath), { recursive: true });
  await fs.writeFile(sessionsPath, lines.length ? `${lines.join("\n")}\n` : "", "utf8");
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}
