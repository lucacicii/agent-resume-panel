import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDest = path.join(root, "dist", "renderer", "vendor");
const entryDir = path.join(root, "src", "renderer", "vendor-entry");

fs.mkdirSync(vendorDest, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(entryDir, "hljs-bundle.mjs")],
  bundle: true,
  platform: "browser",
  format: "iife",
  outfile: path.join(vendorDest, "hljs-bundle.js"),
  logLevel: "info"
});

await esbuild.build({
  entryPoints: [path.join(entryDir, "notes-cm.mjs")],
  bundle: true,
  minify: true,
  platform: "browser",
  format: "iife",
  outfile: path.join(vendorDest, "notes-cm.js"),
  logLevel: "info"
});

const hljsStyles = path.join(path.dirname(require.resolve("highlight.js/package.json")), "styles");
for (const file of ["github-dark.min.css", "github.min.css"]) {
  fs.copyFileSync(path.join(hljsStyles, file), path.join(vendorDest, file));
}

console.log("built renderer vendor bundles → dist/renderer/vendor");