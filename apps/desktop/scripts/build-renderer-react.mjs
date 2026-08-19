import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const entryPoint = path.join(root, "src", "renderer-react", "main.tsx");
const outfile = path.join(root, "dist", "renderer", "react-runtime.js");
const workerOutfile = path.join(root, "dist", "renderer", "pierre-diff-worker.js");

await esbuild.build({
  entryPoints: [entryPoint],
  bundle: true,
  format: "iife",
  jsx: "automatic",
  platform: "browser",
  target: "chrome134",
  define: { "process.env.NODE_ENV": "\"production\"" },
  minify: true,
  outfile,
  sourcemap: true,
  logLevel: "info"
});

// Highlighting worker for @pierre/diffs' worker pool. Bundled as a classic
// script (the renderer is served from file://, so module workers are
// unavailable) and loaded via DiffWorkerPool (diffWorkerPool.tsx).
await esbuild.build({
  entryPoints: ["@pierre/diffs/worker/worker.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome134",
  absWorkingDir: root,
  define: { "process.env.NODE_ENV": "\"production\"" },
  minify: true,
  outfile: workerOutfile,
  logLevel: "info"
});

// Off-main-thread diff parser for large diffs (useFileDiffParse.ts).
const parseWorkerOutfile = path.join(root, "dist", "renderer", "pierre-diff-parse-worker.js");
await esbuild.build({
  entryPoints: ["src/renderer-react/features/workbench/diffParseWorker.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome134",
  absWorkingDir: root,
  define: { "process.env.NODE_ENV": "\"production\"" },
  minify: true,
  outfile: parseWorkerOutfile,
  logLevel: "info"
});
