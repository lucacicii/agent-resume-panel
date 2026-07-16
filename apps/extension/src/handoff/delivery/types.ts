import { AcpChatManager } from "../../acp/acpChatManager";
import { HandoffDeliveryChannel, HandoffDeliveryInput, HandoffDeliveryResult } from "../types";

export interface HandoffDeliverer {
  readonly channel: HandoffDeliveryChannel;
  canDeliver(input: HandoffDeliveryInput): boolean;
  deliver(input: HandoffDeliveryInput, deps: HandoffDelivererDeps): Promise<HandoffDeliveryResult>;
}

export interface HandoffDelivererDeps {
  acpChatManager: AcpChatManager;
  panelHome: string;
  extensionContext?: import("vscode").ExtensionContext;
}