import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleToolExecutionForStage } from "./toolStageRouter";

describe("toolStageRouter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("routes task tools directly to a Kanban Artifact", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    handleToolExecutionForStage("agent_resume_task_list", {}, [{ title: "Task 1", gtdStatus: "next" }]);

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe("agent-resume:stage-artifact");
    expect(event.detail.kind).toBe("native:gtd");
    expect(event.detail.title).toBe("任务看板");
  });

  it("routes note tools directly to a Note Document Artifact", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    handleToolExecutionForStage("agent_resume_note_read", { noteId: "arch-doc" }, "# Architecture");

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe("agent-resume:stage-artifact");
    expect(event.detail.kind).toBe("native:notes");
    expect(event.detail.title).toBe("arch-doc");
  });

  it("routes direct _ui_artifact objects to artifact stage", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const mockEnvelope = {
      id: "chart-1",
      version: "1.0",
      title: "Token Usage",
      target: "stage",
      kind: "chart",
      payload: { data: [1, 2, 3] }
    };
    handleToolExecutionForStage("custom_stats_tool", {}, { _ui_artifact: mockEnvelope });

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe("agent-resume:stage-artifact");
    expect(event.detail).toEqual(mockEnvelope);
  });

  it("leaves query tools like session_search and bash to conversation stream", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    handleToolExecutionForStage("agent_resume_session_search", { query: "test" }, []);
    handleToolExecutionForStage("bash_exec", { command: "ls" }, "ok");

    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
