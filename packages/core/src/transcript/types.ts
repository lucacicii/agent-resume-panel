import { AgentSession } from "../catalog/types";

export interface PreviewMessage {
  role: "user" | "assistant";
  text: string;
  timestamp?: string;
}

export interface SessionPreviewResult {
  title: string;
  messages: PreviewMessage[];
  truncated?: boolean;
  warning?: string;
}

export interface PreviewHomes {
  panelHome: string;
  codexHome: string;
  claudeHome: string;
  antigravityHome: string;
  grokHome: string;
  opencodeHome: string;
  piHome: string;
  primeHome: string;
  cursorHome: string;
  cursorIdeUserDataHome: string;
}

export const MAX_PREVIEW_MESSAGES = 100;

export type PreviewLoader = (session: AgentSession, homes: PreviewHomes) => Promise<SessionPreviewResult>;
