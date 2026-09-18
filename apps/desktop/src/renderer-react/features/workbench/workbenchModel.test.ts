import { describe, expect, it } from "vitest";
import { mergeTaskSessionKeys } from "./workbenchModel";

describe("mergeTaskSessionKeys", () => {
  it("keeps the task's own sessions first and adds the workbench's open ones", () => {
    const merged = mergeTaskSessionKeys(
      ["codex:a"],
      [
        { sessionKey: "codex:b", workbenchId: "wb-1" },
        { sessionKey: "codex:a", workbenchId: "wb-1" },
        { sessionKey: "codex:c", workbenchId: "wb-1" }
      ],
      "wb-1"
    );
    expect(merged).toEqual(["codex:a", "codex:b", "codex:c"]);
  });

  it("ignores panes of other workbenches and panes without a session", () => {
    const merged = mergeTaskSessionKeys(
      [],
      [
        { sessionKey: "codex:other", workbenchId: "wb-2" },
        { sessionKey: "codex:none" },
        { sessionKey: "codex:mine", workbenchId: "wb-1" }
      ],
      "wb-1"
    );
    expect(merged).toEqual(["codex:mine"]);
  });

  it("counts unscoped panes when the workbench has no scope", () => {
    expect(mergeTaskSessionKeys(["codex:a"], [{ sessionKey: "codex:b" }], null)).toEqual(["codex:a", "codex:b"]);
  });
});
