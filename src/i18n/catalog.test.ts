import { describe, expect, it } from "vitest";
import { en } from "./en";
import { zhCN } from "./zh-CN";

function flattenKeys(value: unknown, prefix: string = ""): string[] {
  if (!value || typeof value !== "object") {
    return [prefix];
  }

  const keys: string[] = [];
  for (const [key, nested] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (nested && typeof nested === "object") {
      keys.push(...flattenKeys(nested, nextPrefix));
    } else {
      keys.push(nextPrefix);
    }
  }

  return keys;
}

describe("i18n dictionary parity", () => {
  it("zh-CN dictionary contains all english keys", () => {
    const enKeys = flattenKeys(en).sort();
    const zhKeys = new Set(flattenKeys(zhCN));

    const missing = enKeys.filter((key) => !zhKeys.has(key));
    expect(missing).toEqual([]);
  });
});
