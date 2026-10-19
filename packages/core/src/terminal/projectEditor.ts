import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import * as path from "node:path";
import { createUiText } from "../i18n/uiText";
import { expandHome } from "../pathUtils";
import { spawnSpecFor } from "../executable";
import { quotePosix } from "../platform";
import { loadSettings } from "../settings/store";
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
  windowsPaths: string[];
}

const LOCAL_APP_DATA = "%LOCALAPPDATA%\\Programs";

const EDITORS: EditorDefinition[] = [
  {
    id: "vscode",
    label: "VS Code",
    commands: ["code"],
    macAppName: "Visual Studio Code",
    macAppPaths: ["/Applications/Visual Studio Code.app", "~/Applications/Visual Studio Code.app"],
    windowsPaths: [`${LOCAL_APP_DATA}\\Microsoft VS Code\\bin\\code.cmd`]
  },
  {
    id: "vscodium",
    label: "VSCodium",
    commands: ["codium"],
    macAppName: "VSCodium",
    macAppPaths: ["/Applications/VSCodium.app", "~/Applications/VSCodium.app"],
    windowsPaths: [`${LOCAL_APP_DATA}\\VSCodium\\bin\\codium.cmd`]
  },
  {
    id: "cursor",
    label: "Cursor",
    commands: ["cursor"],
    macAppName: "Cursor",
    macAppPaths: ["/Applications/Cursor.app", "~/Applications/Cursor.app"],
    windowsPaths: [`${LOCAL_APP_DATA}\\cursor\\resources\\app\\bin\\cursor.cmd`]
  },
  {
    id: "windsurf",
    label: "Windsurf",
    commands: ["windsurf"],
    macAppName: "Windsurf",
    macAppPaths: ["/Applications/Windsurf.app", "~/Applications/Windsurf.app"],
    windowsPaths: [`${LOCAL_APP_DATA}\\Windsurf\\bin\\windsurf.cmd`]
  }
];

export function projectEditorLabel(editor: WorkbenchProjectEditor): string {
  if (editor === "auto") return "Editor";
  return EDITORS.find((item) => item.id === editor)?.label || "Editor";
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
  preferred: WorkbenchProjectEditor = "auto",
  systemLocale?: string
): Promise<ProjectEditor> {
  const cwd = expandHome(projectPath?.trim() || "");
  if (!cwd) {
    throw new Error("Project path is required.");
  }
  const settings = await loadSettings();
  const pt = createUiText(settings, systemLocale);
  const editor = await resolveProjectEditor(preferred);
  if (!editor) {
    const label =
      preferred === "auto" ? pt("desktop.workbench.editorAuto") : projectEditorLabel(preferred);
    throw new Error(
      preferred === "auto"
        ? pt("desktop.workbench.editorNotFoundAuto")
        : pt("desktop.workbench.editorNotFound", label)
    );
  }

  if (editor.launchKind === "mac-app") {
    await runDetached("open", ["-a", editor.command, cwd]);
  } else {
    // On Windows `code` is `code.cmd`: spawning it directly fails, so the
    // editor is launched through cmd.exe with the path kept as one argument.
    const spec = spawnSpecFor(editor.command, [cwd]);
    await runDetached(spec.file, spec.args);
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

  if (process.platform === "win32") {
    // The CLI shim is only on PATH when the user asked the installer to add it.
    for (const candidate of definition.windowsPaths) {
      const expanded = expandHome(candidate);
      if (await pathExists(expanded)) {
        return {
          id: definition.id,
          label: definition.label,
          command: expanded,
          launchKind: "cli"
        };
      }
    }
  }
  return null;
}

async function commandExists(command: string): Promise<boolean> {
  const checker = process.platform === "win32" ? "where.exe" : "/usr/bin/env";
  const args = process.platform === "win32" ? [command] : ["sh", "-lc", `command -v ${quotePosix(command)}`];
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
