import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { TracePopover } from "./TracePopover";
import { FileChangesPopover } from "./FileChangesPopover";
import type { ThunderTaskTrace, ThunderFileChangeRecord, ThunderTelemetryNotice } from "@agent-resume/core";
import type { TraceSpan } from "./useTraceCollector";

describe("TracePopover", () => {
  it("renders empty state when no spans", () => {
    render(
      <TracePopover
        isOpen={true}
        onClose={vi.fn()}
        trace={null}
        spans={[]}
        telemetryNotices={[]}
        isCollecting={false}
      />
    );
    expect(screen.getByText("Execution Trace")).toBeTruthy();
    expect(screen.getByText("No active execution trace available for this turn.")).toBeTruthy();
  });

  it("renders execution trace with bash command, telemetry notice, and copy JSON", () => {
    const trace: ThunderTaskTrace = {
      task_id: "t_1",
      session_id: "s_1",
      model: "custom/gpt-5",
      prompt: "run bash",
      started_at_ms: Date.now() - 3000,
      duration_ms: 3000,
      finish_reason: "done"
    };

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

    const notices: ThunderTelemetryNotice[] = [
      {
        layer: "Transaction",
        action: "Atomic shadow write completed",
        ground_truth: "File written safely",
        guidance: "Safe to proceed"
      }
    ];

    render(
      <TracePopover
        isOpen={true}
        onClose={vi.fn()}
        trace={trace}
        spans={spans}
        telemetryNotices={notices}
        isCollecting={false}
      />
    );

    expect(screen.getByText("custom/gpt-5")).toBeTruthy();
    expect(screen.getByText("System Telemetry Notices (1)")).toBeTruthy();
    expect(screen.getByText("Atomic shadow write completed")).toBeTruthy();
    expect(screen.getByText("$ cargo test --all")).toBeTruthy();

    // Toggle accordion details
    const row = screen.getByText("$ cargo test --all");
    fireEvent.click(row);
    expect(screen.getByText(/25 tests passed/)).toBeTruthy();
  });
});

describe("FileChangesPopover", () => {
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

    render(
      <FileChangesPopover
        isOpen={true}
        onClose={vi.fn()}
        files={files}
        workspaceDir="/workspace"
      />
    );

    expect(screen.getByText("Modified Files")).toBeTruthy();
    expect(screen.getByText("src/main.rs")).toBeTruthy();
    expect(screen.getByText("package.json")).toBeTruthy();
    expect(screen.getByText("write_file")).toBeTruthy();
    expect(screen.getByText("bash")).toBeTruthy();
  });
});
