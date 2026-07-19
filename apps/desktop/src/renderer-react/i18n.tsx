import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { desktopApi } from "./bridge";

export interface I18nBundle {
  locale: string;
  messages: Record<string, string>;
}

interface I18nContextValue extends I18nBundle {
  ready: boolean;
  t: (key: string, ...args: Array<string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function interpolate(template: string, args: Array<string | number>): string {
  return template.replace(/\{(\d+)\}/g, (_match, indexText: string) => {
    const value = args[Number(indexText)];
    return value === undefined ? `{${indexText}}` : String(value);
  });
}

export function I18nProvider({ children }: { children: ReactNode }): ReactNode {
  const [bundle, setBundle] = useState<I18nBundle>({ locale: "en", messages: {} });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    const api = desktopApi();

    void api
      .getI18nBundle()
      .then((nextBundle) => {
        if (active) setBundle(nextBundle);
      })
      .catch((error: unknown) => {
        console.error("Failed to load desktop UI strings", error);
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return api.onLocaleChanged((nextBundle) => {
      if (active) setBundle(nextBundle);
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = bundle.locale;
  }, [bundle.locale]);

  useEffect(() => {
    if (ready) document.documentElement.classList.add("i18n-ready");
  }, [ready]);

  const t = useCallback(
    (key: string, ...args: Array<string | number>) => {
      const template = bundle.messages[key] ?? key;
      return args.length ? interpolate(template, args) : template;
    },
    [bundle.messages]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ ...bundle, ready, t }),
    [bundle, ready, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}
