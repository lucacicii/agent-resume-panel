import { selectedTextFromCodeMirror } from "./codeMirrorSelection";
import { selectedTextFromTerminal } from "./terminalSelection";

export type ResolvedSelection = {
  text: string;
  projectPath?: string;
};

const OWNED_MENU_SELECTORS = [
  ".im-message",
  ".wb-editor-pane",
  ".notes-editor-surface",
  ".standalone-note-window-editor-surface"
].join(",");

const OBJECT_MENU_SELECTORS = [
  ".wb-folder-row",
  ".wb-list-item",
  ".wb-terminal-tab",
  ".wb-file-tree",
  ".wb-git-change",
  ".notes-folder-row",
  ".notes-list-item",
  ".im-folder-row",
  ".im-project-row"
].join(",");

function closestElement(target: EventTarget | null, selector: string): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest(selector);
}

function projectPathFrom(element: Element | null): string | undefined {
  const raw = element?.closest("[data-selection-project]")?.getAttribute("data-selection-project")?.trim();
  return raw || undefined;
}

function selectedDomText(target: EventTarget | null): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return "";
  const host = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  if (!host) return "";
  const ancestor = selection.getRangeAt(0).commonAncestorContainer;
  if (!host.contains(ancestor)) return "";
  return selection.toString().trim();
}

function selectedEditableText(target: EventTarget | null): string {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    return start === end ? "" : target.value.slice(start, end).trim();
  }
  return selectedDomText(target);
}

export function isOwnedSelectionMenuTarget(target: EventTarget | null): boolean {
  return Boolean(closestElement(target, OWNED_MENU_SELECTORS));
}

export function isObjectMenuTarget(target: EventTarget | null): boolean {
  return Boolean(closestElement(target, OBJECT_MENU_SELECTORS));
}

export function resolveSelection(target: EventTarget | null): ResolvedSelection | null {
  if (isObjectMenuTarget(target)) return null;
  const fromEditor = selectedTextFromCodeMirror(target);
  if (fromEditor) return fromEditor;
  const fromTerminal = selectedTextFromTerminal(target);
  if (fromTerminal) return fromTerminal;
  const text = selectedEditableText(target);
  if (!text) return null;
  const host = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const projectPath = projectPathFrom(host);
  return projectPath ? { text, projectPath } : { text };
}
