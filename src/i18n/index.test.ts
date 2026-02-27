import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { createTranslator } from "./index";

describe("i18n translator", () => {
  it("returns translated key for english", () => {
    createRoot((dispose) => {
      const [locale] = createSignal<"en" | "zh-CN">("en");
      const t = createTranslator(locale);

      expect(t("common.cancel")).toBe("Cancel");
      dispose();
    });
  });

  it("returns translated key for zh-CN", () => {
    createRoot((dispose) => {
      const [locale] = createSignal<"en" | "zh-CN">("zh-CN");
      const t = createTranslator(locale);

      expect(t("common.cancel")).toBe("取消");
      dispose();
    });
  });

  it("falls back to key when missing", () => {
    createRoot((dispose) => {
      const [locale] = createSignal<"en" | "zh-CN">("zh-CN");
      const t = createTranslator(locale);

      expect(t("missing.key")).toBe("missing.key");
      dispose();
    });
  });

  it("interpolates params", () => {
    createRoot((dispose) => {
      const [locale] = createSignal<"en" | "zh-CN">("en");
      const t = createTranslator(locale);

      expect(t("sidebar.updateTo", { version: "v0.3.119" })).toBe("Update v0.3.119");
      dispose();
    });
  });
});
