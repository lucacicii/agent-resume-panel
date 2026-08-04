import { describe, expect, it } from "vitest";
import { parseGitStatusPorcelainV1Z, stagedRepoPaths } from "./workbenchGitStatus";

describe("parseGitStatusPorcelainV1Z", () => {
  it("preserves Unicode and whitespace in paths", () => {
    const output = [
      " M public/files/授信额度申请批量导入.xlsx",
      "A  docs/file with spaces.md",
      "?? 新建文件.txt",
      ""
    ].join("\0");

    expect(parseGitStatusPorcelainV1Z(output)).toEqual([
      {
        indexStatus: " ",
        worktreeStatus: "M",
        path: "public/files/授信额度申请批量导入.xlsx"
      },
      {
        indexStatus: "A",
        worktreeStatus: " ",
        path: "docs/file with spaces.md"
      },
      {
        indexStatus: "?",
        worktreeStatus: "?",
        path: "新建文件.txt"
      }
    ]);
  });

  it("uses the destination path and consumes the source path for renames", () => {
    const entries = parseGitStatusPorcelainV1Z("R  新名称.txt\0旧名称.txt\0 M keep.txt\0");

    expect(entries).toEqual([
      {
        indexStatus: "R",
        worktreeStatus: " ",
        path: "新名称.txt",
        originalPath: "旧名称.txt"
      },
      {
        indexStatus: " ",
        worktreeStatus: "M",
        path: "keep.txt"
      }
    ]);
    expect(stagedRepoPaths(entries)).toEqual(["新名称.txt"]);
  });
});
