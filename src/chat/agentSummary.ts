import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { AgentSession } from "../history";
import { getChatApiConfig } from "./config";
import { streamChatCompletion } from "./openaiClient";
import { ChatPanelManager } from "./chatPanel";
import { appendChatMessage, getChatRecord, updateChatRecord } from "./store";
import { ChatMessage, ChatSessionRecord } from "./types";

export async function syncAgentSummaryIfNeeded(
  context: vscode.ExtensionContext,
  panelHome: string,
  chatId: string,
  sessions: AgentSession[]
): Promise<ChatMessage | undefined> {
  const config = vscode.workspace.getConfiguration("agentResume");
  if (!config.get<boolean>("chatAutoSyncAgentSummary", true)) {
    return undefined;
  }

  const record = await getChatRecord(panelHome, chatId);
  if (!record?.linkedAgent.sessionId || record.linkedAgent.handoffCount < 1) {
    return undefined;
  }

  const agentSession = sessions.find(
    (session) =>
      session.provider === record.linkedAgent.provider && session.id === record.linkedAgent.sessionId
  );
  if (!agentSession) {
    return undefined;
  }

  if (agentSession.updatedAt <= (record.lastAgentSummaryAt ?? 0)) {
    return undefined;
  }

  const body = await buildAgentSummaryText(context, record, agentSession);
  const hash = hashSummary(body);
  if (hash === record.lastAgentSummaryHash) {
    return undefined;
  }

  const message: ChatMessage = {
    id: crypto.randomUUID(),
    role: "system",
    source: "agent-summary",
    text: body,
    timestamp: Date.now()
  };

  record.lastAgentSummaryAt = agentSession.updatedAt;
  record.lastAgentSummaryHash = hash;
  record.updatedAt = Date.now();
  await updateChatRecord(panelHome, record);
  await appendChatMessage(panelHome, chatId, message);
  return message;
}

export async function syncAllChatSummaries(
  context: vscode.ExtensionContext,
  panelHome: string,
  sessions: AgentSession[],
  chatPanels?: ChatPanelManager
): Promise<number> {
  let synced = 0;
  for (const session of sessions) {
    if (session.provider !== "chat" || !session.chatLink?.sessionId) {
      continue;
    }
    const message = await syncAgentSummaryIfNeeded(context, panelHome, session.id, sessions);
    if (message) {
      chatPanels?.appendSummary(session.id, message);
      synced += 1;
    }
  }
  return synced;
}

async function buildAgentSummaryText(
  context: vscode.ExtensionContext,
  record: ChatSessionRecord,
  agentSession: AgentSession
): Promise<string> {
  const lines = [
    "## Agent 执行摘要（自动同步）",
    `- Provider: ${agentSession.provider}`,
    `- Session: ${agentSession.id}`,
    `- Title: ${agentSession.title}`,
    `- Updated: ${formatTimestamp(agentSession.updatedAt)}`
  ];

  if (agentSession.model) {
    lines.push(`- Model: ${agentSession.model}`);
  }
  if (agentSession.branch) {
    lines.push(`- Branch: ${agentSession.branch}`);
  }

  const hints = collectHints(agentSession);
  if (hints) {
    lines.push("", hints);
  }

  const config = vscode.workspace.getConfiguration("agentResume");
  if (config.get<boolean>("chatSummarizeAgentReturn", true)) {
    const summary = await summarizeWithLlm(context, record, agentSession, hints);
    if (summary) {
      lines.push("", `### Summary`, summary);
    }
  }

  return lines.join("\n");
}

function collectHints(agentSession: AgentSession): string | undefined {
  const parts: string[] = [];
  if (agentSession.messageCount != null) {
    parts.push(`Message count: ${agentSession.messageCount}`);
  }
  return parts.length ? parts.join("\n") : undefined;
}

async function summarizeWithLlm(
  context: vscode.ExtensionContext,
  record: ChatSessionRecord,
  agentSession: AgentSession,
  hints?: string
): Promise<string | undefined> {
  const { baseUrl, apiKey } = await getChatApiConfig(context);
  if (!apiKey) {
    return agentSession.title;
  }

  const config = vscode.workspace.getConfiguration("agentResume");
  const model = record.model || config.get<string>("chatDefaultModel", "gpt-4o-mini");
  const prompt = [
    "Summarize what the coding agent likely accomplished in 3-5 concise bullet points.",
    "Use only the metadata below; do not invent file changes.",
    `Agent title: ${agentSession.title}`,
    `Provider: ${agentSession.provider}`,
    hints ? `Hints:\n${hints}` : undefined
  ]
    .filter(Boolean)
    .join("\n");

  try {
    return await streamChatCompletion({
      baseUrl,
      apiKey,
      model,
      systemPrompt: "You write short execution summaries for a planning chat.",
      messages: [{ id: "summary-request", role: "user", text: prompt, timestamp: Date.now() }],
      onDelta: () => undefined
    });
  } catch {
    return agentSession.title;
  }
}

function hashSummary(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function formatTimestamp(timestamp: number): string {
  if (!timestamp) {
    return "unknown";
  }
  return new Date(timestamp).toLocaleString();
}