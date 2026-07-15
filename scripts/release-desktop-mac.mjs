import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = path.join(root, "apps", "desktop");
const releaseRepo = "thunder-luc/agent-resume-desktop-doc";

function usage() {
  console.log(`Usage: node scripts/release-desktop-mac.mjs [options]

Options:
  --build              Run npm run pack:desktop when the DMG is missing
  --notes-file <path>  Markdown release notes (required unless --upload-only)
  --upload-only        Upload the DMG to an existing release only
  --dry-run            Print commands without executing them
  --help               Show this help
`);
}

function parseArgs(argv) {
  const options = {
    build: false,
    dryRun: false,
    notesFile: null,
    uploadOnly: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--build") {
      options.build = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg === "--notes-file") {
      const value = argv[++i];
      if (!value) throw new Error("Missing value for --notes-file");
      options.notesFile = path.resolve(root, value);
    } else if (arg === "--upload-only") {
      options.uploadOnly = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.uploadOnly) {
    if (!options.notesFile) {
      throw new Error("--notes-file is required unless --upload-only is set");
    }
    if (!fs.existsSync(options.notesFile)) {
      throw new Error(`Release notes file not found: ${options.notesFile}`);
    }
  }

  return options;
}

function run(command, args, { dryRun = false, cwd = root } = {}) {
  const printable = [command, ...args].join(" ");
  if (dryRun) {
    console.log(`[dry-run] ${printable}`);
    return;
  }
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function readDesktopVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
  if (!pkg.version) throw new Error("apps/desktop/package.json is missing version");
  return pkg.version;
}

function dmgPathForVersion(version) {
  return path.join(desktopRoot, "release", `Agent Resume-${version}.dmg`);
}

function ensureGhAuth(dryRun) {
  run("gh", ["auth", "status"], { dryRun });
}

function ensureDmg(version, build, dryRun) {
  const dmgPath = dmgPathForVersion(version);
  if (fs.existsSync(dmgPath)) {
    return dmgPath;
  }
  if (!build) {
    throw new Error(
      `Missing DMG: ${dmgPath}\nRebuild with --build or run: npm run pack:desktop`
    );
  }
  run("npm", ["run", "pack:desktop"], { dryRun, cwd: root });
  if (!dryRun && !fs.existsSync(dmgPath)) {
    throw new Error(`Packaging finished but DMG was not found: ${dmgPath}`);
  }
  return dmgPath;
}

function releaseExists(tag, dryRun) {
  if (dryRun) return false;
  try {
    execFileSync("gh", ["release", "view", tag, "--repo", releaseRepo], {
      cwd: root,
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}

function createRelease(version, notesFile, dryRun) {
  const tag = `v${version}`;
  const title = `Agent Resume Desktop v${version}`;
  if (releaseExists(tag, dryRun)) {
    console.log(`Release ${tag} already exists; skipping create.`);
    return;
  }
  run(
    "gh",
    [
      "release",
      "create",
      tag,
      "--repo",
      releaseRepo,
      "--title",
      title,
      "--notes-file",
      notesFile
    ],
    { dryRun }
  );
}

function uploadWithRetries(label, upload, { dryRun, attempts = 5, delaySec = 15 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    console.log(`${label} (attempt ${attempt}/${attempts})...`);
    if (dryRun) {
      upload(true);
      return;
    }
    try {
      upload(false);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.warn(`${label} failed; retrying in ${delaySec}s...`);
      execFileSync("sleep", [String(delaySec)], { cwd: root, stdio: "inherit" });
    }
  }
}

function uploadAssetWithGh(version, dmgPath, dryRun) {
  const tag = `v${version}`;
  const assetName = path.basename(dmgPath);
  uploadWithRetries(`Uploading ${assetName} via gh`, (isDryRun) => {
    if (isDryRun) {
      console.log(`[dry-run] gh release upload ${tag} ${dmgPath} --repo ${releaseRepo} --clobber`);
      return;
    }
    run("gh", ["release", "upload", tag, dmgPath, "--repo", releaseRepo, "--clobber"], { dryRun: false });
  }, { dryRun });
}

function ghAuthToken(dryRun) {
  if (dryRun) return "dry-run-token";
  return execFileSync("gh", ["auth", "token"], { cwd: root, encoding: "utf8" }).trim();
}

function releaseIdForTag(tag, dryRun) {
  if (dryRun) return "0";
  const json = execFileSync(
    "gh",
    ["release", "view", tag, "--repo", releaseRepo, "--json", "databaseId"],
    { cwd: root, encoding: "utf8" }
  );
  const { databaseId } = JSON.parse(json);
  if (!databaseId) throw new Error(`Could not resolve release id for ${tag}`);
  return String(databaseId);
}

function uploadAssetWithCurl(version, dmgPath, dryRun) {
  const tag = `v${version}`;
  const releaseId = releaseIdForTag(tag, dryRun);
  const assetName = path.basename(dmgPath);
  const uploadUrl = `https://uploads.github.com/repos/${releaseRepo}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`;
  const token = ghAuthToken(dryRun);

  uploadWithRetries(`Uploading ${assetName} via curl`, (isDryRun) => {
    if (isDryRun) {
      console.log(`[dry-run] curl --http1.1 --upload-file ${dmgPath} ${uploadUrl}`);
      return;
    }
    execFileSync(
      "curl",
      [
        "--http1.1",
        "--fail",
        "--retry",
        "3",
        "--retry-delay",
        "5",
        "--retry-all-errors",
        "--connect-timeout",
        "60",
        "--max-time",
        "7200",
        "-X",
        "POST",
        "-H",
        `Authorization: Bearer ${token}`,
        "-H",
        "Accept: application/vnd.github+json",
        "-H",
        "Content-Type: application/octet-stream",
        "--upload-file",
        dmgPath,
        uploadUrl
      ],
      { cwd: root, stdio: "inherit" }
    );
  }, { dryRun });
}

function uploadAsset(version, dmgPath, dryRun) {
  try {
    uploadAssetWithGh(version, dmgPath, dryRun);
  } catch (error) {
    console.warn("gh release upload failed; falling back to curl upload API...");
    uploadAssetWithCurl(version, dmgPath, dryRun);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const version = readDesktopVersion();
  const dmgPath = ensureDmg(version, options.build, options.dryRun);

  console.log(`Desktop version: ${version}`);
  console.log(`DMG: ${dmgPath}`);
  console.log(`Target repo: ${releaseRepo}`);

  ensureGhAuth(options.dryRun);
  if (!options.uploadOnly) {
    createRelease(version, options.notesFile, options.dryRun);
  }
  uploadAsset(version, dmgPath, options.dryRun);

  console.log(`\nRelease ready: https://github.com/${releaseRepo}/releases/tag/v${version}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}