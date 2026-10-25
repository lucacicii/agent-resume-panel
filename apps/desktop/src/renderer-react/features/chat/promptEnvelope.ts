/**
 * Removing machine context from a user turn read back out of a conversation.
 *
 * A run is sent one assembled string: the main process prepends workspace and
 * task prefixes, and the composer prepends the reference blocks it compiled
 * from `@`/`#` mentions. The daemon stores that string as the user's message, so
 * a reopened session would paint prompt syntax where the user's own sentence
 * belongs. The live feed avoids it by carrying the payload separately; this
 * module is what brings the same result to history.
 *
 * The block shapes are owned by their producers — `thunderClient` for the
 * prefixes, `compileChatPrompt` for the reference blocks — so both lists have to
 * move together with them.
 */

/** Prefixes `thunderClient.runTask` prepends, outermost first. */
const TRANSPORT_PREFIXES: RegExp[] = [
  /^\[Additional workspace roots \(read\/write\):[^\]]*\]\n*/,
  /^\[Active Workspace:[^\]]*\]\n*/,
  /^\[Workspace [^\]]*\](?:\n(?!\n)[^\n]*)*\n*/,
  /^\[GTD Task Context\][\s\S]*?\[End Task Context\]\n*/
];

/** Blocks `compileChatPrompt` prepends, each ending at its own marker. */
const CONTEXT_BLOCKS: RegExp[] = [
  /^\[Active Skill Instructions:[^\]]*\]\n[\s\S]*?\n\[End Skill Instructions\]\n*/,
  /^\[Requested MCP Tool:[^\]]*\]\n[\s\S]*?\n\[End Requested MCP Tool\]\n*/,
  /^\[Referenced Note:[^\]]*\]\n[\s\S]*?\n\[End Referenced Note\]\n*/,
  /^\[Referenced GTD Task:[^\]]*\]\n[\s\S]*?\n\[End Referenced Task\]\n*/,
  /^\[Referenced Conversation:[^\]]*\]\n[\s\S]*?\n\[End Referenced Conversation\]\n*/,
  /^\[Referenced File:[^\]]*\]\n[\s\S]*?\n\[End Referenced File\]\n*/
];

function stripEach(text: string, patterns: readonly RegExp[]): string {
  let next = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of patterns) {
      const stripped = next.replace(pattern, "");
      if (stripped !== next) {
        next = stripped;
        changed = true;
      }
    }
  }
  return next;
}

/** Drop the prefixes the main process adds for the agent's benefit. */
export function stripTransportPrefixes(content: string): string {
  return stripEach(content, TRANSPORT_PREFIXES);
}

/** Drop the reference blocks the composer compiles from mentions. */
export function stripContextBlocks(content: string): string {
  return stripEach(content, CONTEXT_BLOCKS);
}

/**
 * The displayed form of a stored user turn: the user's own words, without any
 * of the machine context that travelled with them. Falls back to the original
 * content when stripping would leave nothing to show.
 */
export function stripMachineContext(content: string): string {
  const stripped = stripContextBlocks(stripTransportPrefixes(content)).trim();
  return stripped || content;
}
