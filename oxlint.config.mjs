import nkzw from "@nkzw/oxlint-config";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [nkzw],
  ignorePatterns: ["dist/", "src-tauri/", "node_modules/", "scripts/", "tailwind.config.js"],
  rules: {
    // --- SolidJS overrides ---
    // Disable all React class component rules (SolidJS is functional only)
    "react/display-name": "off",
    "react/no-direct-mutation-state": "off",
    "react/no-find-dom-node": "off",
    "react/no-is-mounted": "off",
    "react/no-render-return-value": "off",
    "react/no-string-refs": "off",
    "react/require-render-return": "off",
    // SolidJS uses `class`, `classList`, `ref` as callback — not React props
    "react/no-unknown-property": "off",
    // SolidJS <For> doesn't need keys, and entities are fine in SolidJS JSX
    "react/jsx-key": "off",
    "react/no-unescaped-entities": "off",
    // React hooks rules fire on SolidJS primitives (createSignal, createEffect, etc.)
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/rules-of-hooks": "off",
    // React Compiler rules — completely inapplicable to SolidJS
    "react-hooks-js/component-hook-factories": "off",
    "react-hooks-js/config": "off",
    "react-hooks-js/error-boundaries": "off",
    "react-hooks-js/gating": "off",
    "react-hooks-js/globals": "off",
    "react-hooks-js/immutability": "off",
    "react-hooks-js/incompatible-library": "off",
    "react-hooks-js/preserve-manual-memoization": "off",
    "react-hooks-js/purity": "off",
    "react-hooks-js/refs": "off",
    "react-hooks-js/set-state-in-effect": "off",
    "react-hooks-js/set-state-in-render": "off",
    "react-hooks-js/static-components": "off",
    "react-hooks-js/unsupported-syntax": "off",
    "react-hooks-js/use-memo": "off",
    // --- @nkzw plugin rules that don't apply ---
    // Relay types — SolidJS project, no Relay
    "@nkzw/ensure-relay-types": "off",
    // useEffect args — SolidJS uses createEffect, not useEffect
    "@nkzw/require-use-effect-arguments": "off",
    // --- Project-specific adjustments ---
    // Allow console in non-production code (we use toast for user-facing errors)
    "no-console": "warn",
    // Array<T> style — keep existing T[] style
    "@typescript-eslint/array-type": "off",
    // SolidJS utility functions inside components are idiomatic (not closures, just colocation)
    "unicorn/consistent-function-scoping": "off",
  },
});
