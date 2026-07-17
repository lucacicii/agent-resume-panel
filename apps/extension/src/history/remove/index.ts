import { deleteAcpRecord } from "../../acp/store";
import { hideSessionsInCatalog } from "../../catalog/mutations";
import { loadCatalogSettings } from "../../catalog/config";
import { AgentSession } from "../types";
import { loadRenameHomes } from "../rename/homes";
import { runCodexArchive, runGrokSessionDelete, runOpenCodeSessionDelete } from "./cli";
import { RemoveAgentAction, RemoveSessionOptions, RemoveSessionResult } from "./types";

export function getRemoveAgentAction(provider: AgentSession["provider"]): RemoveAgentAction {
  switch (provider) {
    case "grok":
    case "opencode":
      return "delete";
    case "codex":
      return "archive";
    default:
      return "unsupported";
  }
}

export function describeRemoveAction(provider: AgentSession["provider"]): string {
  const action = getRemoveAgentAction(provider);
  if (action === "delete") {
    return "Delete permanently (agent CLI)";
  }
  if (action === "archive") {
    return "Archive (Codex CLI)";
  }
  if (provider === "chat") {
    return "Delete ACP chat data";
  }
  return "Catalog hide only (agent not supported)";
}

export async function removeSession(
  session: AgentSession,
  options: RemoveSessionOptions
): Promise<RemoveSessionResult> {
  const base = {
    provider: session.provider,
    id: session.id,
    ok: false,
    method: "none"
  };

  try {
    if (options.applyToAgent) {
      const method = await applyRemoveToAgent(session);
      base.method = method;
    } else {
      base.method = "catalog-hide";
    }

    const catalog = loadCatalogSettings();
    await hideSessionsInCatalog(catalog.dbPath, [session]);

    return { ...base, ok: true };
  } catch (error) {
    return {
      ...base,
      ok: false,
      error: formatError(error)
    };
  }
}

export async function removeSessionsBatch(
  sessions: AgentSession[],
  options: RemoveSessionOptions,
  concurrency = 3
): Promise<RemoveSessionResult[]> {
  const results: RemoveSessionResult[] = [];
  const queue = [...sessions];

  async function worker(): Promise<void> {
    while (queue.length) {
      const session = queue.shift();
      if (!session) {
        return;
      }
      results.push(await removeSession(session, options));
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, sessions.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function applyRemoveToAgent(session: AgentSession): Promise<string> {
  switch (session.provider) {
    case "grok":
      await runGrokSessionDelete(session.id);
      return "grok-sessions-delete";
    case "opencode":
      await runOpenCodeSessionDelete(session.id);
      return "opencode-session-delete";
    case "codex":
      await runCodexArchive(session);
      return "codex-archive";
    case "chat": {
      const homes = loadRenameHomes();
      await deleteAcpRecord(homes.panelHome, session.id);
      return "acp-delete";
    }
    default:
      throw new Error(`Remove on agent storage is not supported for provider ${session.provider}.`);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}