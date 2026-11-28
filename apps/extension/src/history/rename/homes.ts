import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { defaultAlmaHome } from "@agent-resume/core/extension";
import { expandHome } from "../pathUtils";
import { RenameHomes } from "./index";

function defaultCursorIdeUserDataHome(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Cursor", "User");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Cursor", "User");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Cursor", "User");
}

export function loadRenameHomes(): RenameHomes {
  const config = vscode.workspace.getConfiguration("agentResume");
  const configuredCursorIdeUserDataHome = config.get<string>("cursorIdeUserDataHome", "").trim();
  const configuredAlmaHome = config.get<string>("almaHome", "").trim();
  return {
    panelHome: expandHome(config.get<string>("panelHome", "~/.agent-resume-panel")),
    codexHome: expandHome(config.get<string>("codexHome", "~/.codex")),
    claudeHome: expandHome(config.get<string>("claudeHome", "~/.claude")),
    antigravityHome: expandHome(config.get<string>("antigravityHome", "~/.gemini")),
    grokHome: expandHome(config.get<string>("grokHome", "~/.grok")),
    opencodeHome: expandHome(config.get<string>("opencodeHome", "~/.local/share/opencode")),
    piHome: expandHome(config.get<string>("piHome", "~/.pi/agent")),
    primeHome: expandHome(config.get<string>("primeHome", "~/.prime/agent")),
    ompHome: expandHome(config.get<string>("ompHome", "~/.omp/agent")),
    cursorHome: expandHome(config.get<string>("cursorHome", "~/.cursor")),
    cursorIdeUserDataHome: configuredCursorIdeUserDataHome
      ? expandHome(configuredCursorIdeUserDataHome)
      : defaultCursorIdeUserDataHome(),
    almaHome: configuredAlmaHome ? expandHome(configuredAlmaHome) : defaultAlmaHome()
  };
}
