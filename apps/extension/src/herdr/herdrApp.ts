import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
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

  getPath(refresh = false): string | undefined {
    if (!this.lookedUp || refresh) {
      this.lookedUp = true;
      this.cachedPath = findHerdrAppBinary();
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

    const deadline = Date.now() + 10000;
    while (true) {
      try {
        await this.doCommand("terminal.keep", { terminal: terminalId, place: "tab" });
        break;
      } catch (err) {
        if (Date.now() >= deadline) {
          throw err;
        }
        await sleep(200);
      }
    }

    if (previousSpaceId) {
      try {
        await this.selectSpace(previousSpaceId);
      } catch {
        // non-fatal
      }
    }
  }

  async activateHerdrApp(): Promise<void> {
    if (process.platform === "darwin") {
      await execFileAsync("open", ["-a", "Herdr"], { timeout: 5000 }).catch(() => undefined);
    }
  }
}
