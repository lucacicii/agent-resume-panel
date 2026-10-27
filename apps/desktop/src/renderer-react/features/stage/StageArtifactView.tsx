import React from "react";
import type { UIArtifactEnvelope } from "@agent-resume/core";
import { ArtifactHtmlSandbox } from "../../components/artifact/ArtifactHtmlSandbox";
import { ArtifactMermaidViewer } from "../../components/artifact/ArtifactMermaidViewer";
import { ArtifactSvgViewer } from "../../components/artifact/ArtifactSvgViewer";
import { ArtifactKanbanViewer } from "./artifacts/ArtifactKanbanViewer";
import { ArtifactNoteViewer } from "./artifacts/ArtifactNoteViewer";
import { ArtifactDiffViewer } from "./artifacts/ArtifactDiffViewer";
import { ArtifactBrowserViewer } from "./artifacts/ArtifactBrowserViewer";
import { ArtifactMemoryViewer } from "./artifacts/ArtifactMemoryViewer";
import { ArtifactScriptsViewer } from "./artifacts/ArtifactScriptsViewer";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";

interface StageArtifactViewProps {
  artifact: UIArtifactEnvelope | null;
}

export function StageArtifactView({ artifact }: StageArtifactViewProps): React.JSX.Element {
  if (!artifact) {
    return (
      <div className="stage-artifact-empty">
        <ThemeIcon name="layout-dashboard" size={ICON_SIZE.hero} />
        <p className="stage-artifact-empty-text">No active artifact</p>
      </div>
    );
  }

  const kind = artifact.kind;
  const rawPayload = artifact.payload;

  if (kind === "native:gtd" || kind === ("artifact:kanban" as any)) {
    return (
      <div className="stage-artifact-body art-kanban-wrap">
        <ArtifactKanbanViewer tasks={rawPayload as any} />
      </div>
    );
  }

  if (kind === "native:notes" || kind === ("artifact:note" as any)) {
    return (
      <div className="stage-artifact-body art-note-wrap">
        <ArtifactNoteViewer content={rawPayload as any} title={artifact.title} />
      </div>
    );
  }

  if (kind === "native:diff") {
    return (
      <div className="stage-artifact-body art-diff-wrap">
        <ArtifactDiffViewer payload={rawPayload as any} />
      </div>
    );
  }

  if (kind === "native:browser") {
    return (
      <div className="stage-artifact-body art-browser-wrap">
        <ArtifactBrowserViewer />
      </div>
    );
  }

  if (kind === "native:memory") {
    return (
      <div className="stage-artifact-body art-memory-wrap">
        <ArtifactMemoryViewer />
      </div>
    );
  }

  if (kind === "native:scripts" || kind === "native:workbench") {
    return (
      <div className="stage-artifact-body art-scripts-wrap">
        <ArtifactScriptsViewer payload={rawPayload as any} />
      </div>
    );
  }

  if (kind === "graph:mermaid") {
    const code = typeof rawPayload === "string" ? rawPayload : JSON.stringify(rawPayload, null, 2);
    return (
      <div className="stage-artifact-body">
        <ArtifactMermaidViewer code={code} minHeight={400} />
      </div>
    );
  }

  if (kind === "custom:app" || kind === "chart") {
    const code = typeof rawPayload === "string"
      ? rawPayload
      : `<!DOCTYPE html><html><body><pre>${JSON.stringify(rawPayload, null, 2)}</pre></body></html>`;
    return (
      <div className="stage-artifact-body">
        <ArtifactHtmlSandbox code={code} minHeight={400} />
      </div>
    );
  }

  // Fallback string / JSON
  const content = typeof rawPayload === "string" ? rawPayload : JSON.stringify(rawPayload, null, 2);
  if (content.trim().startsWith("<svg")) {
    return (
      <div className="stage-artifact-body">
        <ArtifactSvgViewer code={content} minHeight={400} />
      </div>
    );
  }

  return (
    <div className="stage-artifact-body">
      <pre className="stage-artifact-raw"><code>{content}</code></pre>
    </div>
  );
}
