import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startModalOpenReporter } from "./shortcutModalReporter";

/** Yield a macrotask so pending MutationObserver microtasks flush. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("shortcutModalReporter", () => {
  let setModalOpen: ReturnType<typeof vi.fn>;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    setModalOpen = vi.fn();
    window.agentResume = { setModalOpen } as unknown as typeof window.agentResume;
    stop = startModalOpenReporter();
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    delete (window as { agentResume?: unknown }).agentResume;
  });

  it("reports initial false and tracks aria-modal dialogs", async () => {
    expect(setModalOpen).toHaveBeenLastCalledWith(false);

    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    await flush();
    expect(setModalOpen).toHaveBeenLastCalledWith(true);

    modal.remove();
    await flush();
    expect(setModalOpen).toHaveBeenLastCalledWith(false);
  });

  it("ignores the floating note (role=dialog without aria-modal)", async () => {
    const calls = setModalOpen.mock.calls.length;
    const note = document.createElement("section");
    note.setAttribute("role", "dialog");
    document.body.appendChild(note);
    await flush();
    expect(setModalOpen.mock.calls.length).toBe(calls);
    note.remove();
    await flush();
  });

  it("does not double-observe on repeated start (StrictMode)", async () => {
    const stop2 = startModalOpenReporter();
    const callsBefore = setModalOpen.mock.calls.length;
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    await flush();
    expect(setModalOpen.mock.calls.length).toBe(callsBefore + 1);
    modal.remove();
    await flush();
    expect(setModalOpen.mock.calls.at(-1)).toEqual([false]);
    stop2();
  });
});
