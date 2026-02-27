import { locale as osLocale } from "@tauri-apps/plugin-os";
import { toSupportedLocale } from "./index";

import type { Locale } from "./index";

export function normalizeLocale(input: string | null | undefined): Locale {
  return toSupportedLocale(input ?? undefined);
}

export function resolveInitialLocale(
  savedLocale: string | undefined,
  systemLocale: string | null | undefined,
): Locale {
  if (savedLocale) {
    return normalizeLocale(savedLocale);
  }

  return normalizeLocale(systemLocale);
}

export async function detectSystemLocale(): Promise<Locale> {
  try {
    const detected = await osLocale();
    return normalizeLocale(detected);
  } catch {
    if (typeof navigator !== "undefined") {
      return normalizeLocale(navigator.language);
    }
    return "en";
  }
}
