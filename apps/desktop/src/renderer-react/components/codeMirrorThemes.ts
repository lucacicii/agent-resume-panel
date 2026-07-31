import { HighlightStyle, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export type CodeMirrorAppearance = "follow-app" | "light" | "dark";
export type CodeMirrorThemeId = "classic-light" | "classic-dark" | "cyberpunk" | "dos";

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

const cyberpunkEditorTheme = EditorView.theme({
  "&": { backgroundColor: "#070611", color: "#eaffff" },
  ".cm-scroller": { fontFamily: "var(--font-family-mono)" },
  ".cm-content": { caretColor: "#ff2bd6" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#ff2bd6" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgba(0, 240, 255, .26)"
  },
  ".cm-activeLine": { backgroundColor: "rgba(255, 43, 214, .075)" },
  ".cm-selectionMatch": { backgroundColor: "rgba(255, 212, 0, .12)" },
  ".cm-gutters": {
    backgroundColor: "#05040d",
    color: "#716a91",
    borderRight: "1px solid rgba(0, 240, 255, .35)"
  },
  ".cm-activeLineGutter": { color: "#ffd400", backgroundColor: "rgba(255, 212, 0, .08)" },
  "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    color: "#05040d",
    backgroundColor: "#00f0ff",
    outline: "1px solid #ff2bd6"
  },
  ".cm-panels": { backgroundColor: "#0b0920", color: "#eaffff" },
  ".cm-tooltip": { border: "1px solid rgba(0, 240, 255, .45)", backgroundColor: "#17132e" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "rgba(255, 43, 214, .18)",
    color: "#ffffff"
  }
}, { dark: true });

const cyberpunkHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#ff2bd6", fontWeight: "bold" },
  { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName], color: "#ff7190" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#00f0ff" },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: "#ff8ee8" },
  { tag: [tags.definition(tags.name), tags.separator], color: "#eaffff" },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: "#ffd400" },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: "#83f8ff" },
  { tag: [tags.meta, tags.comment], color: "#716a91", fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "#00f0ff", textDecoration: "underline" },
  { tag: tags.heading, color: "#ffd400", fontWeight: "bold" },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: "#ff8ee8" },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: "#72f1b8" },
  { tag: tags.invalid, color: "#ffffff", backgroundColor: "#ff3b5c" }
]);

const dosEditorTheme = EditorView.theme({
  "&": { backgroundColor: "#17120d", color: "#f0d7a0" },
  ".cm-scroller": { fontFamily: "var(--font-family-mono)" },
  ".cm-content": { caretColor: "#ffd479" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#ffd479" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgba(243, 185, 79, .30)"
  },
  ".cm-activeLine": { backgroundColor: "rgba(240, 215, 160, .06)" },
  ".cm-selectionMatch": { backgroundColor: "rgba(159, 191, 117, .14)" },
  ".cm-gutters": {
    backgroundColor: "#211a12",
    color: "#8e7654",
    borderRight: "1px solid #74552e"
  },
  ".cm-activeLineGutter": { color: "#ffe2a0", backgroundColor: "#2a2116" },
  "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    color: "#17120d",
    backgroundColor: "#f3b94f",
    outline: "1px solid #ffe2a0"
  },
  ".cm-panels": { backgroundColor: "#211a12", color: "#f0d7a0" },
  ".cm-tooltip": { border: "1px solid #74552e", backgroundColor: "#261d14" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "#3a2b1c",
    color: "#fff1d0"
  },
  ".cm-foldPlaceholder": { backgroundColor: "transparent", border: "1px solid #74552e", color: "#c6aa7b" }
}, { dark: true });

const dosHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#f3b94f", fontWeight: "bold" },
  { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName], color: "#e5d2ab" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#ffe2a0" },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: "#d0a287" },
  { tag: [tags.definition(tags.name), tags.separator], color: "#f0d7a0" },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: "#f6d68e" },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: "#b7d7c3" },
  { tag: [tags.meta, tags.comment], color: "#8e7654", fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "#b7d7c3", textDecoration: "underline" },
  { tag: tags.heading, color: "#ffe2a0", fontWeight: "bold" },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: "#ec9a80" },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: "#c1d99d" },
  { tag: tags.invalid, color: "#17120d", backgroundColor: "#d87963" }
]);

export function resolveCodeMirrorThemeId(
  preference: CodeMirrorAppearance = "follow-app",
  root: HTMLElement = document.documentElement,
  prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
): CodeMirrorThemeId {
  if (preference === "light") return "classic-light";
  if (preference === "dark") return "classic-dark";
  if (root.dataset.visualTheme === "cyberpunk") return "cyberpunk";
  if (root.dataset.visualTheme === "dos") return "dos";
  if (root.dataset.theme === "dark") return "classic-dark";
  if (root.dataset.theme === "light") return "classic-light";
  return prefersDark ? "classic-dark" : "classic-light";
}

export function codeMirrorThemeExtensions(
  preference: CodeMirrorAppearance = "follow-app"
): Extension[] {
  switch (resolveCodeMirrorThemeId(preference)) {
    case "cyberpunk":
      return [cyberpunkEditorTheme, syntaxHighlighting(cyberpunkHighlightStyle), caretTheme];
    case "dos":
      return [dosEditorTheme, syntaxHighlighting(dosHighlightStyle), caretTheme];
    case "classic-dark":
      return [oneDark, caretTheme];
    default:
      return [lightEditorTheme, syntaxHighlighting(defaultHighlightStyle), caretTheme];
  }
}
