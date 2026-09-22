import { useEffect, useState } from "react";
import { ThemeIcon } from "../../components/ThemeIcon";
import { StreamdownRenderer } from "../../components/StreamdownRenderer";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import type {
  ThunderSchedule,
  ThunderScheduleRun,
  ThunderScheduleRunLogEntry
} from "@agent-resume/core";

interface ScheduleHistoryProps {
  schedule: ThunderSchedule;
}

export function ScheduleHistory({ schedule }: ScheduleHistoryProps) {
  const { ready, t } = useI18n();
  const text = (key: string, fallback: string, ...args: Array<string | number>) =>
    ready ? t(key, ...args) : fallback.replace("{0}", String(args[0] ?? ""));

  const [runs, setRuns] = useState<ThunderScheduleRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadRuns = async () => {
    try {
      setLoading(true);
      const data = await desktopApi().schedulesListRuns({ scheduleId: schedule.id, limit: 50 });
      setRuns(data);
      if (data.length > 0 && !selectedRunId) {
        setSelectedRunId(data[0].id);
      }
    } catch (err) {
      console.error("Failed to load runs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRuns();
  }, [schedule.id]);

  const selectedRun = runs.find((r) => r.id === selectedRunId) || runs[0];

  const formatTime = (ms: number) => {
    return new Date(ms).toLocaleString();
  };

  const formatDuration = (start: number, end?: number) => {
    if (!end) return "-";
    const sec = Math.round((end - start) / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    return `${min}m ${remSec}s`;
  };

  let parsedLogs: ThunderScheduleRunLogEntry[] = [];
  if (selectedRun?.logsJson) {
    try {
      parsedLogs = JSON.parse(selectedRun.logsJson);
    } catch {
      parsedLogs = [];
    }
  }

  return (
    <div className="schedule-history">
      <div className="schedule-history-sidebar">
        <div className="schedule-history-toolbar">
          <span className="schedule-history-count">
            {text("desktop.schedule.totalRuns", "Executions ({0})", runs.length)}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void loadRuns()}
            title={text("desktop.top.refresh", "Refresh")}
          >
            <ThemeIcon name="refresh" size={14} />
          </button>
        </div>

        {loading ? (
          <div className="schedule-history-loading">
            <ThemeIcon name="loader" size={16} />
            <span>{text("desktop.top.loading", "Loading…")}</span>
          </div>
        ) : runs.length === 0 ? (
          <div className="schedule-empty-state-sm">
            <p>{text("desktop.schedule.noRuns", "No execution history yet.")}</p>
          </div>
        ) : (
          <div className="schedule-history-list">
            {runs.map((r) => {
              const isSelected = r.id === (selectedRun?.id);
              return (
                <button
                  type="button"
                  key={r.id}
                  className={`schedule-history-row${isSelected ? " is-active" : ""}`}
                  onClick={() => setSelectedRunId(r.id)}
                >
                  <div className="schedule-history-row-header">
                    <span className={`schedule-status-badge schedule-status-${r.status}`}>
                      {r.status}
                    </span>
                    <span className="schedule-history-source">
                      {r.triggerSource === "manual" ? "Manual" : "Scheduled"}
                    </span>
                  </div>
                  <div className="schedule-history-row-time">
                    {formatTime(r.startedAtMs)}
                  </div>
                  <div className="schedule-history-row-duration">
                    Duration: {formatDuration(r.startedAtMs, r.finishedAtMs)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="schedule-history-detail">
        {selectedRun ? (
          <div className="schedule-run-detail-pane">
            <div className="schedule-run-detail-header">
              <div className="schedule-run-detail-info">
                <span className={`schedule-status-badge schedule-status-${selectedRun.status}`}>
                  {selectedRun.status.toUpperCase()}
                </span>
                <span className="schedule-run-time">{formatTime(selectedRun.startedAtMs)}</span>
                <span className="schedule-run-duration">
                  Duration: {formatDuration(selectedRun.startedAtMs, selectedRun.finishedAtMs)}
                </span>
              </div>
            </div>

            {selectedRun.error && (
              <div className="schedule-run-error-box">
                <ThemeIcon name="close" size={14} />
                <span>{selectedRun.error}</span>
              </div>
            )}

            {parsedLogs.length > 0 && (
              <div className="schedule-run-logs-section">
                <h4 className="schedule-section-heading">
                  {text("desktop.schedule.logsHeading", "Execution Activity")}
                </h4>
                <div className="schedule-logs-box">
                  {parsedLogs.map((l, idx) => (
                    <div key={idx} className="schedule-log-entry">
                      {l.type === "turn" && (
                        <span className="log-turn">Turn {l.turn}</span>
                      )}
                      {l.type === "tool_start" && (
                        <span className="log-tool-call">
                          Tool: <strong>{l.toolName}</strong>
                        </span>
                      )}
                      {l.type === "tool_result" && (
                        <span className="log-tool-result">
                          Result for {l.toolName}
                        </span>
                      )}
                      {l.type === "error" && (
                        <span className="log-error">{l.content}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="schedule-run-output-section">
              <h4 className="schedule-section-heading">
                {text("desktop.schedule.outputHeading", "Final Output")}
              </h4>
              <div className="schedule-run-output-box">
                {selectedRun.output ? (
                  <StreamdownRenderer content={selectedRun.output} />
                ) : (
                  <p className="schedule-dim-text">
                    {text("desktop.schedule.noOutput", "No output produced.")}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="schedule-empty-state">
            <p>{text("desktop.schedule.selectRun", "Select a run to view details.")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
