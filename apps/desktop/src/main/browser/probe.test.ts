import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { buildBrowserProbeScript, isProbeMessage, parseProbeMessage, type BrowserProbeMessage } from "./probe";

const inspectPayload = {
  tagName: "div",
  selector: "div.card",
  textSnippet: "Total",
  rect: { top: 1, left: 2, width: 3, height: 4 }
};

describe("isProbeMessage", () => {
  it("claims only the probe protocol prefixes", () => {
    expect(isProbeMessage("__AR_INSPECT_RESULT__{}")).toBe(true);
    expect(isProbeMessage("__AR_MARKUP_RESULT__{}")).toBe(true);
    expect(isProbeMessage("__AR_INSPECT_CANCELLED__")).toBe(true);
    expect(isProbeMessage("boom")).toBe(false);
    expect(isProbeMessage("__PROTOTYPE_INSPECT_RESULT__{}")).toBe(false);
  });
});

describe("parseProbeMessage", () => {
  it("reads an inspect payload", () => {
    const parsed = parseProbeMessage(`__AR_INSPECT_RESULT__${JSON.stringify(inspectPayload)}`);
    expect(parsed).toEqual({ kind: "inspect", target: inspectPayload });
  });

  it("reads a markup payload", () => {
    const markup = { id: "b1", note: "orange", rect: { left: 0, top: 0, width: 30, height: 30 }, target: null };
    expect(parseProbeMessage(`__AR_MARKUP_RESULT__${JSON.stringify(markup)}`)).toEqual({ kind: "markup", markup });
  });

  it("reads a cancellation", () => {
    expect(parseProbeMessage("__AR_INSPECT_CANCELLED__")).toEqual({ kind: "cancelled" });
  });

  it("ignores page logs and truncated payloads", () => {
    expect(parseProbeMessage("console.error: boom")).toBeNull();
    expect(parseProbeMessage("__AR_INSPECT_RESULT__{\"tagName\":\"di")).toBeNull();
  });
});

/**
 * The script itself is a thousand-line string: nothing but running it proves the
 * payload prefix, the DOM ids and the renderer-supplied copy line up with the
 * parser above.
 */
const STRINGS = {
  dialogTitle: "ANNOTATE-HERE",
  dialogHint: "HINT",
  dialogDefaultNote: "DEFAULT-NOTE",
  overlayTip: "OVERLAY-TIP",
  noTarget: "NO-TARGET",
  cancel: "CANCEL",
  confirm: "OK"
};

const RECT = { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 } as DOMRect;

type ProbeHandle = {
  setMode: (mode: string) => void;
  clearMarkups: (id?: string | null) => boolean;
  setInputPassthrough: (passthrough: boolean) => void;
};

declare global {
  interface Window {
    /** Defined by the injected script itself, so it only exists after `install()`. */
    __AR_BROWSER_PROBE__?: ProbeHandle;
    __AR_BROWSER_PROBE_INITIALIZED__?: boolean;
  }
}

let logged: string[] = [];
let logSpy: MockInstance | null = null;

function probe(): ProbeHandle {
  const handle = window.__AR_BROWSER_PROBE__;
  if (!handle) throw new Error("probe script is not installed");
  return handle;
}

/** Installs a fresh copy of the script; each copy keeps its own listeners and state. */
function install(): void {
  window.__AR_BROWSER_PROBE__?.setMode("off");
  delete window.__AR_BROWSER_PROBE_INITIALIZED__;
  delete window.__AR_BROWSER_PROBE__;
  document.body.innerHTML = "";
  logged = [];
  logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logged.push(String(args[0]));
  });
  new Function(buildBrowserProbeScript(STRINGS))();
}

function probeMessage(prefix: string): BrowserProbeMessage | null {
  const message = logged.find((entry) => entry.startsWith(prefix));
  return message ? parseProbeMessage(message) : null;
}

describe("the injected probe script", () => {
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = () => RECT;
  });

  afterEach(() => {
    logSpy?.mockRestore();
    logSpy = null;
  });

  it("reports the picked element on the inspect protocol", () => {
    install();
    expect(isProbeMessage(logged[0] ?? "")).toBe(false);

    const el = document.createElement("div");
    el.className = "card";
    document.body.appendChild(el);
    probe().setMode("inspect");
    el.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5, bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { clientX: 5, clientY: 5, bubbles: true }));

    const parsed = probeMessage("__AR_INSPECT_RESULT__");
    expect(parsed).toMatchObject({
      kind: "inspect",
      target: { tagName: "div", className: "card", selector: "div.card", framework: "native-dom", rect: { width: 100 } }
    });
    expect(document.querySelector("#__ar_highlight_box__")).not.toBeNull();
    expect(document.querySelector("#__ar_highlight_box__ #__ar_badge__")).not.toBeNull();
    expect(document.querySelector("#__prototype_highlight_box__")).toBeNull();
  });

  it("reports a cancellation on ESC", () => {
    install();
    probe().setMode("inspect");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(probeMessage("__AR_INSPECT_CANCELLED__")).toEqual({ kind: "cancelled" });
  });

  it("renders the annotations dialog in the caller's language and clears drawn boxes", () => {
    install();
    probe().setMode("markup");
    const overlay = document.querySelector("#__ar_markup_overlay__") as HTMLElement;
    expect(overlay.textContent).toContain(STRINGS.overlayTip);

    overlay.dispatchEvent(new MouseEvent("mousedown", { clientX: 10, clientY: 10, bubbles: true }));
    overlay.dispatchEvent(new MouseEvent("mousemove", { clientX: 120, clientY: 120, bubbles: true }));
    overlay.dispatchEvent(new MouseEvent("mouseup", { clientX: 120, clientY: 120, bubbles: true }));

    const dialog = document.querySelector("#__ar_markup_dialog__") as HTMLElement;
    expect(dialog.textContent).toContain(STRINGS.dialogTitle);
    const input = dialog.querySelector("textarea") as HTMLTextAreaElement;
    expect(input.value).toBe(STRINGS.dialogDefaultNote);
    input.value = "an orange background";
    (dialog.querySelectorAll("button")[1] as HTMLButtonElement).click();

    expect(probeMessage("__AR_MARKUP_RESULT__")).toMatchObject({
      kind: "markup",
      markup: { note: "an orange background", target: null }
    });
    expect(overlay.textContent).toContain(STRINGS.noTarget);
    expect(overlay.querySelectorAll("div[data-proto-box-id]").length).toBe(1);
    expect(probe().clearMarkups(null)).toBe(true);
    expect(overlay.querySelectorAll("div[data-proto-box-id]").length).toBe(0);
  });

  it("stands the annotation overlay aside for synthetic input without dropping annotations", () => {
    install();
    probe().setMode("markup");
    const overlay = document.querySelector("#__ar_markup_overlay__") as HTMLElement;
    overlay.dispatchEvent(new MouseEvent("mousedown", { clientX: 10, clientY: 10, bubbles: true }));
    overlay.dispatchEvent(new MouseEvent("mousemove", { clientX: 120, clientY: 120, bubbles: true }));
    overlay.dispatchEvent(new MouseEvent("mouseup", { clientX: 120, clientY: 120, bubbles: true }));
    const dialog = document.querySelector("#__ar_markup_dialog__") as HTMLElement;
    const input = dialog.querySelector("textarea") as HTMLTextAreaElement;
    input.value = "keep me";
    (dialog.querySelectorAll("button")[1] as HTMLButtonElement).click();
    expect(overlay.querySelectorAll("div[data-proto-box-id]").length).toBe(1);

    probe().setInputPassthrough(true);
    expect(overlay.style.display).toBe("none");
    expect(overlay.querySelectorAll("div[data-proto-box-id]").length).toBe(1);

    probe().setInputPassthrough(false);
    expect(overlay.style.display).toBe("block");
    expect(overlay.querySelectorAll("div[data-proto-box-id]").length).toBe(1);
  });
});
