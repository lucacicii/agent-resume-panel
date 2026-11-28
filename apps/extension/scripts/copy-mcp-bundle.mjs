#!/usr/bin/env node

import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const extensionRoot = join(import.meta.dirname, "..");
const repoRoot = join(extensionRoot, "..", "..");
const src = join(repoRoot, "packages", "mcp", "dist", "agent-resume-mcp.cjs");
const dest = join(extensionRoot, "out", "mcp-server.cjs");

if (!existsSync(src)) {
  throw new Error(`Missing MCP bundle: ${src}. Run pnpm run build:mcp first.`);
}

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
chmodSync(dest, 0o755);
console.log(`Copied MCP bundle → ${dest}`);
