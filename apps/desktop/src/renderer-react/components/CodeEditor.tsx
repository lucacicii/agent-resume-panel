import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
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
import { oneDark } from "@codemirror/theme-one-dark";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";

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
  /** File path or language id used to pick a CodeMirror language pack. */
  filePath?: string;
  /** Explicit language id (overrides filePath extension when set). */
  language?: string;
  shouldHandlePaste?: () => boolean;
  onPasteImage?: () => Promise<string | null>;
}

export interface CodeEditorHandle {
  focus(): void;
  find(query: string, direction?: "forward" | "backward"): boolean;
}

const editable = new Compartment();
const wrapping = new Compartment();
const tabs = new Compartment();
const theme = new Compartment();
const language = new Compartment();

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

function isDarkAppearance(): boolean {
  const root = document.documentElement;
  const explicit = root.dataset.theme;
  if (explicit === "dark") return true;
  if (explicit === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function themeExtensions(dark: boolean): Extension[] {
  if (dark) {
    // One Dark: high-contrast tokens for markdown + code on dark chrome.
    return [oneDark, caretTheme];
  }
  return [lightEditorTheme, syntaxHighlighting(defaultHighlightStyle), caretTheme];
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
  change.current = onChange;
  blur.current = onBlur;
  pasteImage.current = onPasteImage;
  handlesPaste.current = shouldHandlePaste;

  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    find: (query, direction = "forward") => {
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
      instance.focus();
      return true;
    }
  }), []);

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        bracketMatching(),
        language.of(languageExtension(filePath, languageId)),
        theme.of(themeExtensions(isDarkAppearance())),
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
          if (update.docChanged) change.current(update.state.doc.toString());
        })
      ]
    });
    const instance = new EditorView({ state, parent: host.current });
    view.current = instance;

    const applyTheme = () => {
      instance.dispatch({ effects: theme.reconfigure(themeExtensions(isDarkAppearance())) });
    };
    const onThemeChange = () => applyTheme();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = () => {
      if (!document.documentElement.dataset.theme) applyTheme();
    };
    window.addEventListener("agent-resume:theme-change", onThemeChange);
    media.addEventListener("change", onMedia);
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      window.removeEventListener("agent-resume:theme-change", onThemeChange);
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
    instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: value } });
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

  return <div className={className} ref={host} style={{ fontSize: `${fontSize}px` }} />;
});
