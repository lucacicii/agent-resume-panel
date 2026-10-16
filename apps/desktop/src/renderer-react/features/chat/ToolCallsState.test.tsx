import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ToolCallsState } from "./ToolCallsState";
import type { ActiveToolInfo } from "./useThunderChat";

describe("ToolCallsState", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders single tool title semantically", () => {
    const tools: ActiveToolInfo[] = [
      {
        toolCallId: "call_1",
        name: "read_file",
        arguments: { path: "src/App.tsx" }
      }
    ];

    const { container } = render(<ToolCallsState tools={tools} />);
    expect(container.querySelector(".tb-tool-group-title")?.textContent).toBe("Read App.tsx");
  });

  it("renders multi-tool breakdown title", () => {
    const tools: ActiveToolInfo[] = [
      {
        toolCallId: "call_1",
        name: "read_file",
        arguments: { path: "src/App.tsx" }
      },
      {
        toolCallId: "call_2",
        name: "edit_file",
        arguments: { path: "src/App.tsx" }
      },
      {
        toolCallId: "call_3",
        name: "bash",
        arguments: { command: "pnpm test" }
      }
    ];

    const { container } = render(<ToolCallsState tools={tools} />);
    expect(container.querySelector(".tb-tool-group-title")?.textContent).toContain("3 actions executed");
    expect(container.querySelector(".tb-tool-group-title")?.textContent).toContain("Read 1 file");
  });

  it("renders running tool status in title", () => {
    const tools: ActiveToolInfo[] = [
      {
        toolCallId: "call_1",
        name: "read_file",
        arguments: { path: "src/App.tsx" }
      },
      {
        toolCallId: "call_2",
        name: "bash",
        arguments: { command: "pnpm build" },
        isRunning: true
      }
    ];

    const { container } = render(<ToolCallsState tools={tools} isStreaming />);
    expect(container.querySelector(".tb-tool-group-title")?.textContent).toBe("Running: Run pnpm build...");
    expect(container.querySelector(".tb-tool-group-spinner")).toBeTruthy();
  });

  it("expands to show tool chips", () => {
    const tools: ActiveToolInfo[] = [
      {
        toolCallId: "call_1",
        name: "read_file",
        arguments: { path: "src/App.tsx" }
      }
    ];

    const { container } = render(<ToolCallsState tools={tools} defaultExpanded={false} />);
    expect(container.querySelector(".tb-tool-group-list")).toBeNull();

    fireEvent.click(container.querySelector(".tb-tool-group-header")!);
    expect(container.querySelector(".tb-tool-group-list")).toBeTruthy();
    expect(container.querySelector(".tb-tool-chip")).toBeTruthy();
  });
});
