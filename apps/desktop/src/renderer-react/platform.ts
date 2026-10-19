/**
 * Which OS the renderer is running on.
 *
 * The preload bridge exposes `process.platform`, which is authoritative.
 * `navigator.platform` is deprecated (and in a sandboxed/emulated context can
 * lie), so it is only a fallback for unit tests and the very first frames
 * before the bridge is read. Everything else — shortcut glyphs, the traffic
 * light clearance, the font stack — keys off this.
 */
export function rendererPlatform(): NodeJS.Platform {
  const fromBridge = typeof window !== "undefined" ? window.agentResume?.platform : undefined;
  if (typeof fromBridge === "string" && fromBridge) return fromBridge as NodeJS.Platform;
  if (typeof navigator !== "undefined" && /mac/i.test(navigator.platform)) return "darwin";
  return "win32";
}

export function isMacRenderer(): boolean {
  return rendererPlatform() === "darwin";
}

export function isWindowsRenderer(): boolean {
  return rendererPlatform() === "win32";
}
