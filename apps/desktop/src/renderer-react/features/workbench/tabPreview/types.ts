/** The hue family a preview card borrows from its tab group. */
export type TabPreviewAccent = "session" | "terminal" | "code" | "note";

type PreviewBase = {
  /** Pane key; also the cache and race identity. */
  key: string;
  title: string;
  meta?: string;
  accent: TabPreviewAccent;
};

/**
 * Everything the hover card needs to know about a pane, captured at render
 * time. Data that is already in renderer state (editor, diff) rides along;
 * the rest is fetched by key once the intent delay elapses.
 */
export type TabPreviewTarget =
  | (PreviewBase & {
      kind: "screen";
      ptyId?: number;
      /** Session transcript fallback when the pane mirror has nothing yet. */
      session?: { provider: string; id: string };
    })
  | (PreviewBase & { kind: "acp"; recordId: string })
  | (PreviewBase & { kind: "thunder"; sessionId?: string })
  | (PreviewBase & { kind: "text"; text: string; mono: boolean })
  | (PreviewBase & { kind: "note"; noteId: string })
  | (PreviewBase & { kind: "diff"; oldText: string; newText: string });

export type TabPreviewLine = { kind?: "add" | "del"; text: string };

export type TabPreviewMessage = {
  role: "user" | "assistant" | "other";
  text: string;
};

export type TabPreviewContent =
  | { kind: "screen"; lines: string[] }
  | { kind: "messages"; messages: TabPreviewMessage[] }
  | { kind: "text"; lines: string[] }
  | { kind: "diff"; added: number; removed: number; lines: TabPreviewLine[] };
