import { deliverHandoffToAlma } from "../../terminal/almaApp";
import { HandoffDeliverer } from "./types";

export const almaHandoffDeliverer: HandoffDeliverer = {
  channel: "alma",

  canDeliver(input) {
    return input.targetProvider === "alma";
  },

  async deliver(input) {
    const rawTitle =
      input.source.kind === "cli" ? input.source.session.title : input.source.record.title;
    const baseTitle = rawTitle.replace(/\s+/g, " ").trim().slice(0, 68) || "Session";
    const threadId = await deliverHandoffToAlma({
      title: `Handoff: ${baseTitle}`,
      projectPath: input.projectPath,
      message: input.composedMessage
    });

    return {
      channel: "alma",
      detail: threadId
    };
  }
};
