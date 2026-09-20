import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AppSidebar } from "./AppSidebar";

const messages = {
  "desktop.nav.label": "Navigation",
  "desktop.nav.gtd": "GTD",
  "desktop.nav.notes": "Notes",
  "desktop.nav.collapse": "Collapse sidebar",
  "desktop.nav.expand": "Expand sidebar"
};

function renderSidebar({ view = "gtd" as "gtd" | "notes" } = {}) {
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
      <AppSidebar view={view} onViewChange={onViewChange} />
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

  it("collapses, persists, and expands the rail", async () => {
    renderSidebar({ view: "gtd" });
    const collapse = await screen.findByRole("button", { name: "Collapse sidebar" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(collapse);
    await waitFor(() => {
      expect(document.querySelector(".app-sidebar")?.classList.contains("is-collapsed")).toBe(true);
      expect(localStorage.getItem("board-nav-collapsed")).toBe("1");
    });
    const expand = screen.getByRole("button", { name: "Expand sidebar" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(expand);
    await waitFor(() => {
      expect(document.querySelector(".app-sidebar")?.classList.contains("is-collapsed")).toBe(false);
      expect(localStorage.getItem("board-nav-collapsed")).toBe("0");
    });
  });

  it("restores the collapsed state from storage on mount", async () => {
    localStorage.setItem("board-nav-collapsed", "1");
    renderSidebar({ view: "notes" });
    const rail = await waitFor(() => {
      const node = document.querySelector(".app-sidebar");
      expect(node).toBeTruthy();
      return node!;
    });
    expect(rail.classList.contains("is-collapsed")).toBe(true);
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
});
