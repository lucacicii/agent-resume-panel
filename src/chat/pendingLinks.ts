const pendingChatLinks = new Set<string>();

export function queueChatAgentLink(chatId: string): void {
  pendingChatLinks.add(chatId);
}

export function drainPendingChatLinks(): string[] {
  return [...pendingChatLinks];
}

export function clearPendingChatLink(chatId: string): void {
  pendingChatLinks.delete(chatId);
}