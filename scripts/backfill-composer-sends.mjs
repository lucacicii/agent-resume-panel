#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanupImportedComposerSends,
  ensureDesktopDbSchema,
  importComposerSendsForSession,
  loadSettings,
  resolvePanelDbPathsFromSettings,
  resolvePreviewHomes,
  runSqliteJson,
  toAgentSession
} from "../packages/core/dist/index.js";

function parseArgs(args) {
  const options = {
    provider: null,
    limit: null,
    verbose: false,
    cleanupOnly: false,
    skipCleanup: false,
    help: false
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg.startsWith("--provider=")) {
      options.provider = arg.slice("--provider=".length).trim();
    } else if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = Math.floor(parsed);
      }
    } else if (arg === "--cleanup-only") {
      options.cleanupOnly = true;
    } else if (arg === "--skip-cleanup") {
      options.skipCleanup = true;
    }
  }

  return options;
}

function usage() {
  console.log(`Usage: node scripts/backfill-composer-sends.mjs [options]

Backfill historical session transcripts into workbench_composer_sends.
Idempotent and append-only: duplicate texts under the same session are skipped.

Options:
  --provider=<name>  Only process sessions from this provider (e.g. pi, codex, claude)
  --limit=<number>   Max number of sessions to scan
  --cleanup-only     Only delete duplicate/noise/live-shadowed import rows, skip re-import
  --skip-cleanup     Skip the pre-import cleanup (not recommended on a polluted db)
  --verbose, -v      Print results for every session (default: only show imported > 0)
  --help, -h         Show this help message
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  console.log("[backfill] Resolving settings and database paths...");
  const settings = await loadSettings();
  const paths = await resolvePanelDbPathsFromSettings();

  if (!fs.existsSync(paths.catalogDb)) {
    console.error(`[backfill] Catalog database not found: ${paths.catalogDb}`);
    process.exit(1);
  }

  console.log(`[backfill] Catalog DB: ${paths.catalogDb}`);
  console.log(`[backfill] Desktop DB: ${paths.desktopDb}`);

  await ensureDesktopDbSchema(paths.desktopDb);
  const homes = resolvePreviewHomes(settings);

  if (!options.skipCleanup) {
    console.log("[backfill] Cleaning duplicate/noise import rows first...");
    const cleanup = await cleanupImportedComposerSends(paths.desktopDb);
    console.log(
      `[backfill] Cleanup: -${cleanup.deletedDuplicates} duplicates, ` +
      `-${cleanup.deletedNoise} noise, -${cleanup.deletedLiveConflicts} live twins ` +
      `(kept ${cleanup.keptLiveRows} live rows).\n`
    );
  }

  if (options.cleanupOnly) {
    console.log("[backfill] Cleanup-only mode: skipping re-import.");
    return;
  }

  let whereClause = "";
  if (options.provider) {
    whereClause = `WHERE provider = '${options.provider.replace(/'/g, "''")}'`;
  }
  let limitClause = "";
  if (options.limit != null) {
    limitClause = `LIMIT ${options.limit}`;
  }

  const query = `
    SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms,
      session_summary, session_summary_language, session_summary_at_ms, project_id, native_project_path
    FROM sessions
    ${whereClause}
    ORDER BY updated_at_ms DESC
    ${limitClause};
  `.trim();

  const rows = await runSqliteJson(paths.catalogDb, query);
  const sessions = rows.map((row) => toAgentSession(row));

  console.log(`[backfill] Found ${sessions.length} sessions to scan${options.provider ? ` (provider: ${options.provider})` : ""}.\n`);

  if (!sessions.length) {
    console.log("[backfill] Nothing to do.");
    return;
  }

  const startTime = Date.now();
  let totalImported = 0;
  let totalFound = 0;
  let totalSkipped = 0;
  let sessionsWithImports = 0;
  let errors = 0;

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const indexStr = `[${i + 1}/${sessions.length}]`;
    const tag = `${session.provider}:${session.id}`;

    try {
      const result = await importComposerSendsForSession(paths.desktopDb, session, homes);
      totalFound += result.found;
      totalSkipped += result.skipped;

      if (result.imported > 0) {
        sessionsWithImports += 1;
        totalImported += result.imported;
        console.log(`${indexStr} ${tag} (${session.title || "untitled"}) -> +${result.imported} imported (found ${result.found}, skipped ${result.skipped})`);
      } else if (options.verbose) {
        console.log(`${indexStr} ${tag} -> 0 imported (found ${result.found}, skipped ${result.skipped})`);
      } else if ((i + 1) % 50 === 0) {
        process.stdout.write(`... scanned ${i + 1}/${sessions.length} sessions\r`);
      }
    } catch (error) {
      errors += 1;
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`${indexStr} ${tag} ERROR: ${msg}`);
    }
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n=========================================`);
  console.log(`Composer Sends Backfill Complete`);
  console.log(`=========================================`);
  console.log(`Scanned sessions:           ${sessions.length}`);
  console.log(`Sessions with new imports:  ${sessionsWithImports}`);
  console.log(`Total messages imported:    ${totalImported}`);
  console.log(`Total user messages found:  ${totalFound}`);
  console.log(`Total skipped (seen/noise): ${totalSkipped}`);
  if (errors > 0) {
    console.log(`Errors encountered:         ${errors}`);
  }
  console.log(`Time elapsed:               ${elapsedSec}s`);
  console.log(`=========================================\n`);
}

main().catch((err) => {
  console.error("[backfill] Fatal error:", err);
  process.exit(1);
});
