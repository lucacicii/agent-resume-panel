import * as vscode from "vscode";
import { defaultAlmaDataDir } from "../alma";
import { expandHome } from "../pathUtils";
import { RenameHomes } from "./index";

export function loadRenameHomes(): RenameHomes {
  const config = vscode.workspace.getConfiguration("agentResume");
  return {
    panelHome: expandHome(config.get<string>("panelHome", "~/.agent-resume-panel")),
    codexHome: expandHome(config.get<string>("codexHome", "~/.codex")),
    claudeHome: expandHome(config.get<string>("claudeHome", "~/.claude")),
    antigravityHome: expandHome(config.get<string>("antigravityHome", "~/.gemini")),
    grokHome: expandHome(config.get<string>("grokHome", "~/.grok")),
    almaDataDir: expandHome(config.get<string>("almaDataDir", defaultAlmaDataDir())),
    opencodeHome: expandHome(config.get<string>("opencodeHome", "~/.local/share/opencode")),
    piHome: expandHome(config.get<string>("piHome", "~/.pi/agent"))
  };
}