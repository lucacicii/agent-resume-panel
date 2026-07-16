import { PreviewMessage } from "../history/preview/types";

export function formatTranscript(messages: PreviewMessage[]): string {
  const lines: string[] = [];

  for (const message of messages) {
    const role = message.role === "assistant" ? "Assistant" : "User";
    lines.push(`${role}: ${message.text}`);
  }

  return lines.join("\n\n");
}

export function truncateTranscript(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const truncated = text.slice(text.length - maxChars);
  const firstBreak = truncated.indexOf("\n\n");
  if (firstBreak >= 0 && firstBreak < 200) {
    return `[...truncated...]\n\n${truncated.slice(firstBreak + 2)}`;
  }

  return `[...truncated...]\n\n${truncated}`;
}