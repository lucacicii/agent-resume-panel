import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AppSidebar } from "./AppSidebar";

const messages = {
  "desktop.nav.label": "Navigation",
  "desktop.nav.gtd": "GTD",
  "desktop.nav.notes": "Notes",
  "desktop.nav.collapse": "Collapse sidebar",
  "desktop.nav.expand": "Expand sidebar",
  "desktop.chrome.account": "Account",
  "desktop.top.settings": "Settings"
};

function renderSidebar({ view = "gtd" as "gtd" | "notes", collapsed = false } = {}) {
  const host = document.createElement("div");
  host.id = "react-nav";
  document.body.append(host);
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages }),
    onLocaleChanged: () => () => undefined
  } as unknown as typeof window.agentResume;
  const onViewChange = vi.fn();
  render(
    <I18nProvider>
      <AppSidebar view={view} onViewChange={onViewChange} collapsed={collapsed} />
    </I18nProvider>
  );
  return { onViewChange };
}

describe("AppSidebar", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.getElementById("react-nav")?.remove();
  });

  it("renders the two views and marks the active one current", async () => {
    renderSidebar({ view: "gtd" });
    const nav = await screen.findByRole("navigation", { name: "Navigation" });
    expect(nav).toBeTruthy();

    const gtd = screen.getByRole("button", { name: "GTD" });
    const notes = screen.getByRole("button", { name: "Notes" });
    expect(gtd.getAttribute("aria-current")).toBe("page");
    expect(notes.getAttribute("aria-current")).toBeNull();
  });

  it("switches the view when a row is clicked", async () => {
    const { onViewChange } = renderSidebar({ view: "gtd" });
    fireEvent.click(await screen.findByRole("button", { name: "Notes" }));
    expect(onViewChange).toHaveBeenCalledWith("notes");
  });

  it("collapses the rail when the window says so", async () => {
    renderSidebar({ view: "notes", collapsed: true });
    await screen.findByRole("navigation", { name: "Navigation" });
    const rail = document.querySelector(".app-sidebar");
    expect(rail?.classList.contains("is-collapsed")).toBe(true);
    expect(rail?.getAttribute("data-collapsed")).toBe("true");
    expect(screen.getByRole("button", { name: "Notes" }).getAttribute("aria-current")).toBe("page");
  });

  it("shows the gliding highlight while hovering a non-active row", async () => {
    renderSidebar({ view: "gtd" });
    const notesRow = await screen.findByRole("button", { name: "Notes" });
    const glide = document.querySelector<HTMLElement>(".app-sidebar-glide");
    expect(glide).toBeTruthy();
    expect(glide!.style.opacity).toBe("0");

    fireEvent.pointerEnter(notesRow);
    await waitFor(() => expect(glide!.style.opacity).toBe("1"));

    // Hovering the active row hands selection feedback back to its own fill.
    fireEvent.pointerEnter(screen.getByRole("button", { name: "GTD" }));
    await waitFor(() => expect(glide!.style.opacity).toBe("0"));
  });

  it("renders the account row pinned to the rail bottom, outside the nav", async () => {
    renderSidebar({ view: "gtd" });
    const account = await screen.findByRole("button", { name: "Account" });
    expect(account.getAttribute("aria-haspopup")).toBe("menu");
    // The account lives in the sidebar footer, not among the nav rows.
    expect(account.closest(".app-sidebar-footer")).toBeTruthy();
    expect(account.closest(".app-sidebar-nav")).toBeNull();
  });

  it("keeps the account row when the rail is collapsed", async () => {
    renderSidebar({ view: "gtd", collapsed: true });
    const account = await screen.findByRole("button", { name: "Account" });
    expect(account.closest(".app-sidebar.is-collapsed")).toBeTruthy();
  });

  it("opens Settings from the account menu", async () => {
    renderSidebar({ view: "gtd" });
    await screen.findByRole("button", { name: "Account" });

    const openSettingsWindow = vi.fn(async () => ({ ok: true }));
    const contextMenuShow = vi.fn(async (_args: { x: number; y: number; anchor?: string; items: Array<{ id?: string; label?: string }> }): Promise<string | null> => "settings");
    Object.assign(window.agentResume as unknown as Record<string, unknown>, { openSettingsWindow, contextMenuShow });

    fireEvent.click(screen.getByRole("button", { name: "Account" }));

    // The account menu is a native NSMenu: assert the payload the renderer sends —
    // the menu opens upward (bottom-anchored) from the rail-bottom row.
    await waitFor(() => expect(contextMenuShow).toHaveBeenCalled());
    const payload = contextMenuShow.mock.calls.at(-1)![0];
    expect(payload.anchor).toBe("bottom");
    expect(payload.items.find((item) => item.label === "Settings")?.id).toBe("settings");

    // Settings is its own window, so the menu asks the main process for it.
    await waitFor(() => expect(openSettingsWindow).toHaveBeenCalledWith({ pane: "general" }));
  });
});
