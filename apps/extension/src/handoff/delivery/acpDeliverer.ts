import { createAcpChatSession } from "../../acp/newSession";
import { updateAcpRecord } from "../../acp/store";
import { isAcpHandoffTarget } from "../targets";
import { HandoffDeliverer } from "./types";

export const acpHandoffDeliverer: HandoffDeliverer = {
  channel: "acp",

  canDeliver(input) {
    return isAcpHandoffTarget(input.targetProvider);
  },

  async deliver(input, deps) {
    if (!isAcpHandoffTarget(input.targetProvider)) {
      throw new Error(`${input.targetProvider} does not support ACP handoff delivery.`);
    }

    const sourceTitle =
      input.source.kind === "cli" ? input.source.session.title : input.source.record.title;
    const record = await createAcpChatSession(input.projectPath, input.targetProvider);
    record.title = `Handoff: ${sourceTitle}`;
    record.updatedAt = Date.now();
    await updateAcpRecord(deps.panelHome, record);
    deps.acpChatManager.open(record, { initialPrompt: input.composedMessage });

    return {
      channel: "acp",
      detail: record.id
    };
  }
};