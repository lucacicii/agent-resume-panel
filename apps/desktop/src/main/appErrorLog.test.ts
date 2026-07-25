import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-resume/core", async () => {
  const actual = await vi.importActual<typeof import("@agent-resume/core")>("@agent-resume/core");
  return {
    ...actual,
    loadSettings: vi.fn(async () => ({ panelHome: process.env.AGENT_RESUME_TEST_PANEL_HOME })),
    effectivePanelHome: (settings: { panelHome?: string }) => settings.panelHome || process.env.AGENT_RESUME_TEST_PANEL_HOME || ""
  };
});

import {
  APP_ERROR_LOG_FILE_NAME,
  APP_ERROR_LOG_MAX_ENTRIES,
  clearAppErrors,
  formatUnknownError,
  listAppErrors,
  parseAppErrorLogText,
  recordAppError,
  redactSecrets,
  serializeAppErrorEntries,
  trimAppErrorEntries,
  truncateText
} from "./appErrorLog";

const roots: string[] = [];

async function makeHome(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-error-log-"));
  roots.push(root);
  process.env.AGENT_RESUME_TEST_PANEL_HOME = root;
  return root;
}

describe("appErrorLog pure helpers", () => {
  it("redacts common secret patterns", () => {
    expect(redactSecrets("key sk-abc123456789 and Bearer tok_secret_value_here")).toContain("sk-[REDACTED]");
    expect(redactSecrets("api_key=supersecretvalue")).toContain("[REDACTED]");
    expect(redactSecrets("password: hunter2password")).toContain("[REDACTED]");
  });

  it("truncates long text", () => {
    expect(truncateText("abcdef", 4)).toBe("abc…");
    expect(truncateText("ab", 4)).toBe("ab");
  });

  it("formats unknown errors", () => {
    const err = new Error("boom");
    const formatted = formatUnknownError(err);
    expect(formatted.message).toBe("boom");
    expect(formatted.detail).toContain("Error: boom");
    expect(formatUnknownError("plain").message).toBe("plain");
  });

  it("parses and trims JSONL entries newest-safe", () => {
    const entries = Array.from({ length: 3 }, (_, i) => ({
      id: `id-${i}`,
      createdAtMs: i,
      level: "error" as const,
      source: "test",
      message: `m${i}`
    }));
    const text = serializeAppErrorEntries(entries);
    const parsed = parseAppErrorLogText(text);
    expect(parsed).toHaveLength(3);
    expect(trimAppErrorEntries(parsed, 2)).toEqual(entries.slice(1));
  });
});

describe("appErrorLog store", () => {
  afterEach(async () => {
    delete process.env.AGENT_RESUME_TEST_PANEL_HOME;
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("records, lists newest-first, and clears", async () => {
    const home = await makeHome();
    await recordAppError({ source: "unit-test", message: "first" });
    await recordAppError({ source: "unit-test", message: "second", level: "warn" });
    await recordAppError({
      source: "unit-test",
      message: "leaked sk-abcdefghijklmnopqrstuvwxyz",
      detail: "api_key=should_not_persist_plain"
    });

    const listed = await listAppErrors({ limit: 10 });
    expect(listed.length).toBe(3);
    expect(listed[0]?.message).toContain("sk-[REDACTED]");
    expect(listed[0]?.detail).toContain("[REDACTED]");
    expect(listed.map((e) => e.message)).toContain("second");
    expect(listed[0]!.createdAtMs).toBeGreaterThanOrEqual(listed[2]!.createdAtMs);

    const logFile = path.join(home, ".desktop", "logs", APP_ERROR_LOG_FILE_NAME);
    const onDisk = await fs.readFile(logFile, "utf8");
    expect(onDisk).not.toMatch(/sk-abcdefghijklmnopqrstuvwxyz/);
    expect(onDisk).not.toMatch(/should_not_persist_plain/);

    await clearAppErrors();
    expect(await listAppErrors({ limit: 10 })).toEqual([]);
  });

  it("enforces max entry ring buffer", async () => {
    await makeHome();
    for (let i = 0; i < APP_ERROR_LOG_MAX_ENTRIES + 25; i += 1) {
      await recordAppError({ source: "ring", message: `entry-${i}` });
    }
    const listed = await listAppErrors({ limit: APP_ERROR_LOG_MAX_ENTRIES });
    expect(listed.length).toBeLessThanOrEqual(APP_ERROR_LOG_MAX_ENTRIES);
    expect(listed.some((e) => e.message === `entry-${APP_ERROR_LOG_MAX_ENTRIES + 24}`)).toBe(true);
    expect(listed.some((e) => e.message === "entry-0")).toBe(false);
  }, 30_000);
});
