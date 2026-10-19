/**
 * Re-export the shared path helpers.
 *
 * This file used to be a copy of `packages/core/src/pathUtils.ts`; the copy
 * drifted (POSIX-only `~`, no Windows drive rehoming) while the core version
 * gained Windows support. There is exactly one implementation now.
 */
export { expandHome, compactPath, basenameOrPath, normalizeProjectPath } from "@agent-resume/core";
