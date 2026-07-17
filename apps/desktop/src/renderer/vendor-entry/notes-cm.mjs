import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  LanguageDescription,
  syntaxHighlighting,
  defaultHighlightStyle,
  indentOnInput,
  bracketMatching,
  indentUnit
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
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

const setFindHighlight = StateEffect.define();
const languageCompartment = new Compartment();
const editorOptionsCompartment = new Compartment();

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

function initialLanguage(options) {
  if (options.mode === "markdown" || !options.filename) {
    return markdown({ base: markdownLanguage, codeLanguages: languages });
  }
  return [];
}

async function configureLanguage(view, options) {
  if (!view || options.mode === "markdown" || !options.filename) return;
  const description = LanguageDescription.matchFilename(languages, options.filename);
  if (!description) return;
  try {
    const support = await description.load();
    if (view.dom?.isConnected) {
      view.dispatch({ effects: languageCompartment.reconfigure(support) });
    }
  } catch {
    // Keep plain text mode when a language package cannot be loaded.
  }
}

function editorFontSizeTheme(fontSize) {
  if (!Number.isFinite(fontSize)) return [];
  return EditorView.theme({
    "&": { fontSize: `${Math.min(24, Math.max(11, Math.round(fontSize)))}px` }
  });
}

function buildEditorOptions(options) {
  const tabSize = [2, 4, 8].includes(Number(options.tabSize)) ? Number(options.tabSize) : 4;
  return [
    EditorState.readOnly.of(options.editable === false),
    EditorState.tabSize.of(tabSize),
    indentUnit.of(" ".repeat(tabSize)),
    ...(options.tabIndent === true ? [keymap.of([indentWithTab])] : []),
    ...(options.lineWrapping === false ? [] : [EditorView.lineWrapping]),
    editorFontSizeTheme(Number(options.fontSize))
  ];
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
    languageCompartment.of(initialLanguage(options)),
    editorOptionsCompartment.of(buildEditorOptions(options)),
    indentOnInput(),
    bracketMatching(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    placeholder(options.placeholder || ""),
    pasteHandler,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && typeof options.onChange === "function") {
        options.onChange(update.state.doc.toString());
      }
    }),
    ...themePack
  ];
}

const desktopCodeMirror = {
  mount(host, options = {}) {
    const state = EditorState.create({
      doc: options.value ?? "",
      extensions: buildExtensions(options)
    });
    const view = new EditorView({ state, parent: host });
    void configureLanguage(view, options);
    return view;
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
  setOptions(view, options = {}) {
    if (!view) return;
    view.dispatch({ effects: editorOptionsCompartment.reconfigure(buildEditorOptions(options)) });
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

globalThis.DesktopCodeMirror = desktopCodeMirror;
globalThis.NotesCodeMirror = desktopCodeMirror;
