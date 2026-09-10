import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImSelectionAction } from "../../shared/imTypes";
import { SelectionActionResult } from "./SelectionActionResult";
import { SelectionSendMenu } from "./SelectionSendMenu";

const apiMocks = vi.hoisted(() => ({
  clipboardWriteText: vi.fn(),
  imListSelectionActions: vi.fn(),
  imRunSelectionAction: vi.fn(),
  workbenchSendSelection: vi.fn()
}));

const notifyDesktop = vi.hoisted(() => vi.fn());

vi.mock("../bridge", () => ({ desktopApi: () => apiMocks }));
vi.mock("../components/Notifications", () => ({ notifyDesktop }));
vi.mock("../i18n", () => ({
  useI18n: () => ({
    locale: "en",
    t: (key: string, ...args: Array<string | number>) => {
      if (key === "desktop.settings.newSessionTarget.cli:codex") return "Codex";
      if (args.length) return `${key}:${args.join(":")}`;
      return {
        "desktop.common.close": "Close",
        "desktop.common.copy": "Copy",
        "desktop.common.copied": "Copied",
        "desktop.im.actionRunning": "Working…",
        "desktop.im.explain": "Explain",
        "desktop.im.translate": "Translate",
        "desktop.notes.sendToAgent": "Send to Agent",
        "desktop.notes.sendToSession": "Send to Session"
      }[key] ?? key;
    }
  })
}));

function action(input: Partial<ImSelectionAction> & Pick<ImSelectionAction, "actionId" | "name">): ImSelectionAction {
  return {
    kind: "independent",
    prompt: "Use {selection}",
    sortOrder: 0,
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    ...input
  };
}

const actions: ImSelectionAction[] = [
  action({ actionId: "quote", name: "Quote", kind: "context", prompt: "" }),
  action({ actionId: "translate", name: "Translate" }),
  action({ actionId: "explain", name: "Explain" }),
  action({ actionId: "custom", name: "Custom Action" }),
  action({ actionId: "disabled", name: "Disabled Action", enabled: false })
];

beforeEach(() => {
  apiMocks.imListSelectionActions.mockResolvedValue(actions);
});

afterEach(() => {
  cleanup();
  window.innerWidth = 1024;
  window.innerHeight = 768;
  apiMocks.clipboardWriteText.mockClear();
  apiMocks.imListSelectionActions.mockClear();
  apiMocks.imRunSelectionAction.mockReset();
  apiMocks.workbenchSendSelection.mockClear();
  notifyDesktop.mockClear();
});

describe("SelectionSendMenu", () => {
  it("shows Copy, enabled independent actions, then send targets", async () => {
    const onClose = vi.fn();
    render(
      <SelectionSendMenu
        menu={{ x: 20, y: 20, text: "selected" }}
        onClose={onClose}
      />
    );

    await screen.findByRole("menuitem", { name: "Translate" });
    const labels = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(labels).toEqual(["Copy", "Translate", "Explain", "Custom Action", "Send to Agent", "Send to Session"]);
    expect(screen.queryByRole("menuitem", { name: "Quote" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Disabled Action" })).toBeNull();
  });

  it("copies the captured selection and closes the menu", () => {
    const onClose = vi.fn();
    render(
      <SelectionSendMenu
        menu={{ x: 20, y: 20, text: "selected text" }}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(apiMocks.clipboardWriteText).toHaveBeenCalledWith("selected text");
    expect(notifyDesktop).toHaveBeenCalledWith({ text: "Copied", kind: "ok" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("runs Translate, closes the menu, and shows loading then the result", async () => {
    let resolveRun!: (value: { text: string }) => void;
    apiMocks.imRunSelectionAction.mockImplementation(
      () => new Promise((resolve) => {
        resolveRun = resolve;
      })
    );
    const onClose = vi.fn();
    render(
      <SelectionSendMenu
        menu={{ x: 20, y: 20, text: "selected text" }}
        onClose={onClose}
      />
    );

    fireEvent.click(await screen.findByRole("menuitem", { name: "Translate" }));
    expect(apiMocks.imRunSelectionAction).toHaveBeenCalledWith({
      actionId: "translate",
      text: "selected text"
    });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Translate" })).toBeTruthy();
    expect(screen.getByText("Working…")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    resolveRun({ text: "translated text" });
    expect(await screen.findByText("translated text")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(apiMocks.clipboardWriteText).toHaveBeenCalledWith("translated text");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("reports action failures through notifications", async () => {
    apiMocks.imRunSelectionAction.mockRejectedValue(new Error("Model unavailable"));
    const onClose = vi.fn();
    render(
      <SelectionSendMenu
        menu={{ x: 20, y: 20, text: "selected text" }}
        onClose={onClose}
      />
    );

    fireEvent.click(await screen.findByRole("menuitem", { name: "Translate" }));
    await waitFor(() => expect(notifyDesktop).toHaveBeenCalledWith({
      text: "Model unavailable",
      kind: "error"
    }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the result popover inside the viewport", () => {
    window.innerWidth = 800;
    window.innerHeight = 600;
    render(
      <SelectionActionResult
        result={{ x: 790, y: 590, title: "Translate", text: "translated text", loading: false }}
        onClose={vi.fn()}
        onCopy={vi.fn()}
      />
    );

    const popover = screen.getByRole("dialog", { name: "Translate" });
    expect(popover.style.left).toBe("432px");
    expect(popover.style.top).toBe("272px");
  });
});
