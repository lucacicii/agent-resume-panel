import React, { useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import type { ThunderTaskTrace, ThunderTelemetryNotice } from "@agent-resume/core";
import type { TraceSpan } from "./useTraceCollector";

interface TracePopoverProps {
  isOpen: boolean;
  onClose: () => void;
  trace: ThunderTaskTrace | null;
  spans: TraceSpan[];
  telemetryNotices: ThunderTelemetryNotice[];
  isCollecting: boolean;
}

export function TracePopover({
  isOpen,
  onClose,
  trace,
  spans,
  telemetryNotices,
  isCollecting
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
    const data = {
      trace,
      spans,
      telemetryNotices
    };
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

  const durationSec = trace?.duration_ms
    ? (trace.duration_ms / 1000).toFixed(2)
    : undefined;

  const status = isCollecting
    ? "running"
    : trace?.finish_reason === "error"
    ? "failed"
    : trace
    ? "completed"
    : "idle";

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
            {trace?.model && (
              <span className="tb-trace-pill tb-trace-model">{trace.model}</span>
            )}
            {durationSec && (
              <span className="tb-trace-pill tb-trace-duration">
                <ThemeIcon name="clock" size={ICON_SIZE.inline} />
                {durationSec}s
              </span>
            )}
            {trace?.stats && (
              <span className="tb-trace-pill tb-trace-tokens">
                {(trace.stats.total_prompt_tokens || 0) +
                  (trace.stats.total_completion_tokens || 0)}{" "}
                tokens
              </span>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className="tb-trace-body">
          {/* Telemetry System Notices (Ground Truth) */}
          {telemetryNotices.length > 0 && (
            <div className="tb-trace-section">
              <div className="tb-trace-section-header">
                <ThemeIcon name="shield-check" size={ICON_SIZE.dense} />
                <span>System Telemetry Notices ({telemetryNotices.length})</span>
              </div>
              <div className="tb-trace-telemetry-list">
                {telemetryNotices.map((notice, idx) => (
                  <div key={`notice_${idx}`} className="tb-trace-telemetry-item">
                    <div className="tb-trace-telemetry-layer">
                      <span className="tb-trace-tag">{notice.layer}</span>
                      <span className="tb-trace-telemetry-action">{notice.action}</span>
                    </div>
                    <div className="tb-trace-telemetry-truth">
                      <span className="tb-trace-label">Ground Truth:</span> {notice.ground_truth}
                    </div>
                    {notice.self_healed && (
                      <div className="tb-trace-telemetry-healed">
                        <span className="tb-trace-label">Self-Healed:</span> {notice.self_healed}
                      </div>
                    )}
                    {notice.guidance && (
                      <div className="tb-trace-telemetry-guide">
                        <span className="tb-trace-label">Guidance:</span> {notice.guidance}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline Spans */}
          {spans.length === 0 ? (
            <div className="tb-trace-empty">
              <ThemeIcon name="activity" size={ICON_SIZE.prominent} />
              <p>No active execution trace available for this turn.</p>
              <span>Traces track prompts, thinking, bash commands, file changes, and telemetry.</span>
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
                              {span.type === "file" && (
                                <ThemeIcon name="file-diff" size={ICON_SIZE.inline} />
                              )}
                              {span.type === "telemetry" && (
                                <ThemeIcon name="shield-check" size={ICON_SIZE.inline} />
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
