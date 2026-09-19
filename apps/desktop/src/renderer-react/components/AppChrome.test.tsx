import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AppChrome } from "./AppChrome";

function renderChrome(options?: {
  standaloneNoteList?: Array<{ noteId: string; title: string }>;
}) {
  let notesChangedHandler: ((notes: Array<{ noteId: string; title: string }>) => void) | undefined;
  const standaloneNoteOpen = vi.fn(async () => ({ ok: true as const }));
  const standaloneNoteList = vi.fn(async () => options?.standaloneNoteList ?? []);
  window.agentResume = {
    getI18nBundle: async () => ({
      locale: "en",
      messages: {
        "desktop.notes.floatingDots": "Floating notes",
        "desktop.chrome.account": "Account",
        "desktop.top.settings": "Settings"
      }
    }),
    onLocaleChanged: () => () => undefined,
    standaloneNoteList,
    onStandaloneNotesChanged: (callback: (notes: Array<{ noteId: string; title: string }>) => void) => {
      notesChangedHandler = callback;
      return () => undefined;
    },
    standaloneNoteOpen
  } as unknown as typeof window.agentResume;

  render(
    <I18nProvider>
      <AppChrome />
    </I18nProvider>
  );
  return {
    pushNoteDots: (notes: Array<{ noteId: string; title: string }>) => notesChangedHandler?.(notes),
    standaloneNoteOpen,
    standaloneNoteList
  };
}

describe("AppChrome", () => {
  afterEach(() => cleanup());

  it("renders the header chrome without a primary-tab rail", async () => {
    renderChrome();
    expect(await screen.findByRole("button", { name: "Account" })).toBeTruthy();
    expect(document.querySelector(".app-nav-rail")).toBeNull();
    expect(document.querySelector(".session-dots-cluster")).toBeNull();
    expect(document.getElementById("app-header-slot")).not.toBeNull();
  });

  it("renders a floating-note dot per open note and opens it in a standalone window", async () => {
    const { standaloneNoteOpen, pushNoteDots } = renderChrome({
      standaloneNoteList: [{ noteId: "n1", title: "Scratch pad" }]
    });
    expect(await screen.findByRole("button", { name: "Account" })).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll(".app-note-dot-btn").length).toBe(1));

    const noteDot = document.querySelector<HTMLButtonElement>(".app-note-dot-btn");
    expect(noteDot?.getAttribute("aria-label")).toBe("Scratch pad");
    fireEvent.click(noteDot!);
    await waitFor(() => expect(standaloneNoteOpen).toHaveBeenCalledWith({ noteId: "n1" }));

    await act(async () => { pushNoteDots([]); });
    expect(document.querySelectorAll(".app-note-dot-btn").length).toBe(0);
  });

  it("updates floating note dots when the open-notes list changes", async () => {
    const { pushNoteDots } = renderChrome();
    await screen.findByRole("button", { name: "Account" });
    expect(document.querySelectorAll(".app-note-dot-btn").length).toBe(0);

    await act(async () => {
      pushNoteDots([
        { noteId: "a", title: "Alpha note" },
        { noteId: "b", title: "Beta note" }
      ]);
    });
    const dots = [...document.querySelectorAll<HTMLButtonElement>(".app-note-dot-btn")];
    expect(dots.map((dot) => dot.getAttribute("aria-label"))).toEqual(["Alpha note", "Beta note"]);
  });

  it("opens Settings from the account menu", async () => {
    renderChrome();
    await screen.findByRole("button", { name: "Account" });

    const openSettingsWindow = vi.fn(async () => ({ ok: true }));
    (window.agentResume as unknown as { openSettingsWindow: typeof openSettingsWindow }).openSettingsWindow = openSettingsWindow;

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    const settingsItem = await screen.findByRole("menuitem", { name: "Settings" });
    fireEvent.click(settingsItem);

    // Settings is its own window, so the menu asks the main process for it.
    await waitFor(() => expect(openSettingsWindow).toHaveBeenCalledWith({ pane: "general" }));
    // The menu stays mounted while its exit animation runs.
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Settings" })).toBeNull());
  });
});
