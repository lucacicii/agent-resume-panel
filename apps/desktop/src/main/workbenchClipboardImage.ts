import { clipboard, nativeImage } from "electron";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024;

export type WorkbenchClipboardImage = {
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

export async function pasteWorkbenchClipboardImage(options?: {
  maxBytes?: number;
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

  const filePath = path.join(os.tmpdir(), `agent-resume-clipboard-${randomUUID()}.png`);
  await fs.writeFile(filePath, png);
  return {
    path: filePath,
    previewUrl: `data:image/png;base64,${png.toString("base64")}`
  };
}
