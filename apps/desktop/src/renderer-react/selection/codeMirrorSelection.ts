type CodeMirrorSelectionSource = {
  element: HTMLElement;
  getSelectedText: () => string;
  projectPath?: string;
};

const sources = new Set<CodeMirrorSelectionSource>();

export function registerCodeMirrorSelection(source: CodeMirrorSelectionSource): () => void {
  sources.add(source);
  return () => {
    sources.delete(source);
  };
}

export function selectedTextFromCodeMirror(target: EventTarget | null): { text: string; projectPath?: string } | null {
  if (!(target instanceof Node)) return null;
  for (const source of sources) {
    if (source.element.contains(target) || target === source.element) {
      const text = source.getSelectedText().trim();
      if (!text) return null;
      return source.projectPath ? { text, projectPath: source.projectPath } : { text };
    }
  }
  return null;
}
