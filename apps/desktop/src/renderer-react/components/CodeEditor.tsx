import { useEffect, useRef } from "react";
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
}

const editable = new Compartment();

export function CodeEditor({
  value,
  onChange,
  onBlur,
  ariaLabel,
  className,
  readOnly = false
}: CodeEditorProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  const blur = useRef(onBlur);
  change.current = onChange;
  blur.current = onBlur;

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
        EditorView.lineWrapping,
        editable.of(EditorView.editable.of(!readOnly)),
        EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
        EditorView.domEventHandlers({ blur: () => { blur.current?.(); return false; } }),
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

  return <div className={className} ref={host} />;
}
