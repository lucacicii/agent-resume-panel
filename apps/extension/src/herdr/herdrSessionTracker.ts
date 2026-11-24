import * as path from "node:path";
import * as vscode from "vscode";
import type { AgentSession } from "../history/types";
import { HcClient, type HcEventStream } from "./hcClient";
import { HerdrAppClient } from "./herdrApp";
import {
  extractSessionIdFromTerminal,
  herdrSessionKey,
  matchSessionToHerdr,
  normalizeDirPath
} from "./matcher";
import type {
  HcAppDoc,
  HcAppSpace,
  HcTerminal,
  HerdrRecordedSession,
  HerdrSessionMatch
} from "./types";

const HERDR_SESSIONS_STATE_KEY = "agentResume.herdrSessions.v1";
const HERDR_BRIDGE_EXTENSION_IDS = ["lucacicii.herdr-core-bridge", "lucacicii.herdr-bridge"];

export interface HerdrBridgeSpace {
  id: string;
  name: string;
  folder: string;
  terminals: HcTerminal[];
}

export interface HerdrBridgeApi {
  readonly version: 1;
  isConnected(): boolean;
  getTerminals(): HcTerminal[];
  getSpaces(): HerdrBridgeSpace[];
  readonly onDidChange: vscode.Event<void>;
  openTerminal(address: string, mode?: "native" | "webview"): Promise<void>;
  runAndOpen(params: {
    cwd?: string;
    line?: string;
    name?: string;
    labels?: Record<string, string>;
    spaceId?: string;
  }): Promise<{ address: string; spaceId?: string }>;
  sendTextToActive(text: string): Promise<boolean>;
  renameSpace(spaceId: string, name: string): Promise<void>;
  refresh(): Promise<void>;
}

export class HerdrSessionTracker implements vscode.Disposable {
  readonly client: HcClient;
  readonly herdrApp = new HerdrAppClient();

  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private terminals: HcTerminal[] = [];
  private spaces: HcAppSpace[] = [];
  private spaceNames = new Map<string, string>();
  private recorded = new Map<string, HerdrRecordedSession>();
  private daemonAvailable = false;
  private eventStream: HcEventStream | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  private bridgeApi: HerdrBridgeApi | undefined;
  private bridgeSub: vscode.Disposable | undefined;
  private disposed = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    socketPath = ""
  ) {
    this.client = new HcClient(socketPath);
    this.loadRecordedSessions();
  }

  private loadRecordedSessions(): void {
    const saved =
      this.context.globalState.get<Record<string, HerdrRecordedSession>>(HERDR_SESSIONS_STATE_KEY);
    if (!saved || typeof saved !== "object") {
      return;
    }
    for (const [key, value] of Object.entries(saved)) {
      if (value && value.provider && value.id) {
        this.recorded.set(key, value);
      }
    }
  }

  private async saveRecordedSessions(): Promise<void> {
    const obj: Record<string, HerdrRecordedSession> = {};
    for (const [key, val] of this.recorded) {
      obj[key] = val;
    }
    await this.context.globalState.update(HERDR_SESSIONS_STATE_KEY, obj);
  }

  isDaemonAvailable(): boolean {
    return this.daemonAvailable;
  }

  getTerminals(): HcTerminal[] {
    return this.terminals;
  }

  getBridgeApi(): HerdrBridgeApi | undefined {
    return this.bridgeApi;
  }

  private enabled = true;

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) {
      return;
    }
    this.enabled = enabled;
    if (!enabled) {
      this.bridgeSub?.dispose();
      this.bridgeSub = undefined;
      this.bridgeApi = undefined;
      this.stopEventLoop();
      this.daemonAvailable = false;
      this.terminals = [];
      this.onDidChangeEmitter.fire();
      return;
    }
    void this.initialize();
  }

  setSocketPath(socketPath: string): void {
    this.client.setSocketPath(socketPath);
    if (!this.enabled) {
      return;
    }
    if (this.bridgeApi) {
      void this.syncFromBridge();
      return;
    }
    this.stopEventLoop();
    void this.refresh().then(() => {
      if (!this.disposed && this.enabled) {
        this.startEventLoop();
      }
    });
  }

  async initialize(): Promise<void> {
    if (!this.enabled || this.disposed) {
      return;
    }
    if (await this.tryAttachBridge()) {
      return;
    }
    await this.refresh();
    if (!this.disposed && this.enabled) {
      this.startEventLoop();
    }
  }

  private async tryAttachBridge(): Promise<boolean> {
    for (const id of HERDR_BRIDGE_EXTENSION_IDS) {
      const ext = vscode.extensions.getExtension<HerdrBridgeApi>(id);
      if (!ext) {
        continue;
      }
      try {
        const api = ext.isActive ? ext.exports : await ext.activate();
        if (api && api.version === 1) {
          this.bridgeApi = api;
          this.bridgeSub?.dispose();
          this.bridgeSub = api.onDidChange(() => {
            void this.syncFromBridge();
          });
          await this.syncFromBridge();
          return true;
        }
      } catch {
        // fallback to built-in socket client
      }
    }
    return false;
  }

  private async syncFromBridge(): Promise<void> {
    if (this.disposed || !this.bridgeApi) {
      return;
    }
    this.daemonAvailable = this.bridgeApi.isConnected();
    this.terminals = this.bridgeApi.getTerminals();
    const bridgeSpaces = this.bridgeApi.getSpaces();
    this.spaces = bridgeSpaces.map((sp) => ({
      id: sp.id,
      name: sp.name,
      folder: sp.folder
    }));
    const nextNames = new Map<string, string>();
    for (const sp of bridgeSpaces) {
      if (sp.id && sp.name) {
        nextNames.set(sp.id, sp.name);
      }
    }
    this.spaceNames = nextNames;
    await this.recordMatchedFromTerminals();
    this.onDidChangeEmitter.fire();
  }

  getSpaceByFolder(folder: string): HcAppSpace | undefined {
    const target = normalizeDirPath(folder);
    if (!target) {
      return undefined;
    }
    return this.spaces.find((sp) => !sp.machine && normalizeDirPath(sp.folder) === target);
  }

  getSpaceNameForFolder(folder: string): string | undefined {
    const sp = this.getSpaceByFolder(folder);
    if (!sp?.id) {
      return undefined;
    }
    const name = this.spaceNames.get(sp.id) ?? sp.name?.trim();
    if (!name) {
      return undefined;
    }
    const base = path.basename(normalizeDirPath(folder));
    return name !== base ? name : undefined;
  }

  getSpaceName(spaceId?: string): string | undefined {
    if (!spaceId) {
      return undefined;
    }
    return this.spaceNames.get(spaceId);
  }

  resolve(session: AgentSession): HerdrSessionMatch | undefined {
    return matchSessionToHerdr(session, this.terminals, this.spaceNames, this.recorded);
  }

  async markLaunchedInHerdr(
    session: Pick<AgentSession, "provider" | "id">,
    meta: { address?: string; spaceId?: string; spaceName?: string }
  ): Promise<void> {
    const key = herdrSessionKey(session.provider, session.id);
    const spaceName = meta.spaceName ?? (meta.spaceId ? this.spaceNames.get(meta.spaceId) : undefined);
    this.recorded.set(key, {
      provider: session.provider,
      id: session.id,
      lastAddress: meta.address,
      spaceId: meta.spaceId,
      spaceName,
      updatedAt: Date.now()
    });
    await this.saveRecordedSessions();
    this.onDidChangeEmitter.fire();
  }

  async refresh(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.bridgeApi) {
      await this.bridgeApi.refresh();
      await this.syncFromBridge();
      return;
    }
    try {
      await this.client.serverStatus(1200);
      const [list, doc] = await Promise.all([
        this.client.listTerminals(true),
        this.client.docGet<HcAppDoc>("herdr-app").catch(() => undefined)
      ]);
      this.daemonAvailable = true;
      this.terminals = list.terminals ?? [];
      this.updateSpaces(doc);
      await this.recordMatchedFromTerminals();
    } catch {
      this.daemonAvailable = false;
      this.terminals = [];
    }
    this.onDidChangeEmitter.fire();
  }

  private updateSpaces(doc?: HcAppDoc): void {
    const nextSpaces = Array.isArray(doc?.spaces) ? doc.spaces : [];
    const nextNames = new Map<string, string>();
    for (const sp of nextSpaces) {
      if (!sp.id) {
        continue;
      }
      const explicit = sp.name?.trim();
      const base = sp.folder ? path.basename(sp.folder) : "";
      nextNames.set(sp.id, explicit || base || sp.id);
    }
    this.spaces = nextSpaces;
    this.spaceNames = nextNames;
  }

  private async recordMatchedFromTerminals(): Promise<void> {
    let dirty = false;
    for (const term of this.terminals) {
      const extracted = extractSessionIdFromTerminal(term);
      if (!extracted?.provider || !extracted.id) {
        continue;
      }
      const key = herdrSessionKey(extracted.provider, extracted.id);
      const spaceId = term.labels?.["herdr.space"];
      const spaceName =
        (spaceId ? this.spaceNames.get(spaceId) : undefined) ||
        term.labels?.where?.split(" / ")[0]?.trim() ||
        undefined;
      const existing = this.recorded.get(key);
      if (
        !existing ||
        existing.lastAddress !== term.address ||
        (spaceId && existing.spaceId !== spaceId)
      ) {
        this.recorded.set(key, {
          provider: extracted.provider,
          id: extracted.id,
          lastAddress: term.address,
          spaceId: spaceId ?? existing?.spaceId,
          spaceName: spaceName ?? existing?.spaceName,
          updatedAt: term.status_ms ?? term.created_ms ?? Date.now()
        });
        dirty = true;
      }
    }
    if (dirty) {
      await this.saveRecordedSessions();
    }
  }

  private scheduleRefresh(delayMs = 150): void {
    if (this.disposed) {
      return;
    }
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
    }
    this.refreshDebounceTimer = setTimeout(() => {
      this.refreshDebounceTimer = undefined;
      void this.refresh();
    }, delayMs);
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.disposed || this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.startEventLoop();
    }, delayMs);
  }

  private stopEventLoop(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.eventStream) {
      this.eventStream.removeAllListeners();
      this.eventStream.close();
      this.eventStream = undefined;
    }
  }

  private startEventLoop(): void {
    if (this.disposed || this.eventStream) {
      return;
    }
    void this.connectEvents();
  }

  private async connectEvents(): Promise<void> {
    if (this.disposed) {
      return;
    }
    try {
      const stream = await this.client.subscribeEvents();
      if (this.disposed) {
        stream.close();
        return;
      }
      this.eventStream = stream;
      this.daemonAvailable = true;
      await this.refresh();

      stream.on("event", () => {
        this.scheduleRefresh(150);
      });

      stream.on("close", () => {
        if (this.eventStream === stream) {
          this.eventStream = undefined;
        }
        if (!this.disposed) {
          this.daemonAvailable = false;
          this.onDidChangeEmitter.fire();
          this.scheduleReconnect(2000);
        }
      });
    } catch {
      if (!this.disposed) {
        this.daemonAvailable = false;
        this.scheduleReconnect(5000);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.bridgeSub?.dispose();
    this.bridgeSub = undefined;
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
    }
    this.stopEventLoop();
    this.onDidChangeEmitter.dispose();
  }
}
