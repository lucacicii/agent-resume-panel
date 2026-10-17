import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { WorktreeSelector } from "./GitGraphView";
import type { CheckoutOption } from "./useTaskWorktrees";

const MESSAGES = {
  "desktop.workbench.worktreeMainCheckout": "Main checkout",
  "desktop.workbench.worktreePin": "Pin this panel to a checkout",
  "desktop.workbench.worktreeUnpin": "Unpin",
  "desktop.workbench.worktreePinned": "Pinned to {0}"
};

/** The native menu answers with the id of the item that was clicked. */
let chosen: string | null = null;
let menu: Array<{ id?: string; label?: string; checked?: boolean; enabled?: boolean }> = [];

function installBridge() {
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages: MESSAGES }),
    onLocaleChanged: () => () => undefined,
    contextMenuShow: async (args: { items: typeof menu }) => {
      menu = args.items;
      return chosen;
    }
  } as unknown as typeof window.agentResume;
}

function option(path: string, repoRoot: string, branch: string, isMain = false): CheckoutOption {
  return { path, repoRoot, repoLabel: repoRoot.split("/").at(-1) || repoRoot, branchLabel: branch, isMain, merged: false };
}

const MAIN = option("/work/app", "/work/app", "main", true);
const FEAT = option("/wt/app-feat-x", "/work/app", "feat/x");

async function renderSelector(options: CheckoutOption[], selected: string | null, pinned = false) {
  const onSelect = vi.fn();
  const onPin = vi.fn();
  const onUnpin = vi.fn();
  const view = render(
    <WorktreeSelector
      checkouts={options}
      checkoutFor={() => selected}
      scope="git"
      pinned={pinned}
      ariaLabel="Checkout"
      onSelect={onSelect}
      onPin={onPin}
      onUnpin={onUnpin}
    />,
    { wrapper: I18nProvider }
  );
  // The provider loads its bundle in an effect; without this the assertions read
  // raw keys instead of the strings a person sees.
  await act(async () => { await Promise.resolve(); });
  return { ...view, onSelect, onPin, onUnpin };
}

afterEach(() => {
  cleanup();
  chosen = null;
  menu = [];
  vi.restoreAllMocks();
});

describe("WorktreeSelector", () => {
  it("stays out of the way until there is something to choose", async () => {
    installBridge();
    const { container } = await renderSelector([MAIN], null);
    expect(container.childElementCount).toBe(0);
  });

  it("names the checkout it shows, and offers every one of them", async () => {
    installBridge();
    chosen = "c0-1";
    const { onSelect } = await renderSelector([MAIN, FEAT], FEAT.path);
    fireEvent.click(screen.getByRole("button", { name: "Checkout: feat/x" }));

    await waitFor(() => expect(menu.length).toBe(2));
    expect(menu.map((item) => item.label)).toEqual(["Main checkout", "⌥ feat/x"]);
    expect(menu.map((item) => item.checked)).toEqual([false, true]);
    // Choosing the worktree diverts the repository it belongs to.
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("/work/app", FEAT.path));
  });

  it("pins and unpins the pane it belongs to", async () => {
    installBridge();
    const loose = await renderSelector([MAIN, FEAT], null);
    fireEvent.click(screen.getByRole("button", { name: "Pin this panel to a checkout" }));
    expect(loose.onPin).toHaveBeenCalled();
    expect(loose.onUnpin).not.toHaveBeenCalled();

    cleanup();
    const pinned = await renderSelector([MAIN, FEAT], null, true);
    const toggle = screen.getByRole("button", { name: "Unpin" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(pinned.onUnpin).toHaveBeenCalled();
    expect(pinned.onPin).not.toHaveBeenCalled();
  });

  it("groups the menu by repository when a task references more than one", async () => {
    installBridge();
    const lib = option("/work/lib", "/work/lib", "main", true);
    await renderSelector([MAIN, FEAT, lib], FEAT.path);
    fireEvent.click(screen.getByRole("button", { name: "Checkout: feat/x" }));
    await waitFor(() => expect(menu.length).toBeGreaterThan(3));
    expect(menu.filter((item) => item.enabled === false).map((item) => item.label)).toEqual(["app", "lib"]);
  });
});
