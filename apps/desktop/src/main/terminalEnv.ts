/**
 * Terminal process environment helpers.
 *
 * GUI-launched Electron apps often inherit an empty or non-UTF-8 LANG.
 * Shells and tools then emit CJK as the wrong encoding; xterm stores that
 * mojibake, so copy/paste looks garbled even when the UI font is fine.
 */

const UTF8_LOCALE_RE = /\.(UTF-?8|utf8)$/i;
/** Locales that already use a multi-byte encoding we should not override. */
const SAFE_LEGACY_LOCALE_RE = /\.(euc[a-z0-9-]*|GB18030|GBK|Big5)$/i;

export function isUtf8Locale(value: string | undefined): boolean {
  return !!value && UTF8_LOCALE_RE.test(value.trim());
}

/**
 * Pick a UTF-8 LANG value, preserving the language/region when possible.
 * Mirrors VS Code's terminal locale detection (simplified).
 */
export function resolveUtf8Lang(env: Record<string, string | undefined>, preferredLocale?: string): string {
  for (const key of ["LC_ALL", "LC_CTYPE", "LANG"] as const) {
    const current = env[key]?.trim();
    if (current && (isUtf8Locale(current) || SAFE_LEGACY_LOCALE_RE.test(current))) {
      return current;
    }
  }

  const hint = (preferredLocale || env.LANG || env.LC_ALL || env.LC_CTYPE || "").trim();
  if (hint && !/^(C|POSIX)$/i.test(hint.replace(/\..*$/, ""))) {
    // "zh_CN.GBK" / "zh-CN" / "zh_CN" → "zh_CN.UTF-8"
    const bare = hint.replace(/\..*$/, "").replace(/-/g, "_");
    const parts = bare.split("_").filter(Boolean);
    if (parts[0] && /^[A-Za-z]{2,3}$/.test(parts[0])) {
      const language = parts[0].toLowerCase();
      const region = parts[1] && /^[A-Za-z]{2}$/.test(parts[1]) ? parts[1].toUpperCase() : "";
      return region ? `${language}_${region}.UTF-8` : `${language}.UTF-8`;
    }
  }

  return "en_US.UTF-8";
}

/**
 * Mutates `env` so interactive tools treat the PTY as UTF-8.
 * Does not override an existing UTF-8 (or known multi-byte) locale.
 */
export function ensureUtf8TerminalEnv(
  env: Record<string, string | undefined>,
  preferredLocale?: string
): Record<string, string> {
  const out = { ...env } as Record<string, string>;
  const hasUtf8 =
    isUtf8Locale(out.LC_ALL) || isUtf8Locale(out.LC_CTYPE) || isUtf8Locale(out.LANG);

  if (!hasUtf8) {
    out.LANG = resolveUtf8Lang(out, preferredLocale);
  }

  if (!out.COLORTERM) {
    out.COLORTERM = "truecolor";
  }

  return out;
}
