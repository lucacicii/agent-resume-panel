import { afterEach, describe, expect, it } from "vitest";
import { registerCodeMirrorSelection } from "./codeMirrorSelection";
import { registerTerminalSelection } from "./terminalSelection";
import { isObjectMenuTarget, resolveSelection } from "./resolveSelection";

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
  it("keeps object-menu targets native and ignores empty editable targets", () => {
    const input = document.createElement("input");
    document.body.append(input);
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

  it("reads selections from input and textarea targets", () => {
    const input = document.createElement("input");
    input.value = "input value";
    input.setSelectionRange(6, 11);
    document.body.append(input);
    expect(resolveSelection(input)).toEqual({ text: "value" });

    const textarea = document.createElement("textarea");
    textarea.value = "textarea value";
    textarea.setSelectionRange(9, 14);
    document.body.append(textarea);
    expect(resolveSelection(textarea)).toEqual({ text: "value" });
  });

  it("reads contenteditable selections", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.append(editor);
    selectText(editor, "editable value");
    expect(resolveSelection(editor)).toEqual({ text: "editable value" });
  });
});
