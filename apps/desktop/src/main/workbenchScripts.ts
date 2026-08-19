import * as fs from "node:fs";
import * as path from "node:path";
import { expandHome } from "@agent-resume/core";
import { safeHandle } from "./ipcUtils";

export const DEFAULT_SCRIPT_SCAN_MAX_DEPTH = 6;
export const DEFAULT_SCRIPT_SCAN_MAX_PACKAGES = 48;
export const HARD_SCRIPT_SCAN_MAX_DEPTH = 10;
export const HARD_SCRIPT_SCAN_MAX_PACKAGES = 96;
const MAX_MANIFEST_BYTES = 512 * 1024;

export const DEFAULT_SCRIPT_SCAN_IGNORE_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "vendor",
  "coverage",
  ".next",
  ".cache",
  "__pycache__",
  "target",
  ".turbo",
  ".pnpm-store",
  "Pods",
  ".gradle",
  ".idea",
  ".vscode"
] as const;

export type ScriptKind =
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun"
  | "make"
  | "gradle"
  | "python"
  | "cargo";

export interface ScriptEntry {
  id: string;
  name: string;
  detail?: string;
  run: {
    cwd: string;
    command: string;
  };
}

export interface ScriptPackage {
  id: string;
  kind: ScriptKind;
  packageRoot: string;
  relativeRoot: string;
  label: string;
  manifestPath: string;
  managerHint?: string;
  scripts: ScriptEntry[];
}

export interface ScriptScanOptions {
  maxDepth?: number;
  maxPackages?: number;
  ignoreDirs?: string[];
}

export interface ListScriptsResult {
  packages: ScriptPackage[];
  truncated: boolean;
  scannedDirs: number;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function resolveCwd(raw?: string): string {
  const cwd = expandHome(raw?.trim() || process.cwd());
  try {
    const stat = fs.statSync(cwd);
    if (!stat.isDirectory()) {
      throw new Error(`工作目录不是文件夹: ${cwd}`);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`工作目录不存在: ${cwd}`);
    }
    throw error;
  }
  return path.resolve(cwd);
}

function resolvePathWithinRoot(raw: string, rootPath: string): string {
  const root = path.resolve(expandHome(rootPath.trim()));
  const target = path.resolve(expandHome(raw.trim()));
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("路径超出允许范围");
  }
  return target;
}

export function normalizeScriptScanOptions(options?: ScriptScanOptions): {
  maxDepth: number;
  maxPackages: number;
  ignoreDirs: Set<string>;
} {
  const maxDepth = Math.min(
    HARD_SCRIPT_SCAN_MAX_DEPTH,
    Math.max(1, Math.floor(options?.maxDepth ?? DEFAULT_SCRIPT_SCAN_MAX_DEPTH))
  );
  const maxPackages = Math.min(
    HARD_SCRIPT_SCAN_MAX_PACKAGES,
    Math.max(1, Math.floor(options?.maxPackages ?? DEFAULT_SCRIPT_SCAN_MAX_PACKAGES))
  );
  const ignoreDirs = new Set<string>(
    (options?.ignoreDirs?.length ? options.ignoreDirs : [...DEFAULT_SCRIPT_SCAN_IGNORE_DIRS]).map((d) =>
      d.trim().toLowerCase()
    )
  );
  return { maxDepth, maxPackages, ignoreDirs };
}

function readTextFileLimited(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function relativeRootLabel(projectRoot: string, packageRoot: string): { relativeRoot: string; label: string } {
  const rel = path.relative(projectRoot, packageRoot);
  if (!rel || rel === ".") {
    return { relativeRoot: ".", label: path.basename(projectRoot) || projectRoot };
  }
  const posix = toPosixPath(rel);
  return { relativeRoot: posix, label: posix };
}

function detectNodeManager(packageRoot: string, packageManagerField?: string): {
  kind: "npm" | "pnpm" | "yarn" | "bun";
  bin: string;
} {
  const field = packageManagerField?.trim().toLowerCase() || "";
  if (field.startsWith("pnpm@") || field === "pnpm") return { kind: "pnpm", bin: "pnpm" };
  if (field.startsWith("yarn@") || field === "yarn") return { kind: "yarn", bin: "yarn" };
  if (field.startsWith("bun@") || field === "bun") return { kind: "bun", bin: "bun" };
  if (field.startsWith("npm@") || field === "npm") return { kind: "npm", bin: "npm" };

  if (fileExists(path.join(packageRoot, "pnpm-lock.yaml")) || fileExists(path.join(packageRoot, "pnpm-workspace.yaml"))) {
    return { kind: "pnpm", bin: "pnpm" };
  }
  if (fileExists(path.join(packageRoot, "yarn.lock"))) return { kind: "yarn", bin: "yarn" };
  if (
    fileExists(path.join(packageRoot, "bun.lockb")) ||
    fileExists(path.join(packageRoot, "bun.lock"))
  ) {
    return { kind: "bun", bin: "bun" };
  }
  return { kind: "npm", bin: "npm" };
}

function buildNodeRunCommand(bin: string, scriptName: string): string {
  const quoted = shellQuote(scriptName);
  if (bin === "yarn") return `yarn run ${quoted}`;
  if (bin === "bun") return `bun run ${quoted}`;
  if (bin === "pnpm") return `pnpm run ${quoted}`;
  return `npm run ${quoted}`;
}

function parseNodePackage(projectRoot: string, packageRoot: string): ScriptPackage | null {
  const manifestPath = path.join(packageRoot, "package.json");
  const raw = readTextFileLimited(manifestPath);
  if (raw == null) return null;
  let parsed: { scripts?: Record<string, unknown>; packageManager?: unknown; name?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return null;
  }
  const scriptsObj = parsed.scripts;
  if (!scriptsObj || typeof scriptsObj !== "object" || Array.isArray(scriptsObj)) return null;

  const packageManager =
    typeof parsed.packageManager === "string" ? parsed.packageManager : undefined;
  const manager = detectNodeManager(packageRoot, packageManager);
  const { relativeRoot, label } = relativeRootLabel(projectRoot, packageRoot);
  const scripts: ScriptEntry[] = [];

  for (const [name, body] of Object.entries(scriptsObj)) {
    if (!name.trim()) continue;
    const detail = typeof body === "string" ? body.trim().slice(0, 200) : undefined;
    scripts.push({
      id: `${manager.kind}:${relativeRoot}:${name}`,
      name,
      detail: detail || undefined,
      run: {
        cwd: packageRoot,
        command: buildNodeRunCommand(manager.bin, name)
      }
    });
  }

  if (!scripts.length) return null;

  return {
    id: `${manager.kind}:${packageRoot}`,
    kind: manager.kind,
    packageRoot,
    relativeRoot,
    label,
    manifestPath,
    managerHint: manager.bin,
    scripts
  };
}

const MAKE_SPECIAL_TARGETS = new Set([
  ".PHONY",
  ".SUFFIXES",
  ".DEFAULT",
  ".PRECIOUS",
  ".INTERMEDIATE",
  ".SECONDARY",
  ".SECONDEXPANSION",
  ".DELETE_ON_ERROR",
  ".IGNORE",
  ".LOW_RESOLUTION_TIME",
  ".SILENT",
  ".EXPORT_ALL_VARIABLES",
  ".NOTPARALLEL",
  ".ONESHELL",
  ".POSIX"
]);

function parseMakefile(projectRoot: string, packageRoot: string, fileName: string): ScriptPackage | null {
  const manifestPath = path.join(packageRoot, fileName);
  const raw = readTextFileLimited(manifestPath);
  if (raw == null) return null;

  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("\t") || line.startsWith(" ") || line.startsWith("#")) continue;
    // target: deps  — skip assignment-like lines and pattern rules with %
    const match = /^([A-Za-z0-9_][A-Za-z0-9_./-]*)\s*:(\s|$|:)/.exec(line);
    if (!match) continue;
    const name = match[1];
    if (!name || name.includes("%") || MAKE_SPECIAL_TARGETS.has(name) || name.startsWith(".")) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }

  if (!names.length) return null;
  const { relativeRoot, label } = relativeRootLabel(projectRoot, packageRoot);
  return {
    id: `make:${packageRoot}`,
    kind: "make",
    packageRoot,
    relativeRoot,
    label,
    manifestPath,
    managerHint: "make",
    scripts: names.map((name) => ({
      id: `make:${relativeRoot}:${name}`,
      name,
      run: { cwd: packageRoot, command: `make ${shellQuote(name)}` }
    }))
  };
}

const GRADLE_COMMON_TASKS = [
  "build",
  "test",
  "clean",
  "assemble",
  "check",
  "run",
  "bootRun",
  "assembleDebug",
  "assembleRelease",
  "installDebug",
  "testDebugUnitTest"
];

function detectGradleWrapper(packageRoot: string): string {
  if (process.platform === "win32") {
    if (fileExists(path.join(packageRoot, "gradlew.bat"))) return "gradlew.bat";
  } else if (fileExists(path.join(packageRoot, "gradlew"))) {
    return "./gradlew";
  }
  // Walk up a few levels for monorepo wrapper (same packageRoot still used as cwd).
  let current = packageRoot;
  for (let i = 0; i < 4; i++) {
    const parent = path.dirname(current);
    if (parent === current) break;
    if (process.platform === "win32") {
      if (fileExists(path.join(parent, "gradlew.bat"))) return path.join(parent, "gradlew.bat");
    } else if (fileExists(path.join(parent, "gradlew"))) {
      return path.join(parent, "gradlew");
    }
    current = parent;
  }
  return "gradle";
}

function parseGradleTasksFromSource(raw: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /tasks\.register\s*\(\s*["']([^"']+)["']/g,
    /tasks\.create\s*\(\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*task\s+["']([^"']+)["']/g,
    /(?:^|\n)\s*task\s+([A-Za-z_][A-Za-z0-9_]*)\s*[{(]/g,
    /register\s*\(\s*["']([^"']+)["']\s*\)\s*\{/g
  ];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(raw)) !== null) {
      const name = match[1]?.trim();
      if (name && !name.includes("$") && name.length < 80) names.add(name);
    }
  }
  return [...names];
}

function parseGradlePackage(projectRoot: string, packageRoot: string): ScriptPackage | null {
  const groovy = path.join(packageRoot, "build.gradle");
  const kts = path.join(packageRoot, "build.gradle.kts");
  const manifestPath = fileExists(kts) ? kts : fileExists(groovy) ? groovy : null;
  if (!manifestPath) return null;

  const raw = readTextFileLimited(manifestPath) || "";
  const parsed = parseGradleTasksFromSource(raw);
  const taskNames = [...new Set([...GRADLE_COMMON_TASKS, ...parsed])];
  const wrapper = detectGradleWrapper(packageRoot);
  const { relativeRoot, label } = relativeRootLabel(projectRoot, packageRoot);

  return {
    id: `gradle:${packageRoot}`,
    kind: "gradle",
    packageRoot,
    relativeRoot,
    label,
    manifestPath,
    managerHint: wrapper.includes("gradlew") ? "gradlew" : "gradle",
    scripts: taskNames.map((name) => ({
      id: `gradle:${relativeRoot}:${name}`,
      name,
      run: {
        cwd: packageRoot,
        command: `${wrapper} ${shellQuote(name)}`
      }
    }))
  };
}

function extractTomlTableBlock(raw: string, header: string): string | null {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\[${escaped}\\]\\s*$`, "m");
  const match = re.exec(raw);
  if (!match || match.index == null) return null;
  const start = match.index + match[0].length;
  const rest = raw.slice(start);
  const nextHeader = rest.search(/^\s*\[/m);
  return nextHeader === -1 ? rest : rest.slice(0, nextHeader);
}

function parseSimpleTomlStringMap(block: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z0-9_.-]+)\s*=\s*["']([^"']*)["']/.exec(trimmed);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

function parsePyprojectPackage(projectRoot: string, packageRoot: string): ScriptPackage | null {
  const manifestPath = path.join(packageRoot, "pyproject.toml");
  const raw = readTextFileLimited(manifestPath);
  if (raw == null) return null;

  const scriptMaps: Record<string, string>[] = [];
  for (const header of [
    "project.scripts",
    "project.gui-scripts",
    "tool.poetry.scripts",
    "tool.pdm.scripts"
  ]) {
    const block = extractTomlTableBlock(raw, header);
    if (block) scriptMaps.push(parseSimpleTomlStringMap(block));
  }

  // Hatch / poetry may use inline tables we skip; collect keys we found.
  const names = new Map<string, string>();
  for (const map of scriptMaps) {
    for (const [name, detail] of Object.entries(map)) {
      if (name && !names.has(name)) names.set(name, detail);
    }
  }

  // Always offer a few useful defaults when pyproject exists.
  const defaults = ["test", "lint", "format", "dev", "start"];
  for (const name of defaults) {
    if (!names.has(name) && raw.includes(name)) {
      // only if mentioned somewhere — weak signal; skip auto defaults without explicit scripts
    }
  }

  if (!names.size) {
    // Still expose common uv/poetry workflow when no console scripts defined.
    const hasPoetry = /\[tool\.poetry\]/.test(raw);
    const hasUv = fileExists(path.join(packageRoot, "uv.lock")) || /\[tool\.uv\]/.test(raw);
    if (!hasPoetry && !hasUv) return null;
    const runner = hasUv ? "uv" : "poetry";
    const { relativeRoot, label } = relativeRootLabel(projectRoot, packageRoot);
    const workflow =
      runner === "uv"
        ? [
            { name: "sync", command: "uv sync" },
            { name: "run", command: "uv run" },
            { name: "test", command: "uv run pytest" }
          ]
        : [
            { name: "install", command: "poetry install" },
            { name: "shell", command: "poetry shell" },
            { name: "test", command: "poetry run pytest" }
          ];
    return {
      id: `python:${packageRoot}`,
      kind: "python",
      packageRoot,
      relativeRoot,
      label,
      manifestPath,
      managerHint: runner,
      scripts: workflow.map((item) => ({
        id: `python:${relativeRoot}:${item.name}`,
        name: item.name,
        run: { cwd: packageRoot, command: item.command }
      }))
    };
  }

  const hasUv = fileExists(path.join(packageRoot, "uv.lock")) || /\[tool\.uv\]/.test(raw);
  const hasPoetry = /\[tool\.poetry\]/.test(raw);
  const runner = hasUv ? "uv" : hasPoetry ? "poetry" : "python";
  const { relativeRoot, label } = relativeRootLabel(projectRoot, packageRoot);

  const scripts: ScriptEntry[] = [...names.entries()].map(([name, detail]) => {
    let command: string;
    if (runner === "uv") command = `uv run ${shellQuote(name)}`;
    else if (runner === "poetry") command = `poetry run ${shellQuote(name)}`;
    else command = shellQuote(name);
    return {
      id: `python:${relativeRoot}:${name}`,
      name,
      detail: detail.slice(0, 200) || undefined,
      run: { cwd: packageRoot, command }
    };
  });

  return {
    id: `python:${packageRoot}`,
    kind: "python",
    packageRoot,
    relativeRoot,
    label,
    manifestPath,
    managerHint: runner,
    scripts
  };
}

function parseCargoBins(raw: string): string[] {
  const bins: string[] = [];
  const binBlocks = raw.split(/\[\[bin\]\]/).slice(1);
  for (const block of binBlocks) {
    const nameMatch = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(block);
    if (nameMatch?.[1]) bins.push(nameMatch[1]);
  }
  return bins;
}

function parseCargoPackage(projectRoot: string, packageRoot: string): ScriptPackage | null {
  const manifestPath = path.join(packageRoot, "Cargo.toml");
  const raw = readTextFileLimited(manifestPath);
  if (raw == null) return null;
  if (!/\[package\]/.test(raw) && !/\[workspace\]/.test(raw)) return null;

  const { relativeRoot, label } = relativeRootLabel(projectRoot, packageRoot);
  const scripts: ScriptEntry[] = [
    { id: `cargo:${relativeRoot}:build`, name: "build", run: { cwd: packageRoot, command: "cargo build" } },
    { id: `cargo:${relativeRoot}:test`, name: "test", run: { cwd: packageRoot, command: "cargo test" } },
    { id: `cargo:${relativeRoot}:check`, name: "check", run: { cwd: packageRoot, command: "cargo check" } },
    { id: `cargo:${relativeRoot}:run`, name: "run", run: { cwd: packageRoot, command: "cargo run" } }
  ];

  for (const bin of parseCargoBins(raw)) {
    scripts.push({
      id: `cargo:${relativeRoot}:run-bin-${bin}`,
      name: `run:${bin}`,
      detail: `cargo run --bin ${bin}`,
      run: { cwd: packageRoot, command: `cargo run --bin ${shellQuote(bin)}` }
    });
  }

  return {
    id: `cargo:${packageRoot}`,
    kind: "cargo",
    packageRoot,
    relativeRoot,
    label,
    manifestPath,
    managerHint: "cargo",
    scripts
  };
}

function discoverPackagesInDir(projectRoot: string, dirPath: string): ScriptPackage[] {
  const found: ScriptPackage[] = [];

  if (fileExists(path.join(dirPath, "package.json"))) {
    const pkg = parseNodePackage(projectRoot, dirPath);
    if (pkg) found.push(pkg);
  }

  for (const makeName of ["Makefile", "makefile", "GNUmakefile"]) {
    if (fileExists(path.join(dirPath, makeName))) {
      const pkg = parseMakefile(projectRoot, dirPath, makeName);
      if (pkg) found.push(pkg);
      break;
    }
  }

  if (fileExists(path.join(dirPath, "build.gradle")) || fileExists(path.join(dirPath, "build.gradle.kts"))) {
    const pkg = parseGradlePackage(projectRoot, dirPath);
    if (pkg) found.push(pkg);
  }

  if (fileExists(path.join(dirPath, "pyproject.toml"))) {
    const pkg = parsePyprojectPackage(projectRoot, dirPath);
    if (pkg) found.push(pkg);
  }

  if (fileExists(path.join(dirPath, "Cargo.toml"))) {
    const pkg = parseCargoPackage(projectRoot, dirPath);
    if (pkg) found.push(pkg);
  }

  return found;
}

function sortPackages(packages: ScriptPackage[]): ScriptPackage[] {
  return [...packages].sort((a, b) => {
    const aRoot = a.relativeRoot === ".";
    const bRoot = b.relativeRoot === ".";
    if (aRoot !== bRoot) return aRoot ? -1 : 1;
    const pathCmp = a.relativeRoot.localeCompare(b.relativeRoot);
    if (pathCmp !== 0) return pathCmp;
    return a.kind.localeCompare(b.kind);
  });
}

/**
 * Discover runnable scripts under a project root (static manifest parsing only).
 */
export function listWorkbenchScripts(
  rootPath: string,
  options?: ScriptScanOptions
): ListScriptsResult {
  const projectRoot = resolveCwd(rootPath);
  const { maxDepth, maxPackages, ignoreDirs } = normalizeScriptScanOptions(options);

  const packages: ScriptPackage[] = [];
  let truncated = false;
  let scannedDirs = 0;

  type QueueItem = { dir: string; depth: number };
  const queue: QueueItem[] = [{ dir: projectRoot, depth: 0 }];
  const visited = new Set<string>();

  while (queue.length) {
    const item = queue.shift();
    if (!item) break;
    let realDir: string;
    try {
      realDir = fs.realpathSync(item.dir);
    } catch {
      realDir = path.resolve(item.dir);
    }
    if (visited.has(realDir)) continue;
    visited.add(realDir);
    scannedDirs += 1;

    if (packages.length >= maxPackages) {
      truncated = true;
      break;
    }

    const found = discoverPackagesInDir(projectRoot, item.dir);
    for (const pkg of found) {
      if (packages.length >= maxPackages) {
        truncated = true;
        break;
      }
      packages.push(pkg);
    }

    if (item.depth >= maxDepth) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(item.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name === "." || name === "..") continue;
      if (name.startsWith(".")) continue;
      if (ignoreDirs.has(name.toLowerCase())) continue;
      queue.push({ dir: path.join(item.dir, name), depth: item.depth + 1 });
    }
  }

  return {
    packages: sortPackages(packages),
    truncated,
    scannedDirs
  };
}

export function registerWorkbenchScriptsIpc(): void {
  safeHandle(
    "workbench:listScripts",
    async (
      _event,
      args: {
        rootPath: string;
        maxDepth?: number;
        maxPackages?: number;
        ignoreDirs?: string[];
      }
    ) => {
      if (typeof args?.rootPath !== "string" || !args.rootPath.trim()) {
        throw new Error("无效的项目路径");
      }
      // Validate path exists as directory (resolveCwd inside list).
      const rootPath = resolveCwd(args.rootPath);
      // Ensure no funny business with options-only escape (root is absolute).
      resolvePathWithinRoot(rootPath, rootPath);
      return listWorkbenchScripts(rootPath, {
        maxDepth: args.maxDepth,
        maxPackages: args.maxPackages,
        ignoreDirs: args.ignoreDirs
      });
    }
  );
}
