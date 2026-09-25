import { useCallback, useRef, useState } from "react";
import { desktopApi } from "../../bridge";
import type {
  ThunderActiveStreamSnapshot,
  ThunderAgentEvent,
  ThunderFileChangeRecord,
  ThunderTaskTrace,
  ThunderTelemetryNotice
} from "@agent-resume/core";

export interface TraceSpan {
  id: string;
  turn: number;
  type: "turn" | "thinking" | "token" | "tool" | "telemetry" | "file";
  name: string;
  startedAtMs: number;
  durationMs?: number;
  status: "running" | "completed" | "failed";
  data?: Record<string, unknown>;
}

export function useTraceCollector() {
  const [currentTrace, setCurrentTrace] = useState<ThunderTaskTrace | null>(null);
  const [spans, setSpans] = useState<TraceSpan[]>([]);
  const [fileChanges, setFileChanges] = useState<ThunderFileChangeRecord[]>([]);
  const [telemetryNotices, setTelemetryNotices] = useState<ThunderTelemetryNotice[]>([]);
  const [isCollecting, setIsCollecting] = useState(false);

  const activeTaskIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const startTimesRef = useRef<Map<string, number>>(new Map());

  const resetTrace = useCallback(() => {
    setCurrentTrace(null);
    setSpans([]);
    setFileChanges([]);
    setTelemetryNotices([]);
    setIsCollecting(false);
    activeTaskIdRef.current = null;
    activeSessionIdRef.current = null;
    startTimesRef.current.clear();
  }, []);

  const startTaskTrace = useCallback(
    (options: {
      taskId: string;
      sessionId: string;
      model?: string;
      workspaceDir?: string;
      prompt?: string;
    }) => {
      const now = Date.now();
      activeTaskIdRef.current = options.taskId;
      activeSessionIdRef.current = options.sessionId;
      setIsCollecting(true);
      setSpans([]);
      setFileChanges([]);
      setTelemetryNotices([]);

      const initialTrace: ThunderTaskTrace = {
        task_id: options.taskId,
        session_id: options.sessionId,
        model: options.model,
        workspace_dir: options.workspaceDir,
        prompt: options.prompt,
        started_at_ms: now,
        events: []
      };
      setCurrentTrace(initialTrace);
    },
    []
  );

  const recordEvent = useCallback((ev: ThunderAgentEvent, taskId: string) => {
    if (activeTaskIdRef.current && taskId !== activeTaskIdRef.current) return;
    const now = Date.now();

    switch (ev.type) {
      case "turn_start": {
        const turn = (ev as any).turn || 1;
        const spanId = `turn_${turn}`;
        startTimesRef.current.set(spanId, (ev as any).timestamp || now);
        setSpans((prev) => [
          ...prev,
          {
            id: spanId,
            turn,
            type: "turn",
            name: `Turn ${turn}`,
            startedAtMs: (ev as any).timestamp || now,
            status: "running"
          }
        ]);
        break;
      }

      case "reasoning_delta": {
        const turn = (ev as any).turn || 1;
        const spanId = `reasoning_${turn}`;
        setSpans((prev) => {
          const existing = prev.find((s) => s.id === spanId);
          if (existing) {
            const count = ((existing.data?.tokenCount as number) || 0) + 1;
            const start = existing.startedAtMs;
            return prev.map((s) =>
              s.id === spanId
                ? {
                    ...s,
                    durationMs: now - start,
                    data: { ...s.data, tokenCount: count }
                  }
                : s
            );
          }
          return [
            ...prev,
            {
              id: spanId,
              turn,
              type: "thinking",
              name: `Reasoning`,
              startedAtMs: now,
              durationMs: 0,
              status: "running",
              data: { tokenCount: 1 }
            }
          ];
        });
        break;
      }

      case "token_delta": {
        const turn = (ev as any).turn || 1;
        const spanId = `token_${turn}`;
        setSpans((prev) => {
          const existing = prev.find((s) => s.id === spanId);
          if (existing) {
            const count = ((existing.data?.tokenCount as number) || 0) + 1;
            const start = existing.startedAtMs;
            return prev.map((s) =>
              s.id === spanId
                ? {
                    ...s,
                    durationMs: now - start,
                    data: { ...s.data, tokenCount: count }
                  }
                : s
            );
          }
          return [
            ...prev,
            {
              id: spanId,
              turn,
              type: "token",
              name: `Assistant Response`,
              startedAtMs: now,
              durationMs: 0,
              status: "running",
              data: { tokenCount: 1 }
            }
          ];
        });
        break;
      }

      case "tool_exec_start": {
        const toolCallId = (ev as any).tool_call_id || `tool_${now}`;
        const name = (ev as any).name || "tool";
        const turn = (ev as any).turn || 1;
        startTimesRef.current.set(toolCallId, now);

        setSpans((prev) => [
          ...prev,
          {
            id: toolCallId,
            turn,
            type: "tool",
            name: `${name}`,
            startedAtMs: now,
            status: "running",
            data: {
              toolCallId,
              name,
              arguments: (ev as any).arguments
            }
          }
        ]);
        break;
      }

      case "tool_exec_result": {
        const toolCallId = (ev as any).tool_call_id;
        const name = (ev as any).name;
        const res = (ev as any).result;
        const isError = Boolean(res?.is_error);
        const startTime = startTimesRef.current.get(toolCallId) || now;
        const duration = res?.duration_ms ?? (now - startTime);

        setSpans((prev) =>
          prev.map((s) =>
            s.id === toolCallId
              ? {
                  ...s,
                  durationMs: duration,
                  status: isError ? "failed" : "completed",
                  data: {
                    ...s.data,
                    isError,
                    output: res?.output,
                    telemetry: res?.telemetry
                  }
                }
              : s
          )
        );

        // If result carried telemetry, register it
        if (res?.telemetry) {
          const tNotice = res.telemetry as ThunderTelemetryNotice;
          setTelemetryNotices((prev) => {
            const exists = prev.some(
              (n) => n.layer === tNotice.layer && n.action === tNotice.action
            );
            return exists ? prev : [...prev, tNotice];
          });
        }
        break;
      }

      case "file_change": {
        const fc = ev as any;
        const record: ThunderFileChangeRecord = {
          path: fc.path,
          tool: fc.tool_name || "tool",
          action: fc.action || "modified",
          bytes: fc.bytes,
          turn: fc.turn,
          timestamp: now,
          toolCallId: fc.tool_call_id
        };

        setFileChanges((prev) => {
          // Avoid exact duplicates
          const exists = prev.some(
            (p) => p.path === record.path && p.action === record.action && p.turn === record.turn
          );
          return exists ? prev : [...prev, record];
        });

        setSpans((prev) => [
          ...prev,
          {
            id: `file_${fc.tool_call_id || now}_${fc.path}`,
            turn: fc.turn || 1,
            type: "file",
            name: `${record.action} ${record.path}`,
            startedAtMs: now,
            durationMs: 0,
            status: record.action === "failed" ? "failed" : "completed",
            data: { fileChange: record }
          }
        ]);
        break;
      }

      case "telemetry_notice": {
        const tn = ev as any;
        const notice: ThunderTelemetryNotice = {
          layer: tn.layer,
          action: tn.action,
          ground_truth: tn.ground_truth,
          self_healed: tn.self_healed,
          guidance: tn.guidance
        };

        setTelemetryNotices((prev) => {
          const exists = prev.some(
            (n) => n.layer === notice.layer && n.action === notice.action
          );
          return exists ? prev : [...prev, notice];
        });

        setSpans((prev) => [
          ...prev,
          {
            id: `telem_${now}`,
            turn: tn.turn || 1,
            type: "telemetry",
            name: `[${notice.layer}] ${notice.action}`,
            startedAtMs: now,
            durationMs: 0,
            status: "completed",
            data: { telemetry: notice }
          }
        ]);
        break;
      }

      case "turn_end": {
        const turn = (ev as any).turn || 1;
        const turnSpanId = `turn_${turn}`;
        const start = startTimesRef.current.get(turnSpanId) || now;

        setSpans((prev) =>
          prev.map((s) => {
            if (s.id === turnSpanId) {
              return {
                ...s,
                durationMs: now - start,
                status: "completed",
                data: { stats: (ev as any).stats }
              };
            }
            if (s.turn === turn && s.status === "running") {
              return {
                ...s,
                status: "completed",
                durationMs: s.durationMs || (now - s.startedAtMs)
              };
            }
            return s;
          })
        );
        break;
      }
    }
  }, []);

  /**
   * Rebuild the live trace (spans, file changes, telemetry) from a snapshot the
   * main process buffered for an in-flight task. Replays through `recordEvent`
   * so the restored timeline matches one that streamed without interruption.
   */
  const restoreFromSnapshot = useCallback(
    (snapshot: ThunderActiveStreamSnapshot) => {
      activeTaskIdRef.current = snapshot.taskId;
      activeSessionIdRef.current = snapshot.sessionId;
      startTimesRef.current.clear();
      setIsCollecting(true);
      setSpans([]);
      setFileChanges([]);
      setTelemetryNotices([]);
      setCurrentTrace({
        task_id: snapshot.taskId,
        session_id: snapshot.sessionId,
        model: snapshot.model,
        workspace_dir: snapshot.workspaceDir,
        prompt: snapshot.prompt,
        started_at_ms: snapshot.startedAtMs,
        events: []
      });
      for (const observed of snapshot.events) {
        recordEvent(observed.event, snapshot.taskId);
      }
    },
    [recordEvent]
  );

  const finishTaskTrace = useCallback(
    (result: { finishReason: string; finalContent?: string }) => {
      const now = Date.now();
      setIsCollecting(false);

      setSpans((prev) =>
        prev.map((s) => (s.status === "running" ? { ...s, status: "completed" } : s))
      );

      setCurrentTrace((prev) => {
        if (!prev) return null;
        const start = prev.started_at_ms || now;
        return {
          ...prev,
          finished_at_ms: now,
          duration_ms: now - start,
          finish_reason: result.finishReason,
          final_content: result.finalContent
        };
      });

      activeTaskIdRef.current = null;
    },
    []
  );

  const loadTrace = useCallback(async (sessionId: string, taskId?: string) => {
    try {
      if (typeof desktopApi().thunderChatGetTrace !== "function") return;
      const trace = await desktopApi().thunderChatGetTrace({ sessionId, taskId });
      if (!trace) return;

      setCurrentTrace(trace);

      // Reconstruct spans from trace events if available
      if (Array.isArray(trace.events)) {
        const reconstructedSpans: TraceSpan[] = [];
        const reconstructedFiles: ThunderFileChangeRecord[] = [];
        const reconstructedNotices: ThunderTelemetryNotice[] = [];

        for (const wrapped of trace.events) {
          const ev = wrapped?.event;
          if (!ev) continue;

          if (ev.type === "tool_exec_result") {
            const t = ev as any;
            reconstructedSpans.push({
              id: t.tool_call_id || `tool_${Date.now()}`,
              turn: t.turn || 1,
              type: "tool",
              name: t.name || "tool",
              startedAtMs: trace.started_at_ms,
              durationMs: t.result?.duration_ms,
              status: t.result?.is_error ? "failed" : "completed",
              data: {
                name: t.name,
                output: t.result?.output,
                isError: t.result?.is_error,
                telemetry: t.result?.telemetry
              }
            });

            if (t.result?.telemetry) {
              reconstructedNotices.push(t.result.telemetry);
            }
          } else if (ev.type === "file_change") {
            const fc = ev as any;
            reconstructedFiles.push({
              path: fc.path,
              tool: fc.tool_name || "tool",
              action: fc.action || "modified",
              bytes: fc.bytes,
              turn: fc.turn,
              timestamp: trace.started_at_ms,
              toolCallId: fc.tool_call_id
            });
          } else if (ev.type === "telemetry_notice") {
            const tn = ev as any;
            reconstructedNotices.push({
              layer: tn.layer,
              action: tn.action,
              ground_truth: tn.ground_truth,
              self_healed: tn.self_healed,
              guidance: tn.guidance
            });
          }
        }

        if (reconstructedSpans.length > 0) setSpans(reconstructedSpans);
        if (reconstructedFiles.length > 0) setFileChanges(reconstructedFiles);
        if (reconstructedNotices.length > 0) setTelemetryNotices(reconstructedNotices);
      }
      return trace;
    } catch (err) {
      console.warn("[useTraceCollector] Failed to load trace:", err);
      return null;
    }
  }, []);

  return {
    currentTrace,
    spans,
    fileChanges,
    telemetryNotices,
    isCollecting,
    startTaskTrace,
    recordEvent,
    finishTaskTrace,
    loadTrace,
    restoreFromSnapshot,
    resetTrace,
    setFileChanges,
    setTelemetryNotices
  };
}
