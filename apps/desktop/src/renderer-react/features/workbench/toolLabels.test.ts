import { describe, expect, it } from "vitest";
import { toolCallLabel } from "./toolLabels";

const labels: Record<string, string> = {
  "desktop.workbench.acpToolKind.execute": "Run command",
  "desktop.workbench.acpToolKind.read": "Read file",
  "desktop.workbench.acpToolKind.edit": "Edit file",
  "desktop.workbench.acpToolKind.search": "Search",
  "desktop.workbench.acpToolKind.other": "Tool"
};

const t = (key: string) => labels[key] || key;

describe("toolCallLabel", () => {
  it("keeps the human-readable title provided by the ACP agent", () => {
    expect(toolCallLabel({ title: "List project files", kind: "execute" }, t)).toBe("List project files");
  });

  it("replaces the generic ACP title with a localized tool kind", () => {
    expect(toolCallLabel({ title: "Tool", kind: "execute" }, t)).toBe("Run command");
  });

  it("uses the tool kind when the ACP update has no title", () => {
    expect(toolCallLabel({ kind: "read" }, t)).toBe("Read file");
  });

  it("infers a Codex ACP tool category without exposing its input values", () => {
    expect(toolCallLabel({ title: "Tool", kind: "other", rawInput: { command: "rg private-data" } }, t)).toBe("Run command");
    expect(toolCallLabel({ title: "Tool", kind: "other", rawInput: { file_path: "/private/path", old_string: "old" } }, t)).toBe("Edit file");
    expect(toolCallLabel({ title: "Tool", kind: "other", rawInput: { file_path: "/private/path", new_string: "new" } }, t)).toBe("Edit file");
    expect(toolCallLabel({ title: "Tool", kind: "other", rawInput: { pattern: "secret" } }, t)).toBe("Search");
  });

  it("falls back safely for an unknown or missing tool kind", () => {
    expect(toolCallLabel({ kind: "custom" }, t)).toBe("Tool");
    expect(toolCallLabel({}, t)).toBe("Tool");
  });
});
