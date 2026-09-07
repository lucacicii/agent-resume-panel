import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";

export type CodeMirrorAppearance = "follow-app" | "light" | "dark";
export type CodeMirrorThemeId = "classic-light" | "classic-dark";

const lightEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--color-label-primary)"
  },
  ".cm-content": {
    caretColor: "var(--editor-caret-color)"
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--editor-caret-color)"
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--color-fill-primary)"
  },
  ".cm-activeLine": {
    backgroundColor: "var(--color-fill-tertiary)"
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--color-label-tertiary)",
    border: "none"
  }
});

const caretTheme = EditorView.theme({
  ".cm-cursor": {
    borderLeft: "2px solid var(--editor-caret-color)",
    marginLeft: "-1px"
  }
});

export function resolveCodeMirrorThemeId(
  preference: CodeMirrorAppearance = "follow-app",
  root: HTMLElement = document.documentElement,
  prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
): CodeMirrorThemeId {
  if (preference === "light") return "classic-light";
  if (preference === "dark") return "classic-dark";
  if (root.dataset.theme === "dark") return "classic-dark";
  if (root.dataset.theme === "light") return "classic-light";
  return prefersDark ? "classic-dark" : "classic-light";
}

export function codeMirrorThemeExtensions(
  preference: CodeMirrorAppearance = "follow-app"
): Extension[] {
  if (resolveCodeMirrorThemeId(preference) === "classic-dark") {
    return [oneDark, caretTheme];
  }
  return [lightEditorTheme, syntaxHighlighting(defaultHighlightStyle), caretTheme];
}
