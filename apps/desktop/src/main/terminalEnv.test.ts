import { describe, expect, it } from "vitest";
import { ensureUtf8TerminalEnv, isUtf8Locale, resolveUtf8Lang } from "./terminalEnv";

describe("terminalEnv", () => {
  it("detects UTF-8 locales", () => {
    expect(isUtf8Locale("zh_CN.UTF-8")).toBe(true);
    expect(isUtf8Locale("en_US.utf8")).toBe(true);
    expect(isUtf8Locale("C")).toBe(false);
    expect(isUtf8Locale(undefined)).toBe(false);
  });

  it("preserves existing UTF-8 LANG", () => {
    const env = ensureUtf8TerminalEnv({ LANG: "zh_CN.UTF-8", PATH: "/bin" });
    expect(env.LANG).toBe("zh_CN.UTF-8");
    expect(env.COLORTERM).toBe("truecolor");
  });

  it("upgrades missing / non-UTF-8 LANG", () => {
    expect(ensureUtf8TerminalEnv({}).LANG).toBe("en_US.UTF-8");
    expect(ensureUtf8TerminalEnv({ LANG: "C" }).LANG).toBe("en_US.UTF-8");
    expect(resolveUtf8Lang({ LANG: "zh-CN" })).toBe("zh_CN.UTF-8");
    expect(resolveUtf8Lang({}, "ja-JP")).toBe("ja_JP.UTF-8");
  });

  it("does not clobber known multi-byte legacy locales", () => {
    expect(resolveUtf8Lang({ LANG: "zh_CN.GBK" })).toBe("zh_CN.GBK");
  });
});
