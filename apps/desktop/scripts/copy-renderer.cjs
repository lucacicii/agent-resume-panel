const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const extensionRoot = path.join(root, "..", "extension");
const rendererOnly = process.argv.includes("--renderer-only");
const src = path.join(root, "src", "renderer");
const dest = path.join(root, "dist", "renderer");
const vendorDest = path.join(dest, "vendor");

function pngIconsetToIcns(iconset, output) {
  const entries = [
    ["ic04", "icon_16x16.png"],
    ["ic11", "icon_16x16@2x.png"],
    ["ic05", "icon_32x32.png"],
    ["ic12", "icon_32x32@2x.png"],
    ["ic07", "icon_128x128.png"],
    ["ic13", "icon_128x128@2x.png"],
    ["ic08", "icon_256x256.png"],
    ["ic14", "icon_256x256@2x.png"],
    ["ic09", "icon_512x512.png"],
    ["ic10", "icon_512x512@2x.png"]
  ].map(([type, name]) => ({ type, bytes: fs.readFileSync(path.join(iconset, name)) }));
  const totalLength = 8 + entries.reduce((total, entry) => total + 8 + entry.bytes.length, 0);
  const chunks = [Buffer.from("icns"), Buffer.alloc(4)];
  chunks[1].writeUInt32BE(totalLength);
  for (const entry of entries) {
    const header = Buffer.alloc(8);
    header.write(entry.type, 0, 4, "ascii");
    header.writeUInt32BE(entry.bytes.length + 8, 4);
    chunks.push(header, entry.bytes);
  }
  const temporaryOutput = `${output}.tmp`;
  fs.writeFileSync(temporaryOutput, Buffer.concat(chunks));
  fs.renameSync(temporaryOutput, output);
}

fs.mkdirSync(dest, { recursive: true });
for (const legacyFile of ["app.js", "i18n.js", "refreshLocalizedUi.js"]) {
  fs.rmSync(path.join(dest, legacyFile), { force: true });
}
for (const name of fs.readdirSync(src)) {
  const from = path.join(src, name);
  const to = path.join(dest, name);
  if (fs.statSync(from).isDirectory()) {
    // Static assets (provider icons, etc.) ship next to index.html.
    fs.cpSync(from, to, { recursive: true });
    continue;
  }
  fs.copyFileSync(from, to);
}

if (!rendererOnly) {
fs.rmSync(vendorDest, { recursive: true, force: true });
fs.mkdirSync(vendorDest, { recursive: true });
const xtermPkg = path.dirname(require.resolve("@xterm/xterm/package.json"));
fs.copyFileSync(path.join(xtermPkg, "css", "xterm.css"), path.join(vendorDest, "xterm.css"));
const hljsStyles = path.join(path.dirname(require.resolve("highlight.js/package.json")), "styles");
for (const file of ["github.min.css", "github-dark.min.css"]) {
  fs.copyFileSync(path.join(hljsStyles, file), path.join(vendorDest, file));
}

const iconSrc = path.join(extensionRoot, "resources", "app-icon.png");
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
  const iconIcns = path.join(iconDestDir, "icon.icns");
  try {
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", iconIcns], { stdio: "ignore" });
  } catch (error) {
    // Some macOS iconutil versions reject valid PNG iconsets produced by sips.
    // ICNS stores those PNG layers verbatim, so package them directly instead of reusing a stale icon.
    pngIconsetToIcns(iconset, iconIcns);
    console.warn("iconutil failed; generated icon.icns from the PNG iconset");
  }
  fs.rmSync(iconset, { recursive: true, force: true });
  // Windows installers and portable builds still want a .ico; it is generated
  // on every platform so a cross-platform release does not need a Mac.
  writeWindowsIcon(iconSrc, path.join(iconDestDir, "icon.ico"));
} else {
  fs.copyFileSync(iconSrc, iconPng);
  writeWindowsIcon(iconSrc, path.join(iconDestDir, "icon.ico"));
}

/**
 * Write a multi-size .ico from the 1024px app icon.
 *
 * An ICO is a small container: a header, one directory entry per image, then
 * the images. Windows accepts PNG-compressed entries (Vista and later), so the
 * 1024px source is downscaled with sips when available and embedded as PNG —
 * no image library needed. On a machine without sips the source is embedded
 * at its own size, which Explorer still renders.
 */
function writeWindowsIcon(sourcePng, destinationIco) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const temporaryDir = path.join(iconDestDir, ".ico-tmp");
  fs.rmSync(temporaryDir, { recursive: true, force: true });
  fs.mkdirSync(temporaryDir, { recursive: true });
  try {
    const images = sizes.map((size) => {
      const target = path.join(temporaryDir, `${size}.png`);
      try {
        execFileSync("sips", ["-z", String(size), String(size), sourcePng, "--out", target], { stdio: "ignore" });
        return { size, data: fs.readFileSync(target) };
      } catch {
        return null;
      }
    }).filter(Boolean);
    if (!images.length) {
      images.push({ size: 256, data: fs.readFileSync(sourcePng) });
    }

    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(images.length, 4);

    const directory = Buffer.alloc(16 * images.length);
    let offset = header.length + directory.length;
    images.forEach((image, index) => {
      const entry = index * 16;
      // 256 is encoded as 0 in the directory.
      directory.writeUInt8(image.size >= 256 ? 0 : image.size, entry);
      directory.writeUInt8(image.size >= 256 ? 0 : image.size, entry + 1);
      directory.writeUInt8(0, entry + 2); // palette
      directory.writeUInt8(0, entry + 3); // reserved
      directory.writeUInt16LE(1, entry + 4); // color planes
      directory.writeUInt16LE(32, entry + 6); // bits per pixel
      directory.writeUInt32LE(image.data.length, entry + 8);
      directory.writeUInt32LE(offset, entry + 12);
      offset += image.data.length;
    });

    fs.writeFileSync(destinationIco, Buffer.concat([header, directory, ...images.map((image) => image.data)]));
    console.log(`generated icon.ico (${images.map((image) => image.size).join("/")})`);
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}
}

const repoLocales = path.join(root, "locales");
const distLocales = path.join(root, "dist", "locales");
if (fs.existsSync(repoLocales)) {
  fs.mkdirSync(distLocales, { recursive: true });
  for (const name of fs.readdirSync(repoLocales)) {
    if (!name.endsWith(".json")) continue;
    fs.copyFileSync(path.join(repoLocales, name), path.join(distLocales, name));
  }
  console.log("copied locales → dist/locales");
}

const shellIntegrationSrc = path.join(root, "src", "main", "shellIntegration");
const shellIntegrationDest = path.join(root, "dist", "main", "shellIntegration");
if (fs.existsSync(shellIntegrationSrc)) {
  fs.mkdirSync(shellIntegrationDest, { recursive: true });
  for (const name of fs.readdirSync(shellIntegrationSrc)) {
    const from = path.join(shellIntegrationSrc, name);
    if (!fs.statSync(from).isFile()) continue;
    fs.copyFileSync(from, path.join(shellIntegrationDest, name));
  }
  console.log("copied shellIntegration → dist/main/shellIntegration");
}

const manifestSrc = path.join(root, "src", "main", "agentStatus", "engine", "manifests");
const manifestDest = path.join(root, "dist", "main", "agentStatus", "engine", "manifests");
if (fs.existsSync(manifestSrc)) {
  fs.mkdirSync(manifestDest, { recursive: true });
  for (const name of fs.readdirSync(manifestSrc)) {
    if (!name.endsWith(".json")) continue;
    fs.copyFileSync(path.join(manifestSrc, name), path.join(manifestDest, name));
  }
  console.log("copied agent detection manifests → dist/main/agentStatus/engine/manifests");
}

console.log("copied renderer → dist/renderer");
