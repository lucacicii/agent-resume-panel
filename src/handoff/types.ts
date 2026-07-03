import { AgentProvider, AgentSession } from "../history";
import { AcpAgentProvider, AcpSessionRecord } from "../acp/types";
import { PreviewMessage } from "../history/preview/types";

export type HandoffTargetProvider = Extract<
  AgentProvider,
  "codex" | "claude" | "agy" | "grok" | "opencode" | "pi"
>;

export type HandoffAcpTargetProvider = AcpAgentProvider;

export type HandoffDeliveryChannel = "acp" | "cli" | "clipboard";

export type HandoffSource =
  | { kind: "cli"; session: AgentSession }
  | { kind: "acp"; record: AcpSessionRecord };

export interface HandoffSessionContext {
  sourceKind: HandoffSource["kind"];
  sourceProvider: string;
  sessionId: string;
  title: string;
  projectPath: string;
  model?: string;
  branch?: string;
  messages: PreviewMessage[];
  truncated: boolean;
  truncationWarning?: string;
}

export interface HandoffBrief {
  body: string;
  truncated: boolean;
}

export interface HandoffDeliveryInput {
  source: HandoffSource;
  targetProvider: HandoffTargetProvider;
  projectPath: string;
  composedMessage: string;
  handoffFilePath?: string;
}

export interface HandoffDeliveryResult {
  channel: HandoffDeliveryChannel;
  detail?: string;
}

export interface HandoffResult {
  targetProvider: HandoffTargetProvider;
  delivery: HandoffDeliveryResult;
  composedMessage: string;
}

export interface RunHandoffOptions {
  deliveryChannel?: HandoffDeliveryChannel;
  panelHome: string;
}