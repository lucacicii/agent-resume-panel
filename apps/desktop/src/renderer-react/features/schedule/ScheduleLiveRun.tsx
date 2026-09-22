import { useEffect, useRef, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { StreamdownRenderer } from "../../components/StreamdownRenderer";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import type {
  ThunderSchedule,
  ThunderAgentEvent,
  ThunderScheduleRunLogEntry
} from "@agent-resume/core";

interface ScheduleLiveRunProps {
  schedule: ThunderSchedule;
  activeRunId: string | null;
  onRunFinished?: () => void;
}

export function ScheduleLiveRun({
  schedule,
  activeRunId,
  onRunFinished
}: ScheduleLiveRunProps) {
  const { ready, t } = useI18n();
  const text = (key: string, fallback: string) => (ready ? t(key) : fallback);

  const [isRunning, setIsRunning] = useState(Boolean(activeRunId || schedule.lastStatus === "running"));
  const [currentRunId, setCurrentRunId] = useState<string | null>(activeRunId);
  const [streamOutput, setStreamOutput] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(schedule.lastError || null);
  const [events, setEvents] = useState<ThunderScheduleRunLogEntry[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeRunId) {
      setCurrentRunId(activeRunId);
      setIsRunning(true);
      setStreamOutput("");
      setReasoning("");
      setErrorMessage(null);
      setEvents([]);
    }
  }, [activeRunId]);

  useEffect(() => {
    const unsubEvent = desktopApi().onScheduleRunEvent?.((payload) => {
      if (payload.scheduleId === schedule.id) {
        setIsRunning(true);
        if (payload.runId) setCurrentRunId(payload.runId);
        if (payload.accumulatedOutput) {
          setStreamOutput(payload.accumulatedOutput);
        }

        const ev = payload.event;
        const now = Date.now();

        if (ev.type === "reasoning_delta") {
          setReasoning((prev) => prev + ((ev as any).delta || ""));
        } else if (ev.type === "error") {
          const msg = (ev as any).message || "Execution error";
          setErrorMessage(msg);
          setEvents((prev) => [
            ...prev,
            {
              timestamp: now,
              type: "error",
              content: msg
            }
          ]);
        } else if (ev.type === "tool_exec_start") {
          setEvents((prev) => [
            ...prev,
            {
              timestamp: now,
              type: "tool_start",
              turn: (ev as any).turn,
              toolName: (ev as any).name,
              toolArgs: (ev as any).arguments
            }
          ]);
        } else if (ev.type === "tool_exec_result") {
          setEvents((prev) => [
            ...prev,
            {
              timestamp: now,
              type: "tool_result",
              turn: (ev as any).turn,
              toolName: (ev as any).name,
              toolResult: (ev as any).result
            }
          ]);
        } else if (ev.type === "turn_start") {
          setEvents((prev) => [
            ...prev,
            {
              timestamp: now,
              type: "turn",
              turn: (ev as any).turn
            }
          ]);
        }
      }
    });

    const unsubStatus = desktopApi().onScheduleStatusChanged?.((payload) => {
      if (payload.scheduleId === schedule.id) {
        if (payload.status === "completed" || payload.status === "failed" || payload.status === "cancelled") {
          setIsRunning(false);
          setCancelling(false);
          if (payload.output) setStreamOutput(payload.output);
          if (payload.status === "failed") {
            setErrorMessage(payload.error || "Execution failed");
          }
          onRunFinished?.();
        } else if (payload.status === "running") {
          setIsRunning(true);
          setErrorMessage(null);
        }
      }
    });

    return () => {
      unsubEvent?.();
      unsubStatus?.();
    };
  }, [schedule.id, onRunFinished]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, streamOutput]);

  const handleCancel = async () => {
    if (!currentRunId) return;
    setCancelling(true);
    try {
      await desktopApi().schedulesCancelRun({ runId: currentRunId });
    } catch (err) {
      console.error("Failed to cancel schedule run:", err);
    } finally {
      setCancelling(false);
    }
  };

  const hasContent = streamOutput.length > 0 || events.length > 0;

  return (
    <div className="schedule-live-run">
      <div className="schedule-live-header">
        <div className="schedule-live-status">
          {isRunning ? (
            <>
              <span className="status-dot status-dot-running" />
              <span className="schedule-live-status-text">
                {text("desktop.schedule.running", "Thunder Agent is working…")}
              </span>
            </>
          ) : (
            <>
              <span className="status-dot status-dot-idle" />
              <span className="schedule-live-status-text">
                {text("desktop.schedule.idle", "Idle")}
              </span>
            </>
          )}
        </div>

        {isRunning && currentRunId ? (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={handleCancel}
            disabled={cancelling}
          >
            <ThemeIcon name="close" size={14} />
            <span>{cancelling ? text("desktop.schedule.cancelling", "Stopping…") : text("desktop.schedule.stop", "Stop Task")}</span>
          </button>
        ) : null}
      </div>

      {!hasContent && !isRunning && !errorMessage ? (
        <div className="schedule-empty-state">
          <ThemeIcon name="terminal" size={ICON_SIZE.hero} />
          <p>{text("desktop.schedule.noActiveRun", "No active execution. Click 'Run Now' to execute this schedule.")}</p>
        </div>
      ) : (
        <div className="schedule-live-body">
          {errorMessage && (
            <div className="schedule-run-error-box">
              <ThemeIcon name="close" size={14} />
              <span>{errorMessage}</span>
            </div>
          )}

          {reasoning ? (
            <div className="schedule-live-reasoning">
              <div className="schedule-live-reasoning-title">
                <ThemeIcon name="sparkles" size={12} />
                <span>{text("desktop.schedule.thinkingProcess", "Thinking / Reasoning Process")}</span>
              </div>
              <pre className="schedule-live-reasoning-body">{reasoning}</pre>
            </div>
          ) : null}

          {events.length > 0 ? (
            <div className="schedule-live-events">
              <div className="schedule-live-events-title">
                {text("desktop.schedule.activityLog", "Agent Tool Calls & Activity")}
              </div>
              <div className="schedule-live-events-list">
                {events.map((e, idx) => (
                  <div key={idx} className={`schedule-event-row schedule-event-${e.type}`}>
                    {e.type === "turn" && (
                      <span className="schedule-event-turn">Turn {e.turn}</span>
                    )}
                    {e.type === "tool_start" && (
                      <div className="schedule-event-tool">
                        <ThemeIcon name="wrench" size={12} />
                        <span className="schedule-tool-name">{e.toolName}</span>
                        {e.toolArgs && (
                          <pre className="schedule-tool-args">
                            {JSON.stringify(e.toolArgs, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                    {e.type === "tool_result" && (
                      <div className="schedule-event-result">
                        <ThemeIcon name="check" size={12} />
                        <span className="schedule-tool-name">{e.toolName} completed</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {streamOutput ? (
            <div className="schedule-live-output">
              <div className="schedule-live-output-title">
                {text("desktop.schedule.agentOutput", "Output Response")}
              </div>
              <div className="schedule-live-markdown">
                <StreamdownRenderer content={streamOutput} />
              </div>
            </div>
          ) : null}

          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
}
