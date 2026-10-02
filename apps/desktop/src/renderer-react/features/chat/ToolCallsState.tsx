import React, { useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { ToolChip } from "./ToolChip";
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

  let title = `Used ${tools.length} tool${tools.length > 1 ? "s" : ""}`;
  if (toolNames) {
    title += ` (${toolNames})`;
  }
  if (runningTool) {
    title = `Running ${runningTool.name}...`;
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
