import { chmodSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const pkgRoot = join(import.meta.dirname, "..");
const entry = join(pkgRoot, "dist", "cli.js");
const outfile = join(pkgRoot, "dist", "agent-resume-mcp.cjs");

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  minify: true,
  outfile
});

chmodSync(outfile, 0o755);
