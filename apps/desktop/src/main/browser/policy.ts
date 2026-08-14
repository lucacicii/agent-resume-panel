import type { BrowserPolicy } from "./types";

function hostFromUrl(url: string): string | null {
  try {
    if (!url || url === "about:blank") return null;
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Simple glob: exact host, `*.example.com`, or `*example.com` suffix. */
export function hostMatches(pattern: string, host: string): boolean {
  const p = pattern.trim().toLowerCase();
  const h = host.trim().toLowerCase();
  if (!p || !h) return false;
  if (p === h) return true;
  if (p.startsWith("*.")) {
    const suffix = p.slice(1); // .example.com
    return h.endsWith(suffix) || h === p.slice(2);
  }
  if (p.startsWith("*") && p.length > 1) {
    return h.endsWith(p.slice(1)) || h === p.slice(1).replace(/^\./, "");
  }
  return false;
}

export function isNavigationAllowed(policy: BrowserPolicy, url: string): {
  allowed: boolean;
  reason?: string;
  host?: string | null;
} {
  if (!url || url === "about:blank") return { allowed: true, host: null };
  if (url.startsWith("devtools://") || url.startsWith("chrome-error://")) {
    return { allowed: false, reason: "blocked-scheme", host: null };
  }
  const host = hostFromUrl(url);
  if (!host) return { allowed: false, reason: "invalid-url", host: null };

  if (policy.blockHosts.some((pattern) => hostMatches(pattern, host))) {
    return { allowed: false, reason: "blocked-host", host };
  }

  // Empty allow list = allow all non-blocked hosts for human P0 browsing.
  // Agent tooling (P1) can tighten this with prompts; policy.allowHosts remains available.
  if (policy.allowHosts.length === 0) {
    return { allowed: true, host };
  }
  if (policy.allowHosts.some((pattern) => hostMatches(pattern, host))) {
    return { allowed: true, host };
  }
  return { allowed: false, reason: "not-allowlisted", host };
}
