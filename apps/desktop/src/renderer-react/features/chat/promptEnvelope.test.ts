import { describe, expect, it } from "vitest";
import { stripContextBlocks, stripMachineContext, stripTransportPrefixes } from "./promptEnvelope";

describe("stripTransportPrefixes", () => {
  it("drops the prefixes the main process adds", () => {
    expect(stripTransportPrefixes("[Active Workspace: /a]\n\n改一下登录接口")).toBe("改一下登录接口");
    expect(
      stripTransportPrefixes("[Additional workspace roots (read/write): /x, /y]\n\n[Active Workspace: /a]\n\n看看这两个仓")
    ).toBe("看看这两个仓");
    expect(stripTransportPrefixes("[GTD Task Context]\n# Active GTD Task: T\n\n[End Task Context]\n\n干活")).toBe("干活");
  });
});

describe("stripContextBlocks", () => {
  it("drops every reference block the composer compiles", () => {
    const compiled = [
      "[Active Skill Instructions: review]\nDo the review.\n[End Skill Instructions]",
      "[Requested MCP Tool: bash]\nDescription: run things\n[End Requested MCP Tool]",
      "[Referenced Note: Plan]\nnote body\n[End Referenced Note]",
      "[Referenced GTD Task: T (Status: next)]\ntask body\n[End Referenced Task]",
      "[Referenced Conversation: C]\nuser: hi\n[End Referenced Conversation]",
      "[Referenced File: src/a.ts]\nexport const a = 1;\n[End Referenced File]"
    ].join("\n\n");
    expect(stripContextBlocks(`${compiled}\n\n改一下登录接口`)).toBe("改一下登录接口");
  });

  it("leaves block-shaped text that is not at the start alone", () => {
    const text = "看看这个 [Referenced Note: x] 是什么意思";
    expect(stripContextBlocks(text)).toBe(text);
  });
});

describe("stripMachineContext", () => {
  it("peels both layers down to the sentence the user typed", () => {
    const stored = [
      "[Additional workspace roots (read/write): /work/front]",
      "[Active Workspace: /other/back]",
      "[Referenced Note: Plan]\nnote body\n[End Referenced Note]",
      "@front @back 改一下登录接口"
    ].join("\n\n");
    expect(stripMachineContext(stored)).toBe("@front @back 改一下登录接口");
  });

  it("returns the original when nothing would be left", () => {
    const onlyContext = "[Active Workspace: /a]\n\n[Referenced Note: P]\nbody\n[End Referenced Note]\n\n";
    expect(stripMachineContext(onlyContext)).toBe(onlyContext);
  });

  it("keeps an ordinary message untouched", () => {
    expect(stripMachineContext("普通的一句话")).toBe("普通的一句话");
  });
});
