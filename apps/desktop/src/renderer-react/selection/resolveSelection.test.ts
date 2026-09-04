import { afterEach, describe, expect, it } from "vitest";
import { registerCodeMirrorSelection } from "./codeMirrorSelection";
import { registerTerminalSelection } from "./terminalSelection";
import { isComposerTarget, isObjectMenuTarget, resolveSelection } from "./resolveSelection";

afterEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

function selectText(node: HTMLElement, text: string): void {
  node.textContent = text;
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("resolveSelection", () => {
  it("ignores composer and object-menu targets", () => {
    const input = document.createElement("input");
    document.body.append(input);
    expect(isComposerTarget(input)).toBe(true);
    expect(resolveSelection(input)).toBeNull();

    const row = document.createElement("button");
    row.className = "wb-folder-row";
    document.body.append(row);
    expect(isObjectMenuTarget(row)).toBe(true);
    expect(resolveSelection(row)).toBeNull();
  });

  it("reads DOM selection inside the target", () => {
    const body = document.createElement("div");
    body.className = "chat-bubble";
    document.body.append(body);
    selectText(body, "send this");
    expect(resolveSelection(body)).toEqual({ text: "send this" });
  });

  it("ignores DOM selection that lives outside the click target", () => {
    const body = document.createElement("div");
    body.className = "chat-bubble";
    const other = document.createElement("div");
    document.body.append(body, other);
    selectText(body, "send this");
    expect(resolveSelection(other)).toBeNull();
  });

  it("reads a registered CodeMirror selection", () => {
    const host = document.createElement("div");
    host.className = "cm-host";
    document.body.append(host);
    const stop = registerCodeMirrorSelection({
      element: host,
      getSelectedText: () => "  editor text  ",
      projectPath: "/work/app"
    });
    expect(resolveSelection(host)).toEqual({ text: "editor text", projectPath: "/work/app" });
    stop();
  });

  it("reads a registered terminal selection", () => {
    const host = document.createElement("div");
    host.className = "wb-terminal-host";
    document.body.append(host);
    const stop = registerTerminalSelection({
      element: host,
      getSelectedText: () => "ls -la"
    });
    expect(resolveSelection(host)).toEqual({ text: "ls -la" });
    stop();
  });
});
