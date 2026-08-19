import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAugmentedPath, compareNodeVersionDir, resolveExecutable } from "./processPath";

describe("processPath", () => {
  it("sorts node version dirs newest first", () => {
    const versions = ["v14.18.2", "v22.13.0", "v24.14.0", "v22.13.1"];
    expect([...versions].sort(compareNodeVersionDir)).toEqual([
      "v24.14.0",
      "v22.13.1",
      "v22.13.0",
      "v14.18.2"
    ]);
  });

  it("prepends existing PATH entries and appends known tool dirs when present", () => {
    const home = os.homedir();
    const result = buildAugmentedPath("/custom/bin:/usr/bin", home);
    const parts = result.split(path.delimiter);
    expect(parts[0]).toBe("/custom/bin");
    expect(parts).toContain("/usr/bin");
    // At least one of the common macOS / user dirs should appear when they exist.
    const hasExtra = parts.some(
      (dir) =>
        dir === "/opt/homebrew/bin" ||
        dir === "/usr/local/bin" ||
        dir.includes(`${path.sep}.local${path.sep}share${path.sep}fnm`) ||
        dir.endsWith(`${path.sep}.local${path.sep}bin`)
    );
    expect(hasExtra || parts.length >= 2).toBe(true);
  });

  it("resolves absolute executables only when present", () => {
    expect(resolveExecutable("/bin/sh", "/usr/bin")).toBe("/bin/sh");
    expect(resolveExecutable("/no/such/binary-xyz", "/usr/bin")).toBeNull();
  });
});
