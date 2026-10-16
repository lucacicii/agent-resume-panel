import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ToolChip, parseToolCall } from "./ToolChip";
import type { ActiveToolInfo } from "./useThunderChat";

describe("ToolChip and parseToolCall", () => {
  afterEach(() => {
    cleanup();
  });

  it("parses file read tool call correctly with line numbers", () => {
    const parsed = parseToolCall("read_file", {
      path: "src/main/server.ts",
      StartLine: 1,
      EndLine: 100
    });
    expect(parsed.verb).toBe("Read");
    expect(parsed.target).toBe("server.ts");
    expect(parsed.badge).toBe("L1-100");
    expect(parsed.kind).toBe("read");
  });

  it("parses edit tool call and computes diff line badges", () => {
    const diff = `@@ -1,5 +1,7 @@\n-line 1\n-line 2\n+line 1 new\n+line 2 new\n+line 3 new\n+line 4 new\n context`;
    const parsed = parseToolCall("edit_file", {
      TargetFile: "/Users/dev/project/src/App.tsx",
      diff
    });
    expect(parsed.verb).toBe("Edit");
    expect(parsed.target).toBe("App.tsx");
    expect(parsed.badge).toBe("+4 -2");
    expect(parsed.kind).toBe("edit");
  });

  it("parses bash command execution tool call", () => {
    const parsed = parseToolCall("bash", {
      command: "pnpm test --filter desktop"
    });
    expect(parsed.verb).toBe("Run");
    expect(parsed.target).toBe("pnpm test --filter desktop");
    expect(parsed.command).toBe("pnpm test --filter desktop");
    expect(parsed.kind).toBe("run");
  });

  it("parses search query tool call", () => {
    const parsed = parseToolCall("grep", {
      query: "parseToolCall",
      path: "src/renderer-react"
    });
    expect(parsed.verb).toBe("Search");
    expect(parsed.target).toBe('"parseToolCall"');
    expect(parsed.badge).toBe("renderer-react");
    expect(parsed.kind).toBe("search");
  });

  it("renders ToolChip with semantic header and expands inline drilldown preview", () => {
    const tool: ActiveToolInfo = {
      toolCallId: "call_123",
      name: "bash",
      arguments: { command: "npm run build" },
      result: "Build succeeded in 1.2s",
      isRunning: false
    };

    const { container } = render(<ToolChip tool={tool} />);

    // Header checks
    expect(container.querySelector(".tb-tool-verb")?.textContent).toBe("Run");
    expect(container.querySelector(".tb-tool-target")?.textContent).toBe("npm run build");
    expect(container.querySelector(".tb-tool-status.success")).toBeTruthy();

    // Before expand: no details
    expect(container.querySelector(".tb-tool-chip-details")).toBeNull();

    // Click header to expand
    fireEvent.click(container.querySelector(".tb-tool-chip-header")!);

    // Terminal preview rendered inline
    expect(container.querySelector(".tb-tool-inline-preview.is-terminal")).toBeTruthy();
    expect(container.querySelector(".tb-tool-terminal-cmd")?.textContent).toBe("npm run build");
    expect(container.querySelector(".tb-tool-terminal-body")?.textContent).toContain("Build succeeded in 1.2s");
  });

  it("renders diff preview for file edits", () => {
    const tool: ActiveToolInfo = {
      toolCallId: "call_456",
      name: "replace",
      arguments: {
        TargetFile: "src/index.ts",
        diff: "+const x = 1;\n-const x = 0;"
      },
      isRunning: false
    };

    const { container } = render(<ToolChip tool={tool} />);
    expect(container.querySelector(".tb-tool-meta-badge")?.textContent).toBe("+1 -1");

    fireEvent.click(container.querySelector(".tb-tool-chip-header")!);
    expect(container.querySelector(".tb-tool-inline-preview.is-diff")).toBeTruthy();
    expect(container.querySelector(".tb-tool-code-preview")?.textContent).toContain("+const x = 1;");
  });
});
