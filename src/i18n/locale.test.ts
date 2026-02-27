import { describe, expect, it } from "vitest";
import { normalizeLocale, resolveInitialLocale } from "./locale";

describe("locale resolution", () => {
  it("normalizes chinese locale variants", () => {
    expect(normalizeLocale("zh")).toBe("zh-CN");
    expect(normalizeLocale("zh-TW")).toBe("zh-CN");
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
  });

  it("normalizes english locale variants", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("en-US")).toBe("en");
  });

  it("falls back to english for unsupported locales", () => {
    expect(normalizeLocale("fr-FR")).toBe("en");
    expect(normalizeLocale(undefined)).toBe("en");
  });

  it("uses saved locale first", () => {
    expect(resolveInitialLocale("zh-CN", "en-US")).toBe("zh-CN");
  });

  it("uses system locale if saved locale missing", () => {
    expect(resolveInitialLocale(undefined, "zh-CN")).toBe("zh-CN");
    expect(resolveInitialLocale(undefined, "fr-FR")).toBe("en");
  });
});
