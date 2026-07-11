const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const src = path.join(root, "src", "renderer");
const dest = path.join(root, "dist", "renderer");
const vendorDest = path.join(dest, "vendor");

fs.mkdirSync(dest, { recursive: true });
for (const name of fs.readdirSync(src)) {
  const from = path.join(src, name);
  const to = path.join(dest, name);
  if (fs.statSync(from).isDirectory()) continue;
  fs.copyFileSync(from, to);
}
fs.mkdirSync(vendorDest, { recursive: true });
fs.copyFileSync(
  path.join(path.dirname(require.resolve("marked")), "marked.umd.js"),
  path.join(vendorDest, "marked.umd.js")
);
fs.copyFileSync(
  path.join(path.dirname(require.resolve("dompurify")), "purify.min.js"),
  path.join(vendorDest, "purify.min.js")
);
const xtermPkg = path.dirname(require.resolve("@xterm/xterm/package.json"));
fs.copyFileSync(path.join(xtermPkg, "lib", "xterm.js"), path.join(vendorDest, "xterm.js"));
fs.copyFileSync(path.join(xtermPkg, "css", "xterm.css"), path.join(vendorDest, "xterm.css"));
const fitPkg = path.dirname(require.resolve("@xterm/addon-fit/package.json"));
fs.copyFileSync(path.join(fitPkg, "lib", "addon-fit.js"), path.join(vendorDest, "xterm-addon-fit.js"));
const webglPkg = path.dirname(require.resolve("@xterm/addon-webgl/package.json"));
fs.copyFileSync(path.join(webglPkg, "lib", "addon-webgl.js"), path.join(vendorDest, "xterm-addon-webgl.js"));
console.log("copied renderer → dist/renderer");
