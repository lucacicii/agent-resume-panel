import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { deriveSpaceNameFromFolder } from "./naming";
import type { HcAppSpace } from "./types";

const execFileAsync = promisify(execFile);

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findHerdrAppBinary(): string | undefined {
  const explicit = process.env.HERDR_APP_BIN?.trim();
  if (explicit) {
    return isExecutableFile(explicit) ? explicit : undefined;
  }

  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = path.join(dir, "herdr-app");
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  const home = os.homedir();
  const candidates = [
    path.join(home, ".local", "bin", "herdr-app"),
    "/Applications/Herdr.app/Contents/MacOS/Herdr",
    "/usr/local/bin/herdr-app"
  ];
  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function cleanDirPath(dir: string): string {
  const trimmed = dir.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return fs.realpathSync(trimmed);
  } catch {
    return path.resolve(trimmed);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HerdrAppClient {
  private cachedPath: string | undefined;
  private lookedUp = false;

  constructor(private readonly explicitPath?: string) {}

  getPath(refresh = false): string | undefined {
    if (!this.lookedUp || refresh) {
      this.lookedUp = true;
      if (this.explicitPath) {
        const trimmed = this.explicitPath.trim();
        this.cachedPath = trimmed && isExecutableFile(trimmed) ? trimmed : undefined;
      } else {
        this.cachedPath = findHerdrAppBinary();
      }
    }
    return this.cachedPath;
  }

  isAvailable(): boolean {
    return Boolean(this.getPath());
  }

  private async run(args: string[]): Promise<string> {
    const bin = this.getPath(true);
    if (!bin) {
      throw new Error("Herdr app CLI not found");
    }
    const { stdout } = await execFileAsync(bin, args, { timeout: 20000 });
    return stdout;
  }

  async doCommand(command: string, args: Record<string, string>): Promise<Record<string, unknown>> {
    const argv = ["do", command];
    for (const key of Object.keys(args).sort()) {
      argv.push(`--${key}`, args[key]);
    }
    const raw = await this.run(argv);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.error === "string" && parsed.error) {
      throw new Error(parsed.error);
    }
    return parsed;
  }

  async listSpaces(): Promise<HcAppSpace[]> {
    const raw = await this.run(["ls"]);
    const parsed = JSON.parse(raw) as { spaces?: HcAppSpace[] };
    return parsed.spaces ?? [];
  }

  async findSpaceByFolder(folder: string): Promise<HcAppSpace | undefined> {
    const target = cleanDirPath(folder);
    if (!target) {
      return undefined;
    }
    const spaces = await this.listSpaces();
    return spaces.find((sp) => !sp.machine && cleanDirPath(sp.folder) === target);
  }

  async selectSpace(spaceId: string): Promise<void> {
    if (!spaceId) {
      return;
    }
    await this.doCommand("space.select", { id: spaceId });
  }

  async createSpace(name: string, folder: string): Promise<string> {
    const args: Record<string, string> = { folder, focus: "true" };
    if (name.trim()) {
      args.name = name.trim();
    }
    const res = await this.doCommand("space.new", args);
    const id = typeof res.space === "string" ? res.space : "";
    if (!id) {
      throw new Error("herdr-app space.new returned no space id");
    }
    return id;
  }

  private async keepOne(terminalId: string): Promise<void> {
    const deadline = Date.now() + 10000;
    while (true) {
      try {
        await this.doCommand("terminal.keep", { terminal: terminalId, place: "tab" });
        return;
      } catch (err) {
        if (Date.now() >= deadline) {
          throw err;
        }
        await sleep(200);
      }
    }
  }

  private async waitForTerminalInSpace(
    spaceId: string,
    terminalId: string,
    timeoutMs = 3000
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      try {
        const spaces = await this.listSpaces();
        const target = spaces.find((s) => s.id === spaceId);
        if (
          target?.tabs?.some((tab) =>
            tab.terminals?.some((term) => term.terminal === terminalId)
          )
        ) {
          return true;
        }
      } catch {
        return false;
      }
      if (Date.now() >= deadline) {
        return false;
      }
      await sleep(100);
    }
  }

  async keepTerminalInSpace(terminalId: string, spaceId: string): Promise<void> {
    if (!terminalId || !spaceId) {
      return;
    }
    let previousSpaceId = "";
    try {
      const spaces = await this.listSpaces();
      const active = spaces.find((s) => s.active && s.id !== spaceId);
      if (active) {
        previousSpaceId = active.id;
      }
    } catch {
      // ignore
    }

    await this.selectSpace(spaceId);
    await this.keepOne(terminalId);

    if (previousSpaceId) {
      try {
        await this.selectSpace(previousSpaceId);
      } catch {
        // non-fatal
      }
    }
  }

  /**
   * Ensure terminalId belongs to a local Herdr space matching folder; if none exists,
   * create a new space named after the folder, move terminalId into it, and close the
   * placeholder shell tab created by space.new.
   */
  async ensureSpaceForTerminal(
    name: string,
    folder: string,
    terminalId: string
  ): Promise<{ spaceId: string; created: boolean }> {
    if (!terminalId) {
      throw new Error("terminalId is required");
    }
    const cleanFolder = folder.trim();
    if (cleanFolder) {
      const existing = await this.findSpaceByFolder(cleanFolder).catch(() => undefined);
      if (existing?.id) {
        await this.keepTerminalInSpace(terminalId, existing.id);
        return { spaceId: existing.id, created: false };
      }
    }

    let previousSpaceId = "";
    try {
      const spaces = await this.listSpaces();
      const active = spaces.find((s) => s.active);
      if (active) {
        previousSpaceId = active.id;
      }
    } catch {
      // non-fatal
    }

    const spaceName = name.trim() || deriveSpaceNameFromFolder(cleanFolder);
    const args: Record<string, string> = { focus: "false" };
    if (spaceName) {
      args.name = spaceName;
    }
    if (cleanFolder) {
      args.folder = cleanFolder;
    }
    const created = await this.doCommand("space.new", args);
    const spaceId = typeof created.space === "string" ? created.space : "";
    const shellTab = typeof created.tab === "string" ? created.tab : "";
    if (!spaceId) {
      throw new Error("herdr-app space.new returned no space id");
    }

    await this.selectSpace(spaceId);
    await this.keepOne(terminalId);
    const shown = await this.waitForTerminalInSpace(spaceId, terminalId);
    if (shellTab && shown) {
      await this.doCommand("tab.close", { id: shellTab, confirmed: "true" }).catch(() => undefined);
    }

    if (previousSpaceId && previousSpaceId !== spaceId) {
      await this.selectSpace(previousSpaceId).catch(() => undefined);
    }

    return { spaceId, created: true };
  }

  async activateHerdrApp(): Promise<void> {
    if (process.platform === "darwin") {
      await execFileAsync("open", ["-a", "Herdr"], { timeout: 5000 }).catch(() => undefined);
    }
  }
}
