import { clipboard, nativeImage } from "electron";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024;
/** renderer-react/components/markdownImage.ts re-renders pasted images by this prefix. */
const CLIPBOARD_IMAGE_PREFIX = "agent-resume-clipboard-";
/** One app-wide file when the caller has no scope to name. */
const CLIPBOARD_IMAGE_FALLBACK_SCOPE = "unknown";
const MAX_CLIPBOARD_SCOPE_LENGTH = 64;

type WorkbenchClipboardImage = {
  path: string;
  previewUrl: string;
};

function imageToPngBuffer(image: Electron.NativeImage): Buffer {
  const png = image.toPNG();
  if (png.length > 0) {
    return png;
  }
  const jpeg = image.toJPEG(92);
  if (jpeg.length > 0) {
    return nativeImage.createFromBuffer(jpeg).toPNG();
  }
  return png;
}

/**
 * Pasted paths are typed into the terminal as literal text, so the file name must
 * be stable per scope: a per-paste unique name can never match a permission rule
 * keyed on that path, and leaks one image per paste. The scope is sanitized like a
 * filename so a hostile id cannot walk out of the temp directory.
 */
export function clipboardImageFileName(scopeId?: string): string {
  const scope = scopeId?.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, MAX_CLIPBOARD_SCOPE_LENGTH);
  return `${CLIPBOARD_IMAGE_PREFIX}${scope || CLIPBOARD_IMAGE_FALLBACK_SCOPE}.png`;
}

export async function pasteWorkbenchClipboardImage(options?: {
  maxBytes?: number;
  scopeId?: string;
}): Promise<WorkbenchClipboardImage | null> {
  const image = clipboard.readImage();
  if (image.isEmpty()) {
    return null;
  }

  const png = imageToPngBuffer(image);
  if (png.length === 0) {
    return null;
  }

  const maxBytes = options?.maxBytes ?? MAX_CLIPBOARD_IMAGE_BYTES;
  if (png.length > maxBytes) {
    throw new Error("Clipboard image is too large.");
  }

  // Same scope, same path: writeFile truncates, so a scope keeps exactly one image.
  const filePath = path.join(os.tmpdir(), clipboardImageFileName(options?.scopeId));
  await fs.writeFile(filePath, png);
  return {
    path: filePath,
    previewUrl: `data:image/png;base64,${png.toString("base64")}`
  };
}
