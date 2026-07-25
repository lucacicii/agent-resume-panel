import { describe, expect, it } from "vitest";
import { parseLeftRightCount } from "./gitTracking";

describe("parseLeftRightCount", () => {
  it("parses tab-separated ahead/behind counts", () => {
    expect(parseLeftRightCount("2\t5\n")).toEqual({ ahead: 2, behind: 5 });
  });

  it("parses space-separated counts", () => {
    expect(parseLeftRightCount("0 3")).toEqual({ ahead: 0, behind: 3 });
  });

  it("returns zeros for empty or invalid output", () => {
    expect(parseLeftRightCount("")).toEqual({ ahead: 0, behind: 0 });
    expect(parseLeftRightCount("not-a-count")).toEqual({ ahead: 0, behind: 0 });
  });
});
