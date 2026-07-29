import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { expandHome } from "@agent-resume/core";

const execFileAsync = promisify(execFile);
const PASTEBOARD_TIMEOUT_MS = 5000;
const PASTEBOARD_MAX_BUFFER = 1024 * 1024;

const READ_FILE_URLS_SCRIPT = String.raw`
ObjC.import("AppKit");
function run() {
  const pasteboard = $.NSPasteboard.generalPasteboard;
  const classes = $.NSArray.arrayWithObject($.NSURL);
  const options = $.NSDictionary.dictionaryWithObjectForKey(
    true,
    $.NSPasteboardURLReadingFileURLsOnlyKey
  );
  const urls = pasteboard.readObjectsForClassesOptions(classes, options);
  if (!urls || urls.count === 0) return "[]";
  return JSON.stringify(ObjC.deepUnwrap(urls.valueForKey("path")));
}
`;

const WRITE_FILE_URLS_SCRIPT = String.raw`
ObjC.import("AppKit");
function run(argv) {
  const paths = JSON.parse(argv[0] || "[]");
  const urls = $.NSMutableArray.array;
  paths.forEach((item) => urls.addObject($.NSURL.fileURLWithPath(item)));
  const pasteboard = $.NSPasteboard.generalPasteboard;
  pasteboard.clearContents;
  const ok = pasteboard.writeObjects(urls);
  return JSON.stringify({ ok: Boolean(ok) });
}
`;

export interface WorkbenchPasteCopiedEntry {
  sourcePath: string;
  destinationPath: string;
  isDirectory: boolean;
}

export interface WorkbenchPasteFailure {
  sourcePath: string;
  message: string;
}

export interface WorkbenchPasteResult {
  copied: WorkbenchPasteCopiedEntry[];
  failures: WorkbenchPasteFailure[];
}

function isPathWithin(targetPath: string, rootPath: string): boolean {
  return targetPath === rootPath || targetPath.startsWith(rootPath + path.sep);
}

function requireMacOs(): void {
  if (process.platform !== "darwin") {
    throw new Error("文件剪贴板仅支持 macOS");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

async function runPasteboardScript(script: string, args: string[] = []): Promise<string> {
  requireMacOs();
  const result = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script, ...args], {
    timeout: PASTEBOARD_TIMEOUT_MS,
    maxBuffer: PASTEBOARD_MAX_BUFFER
  });
  return result.stdout.trim();
}

export function parsePasteboardPaths(stdout: string): string[] {
  const value: unknown = JSON.parse(stdout || "[]");
  if (!Array.isArray(value)) throw new Error("无法读取文件剪贴板");
  return value.filter((item): item is string => typeof item === "string" && path.isAbsolute(item));
}

export async function readMacPasteboardFilePaths(): Promise<string[]> {
  return parsePasteboardPaths(await runPasteboardScript(READ_FILE_URLS_SCRIPT));
}

export async function writeMacPasteboardFilePaths(paths: string[]): Promise<void> {
  if (!paths.length) throw new Error("没有可复制的文件");
  const stdout = await runPasteboardScript(WRITE_FILE_URLS_SCRIPT, [JSON.stringify(paths)]);
  const result: unknown = JSON.parse(stdout || "{}");
  if (!result || typeof result !== "object" || !(result as { ok?: unknown }).ok) {
    throw new Error("无法写入文件剪贴板");
  }
}

function resolveWorkbenchEntry(rootPath: string, sourcePath: string): string {
  const resolvedRoot = path.resolve(expandHome(rootPath.trim()));
  const resolvedSource = path.resolve(expandHome(sourcePath.trim()));
  if (!isPathWithin(resolvedSource, resolvedRoot)) throw new Error("路径超出允许范围");

  const canonicalRoot = fs.realpathSync.native(resolvedRoot);
  if (resolvedSource === resolvedRoot) return canonicalRoot;
  const canonicalParent = fs.realpathSync.native(path.dirname(resolvedSource));
  if (!isPathWithin(canonicalParent, canonicalRoot)) throw new Error("路径超出允许范围");
  fs.lstatSync(resolvedSource);
  return resolvedSource;
}

function resolveTargetDirectory(rootPath: string, targetDirectory: string): string {
  const resolvedRoot = path.resolve(expandHome(rootPath.trim()));
  const resolvedTarget = path.resolve(expandHome(targetDirectory.trim()));
  if (!isPathWithin(resolvedTarget, resolvedRoot)) throw new Error("路径超出允许范围");

  const canonicalRoot = fs.realpathSync.native(resolvedRoot);
  const canonicalTarget = fs.realpathSync.native(resolvedTarget);
  if (!isPathWithin(canonicalTarget, canonicalRoot)) throw new Error("路径超出允许范围");
  if (!fs.statSync(canonicalTarget).isDirectory()) throw new Error("粘贴目标不是文件夹");
  return canonicalTarget;
}

function copyNameParts(name: string, isDirectory: boolean): { stem: string; extension: string } {
  if (isDirectory) return { stem: name, extension: "" };
  const extension = path.extname(name);
  return { stem: extension ? name.slice(0, -extension.length) : name, extension };
}

export function uniqueCopyDestination(
  targetDirectory: string,
  sourceName: string,
  isDirectory: boolean
): string {
  const direct = path.join(targetDirectory, sourceName);
  if (!fs.existsSync(direct)) return direct;

  const { stem, extension } = copyNameParts(sourceName, isDirectory);
  for (let index = 1; index < 10000; index += 1) {
    const suffix = index === 1 ? " copy" : ` copy ${index}`;
    const candidate = path.join(targetDirectory, `${stem}${suffix}${extension}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`无法为 ${sourceName} 生成唯一副本名称`);
}

function validatedPasteSource(sourcePath: string): {
  sourcePath: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
} {
  if (!sourcePath || sourcePath.includes("\0") || !path.isAbsolute(sourcePath)) {
    throw new Error("无效的源文件路径");
  }
  const resolved = path.resolve(sourcePath);
  const stat = fs.lstatSync(resolved);
  const isSymbolicLink = stat.isSymbolicLink();
  if (!stat.isFile() && !stat.isDirectory() && !isSymbolicLink) {
    throw new Error("不支持复制该文件类型");
  }
  return { sourcePath: resolved, isDirectory: stat.isDirectory(), isSymbolicLink };
}

async function copyPasteboardEntry(sourcePath: string, targetDirectory: string): Promise<WorkbenchPasteCopiedEntry> {
  const source = validatedPasteSource(sourcePath);
  if (source.isDirectory && !source.isSymbolicLink) {
    const canonicalSource = fs.realpathSync.native(source.sourcePath);
    if (isPathWithin(targetDirectory, canonicalSource)) {
      throw new Error("不能将文件夹复制到自身或其子文件夹");
    }
  }

  const destinationPath = uniqueCopyDestination(
    targetDirectory,
    path.basename(source.sourcePath),
    source.isDirectory
  );
  await fs.promises.cp(source.sourcePath, destinationPath, {
    recursive: source.isDirectory,
    dereference: false,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    verbatimSymlinks: true
  });
  return {
    sourcePath: source.sourcePath,
    destinationPath,
    isDirectory: source.isDirectory
  };
}

export async function copyPathsIntoWorkbench(
  rootPath: string,
  targetDirectory: string,
  sourcePaths: string[]
): Promise<WorkbenchPasteResult> {
  const target = resolveTargetDirectory(rootPath, targetDirectory);
  const copied: WorkbenchPasteCopiedEntry[] = [];
  const failures: WorkbenchPasteFailure[] = [];
  const seen = new Set<string>();

  for (const rawSourcePath of sourcePaths) {
    const sourcePath = path.resolve(rawSourcePath);
    if (seen.has(sourcePath)) continue;
    seen.add(sourcePath);
    try {
      copied.push(await copyPasteboardEntry(sourcePath, target));
    } catch (error) {
      failures.push({ sourcePath, message: errorMessage(error) });
    }
  }
  return { copied, failures };
}

export async function copyWorkbenchPathToClipboard(rootPath: string, sourcePath: string): Promise<void> {
  const source = resolveWorkbenchEntry(rootPath, sourcePath);
  await writeMacPasteboardFilePaths([source]);
}

export async function pasteMacClipboardIntoWorkbench(
  rootPath: string,
  targetDirectory: string
): Promise<WorkbenchPasteResult> {
  const sourcePaths = await readMacPasteboardFilePaths();
  return copyPathsIntoWorkbench(rootPath, targetDirectory, sourcePaths);
}
