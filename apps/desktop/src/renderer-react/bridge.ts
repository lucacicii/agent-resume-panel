import type { DesktopApi } from "../preload/preload";

declare global {
  interface Window {
    agentResume: DesktopApi;
  }
}

export function desktopApi(): DesktopApi {
  if (!window.agentResume) {
    throw new Error("Agent Resume desktop bridge is unavailable");
  }
  return window.agentResume;
}
