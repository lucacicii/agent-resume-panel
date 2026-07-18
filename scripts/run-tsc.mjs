#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = [...argv];
  let cwd = process.cwd();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cwd") {
      const value = args[i + 1];
      if (!value) throw new Error("Missing value for --cwd");
      cwd = path.resolve(value);
      args.splice(i, 2);
      break;
    }
  }

  return { cwd, tscArgs: args };
}

/**
 * Resolve typescript/bin/tsc for a package cwd.
 * Walks package → parents → monorepo root so isolated pnpm links or a
 * partially repaired node_modules still find a workspace TypeScript.
 */
function resolveTscBin(cwd) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const candidates = [];

  let dir = path.resolve(cwd);
  for (let i = 0; i < 8; i++) {
    candidates.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!candidates.includes(repoRoot)) {
    candidates.push(repoRoot);
  }

  const errors = [];
  for (const base of candidates) {
    const pkgJson = path.join(base, "package.json");
    if (!fs.existsSync(pkgJson)) continue;
    try {
      const require = createRequire(pkgJson);
      return require.resolve("typescript/bin/tsc");
    } catch (error) {
      errors.push(`${base}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    `Missing TypeScript for ${cwd}. Run \`pnpm install\` from the repo root.\n` +
      `Tried:\n- ${errors.join("\n- ")}`
  );
}

const { cwd, tscArgs } = parseArgs(process.argv.slice(2));
const tscBin = resolveTscBin(cwd);

execFileSync(process.execPath, [tscBin, ...tscArgs], {
  cwd,
  stdio: "inherit"
});
