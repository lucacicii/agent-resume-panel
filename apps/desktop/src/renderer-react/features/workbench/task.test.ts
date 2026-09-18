import { describe, expect, it } from "vitest";
import { taskFromRecord, type TaskSource } from "./task";

function source(overrides: Partial<TaskSource> = {}): TaskSource {
  return {
    noteId: "wi-1",
    filename: "refactor-panel.md",
    updatedAtMs: 1234,
    ...overrides
  };
}

describe("taskFromRecord", () => {
  it("falls back from title to filename stem to noteId", () => {
    expect(taskFromRecord(source({ title: "Panel refactor" })).title).toBe("Panel refactor");
    expect(taskFromRecord(source({ title: undefined })).title).toBe("refactor-panel");
    expect(taskFromRecord(source({ title: "", filename: ".md" })).title).toBe("wi-1");
  });

  it("defaults a missing GTD status to inbox and keeps an explicit one", () => {
    expect(taskFromRecord(source()).status).toBe("inbox");
    expect(taskFromRecord(source({ gtdStatus: "waiting" })).status).toBe("waiting");
  });

  it("surfaces the work fields and defaults sessions to an empty array", () => {
    expect(taskFromRecord(source()).sessions).toEqual([]);

    const item = taskFromRecord(
      source({
        work: {
          next: "Split the panel",
          decision: "Keep three columns",
          sessions: ["codex:s-1", "claude:s-2"],
          projects: ["/work/panel"],
          primaryProject: "/work/panel"
        }
      })
    );

    expect(item.next).toBe("Split the panel");
    expect(item.decision).toBe("Keep three columns");
    expect(item.sessions).toEqual(["codex:s-1", "claude:s-2"]);
    expect(item.projects).toEqual(["/work/panel"]);
    expect(item.primaryProject).toBe("/work/panel");
  });

  it("keeps noteId and updatedAtMs so list sorting and scope refs stay stable", () => {
    const item = taskFromRecord(source({ noteId: "wi-9", updatedAtMs: 42 }));
    expect(item.noteId).toBe("wi-9");
    expect(item.updatedAtMs).toBe(42);
  });
});
