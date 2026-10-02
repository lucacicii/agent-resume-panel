import { describe, expect, it } from "vitest";
import {
  extractConversationTouchedPaths,
  extractConversationTouchedPathsByRepo,
  filterConversationDirtyFiles,
  normalizeRepoPath,
  parseDiffLines,
  resolveRepoRelativePath
} from "./gitDiffUtils";
import type { ThunderChatMessage, ThunderFileChangeRecord } from "@agent-resume/core";

describe("gitDiffUtils", () => {
  describe("normalizeRepoPath", () => {
    it("handles absolute paths matching repoRoot", () => {
      expect(normalizeRepoPath("/repo/app/src/index.ts", "/repo/app")).toBe("src/index.ts");
    });

    it("handles absolute paths matching workspace inside repoRoot", () => {
      expect(
        normalizeRepoPath("/repo/nested/workspace/file.ts", "/repo", "/repo/nested/workspace")
      ).toBe("nested/workspace/file.ts");
    });

    it("handles relative paths with workspace subdirectory", () => {
      expect(normalizeRepoPath("sub/file.ts", "/repo", "/repo/subfolder")).toBe("subfolder/sub/file.ts");
    });

    it("handles simple relative paths", () => {
      expect(normalizeRepoPath("src/a.ts", "/repo", "/repo")).toBe("src/a.ts");
    });

    it("resolves double dots safely", () => {
      expect(normalizeRepoPath("src/../dist/bundle.js", "/repo", "/repo")).toBe("dist/bundle.js");
    });
  });

  describe("extractConversationTouchedPaths", () => {
    it("extracts paths from fileChanges, tool_executions, tool_calls and streamingTools", () => {
      const fileChanges: ThunderFileChangeRecord[] = [
        { path: "/repo/src/changed-by-file-change.ts", tool: "write_file", action: "written" },
        { path: "/repo/failed.ts", tool: "write_file", action: "failed" }
      ];

      const messages: ThunderChatMessage[] = [
        {
          role: "assistant",
          tool_executions: [
            {
              toolCallId: "call_1",
              name: "edit_file",
              arguments: { path: "src/from-execution.ts" }
            }
          ]
        },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_2",
              type: "function",
              function: {
                name: "write_file",
                arguments: JSON.stringify({ file_path: "src/from-call.ts" })
              }
            }
          ]
        }
      ];

      const streamingTools = [
        {
          toolCallId: "call_stream",
          name: "write_file",
          arguments: { path: "src/from-stream.ts" }
        }
      ];

      const touched = extractConversationTouchedPaths({
        fileChanges,
        messages,
        streamingTools,
        repoRoot: "/repo",
        workspaceDir: "/repo"
      });

      expect(touched.has("src/changed-by-file-change.ts")).toBe(true);
      expect(touched.has("src/from-execution.ts")).toBe(true);
      expect(touched.has("src/from-call.ts")).toBe(true);
      expect(touched.has("src/from-stream.ts")).toBe(true);
      expect(touched.has("failed.ts")).toBe(false);
    });
  });

  describe("resolveRepoRelativePath", () => {
    const repos = ["/work/mono/pkg-a", "/work/mono/pkg-b"];

    it("picks the longest matching repo for an absolute path", () => {
      expect(resolveRepoRelativePath("/work/mono/pkg-b/src/index.ts", repos, "/work/mono")).toEqual({
        repoRoot: "/work/mono/pkg-b",
        repoPath: "src/index.ts"
      });
      expect(resolveRepoRelativePath("/work/mono/pkg-a/index.ts", repos, "/work/mono")).toEqual({
        repoRoot: "/work/mono/pkg-a",
        repoPath: "index.ts"
      });
    });

    it("joins a relative path against the workspace before matching", () => {
      expect(resolveRepoRelativePath("pkg-a/src/app.ts", repos, "/work/mono")).toEqual({
        repoRoot: "/work/mono/pkg-a",
        repoPath: "src/app.ts"
      });
    });

    it("falls back to the workspace when the path is relative to a repo root", () => {
      expect(resolveRepoRelativePath("src/app.ts", ["/work/mono"], "/work/mono")).toEqual({
        repoRoot: "/work/mono",
        repoPath: "src/app.ts"
      });
    });

    it("returns null for paths outside every repo and for the repo root itself", () => {
      expect(resolveRepoRelativePath("/elsewhere/file.ts", repos, "/work/mono")).toBeNull();
      expect(resolveRepoRelativePath("/work/mono/pkg-a", repos, "/work/mono")).toBeNull();
    });
  });

  describe("extractConversationTouchedPathsByRepo", () => {
    it("attributes absolute paths to the repo that contains them", () => {
      const touched = extractConversationTouchedPathsByRepo({
        repoRoots: ["/work/mono/pkg-a", "/work/mono/pkg-b"],
        workspaceDir: "/work/mono",
        fileChanges: [
          { path: "/work/mono/pkg-a/index.ts", tool: "write_file", action: "written" },
          { path: "/work/mono/pkg-b/index.ts", tool: "write_file", action: "written" }
        ]
      });

      expect([...touched.get("/work/mono/pkg-a") || []]).toEqual(["index.ts"]);
      expect([...touched.get("/work/mono/pkg-b") || []]).toEqual(["index.ts"]);
    });

    it("resolves relative tool paths against the workspace", () => {
      const touched = extractConversationTouchedPathsByRepo({
        repoRoots: ["/work/app"],
        workspaceDir: "/work/app",
        messages: [
          {
            role: "assistant",
            tool_executions: [
              { toolCallId: "c1", name: "edit_file", arguments: { path: "src/from-execution.ts" } }
            ]
          }
        ]
      });

      expect([...touched.get("/work/app") || []]).toEqual(["src/from-execution.ts"]);
    });
  });

  describe("filterConversationDirtyFiles", () => {
    it("returns only dirty files that belong to the conversation", () => {
      const allDirty = [
        { path: "src/one.ts", repoRoot: "/repo", repoPath: "src/one.ts", status: "modified" },
        { path: "src/other-agent.ts", repoRoot: "/repo", repoPath: "src/other-agent.ts", status: "modified" },
        { path: "src/user-edit.ts", repoRoot: "/repo", repoPath: "src/user-edit.ts", status: "untracked" },
        { path: "src/two.ts", repoRoot: "/repo", repoPath: "src/two.ts", status: "deleted" }
      ];

      const touched = new Map<string, Set<string>>([
        ["/repo", new Set(["src/one.ts", "src/two.ts"])]
      ]);
      const filtered = filterConversationDirtyFiles(allDirty, touched);

      expect(filtered.map((f) => f.repoPath)).toEqual(["src/one.ts", "src/two.ts"]);
      expect(filtered.map((f) => f.repoRoot)).toEqual(["/repo", "/repo"]);
    });

    it("keeps identical paths in sibling repositories separate", () => {
      const allDirty = [
        { path: "pkg-a/index.ts", repoRoot: "/work/mono/pkg-a", repoPath: "index.ts", status: "modified" },
        { path: "pkg-b/index.ts", repoRoot: "/work/mono/pkg-b", repoPath: "index.ts", status: "modified" }
      ];

      const filtered = filterConversationDirtyFiles(
        allDirty,
        new Map([[ "/work/mono/pkg-b", new Set(["index.ts"]) ]])
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0].repoRoot).toBe("/work/mono/pkg-b");
      expect(filtered[0].displayPath).toBe("pkg-b/index.ts");
    });
  });

  describe("parseDiffLines", () => {
    it("parses unified patch into structured display lines", () => {
      const patch = `diff --git a/foo.ts b/foo.ts
index abc..def 100644
--- a/foo.ts
+++ b/foo.ts
@@ -10,3 +10,4 @@
 unchanged line
-old line
+new line
+another new line`;

      const result = parseDiffLines({ patch });

      expect(result.additions).toBe(2);
      expect(result.deletions).toBe(1);
      expect(result.lines).toHaveLength(5);
      expect(result.lines[0].kind).toBe("header");
      expect(result.lines[0].text).toContain("@@ -10,3 +10,4 @@");
      expect(result.lines[1].kind).toBe("context");
      expect(result.lines[1].oldLine).toBe(10);
      expect(result.lines[1].newLine).toBe(10);
      expect(result.lines[2].kind).toBe("del");
      expect(result.lines[2].text).toBe("old line");
      expect(result.lines[2].oldLine).toBe(11);
      expect(result.lines[3].kind).toBe("add");
      expect(result.lines[3].text).toBe("new line");
      expect(result.lines[3].newLine).toBe(11);
      expect(result.lines[4].kind).toBe("add");
      expect(result.lines[4].text).toBe("another new line");
      expect(result.lines[4].newLine).toBe(12);
    });

    it("parses new untracked file without patch", () => {
      const result = parseDiffLines({
        oldText: "",
        newText: "line 1\nline 2\n"
      });

      expect(result.additions).toBe(2);
      expect(result.deletions).toBe(0);
      expect(result.lines[0].kind).toBe("header");
      expect(result.lines[1].kind).toBe("add");
      expect(result.lines[1].newLine).toBe(1);
      expect(result.lines[2].kind).toBe("add");
      expect(result.lines[2].newLine).toBe(2);
    });

    it("parses deleted file without patch", () => {
      const result = parseDiffLines({
        oldText: "line A\nline B\n",
        newText: ""
      });

      expect(result.additions).toBe(0);
      expect(result.deletions).toBe(2);
      expect(result.lines[0].kind).toBe("header");
      expect(result.lines[1].kind).toBe("del");
      expect(result.lines[1].oldLine).toBe(1);
      expect(result.lines[2].kind).toBe("del");
      expect(result.lines[2].oldLine).toBe(2);
    });
  });
});
