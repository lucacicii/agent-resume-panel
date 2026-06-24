import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

const FILE_REF_PATTERN = /@([^\s]+)/g;

const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "out",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "__pycache__",
  ".venv",
  "target"
]);

const KEY_FILES = [
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "README.md",
  "AGENTS.md",
  "vite.config.ts",
  "vite.config.js"
];

const MAX_KEY_FILE_CHARS = 12_000;
const MAX_TREE_ENTRIES = 120;

export async function expandWorkspaceReferences(text: string, projectPath: string): Promise<string> {
  const matches = [...text.matchAll(FILE_REF_PATTERN)];
  if (!matches.length) {
    return text;
  }

  let output = text;
  const seen = new Set<string>();

  for (const match of matches) {
    const token = match[0];
    const relativePath = match[1];
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);

    const filePath = resolveWorkspaceFile(projectPath, relativePath);
    if (!filePath) {
      output = output.replace(token, `${token} (not found)`);
      continue;
    }

    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      const content = Buffer.from(raw).toString("utf8");
      const language = path.extname(filePath).replace(".", "") || "text";
      const block = `\n\nFile: ${relativePath}\n\`\`\`${language}\n${content}\n\`\`\``;
      output = output.replace(token, `${token}${block}`);
    } catch (error) {
      output = output.replace(token, `${token} (read failed: ${formatError(error)})`);
    }
  }

  return output;
}

export function urisToFileReferences(uris: string[], projectPath: string): string[] {
  const projectRoot = path.resolve(projectPath);
  const refs: string[] = [];

  for (const raw of uris) {
    const uri = parseDroppedUri(raw);
    if (!uri || uri.scheme !== "file") {
      continue;
    }

    const absolutePath = path.resolve(uri.fsPath);
    if (!absolutePath.startsWith(projectRoot)) {
      continue;
    }

    const relativePath = path.relative(projectRoot, absolutePath);
    if (!relativePath || relativePath.startsWith("..")) {
      continue;
    }

    refs.push(`@${relativePath}`);
  }

  return refs;
}

function parseDroppedUri(raw: string): vscode.Uri | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return vscode.Uri.parse(trimmed);
  } catch {
    return undefined;
  }
}

function resolveWorkspaceFile(projectPath: string, relativePath: string): string | undefined {
  const normalized = path.normalize(relativePath.replace(/^@/, ""));
  const absolute = path.resolve(projectPath, normalized);

  if (!absolute.startsWith(path.resolve(projectPath))) {
    return undefined;
  }

  return absolute;
}

export async function buildProjectContext(projectPath: string): Promise<string> {
  const root = path.resolve(projectPath);
  const lines = [
    "## Workspace Context",
    `Project root: ${root}`,
    ""
  ];

  const activeFile = getActiveEditorRelativePath(root);
  if (activeFile) {
    lines.push(`Active editor file: ${activeFile}`, "");
  }

  const tree = await listProjectTree(root, root, 0, 2);
  if (tree.length) {
    lines.push("### Project tree (depth 2)", "```", ...tree, "```", "");
  }

  const keyFileBlocks = await readKeyProjectFiles(root);
  if (keyFileBlocks.length) {
    lines.push("### Key project files", ...keyFileBlocks, "");
  }

  lines.push(
    "You can read any project file when the user references it with `@relative/path` or drags it into chat."
  );

  return lines.join("\n");
}

function getActiveEditorRelativePath(projectRoot: string): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  const absolutePath = path.resolve(editor.document.uri.fsPath);
  if (!absolutePath.startsWith(projectRoot)) {
    return undefined;
  }

  return path.relative(projectRoot, absolutePath);
}

async function listProjectTree(
  root: string,
  current: string,
  depth: number,
  maxDepth: number,
  entries: string[] = []
): Promise<string[]> {
  if (entries.length >= MAX_TREE_ENTRIES || depth > maxDepth) {
    return entries;
  }

  let dirEntries;
  try {
    dirEntries = await fs.readdir(current, { withFileTypes: true });
    dirEntries = dirEntries
      .filter((entry) => !String(entry.name).startsWith("."))
      .sort(
        (a, b) =>
          Number(b.isDirectory()) - Number(a.isDirectory()) || String(a.name).localeCompare(String(b.name))
      );
  } catch {
    return entries;
  }

  for (const entry of dirEntries) {
    if (entries.length >= MAX_TREE_ENTRIES) {
      break;
    }

    const name = String(entry.name);
    const indent = "  ".repeat(depth);
    const isDirectory = entry.isDirectory();
    const marker = isDirectory ? "/" : "";
    entries.push(`${indent}${name}${marker}`);

    if (isDirectory && depth < maxDepth && !SKIP_DIR_NAMES.has(name)) {
      await listProjectTree(root, path.join(current, name), depth + 1, maxDepth, entries);
    }
  }

  return entries;
}

async function readKeyProjectFiles(root: string): Promise<string[]> {
  const blocks: string[] = [];

  for (const relativePath of KEY_FILES) {
    const absolutePath = path.join(root, relativePath);
    try {
      const raw = await fs.readFile(absolutePath, "utf8");
      const trimmed = raw.length > MAX_KEY_FILE_CHARS ? `${raw.slice(0, MAX_KEY_FILE_CHARS)}\n... (truncated)` : raw;
      blocks.push(`#### ${relativePath}`, "```", trimmed, "```", "");
    } catch {
      // Optional files are skipped when missing.
    }
  }

  return blocks;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}