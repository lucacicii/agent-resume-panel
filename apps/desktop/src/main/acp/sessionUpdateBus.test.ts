import { afterEach, describe, expect, it } from "vitest";
import {
  clearAllSessionUpdateListeners,
  clearSessionUpdateListeners,
  publishSessionUpdate,
  subscribeSessionUpdates
} from "./sessionUpdateBus";

afterEach(() => {
  clearAllSessionUpdateListeners();
});

describe("session update bus", () => {
  it("replays commands published before the session listener is attached", () => {
    publishSessionUpdate({
      sessionId: "chat-1",
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "review", description: "Review changes" }]
      }
    });

    const received: string[] = [];
    const unsubscribe = subscribeSessionUpdates("chat-1", (payload) => {
      received.push(payload.update.sessionUpdate);
    });

    expect(received).toEqual(["available_commands_update"]);
    unsubscribe();
  });

  it("drops cached commands when a session is cleared", () => {
    publishSessionUpdate({
      sessionId: "chat-1",
      update: { sessionUpdate: "available_commands_update", availableCommands: [] }
    });
    clearSessionUpdateListeners("chat-1");

    const received: string[] = [];
    subscribeSessionUpdates("chat-1", (payload) => {
      received.push(payload.update.sessionUpdate);
    });

    expect(received).toEqual([]);
  });
});
