import { GTD_STATUSES, type GtdStatus, isGtdStatus } from "../gtd/types";

export interface NoteGtdTask {
  text: string;
  status: GtdStatus;
  /** One-based source line for the opening :::gtd marker. */
  line: number;
  /** One-based position among identical task texts in the same note. */
  occurrence: number;
}

interface ParsedTask extends NoteGtdTask {
  blockStart: number;
  blockEnd: number;
  rawText: string;
}

const GTD_BLOCK_OPEN = /^:::gtd\s+([a-z]+)\s*$/;
const GTD_BLOCK_CLOSE = /^:::\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function validateTaskText(value: string): string {
  const text = value.trim();
  if (!text) throw new Error("GTD task text is required.");
  if (/^:::\s*$/m.test(text)) throw new Error("GTD task text cannot contain a closing ::: marker.");
  return text;
}

function block(status: GtdStatus, text: string): string {
  return `:::gtd ${status}\n${text}\n:::`;
}

function lineOffsets(lines: readonly string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

function parseTasks(markdown: string): ParsedTask[] {
  const output: ParsedTask[] = [];
  const lines = markdown.split("\n");
  const offsets = lineOffsets(lines);
  let fenceMarker: "`" | "~" | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1][0] as "`" | "~";
      if (fenceMarker === null) fenceMarker = marker;
      else if (fenceMarker === marker) fenceMarker = null;
      continue;
    }
    if (fenceMarker !== null) continue;

    const opening = line.match(GTD_BLOCK_OPEN);
    const status = opening?.[1];
    if (!status || !isGtdStatus(status)) continue;

    let closingIndex = index + 1;
    while (closingIndex < lines.length && !GTD_BLOCK_CLOSE.test(lines[closingIndex])) closingIndex += 1;
    if (closingIndex >= lines.length) continue;

    const rawText = lines.slice(index + 1, closingIndex).join("\n").trim();
    const text = normalizedText(rawText);
    if (text) {
      output.push({
        text,
        status,
        line: index + 1,
        occurrence: 0,
        blockStart: offsets[index],
        blockEnd: offsets[closingIndex] + lines[closingIndex].length,
        rawText
      });
    }
    index = closingIndex;
  }

  const occurrences = new Map<string, number>();
  for (const task of output) {
    const next = (occurrences.get(task.text) || 0) + 1;
    occurrences.set(task.text, next);
    task.occurrence = next;
  }
  return output;
}

export function parseNoteGtdTasks(markdown: string): NoteGtdTask[] {
  return parseTasks(markdown).map(({ blockStart: _blockStart, blockEnd: _blockEnd, rawText: _rawText, ...task }) => task);
}

function resolveTask(markdown: string, taskTextValue: string, occurrence?: number): ParsedTask {
  const text = normalizedText(taskTextValue);
  if (!text) throw new Error("GTD task text is required.");
  const matches = parseTasks(markdown).filter((task) => task.text === text);
  if (matches.length === 0) throw new Error(`No GTD task found with text: ${text}`);
  if (matches.length > 1 && occurrence == null) {
    const candidates = matches.map((task) => ({ occurrence: task.occurrence, line: task.line, status: task.status }));
    throw new Error(`Multiple GTD tasks match "${text}". Ask the user which occurrence to change. Candidates: ${JSON.stringify(candidates)}`);
  }
  const selected = occurrence == null ? matches[0] : matches.find((task) => task.occurrence === occurrence);
  if (!selected) throw new Error(`No GTD task occurrence ${occurrence} found with text: ${text}`);
  return selected;
}

export function appendNoteGtdTask(markdown: string, input: { text: string; status?: GtdStatus }): string {
  const text = validateTaskText(input.text);
  const suffix = markdown.trimEnd();
  const next = block(input.status || "next", text);
  return suffix ? `${suffix}\n\n${next}\n` : `${next}\n`;
}

export function updateNoteGtdTask(
  markdown: string,
  input: { taskText: string; occurrence?: number; text?: string; status?: GtdStatus }
): string {
  if (input.text == null && input.status == null) throw new Error("Provide text or status to update a GTD task.");
  const task = resolveTask(markdown, input.taskText, input.occurrence);
  const text = input.text == null ? task.rawText : validateTaskText(input.text);
  const next = block(input.status || task.status, text);
  return `${markdown.slice(0, task.blockStart)}${next}${markdown.slice(task.blockEnd)}`;
}

export function deleteNoteGtdTask(markdown: string, input: { taskText: string; occurrence?: number }): string {
  const task = resolveTask(markdown, input.taskText, input.occurrence);
  const before = markdown.slice(0, task.blockStart);
  const after = markdown.slice(task.blockEnd);
  const withoutBlock = `${before}${after.startsWith("\n") ? after.slice(1) : after}`;
  return withoutBlock.replace(/\n{3,}/g, "\n\n");
}

export function noteGtdStatusOptions(): readonly GtdStatus[] {
  return GTD_STATUSES;
}
