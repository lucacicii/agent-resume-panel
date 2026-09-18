/**
 * Presentation helpers for session status dots. These lived on the deleted
 * `SessionDotsCluster` component; task rows and workbench status chips
 * still render the same dot vocabulary, so the mapping lives here now.
 */

import type { SessionDotStatus } from ".";

export function sessionDotStatusClass(status: SessionDotStatus): string {
  if (status === "open") return "";
  return ` is-${status === "awaiting_user" ? "awaiting" : status}`;
}

