# Single-Source OpenAI-Compatible Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `openai_compatible_providers` the single persisted source of truth by migrating the Settings page to the rich format and removing the flat `amp_openai_providers` mirror entirely.

**Architecture:** Rust `AppConfig` keeps legacy flat fields as read-only migration inputs (`#[serde(default, skip_serializing)]`), one-time amp→rich migration stays in `migrate_config`, and all mirror/sync helpers (`rich_to_amp`, `lift_amp_to_rich`, flat write in `api_keys.rs`) are deleted. Frontend: Settings form operates directly on `openaiCompatibleProviders` with multi-key + prefix support; the two read-only consumers (`AdvancedSettings.tsx`, `Settings.tsx`) switch their source field.

**Tech Stack:** Rust (serde, Tauri), SolidJS + TypeScript, existing Vitest for i18n only (config tests live in Rust `#[cfg(test)]` modules).

## Global Constraints

- `openai_compatible_providers` is the ONLY persisted representation after this plan. Never write `ampOpenaiProviders`/`ampOpenaiProvider` to config.json again.
- Legacy fields must still PARSE from old config.json (serde default) so users don't lose providers.
- API Keys tab (`OpenAICompatibleTab.tsx`) is untouched — it already operates on rich.
- Run `cd src-tauri && cargo test` after every Rust task; `pnpm tsc --noEmit` after every TS task.
- No new dependencies. Follow existing SolidJS patterns (`class` not `className`, `createSignal`).
- Known duplication (Settings section vs API Keys tab) is intentionally kept; mention in PR description only.

---

### Task 1: Rust — read-only legacy fields, delete mirror helpers, drop flat writes

**Files:**

- Modify: `src-tauri/src/config.rs` (struct fields ~line 50-52, `migrate_config` ~line 281-301, helpers `amp_to_rich`/`rich_to_amp` ~line 308-377, `save_config` debug logs in `src-tauri/src/commands/config.rs:33-49`)
- Modify: `src-tauri/src/commands/config.rs` (delete `lift_amp_to_rich`, fix debug logs)
- Modify: `src-tauri/src/commands/api_keys.rs:575-600` (delete flat mirror write)

**Interfaces:**

- Consumes: existing `amp_to_rich` mapping logic (moved inline into `migrate_config`), `AmpOpenAIProvider`/`AmpOpenAIModel` types from `crate::types::amp`
- Produces: `AppConfig` with `amp_openai_provider`/`amp_openai_providers` marked `#[serde(default, skip_serializing)]`; `save_config` that never writes flat fields; no `lift_amp_to_rich`/`rich_to_amp` symbols anywhere

- [ ] **Step 1: Mark legacy fields read-only in `AppConfig`**

In `src-tauri/src/config.rs`, change:

```rust
    #[serde(default)]
    pub amp_openai_provider: Option<AmpOpenAIProvider>, // DEPRECATED: Use amp_openai_providers
    #[serde(default)]
    pub amp_openai_providers: Vec<AmpOpenAIProvider>,
```

to:

```rust
    /// DEPRECATED: parsed from old config.json for one-time migration only; never written.
    #[serde(default, skip_serializing)]
    pub amp_openai_provider: Option<AmpOpenAIProvider>,
    /// DEPRECATED: parsed from old config.json for one-time migration only; never written.
    #[serde(default, skip_serializing)]
    pub amp_openai_providers: Vec<AmpOpenAIProvider>,
```

- [ ] **Step 2: Inline `amp_to_rich` into the migration branch, delete `rich_to_amp` mirror**

In `src-tauri/src/config.rs` `migrate_config`, replace the amp→rich branch body to construct rich providers directly (no `amp_to_rich` call):

```rust
    // Canonical OpenAI-compatible providers: the rich field is the single source of truth.
    // Migrate legacy flat `amp_openai_providers` -> rich `openai_compatible_providers` once.
    if config.openai_compatible_providers.is_empty() && !config.amp_openai_providers.is_empty() {
        eprintln!(
            "[ProxyPal] Migrating {} OpenAI-compatible provider(s) to canonical rich format",
            config.amp_openai_providers.len()
        );
        config.openai_compatible_providers = config
            .amp_openai_providers
            .iter()
            .map(|p| OpenAICompatibleProvider {
                name: p.name.clone(),
                base_url: p.base_url.clone(),
                api_key_entries: vec![crate::types::api_keys::OpenAICompatibleApiKeyEntry {
                    api_key: p.api_key.clone(),
                    proxy_url: None,
                }],
                models: Some(
                    p.models
                        .iter()
                        .map(|m| ModelMapping {
                            name: m.name.clone(),
                            alias: if m.alias.is_empty() { None } else { Some(m.alias.clone()) },
                        })
                        .collect(),
                ),
                headers: None,
                prefix: None,
            })
            .collect();
        changed = true;
    }
```

Then DELETE the mirror block that follows (the `// Always repopulate the flat mirror...` `rich_to_amp` assignment) and delete the `amp_to_rich` and `rich_to_amp` functions entirely (the `# ponytail:` comment about `(name, base_url)` keying goes with them).

- [ ] **Step 3: Delete `lift_amp_to_rich` and fix debug logs in `commands/config.rs`**

In `src-tauri/src/commands/config.rs`:

- Delete the whole `lift_amp_to_rich` function (currently above `save_config`).
- In `save_config`, delete the block that calls `lift_amp_to_rich` and its comment ("Settings writes only the flat amp field... Defect C root fix").
- Replace the debug log that iterates `config.amp_openai_providers` (lines ~35-49) with a rich iteration:

```rust
    eprintln!(
        "[ProxyPal Debug] Saving {} custom providers",
        config.openai_compatible_providers.len()
    );
    for (i, provider) in config.openai_compatible_providers.iter().enumerate() {
        eprintln!(
            "[ProxyPal Debug] Provider {}: {} with {} keys",
            i,
            provider.name,
            provider.api_key_entries.len()
        );
    }
```

- Also update the same debug pattern in `get_config` (lines ~10-20) which iterates `config.amp_openai_providers`.

- [ ] **Step 4: Remove flat mirror write from `api_keys.rs`**

In `src-tauri/src/commands/api_keys.rs`, inside `set_openai_compatible_providers`, replace the block:

```rust
        // Backward compat: also write flattened format (Settings page)
        config.amp_openai_providers = normalized_providers
            .iter()
            .map(|p| crate::types::amp::AmpOpenAIProvider {
                id: uuid::Uuid::new_v4().to_string(),
                name: p.name.clone(),
                base_url: p.base_url.clone(),
                api_key: p
                    .api_key_entries
                    .first()
                    .map(|e| e.api_key.clone())
                    .unwrap_or_default(),
                models: normalize_model_mappings(p.models.as_ref())
                    .into_iter()
                    .map(|model| crate::types::amp::AmpOpenAIModel {
                        name: model.name,
                        alias: model.alias.unwrap_or_default(),
                    })
                    .collect(),
            })
            .collect();
```

with nothing (keep only the `config.openai_compatible_providers = normalized_providers.clone();` line above it).

- [ ] **Step 5: Update Rust tests**

In `src-tauri/src/config.rs` `mod tests`:

- DELETE `settings_write_lands_in_canonical_field` (lift no longer exists).
- In `migration_amp_to_rich_on_load`, keep existing assertions; append a serialization-clean check after the load:

```rust
        // After migration the flat fields are never written back to disk.
        let persisted = fs::read_to_string(&path).unwrap();
        assert!(!persisted.contains("ampOpenaiProviders"));
        assert!(persisted.contains("openaiCompatibleProviders"));
```

- Add a new test `save_never_writes_flat_fields`:

```rust
    #[test]
    fn save_never_writes_flat_fields() {
        let dir = test_dir("config-no-flat-write");
        let path = dir.join("config.json");

        // Simulate an old config.json that still has flat fields on disk.
        let legacy_json = r#"{
  "port": 8317,
  "autoStart": true,
  "launchAtLogin": false,
  "ampOpenaiProviders": [
    {
      "id": "amp-1",
      "name": "Legacy",
      "baseUrl": "https://api.legacy.com/v1",
      "apiKey": "sk-legacy",
      "models": []
    }
  ]
}"#;
        fs::write(&path, legacy_json).unwrap();
        let loaded = load_config_from_path(&path);

        // Migration lifted the flat provider into rich.
        assert_eq!(loaded.openai_compatible_providers.len(), 1);
        assert_eq!(loaded.openai_compatible_providers[0].name, "Legacy");
        assert_eq!(
            loaded.openai_compatible_providers[0].api_key_entries[0].api_key,
            "sk-legacy"
        );

        // Saving never writes the flat fields back.
        save_config_to_path(&path, &loaded).unwrap();
        let persisted = fs::read_to_string(&path).unwrap();
        assert!(!persisted.contains("ampOpenaiProviders"));
        assert!(!persisted.contains("ampOpenaiProvider"));
        assert!(persisted.contains("openaiCompatibleProviders"));

        let _ = fs::remove_dir_all(dir);
    }
```

(Reuse the `test_dir`, `load_config_from_path`, `save_config_to_path` helpers and the legacy-JSON fixture style already used in `mod tests` — see the existing single-provider→array migration test in this module.)

- [ ] **Step 6: Run Rust tests**

Run: `cd src-tauri && cargo test`
Expected: all tests pass; `settings_write_lands_in_canonical_field` no longer exists; `save_never_writes_flat_fields` and updated `migration_amp_to_rich_on_load` pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/config.rs src-tauri/src/commands/config.rs src-tauri/src/commands/api_keys.rs
git commit -m "refactor: openai_compatible_providers is the single persisted source; drop flat mirror"
```

---

### Task 2: TypeScript — types and store on rich

**Files:**

- Modify: `src/lib/tauri/config.ts` (AppConfig fields, imports)
- Modify: `src/lib/tauri/models.ts` (delete Amp interfaces if unused)
- Modify: `src/stores/app.ts` (default config)

**Interfaces:**

- Consumes: `OpenAICompatibleProvider` (already defined in `src/lib/tauri/api-keys.ts:65-75`: `apiKeyEntries: Array<{apiKey: string; proxyUrl?: string}>`, `baseUrl`, `headers?`, `models?: ModelMapping[]`, `name`, `prefix?`)
- Produces: `AppConfig.openaiCompatibleProviders: OpenAICompatibleProvider[]` (required field); no `ampOpenaiProviders` anywhere in TS

- [ ] **Step 1: Update `AppConfig` type**

In `src/lib/tauri/config.ts`:

- Change the import line `import type { AmpOpenAIProvider, CopilotConfig } from "./models";` to `import type { CopilotConfig } from "./models";`
- Remove `ampOpenaiProvider?: AmpOpenAIProvider;` and `ampOpenaiProviders: AmpOpenAIProvider[];` lines.
- Change `openaiCompatibleProviders?: OpenAICompatibleProvider[];` to `openaiCompatibleProviders: OpenAICompatibleProvider[];`

- [ ] **Step 2: Delete unused Amp interfaces from `models.ts`**

In `src/lib/tauri/models.ts`, delete `AmpOpenAIModel` and `AmpOpenAIProvider` interfaces (lines ~9-20). Keep `CopilotConfig` and everything else.

- [ ] **Step 3: Update store default**

In `src/stores/app.ts` line ~51, change `ampOpenaiProviders: []` to `openaiCompatibleProviders: []` (it should already be next to other config defaults; if `openaiCompatibleProviders` is already present, just remove the amp line).

- [ ] **Step 4: Type check**

Run: `pnpm tsc --noEmit`
Expected: errors only in files still referencing `ampOpenaiProviders` — that's the next task. If `models.ts` deletion broke an import, fix the import.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tauri/config.ts src/lib/tauri/models.ts src/stores/app.ts
git commit -m "refactor(ts): AppConfig uses openaiCompatibleProviders as the only provider field"
```

---

### Task 3: Frontend — Settings form on rich, readers updated

**Note (2026-08-04):** Task 3 was superseded during execution. The Settings duplicate
(`OpenAIProviderSettings.tsx`) was DELETED instead of rewritten — API Keys tab is the single
management surface. What shipped:

- `OpenAIProviderSettings.tsx` deleted; render removed from `Settings.tsx`.
- `AdvancedSettings.tsx` / `Settings.tsx` readers switched to `openaiCompatibleProviders`.
- Startup race fixed: `Sidebar.tsx` effect skips persist while `isLoading()`.

**Files (executed):**

- Delete: `src/components/settings/OpenAIProviderSettings.tsx`
- Modify: `src/components/settings/AdvancedSettings.tsx` (~line 265)
- Modify: `src/pages/Settings.tsx` (~line 147, import + render removal)
- Modify: `src/components/Sidebar.tsx` (race guard)

**Interfaces:**

- Consumes: `props.config().openaiCompatibleProviders: OpenAICompatibleProvider[]`; `props.setConfig`, `props.setSaving`, `saveConfig` from `../../lib/tauri` (unchanged signatures); `ModelMapping` type from `src/lib/tauri`
- Produces: Settings page that adds/edits/deletes rich providers (multi-key + prefix) with index-based editing; no references to `ampOpenaiProviders` remain in `src/`

- [ ] **Step 1: Rewrite `OpenAIProviderSettings.tsx` to rich**

Replace the whole file content with a rich-format version. Key changes from the current file (keep i18n keys, Button/UI components, toast patterns identical):

- Import: `import type { OpenAICompatibleProvider } from "../../lib/tauri";` (drop `AmpOpenAIModel, AmpOpenAIProvider` imports).
- State: replace `editingProviderId` with `editingIndex = createSignal<number | null>(null)`; replace `providerApiKey` signal with `providerApiKeys = createSignal<{ apiKey: string }[]>([])` plus `bulkKeysInput = createSignal("")` and `bulkAddMode = createSignal(false)`; replace `providerModels` type with `ModelMapping[]` (alias optional). Add `providerPrefix = createSignal("")`.
- `saveOpenAIProvider`:

```tsx
const saveOpenAIProvider = async () => {
  const name = providerName().trim();
  const baseUrl = providerBaseUrl().trim();
  const keys = providerApiKeys()
    .map((k) => k.apiKey.trim())
    .filter((k) => k.length > 0)
    .map((apiKey) => ({ apiKey }));

  if (!name || !baseUrl || keys.length === 0) {
    toastStore.error(t("settings.toasts.providerFieldsRequired"));
    return;
  }

  const currentProviders = props.config().openaiCompatibleProviders || [];
  const editIndex = editingIndex();
  const provider: OpenAICompatibleProvider = {
    name,
    baseUrl,
    apiKeyEntries: keys,
    prefix: providerPrefix().trim() || undefined,
    models: providerModels().length > 0 ? providerModels() : undefined,
  };

  let newProviders: OpenAICompatibleProvider[];
  if (editIndex !== null) {
    newProviders = currentProviders.map((p, i) => (i === editIndex ? provider : p));
  } else {
    newProviders = [...currentProviders, provider];
  }

  const newConfig = {
    ...props.config(),
    openaiCompatibleProviders: newProviders,
  };
  props.setConfig(newConfig);

  props.setSaving(true);
  try {
    await saveConfig(newConfig);
    toastStore.success(
      editIndex !== null
        ? t("settings.toasts.providerUpdated")
        : t("settings.toasts.providerAdded"),
    );
    closeProviderModal();
  } catch (error) {
    console.error("Failed to save config:", error);
    toastStore.error(t("settings.toasts.settingsSaveFailed"), String(error));
  } finally {
    props.setSaving(false);
  }
};
```

- `deleteOpenAIProvider(providerId)` → `deleteOpenAIProvider(index: number)`: filter by index, same shape as save but no prefix/models:

```tsx
const newProviders = currentProviders.filter((_, i) => i !== index);
```

- `openProviderModal(provider?: OpenAICompatibleProvider, index?: number)`: on edit set `editingIndex(index)`, `providerName`, `providerBaseUrl`, `providerPrefix(provider.prefix || "")`, `providerModels(provider.models || [])`, and populate keys: if `provider.apiKeyEntries.length > 1` → `bulkAddMode(true)` + `bulkKeysInput(entries.map(e => e.apiKey).join("\n"))`; else `bulkAddMode(false)` + single-key input value. `closeProviderModal` resets all signals.
- Table row: `<For each={props.config().openaiCompatibleProviders || []}>` with columns Name, Base URL, `{provider.apiKeyEntries.length} keys`, Prefix (`{provider.prefix || "—"}`), `{(provider.models?.length || 0)} models`, Actions (edit/delete buttons; delete calls `deleteOpenAIProvider(index())`).
- Modal form: Name + Base URL inputs (unchanged markup), then API Keys block copying the API Keys tab pattern (`OpenAICompatibleTab.tsx` lines ~575-640): a "Bulk add / Single key" toggle button, single `<input type="password">` OR bulk `<textarea>` with live `{keys.length} keys detected` counter:

```tsx
<div class="space-y-2">
  <div class="flex items-center justify-between">
    <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
      {t("apiKeys.labels.apiKeysRequired")}
    </span>
    <button
      class="text-xs text-brand-600 hover:underline dark:text-brand-500"
      onClick={() => {
        setBulkAddMode(!bulkAddMode());
        if (!bulkAddMode()) {
          const existing = providerApiKeys()
            .map((e) => e.apiKey)
            .filter((k) => k.trim())
            .join("\n");
          setBulkKeysInput(existing);
        }
      }}
      type="button"
    >
      {bulkAddMode() ? t("apiKeys.actions.singleKey") : t("apiKeys.actions.bulkAdd")}
    </button>
  </div>

  <Show when={!bulkAddMode()}>
    <input
      class="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
      onInput={(e) => setProviderApiKeys([{ apiKey: e.currentTarget.value }])}
      placeholder={t("apiKeys.placeholders.providerApiKey")}
      type="password"
      value={providerApiKeys()[0]?.apiKey || ""}
    />
  </Show>

  <Show when={bulkAddMode()}>
    <textarea
      class="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
      onInput={(e) => {
        setBulkKeysInput(e.currentTarget.value);
        const keys = e.currentTarget.value
          .split("\n")
          .map((k) => k.trim())
          .filter((k) => k.length > 0)
          .map((apiKey) => ({ apiKey }));
        setProviderApiKeys(keys.length > 0 ? keys : [{ apiKey: "" }]);
      }}
      placeholder={t("apiKeys.placeholders.bulkApiKeys")}
      rows={5}
      value={bulkKeysInput()}
    />
    <p class="text-xs text-gray-500 dark:text-gray-400">
      {providerApiKeys().filter((e) => e.apiKey.trim()).length} {t("apiKeys.keysDetected")}
    </p>
  </Show>
</div>
```

- Prefix field (after API Keys block, before Models):

```tsx
<label class="block">
  <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
    {t("apiKeys.labels.prefixOptional")}
  </span>
  <input
    class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900"
    onInput={(e) => setProviderPrefix(e.currentTarget.value)}
    placeholder={t("apiKeys.placeholders.providerPrefix")}
    type="text"
    value={providerPrefix()}
  />
</label>
```

- Models block: unchanged markup, but `providerModels()` is `ModelMapping[]`; `addProviderModel` uses `{ alias: newModelAlias().trim() || undefined, name }` (alias optional in rich) — check `ModelMapping` in `src/lib/tauri/api-keys.ts:4-7` (`alias?: string; name: string`). `removeProviderModel` unchanged.
- Test Connection block: unchanged (uses `providerBaseUrl()` and first key `providerApiKeys()[0]?.apiKey || ""`).
- Footer Save button: `disabled={!providerName().trim() || !providerBaseUrl().trim() || providerApiKeys().filter(k => k.apiKey.trim()).length === 0}`.
- Delete the `openaiCompatibleProviders: []` hack — it's gone by construction (no amp field at all).
- Empty-state condition: `(props.config().openaiCompatibleProviders || []).length === 0`.

- [ ] **Step 2: Update read-only consumers**

In `src/components/settings/AdvancedSettings.tsx` `getAvailableTargetModels` (~line 265):

```tsx
const providers = props.config().openaiCompatibleProviders || [];
for (const provider of providers) {
  if (provider?.models) {
    for (const model of provider.models) {
      if (model.alias) {
        customModels.push({ label: `${model.alias} (${provider.name})`, value: model.alias });
      } else {
        customModels.push({ label: `${model.name} (${provider.name})`, value: model.name });
      }
    }
  }
}
```

In `src/pages/Settings.tsx` `getAvailableTargetModels` (~line 147): same replacement (`config().ampOpenaiProviders` → `config().openaiCompatibleProviders`).

- [ ] **Step 3: Verify no `ampOpenaiProviders` references remain**

Run: `grep -rn "ampOpenaiProviders\|ampOpenaiProvider" src/`
Expected: no matches (the `@deprecated` comments in `config.ts` for `ampApiKey`/`ampModelMappings`/`ampRoutingMode` are unrelated — those stay).

- [ ] **Step 4: Type check**

Run: `pnpm tsc --noEmit`
Expected: clean (no output). If `OpenAIProviderSettings.tsx` uses an i18n key that doesn't exist, add it to `src/i18n/en.ts` (check existing keys: `settings.toasts.*`, `apiKeys.labels.prefixOptional`, `apiKeys.labels.apiKeysRequired`, `apiKeys.actions.bulkAdd`, `apiKeys.actions.singleKey`, `apiKeys.placeholders.bulkApiKeys`, `apiKeys.keysDetected`, `apiKeys.placeholders.providerPrefix` all exist in `OpenAICompatibleTab.tsx` usage).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/OpenAIProviderSettings.tsx src/components/settings/AdvancedSettings.tsx src/pages/Settings.tsx
git commit -m "feat(settings): migrate OpenAI-compatible provider form to rich format (multi-key + prefix)"
```

---

### Task 4: End-to-end verification

**Files:**

- None (verification only)

- [ ] **Step 1: Full Rust test suite**

Run: `cd src-tauri && cargo check && cargo test`
Expected: cargo check clean; all tests pass (including `save_never_writes_flat_fields`, updated `migration_amp_to_rich_on_load`, `restart_persists_rich_multi_key_and_prefix`, `build_proxy_yaml_emits_all_rich_keys_and_prefix`).

- [ ] **Step 2: Full TS check**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual dev checklist**

Run: `pnpm tauri dev`

1. **Migration:** the current machine's `~/Library/Application Support/proxypal/config.json` still contains `ampOpenaiProviders` — launch and verify providers appear in API Keys AND Settings; after a restart, `config.json` contains NO `ampOpenai*` keys (grep the file).
2. **Settings flow:** Settings → Add Provider → 3 keys (bulk mode) + prefix → save → restart → all 3 keys + prefix intact in Settings table and in `proxy-config.yaml` (`api-key-entries` count + `prefix:` line).
3. **API Keys flow:** existing nvidia provider (5 keys, prefix `Nvidia`) → restart → unchanged.
4. **Cross-visibility:** add a provider via API Keys tab → visible in Settings table; edit via Settings → visible in API Keys tab (single source).
5. **Dock/tray regression** (already merged): close to tray → Dock icon disappears; restore → window paints without black frame.

- [ ] **Step 4: Update PR description note**

The PR description (when pushing) must mention: Settings section and API Keys OpenAI Compatible tab are now functional duplicates — candidate for removing one (the Settings section) in future work.

---

### Task 5: Commit plan artifacts (if any remain)

**Files:**

- None expected

- [ ] **Step 1: Verify working tree clean**

Run: `git status --short`
Expected: only untracked `docs/superpowers/plans/2026-08-04-single-source-openai-providers.md` and spec file (already committed). Commit the plan file:

```bash
git add docs/superpowers/plans/2026-08-04-single-source-openai-providers.md
git commit -m "docs: implementation plan for single-source OpenAI-compatible providers"
```
