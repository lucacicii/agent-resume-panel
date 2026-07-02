import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runSqliteJson } from "../../history/sqlite";
import { CatalogSessionRow } from "../types";
import { parseTranscriptRefs } from "./types";
import { readTranscriptFiles } from "./read";

export interface CatalogExportResult {
  outputDir: string;
  sessionCount: number;
  transcriptFileCount: number;
  missingTranscriptCount: number;
  warnings: string[];
}

export interface CatalogExportSessionKey {
  provider: string;
  id: string;
}

export interface CatalogExportOptions {
  dbPath: string;
  outputDir: string;
  includeHidden?: boolean;
  providers?: string[];
  onlySessions?: CatalogExportSessionKey[];
}

export async function exportCatalogWithTranscripts(options: CatalogExportOptions): Promise<CatalogExportResult> {
  const warnings: string[] = [];
  const includeHidden = options.includeHidden ?? false;
  const whereParts = includeHidden ? [] : ["hidden = 0"];
  if (options.providers?.length) {
    const list = options.providers.map((p) => `'${p.replaceAll("'", "''")}'`).join(", ");
    whereParts.push(`provider IN (${list})`);
  }
  const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  let rows = await runSqliteJson<CatalogSessionRow & { transcript_kind: string | null; transcript_refs: string | null }>(
    options.dbPath,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms,
      transcript_kind, transcript_refs
     FROM sessions
     ${where}
     ORDER BY updated_at_ms DESC;`
  );

  if (options.onlySessions?.length) {
    const keys = new Set(options.onlySessions.map((s) => `${s.provider}\u0000${s.id}`));
    rows = rows.filter((row) => keys.has(`${row.provider}\u0000${row.agent_session_id}`));
  }

  await fs.mkdir(options.outputDir, { recursive: true });
  const sessionsDir = path.join(options.outputDir, "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });

  const manifest = {
    exportedAt: new Date().toISOString(),
    sessionCount: rows.length,
    sessions: rows.map((row) => ({
      provider: row.provider,
      id: row.agent_session_id,
      title: row.user_title?.trim() || row.title,
      projectPath: row.project_path,
      updatedAtMs: row.updated_at_ms,
      transcriptKind: row.transcript_kind,
      transcriptRefs: parseTranscriptRefs(row.transcript_refs)
    }))
  };

  await fs.writeFile(path.join(options.outputDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  let transcriptFileCount = 0;
  let missingTranscriptCount = 0;

  for (const row of rows) {
    const refs = parseTranscriptRefs(row.transcript_refs);
    const sessionDir = path.join(sessionsDir, safeDirName(`${row.provider}__${row.agent_session_id}`));
    await fs.mkdir(sessionDir, { recursive: true });

    const metadata = {
      ...row,
      displayTitle: row.user_title?.trim() || row.title,
      transcriptRefs: refs
    };
    await fs.writeFile(path.join(sessionDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

    if (!refs) {
      missingTranscriptCount += 1;
      warnings.push(`No transcript refs for ${row.provider}/${row.agent_session_id}`);
      continue;
    }

    if (refs.kind === "unavailable") {
      missingTranscriptCount += 1;
      if (refs.reason) {
        warnings.push(`${row.provider}/${row.agent_session_id}: ${refs.reason}`);
      }
      continue;
    }

    const transcriptDir = path.join(sessionDir, "transcripts");
    await fs.mkdir(transcriptDir, { recursive: true });

    const files = await readTranscriptFiles(refs);
    for (const file of files) {
      if (file.missing) {
        missingTranscriptCount += 1;
        warnings.push(`Missing file at export: ${file.sourcePath}`);
        continue;
      }
      const destName = await uniqueFileName(transcriptDir, file.fileName);
      await fs.writeFile(path.join(transcriptDir, destName), file.content, "utf8");
      transcriptFileCount += 1;
    }
  }

  return {
    outputDir: options.outputDir,
    sessionCount: rows.length,
    transcriptFileCount,
    missingTranscriptCount,
    warnings
  };
}

function safeDirName(input: string): string {
  return input.replaceAll(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

async function uniqueFileName(dir: string, baseName: string): Promise<string> {
  let candidate = baseName;
  let index = 1;
  while (true) {
    try {
      await fs.access(path.join(dir, candidate));
      const ext = path.extname(baseName);
      const stem = path.basename(baseName, ext);
      candidate = `${stem}-${index}${ext}`;
      index += 1;
    } catch {
      return candidate;
    }
  }
}