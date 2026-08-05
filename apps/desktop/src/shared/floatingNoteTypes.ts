export interface FloatingSessionNoteTarget {
  provider: string;
  sessionId: string;
  projectPath: string;
  projectName?: string;
  sessionTitle: string;
}

export interface FloatingNoteWindowTarget extends FloatingSessionNoteTarget {
  /** Stable key used by the main process to reuse one window per session. */
  windowKey: string;
}
