import { describe, expect, it } from "vitest";
import {
  atTokenAtCursor,
  hashTokenAtCursor,
  joinDirPath,
  slashTokenAtCursor,
  tokenStartAtCursor
} from "./chatTokens";

describe("chatTokens", () => {
  describe("tokenStartAtCursor", () => {
    it("returns 0 at start of string", () => {
      expect(tokenStartAtCursor("hello", 3)).toBe(0);
    });

    it("returns index after last space", () => {
      expect(tokenStartAtCursor("hello world", 8)).toBe(6);
    });

    it("returns index after newline or tab", () => {
      expect(tokenStartAtCursor("hello\nworld", 8)).toBe(6);
      expect(tokenStartAtCursor("hello\tworld", 8)).toBe(6);
    });
  });

  describe("slashTokenAtCursor", () => {
    it("matches empty slash at start", () => {
      expect(slashTokenAtCursor("/", 1)).toEqual({ start: 0, query: "" });
    });

    it("matches slash command after space", () => {
      expect(slashTokenAtCursor("test /browser", 13)).toEqual({ start: 5, query: "browser" });
    });

    it("ignores paths with internal slashes like /usr/bin", () => {
      expect(slashTokenAtCursor("/usr/bin", 8)).toBeNull();
    });

    it("ignores if preceded by non-whitespace", () => {
      expect(slashTokenAtCursor("foo/bar", 7)).toBeNull();
    });
  });

  describe("atTokenAtCursor", () => {
    it("matches empty at token", () => {
      expect(atTokenAtCursor("@", 1)).toEqual({ start: 0, query: "" });
    });

    it("matches mention after space", () => {
      expect(atTokenAtCursor("check @task1", 12)).toEqual({ start: 6, query: "task1" });
    });

    it("ignores email addresses", () => {
      expect(atTokenAtCursor("user@domain.com", 15)).toBeNull();
    });

    it("ignores tokens with multiple @", () => {
      expect(atTokenAtCursor("@@", 2)).toBeNull();
    });
  });

  describe("hashTokenAtCursor", () => {
    it("matches root hash query", () => {
      expect(hashTokenAtCursor("#src", 4)).toEqual({ start: 0, dirPath: "", query: "src" });
    });

    it("matches directory walk with trailing slash", () => {
      expect(hashTokenAtCursor("#src/", 5)).toEqual({ start: 0, dirPath: "src", query: "" });
    });

    it("matches nested path query", () => {
      expect(hashTokenAtCursor("open #src/components/button", 27)).toEqual({
        start: 5,
        dirPath: "src/components",
        query: "button"
      });
    });

    it("ignores multiple hash signs", () => {
      expect(hashTokenAtCursor("##tag", 5)).toBeNull();
    });
  });

  describe("joinDirPath", () => {
    it("joins relative path to base directory", () => {
      expect(joinDirPath("/path/to/base", "sub/dir")).toBe("/path/to/base/sub/dir");
      expect(joinDirPath("/path/to/base/", "sub/dir")).toBe("/path/to/base/sub/dir");
    });
  });
});
