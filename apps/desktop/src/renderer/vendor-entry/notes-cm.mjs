import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import {
  LanguageDescription,
  syntaxHighlighting,
  defaultHighlightStyle,
  indentOnInput,
  bracketMatching
} from "@codemirror/language";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  EditorView,
  Decoration,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder
} from "@codemirror/view";

const codeLanguages = [
  LanguageDescription.of({ name: "javascript", alias: ["js"], support: javascript() }),
  LanguageDescription.of({ name: "typescript", alias: ["ts"], support: javascript({ typescript: true }) }),
  LanguageDescription.of({ name: "python", alias: ["py"], support: python() }),
  LanguageDescription.of({ name: "css", support: css() }),
  LanguageDescription.of({ name: "html", support: html() }),
  LanguageDescription.of({ name: "xml", support: xml() }),
  LanguageDescription.of({ name: "json", support: json() }),
  LanguageDescription.of({ name: "rust", support: rust() }),
  LanguageDescription.of({ name: "cpp", alias: ["c"], support: cpp() }),
  LanguageDescription.of({ name: "java", support: java() }),
  LanguageDescription.of({ name: "php", support: php() }),
  LanguageDescription.of({ name: "sql", support: sql() }),
  LanguageDescription.of({ name: "yaml", alias: ["yml"], support: yaml() }),
  LanguageDescription.of({ name: "go", support: go() })
];

const setFindHighlight = StateEffect.define();

const findHighlightField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setFindHighlight)) {
        const range = effect.value;
        if (!range || range.from === range.to) return Decoration.none;
        return Decoration.set([
          Decoration.mark({ class: "cm-notes-find-current" }).range(range.from, range.to)
        ]);
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field)
});

function notesEditorTheme() {
  return EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: "var(--bg)",
      color: "var(--text)"
    },
    ".cm-scroller": {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      lineHeight: "1.5",
      overflow: "auto"
    },
    ".cm-content": {
      padding: "12px 14px",
      caretColor: "var(--text)"
    },
    "&.cm-focused": {
      outline: "none"
    },
    ".cm-gutters": {
      backgroundColor: "color-mix(in srgb, var(--panel) 85%, var(--bg))",
      color: "var(--muted)",
      borderRight: "1px solid var(--border)"
    },
    ".cm-activeLineGutter": {
      backgroundColor: "color-mix(in srgb, var(--accent) 8%, transparent)"
    },
    ".cm-notes-find-current": {
      backgroundColor: "color-mix(in srgb, var(--accent) 34%, transparent)",
      outline: "1px solid color-mix(in srgb, var(--accent) 70%, transparent)",
      borderRadius: "2px"
    }
  });
}

function buildExtensions(options) {
  const pref = options.theme;
  const useLight =
    pref === "light" || pref === "dark"
      ? pref === "light"
      : (window.matchMedia?.("(prefers-color-scheme: light)")?.matches ?? false);
  const themePack = useLight
    ? [syntaxHighlighting(defaultHighlightStyle, { fallback: true }), notesEditorTheme()]
    : [oneDark, notesEditorTheme()];

  const pasteHandler = EditorView.domEventHandlers({
    paste(event) {
      if (typeof options.onPasteImage === "function" && options.onPasteImage(event)) {
        return true;
      }
      return false;
    }
  });

  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    findHighlightField,
    indentOnInput(),
    bracketMatching(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    markdown({ base: markdownLanguage, codeLanguages }),
    EditorView.lineWrapping,
    placeholder(options.placeholder || "编辑 Markdown…（⌘V 可粘贴图片）"),
    pasteHandler,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && typeof options.onChange === "function") {
        options.onChange(update.state.doc.toString());
      }
    }),
    ...themePack
  ];
}

globalThis.NotesCodeMirror = {
  mount(host, options = {}) {
    const state = EditorState.create({
      doc: options.value ?? "",
      extensions: buildExtensions(options)
    });
    return new EditorView({ state, parent: host });
  },
  unmount(view) {
    view?.destroy?.();
  },
  getValue(view) {
    return view?.state?.doc?.toString?.() ?? "";
  },
  setValue(view, text) {
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text ?? "" }
    });
  },
  focus(view) {
    view?.focus?.();
  },
  getSelectedText(view) {
    if (!view) return "";
    const range = view.state.selection.main;
    if (range.empty) return "";
    return view.state.doc.sliceString(range.from, range.to);
  },
  selectRange(view, from, to, options = {}) {
    if (!view) return;
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: [setFindHighlight.of({ from, to }), EditorView.scrollIntoView(from, { y: "center" })]
    });
    if (options.focus !== false) view.focus();
  },
  clearFindHighlight(view) {
    if (!view) return;
    view.dispatch({ effects: setFindHighlight.of(null) });
  },
  insertAtCursor(view, text) {
    if (!view || !text) return;
    const pos = view.state.selection.main.head;
    view.dispatch({
      changes: { from: pos, to: pos, insert: text },
      selection: { anchor: pos + text.length }
    });
  }
};
