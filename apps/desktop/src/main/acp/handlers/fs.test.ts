import { describe, expect, it } from "vitest";
import { isPlanFilePath, isReadablePlanPath } from "./fs";
import * as os from "node:os";
import * as path from "node:path";

describe("isPlanFilePath", () => {
  it("matches plan.md and grok session plans", () => {
    expect(isPlanFilePath("/tmp/plan.md")).toBe(true);
    expect(isPlanFilePath("/Users/me/.grok/sessions/abc/plan.md")).toBe(true);
    expect(isPlanFilePath("C:\\Users\\me\\.grok\\sessions\\x\\plan.md")).toBe(true);
    expect(isPlanFilePath("/work/feature.plan.md")).toBe(true);
    expect(isPlanFilePath("/work/readme.md")).toBe(false);
    expect(isPlanFilePath("/work/plan.txt")).toBe(false);
  });
});

describe("isReadablePlanPath", () => {
  it("only allows plan files under home", () => {
    const homePlan = path.join(os.homedir(), ".grok", "sessions", "s1", "plan.md");
    expect(isReadablePlanPath(homePlan)).toBe(true);
    expect(isReadablePlanPath("/etc/plan.md")).toBe(false);
    expect(isReadablePlanPath(path.join(os.homedir(), "notes.md"))).toBe(false);
  });
});
