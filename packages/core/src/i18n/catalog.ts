import * as fs from "node:fs";
import * as path from "node:path";
import { UI_LOCALES, UiLocale } from "./locales";

export type MessageCatalog = Record<string, string>;

const catalogs = new Map<UiLocale, MessageCatalog>();
let catalogsLoaded = false;
let localesDir = "";

export function setLocalesDir(dir: string): void {
  localesDir = dir;
}

export function getLocalesDir(): string {
  return localesDir;
}

export function loadCatalogs(dir?: string): void {
  if (dir) {
    localesDir = dir;
  }
  if (catalogsLoaded || !localesDir) {
    return;
  }

  for (const locale of UI_LOCALES) {
    const filePath = path.join(localesDir, `${locale}.json`);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    try {
      catalogs.set(locale, JSON.parse(fs.readFileSync(filePath, "utf8")) as MessageCatalog);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[i18n] Failed to load locale file ${filePath}: ${message}`);
    }
  }

  catalogsLoaded = true;
}

export function interpolate(template: string, args: (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (_match, indexText: string) => {
    const index = Number(indexText);
    const value = args[index];
    return value === undefined ? `{${indexText}}` : String(value);
  });
}

export function translateKey(
  locale: UiLocale,
  key: string,
  args: (string | number)[] = []
): string {
  loadCatalogs();
  const template = catalogs.get(locale)?.[key] ?? catalogs.get("en")?.[key] ?? key;
  return args.length > 0 ? interpolate(template, args) : template;
}

export function getCatalogForLocale(locale: UiLocale): MessageCatalog {
  loadCatalogs();
  return { ...(catalogs.get(locale) ?? catalogs.get("en") ?? {}) };
}

export function resetI18nCache(): void {
  catalogs.clear();
  catalogsLoaded = false;
}