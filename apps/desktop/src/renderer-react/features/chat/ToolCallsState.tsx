import React, { useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { ToolChip, parseToolCall } from "./ToolChip";
import type { ActiveToolInfo } from "./useThunderChat";

interface ToolCallsStateProps {
  tools: ActiveToolInfo[];
  isStreaming?: boolean;
  defaultExpanded?: boolean;
}

export function ToolCallsState({
  tools,
  isStreaming = false,
  defaultExpanded = false
}: ToolCallsStateProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!tools || tools.length === 0) return null;

  const runningTool = tools.find((t) => t.isRunning);
  const errorCount = tools.filter((t) => t.isError).length;
  const toolNames = Array.from(new Set(tools.map((t) => t.name))).join(", ");

  let title = "";
  if (runningTool) {
    const parsed = parseToolCall(runningTool.name, runningTool.arguments);
    title = `Running: ${parsed.verb} ${parsed.target}...`;
  } else if (tools.length === 1) {
    const parsed = parseToolCall(tools[0].name, tools[0].arguments);
    title = `${parsed.verb} ${parsed.target}`;
  } else {
    let readCount = 0;
    let editCount = 0;
    let runCount = 0;
    let searchCount = 0;
    for (const t of tools) {
      const p = parseToolCall(t.name, t.arguments);
      if (p.kind === "read") readCount++;
      else if (p.kind === "edit") editCount++;
      else if (p.kind === "run") runCount++;
      else if (p.kind === "search") searchCount++;
    }
    const breakdown: string[] = [];
    if (readCount > 0) breakdown.push(`Read ${readCount} ${readCount === 1 ? "file" : "files"}`);
    if (editCount > 0) breakdown.push(`Edit ${editCount} ${editCount === 1 ? "file" : "files"}`);
    if (runCount > 0) breakdown.push(`Run ${runCount} ${runCount === 1 ? "command" : "commands"}`);
    if (searchCount > 0) breakdown.push(`Search ${searchCount}`);
    const details = breakdown.length > 0 ? ` (${breakdown.slice(0, 2).join(", ")})` : "";
    title = `${tools.length} actions executed${details}`;
  }

  return (
    <div className={`tb-tool-group-container${expanded ? " is-expanded" : ""}${runningTool ? " is-running" : ""}`}>
      <button
        type="button"
        className="tb-tool-group-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <div className="tb-tool-group-header-left">
          <span className="tb-tool-group-icon">
            <ThemeIcon name="terminal" size={ICON_SIZE.dense} />
          </span>
          <span className="tb-tool-group-title">{title}</span>

          <span className="tb-tool-group-count-badge">
            {tools.length}
          </span>

          {runningTool && (
            <span className="tb-tool-group-spinner" aria-hidden="true" />
          )}

          {errorCount > 0 && !runningTool && (
            <span className="tb-tool-group-error-badge">
              {errorCount} failed
            </span>
          )}
        </div>

        <span className={`tb-tool-group-chevron${expanded ? " is-open" : ""}`}>
          <ThemeIcon name="chevron-right" size={ICON_SIZE.dense} />
        </span>
      </button>

      {expanded && (
        <div className="tb-tool-group-body">
          <div className="tb-tool-group-list">
            {tools.map((tool) => (
              <ToolChip key={tool.toolCallId} tool={tool} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
