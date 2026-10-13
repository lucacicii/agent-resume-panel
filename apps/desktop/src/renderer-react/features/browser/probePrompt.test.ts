import { describe, expect, it } from "vitest";
import type { BrowserDevtoolsLogEntry, BrowserProbeMarkup, BrowserProbeTarget } from "../../../shared/browserTypes";
import { buildInspectPrompt, buildMarkupPrompt, composeErrorPrompt } from "./probePrompt";

const t = (key: string, ...args: Array<string | number>) => [key, ...args].join("|");

function target(overrides: Partial<BrowserProbeTarget> = {}): BrowserProbeTarget {
  return {
    tagName: "div",
    selector: "div.card",
    text: "Total",
    textSnippet: "Total",
    rect: { top: 0, left: 0, width: 10, height: 10 },
    ...overrides
  };
}

function markup(overrides: Partial<BrowserProbeMarkup> = {}): BrowserProbeMarkup {
  return { id: "b1", note: "make it orange", rect: { left: 0, top: 0, width: 30, height: 30 }, target: null, ...overrides };
}

describe("buildInspectPrompt", () => {
  it("names the component only when it differs from the tag", () => {
    expect(buildInspectPrompt(t, target({ componentName: "OrderCard" })).split("\n")[1]).toBe(
      "desktop.browser.probe.elementInComponent|div|OrderCard"
    );
    expect(buildInspectPrompt(t, target({ componentName: "DIV" })).split("\n")[1]).toBe(
      "desktop.browser.probe.element|div"
    );
  });

  it("emits one line per available fact, in order", () => {
    const lines = buildInspectPrompt(
      t,
      target({
        sourceFile: "src/views/List.vue",
        sourceLine: 42,
        outerHTMLSnippet: "<div/>"
      })
    ).split("\n");

    expect(lines).toEqual([
      "desktop.browser.probe.inspectHeading",
      "desktop.browser.probe.element|div",
      "desktop.browser.probe.selector|div.card",
      "desktop.browser.probe.text|Total",
      "desktop.browser.probe.source|src/views/List.vue|42",
      "desktop.browser.probe.html|<div/>"
    ]);
  });

  it("marks a text-matched location as approximate", () => {
    const lines = buildInspectPrompt(
      t,
      target({ sourceFile: "index.html", sourceLocated: false })
    ).split("\n");
    expect(lines.at(-1)).toBe("desktop.browser.probe.sourceApprox|index.html");
  });
});

describe("buildMarkupPrompt", () => {
  it("uses the single-region dialect and picks the scope by locate result", () => {
    const located = buildMarkupPrompt(t, [
      markup({ target: { tagName: "div", selector: "div.card", sourceFile: "src/App.vue", sourceLine: 7, stack: [] } })
    ]).split("\n");
    expect(located).toEqual([
      "desktop.browser.probe.markupSingle|make it orange",
      "desktop.browser.probe.markupScopeOne",
      "desktop.browser.probe.markupTarget|div",
      "desktop.browser.probe.markupSource|src/App.vue|7"
    ]);

    const unlocated = buildMarkupPrompt(t, [markup()]).split("\n");
    expect(unlocated).toEqual([
      "desktop.browser.probe.markupSingle|make it orange",
      "desktop.browser.probe.markupScopeUnlocated"
    ]);
  });

  it("numbers every region in the multi-region dialect", () => {
    const lines = buildMarkupPrompt(t, [
      markup({ id: "b1", note: "first" }),
      markup({ id: "b2", note: "second", target: { tagName: "span", selector: "span", stack: [] } })
    ]).split("\n");
    expect(lines).toEqual([
      "desktop.browser.probe.markupMany|2",
      "desktop.browser.probe.markupIndex|1",
      "desktop.browser.probe.markupNote|first",
      "desktop.browser.probe.markupIndex|2",
      "desktop.browser.probe.markupNote|second",
      "desktop.browser.probe.markupTarget|span"
    ]);
  });
});

describe("composeErrorPrompt", () => {
  const entry: BrowserDevtoolsLogEntry = {
    id: "cdp_1",
    timestamp: 0,
    level: "error",
    category: "runtime",
    text: "boom"
  };

  it("omits the stack section when the entry has none", () => {
    expect(composeErrorPrompt(t, entry).split("\n")).toEqual([
      "desktop.browser.console.fixHeading",
      "desktop.browser.console.fixText|boom",
      "desktop.browser.console.fixOutro"
    ]);
  });

  it("carries the stack through when there is one", () => {
    const lines = composeErrorPrompt(t, { ...entry, stack: "  at foo (a.js:1:2)" }).split("\n");
    expect(lines[2]).toBe("desktop.browser.console.fixStack|  at foo (a.js:1:2)");
  });
});
