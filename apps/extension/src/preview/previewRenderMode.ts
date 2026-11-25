import * as vscode from "vscode";

export type PreviewRenderMode = "markdown" | "raw";

const PREVIEW_RENDER_MODE_KEY = "agentResume.previewRenderMode";

export function isPreviewRenderMode(value: unknown): value is PreviewRenderMode {
  return value === "markdown" || value === "raw";
}

export function getPreviewRenderMode(context?: vscode.ExtensionContext): PreviewRenderMode {
  const stored = context?.globalState.get<unknown>(PREVIEW_RENDER_MODE_KEY);
  return isPreviewRenderMode(stored) ? stored : "markdown";
}

export async function setPreviewRenderMode(
  context: vscode.ExtensionContext | undefined,
  mode: unknown
): Promise<PreviewRenderMode> {
  if (isPreviewRenderMode(mode) && context) {
    await context.globalState.update(PREVIEW_RENDER_MODE_KEY, mode);
    return mode;
  }

  return getPreviewRenderMode(context);
}
