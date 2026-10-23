import { useCallback, useRef, useState } from "react";
import type {
  ThunderActiveStreamSnapshot,
  ThunderAgentEvent,
  ThunderFileChangeRecord
} from "@agent-resume/core";

export interface TraceSpan {
  id: string;
  turn: number;
  type: "turn" | "thinking" | "token" | "tool";
  name: string;
  startedAtMs: number;
  durationMs?: number;
  status: "running" | "completed" | "failed";
  data?: Record<string, unknown>;
}

/** Tools whose arguments name a file, and what touching it means. */
const FILE_TOOLS: Record<string, string> = {
  write_file: "modified",
  edit_block: "modified"
};

/**
 * Client-side trace: the run's spans, and the files it says it touched.
 *
 * This is the whole trace now. The daemon's `get_trace` / `list_traces` answer
 * `traces: []` — the trace store died with the plugin framework — so the panel used
 * to render an empty authoritative trace next to spans it had collected itself, and
 * fell back to reading `~/.thunder/conversations/<id>/traces/`, a directory nothing
 * in thunder writes.
 *
 * The file footprint is derived from tool arguments for the same reason: the
 * `custom/file_change` event that used to feed it is no longer emitted. `write_file`
 * and `edit_block` name their target in `path`, which is ground truth; `bash` does
 * not, so a shell command that rewrites files leaves no footprint — better than
 * guessing paths out of a shell string.
 */
export function useTraceCollector() {
  const [spans, setSpans] = useState<TraceSpan[]>([]);
  const [fileChanges, setFileChanges] = useState<ThunderFileChangeRecord[]>([]);
  const [isCollecting, setIsCollecting] = useState(false);

  const activeTaskIdRef = useRef<string | null>(null);
  const startTimesRef = useRef<Map<string, number>>(new Map());
  /** `tool_call_id` → the call's name and arguments, so the result can name its file. */
  const toolCallsRef = useRef<Map<string, { name: string; path?: string }>>(new Map());
  /** The turn `turn_start` last opened. */
  const currentTurnRef = useRef<number>(1);

  const resetTrace = useCallback(() => {
    setSpans([]);
    setFileChanges([]);
    setIsCollecting(false);
    activeTaskIdRef.current = null;
    startTimesRef.current.clear();
    toolCallsRef.current.clear();
    currentTurnRef.current = 1;
  }, []);

  const startTaskTrace = useCallback(
    (options: { taskId: string; sessionId: string; model?: string; workspaceDir?: string; prompt?: string }) => {
      activeTaskIdRef.current = options.taskId;
      currentTurnRef.current = 1;
      setIsCollecting(true);
      setSpans([]);
      setFileChanges([]);
      startTimesRef.current.clear();
      toolCallsRef.current.clear();
    },
    []
  );

  const recordEvent = useCallback((ev: ThunderAgentEvent, taskId: string) => {
    if (activeTaskIdRef.current && taskId !== activeTaskIdRef.current) return;
    const now = Date.now();

    /**
     * Normalizes an event timestamp to milliseconds. Older daemons emitted
     * `turn_start.timestamp` in seconds, which produced absurd durations
     * (~1.78e9 s) when subtracted from a millisecond `Date.now()`.
     */
    const eventTsMs = (raw: unknown): number => {
      if (typeof raw === "number" && raw > 1e12) return raw;
      if (typeof raw === "number" && raw > 1e9) return raw * 1000;
      return now;
    };

    switch (ev.type) {
      case "turn_start": {
        const turn = (ev as any).turn || 1;
        currentTurnRef.current = turn;
        const spanId = `turn_${turn}`;
        const startTs = eventTsMs((ev as any).timestamp);
        startTimesRef.current.set(spanId, startTs);
        setSpans((prev) => [
          ...prev,
          { id: spanId, turn, type: "turn", name: `Turn ${turn}`, startedAtMs: startTs, status: "running" }
        ]);
        break;
      }

      case "reasoning_delta": {
        const turn = (ev as any).turn || 1;
        const spanId = `reasoning_${turn}`;
        setSpans((prev) => growSpan(prev, spanId, now, turn, "thinking", "Reasoning"));
        break;
      }

      case "token_delta": {
        const turn = (ev as any).turn || 1;
        const spanId = `token_${turn}`;
        setSpans((prev) => growSpan(prev, spanId, now, turn, "token", "Assistant Response"));
        break;
      }

      case "tool_exec_start": {
        const toolCallId = (ev as any).tool_call_id || `tool_${now}`;
        const name = (ev as any).name || "tool";
        const turn = (ev as any).turn || 1;
        const args = (ev as any).arguments;
        const path = typeof args?.path === "string" ? args.path : undefined;
        startTimesRef.current.set(toolCallId, now);
        toolCallsRef.current.set(toolCallId, { name, path });

        setSpans((prev) => [
          ...prev,
          {
            id: toolCallId,
            turn,
            type: "tool",
            name,
            startedAtMs: now,
            status: "running",
            data: { toolCallId, name, arguments: args }
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
        const duration = res?.duration_ms ?? now - startTime;
        const call = toolCallsRef.current.get(toolCallId);

        setSpans((prev) =>
          prev.map((s) =>
            s.id === toolCallId
              ? {
                  ...s,
                  durationMs: duration,
                  status: isError ? "failed" : "completed",
                  data: { ...s.data, isError, output: res?.output }
                }
              : s
          )
        );

        // The footprint: what the call actually named, not what it printed.
        if (call?.path && FILE_TOOLS[call.name]) {
          const record: ThunderFileChangeRecord = {
            path: call.path,
            tool: call.name,
            action: isError ? "failed" : FILE_TOOLS[call.name],
            turn: (ev as any).turn || currentTurnRef.current,
            timestamp: now
          };
          setFileChanges((prev) =>
            prev.some((p) => p.path === record.path && p.action === record.action && p.turn === record.turn)
              ? prev
              : [...prev, record]
          );
        }
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
              return { ...s, status: "completed", durationMs: s.durationMs || now - s.startedAtMs };
            }
            return s;
          })
        );
        break;
      }
    }
  }, []);

  /**
   * Rebuild the live trace from a snapshot the main process buffered for an
   * in-flight task, so a surface that opened mid-run shows the same timeline it
   * would have seen had it been streaming from the start.
   */
  const restoreFromSnapshot = useCallback(
    (snapshot: ThunderActiveStreamSnapshot) => {
      activeTaskIdRef.current = snapshot.taskId;
      startTimesRef.current.clear();
      toolCallsRef.current.clear();
      currentTurnRef.current = 1;
      setIsCollecting(true);
      setSpans([]);
      setFileChanges([]);
      for (const observed of snapshot.events) {
        recordEvent(observed.event, snapshot.taskId);
      }
    },
    [recordEvent]
  );

  const finishTaskTrace = useCallback(() => {
    setIsCollecting(false);
    setSpans((prev) => prev.map((s) => (s.status === "running" ? { ...s, status: "completed" } : s)));
    activeTaskIdRef.current = null;
  }, []);

  return {
    spans,
    fileChanges,
    isCollecting,
    startTaskTrace,
    recordEvent,
    finishTaskTrace,
    restoreFromSnapshot,
    resetTrace,
    setFileChanges
  };
}

/**
 * Extend a streaming span (reasoning / tokens) or open it on first sight. Both
 * keep a token count so the popover can say how much of it there was.
 */
function growSpan(
  prev: TraceSpan[],
  spanId: string,
  now: number,
  turn: number,
  type: "thinking" | "token",
  name: string
): TraceSpan[] {
  const existing = prev.find((s) => s.id === spanId);
  if (existing) {
    const count = ((existing.data?.tokenCount as number) || 0) + 1;
    return prev.map((s) =>
      s.id === spanId ? { ...s, durationMs: now - s.startedAtMs, data: { ...s.data, tokenCount: count } } : s
    );
  }
  return [
    ...prev,
    { id: spanId, turn, type, name, startedAtMs: now, durationMs: 0, status: "running", data: { tokenCount: 1 } }
  ];
}
