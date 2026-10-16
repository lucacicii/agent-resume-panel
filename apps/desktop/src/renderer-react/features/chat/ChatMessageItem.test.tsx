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
