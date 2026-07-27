type Translate = (key: string, ...args: Array<string | number>) => string;

type ToolCallLabelSource = {
  title?: string;
  kind?: string;
  rawInput?: unknown;
};

const toolKindKeys: Record<string, string> = {
  read: "desktop.workbench.acpToolKind.read",
  edit: "desktop.workbench.acpToolKind.edit",
  delete: "desktop.workbench.acpToolKind.delete",
  move: "desktop.workbench.acpToolKind.move",
  search: "desktop.workbench.acpToolKind.search",
  execute: "desktop.workbench.acpToolKind.execute",
  think: "desktop.workbench.acpToolKind.think",
  fetch: "desktop.workbench.acpToolKind.fetch",
  switch_mode: "desktop.workbench.acpToolKind.switchMode",
  other: "desktop.workbench.acpToolKind.other"
};

function inferredToolKind(rawInput: unknown): string | undefined {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return undefined;
  const input = rawInput as Record<string, unknown>;

  if ("command" in input || "parsed_cmd" in input || "process_id" in input || "block_until_ms" in input) {
    return "execute";
  }
  if ("old_string" in input || "new_string" in input) return "edit";
  if ("glob" in input || "glob_pattern" in input || "pattern" in input) return "search";
  if ("target_directory" in input || "target_file" in input) return "move";
  if ("file_path" in input || "path" in input) return "read";
  return undefined;
}

/** Prefer the agent's description while replacing ACP's generic placeholder. */
export function toolCallLabel(tool: ToolCallLabelSource, t: Translate): string {
  const title = tool.title?.trim();
  if (title && title.toLocaleLowerCase() !== "tool") return title;

  const kind = tool.kind && tool.kind !== "other" ? tool.kind : inferredToolKind(tool.rawInput);
  const key = kind ? toolKindKeys[kind] : undefined;
  return t(key || toolKindKeys.other);
}
