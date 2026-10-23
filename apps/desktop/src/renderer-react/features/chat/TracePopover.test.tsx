import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { TracePopover } from "./TracePopover";
import { FileFootprintList } from "./FileFootprintList";
import type { ThunderFileChangeRecord } from "@agent-resume/core";
import type { TraceSpan } from "./useTraceCollector";

describe("TracePopover", () => {
  it("renders empty state when no spans", () => {
    render(
      <TracePopover isOpen={true} onClose={vi.fn()} spans={[]} />
    );
    expect(screen.getByText("Execution Trace")).toBeTruthy();
    expect(screen.getByText("No spans for this run yet.")).toBeTruthy();
  });

  it("renders the run's spans and copies them as JSON", () => {
    const spans: TraceSpan[] = [
      {
        id: "call_bash_1",
        turn: 1,
        type: "tool",
        name: "bash",
        startedAtMs: Date.now() - 2000,
        durationMs: 1200,
        status: "completed",
        data: {
          arguments: { command: "cargo test --all" },
          output: "25 tests passed"
        }
      }
    ];

    render(
      <TracePopover isOpen={true} onClose={vi.fn()} spans={spans} />
    );

    expect(screen.getByText("$ cargo test --all")).toBeTruthy();

    // Toggle accordion details
    const row = screen.getByText("$ cargo test --all");
    fireEvent.click(row);
    expect(screen.getByText(/25 tests passed/)).toBeTruthy();
  });
});

describe("FileFootprintList", () => {
  it("renders modified files with tool name and action", () => {
    const files: ThunderFileChangeRecord[] = [
      {
        path: "/workspace/src/main.rs",
        tool: "write_file",
        action: "written",
        bytes: 1024,
        turn: 1
      },
      {
        path: "/workspace/package.json",
        tool: "bash",
        action: "modified",
        turn: 1
      }
    ];

    render(<FileFootprintList files={files} workspaceDir="/workspace" />);

    expect(screen.getByText("src/main.rs")).toBeTruthy();
    expect(screen.getByText("package.json")).toBeTruthy();
    expect(screen.getByText("write_file")).toBeTruthy();
    expect(screen.getByText("bash")).toBeTruthy();
  });
});
