import type { UIArtifactEnvelope } from "@agent-resume/core";

function extractJsonPayload(output: unknown): unknown {
  if (typeof output !== "string") return output;
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBracket = trimmed.indexOf("[");
    const lastBracket = trimmed.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
      } catch {
        /* continue */
      }
    }
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        /* continue */
      }
    }
    return trimmed;
  }
}

/**
 * Route completed tool executions to automatically project onto the Adaptive Stage.
 * This runs with 0 extra LLM tokens and 0ms latency.
 */
export function handleToolExecutionForStage(
  toolName: string,
  args?: Record<string, unknown>,
  output?: unknown
): void {
  if (typeof window === "undefined") return;
  const lower = toolName.toLowerCase();

  // 1. Direct artifact payload in tool execution result
  if (output && typeof output === "object") {
    if ("_ui_artifact" in output) {
      const envelope = (output as { _ui_artifact: UIArtifactEnvelope })._ui_artifact;
      if (envelope && envelope.id) {
        window.dispatchEvent(new CustomEvent("agent-resume:stage-artifact", { detail: envelope }));
        return;
      }
    }
  }

  // If output is a stringified JSON containing _ui_artifact
  if (typeof output === "string" && output.includes('"_ui_artifact"')) {
    try {
      const parsed = extractJsonPayload(output) as { _ui_artifact?: UIArtifactEnvelope };
      if (parsed?._ui_artifact?.id) {
        window.dispatchEvent(new CustomEvent("agent-resume:stage-artifact", { detail: parsed._ui_artifact }));
        return;
      }
    } catch {
      /* ignore JSON parse failure */
    }
  }

  // 2. GTD & Task tools -> project directly as a clean Kanban Artifact
  if (
    lower.includes("task_list") ||
    lower.includes("task_write") ||
    lower.includes("task_create") ||
    lower.includes("task_link") ||
    lower.includes("task_read")
  ) {
    const parsed = extractJsonPayload(output);
    const tasks =
      parsed && typeof parsed === "object" && "tasks" in parsed
        ? (parsed as { tasks: unknown }).tasks
        : parsed;

    window.dispatchEvent(
      new CustomEvent("agent-resume:stage-artifact", {
        detail: {
          id: "artifact-task-kanban",
          version: "1.0",
          title: "任务看板",
          target: "stage",
          kind: "native:gtd",
          payload: tasks
        }
      })
    );
    return;
  }

  // 3. Notes tools -> project directly as a clean Note Document Artifact
  if (
    lower.includes("note_read") ||
    lower.includes("note_create") ||
    lower.includes("note_write")
  ) {
    const parsed = extractJsonPayload(output);
    let content: unknown = parsed;
    if (parsed && typeof parsed === "object") {
      content = (parsed as any).content || (parsed as any).body || parsed;
    }
    const noteTitle = typeof args?.title === "string" ? args.title : typeof args?.noteId === "string" ? args.noteId : "笔记文档";
    window.dispatchEvent(
      new CustomEvent("agent-resume:stage-artifact", {
        detail: {
          id: `artifact-note-${args?.noteId || "active"}`,
          version: "1.0",
          title: noteTitle,
          target: "stage",
          kind: "native:notes",
          payload: content
        }
      })
    );
    return;
  }
}
