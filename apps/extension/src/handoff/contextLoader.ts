import { AgentSession } from "../history";
import { t } from "../i18n";
import { loadSessionPreview } from "../history/preview";
import { loadRenameHomes } from "../history/rename/homes";
import { HandoffSessionContext } from "./types";

export async function loadCliHandoffContext(session: AgentSession): Promise<HandoffSessionContext> {
  const preview = await loadSessionPreview(session, loadRenameHomes());

  if (!preview.messages.length) {
    throw new Error(t("error.handoffEmptySession"));
  }

  const truncationWarning = preview.truncated
    ? preview.warning ?? "Preview includes only the most recent messages; earlier context may be missing."
    : preview.warning;

  return {
    sourceKind: "cli",
    sourceProvider: session.provider,
    sessionId: session.id,
    title: preview.title || session.title,
    projectPath: session.projectPath,
    model: session.model,
    branch: session.branch,
    messages: preview.messages,
    truncated: preview.truncated ?? false,
    truncationWarning
  };
}