import { describe, expect, it, vi } from "vitest";
import {
  createOsc52ClipboardProvider,
  Utf8Base64,
  writeTerminalSelection
} from "./terminalClipboard";

describe("Utf8Base64", () => {
  const codec = new Utf8Base64();

  it("round-trips Chinese and mixed text", () => {
    for (const sample of ["测试中文", "你好", "混合 mixed 123", "€mläütß", "ASCII"]) {
      const encoded = codec.encodeText(sample);
      expect(codec.decodeText(encoded)).toBe(sample);
      // Matches Node/standard base64 of UTF-8 bytes
      expect(encoded).toBe(Buffer.from(sample, "utf8").toString("base64"));
    }
  });

  it("decodes OSC 52 payloads with missing padding or whitespace", () => {
    const sample = "测试中文ABC";
    const padded = Buffer.from(sample, "utf8").toString("base64");
    expect(codec.decodeText(padded.replace(/=+$/, ""))).toBe(sample);
    expect(codec.decodeText(`${padded.slice(0, 8)}\n${padded.slice(8)}`)).toBe(sample);
  });

  it("does not produce Latin-1 mojibake for Chinese", () => {
    // Classic wrong path: atob → treat binary string as text
    const sample = "测试中文";
    const b64 = Buffer.from(sample, "utf8").toString("base64");
    const wrong = Buffer.from(b64, "base64").toString("latin1");
    expect(wrong).not.toBe(sample);
    expect(codec.decodeText(b64)).toBe(sample);
    expect(codec.decodeText(b64)).not.toBe(wrong);
  });

  it("returns empty string for invalid base64", () => {
    expect(codec.decodeText("!!!")).toBe("");
    expect(codec.decodeText("")).toBe("");
  });
});

describe("createOsc52ClipboardProvider", () => {
  it("writes non-empty text and denies silent reads by default", async () => {
    const writeText = vi.fn();
    const provider = createOsc52ClipboardProvider({ writeText });
    expect(provider.readText("c" as never)).toBe("");
    await provider.writeText("c" as never, "你好");
    expect(writeText).toHaveBeenCalledWith("你好");
    await provider.writeText("c" as never, "");
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});

describe("writeTerminalSelection", () => {
  it("prefers the native writer", () => {
    const writeNative = vi.fn();
    writeTerminalSelection("中文", writeNative);
    expect(writeNative).toHaveBeenCalledWith("中文");
  });
});
