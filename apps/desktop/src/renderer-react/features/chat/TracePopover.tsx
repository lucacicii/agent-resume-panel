import React, { useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import type { TraceSpan } from "./useTraceCollector";

interface TracePopoverProps {
  isOpen: boolean;
  onClose: () => void;
  /** Collected client-side from the run's own events — thunder keeps no server trace. */
  spans: TraceSpan[];
}

export function TracePopover({
  isOpen,
  onClose,
  spans
}: TracePopoverProps): React.JSX.Element | null {
  const [expandedSpanIds, setExpandedSpanIds] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const toggleSpan = (id: string) => {
    setExpandedSpanIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopyJson = () => {
    const data = { spans };
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Group spans by turn
  const turnMap = new Map<number, TraceSpan[]>();
  for (const span of spans) {
    const list = turnMap.get(span.turn) || [];
    list.push(span);
    turnMap.set(span.turn, list);
  }

  // Both come from the spans themselves now: there is no server-side trace to ask
  // how long the run took, and every span carries its own start and duration.
  const running = spans.some((span) => span.status === "running");
  const failed = spans.some((span) => span.status === "failed");
  const finished = spans.filter((span) => span.type === "turn");
  const durationSec = finished.length
    ? (
        (Math.max(...finished.map((span) => span.startedAtMs + (span.durationMs ?? 0))) -
          Math.min(...finished.map((span) => span.startedAtMs))) /
        1000
      ).toFixed(2)
    : undefined;

  const status = running ? "running" : failed ? "failed" : spans.length ? "completed" : "idle";

  return (
    <div className="tb-trace-overlay" onClick={onClose}>
      <div className="tb-trace-popover" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="tb-trace-header">
          <div className="tb-trace-title-row">
            <div className="tb-trace-title">
              <ThemeIcon name="activity" size={ICON_SIZE.dense} />
              <span>Execution Trace</span>
            </div>
            <div className="tb-trace-actions">
              <button
                type="button"
                className="tb-trace-btn"
                onClick={handleCopyJson}
                title="Copy trace as JSON"
              >
                <ThemeIcon name={copied ? "check" : "copy"} size={ICON_SIZE.dense} />
                <span>{copied ? "Copied" : "JSON"}</span>
              </button>
              <button
                type="button"
                className="tb-trace-close-btn"
                onClick={onClose}
                title="Close"
              >
                <ThemeIcon name="close" size={ICON_SIZE.dense} />
              </button>
            </div>
          </div>

          {/* Meta Pills */}
          <div className="tb-trace-meta-pills">
            <span className={`tb-trace-pill tb-trace-status-${status}`}>
              <span className="tb-trace-status-dot" />
              {status.toUpperCase()}
            </span>
            {durationSec && (
              <span className="tb-trace-pill tb-trace-duration">
                <ThemeIcon name="clock" size={ICON_SIZE.inline} />
                {durationSec}s
              </span>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className="tb-trace-body">

          {/* Timeline Spans */}
          {spans.length === 0 ? (
            <div className="tb-trace-empty">
              <ThemeIcon name="activity" size={ICON_SIZE.prominent} />
              <p>No spans for this run yet.</p>
              <span>Spans are collected from the run itself: turns, thinking, tokens and tool calls.</span>
            </div>
          ) : (
            <div className="tb-trace-timeline">
              {Array.from(turnMap.entries()).map(([turn, turnSpans]) => (
                <div key={`turn_${turn}`} className="tb-trace-turn-group">
                  <div className="tb-trace-turn-header">
                    <span className="tb-trace-turn-tag">Turn {turn}</span>
                    <span className="tb-trace-turn-count">{turnSpans.length} events</span>
                  </div>

                  <div className="tb-trace-turn-spans">
                    {turnSpans.map((span) => {
                      const isExpanded = expandedSpanIds.has(span.id);
                      const isBash =
                        span.type === "tool" &&
                        (span.name === "bash" || span.data?.name === "bash");
                      const isWrite =
                        span.type === "tool" &&
                        (span.name === "write_file" || span.data?.name === "write_file");

                      return (
                        <div
                          key={span.id}
                          className={`tb-trace-span tb-trace-span-${span.type} tb-trace-status-${span.status}`}
                        >
                          <div
                            className="tb-trace-span-row"
                            onClick={() => toggleSpan(span.id)}
                          >
                            <span className="tb-trace-span-icon">
                              {span.type === "thinking" && (
                                <ThemeIcon name="sparkles" size={ICON_SIZE.inline} />
                              )}
                              {span.type === "token" && (
                                <ThemeIcon name="message-square" size={ICON_SIZE.inline} />
                              )}
                              {isBash && (
                                <ThemeIcon name="terminal" size={ICON_SIZE.inline} />
                              )}
                              {isWrite && (
                                <ThemeIcon name="file-code" size={ICON_SIZE.inline} />
                              )}
                              {span.type === "tool" && !isBash && !isWrite && (
                                <ThemeIcon name="wrench" size={ICON_SIZE.inline} />
                              )}
                            </span>

                            <div className="tb-trace-span-title-box">
                              <span className="tb-trace-span-name">
                                {isBash ? (
                                  <code>$ {(span.data?.arguments as any)?.command || span.name}</code>
                                ) : isWrite ? (
                                  <span>
                                    write_file:{" "}
                                    <code>{(span.data?.arguments as any)?.path || span.name}</code>
                                  </span>
                                ) : (
                                  span.name
                                )}
                              </span>
                            </div>

                            <div className="tb-trace-span-meta">
                              {span.durationMs !== undefined && span.durationMs > 0 && (
                                <span className="tb-trace-span-dur">
                                  {span.durationMs < 1000
                                    ? `${span.durationMs}ms`
                                    : `${(span.durationMs / 1000).toFixed(1)}s`}
                                </span>
                              )}
                              <span
                                className={`tb-trace-span-badge tb-trace-badge-${span.status}`}
                              >
                                {span.status}
                              </span>
                              <ThemeIcon
                                name={isExpanded ? "chevron-up" : "chevron-down"}
                                size={ICON_SIZE.inline}
                              />
                            </div>
                          </div>

                          {/* Expanded Details */}
                          {isExpanded && (
                            <div className="tb-trace-span-details">
                              {Boolean(span.data?.arguments) && (
                                <div className="tb-trace-detail-block">
                                  <div className="tb-trace-detail-label">Arguments:</div>
                                  <pre className="tb-trace-code">
                                    {JSON.stringify(span.data?.arguments, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {span.data?.output !== undefined && (
                                <div className="tb-trace-detail-block">
                                  <div className="tb-trace-detail-label">Output:</div>
                                  <pre className="tb-trace-code">
                                    {String(span.data.output)}
                                  </pre>
                                </div>
                              )}
                              {Boolean(span.data?.fileChange) && (
                                <div className="tb-trace-detail-block">
                                  <div className="tb-trace-detail-label">File Change:</div>
                                  <pre className="tb-trace-code">
                                    {JSON.stringify(span.data?.fileChange, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {Boolean(span.data?.telemetry) && (
                                <div className="tb-trace-detail-block">
                                  <div className="tb-trace-detail-label">Telemetry Notice:</div>
                                  <pre className="tb-trace-code">
                                    {JSON.stringify(span.data?.telemetry, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
