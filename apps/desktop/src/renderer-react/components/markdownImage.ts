const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const DATA_URI_MAX_CHARS = 2_000_000;

export type MarkdownImageOptions = {
  baseDir?: string;
  rootDir?: string;
};

export type MarkdownImageResolution =
  | { kind: "local"; url: string; absPath: string }
  | { kind: "data"; url: string }
  | { kind: "remote"; href: string; host: string }
  | {
      kind: "reject";
      reason: "empty" | "unsafe" | "no-base" | "outside-root" | "bad-ext" | "too-large";
    };

export type MarkdownImageLabels = {
  openInBrowser: string;
  unavailable: string;
  remoteImage: string;
};

const DEFAULT_LABELS: MarkdownImageLabels = {
  openInBrowser: "Open in browser",
  unavailable: "Image unavailable",
  remoteImage: "Remote image"
};

export function posixDirname(filePath: string): string {
  const normalized = toPosix(filePath).replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return index === 0 ? "/" : "";
  return normalized.slice(0, index);
}

export function posixJoin(left: string, right: string): string {
  const base = toPosix(left).replace(/\/+$/, "");
  const rel = toPosix(right);
  if (!base) return normalizePosixPath(rel);
  if (!rel) return normalizePosixPath(base);
  if (isAbsolutePath(rel)) return normalizePosixPath(rel);
  return normalizePosixPath(`${base}/${rel.replace(/^\/+/, "")}`);
}

export function resolveMarkdownImageSrc(
  rawSrc: string | null | undefined,
  options: MarkdownImageOptions = {}
): MarkdownImageResolution {
  const src = decodeHtmlEntities((rawSrc || "").trim());
  if (!src) return { kind: "reject", reason: "empty" };

  if (/^(javascript|vbscript|blob):/i.test(src)) {
    return { kind: "reject", reason: "unsafe" };
  }

  if (/^data:/i.test(src)) {
    if (src.length > DATA_URI_MAX_CHARS) return { kind: "reject", reason: "too-large" };
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(src)) {
      return { kind: "reject", reason: "unsafe" };
    }
    return { kind: "data", url: src };
  }

  if (/^https?:\/\//i.test(src)) {
    try {
      const url = new URL(src);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { kind: "reject", reason: "unsafe" };
      }
      return { kind: "remote", href: url.href, host: url.host || url.hostname };
    } catch {
      return { kind: "reject", reason: "unsafe" };
    }
  }

  const absPath = absoluteImagePath(src, options.baseDir);
  if (!absPath) {
    return { kind: "reject", reason: "no-base" };
  }
  if (!hasImageExtension(absPath)) return { kind: "reject", reason: "bad-ext" };

  const root = options.rootDir || options.baseDir;
  if (root && isInsideRoot(absPath, root)) {
    return { kind: "local", url: toFileUrl(absPath), absPath };
  }
  if (isAllowedTempClipboardImage(absPath)) {
    return { kind: "local", url: toFileUrl(absPath), absPath };
  }
  if (!root) return { kind: "reject", reason: "no-base" };
  return { kind: "reject", reason: "outside-root" };
}

export function imageHtml(
  resolved: MarkdownImageResolution,
  alt = "",
  labels: Partial<MarkdownImageLabels> = {}
): string {
  const copy = { ...DEFAULT_LABELS, ...labels };
  const safeAlt = escapeHtml(alt);
  if (resolved.kind === "local" || resolved.kind === "data") {
    return `<img src="${escapeHtml(resolved.url)}" alt="${safeAlt}" class="md-preview-img" loading="lazy" />`;
  }
  if (resolved.kind === "remote") {
    const href = escapeHtml(resolved.href);
    const host = escapeHtml(resolved.host);
    return `<span class="md-image-remote"><span class="md-image-remote-label">${escapeHtml(copy.remoteImage)} · ${host}</span><a href="${href}" rel="noopener noreferrer" target="_blank" data-md-open-external="1">${escapeHtml(copy.openInBrowser)}</a></span>`;
  }
  return `<span class="md-image-missing">${safeAlt || escapeHtml(copy.unavailable)}</span>`;
}

export function imageSrcFromElement(target: EventTarget | null): string {
  if (!(target instanceof HTMLImageElement)) return "";
  return target.getAttribute("src") || target.src || "";
}

const STREAMDOWN_SENTINEL_HOST = "agent-resume.local";

export function toStreamdownSafeSrc(resolved: MarkdownImageResolution): string | undefined {
  if (resolved.kind === "data") return resolved.url;
  if (resolved.kind === "remote") return resolved.href;
  if (resolved.kind === "local") {
    return `https://${STREAMDOWN_SENTINEL_HOST}/img?p=${encodeURIComponent(resolved.absPath)}`;
  }
  return undefined;
}

export function fromStreamdownSafeSrc(src: string): MarkdownImageResolution | undefined {
  try {
    const url = new URL(src);
    if (url.protocol !== "https:" || url.hostname !== STREAMDOWN_SENTINEL_HOST) return undefined;
    const absPath = url.searchParams.get("p") || "";
    if (!absPath) return undefined;
    return { kind: "local", absPath, url: toFileUrl(absPath) };
  } catch {
    return undefined;
  }
}

export function rewriteMarkdownImageSyntax(
  markdown: string,
  options: MarkdownImageOptions = {}
): string {
  if (!markdown.includes("![") ) return markdown;
  return markdown.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (full, alt: string, src: string, offset: number) => {
    if (isInsideFence(markdown, offset)) return full;
    const resolved = fromStreamdownSafeSrc(src) || resolveMarkdownImageSrc(src, options);
    const safeSrc = toStreamdownSafeSrc(resolved);
    if (!safeSrc) return alt || full;
    return `![${alt}](${safeSrc})`;
  });
}

const BARE_IMAGE_PATH = /['"]?((?:\/|file:\/\/)[^\s"'`]+\.(?:png|jpe?g|gif|webp|bmp|svg))['"]?/gi;

export function promoteBareImagePaths(
  markdown: string,
  options: MarkdownImageOptions = {}
): string {
  if (!markdown) return markdown;
  return markdown.replace(BARE_IMAGE_PATH, (full, captured: string, offset: number) => {
    if (isInsideFence(markdown, offset)) return full;
    if (offset >= 2 && markdown.slice(offset - 2, offset) === "](") return full;
    const raw = stripImagePathSuffix(captured || "");
    const resolved = resolveMarkdownImageSrc(raw, options);
    if (resolved.kind !== "local" && resolved.kind !== "data") return full;
    return `![](${raw})`;
  });
}

function stripImagePathSuffix(value: string): string {
  const match = value.trim().match(/^(.*\.(?:png|jpe?g|gif|webp|bmp|svg))/i);
  return match ? match[1] : value.trim();
}

function isAllowedTempClipboardImage(absPath: string): boolean {
  const posix = normalizePosixPath(absPath);
  const name = posix.split("/").pop() || "";
  if (!/^(pi-clipboard-|agent-resume-clipboard-)/i.test(name)) return false;
  if (!hasImageExtension(posix)) return false;
  if ((posix.startsWith("/var/folders/") || posix.startsWith("/private/var/folders/")) && posix.includes("/T/")) {
    return true;
  }
  return posix.startsWith("/tmp/") || posix.startsWith("/private/tmp/");
}

function isInsideFence(markdown: string, offset: number): boolean {
  const before = markdown.slice(0, offset);
  const ticks = (before.match(/^```/gm) || []).length;
  const tildes = (before.match(/^~~~/gm) || []).length;
  return ticks % 2 === 1 || tildes % 2 === 1;
}

export function rewriteMarkdownImages(
  html: string,
  options: MarkdownImageOptions = {},
  labels: Partial<MarkdownImageLabels> = {}
): string {
  if (!html || !html.toLowerCase().includes("<img")) return html;
  return html.replace(/<img\b([^>]*?)\/?>/gi, (_full, rawAttrs: string) => {
    const src = readHtmlAttr(rawAttrs, "src");
    const alt = readHtmlAttr(rawAttrs, "alt");
    return imageHtml(resolveMarkdownImageSrc(src, options), alt, labels);
  });
}

function absoluteImagePath(src: string, baseDir?: string): string | undefined {
  const stripped = stripFileProtocol(src);
  if (!stripped) return undefined;
  if (isAbsolutePath(stripped)) return normalizePosixPath(stripped);
  if (!baseDir) return undefined;
  return posixJoin(baseDir, stripped);
}

function stripFileProtocol(src: string): string {
  if (!/^file:/i.test(src)) return decodeMaybeUri(src);
  let rest = src.replace(/^file:\/\//i, "");
  if (/^localhost\//i.test(rest)) rest = rest.slice("localhost".length);
  rest = decodeMaybeUri(rest);
  if (/^\/[a-zA-Z]:/.test(rest)) return rest.slice(1);
  return rest;
}

function hasImageExtension(filePath: string): boolean {
  const base = filePath.split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false;
  return IMAGE_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

function isInsideRoot(absPath: string, rootDir: string): boolean {
  const abs = normalizePosixPath(absPath);
  const root = normalizePosixPath(rootDir).replace(/\/+$/, "");
  if (!root) return false;
  if (abs === root) return true;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return abs.startsWith(prefix);
}

function isAbsolutePath(value: string): boolean {
  const posix = toPosix(value);
  return posix.startsWith("/") || /^[a-zA-Z]:\//.test(posix);
}

function normalizePosixPath(value: string): string {
  const posix = toPosix(value);
  const windowsDrive = posix.match(/^([a-zA-Z]:)(\/|$)/);
  const parts = posix.split("/");
  const stack: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === "." || (part === "" && index > 0 && index < parts.length - 1)) continue;
    if (part === "") {
      if (index === 0) stack.push("");
      continue;
    }
    if (part === "..") {
      if (stack.length === 0) continue;
      if (stack.length === 1 && (stack[0] === "" || /^[a-zA-Z]:$/.test(stack[0]))) continue;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  if (windowsDrive && stack[0] !== windowsDrive[1].slice(0, 2)) {
    return stack.join("/") || "/";
  }
  if (stack.length === 1 && stack[0] === "") return "/";
  return stack.join("/") || "/";
}

function toFileUrl(absPath: string): string {
  const posix = normalizePosixPath(absPath);
  if (/^[a-zA-Z]:\//.test(posix)) return `file:///${posix}`;
  const encoded = posix.split("/").map((segment, index) => (
    index === 0 && segment === "" ? "" : encodeURIComponent(segment).replace(/%2F/g, "/")
  )).join("/");
  return `file://${encoded.startsWith("/") ? encoded : `/${encoded}`}`;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function decodeMaybeUri(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function readHtmlAttr(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  if (!match) return "";
  return decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
