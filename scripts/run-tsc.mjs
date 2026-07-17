#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

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

function resolveTscBin(cwd) {
  const require = createRequire(path.join(cwd, "package.json"));
  try {
    return require.resolve("typescript/bin/tsc");
  } catch {
    throw new Error(
      `Missing TypeScript for ${cwd}. Run \`pnpm install\` from the repo root.`
    );
  }
}

const { cwd, tscArgs } = parseArgs(process.argv.slice(2));
const tscBin = resolveTscBin(cwd);

execFileSync(process.execPath, [tscBin, ...tscArgs], {
  cwd,
  stdio: "inherit"
});
