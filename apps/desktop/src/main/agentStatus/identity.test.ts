import { describe, expect, it } from "vitest";
import {
  executableBaseName,
  findAgentProcess,
  kindForExecutable,
  kindForProcess,
  kindForProvider,
  kindForSessionKey,
  kindFromRuntimeArgv
} from "./identity";
import { parseProcessTable, type ProcessEntry } from "./processTable";

function entry(overrides: Partial<ProcessEntry> = {}): ProcessEntry {
  return {
    pid: 11,
    ppid: 10,
    pgid: 11,
    tpgid: 11,
    tty: "ttys003",
    command: "claude",
    ...overrides
  };
}

describe("executableBaseName", () => {
  it("strips directories, quotes, a JS extension, and case", () => {
    expect(executableBaseName("/Users/someone/.local/bin/Claude")).toBe("claude");
    expect(executableBaseName("'/opt/homebrew/bin/pi.js'")).toBe("pi");
    expect(executableBaseName("node")).toBe("node");
    expect(executableBaseName("   ")).toBe("");
  });
});

describe("kindForExecutable", () => {
  it("names every agent the app can resume a session for", () => {
    expect(kindForExecutable("/Users/x/.local/bin/claude")).toBe("claude");
    expect(kindForExecutable("codex")).toBe("codex");
    expect(kindForExecutable("/opt/homebrew/bin/opencode")).toBe("opencode");
    expect(kindForExecutable("grok")).toBe("grok");
    expect(kindForExecutable("/Users/x/.local/bin/cursor-agent")).toBe("cursor");
    expect(kindForExecutable("/opt/homebrew/bin/agy")).toBe("agy");
    expect(kindForExecutable("prime-agent")).toBe("prime");
  });

  it("ignores anything that is not an agent", () => {
    expect(kindForExecutable("/bin/zsh")).toBeNull();
    expect(kindForExecutable("node")).toBeNull();
    expect(kindForExecutable("")).toBeNull();
  });
});

describe("kindForProvider / kindForSessionKey", () => {
  it("maps provider ids onto kinds", () => {
    expect(kindForProvider("pi")).toBe("pi");
    expect(kindForProvider("Pi")).toBe("pi");
    expect(kindForProvider("cursor-ide")).toBeNull();
    expect(kindForProvider("chat")).toBeNull();
  });

  it("reads the provider out of a session key", () => {
    expect(kindForSessionKey("cli:claude:abc123")).toBe("claude");
    expect(kindForSessionKey("cli:opencode:xyz")).toBe("opencode");
    expect(kindForSessionKey("acp:record")).toBeNull();
    expect(kindForSessionKey("cli:chat:1")).toBeNull();
    expect(kindForSessionKey(undefined)).toBeNull();
  });
});

describe("kindFromRuntimeArgv", () => {
  it("unwraps an npm-installed CLI running behind an interpreter", () => {
    expect(kindFromRuntimeArgv(["node", "/Users/x/.fnm/v24/bin/pi", "--session", "abc"])).toBe("pi");
    expect(kindFromRuntimeArgv(["bun", "/Users/x/.bun/bin/opencode"])).toBe("opencode");
  });

  it("does not name an arbitrary script the runtime merely loads", () => {
    expect(kindFromRuntimeArgv(["node", "/tmp/server.js"])).toBeNull();
    expect(kindFromRuntimeArgv(["node"])).toBeNull();
    expect(kindFromRuntimeArgv(["/bin/zsh", "pi"])).toBeNull();
  });
});

describe("kindForProcess", () => {
  it("prefers the executable and falls back to argv", () => {
    expect(kindForProcess(entry({ command: "claude" }))).toBe("claude");
    expect(kindForProcess(entry({
      command: "/Users/x/.fnm/v24/bin/node",
      argv: ["node", "/Users/x/.fnm/v24/bin/pi"]
    }))).toBe("pi");
  });
});

describe("findAgentProcess", () => {
  it("returns the shallowest agent so a nested one cannot steal the pane", () => {
    const entries = parseProcessTable([
      "10 1 10 11 ttys003 /bin/zsh",
      "11 10 11 11 ttys003 claude",
      "12 11 11 11 ttys003 /bin/bash",
      "13 12 11 11 ttys003 codex"
    ].join("\n"));
    expect(findAgentProcess(entries, 10)).toMatchObject({ kind: "claude", entry: { pid: 11 } });
  });

  it("finds an agent hidden behind a shell wrapper", () => {
    const entries = parseProcessTable([
      "10 1 10 11 ttys003 /bin/zsh",
      "11 10 11 11 ttys003 /bin/zsh",
      "12 11 11 11 ttys003 opencode"
    ].join("\n"));
    expect(findAgentProcess(entries, 10)).toMatchObject({ kind: "opencode", entry: { pid: 12 } });
  });

  it("returns null for a plain shell and for an unknown root", () => {
    expect(findAgentProcess(parseProcessTable("10 1 10 10 ttys003 /bin/zsh\n"), 10)).toBeNull();
    expect(findAgentProcess(parseProcessTable("10 1 10 10 ttys003 /bin/zsh\n"), 999)).toBeNull();
  });
});
