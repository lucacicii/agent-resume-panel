import * as vscode from "vscode";
import {
  claimSessionAutoRename,
  listBackgroundAutoRenameCandidates,
  markSessionAutoRenameDone,
  markSessionAutoRenameFailed,
  markSessionAutoRenameSkipped
} from "@agent-resume/core/extension";
import { renameSessionIfUnsetWithCatalog } from "../catalog/rename";
import type { HcTerminal } from "../herdr/types";
import { AgentSession } from "../history";
import { loadSessionPreview } from "../history/preview";
import { loadRenameHomes } from "../history/rename/homes";
import { isLlmConfigured } from "./config";
import { suggestSessionTitle } from "./sessionAssist";

const BACKGROUND_AUTO_RENAME_WINDOW_MS = 24 * 60 * 60 * 1000;
const BACKGROUND_AUTO_RENAME_MIN_MESSAGES = 2;
const BACKGROUND_AUTO_RENAME_SCAN_LIMIT = 10;
const HERDR_IDLE_DEBOUNCE_MS = 1500;

const ACTIVE_HERDR_STATES = new Set(["working", "blocked"]);
const IDLE_HERDR_STATES = new Set(["done", "idle"]);

export interface BackgroundAutoRenameDeps {
  context: vscode.ExtensionContext;
  onHerdrBecameIdle: () => void;
  onSessionRenamed: () => void;
}

function sessionKey(session: Pick<AgentSession, "provider" | "id">): string {
  return `${session.provider}:${session.id}`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Coordinates silent, deduplicated background session auto-renaming after catalog refreshes
 * and when tracked Herdr terminals settle from working/blocked into done/idle.
 */
export class BackgroundAutoRenameController implements vscode.Disposable {
  private readonly lastTerminalStates = new Map<string, string>();
  private readonly inFlight = new Set<string>();
  private herdrIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private draining = false;
  private rescanRequested = false;
  private pendingDbPath: string | undefined;
  private disposed = false;

  constructor(private readonly deps: BackgroundAutoRenameDeps) {}

  isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("agentResume")
      .get<boolean>("llm.autoRenameBackground", false);
  }

  scheduleScan(dbPath: string): void {
    if (this.disposed || !dbPath || !this.isEnabled()) {
      return;
    }
    this.pendingDbPath = dbPath;
    if (this.draining) {
      this.rescanRequested = true;
      return;
    }
    void this.runDrainLoop(dbPath);
  }

  onHerdrTerminalsChanged(terminals: HcTerminal[]): void {
    if (this.disposed) {
      return;
    }

    const activeAddresses = new Set<string>();
    let becameIdle = false;

    for (const term of terminals) {
      activeAddresses.add(term.address);
      const nextState = term.status?.state ?? "";
      const prevState = this.lastTerminalStates.get(term.address) ?? "";
      if (ACTIVE_HERDR_STATES.has(prevState) && IDLE_HERDR_STATES.has(nextState)) {
        becameIdle = true;
      }
      this.lastTerminalStates.set(term.address, nextState);
    }

    for (const addr of this.lastTerminalStates.keys()) {
      if (!activeAddresses.has(addr)) {
        this.lastTerminalStates.delete(addr);
      }
    }

    if (becameIdle && this.isEnabled()) {
      this.scheduleHerdrIdleRefresh();
    }
  }

  private scheduleHerdrIdleRefresh(): void {
    if (this.herdrIdleTimer) {
      clearTimeout(this.herdrIdleTimer);
    }
    this.herdrIdleTimer = setTimeout(() => {
      this.herdrIdleTimer = undefined;
      if (!this.disposed && this.isEnabled()) {
        this.deps.onHerdrBecameIdle();
      }
    }, HERDR_IDLE_DEBOUNCE_MS);
  }

  private async runDrainLoop(initialDbPath: string): Promise<void> {
    this.draining = true;
    let nextDbPath: string | undefined = initialDbPath;
    try {
      while (nextDbPath && !this.disposed && this.isEnabled()) {
        this.rescanRequested = false;
        await this.drainOnce(nextDbPath);
        nextDbPath = this.rescanRequested ? this.pendingDbPath : undefined;
      }
    } finally {
      this.draining = false;
      this.rescanRequested = false;
    }
  }

  private async drainOnce(dbPath: string): Promise<void> {
    if (!(await isLlmConfigured(this.deps.context))) {
      return;
    }

    const candidates = await listBackgroundAutoRenameCandidates(dbPath, {
      sinceMs: Date.now() - BACKGROUND_AUTO_RENAME_WINDOW_MS,
      minMessages: BACKGROUND_AUTO_RENAME_MIN_MESSAGES,
      limit: BACKGROUND_AUTO_RENAME_SCAN_LIMIT
    });

    for (const session of candidates) {
      if (this.disposed || !this.isEnabled()) {
        break;
      }
      await this.processCandidate(dbPath, session);
    }
  }

  private async processCandidate(dbPath: string, session: AgentSession): Promise<void> {
    const key = sessionKey(session);
    if (this.inFlight.has(key)) {
      return;
    }

    this.inFlight.add(key);
    try {
      const claimed = await claimSessionAutoRename(dbPath, session.provider, session.id);
      if (!claimed || this.disposed || !this.isEnabled()) {
        return;
      }

      const homes = loadRenameHomes();
      const preview = await loadSessionPreview(session, homes);
      if (preview.messages.length < BACKGROUND_AUTO_RENAME_MIN_MESSAGES) {
        await markSessionAutoRenameSkipped(dbPath, session.provider, session.id, "insufficient-messages");
        return;
      }

      const newTitle = await suggestSessionTitle(this.deps.context, session, preview.messages);
      if (!newTitle) {
        throw new Error("LLM returned an empty title.");
      }

      const renamed = await renameSessionIfUnsetWithCatalog(session, newTitle, homes);
      await markSessionAutoRenameDone(dbPath, session.provider, session.id);
      if (renamed && !this.disposed) {
        this.deps.onSessionRenamed();
      }
    } catch (error) {
      const message = formatError(error);
      console.warn(`[agent-resume-panel] Background auto-rename failed for ${key}:`, message);
      await markSessionAutoRenameFailed(dbPath, session.provider, session.id, message).catch(() => undefined);
    } finally {
      this.inFlight.delete(key);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.rescanRequested = false;
    this.pendingDbPath = undefined;
    if (this.herdrIdleTimer) {
      clearTimeout(this.herdrIdleTimer);
      this.herdrIdleTimer = undefined;
    }
    this.lastTerminalStates.clear();
    this.inFlight.clear();
  }
}
