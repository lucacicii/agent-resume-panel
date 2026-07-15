import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import * as path from "node:path";
import { expandHome } from "../pathUtils";
import type { WorkbenchProjectEditor } from "../settings/types";

export type ProjectEditorId = Exclude<WorkbenchProjectEditor, "auto">;

export interface ProjectEditor {
  id: ProjectEditorId;
  label: string;
  command: string;
  launchKind: "cli" | "mac-app";
}

interface EditorDefinition {
  id: ProjectEditorId;
  label: string;
  commands: string[];
  macAppName: string;
  macAppPaths: string[];
}

const EDITORS: EditorDefinition[] = [
  {
    id: "vscode",
    label: "VS Code",
    commands: ["code"],
    macAppName: "Visual Studio Code",
    macAppPaths: ["/Applications/Visual Studio Code.app", "~/Applications/Visual Studio Code.app"]
  },
  {
    id: "vscodium",
    label: "VSCodium",
    commands: ["codium"],
    macAppName: "VSCodium",
    macAppPaths: ["/Applications/VSCodium.app", "~/Applications/VSCodium.app"]
  },
  {
    id: "cursor",
    label: "Cursor",
    commands: ["cursor"],
    macAppName: "Cursor",
    macAppPaths: ["/Applications/Cursor.app", "~/Applications/Cursor.app"]
  },
  {
    id: "windsurf",
    label: "Windsurf",
    commands: ["windsurf"],
    macAppName: "Windsurf",
    macAppPaths: ["/Applications/Windsurf.app", "~/Applications/Windsurf.app"]
  }
];

export function projectEditorLabel(editor: WorkbenchProjectEditor): string {
  if (editor === "auto") return "编辑器";
  return EDITORS.find((item) => item.id === editor)?.label || "编辑器";
}

export async function resolveProjectEditor(
  preferred: WorkbenchProjectEditor = "auto"
): Promise<ProjectEditor | null> {
  const candidates = preferred === "auto" ? EDITORS : EDITORS.filter((editor) => editor.id === preferred);
  for (const definition of candidates) {
    const resolved = await resolveEditorDefinition(definition);
    if (resolved) return resolved;
  }
  return null;
}

export async function openProjectInEditor(
  projectPath: string,
  preferred: WorkbenchProjectEditor = "auto"
): Promise<ProjectEditor> {
  const cwd = expandHome(projectPath?.trim() || "");
  if (!cwd) {
    throw new Error("Project path is required.");
  }
  const editor = await resolveProjectEditor(preferred);
  if (!editor) {
    const label = projectEditorLabel(preferred);
    throw new Error(
      preferred === "auto"
        ? "未找到可用的 VS Code、VSCodium、Cursor 或 Windsurf。"
        : `未找到 ${label}，请确认应用已安装或命令行工具可用。`
    );
  }

  if (editor.launchKind === "mac-app") {
    await runDetached("open", ["-a", editor.command, cwd]);
  } else {
    await runDetached(editor.command, [cwd]);
  }
  return editor;
}

async function resolveEditorDefinition(definition: EditorDefinition): Promise<ProjectEditor | null> {
  for (const command of definition.commands) {
    if (await commandExists(command)) {
      return {
        id: definition.id,
        label: definition.label,
        command,
        launchKind: "cli"
      };
    }
  }

  if (process.platform === "darwin") {
    for (const appPath of definition.macAppPaths) {
      if (await pathExists(expandHome(appPath))) {
        return {
          id: definition.id,
          label: definition.label,
          command: definition.macAppName,
          launchKind: "mac-app"
        };
      }
    }
  }
  return null;
}

async function commandExists(command: string): Promise<boolean> {
  const checker = process.platform === "win32" ? "where.exe" : "/usr/bin/env";
  const args = process.platform === "win32" ? [command] : ["sh", "-lc", `command -v ${shellQuote(command)}`];
  return new Promise((resolve) => {
    const child = spawn(checker, args, { stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await access(path.resolve(value));
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function runDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
