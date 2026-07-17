import { translateKey } from "./catalog";
import { resolveUiLocale } from "./resolve";
import { PanelSettings } from "../settings/types";

export type UiText = (key: string, ...args: (string | number)[]) => string;

export function createUiText(settings: PanelSettings, systemLocale?: string): UiText {
  const locale = resolveUiLocale(settings.uiLanguage, systemLocale);
  return (key: string, ...args: (string | number)[]) => translateKey(locale, key, args);
}