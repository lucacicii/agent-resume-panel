import type { JSX } from "react";
import { ThemeIcon } from "./ThemeIcon";

export type ProviderIconProps = {
  provider: string;
  size?: number;
  className?: string;
};

/**
 * Paths are relative to dist/renderer/index.html (file:// or app package).
 * Assets are copied from src/renderer/assets by scripts/copy-renderer.cjs.
 */
const PROVIDER_ICON_FILES: Record<string, string> = {
  pi: "./assets/providers/pi.svg",
  opencode: "./assets/providers/opencode.png",
  claude: "./assets/providers/claude.svg",
  // Codex uses the ChatGPT product mark.
  codex: "./assets/providers/chatgpt.svg",
  chatgpt: "./assets/providers/chatgpt.svg",
  openai: "./assets/providers/chatgpt.svg",
  cursor: "./assets/providers/cursor.svg",
  "cursor-ide": "./assets/providers/cursor.svg",
  agy: "./assets/providers/antigravity.png",
  antigravity: "./assets/providers/antigravity.png",
  prime: "./assets/providers/prime.png",
  grok: "./assets/providers/grok.svg"
};

function resolveProviderIcon(provider: string | undefined): string | undefined {
  const key = provider?.toLowerCase()?.trim();
  if (!key) return undefined;
  if (PROVIDER_ICON_FILES[key]) return PROVIDER_ICON_FILES[key];
  // Tolerate values like "cli:codex" / "acp:claude".
  const colon = key.lastIndexOf(":");
  if (colon >= 0) {
    const tail = key.slice(colon + 1);
    if (PROVIDER_ICON_FILES[tail]) return PROVIDER_ICON_FILES[tail];
  }
  return undefined;
}

export function ProviderIcon({ provider, size = 14, className }: ProviderIconProps): JSX.Element {
  const iconSrc = resolveProviderIcon(provider);

  if (iconSrc) {
    return (
      <img
        src={iconSrc}
        alt=""
        width={size}
        height={size}
        className={className}
        style={{ objectFit: "contain", display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}
        draggable={false}
        aria-hidden="true"
      />
    );
  }

  return <ThemeIcon name="bot" size={size} className={className} aria-hidden="true" />;
}
