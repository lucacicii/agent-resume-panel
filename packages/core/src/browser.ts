/**
 * Browser-safe entry — the only core entry the Desktop renderer may import
 * *values* from.
 *
 * The renderer is bundled with `platform: "browser"`, so anything reachable
 * from an import ends up in the bundle with its `node:*` requires intact. The
 * main barrel re-exports Node-only modules (session sync, settings store, MCP),
 * which is why a single value import from it fails the bundle with one
 * "Could not resolve node:*" per Node builtin. `import type` from the main
 * barrel stays fine: types are erased and never become imports.
 *
 * Everything exported here must stay pure data or pure logic — no `node:*`.
 */
export { THUNDER_PERMISSION_MODES, normalizeThunderPermissionMode } from "./thunder/types";
export { buildMentionPrompt } from "./settings/mentionPrompt";
