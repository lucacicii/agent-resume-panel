import * as vscode from "vscode";
import { loadCatalogSettings } from "../catalog/config";
import { ensureCatalogSchema } from "../catalog/db";
import { setSessionSummaryInCatalog } from "../catalog/mutations";
import { getSessionSummaryFromCatalog } from "../catalog/query";
import { AgentSession } from "../history";
import { LlmOutputLanguage } from "./languages";

export async function getCachedSummary(
  _context: vscode.ExtensionContext,
  session: AgentSession,
  language: LlmOutputLanguage
): Promise<string | undefined> {
  const catalog = loadCatalogSettings();
  await ensureCatalogSchema(catalog.dbPath);
  return getSessionSummaryFromCatalog(catalog.dbPath, session.provider, session.id, language);
}

export async function setCachedSummary(
  _context: vscode.ExtensionContext,
  session: AgentSession,
  language: LlmOutputLanguage,
  summary: string
): Promise<void> {
  const catalog = loadCatalogSettings();
  await ensureCatalogSchema(catalog.dbPath);
  await setSessionSummaryInCatalog(catalog.dbPath, session.provider, session.id, language, summary);
}