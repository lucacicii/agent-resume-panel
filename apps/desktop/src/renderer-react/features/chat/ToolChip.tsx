import React, { useState } from "react";
import { ICON_SIZE, ThemeIcon, type ThemeIconName } from "../../components/ThemeIcon";
import type { ActiveToolInfo } from "./useThunderChat";

interface ToolChipProps {
  tool: ActiveToolInfo;
}

function resolveToolIcon(name: string): ThemeIconName {
  const lower = name.toLowerCase();
  if (lower.includes("bash") || lower.includes("shell") || lower.includes("cmd") || lower.includes("exec")) {
    return "terminal";
  }
  if (lower.includes("file") || lower.includes("read") || lower.includes("write")) {
    return "file-code";
  }
  if (lower.includes("search") || lower.includes("find") || lower.includes("grep")) {
    return "search";
  }
  if (lower.includes("git")) {
    return "git-branch";
  }
  return "bot";
}

export function ToolChip({ tool }: ToolChipProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const icon = resolveToolIcon(tool.name);

  const formattedArgs = typeof tool.arguments === "string"
    ? tool.arguments
    : JSON.stringify(tool.arguments, null, 2);

  const formattedResult = tool.result !== undefined
    ? typeof tool.result === "string"
      ? tool.result
      : JSON.stringify(tool.result, null, 2)
    : "";

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const textToCopy = formattedResult || formattedArgs;
    if (textToCopy) {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className={`tb-tool-chip${expanded ? " is-expanded" : ""}${tool.isRunning ? " is-running" : ""}${tool.isError ? " is-error" : ""}`}>
      <button
        type="button"
        className="tb-tool-chip-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <div className="tb-tool-chip-header-left">
          <span className="tb-tool-icon">
            <ThemeIcon name={icon} size={ICON_SIZE.dense} />
          </span>
          <span className="tb-tool-name">{tool.name}</span>
          {tool.isRunning && (
            <span className="tb-tool-status running">
              <span className="tb-tool-spinner" />
              <span>Running</span>
            </span>
          )}
          {!tool.isRunning && !tool.isError && (
            <span className="tb-tool-status success">
              <ThemeIcon name="check" size={ICON_SIZE.inline} />
              <span>Done</span>
            </span>
          )}
          {tool.isError && (
            <span className="tb-tool-status error">
              <span>Failed</span>
            </span>
          )}
        </div>

        <div className="tb-tool-chip-header-right">
          <span className={`tb-tool-chevron${expanded ? " is-open" : ""}`}>
            <ThemeIcon name="chevron-right" size={ICON_SIZE.dense} />
          </span>
        </div>
      </button>

      {expanded && (
        <div className="tb-tool-chip-details">
          {formattedArgs && (
            <div className="tb-tool-section">
              <div className="tb-tool-section-label">Input Parameters</div>
              <pre className="tb-tool-code-preview">{formattedArgs}</pre>
            </div>
          )}

          {formattedResult && (
            <div className="tb-tool-section">
              <div className="tb-tool-section-header">
                <span className="tb-tool-section-label">Output</span>
                <button
                  type="button"
                  className="tb-tool-copy-btn"
                  onClick={handleCopy}
                  title="Copy Output"
                >
                  <ThemeIcon name={copied ? "check" : "copy"} size={ICON_SIZE.inline} />
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>
              </div>
              <pre className="tb-tool-code-preview">{formattedResult}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
