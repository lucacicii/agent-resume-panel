import * as fs from "node:fs/promises";
import * as path from "node:path";
import { acpSessionsPath, acpThreadPath } from "../../acp/store";
import { readJsonLines } from "../../history/jsonl";
import { findFilesByName, listJsonlFiles } from "../../history/preview/fs";
import { RenameHomes } from "../../history/rename";
import { candidateAgyRoots } from "../../history/preview/agyRoots";

export interface TranscriptIndexes {
  codex: Map<string, string[]>;
  claude: Map<string, string[]>;
  grok: Map<string, string[]>;
  pi: Map<string, string>;
  prime: Map<string, string>;
  agy: Map<string, string[]>;
}

export async function buildTranscriptIndexes(homes: RenameHomes): Promise<TranscriptIndexes> {
  const [codex, claude, grok, pi, prime, agy] = await Promise.all([
    buildCodexIndex(homes.codexHome),
    buildClaudeIndex(homes.claudeHome),
    buildGrokIndex(homes.grokHome),
    buildPiIndex(homes.piHome),
    buildPrimeIndex(homes.primeHome),
    buildAgyIndex(homes.antigravityHome)
  ]);

  return { codex, claude, grok, pi, prime, agy };
}

async function buildCodexIndex(codexHome: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const roots = [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")];

  for (const root of roots) {
    const files = await listJsonlFiles(root);
    for (const file of files) {
      if (!path.basename(file).startsWith("rollout-")) {
        continue;
      }
      const base = path.basename(file);
      for (const token of base.replace(".jsonl", "").split("-")) {
        if (token.length >= 8) {
          appendPath(map, token, file);
        }
      }
    }
  }

  return map;
}

async function buildClaudeIndex(claudeHome: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const files = await listJsonlFiles(path.join(claudeHome, "projects"));

  for (const file of files) {
    const fileId = path.basename(file, ".jsonl");
    appendPath(map, fileId, file);

    const rows = await readJsonLines<{ sessionId?: string }>(file);
    for (const row of rows) {
      if (row.sessionId) {
        appendPath(map, row.sessionId, file);
      }
    }
  }

  return map;
}

async function buildGrokIndex(grokHome: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const sessionsRoot = path.join(grokHome, "sessions");
  const chatFiles = await findFilesByName(sessionsRoot, "chat_history.jsonl");

  for (const file of chatFiles) {
    const dirName = path.basename(path.dirname(file));
    appendPath(map, dirName, file);
    for (const part of file.split(path.sep)) {
      if (part.length >= 8 && part !== "chat_history.jsonl") {
        appendPath(map, part, file);
      }
    }
  }

  return map;
}

async function buildPiIndex(piHome: string): Promise<Map<string, string>> {
  return buildJsonlSessionIndex(piHome);
}

async function buildPrimeIndex(primeHome: string): Promise<Map<string, string>> {
  return buildJsonlSessionIndex(primeHome);
}

async function buildJsonlSessionIndex(home: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const sessionFiles = await listJsonlFiles(path.join(home, "sessions"));

  for (const file of sessionFiles) {
    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }

    const firstLine = content
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);
    if (!firstLine) {
      continue;
    }

    try {
      const header = JSON.parse(firstLine) as { type?: string; id?: string };
      if (header.type === "session" && header.id) {
        map.set(header.id, file);
      }
    } catch {
      continue;
    }
  }

  return map;
}

async function buildAgyIndex(antigravityHome: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const root of candidateAgyRoots(antigravityHome)) {
    const historyPath = path.join(root, "history.jsonl");
    try {
      const rows = await readJsonLines<{ conversationId?: string }>(historyPath);
      for (const row of rows) {
        if (row.conversationId) {
          appendPath(map, row.conversationId, historyPath);
        }
      }
    } catch {
      continue;
    }
  }

  return map;
}

export function acpTranscriptPaths(homes: RenameHomes, sessionId: string): { threadPath: string; sessionsIndexPath: string } {
  return {
    threadPath: acpThreadPath(homes.panelHome, sessionId),
    sessionsIndexPath: acpSessionsPath(homes.panelHome)
  };
}

function appendPath(map: Map<string, string[]>, key: string, file: string): void {
  const bucket = map.get(key) ?? [];
  if (!bucket.includes(file)) {
    bucket.push(file);
  }
  map.set(key, bucket);
}
