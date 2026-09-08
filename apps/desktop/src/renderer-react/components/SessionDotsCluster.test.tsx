import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionDotsCluster, sessionDotLabel, sessionDotStatusClass } from "./SessionDotsCluster";
import type { ActiveSessionDot } from "../features/workbench/activeSessionDots";

const TEXT: Record<string, string> = {
  "desktop.workbench.sessionDots": "Active sessions",
  "desktop.workbench.sessionDotsOpenPet": "Open session dots window",
  "desktop.workbench.sessionDot.awaiting": "Waiting for you",
  "desktop.workbench.sessionDot.possiblyAwaiting": "May need attention",
  "desktop.workbench.sessionDot.running": "Running",
  "desktop.workbench.sessionDot.connecting": "Connecting",
  "desktop.workbench.sessionDot.error": "Error"
};

function text(key: string, fallback: string): string {
  return TEXT[key] ?? fallback;
}

const SAMPLE: ActiveSessionDot[] = [
  { paneKey: "terminal:1", projectPath: "/p", title: "Alpha", sessionKey: "cli:a", status: "open" },
  {
    paneKey: "acp:await",
    projectPath: "/p",
    title: "Needs you",
    sessionKey: "chat:await",
    status: "awaiting_user",
    awaitingConfidence: "confirmed"
  },
  { paneKey: "terminal:run", projectPath: "/p", title: "Busy", sessionKey: "cli:run", status: "running" }
];

describe("sessionDotStatusClass", () => {
  it("maps awaiting_user to is-awaiting and leaves open empty", () => {
    expect(sessionDotStatusClass("open")).toBe("");
    expect(sessionDotStatusClass("awaiting_user")).toBe(" is-awaiting");
    expect(sessionDotStatusClass("running")).toBe(" is-running");
  });
});

describe("sessionDotLabel", () => {
  it("appends a status suffix when the session is not idle", () => {
    expect(sessionDotLabel(SAMPLE[0], text)).toBe("Alpha");
    expect(sessionDotLabel(SAMPLE[1], text)).toBe("Needs you · Waiting for you");
  });
});

describe("SessionDotsCluster", () => {
  afterEach(() => cleanup());

  it("renders nothing when there are no dots", () => {
    const { container } = render(<SessionDotsCluster dots={[]} text={text} onFocus={() => undefined} />);
    expect(container.querySelector(".session-dots-cluster")).toBeNull();
  });

  it("renders one button per session and reports the cluster label", () => {
    render(<SessionDotsCluster dots={SAMPLE} text={text} onFocus={() => undefined} />);
    const cluster = document.querySelector(".session-dots-cluster");
    expect(cluster?.getAttribute("aria-label")).toBe("Active sessions");
    expect(document.querySelectorAll(".session-dot-btn")).toHaveLength(3);
    expect(document.querySelector(".session-dots-heading")).not.toBeNull();
  });

  it("applies status classes and focuses a session on click", () => {
    const onFocus = vi.fn();
    render(<SessionDotsCluster dots={SAMPLE} text={text} onFocus={onFocus} />);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".session-dot-btn")];
    expect(buttons[1].querySelector(".session-dot")?.classList.contains("is-awaiting")).toBe(true);
    expect(buttons[2].querySelector(".session-dot")?.classList.contains("is-running")).toBe(true);
    fireEvent.click(buttons[2]);
    expect(onFocus).toHaveBeenCalledWith(SAMPLE[2]);
  });

  it("shows a tooltip with the full title on hover", async () => {
    render(<SessionDotsCluster dots={SAMPLE} text={text} onFocus={() => undefined} />);
    const first = document.querySelector<HTMLButtonElement>(".session-dot-btn");
    expect(first?.getAttribute("aria-label")).toBe("Alpha");
    fireEvent.mouseOver(first!);
    expect((await screen.findByRole("tooltip")).textContent).toBe("Alpha");
  });

  it("can hide the heading", () => {
    render(<SessionDotsCluster dots={SAMPLE} text={text} onFocus={() => undefined} heading={false} />);
    expect(document.querySelector(".session-dots-heading")).toBeNull();
    expect(document.querySelectorAll(".session-dot-btn")).toHaveLength(3);
  });

  it("uses a native title instead of a portal tooltip when requested", () => {
    render(<SessionDotsCluster dots={SAMPLE} text={text} onFocus={() => undefined} heading={false} nativeTitle />);
    const first = document.querySelector<HTMLButtonElement>(".session-dot-btn");
    expect(first?.getAttribute("title")).toBe("Alpha");
    fireEvent.mouseOver(first!);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

});
