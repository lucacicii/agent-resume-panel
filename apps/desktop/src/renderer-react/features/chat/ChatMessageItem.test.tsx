import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ChatMessageItem } from "./ChatMessageItem";

const CLIPBOARD_PATH = "/var/folders/jg/xxx/T/agent-resume-clipboard-terminal-1.png";

describe("ChatMessageItem clipboard paths", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps a bare pasted path as text on a user row", () => {
    const { container } = render(
      <ChatMessageItem
        message={{ role: "user", content: `run ${CLIPBOARD_PATH} now` }}
      />
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(CLIPBOARD_PATH);
  });

  it("still promotes a bare pasted path on an assistant row", () => {
    const { container } = render(
      <ChatMessageItem
        message={{ role: "assistant", content: `see ${CLIPBOARD_PATH}` }}
      />
    );
    const img = container.querySelector("img") as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBe(`file://${CLIPBOARD_PATH}`);
  });
});

describe("ChatMessageItem chronological timeline", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders multi-turn reasoning and tools in strict chronological order", () => {
    const { container } = render(
      <ChatMessageItem
        message={{
          role: "assistant",
          content: "Final conclusion here",
          turns: [
            {
              turn: 1,
              status: "done",
              toolCount: 1,
              startedAtMs: 1000,
              durationMs: 400,
              segments: [
                { kind: "reasoning", text: "THINKING_STEP_1" },
                {
                  kind: "tools",
                  tools: [
                    {
                      toolCallId: "c1",
                      name: "read_file",
                      arguments: { path: "src/first.ts" }
                    }
                  ]
                }
              ]
            },
            {
              turn: 2,
              status: "done",
              toolCount: 1,
              startedAtMs: 1500,
              durationMs: 800,
              segments: [
                { kind: "reasoning", text: "THINKING_STEP_2" },
                {
                  kind: "tools",
                  tools: [
                    {
                      toolCallId: "c2",
                      name: "bash",
                      arguments: { command: "pnpm test" }
                    }
                  ]
                }
              ]
            }
          ]
        }}
      />
    );

    // Assistant container has spine styling
    expect(container.querySelector(".tb-message-row.is-assistant .tb-message-container")).toBeTruthy();

    // Chronological turn nodes rendered in sequence
    const stepNodes = container.querySelectorAll(".tb-timeline-turn-block");
    expect(stepNodes.length).toBe(2);

    expect(stepNodes[0].querySelector(".tb-timeline-turn-title")?.textContent).toBe("Step 1");
    expect(stepNodes[0].querySelector(".tb-timeline-turn-time")?.textContent).toBe("0.4s");
    expect(stepNodes[0].textContent).toContain("Read first.ts");

    expect(stepNodes[1].querySelector(".tb-timeline-turn-title")?.textContent).toBe("Step 2");
    expect(stepNodes[1].querySelector(".tb-timeline-turn-time")?.textContent).toBe("0.8s");
    expect(stepNodes[1].textContent).toContain("Run pnpm test");

    // Chronological position: Step 1 precedes Step 2
    expect(
      stepNodes[0].compareDocumentPosition(stepNodes[1]) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
