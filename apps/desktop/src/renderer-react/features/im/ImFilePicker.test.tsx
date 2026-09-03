import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { ImFilePicker, type ImFilePickerHandle } from "./ImFilePicker";
import { formatImHashPath, imHashTokenAtCursor, splitImHashQuery, type Translate } from "./imUtils";

const t: Translate = (key, ...args) => {
  const messages: Record<string, string> = {
    "desktop.im.filePickerLabel": "Insert file or folder",
    "desktop.im.filePickerLoading": "Loading…",
    "desktop.im.filePickerError": "Failed to load: {0}",
    "desktop.im.filePickerEmpty": "No matches",
    "desktop.im.filePickerSearchResults": "Search results",
    "desktop.im.filePickerSelectDir": "Select this folder",
    "desktop.im.filePickerUp": "Parent folder"
  };
  let out = messages[key] ?? key;
  args.forEach((arg, index) => {
    out = out.replace(`{${index}}`, String(arg));
  });
  return out;
};

const workbenchListDirectory = vi.fn();
const workbenchSearchPaths = vi.fn();

type PickerHarness = {
  handle: { current: ImFilePickerHandle | null };
  textarea: HTMLTextAreaElement;
  lastConsumed: () => boolean | undefined;
};

/** Harness wiring the picker's imperative keyboard surface to a textarea, mirroring ImComposer. */
function renderPicker(options: {
  query: string;
  onNavigate?: ReturnType<typeof vi.fn>;
  onSelect?: ReturnType<typeof vi.fn>;
  onDismiss?: ReturnType<typeof vi.fn>;
}): PickerHarness {
  const handle = createRef<ImFilePickerHandle>();
  const consumed: boolean[] = [];
  const { getByRole } = render(
    <>
      <textarea
        aria-label="harness"
        onKeyDown={(event) => {
          consumed.push(Boolean(handle.current?.handleKeyDown(event)));
        }}
        onChange={() => undefined}
      />
      <ImFilePicker
        ref={handle}
        projectPath="/work/app"
        query={options.query}
        onNavigate={options.onNavigate ?? (() => undefined)}
        onSelect={options.onSelect ?? (() => undefined)}
        onDismiss={options.onDismiss ?? (() => undefined)}
        t={t}
      />
    </>
  );
  return {
    handle,
    textarea: getByRole("textbox") as HTMLTextAreaElement,
    lastConsumed: () => consumed.at(-1)
  };
}

describe("imHashTokenAtCursor", () => {
  it("detects a trailing token at the cursor", () => {
    expect(imHashTokenAtCursor("see #src/comp", 13)).toEqual({ start: 4, query: "src/comp" });
  });

  it("ignores text without # or with whitespace after #", () => {
    expect(imHashTokenAtCursor("hello", 5)).toBeNull();
    expect(imHashTokenAtCursor("plain # tag", 8)).toBeNull();
  });

  it("rejects a second # inside the token", () => {
    expect(imHashTokenAtCursor("#a#b", 4)).toBeNull();
  });

  it("does not match when the cursor sits before the #", () => {
    expect(imHashTokenAtCursor("#src", 0)).toBeNull();
  });
});

describe("splitImHashQuery", () => {
  it("splits dir part and filter", () => {
    expect(splitImHashQuery("src/comp")).toEqual({ dirPart: "src/", filter: "comp" });
    expect(splitImHashQuery("src/lib/")).toEqual({ dirPart: "src/lib/", filter: "" });
    expect(splitImHashQuery("readme")).toEqual({ dirPart: "", filter: "readme" });
  });
});

describe("formatImHashPath", () => {
  it("quotes paths containing whitespace", () => {
    expect(formatImHashPath("src/a.ts")).toBe("src/a.ts");
    expect(formatImHashPath("my docs/a b.md")).toBe("\"my docs/a b.md\"");
  });
});

describe("ImFilePicker", () => {
  beforeEach(() => {
    workbenchListDirectory.mockReset();
    workbenchSearchPaths.mockReset();
    workbenchListDirectory.mockImplementation(async ({ dirPath }: { dirPath: string }) => ({
      entries: dirPath === "/work/app"
        ? [
            { name: "README.md", path: "/work/app/README.md", isDirectory: false },
            { name: "src", path: "/work/app/src", isDirectory: true },
            { name: "tests", path: "/work/app/tests", isDirectory: true }
          ]
        : dirPath === "/work/app/src"
          ? [
              { name: "main.ts", path: "/work/app/src/main.ts", isDirectory: false },
              { name: "util", path: "/work/app/src/util", isDirectory: true }
            ]
          : []
    }));
    workbenchSearchPaths.mockResolvedValue({ files: [], truncated: false, engine: "node" });
    window.agentResume = {
      workbenchListDirectory,
      workbenchSearchPaths
    } as unknown as typeof window.agentResume;
  });

  afterEach(cleanup);

  it("lists workspace root entries with directories first and no parent rows", async () => {
    const onNavigate = vi.fn();
    const picker = renderPicker({ query: "", onNavigate });
    const listbox = await screen.findByRole("listbox", { name: "Insert file or folder" });
    expect(workbenchListDirectory).toHaveBeenCalledWith({ rootPath: "/work/app", dirPath: "/work/app" });
    const names = [...listbox.querySelectorAll(".im-file-picker-name")].map((node) => node.textContent);
    expect(names).toEqual(["src/", "tests/", "README.md"]);
    // Root level: neither ../ nor select-this-folder rows.
    expect(listbox.textContent).not.toContain("../");
    expect(listbox.textContent).not.toContain("Select this folder");

    // Enter on the active first row (a directory) drills in.
    fireEvent.keyDown(picker.textarea, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith("src/");
  });

  it("filters root entries by the query's last segment", async () => {
    renderPicker({ query: "re" });
    const listbox = await screen.findByRole("listbox", { name: "Insert file or folder" });
    await waitFor(() => {
      const names = [...listbox.querySelectorAll(".im-file-picker-name")].map((node) => node.textContent);
      expect(names).toEqual(["README.md"]);
    });
  });

  it("shows ../ and select-this-folder rows inside a subdirectory", async () => {
    const onNavigate = vi.fn();
    const onSelect = vi.fn();
    renderPicker({ query: "src/", onNavigate, onSelect });
    const listbox = await screen.findByRole("listbox", { name: "Insert file or folder" });
    expect(workbenchListDirectory).toHaveBeenCalledWith({ rootPath: "/work/app", dirPath: "/work/app/src" });
    const names = [...listbox.querySelectorAll(".im-file-picker-name")].map((node) => node.textContent);
    expect(names).toEqual(["../", "#src/", "util/", "main.ts"]);

    // Row order: up, selectDir, then entries (util/ dir first).
    fireEvent.click(screen.getByRole("option", { name: "#src/ Select this folder" }));
    expect(onSelect).toHaveBeenCalledWith("src/");
    fireEvent.click(screen.getByRole("option", { name: "../ Parent folder" }));
    expect(onNavigate).toHaveBeenCalledWith("");
    fireEvent.click(screen.getByRole("option", { name: "util/" }));
    expect(onNavigate).toHaveBeenCalledWith("src/util/");
    fireEvent.click(screen.getByRole("option", { name: "main.ts" }));
    expect(onSelect).toHaveBeenCalledWith("src/main.ts");
  });

  it("appends workspace quick-search hits below local entries, deduped", async () => {
    workbenchSearchPaths.mockResolvedValue({
      files: [
        { path: "/work/app/src", relativePath: "src", kind: "directory" as const },
        { path: "/work/app/src/main.ts", relativePath: "src/main.ts", kind: "file" as const },
        { path: "/work/app/deep/nested.ts", relativePath: "deep/nested.ts", kind: "file" as const }
      ],
      truncated: false,
      engine: "node"
    });
    const onSelect = vi.fn();
    renderPicker({ query: "src", onSelect });
    const listbox = await screen.findByRole("listbox", { name: "Insert file or folder" });
    await waitFor(() => expect(workbenchSearchPaths).toHaveBeenCalledWith({ rootPath: "/work/app", query: "src" }));
    await waitFor(() => {
      expect(listbox.textContent).toContain("Search results");
    });
    // Local src/ first, header, then search hits without the duplicated src dir.
    const names = [...listbox.querySelectorAll(".im-file-picker-name")].map((node) => node.textContent);
    expect(names).toEqual(["src/", "src/main.ts", "deep/nested.ts"]);
    fireEvent.click(screen.getByRole("option", { name: "deep/nested.ts" }));
    expect(onSelect).toHaveBeenCalledWith("deep/nested.ts");
  });

  it("skips the quick search while the filter is shorter than two characters", async () => {
    renderPicker({ query: "s" });
    await screen.findByRole("listbox", { name: "Insert file or folder" });
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(workbenchSearchPaths).not.toHaveBeenCalled();
  });

  it("moves the active row with arrow keys and wraps around", async () => {
    const onSelect = vi.fn();
    const picker = renderPicker({ query: "", onSelect });
    const listbox = await screen.findByRole("listbox", { name: "Insert file or folder" });
    await waitFor(() => expect(listbox.textContent).toContain("README.md"));
    const options = () => [...listbox.querySelectorAll("button[role='option']")];
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
    // ArrowUp from the first row wraps around to the last row.
    fireEvent.keyDown(picker.textarea, { key: "ArrowUp" });
    await waitFor(() => expect(options()[options().length - 1]!.getAttribute("aria-selected")).toBe("true"));
    // Enter picks the wrapped-around last row (README.md at root → file select).
    fireEvent.keyDown(picker.textarea, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("README.md");
  });

  it("dismisses on Escape and lets Enter fall through when there are no rows", async () => {
    const onDismiss = vi.fn();
    workbenchListDirectory.mockResolvedValue({ entries: [] });
    workbenchSearchPaths.mockResolvedValue({ files: [], truncated: false, engine: "node" });
    const picker = renderPicker({ query: "zz", onDismiss });
    const listbox = await screen.findByRole("listbox", { name: "Insert file or folder" });
    await waitFor(() => expect(listbox.textContent).toContain("No matches"));
    // Enter is not consumed with an empty list: the composer may send.
    fireEvent.keyDown(picker.textarea, { key: "Enter" });
    expect(picker.lastConsumed()).toBe(false);
    fireEvent.keyDown(picker.textarea, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalled();
    expect(picker.lastConsumed()).toBe(true);
  });

  it("shows an error state when listing fails", async () => {
    workbenchListDirectory.mockRejectedValue(new Error("boom"));
    renderPicker({ query: "" });
    const listbox = await screen.findByRole("listbox", { name: "Insert file or folder" });
    await waitFor(() => expect(listbox.textContent).toContain("Failed to load: boom"));
  });
});
