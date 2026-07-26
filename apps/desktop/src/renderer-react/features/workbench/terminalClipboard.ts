import type { IBase64, IClipboardProvider } from "@xterm/addon-clipboard";

/**
 * OSC 52 base64 codec that always treats payload as UTF-8 bytes.
 *
 * History: some xterm clipboard paths used raw `atob`/`btoa`, which map each
 * byte to a Latin-1 code unit. Chinese (and any non-ASCII) then becomes classic
 * mojibake like `测试` → `æµ‹è¯•` when written to the system clipboard.
 *
 * Also more tolerant than js-base64's strict re-encode check: padding and
 * whitespace differences in the OSC payload are accepted.
 */
export class Utf8Base64 implements IBase64 {
  encodeText(data: string): string {
    const bytes = new TextEncoder().encode(data);
    return bytesToBase64(bytes);
  }

  decodeText(data: string): string {
    try {
      const bytes = base64ToBytes(data);
      if (!bytes) return "";
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch {
      return "";
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  // Prefer native helpers when present (Chromium 133+ / recent Electron).
  const withB64 = bytes as Uint8Array & { toBase64?: () => string };
  if (typeof withB64.toBase64 === "function") {
    return withB64.toBase64();
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin);
}

function base64ToBytes(data: string): Uint8Array | null {
  const cleaned = data.replace(/[\s\r\n]+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!cleaned) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) return null;

  const padded = cleaned.length % 4 === 0 ? cleaned : cleaned + "=".repeat(4 - (cleaned.length % 4));

  const fromB64 = Uint8Array as unknown as {
    fromBase64?: (s: string) => Uint8Array;
  };
  if (typeof fromB64.fromBase64 === "function") {
    try {
      return fromB64.fromBase64(padded);
    } catch {
      return null;
    }
  }

  try {
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

export type ClipboardTextWriter = (text: string) => void | Promise<void>;
export type ClipboardTextReader = () => string | Promise<string>;

/**
 * OSC 52 provider: write to the system clipboard; never expose silent reads
 * unless a reader is supplied (default denies reads).
 */
export function createOsc52ClipboardProvider(options: {
  writeText: ClipboardTextWriter;
  readText?: ClipboardTextReader;
}): IClipboardProvider {
  return {
    readText: () => {
      if (!options.readText) return "";
      return options.readText();
    },
    writeText: (_selection, text) => {
      if (!text) return;
      return options.writeText(text);
    }
  };
}

/** Write selection text via the best available clipboard path. */
export function writeTerminalSelection(
  text: string,
  writeNative?: ClipboardTextWriter
): void {
  if (!text) return;
  if (writeNative) {
    try {
      void writeNative(text);
      return;
    } catch {
      /* fall through */
    }
  }
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => undefined);
  }
}
