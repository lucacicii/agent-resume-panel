import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const entryPoint = path.join(root, "src", "renderer-react", "main.tsx");
const outfile = path.join(root, "dist", "renderer", "react-runtime.js");

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
