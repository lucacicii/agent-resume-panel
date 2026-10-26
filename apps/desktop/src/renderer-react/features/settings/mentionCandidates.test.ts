import { describe, expect, it } from "vitest";
import { buildMentionCandidates, classifyCandidate, suggestMentionId } from "./mentionCandidates";

const project = (overrides: Partial<Parameters<typeof classifyCandidate>[0]> = {}) => ({
  projectId: "p1",
  alias: "wlgk",
  localPath: "/Users/lucas/wb/wlgk/tj",
  pathMissing: false,
  sessionCount: 12,
  lastSeenAtMs: 1_700_000_000_000,
  pinned: false,
  ...overrides
});

const context = {
  homeDir: "/Users/lucas",
  panelHome: "/Users/lucas/.agent-resume-panel",
  packs: [{ id: "anfeng", cwd: "/Users/lucas/wb/wlgk/anfeng" }]
};

describe("classifyCandidate", () => {
  it("accepts a working directory", () => {
    expect(classifyCandidate(project(), context)).toBeUndefined();
  });

  it("rejects the home directory itself but not a folder under it", () => {
    expect(classifyCandidate(project({ localPath: "/Users/lucas" }), context)).toBe("home");
    expect(classifyCandidate(project({ localPath: "/Users/lucas/wb" }), context)).toBeUndefined();
  });

  it("rejects temporary roots and their children", () => {
    expect(classifyCandidate(project({ localPath: "/tmp" }), context)).toBe("temp");
    expect(classifyCandidate(project({ localPath: "/private/tmp/x" }), context)).toBe("temp");
    expect(classifyCandidate(project({ localPath: "/var/tmp" }), context)).toBe("temp");
    expect(classifyCandidate(project({ localPath: "/Users/lucas/tmp" }), context)).toBeUndefined();
  });

  it("rejects the app's own folders", () => {
    expect(
      classifyCandidate(project({ localPath: "/Users/lucas/.agent-resume-panel/.desktop/workspaces/x" }), context)
    ).toBe("internal");
    expect(
      classifyCandidate(project({ localPath: "/Users/lucas/other/.desktop/workspaces/x" }), context)
    ).toBe("internal");
  });

  it("rejects a directory that is gone, and one already configured", () => {
    expect(classifyCandidate(project({ localPath: "/Users/lucas/wb", pathMissing: true }), context)).toBe("missing");
    expect(classifyCandidate(project({ localPath: null }), context)).toBe("missing");
    expect(
      classifyCandidate(project({ localPath: "/Users/lucas/wb/wlgk/anfeng/" }), context)
    ).toBe("alreadyAdded");
  });
});

describe("suggestMentionId", () => {
  it("derives an id from the last path segment", () => {
    expect(suggestMentionId("/Users/lucas/wb/wlgk/tj", "whatever")).toBe("tj");
    expect(suggestMentionId("/Users/lucas/wb/My Project", "x")).toBe("my-project");
  });

  it("avoids an id already taken by a pack", () => {
    const taken = new Set(["tj"]);
    expect(suggestMentionId("/Users/lucas/wb/wlgk/tj", "tj", taken)).not.toBe("tj");
  });

  it("falls back to a stable id when the path has no usable segment", () => {
    expect(suggestMentionId("/", "")).toMatch(/^dir-\d+$/);
  });
});

describe("buildMentionCandidates", () => {
  it("lists eligible rows first, ranked by use, with exclusions after them", () => {
    const rows = buildMentionCandidates(
      [
        project({ projectId: "tmp", localPath: "/tmp/scratch", sessionCount: 99 }),
        project({ projectId: "quiet", localPath: "/Users/lucas/wb/quiet", sessionCount: 1 }),
        project({ projectId: "busy", localPath: "/Users/lucas/wb/busy", sessionCount: 40 })
      ],
      context
    );
    expect(rows.map((row) => row.projectId)).toEqual(["busy", "quiet", "tmp"]);
    expect(rows[2].exclusion).toBe("temp");
  });

  it("reuses the pack id for a directory that is already configured", () => {
    const rows = buildMentionCandidates(
      [project({ localPath: "/Users/lucas/wb/wlgk/anfeng" })],
      context
    );
    expect(rows[0].id).toBe("anfeng");
    expect(rows[0].exclusion).toBe("alreadyAdded");
  });

  it("keeps ids unique across the list", () => {
    const rows = buildMentionCandidates(
      [
        project({ projectId: "a", localPath: "/Users/lucas/a/tj" }),
        project({ projectId: "b", localPath: "/Users/lucas/b/tj" })
      ],
      context
    );
    expect(rows[0].id).not.toBe(rows[1].id);
  });

  it("labels a row by alias, else by path tail", () => {
    const rows = buildMentionCandidates(
      [
        project({ projectId: "a", alias: "" }),
        project({ projectId: "b", alias: "named", localPath: "/Users/lucas/b/x" })
      ],
      context
    );
    expect(rows[0].label).toBe("tj");
    expect(rows[1].label).toBe("named");
  });
});
