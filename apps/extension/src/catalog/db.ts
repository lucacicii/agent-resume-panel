import { ensureExtensionCatalogSchema } from "@agent-resume/core/extension";

export async function ensureCatalogSchema(dbPath: string): Promise<void> {
  await ensureExtensionCatalogSchema(dbPath);
}
