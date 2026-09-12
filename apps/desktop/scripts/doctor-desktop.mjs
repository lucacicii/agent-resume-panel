#!/usr/bin/env node
/**
 * Desktop environment doctor for macOS Intel + Apple Silicon.
 * Run after clone / pnpm install when dev or pack fails with env-looking errors.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureSpawnHelpersExecutable, findSpawnHelpers } from "./fix-node-pty.mjs";

const require = createRequire(import.meta.url);
const desktopRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.join(desktopRoot, "..", "..");
const MIN_NODE = "22.13.0";
const EXPECTED_PNPM = "11.13.1";

/** @typedef {{ ok: boolean, name: string, detail: string, fix?: string }} Check */

function parseVersion(v) {
  return String(v)
    .replace(/^v/, "")
    .split(".")
    .map((p) => Number.parseInt(p, 10) || 0);
}

function versionGte(actual, minimum) {
  const a = parseVersion(actual);
  const m = parseVersion(minimum);
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0;
    const mv = m[i] ?? 0;
    if (av > mv) return true;
    if (av < mv) return false;
  }
  return true;
}

function checkNode() {
  const actual = process.versions.node;
  const ok = versionGte(actual, MIN_NODE);
  return {
    ok,
    name: "Node.js",
    detail: ok ? `v${actual} (>= ${MIN_NODE})` : `v${actual} — need >= ${MIN_NODE}`,
    fix: ok
      ? undefined
      : "Install Node 22.13+ via fnm (reads .node-version): fnm install && fnm use"
  };
}

function checkPnpm() {
  try {
    const out = execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim();
    const ok = out === EXPECTED_PNPM || out.startsWith(`${EXPECTED_PNPM}`);
    return {
      ok,
      name: "pnpm",
      detail: ok ? out : `${out} — expected ${EXPECTED_PNPM}`,
      fix: ok ? undefined : "From repo root: corepack enable && pnpm install --frozen-lockfile"
    };
  } catch {
    return {
      ok: false,
      name: "pnpm",
      detail: "not found on PATH",
      fix: "From repo root: corepack enable && pnpm install --frozen-lockfile"
    };
  }
}

function checkPlatform() {
  const { platform, arch } = process;
  if (platform !== "darwin") {
    return {
      ok: false,
      name: "Platform",
      detail: `${platform}/${arch} — Desktop pack/dev matrix is macOS only for now`,
      fix: "Use an Intel or Apple Silicon Mac for desktop work."
    };
  }
  return {
    ok: true,
    name: "Platform",
    detail: `darwin/${arch} (${arch === "arm64" ? "Apple Silicon" : arch === "x64" ? "Intel" : arch})`
  };
}

function resolveNodePtyRoot() {
  try {
    return path.dirname(require.resolve("node-pty/package.json", { paths: [desktopRoot] }));
  } catch {
    return null;
  }
}

function checkNodePty() {
  const root = resolveNodePtyRoot();
  if (!root || !fs.existsSync(root)) {
    return {
      ok: false,
      name: "node-pty",
      detail: "package not installed",
      fix: "pnpm install  # from repo root — do not copy node_modules between machines"
    };
  }

  const arch = process.arch;
  const prebuildDir = path.join(root, "prebuilds", `darwin-${arch}`);
  const hasPrebuild = fs.existsSync(prebuildDir);
  const helpers = ensureSpawnHelpersExecutable(root, "darwin");
  const archHelpers = findSpawnHelpers(root, "darwin").filter((h) => h.includes(`darwin-${arch}`));
  const ok = hasPrebuild && (helpers.length > 0 || archHelpers.length > 0);

  // Per-arch packs need prebuilds for each target arch present in the package.
  const hasX64 = fs.existsSync(path.join(root, "prebuilds", "darwin-x64"));
  const hasArm64 = fs.existsSync(path.join(root, "prebuilds", "darwin-arm64"));
  const packReady = hasX64 && hasArm64;
  const detailParts = [
    `root ${root}`,
    hasPrebuild ? `prebuild darwin-${arch} OK` : `missing prebuild darwin-${arch}`,
    helpers.length ? `spawn-helper x${helpers.length}` : "no spawn-helper",
    packReady
      ? "both-arch prebuilds (x64+arm64) OK"
      : `pack prebuilds: x64=${hasX64} arm64=${hasArm64}`
  ];

  return {
    ok,
    name: "node-pty",
    detail: detailParts.join("; "),
    fix: ok
      ? packReady
        ? undefined
        : "For pack:desktop reinstall node-pty so both darwin-x64 and darwin-arm64 prebuilds exist: pnpm install --force"
      : "pnpm install --force  # from repo root; never copy node_modules across Intel/Apple Silicon"
  };
}

function checkElectronDev() {
  try {
    const pkgDir = path.dirname(require.resolve("electron/package.json", { paths: [desktopRoot] }));
    const pathFile = path.join(pkgDir, "path.txt");
    const macBinary = path.join(pkgDir, "dist", "Electron.app", "Contents", "MacOS", "Electron");
    if (fs.existsSync(pathFile)) {
      const relative = fs.readFileSync(pathFile, "utf8").trim();
      const bin = path.join(pkgDir, "dist", relative);
      const ok = fs.existsSync(bin);
      return {
        ok,
        name: "Electron (dev binary)",
        detail: ok ? bin : `missing ${bin}`,
        fix: ok
          ? undefined
          : "rm -rf node_modules/.pnpm/electron@*/node_modules/electron/dist && pnpm install --force"
      };
    }
    // Incomplete postinstall: binary on disk but path.txt never written.
    if (process.platform === "darwin" && fs.existsSync(macBinary)) {
      return {
        ok: true,
        name: "Electron (dev binary)",
        detail: `${macBinary} (path.txt missing but app present)`
      };
    }
    return {
      ok: false,
      name: "Electron (dev binary)",
      detail: "electron package present but binary not downloaded",
      fix: "pnpm install --force  # or: node apps/desktop/scripts/ensure-electron.mjs"
    };
  } catch {
    return {
      ok: false,
      name: "Electron (dev binary)",
      detail: "electron package not installed",
      fix: "pnpm install  # from repo root (do not use --prod; electron is a devDependency)"
    };
  }
}

function checkElectronPackCache() {
  let version = "?";
  try {
    version = require(path.join(
      path.dirname(require.resolve("electron/package.json", { paths: [desktopRoot] })),
      "package.json"
    )).version;
  } catch {
    return {
      ok: true,
      name: "Electron pack cache",
      detail: "skipped (electron not installed)"
    };
  }

  const zipDir = path.join(desktopRoot, ".electron-zips", `v${version}`);
  const need = [
    `electron-v${version}-darwin-x64.zip`,
    `electron-v${version}-darwin-arm64.zip`
  ];
  const present = need.map((name) => ({
    name,
    ok: fs.existsSync(path.join(zipDir, name))
  }));
  const allOk = present.every((p) => p.ok);
  return {
    ok: true, // cache miss is OK; pack will download
    name: "Electron pack cache (per-arch zips)",
    detail: allOk
      ? `cached both zips under ${zipDir}`
      : `partial/missing under ${zipDir}: ${present.map((p) => `${p.name}=${p.ok}`).join(", ")} (pack:desktop will download)`
  };
}

function checkWorkspaceLayout() {
  const lock = fs.existsSync(path.join(repoRoot, "pnpm-lock.yaml"));
  const desktopPkg = fs.existsSync(path.join(desktopRoot, "package.json"));
  const ok = lock && desktopPkg;
  return {
    ok,
    name: "Workspace",
    detail: ok ? "repo root + apps/desktop OK" : "run doctor from a full git checkout",
    fix: ok ? undefined : "Clone the monorepo; run commands from the repository root."
  };
}

/**
 * The background status plane is optional, so a missing daemon is a warning in
 * the report rather than a broken environment: it only means status falls back
 * to the screen rules while the app is open.
 */
function checkAgentStatusDaemon() {
  const panelHome = process.env.AGENT_RESUME_PANEL_HOME?.trim()
    || path.join(os.homedir(), ".agent-resume-panel");
  const paths = agentStatusPaths(panelHome);
  const endpoint = readEndpointFileSync(paths.endpoint);
  const manifestsDir = path.join(desktopRoot, "dist", "main", "agentStatus", "engine", "manifests");
  const manifests = fs.existsSync(manifestsDir)
    ? fs.readdirSync(manifestsDir).filter((name) => name.endsWith(".json")).length
    : 0;

  if (!endpoint) {
    return {
      ok: true,
      name: "Agent status daemon",
      detail: `not running (checked ${paths.endpoint}); it starts with the Desktop app`,
      fix: "Open Agent Resume Desktop, or Settings → Background status → Start"
    };
  }
  return {
    ok: true,
    name: "Agent status daemon",
    detail: `running (pid ${endpoint.pid}, API v${endpoint.apiVersion}${endpoint.appVersion ? `, app ${endpoint.appVersion}` : ""})` +
      `, socket ${paths.socket}, ${manifests} bundled manifest(s)`,
  };
}

/**
 * Socket + endpoint paths for a panel home.
 *
 * Reimplemented here rather than imported from `dist/`: the doctor must run
 * before (or without) a build, and this is the one place the derivation matters.
 */
function agentStatusPaths(panelHome) {
  const dir = path.join(panelHome, ".desktop", "agent-status");
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const profile = createHash("sha1").update(panelHome).digest("hex").slice(0, 8);
  return {
    dir,
    endpoint: path.join(dir, "endpoint.json"),
    socket: path.join(os.tmpdir(), `agent-resume-status-${uid}-${profile}.sock`)
  };
}

function readEndpointFileSync(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed.pid === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function checkAgentStatusHooks() {
  const home = os.homedir();
  const installed = [];
  for (const [label, file] of [
    ["claude", path.join(home, ".claude", "settings.json")],
    ["codex", path.join(home, ".codex", "hooks.json")]
  ]) {
    try {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes("agent-resume-status-")) installed.push(label);
    } catch {
      // Not installed / not present.
    }
  }
  try {
    if (fs.existsSync(path.join(home, ".pi", "agent", "extensions", "agent-resume-bridge.ts"))) {
      installed.push("pi");
    }
  } catch {
    // ignore
  }
  return {
    ok: true,
    name: "Agent status hooks",
    detail: installed.length
      ? `installed for ${installed.join(", ")}`
      : "none installed (status falls back to screen detection)",
    fix: "Settings → Background status → Install"
  };
}

export function runDesktopDoctor() {
  /** @type {Check[]} */
  const checks = [
    checkWorkspaceLayout(),
    checkPlatform(),
    checkNode(),
    checkPnpm(),
    checkElectronDev(),
    checkNodePty(),
    checkElectronPackCache(),
    checkAgentStatusDaemon(),
    checkAgentStatusHooks()
  ];
  return checks;
}

function main() {
  const checks = runDesktopDoctor();
  let failed = 0;
  console.log("Agent Resume Desktop — environment doctor (macOS Intel / Apple Silicon)\n");
  for (const c of checks) {
    const mark = c.ok ? "OK  " : "FAIL";
    if (!c.ok) failed += 1;
    console.log(`[${mark}] ${c.name}: ${c.detail}`);
    if (!c.ok && c.fix) {
      console.log(`       fix → ${c.fix}`);
    }
  }
  console.log("");
  if (failed === 0) {
    console.log("All required checks passed.");
    console.log("Dev:  pnpm run dev:desktop");
    console.log("Pack: pnpm run pack:desktop   # any Mac; builds arm64 + x64 separately");
    console.log("Tip:  never copy node_modules between Intel and Apple Silicon — only git + pnpm install.");
    process.exit(0);
  }
  console.error(`${failed} check(s) failed. Fix above, then re-run: pnpm run doctor:desktop`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
