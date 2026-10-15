import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const readImage = vi.fn();
const createFromBuffer = vi.fn();

vi.mock("electron", () => ({
  clipboard: {
    readImage: (...args: unknown[]) => readImage(...args)
  },
  nativeImage: {
    createFromBuffer: (...args: unknown[]) => createFromBuffer(...args)
  }
}));

import { clipboardImageFileName, pasteWorkbenchClipboardImage } from "./workbenchClipboardImage";

const written: string[] = [];

/** markdownImage.ts re-renders a pasted path only when the name keeps this prefix. */
const TRANSCRIPT_IMAGE_PATTERN = /^(pi-clipboard-|agent-resume-clipboard-)/i;

function clipboardWith(png: Buffer) {
  return { isEmpty: () => false, toPNG: () => png, toJPEG: () => Buffer.alloc(0) };
}

afterEach(() => {
  readImage.mockReset();
  createFromBuffer.mockReset();
  for (const filePath of written.splice(0)) {
    fs.rmSync(filePath, { force: true });
  }
});

describe("pasteWorkbenchClipboardImage", () => {
  it("returns null when the clipboard has no image", async () => {
    readImage.mockReturnValue({
      isEmpty: () => true,
      toPNG: () => Buffer.alloc(0),
      toJPEG: () => Buffer.alloc(0)
    });
    await expect(pasteWorkbenchClipboardImage()).resolves.toBeNull();
  });

  it("writes a PNG and returns a data-URL preview", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => png,
      toJPEG: () => Buffer.alloc(0)
    });

    const result = await pasteWorkbenchClipboardImage();
    expect(result).not.toBeNull();
    written.push(result!.path);
    expect(result!.path).toContain("agent-resume-clipboard-");
    expect(result!.path.endsWith(".png")).toBe(true);
    expect(fs.readFileSync(result!.path)).toEqual(png);
    expect(result!.previewUrl).toBe(`data:image/png;base64,${png.toString("base64")}`);
  });

  it("converts a JPEG-only clipboard image to PNG", async () => {
    const jpeg = Buffer.from("jpeg-bytes");
    const converted = Buffer.from("png-from-jpeg");
    createFromBuffer.mockReturnValue({ toPNG: () => converted });
    readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.alloc(0),
      toJPEG: () => jpeg
    });

    const result = await pasteWorkbenchClipboardImage();
    expect(createFromBuffer).toHaveBeenCalledWith(jpeg);
    expect(result).not.toBeNull();
    written.push(result!.path);
    expect(fs.readFileSync(result!.path)).toEqual(converted);
    expect(result!.previewUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("rejects images larger than the configured limit", async () => {
    readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from("too-big"),
      toJPEG: () => Buffer.alloc(0)
    });
    await expect(pasteWorkbenchClipboardImage({ maxBytes: 4 })).rejects.toThrow("Clipboard image is too large.");
  });

  it("names the file after the scope, falling back to one app-wide name", () => {
    expect(clipboardImageFileName("terminal:1")).toBe("agent-resume-clipboard-terminal-1.png");
    expect(TRANSCRIPT_IMAGE_PATTERN.test(clipboardImageFileName("terminal:1"))).toBe(true);
    expect(TRANSCRIPT_IMAGE_PATTERN.test(clipboardImageFileName())).toBe(true);
    expect(clipboardImageFileName()).toBe("agent-resume-clipboard-unknown.png");
    expect(clipboardImageFileName("")).toBe("agent-resume-clipboard-unknown.png");
  });

  it("keeps a scope with path separators inside the temp directory", async () => {
    readImage.mockReturnValue(clipboardWith(Buffer.from("png-bytes")));

    const result = await pasteWorkbenchClipboardImage({ scopeId: "../../evil/other" });
    written.push(result!.path);
    expect(path.dirname(result!.path)).toBe(os.tmpdir());
    expect(path.basename(result!.path)).toBe("agent-resume-clipboard-..-..-evil-other.png");
  });

  it("reuses one path per scope and overwrites it instead of leaking an image per paste", async () => {
    const first = Buffer.from("first-png");
    const second = Buffer.from("second-png");
    readImage.mockReturnValueOnce(clipboardWith(first)).mockReturnValueOnce(clipboardWith(second));

    const one = await pasteWorkbenchClipboardImage({ scopeId: "terminal:1" });
    const two = await pasteWorkbenchClipboardImage({ scopeId: "terminal:1" });
    written.push(one!.path);
    expect(two!.path).toBe(one!.path);
    expect(fs.readFileSync(one!.path)).toEqual(second);
  });

  it("separates scopes into separate files", async () => {
    readImage.mockReturnValue(clipboardWith(Buffer.from("png-bytes")));

    const one = await pasteWorkbenchClipboardImage({ scopeId: "terminal:1" });
    const two = await pasteWorkbenchClipboardImage({ scopeId: "terminal:2" });
    written.push(one!.path, two!.path);
    expect(two!.path).not.toBe(one!.path);
  });
});
