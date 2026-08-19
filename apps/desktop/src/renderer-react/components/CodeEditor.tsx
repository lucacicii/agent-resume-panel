import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Annotation, Compartment, EditorState, StateEffect, StateField, Transaction, type Extension, type Text } from "@codemirror/state";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { Decoration, drawSelection, EditorView, keymap, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { codeMirrorThemeExtensions, type CodeMirrorAppearance } from "./codeMirrorThemes";

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  ariaLabel: string;
  className?: string;
  readOnly?: boolean;
  fontSize?: number;
  wordWrap?: boolean;
  tabSize?: number;
  /** Workbench may use an independent editor appearance; other editors follow the app. */
  appearance?: CodeMirrorAppearance;
  /** File path or language id used to pick a CodeMirror language pack. */
  filePath?: string;
  /** Explicit language id (overrides filePath extension when set). */
  language?: string;
  shouldHandlePaste?: () => boolean;
  onPasteImage?: () => Promise<string | null>;
}

export interface CodeEditorFindOptions {
  /** When false, highlight the match without stealing keyboard focus. Default true. */
  focus?: boolean;
}

export interface CodeEditorSearchResult {
  /** 1-based current match, or 0 when there are no matches. */
  current: number;
  total: number;
}

export interface CodeEditorRevealRange {
  /** 1-based line number */
  line: number;
  /** 1-based start column */
  column: number;
  /** 1-based end column (exclusive-style end for selection head). */
  endColumn?: number;
  focus?: boolean;
}

export interface CodeEditorSelectionRange {
  /** 1-based start line */
  startLine: number;
  /** 1-based end line */
  endLine: number;
  /** 1-based start column */
  startColumn: number;
  /** 1-based end column */
  endColumn: number;
  text: string;
}

export interface CodeEditorHandle {
  focus(): void;
  find(query: string, direction?: "forward" | "backward", options?: CodeEditorFindOptions): boolean;
  setSearchQuery(query: string): CodeEditorSearchResult;
  navigateSearch(direction: "forward" | "backward"): CodeEditorSearchResult;
  clearSearch(): void;
  getSearchResult(): CodeEditorSearchResult;
  getSelectedText(): string;
  /** Non-empty selection range in 1-based line/column coordinates. */
  getSelectionRange(): CodeEditorSelectionRange | null;
  /** Select and scroll to a 1-based line/column range (for Find in Files). */
  revealRange(range: CodeEditorRevealRange): boolean;
}

const editable = new Compartment();
const wrapping = new Compartment();
const tabs = new Compartment();
const theme = new Compartment();
const language = new Compartment();
const externalValueSync = Annotation.define<boolean>();

interface SearchMatch {
  from: number;
  to: number;
}

interface EditorSearchState {
  query: string;
  matches: SearchMatch[];
  currentIndex: number;
  decorations: DecorationSet;
}

const setEditorSearchQuery = StateEffect.define<{ query: string; selectedFrom?: number; selectedTo?: number }>();
const navigateEditorSearch = StateEffect.define<"forward" | "backward">();

function collectSearchMatches(doc: Text, query: string): SearchMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const haystack = doc.toString().toLocaleLowerCase();
  const matches: SearchMatch[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const match = haystack.indexOf(needle, from);
    if (match < 0) break;
    matches.push({ from: match, to: match + needle.length });
    from = match + Math.max(1, needle.length);
  }
  return matches;
}

function createEditorSearchState(doc: Text, query: string, currentIndex = 0): EditorSearchState {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = collectSearchMatches(doc, normalizedQuery);
  const nextIndex = matches.length ? Math.min(Math.max(0, currentIndex), matches.length - 1) : -1;
  return {
    query: normalizedQuery,
    matches,
    currentIndex: nextIndex,
    decorations: Decoration.set(matches.map((match, index) => Decoration.mark({
      class: index === nextIndex
        ? "cm-editor-search-match cm-editor-search-match-current"
        : "cm-editor-search-match"
    }).range(match.from, match.to)))
  };
}

const editorSearchState = StateField.define<EditorSearchState>({
  create: (state) => createEditorSearchState(state.doc, ""),
  update: (search, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setEditorSearchQuery)) {
        const next = createEditorSearchState(transaction.newDoc, effect.value.query);
        const selectedIndex = next.matches.findIndex((match) =>
          match.from === effect.value.selectedFrom && match.to === effect.value.selectedTo
        );
        return selectedIndex >= 0
          ? createEditorSearchState(transaction.newDoc, effect.value.query, selectedIndex)
          : next;
      }
      if (effect.is(navigateEditorSearch)) {
        if (!search.matches.length) return search;
        const delta = effect.value === "forward" ? 1 : -1;
        return createEditorSearchState(
          transaction.newDoc,
          search.query,
          (search.currentIndex + delta + search.matches.length) % search.matches.length
        );
      }
    }
    if (!transaction.docChanged || !search.query) return search;
    const current = search.matches[search.currentIndex];
    const mappedPosition = current ? transaction.changes.mapPos(current.from, 1) : 0;
    const matches = collectSearchMatches(transaction.newDoc, search.query);
    const currentIndex = matches.findIndex((match) => match.from >= mappedPosition);
    return createEditorSearchState(
      transaction.newDoc,
      search.query,
      currentIndex >= 0 ? currentIndex : Math.max(0, matches.length - 1)
    );
  },
  provide: (field) => EditorView.decorations.from(field, (search) => search.decorations)
});

function searchResult(search: EditorSearchState): CodeEditorSearchResult {
  return {
    current: search.currentIndex >= 0 ? search.currentIndex + 1 : 0,
    total: search.matches.length
  };
}

function revealSearchMatch(instance: EditorView, focus: boolean): CodeEditorSearchResult {
  const search = instance.state.field(editorSearchState);
  const match = search.matches[search.currentIndex];
  if (match) {
    instance.dispatch({
      selection: { anchor: match.from, head: match.to },
      effects: EditorView.scrollIntoView(match.from, { y: "center" })
    });
    if (focus) instance.focus();
    else instance.contentDOM.blur();
  }
  return searchResult(search);
}

function normalizeLanguageKey(filePath?: string, languageId?: string): string {
  const raw = (languageId || filePath || "markdown").trim().toLowerCase();
  if (!raw) return "markdown";
  const base = raw.includes("/") || raw.includes("\\")
    ? raw.split(/[/\\]/).pop() || raw
    : raw;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1) : base;
}

function languageExtension(filePath?: string, languageId?: string): Extension {
  const key = normalizeLanguageKey(filePath, languageId);
  switch (key) {
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "ts":
    case "mts":
    case "cts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "json":
    case "jsonc":
      return json();
    case "css":
    case "scss":
    case "less":
      return css();
    case "html":
    case "htm":
    case "svelte":
    case "vue":
      return html();
    case "xml":
    case "svg":
      return xml();
    case "yml":
    case "yaml":
      return yaml();
    case "py":
    case "python":
      return python();
    case "rs":
    case "rust":
      return rust();
    case "go":
      return go();
    case "java":
      return java();
    case "c":
    case "h":
    case "cc":
    case "cpp":
    case "cxx":
    case "hpp":
    case "hh":
      return cpp();
    case "php":
      return php();
    case "sql":
      return sql();
    case "md":
    case "mdx":
    case "markdown":
    case "txt":
    default:
      return markdown();
  }
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor({
  value,
  onChange,
  onBlur,
  ariaLabel,
  className,
  readOnly = false,
  fontSize = 13,
  wordWrap = true,
  tabSize = 4,
  appearance = "follow-app",
  filePath,
  language: languageId,
  shouldHandlePaste,
  onPasteImage
}, ref): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  const blur = useRef(onBlur);
  const pasteImage = useRef(onPasteImage);
  const handlesPaste = useRef(shouldHandlePaste);
  const appearanceMode = useRef(appearance);
  change.current = onChange;
  blur.current = onBlur;
  pasteImage.current = onPasteImage;
  handlesPaste.current = shouldHandlePaste;
  appearanceMode.current = appearance;

  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    find: (query, direction = "forward", options) => {
      const instance = view.current;
      const needle = query.trim().toLocaleLowerCase();
      if (!instance || !needle) return false;
      const documentText = instance.state.doc.toString();
      const haystack = documentText.toLocaleLowerCase();
      const selection = instance.state.selection.main;
      const match = direction === "forward"
        ? haystack.indexOf(needle, selection.to)
        : haystack.lastIndexOf(needle, Math.max(0, selection.from - 1));
      const wrapped = direction === "forward"
        ? (match >= 0 ? match : haystack.indexOf(needle))
        : (match >= 0 ? match : haystack.lastIndexOf(needle));
      if (wrapped < 0) return false;
      instance.dispatch({
        selection: { anchor: wrapped, head: wrapped + needle.length },
        effects: EditorView.scrollIntoView(wrapped, { y: "center" })
      });
      if (options?.focus === false) {
        // Programmatic selection can move focus into the contenteditable; push it out
        // so host find UIs keep receiving keyboard events (Enter = next match).
        instance.contentDOM.blur();
      } else {
        instance.focus();
      }
      return true;
    },
    setSearchQuery: (query) => {
      const instance = view.current;
      if (!instance) return { current: 0, total: 0 };
      const selection = instance.state.selection.main;
      instance.dispatch({ effects: setEditorSearchQuery.of({
        query,
        selectedFrom: selection.from === selection.to ? undefined : selection.from,
        selectedTo: selection.from === selection.to ? undefined : selection.to
      }) });
      return revealSearchMatch(instance, false);
    },
    navigateSearch: (direction) => {
      const instance = view.current;
      if (!instance) return { current: 0, total: 0 };
      instance.dispatch({ effects: navigateEditorSearch.of(direction) });
      return revealSearchMatch(instance, false);
    },
    clearSearch: () => {
      const instance = view.current;
      if (!instance) return;
      instance.dispatch({ effects: setEditorSearchQuery.of({ query: "" }) });
      const head = instance.state.selection.main.head;
      instance.dispatch({ selection: { anchor: head } });
    },
    getSearchResult: () => {
      const instance = view.current;
      return instance ? searchResult(instance.state.field(editorSearchState)) : { current: 0, total: 0 };
    },
    getSelectedText: () => {
      const instance = view.current;
      if (!instance) return "";
      const { from, to } = instance.state.selection.main;
      return from === to ? "" : instance.state.sliceDoc(from, to);
    },
    getSelectionRange: () => {
      const instance = view.current;
      if (!instance) return null;
      const { from, to } = instance.state.selection.main;
      if (from === to) return null;
      const start = Math.min(from, to);
      const end = Math.max(from, to);
      const startLine = instance.state.doc.lineAt(start);
      const endLine = instance.state.doc.lineAt(end);
      return {
        startLine: startLine.number,
        endLine: endLine.number,
        startColumn: start - startLine.from + 1,
        endColumn: end - endLine.from + 1,
        text: instance.state.sliceDoc(start, end)
      };
    },
    revealRange: (range) => {
      const instance = view.current;
      if (!instance || !range) return false;
      const doc = instance.state.doc;
      const lineNumber = Math.min(Math.max(1, Math.floor(range.line) || 1), doc.lines);
      const line = doc.line(lineNumber);
      const column = Math.max(1, Math.floor(range.column) || 1);
      const endColumn = Math.max(column, Math.floor(range.endColumn ?? column + 1));
      const anchor = Math.min(line.to, line.from + column - 1);
      const head = Math.min(line.to, line.from + endColumn - 1);
      instance.dispatch({
        selection: { anchor, head: Math.max(anchor, head) },
        effects: EditorView.scrollIntoView(anchor, { y: "center" })
      });
      if (range.focus === false) {
        instance.contentDOM.blur();
      } else {
        instance.focus();
      }
      return true;
    }
  }), []);

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        editorSearchState,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab
        ]),
        bracketMatching(),
        language.of(languageExtension(filePath, languageId)),
        theme.of(codeMirrorThemeExtensions(appearanceMode.current)),
        drawSelection(),
        wrapping.of(wordWrap ? EditorView.lineWrapping : []),
        tabs.of(EditorState.tabSize.of(tabSize)),
        editable.of(EditorView.editable.of(!readOnly)),
        EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
        EditorView.domEventHandlers({
          blur: () => { blur.current?.(); return false; },
          paste: (event, instance) => {
            if (!pasteImage.current || !handlesPaste.current?.()) return false;
            event.preventDefault();
            const selection = instance.state.selection.main;
            void pasteImage.current().then((snippet) => {
              if (!snippet || view.current !== instance || instance.state.facet(EditorView.editable) === false) return;
              instance.dispatch({
                changes: { from: selection.from, to: selection.to, insert: snippet },
                selection: { anchor: selection.from + snippet.length },
                effects: EditorView.scrollIntoView(selection.from, { y: "center" })
              });
              instance.focus();
            });
            return true;
          }
        }),
        EditorView.updateListener.of((update) => {
          const programmatic = update.transactions.some((transaction) => transaction.annotation(externalValueSync));
          if (update.docChanged && !programmatic) change.current(update.state.doc.toString());
        })
      ]
    });
    const instance = new EditorView({ state, parent: host.current });
    view.current = instance;

    const applyTheme = () => {
      instance.dispatch({ effects: theme.reconfigure(codeMirrorThemeExtensions(appearanceMode.current)) });
    };
    const onThemeChange = () => applyTheme();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = () => {
      if (appearanceMode.current === "follow-app") applyTheme();
    };
    window.addEventListener("agent-resume:appearance-change", onThemeChange);
    media.addEventListener("change", onMedia);
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-visual-theme"] });

    return () => {
      window.removeEventListener("agent-resume:appearance-change", onThemeChange);
      media.removeEventListener("change", onMedia);
      observer.disconnect();
      instance.destroy();
      if (view.current === instance) view.current = null;
    };
  // The editor is intentionally created once. Prop updates are dispatched below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = view.current;
    if (!instance || instance.state.doc.toString() === value) return;
    const selection = instance.state.selection.main;
    instance.dispatch({
      changes: { from: 0, to: instance.state.doc.length, insert: value },
      selection: {
        anchor: Math.min(selection.anchor, value.length),
        head: Math.min(selection.head, value.length)
      },
      annotations: [externalValueSync.of(true), Transaction.addToHistory.of(false)]
    });
  }, [value]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({ effects: editable.reconfigure(EditorView.editable.of(!readOnly)) });
  }, [readOnly]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({ effects: wrapping.reconfigure(wordWrap ? EditorView.lineWrapping : []) });
  }, [wordWrap]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({ effects: tabs.reconfigure(EditorState.tabSize.of(tabSize)) });
  }, [tabSize]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({ effects: language.reconfigure(languageExtension(filePath, languageId)) });
  }, [filePath, languageId]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({ effects: theme.reconfigure(codeMirrorThemeExtensions(appearance)) });
  }, [appearance]);

  return <div className={className} ref={host} style={{ fontSize: `${fontSize}px` }} />;
});
