import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView, keymap } from "@codemirror/view";
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
        markdown(),
        syntaxHighlighting(defaultHighlightStyle),
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
    return () => {
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

  return <div className={className} ref={host} style={{ fontSize: `${fontSize}px` }} />;
});
