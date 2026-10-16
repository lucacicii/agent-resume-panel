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

export interface ParsedToolSummary {
  verb: string;
  target: string;
  fullTarget?: string;
  badge?: string;
  kind: "read" | "edit" | "run" | "search" | "mcp" | "other";
  command?: string;
  diffContent?: string;
}

export function parseToolCall(name: string, rawArgs: unknown): ParsedToolSummary {
  let args: Record<string, unknown> = {};
  if (typeof rawArgs === "object" && rawArgs !== null) {
    args = rawArgs as Record<string, unknown>;
  } else if (typeof rawArgs === "string") {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      args = { raw: rawArgs };
    }
  }

  const lower = name.toLowerCase();

  // 1. File reading / viewing
  if (lower.includes("read") || lower.includes("view") || lower === "cat" || lower === "fetch") {
    const rawPath = String(args.AbsolutePath || args.TargetFile || args.path || args.file_path || args.target || args.file || "");
    const base = rawPath ? rawPath.split("/").filter(Boolean).pop() || rawPath : "";
    let lineRange = "";
    if (args.StartLine !== undefined && args.EndLine !== undefined) {
      lineRange = `L${args.StartLine}-${args.EndLine}`;
    } else if (args.StartLine !== undefined) {
      lineRange = `L${args.StartLine}+`;
    }
    return {
      verb: "Read",
      target: base || name,
      fullTarget: rawPath || undefined,
      badge: lineRange || undefined,
      kind: "read"
    };
  }

  // 2. File editing / writing / creating
  if (lower.includes("replace") || lower.includes("write") || lower.includes("edit") || lower.includes("patch")) {
    const rawPath = String(args.TargetFile || args.AbsolutePath || args.path || args.file_path || "");
    const base = rawPath ? rawPath.split("/").filter(Boolean).pop() || rawPath : "";
    const isCreate = lower.includes("write") && args.Overwrite !== true;
    let badge = "";
    let diffContent = "";
    if (typeof args.diff === "string" || typeof args.Diff === "string" || typeof args.patch === "string") {
      diffContent = String(args.diff || args.Diff || args.patch);
      const added = (diffContent.match(/^\+[^+]/gm) || []).length;
      const removed = (diffContent.match(/^-[^-]/gm) || []).length;
      if (added > 0 || removed > 0) {
        badge = `+${added} -${removed}`;
      }
    } else if (typeof args.new_str === "string" && typeof args.old_str === "string") {
      const added = args.new_str.split("\n").length;
      const removed = args.old_str.split("\n").length;
      badge = `+${added} -${removed}`;
      diffContent = args.new_str;
    }
    return {
      verb: isCreate ? "Create" : "Edit",
      target: base || name,
      fullTarget: rawPath || undefined,
      badge: badge || undefined,
      kind: "edit",
      diffContent: diffContent || undefined
    };
  }

  // 3. Command execution / shell
  if (lower.includes("bash") || lower.includes("command") || lower.includes("shell") || lower.includes("exec")) {
    const cmd = String(args.CommandLine || args.command || args.cmd || args.raw || "").trim();
    return {
      verb: "Run",
      target: cmd ? (cmd.length > 42 ? `${cmd.slice(0, 39)}...` : cmd) : name,
      fullTarget: cmd || undefined,
      command: cmd || undefined,
      kind: "run"
    };
  }

  // 4. Searching
  if (lower.includes("search") || lower.includes("find") || lower.includes("grep")) {
    const query = String(args.query || args.pattern || args.search || "").trim();
    const scope = String(args.path || args.dir || args.target || "").trim();
    const badge = scope ? scope.split("/").filter(Boolean).pop() : undefined;
    return {
      verb: "Search",
      target: query ? (query.length > 35 ? `"${query.slice(0, 32)}..."` : `"${query}"`) : name,
      fullTarget: query || undefined,
      badge,
      kind: "search"
    };
  }

  // 5. MCP tools
  if (lower.includes("mcp") && (args.ToolName || args.name)) {
    const toolName = String(args.ToolName || args.name);
    const serverName = args.ServerName ? `${args.ServerName}:` : "";
    return {
      verb: "MCP",
      target: `${serverName}${toolName}`,
      fullTarget: JSON.stringify(args),
      kind: "mcp"
    };
  }

  return {
    verb: "Call",
    target: name,
    kind: "other"
  };
}

export function ToolChip({ tool }: ToolChipProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const icon = resolveToolIcon(tool.name);
  const parsed = parseToolCall(tool.name, tool.arguments);

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
          <span className="tb-tool-verb">{parsed.verb}</span>
          <span className="tb-tool-target" title={parsed.fullTarget || parsed.target}>
            {parsed.target}
          </span>
          {parsed.badge && (
            <span className="tb-tool-meta-badge" title={parsed.badge}>
              {parsed.badge}
            </span>
          )}
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
          {parsed.kind === "run" && parsed.command && (
            <div className="tb-tool-inline-preview is-terminal">
              <div className="tb-tool-terminal-header">
                <div className="tb-tool-terminal-prompt-box">
                  <span className="tb-tool-terminal-prompt">$</span>
                  <span className="tb-tool-terminal-cmd" title={parsed.command}>
                    {parsed.command}
                  </span>
                </div>
                <button
                  type="button"
                  className="tb-tool-copy-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(parsed.command!);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  title="Copy Command"
                >
                  <ThemeIcon name={copied ? "check" : "copy"} size={ICON_SIZE.inline} />
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>
              </div>
              {formattedResult && (
                <div className="tb-tool-terminal-body">
                  <pre className="tb-tool-code-preview">{formattedResult}</pre>
                </div>
              )}
            </div>
          )}

          {parsed.kind === "edit" && (parsed.diffContent || formattedResult) && (
            <div className="tb-tool-inline-preview is-diff">
              <div className="tb-tool-section-header">
                <span className="tb-tool-section-label">
                  {parsed.fullTarget || parsed.target} {parsed.badge ? `(${parsed.badge})` : ""}
                </span>
                <button
                  type="button"
                  className="tb-tool-copy-btn"
                  onClick={handleCopy}
                  title="Copy changes"
                >
                  <ThemeIcon name={copied ? "check" : "copy"} size={ICON_SIZE.inline} />
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>
              </div>
              <pre className="tb-tool-code-preview">
                {parsed.diffContent || formattedResult}
              </pre>
            </div>
          )}

          {parsed.kind !== "run" && parsed.kind !== "edit" && formattedArgs && (
            <div className="tb-tool-section">
              <div className="tb-tool-section-label">Input Parameters</div>
              <pre className="tb-tool-code-preview">{formattedArgs}</pre>
            </div>
          )}

          {parsed.kind !== "run" && parsed.kind !== "edit" && formattedResult && (
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
