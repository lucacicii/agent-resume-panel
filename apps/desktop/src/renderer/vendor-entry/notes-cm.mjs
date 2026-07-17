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
import { Chunk, MergeView } from "@codemirror/merge";
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

function gitDiffEditorTheme() {
  return EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: "var(--color-window-bg)",
      color: "var(--color-label-primary)"
    },
    ".cm-scroller": {
      fontFamily: "var(--font-family-mono)",
      lineHeight: "1.5",
      overflow: "auto"
    },
    ".cm-content": {
      padding: "8px 0"
    },
    "&.cm-focused": {
      outline: "none"
    },
    ".cm-gutters": {
      backgroundColor: "var(--color-secondary-bg)",
      color: "var(--color-label-secondary)",
      borderRight: "1px solid var(--color-separator)"
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--color-fill-primary)"
    }
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

function classifyDiffChunk(chunk) {
  let added = false;
  let deleted = false;
  for (const change of chunk.changes) {
    const changedA = change.toA > change.fromA;
    const changedB = change.toB > change.fromB;
    if (changedA && changedB) return "change";
    if (changedB) added = true;
    if (changedA) deleted = true;
  }
  if (added && deleted) return "change";
  return added ? "add" : "delete";
}

function clampDocPosition(doc, position) {
  return Math.max(0, Math.min(doc.length, position));
}

function lineNumberAt(doc, position) {
  return doc.lineAt(clampDocPosition(doc, position)).number;
}

function buildDiffExtensions(options) {
  const pref = options.theme;
  const useLight =
    pref === "light" || pref === "dark"
      ? pref === "light"
      : (window.matchMedia?.("(prefers-color-scheme: light)")?.matches ?? false);
  const themePack = useLight
    ? [syntaxHighlighting(defaultHighlightStyle, { fallback: true }), gitDiffEditorTheme()]
    : [oneDark, gitDiffEditorTheme()];
  return [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorState.tabSize.of(4),
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    languageCompartment.of(initialLanguage(options)),
    ...themePack
  ];
}

function buildDiffOverview(chunks, aDoc, bDoc) {
  const maxLines = Math.max(aDoc.lines, bDoc.lines, 1);
  return chunks.map((chunk, index) => {
    const lineA = lineNumberAt(aDoc, chunk.fromA);
    const lineB = lineNumberAt(bDoc, chunk.fromB);
    const endLineA = lineNumberAt(aDoc, chunk.endA);
    const endLineB = lineNumberAt(bDoc, chunk.endB);
    const firstLine = Math.min(lineA, lineB);
    const lastLine = Math.max(endLineA, endLineB, firstLine);
    return {
      index,
      kind: classifyDiffChunk(chunk),
      fromA: clampDocPosition(aDoc, chunk.fromA),
      fromB: clampDocPosition(bDoc, chunk.fromB),
      ratio: (firstLine - 1) / maxLines,
      sizeRatio: Math.max(1 / maxLines, (lastLine - firstLine + 1) / maxLines)
    };
  });
}

function bindDiffScrollSync(instance) {
  const scroll = instance.merge.dom;
  const update = () => instance.onScroll?.(gitDiffCodeMirror.getScrollMetrics(instance));
  scroll.addEventListener("scroll", update, { passive: true });
  requestAnimationFrame(update);
  return () => {
    scroll.removeEventListener("scroll", update);
  };
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

const gitDiffCodeMirror = {
  mount(host, options = {}) {
    const oldText = String(options.oldText ?? "");
    const newText = String(options.newText ?? "");
    const oldDoc = EditorState.create({ doc: oldText }).doc;
    const newDoc = EditorState.create({ doc: newText }).doc;
    const merge = new MergeView({
      a: {
        doc: oldText,
        extensions: buildDiffExtensions(options)
      },
      b: {
        doc: newText,
        extensions: buildDiffExtensions(options)
      },
      parent: host,
      orientation: "a-b",
      revertControls: undefined,
      gutter: true,
      highlightChanges: true,
      diffConfig: { scanLimit: 500, timeout: 1000 }
    });
    const instance = {
      merge,
      overview: buildDiffOverview(merge.chunks, merge.a.state.doc, merge.b.state.doc),
      onScroll: options.onScroll,
      disposeScrollSync: null
    };
    instance.disposeScrollSync = bindDiffScrollSync(instance);
    void configureLanguage(merge.a, options);
    void configureLanguage(merge.b, options);
    return instance;
  },
  unmount(instance) {
    instance?.disposeScrollSync?.();
    instance?.merge?.destroy?.();
  },
  getOverview(instance) {
    return instance?.overview ?? [];
  },
  getScrollMetrics(instance) {
    const scroll = instance?.merge?.dom;
    if (!scroll) return { scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
    return {
      scrollTop: scroll.scrollTop,
      scrollHeight: scroll.scrollHeight,
      clientHeight: scroll.clientHeight
    };
  },
  scrollToChange(instance, index) {
    const item = instance?.overview?.[index];
    if (!item) return;
    instance.merge.a.dispatch({ effects: EditorView.scrollIntoView(item.fromA, { y: "center" }) });
    instance.merge.b.dispatch({ effects: EditorView.scrollIntoView(item.fromB, { y: "center" }) });
  },
  scrollToRatio(instance, ratio) {
    const { a, b } = instance?.merge ?? {};
    if (!a || !b) return;
    const normalized = Math.max(0, Math.min(1, Number(ratio) || 0));
    const lineA = Math.max(1, Math.round(1 + normalized * (a.state.doc.lines - 1)));
    const lineB = Math.max(1, Math.round(1 + normalized * (b.state.doc.lines - 1)));
    a.dispatch({ effects: EditorView.scrollIntoView(a.state.doc.line(lineA).from, { y: "center" }) });
    b.dispatch({ effects: EditorView.scrollIntoView(b.state.doc.line(lineB).from, { y: "center" }) });
  },
  getScrollRatio(instance) {
    const { scrollTop, scrollHeight, clientHeight } = gitDiffCodeMirror.getScrollMetrics(instance);
    return scrollHeight > clientHeight ? scrollTop / (scrollHeight - clientHeight) : 0;
  },
  restoreScrollRatio(instance, ratio) {
    if (!instance) return;
    gitDiffCodeMirror.scrollToRatio(instance, ratio);
  }
};

globalThis.DesktopCodeMirror = desktopCodeMirror;
globalThis.NotesCodeMirror = desktopCodeMirror;
globalThis.GitDiffCodeMirror = gitDiffCodeMirror;
