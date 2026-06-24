import * as vscode from "vscode";
import {
  getOrCreateHandoffTerminal,
  hasBootstrappedHandoff,
  sendHandoffBootstrap,
  sendHandoffPrompt
} from "./handoffTerminal";
import { loadChatMessages, updateChatRecord, writeHandoffFile } from "./store";
import { ChatMessage, ChatSessionRecord } from "./types";

export async function handoffChatToAgent(
  _context: vscode.ExtensionContext,
  panelHome: string,
  record: ChatSessionRecord
): Promise<ChatSessionRecord> {
  const messages = await loadChatMessages(panelHome, record.id);
  const handoffFile = await writeHandoffFile(panelHome, record.id, buildHandoffMarkdown(record, messages));

  const now = Date.now();
  const isFirstBootstrap = !hasBootstrappedHandoff(record.id);
  record.linkedAgent.linkedAt = now;
  record.linkedAgent.handoffCount = (record.linkedAgent.handoffCount ?? 0) + 1;
  record.updatedAt = now;
  await updateChatRecord(panelHome, record);

  const prompt = buildHandoffPrompt(handoffFile, isFirstBootstrap);
  const terminal = getOrCreateHandoffTerminal(record);

  if (isFirstBootstrap) {
    sendHandoffBootstrap(terminal, record, prompt);
  } else {
    sendHandoffPrompt(terminal, prompt);
  }

  return record;
}

function buildHandoffPrompt(handoffFile: string, isNew: boolean): string {
  const action = isNew
    ? "Start working on the implementation plan in this handoff file."
    : "Continue from the latest handoff file and implement any remaining work.";
  return `${action} Read the full plan at @${handoffFile}`;
}

function buildHandoffMarkdown(record: ChatSessionRecord, messages: ChatMessage[]): string {
  const lines = [
    `# Handoff: ${record.title}`,
    `Project: ${record.projectPath}`,
    `Agent: ${record.linkedAgent.provider}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Instructions",
    "Implement the plan below. Read workspace files as needed.",
    "",
    "## Conversation Summary",
    ""
  ];

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }
    lines.push(`### ${message.role}`, message.text, "");
  }

  return lines.join("\n");
}