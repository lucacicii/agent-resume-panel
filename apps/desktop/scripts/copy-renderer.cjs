const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const rendererOnly = process.argv.includes("--renderer-only");
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

if (!rendererOnly) {
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

const iconSrc = path.join(root, "..", "..", "resources", "app-icon.png");
const iconDestDir = path.join(root, "dist", "resources");
const iconPng = path.join(iconDestDir, "icon.png");
fs.mkdirSync(iconDestDir, { recursive: true });

if (process.platform === "darwin") {
  // app-icon.png (1024 RGBA) → icon.icns for macOS .app / DMG.
  execFileSync("sips", ["-s", "format", "png", iconSrc, "--out", iconPng], { stdio: "ignore" });
  const iconset = path.join(iconDestDir, "icon.iconset");
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });
  for (const [size, name] of [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"]
  ]) {
    execFileSync(
      "sips",
      ["-z", String(size), String(size), iconPng, "--out", path.join(iconset, name)],
      { stdio: "ignore" }
    );
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(iconDestDir, "icon.icns")], {
    stdio: "ignore"
  });
  fs.rmSync(iconset, { recursive: true, force: true });
} else {
  fs.copyFileSync(iconSrc, iconPng);
}
}

const repoLocales = path.join(root, "..", "..", "locales");
const distLocales = path.join(root, "dist", "locales");
if (fs.existsSync(repoLocales)) {
  fs.mkdirSync(distLocales, { recursive: true });
  for (const name of fs.readdirSync(repoLocales)) {
    if (!name.endsWith(".json")) continue;
    fs.copyFileSync(path.join(repoLocales, name), path.join(distLocales, name));
  }
  console.log("copied locales → dist/locales");
}

console.log("copied renderer → dist/renderer");
