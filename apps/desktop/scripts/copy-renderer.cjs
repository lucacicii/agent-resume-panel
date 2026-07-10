const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const src = path.join(root, "src", "renderer");
const dest = path.join(root, "dist", "renderer");
const vendorDest = path.join(dest, "vendor");

fs.mkdirSync(dest, { recursive: true });
for (const name of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, name), path.join(dest, name));
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
console.log("copied renderer → dist/renderer");
