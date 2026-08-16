import { AgentSession } from "../types";
import { RenameHomes } from "../rename";

export interface PreviewMessage {
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  timestamp?: string;
}

export interface SessionPreviewResult {
  title: string;
  messages: PreviewMessage[];
  truncated?: boolean;
  warning?: string;
}

export type PreviewHomes = RenameHomes;

export const MAX_PREVIEW_MESSAGES = 100;

export type PreviewLoader = (session: AgentSession, homes: PreviewHomes) => Promise<SessionPreviewResult>;