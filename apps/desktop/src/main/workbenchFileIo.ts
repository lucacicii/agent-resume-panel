import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { expandHome } from "@agent-resume/core";

export const MAX_WORKBENCH_EDIT_BYTES = 2 * 1024 * 1024;

export type WorkbenchTextEncoding = "utf8" | "utf8-bom" | "utf16le" | "utf16be";

export type WorkbenchFileInspection =
  | {
      kind: "text";
      content: string;
      encoding: WorkbenchTextEncoding;
      version: string;
      size: number;
      mtimeMs: number;
    }
  | {
      kind: "external";
      reason: "binary" | "too-large";
      size: number;
      mtimeMs: number;
    }
  | { kind: "missing" };

export type WorkbenchFileSaveResult =
  | { ok: true; version: string; size: number; mtimeMs: number }
  | { ok: false; reason: "conflict"; version: string; size: number; mtimeMs: number }
  | { ok: false; reason: "missing" };

export type WorkbenchFileCreateResult =
  | { ok: true; version: string; size: number; mtimeMs: number }
  | { ok: false; reason: "exists" };

function isPathWithinRoot(targetPath: string, rootPath: string): boolean {
  return targetPath === rootPath || targetPath.startsWith(rootPath + path.sep);
}

function resolveLexicalWorkbenchPath(rootPath: string, targetPath: string): string {
  const resolvedRoot = path.resolve(expandHome(rootPath.trim()));
  const raw = expandHome(targetPath.trim());
  // Relative paths are project-relative (e.g. search / link-graph hops), not CWD-relative.
  const resolvedTarget = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(resolvedRoot, raw);
  if (!isPathWithinRoot(resolvedTarget, resolvedRoot)) {
    throw new Error("路径超出允许范围");
  }
  return resolvedTarget;
}

export function resolveCanonicalWorkbenchPath(rootPath: string, targetPath: string): string {
  const resolvedRoot = path.resolve(expandHome(rootPath.trim()));
  const resolvedTarget = resolveLexicalWorkbenchPath(rootPath, targetPath);

  const canonicalRoot = fs.realpathSync.native(resolvedRoot);
  const canonicalTarget = fs.realpathSync.native(resolvedTarget);
  if (!isPathWithinRoot(canonicalTarget, canonicalRoot)) {
    throw new Error("路径超出允许范围");
  }
  return canonicalTarget;
}

function resolveCreatableWorkbenchPath(rootPath: string, targetPath: string): string {
  const resolvedRoot = path.resolve(expandHome(rootPath.trim()));
  const raw = expandHome(targetPath.trim());
  const resolvedTarget = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(resolvedRoot, raw);
  if (!isPathWithinRoot(resolvedTarget, resolvedRoot)) {
    throw new Error("路径超出允许范围");
  }
  const canonicalRoot = fs.realpathSync.native(resolvedRoot);
  const relativePath = path.relative(resolvedRoot, resolvedTarget);
  const canonicalTarget = path.resolve(canonicalRoot, relativePath);
  const canonicalParent = fs.realpathSync.native(path.dirname(canonicalTarget));
  if (!isPathWithinRoot(canonicalParent, canonicalRoot)) {
    throw new Error("路径超出允许范围");
  }
  return canonicalTarget;
}

function fileVersion(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function decodeUtf16Be(content: Buffer): string {
  const swapped = Buffer.allocUnsafe(content.length);
  for (let index = 0; index < content.length; index += 2) {
    swapped[index] = content[index + 1] ?? 0;
    swapped[index + 1] = content[index] ?? 0;
  }
  return swapped.toString("utf16le");
}

function hasBinaryControlCharacters(value: string): boolean {
  if (!value) return false;
  let controls = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return true;
    if (code < 32 && code !== 9 && code !== 10 && code !== 12 && code !== 13) controls += 1;
  }
  return controls / value.length > 0.02;
}

function decodeText(content: Buffer): { content: string; encoding: WorkbenchTextEncoding } | null {
  try {
    if (content.length >= 3 && content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf) {
      const value = new TextDecoder("utf-8", { fatal: true }).decode(content.subarray(3));
      return hasBinaryControlCharacters(value) ? null : { content: value, encoding: "utf8-bom" };
    }
    if (content.length >= 2 && content[0] === 0xff && content[1] === 0xfe) {
      const value = content.subarray(2).toString("utf16le");
      return hasBinaryControlCharacters(value) ? null : { content: value, encoding: "utf16le" };
    }
    if (content.length >= 2 && content[0] === 0xfe && content[1] === 0xff) {
      const value = decodeUtf16Be(content.subarray(2));
      return hasBinaryControlCharacters(value) ? null : { content: value, encoding: "utf16be" };
    }
    if (content.includes(0)) return null;
    const value = new TextDecoder("utf-8", { fatal: true }).decode(content);
    return hasBinaryControlCharacters(value) ? null : { content: value, encoding: "utf8" };
  } catch {
    return null;
  }
}

function encodeText(content: string, encoding: WorkbenchTextEncoding): Buffer {
  if (encoding === "utf8-bom") {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, "utf8")]);
  }
  if (encoding === "utf16le") {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, "utf16le")]);
  }
  if (encoding === "utf16be") {
    const littleEndian = Buffer.from(content, "utf16le");
    const bigEndian = Buffer.allocUnsafe(littleEndian.length);
    for (let index = 0; index < littleEndian.length; index += 2) {
      bigEndian[index] = littleEndian[index + 1] ?? 0;
      bigEndian[index + 1] = littleEndian[index] ?? 0;
    }
    return Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian]);
  }
  return Buffer.from(content, "utf8");
}

export function inspectWorkbenchFile(rootPath: string, filePath: string): WorkbenchFileInspection {
  const lexicalPath = resolveLexicalWorkbenchPath(rootPath, filePath);
  if (!fs.existsSync(lexicalPath)) return { kind: "missing" };
  const canonicalPath = resolveCanonicalWorkbenchPath(rootPath, filePath);
  const stat = fs.statSync(canonicalPath);
  if (!stat.isFile()) throw new Error("不是文件");
  if (stat.size > MAX_WORKBENCH_EDIT_BYTES) {
    return { kind: "external", reason: "too-large", size: stat.size, mtimeMs: stat.mtimeMs };
  }

  const bytes = fs.readFileSync(canonicalPath);
  const decoded = decodeText(bytes);
  if (!decoded) {
    return { kind: "external", reason: "binary", size: stat.size, mtimeMs: stat.mtimeMs };
  }
  return {
    kind: "text",
    content: decoded.content,
    encoding: decoded.encoding,
    version: fileVersion(bytes),
    size: stat.size,
    mtimeMs: stat.mtimeMs
  };
}

function atomicWriteFile(filePath: string, content: Buffer, mode: number): void {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.agent-resume-${process.pid}-${randomBytes(6).toString("hex")}`
  );
  let fd: number | null = null;
  try {
    fd = fs.openSync(tempPath, "wx", mode);
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(tempPath, { force: true });
  }
}

export function saveWorkbenchFile(
  rootPath: string,
  filePath: string,
  content: string,
  encoding: WorkbenchTextEncoding,
  expectedVersion: string,
  force = false
): WorkbenchFileSaveResult {
  const lexicalPath = resolveLexicalWorkbenchPath(rootPath, filePath);
  if (!fs.existsSync(lexicalPath)) return { ok: false, reason: "missing" };
  const canonicalPath = resolveCanonicalWorkbenchPath(rootPath, filePath);
  const stat = fs.statSync(canonicalPath);
  if (!stat.isFile()) throw new Error("不是文件");

  const current = fs.readFileSync(canonicalPath);
  const currentVersion = fileVersion(current);
  if (!force && currentVersion !== expectedVersion) {
    return {
      ok: false,
      reason: "conflict",
      version: currentVersion,
      size: stat.size,
      mtimeMs: stat.mtimeMs
    };
  }

  const encoded = encodeText(content, encoding);
  if (encoded.length > MAX_WORKBENCH_EDIT_BYTES) {
    throw new Error(`文件过大（超过 ${Math.round(MAX_WORKBENCH_EDIT_BYTES / 1024 / 1024)}MB）`);
  }
  atomicWriteFile(canonicalPath, encoded, stat.mode);
  const nextStat = fs.statSync(canonicalPath);
  return {
    ok: true,
    version: fileVersion(encoded),
    size: nextStat.size,
    mtimeMs: nextStat.mtimeMs
  };
}

export function createWorkbenchFile(
  rootPath: string,
  filePath: string,
  content: string,
  encoding: WorkbenchTextEncoding
): WorkbenchFileCreateResult {
  const targetPath = resolveCreatableWorkbenchPath(rootPath, filePath);
  if (fs.existsSync(targetPath)) return { ok: false, reason: "exists" };
  const encoded = encodeText(content, encoding);
  if (encoded.length > MAX_WORKBENCH_EDIT_BYTES) {
    throw new Error(`文件过大（超过 ${Math.round(MAX_WORKBENCH_EDIT_BYTES / 1024 / 1024)}MB）`);
  }
  let fd: number | null = null;
  try {
    fd = fs.openSync(targetPath, "wx", 0o666);
    fs.writeFileSync(fd, encoded);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  const stat = fs.statSync(targetPath);
  return {
    ok: true,
    version: fileVersion(encoded),
    size: stat.size,
    mtimeMs: stat.mtimeMs
  };
}
