import { AgentProvider } from "../types";

export type RemoveAgentAction = "delete" | "archive" | "unsupported";

export interface RemoveSessionResult {
  provider: AgentProvider;
  id: string;
  ok: boolean;
  method: string;
  error?: string;
}

export interface RemoveSessionOptions {
  /** When true, invoke the agent CLI or native store. When false, only hide in catalog. */
  applyToAgent: boolean;
}