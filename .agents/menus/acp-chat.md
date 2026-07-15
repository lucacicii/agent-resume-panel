# ACP Chat Feature Map

> Parent index: `.agents/menus-index.md`

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| ACP chat lifecycle and panel | `src/acp/acpChatManager.ts`, `src/acp/acpChatPanel.ts`, `src/acp/acpChatTree.ts` | Opens editor-side ACP chat panels and tree entries. |
| agent launch configuration | `src/acp/agentRegistry.ts`, `src/acp/config.ts`, `src/acp/newSession.ts` | Codex, Claude, Grok, OpenCode, and Pi launch options. |
| ACP protocol connection | `src/acp/agentConnection.ts`, `src/acp/sdk.ts`, `src/acp/createClientApp.ts` | Connection lifecycle and protocol client. |
| agent tools and permissions | `src/acp/handlers/` | Terminal, filesystem, and permission handling. Preserve approvals. |
| ACP storage and attachments | `src/acp/store.ts`, `src/acp/types.ts` | Local ACP records and image validation limits. |
| handoff actions | `src/handoff/`, `src/preview/handoffActions.ts`, `src/menu/handoffMenu.ts` | CLI and ACP handoff targets share menu wiring. |

## Constraints

- ACP chats are separate from CLI session history and are not GTD-tagged.
- Do not broaden ACP filesystem, terminal, or permission capabilities without an explicit security review.
