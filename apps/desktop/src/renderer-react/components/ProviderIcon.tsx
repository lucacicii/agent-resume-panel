import type { JSX } from "react";
import { ThemeIcon } from "./ThemeIcon";

import piIcon from "../assets/providers/pi.svg";
import opencodeIcon from "../assets/providers/opencode.ico";
import claudeIcon from "../assets/providers/claude.svg";
import chatgptIcon from "../assets/providers/chatgpt.svg";
import cursorIcon from "../assets/providers/cursor.svg";
import antigravityIcon from "../assets/providers/antigravity.ico";
import primeIcon from "../assets/providers/prime.jpg";
import grokIcon from "../assets/providers/grok.svg";

export type ProviderIconProps = {
  provider: string;
  size?: number;
  className?: string;
};

/** Canonical catalog/ACP ids plus a few aliases used in UI labels. */
const PROVIDER_ICONS: Record<string, string> = {
  pi: piIcon,
  opencode: opencodeIcon,
  claude: claudeIcon,
  // Codex uses the ChatGPT product mark.
  codex: chatgptIcon,
  chatgpt: chatgptIcon,
  openai: chatgptIcon,
  cursor: cursorIcon,
  "cursor-ide": cursorIcon,
  agy: antigravityIcon,
  antigravity: antigravityIcon,
  prime: primeIcon,
  grok: grokIcon,
};

export function ProviderIcon({ provider, size = 14, className }: ProviderIconProps): JSX.Element {
  const iconSrc = PROVIDER_ICONS[provider?.toLowerCase()?.trim()];

  if (iconSrc) {
    return (
      <img
        src={iconSrc}
        alt=""
        width={size}
        height={size}
        className={className}
        style={{ objectFit: "contain" }}
        aria-hidden="true"
      />
    );
  }

  return <ThemeIcon name="bot" size={size} className={className} aria-hidden="true" />;
}
