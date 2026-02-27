import { flatten } from "@solid-primitives/i18n";
import { createContext, createMemo, useContext } from "solid-js";
import { en } from "./en";
import { zhCN } from "./zh-CN";

import type { Accessor, JSX } from "solid-js";

export const LOCALE_OPTIONS = ["en", "zh-CN"] as const;

export type Locale = (typeof LOCALE_OPTIONS)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-CN": "中文",
};

const dictionaries = {
  en,
  "zh-CN": zhCN,
} as const;

type FlatDictionary = Record<string, string | ((params?: unknown) => string)>;
type TranslationParams = Record<string, string | number>;

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) {
    return template;
  }

  return Object.entries(params).reduce((result, [key, value]) => {
    return result.split(`{{${key}}}`).join(String(value));
  }, template);
}

export function toSupportedLocale(value: string | undefined | null): Locale {
  if (!value) {
    return "en";
  }

  if (value === "zh" || value.toLowerCase().startsWith("zh-")) {
    return "zh-CN";
  }

  if (value.toLowerCase().startsWith("en")) {
    return "en";
  }

  return "en";
}

export function createTranslator(locale: Accessor<Locale | string | undefined>) {
  const fallbackDictionary = flatten(dictionaries.en) as unknown as FlatDictionary;
  const activeDictionary = createMemo(() => {
    const nextLocale = toSupportedLocale(locale());
    return flatten(dictionaries[nextLocale]) as unknown as FlatDictionary;
  });

  return (key: string, params?: TranslationParams): string => {
    const raw = activeDictionary()[key] ?? fallbackDictionary[key];
    if (!raw) {
      return key;
    }

    if (typeof raw === "function") {
      return String(raw(params));
    }

    return interpolate(raw, params);
  };
}

interface I18nContextValue {
  locale: Accessor<Locale>;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: TranslationParams) => string;
}

const I18nContext = createContext<I18nContextValue>();

interface I18nProviderProps {
  children: JSX.Element;
  locale: Accessor<string | undefined>;
  setLocale: (locale: Locale) => void;
}

export function I18nProvider(props: I18nProviderProps) {
  const currentLocale = createMemo<Locale>(() => toSupportedLocale(props.locale()));
  const t = createTranslator(currentLocale);

  const value: I18nContextValue = {
    locale: currentLocale,
    setLocale: props.setLocale,
    t,
  };

  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }

  return context;
}
