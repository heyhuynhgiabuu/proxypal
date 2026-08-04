//! Utility functions for provider detection, model extraction, and cost estimation.

/// Estimate cost based on model and tokens (pricing per 1M tokens)
pub fn estimate_request_cost(model: &str, tokens_in: u32, tokens_out: u32) -> f64 {
    let (input_rate, output_rate) = match model.to_lowercase().as_str() {
        // Claude models
        m if m.contains("claude") && m.contains("opus") => (15.0, 75.0),
        m if m.contains("claude") && m.contains("sonnet") => (3.0, 15.0),
        m if m.contains("claude") && m.contains("haiku") => (0.25, 1.25),
        // GPT models
        m if m.contains("gpt-5") => (15.0, 45.0),
        m if m.contains("gpt-4o") => (2.5, 10.0),
        m if m.contains("gpt-4-turbo") || m.contains("gpt-4") => (10.0, 30.0),
        m if m.contains("gpt-3.5") => (0.5, 1.5),
        // Gemini models
        m if m.contains("gemini") && m.contains("pro") => (1.25, 5.0),
        m if m.contains("gemini") && m.contains("flash") => (0.075, 0.30),
        m if m.contains("gemini-2") => (0.10, 0.40),
        m if m.contains("qwen") => (0.50, 2.0),
        _ => (1.0, 3.0),
    };

    let input_cost = (tokens_in as f64 / 1_000_000.0) * input_rate;
    let output_cost = (tokens_out as f64 / 1_000_000.0) * output_rate;
    input_cost + output_cost
}

/// Detect provider from model name
pub fn detect_provider_from_model(model: &str) -> String {
    let model_lower = model.to_lowercase();

    // Antigravity detection: explicit "antigravity" in name, or known Antigravity-only model IDs
    // These Gemini models are served exclusively by Antigravity (not Google/Vertex)
    if model_lower.contains("antigravity") {
        return "antigravity".to_string();
    }
    // Antigravity-exclusive Gemini model variants (no "-preview" suffix)
    // Gemini 3.0 (no dot) — exact names from Antigravity API
    if model_lower == "gemini-3-flash"
        || model_lower == "gemini-3-pro-high"
        || model_lower == "gemini-3-pro-low"
        || model_lower == "gemini-3-pro-image"
        || model_lower == "tab_flash_lite_preview"
        || model_lower == "gpt-oss-120b-medium"
        // Gemini 3.1 — Antigravity-only variants
        || model_lower == "gemini-3.1-pro-high"
        || model_lower == "gemini-3.1-pro-low"
        // Gemini 3.5 — Antigravity-only variants
        || model_lower == "gemini-3.5-flash"
        || model_lower == "gemini-3.5-flash-low"
        // Gemini 3.6 — Antigravity-only variant
        || model_lower == "gemini-3.6-flash-high"
    {
        return "antigravity".to_string();
    }
    // Antigravity thinking variants of Claude models
    if model_lower.ends_with("-thinking")
        && (model_lower.contains("claude")
            || model_lower.contains("sonnet")
            || model_lower.contains("opus"))
    {
        return "antigravity".to_string();
    }
    if model_lower.contains("claude")
        || model_lower.contains("sonnet")
        || model_lower.contains("opus")
        || model_lower.contains("haiku")
    {
        return "claude".to_string();
    }
    if model_lower.contains("gpt")
        || model_lower.contains("codex")
        || model_lower.starts_with("o3")
        || model_lower.starts_with("o1")
    {
        return "openai".to_string();
    }
    if model_lower.contains("gemini") {
        return "gemini".to_string();
    }
    if model_lower.contains("qwen") {
        return "qwen".to_string();
    }
    if model_lower.contains("deepseek") {
        return "deepseek".to_string();
    }
    if model_lower.contains("glm") {
        return "zhipu".to_string();
    }

    "unknown".to_string()
}

/// Infer provider name from an auth credential filename.
///
/// Auth files follow the pattern `<provider-prefix>-<account>.json` (or `.json.disabled`).
/// Returns the canonical provider string, or `"unknown"` if no prefix matches.
///
/// This is the single source of truth for filename→provider mapping, used by both
/// `auth_files.rs` (filesystem scan) and `auth.rs` (credential deletion).
pub fn detect_provider_from_filename(name: &str) -> &'static str {
    /// (prefix, provider) pairs — order doesn't matter since prefixes are disjoint.
    const MAPPINGS: &[(&str, &str)] = &[
        ("claude-", "claude"),
        ("anthropic-", "claude"),
        ("codex-", "openai"),
        ("gemini-", "gemini"),
        ("qwen-", "qwen"),
        ("iflow-", "iflow"),
        ("vertex-", "vertex"),
        ("kiro-", "kiro"),
        ("antigravity-", "antigravity"),
        ("kimi-", "kimi"),
        ("github-", "github"),
        ("aws-", "AWS"),
    ];

    for &(prefix, provider) in MAPPINGS {
        if name.starts_with(prefix) {
            return provider;
        }
    }
    "unknown"
}

/// Return the filename prefixes associated with a canonical provider name.
///
/// Used by `auth.rs` to match credential files for deletion.
/// Returns an empty slice for unknown providers.
pub fn provider_filename_prefixes(provider: &str) -> &'static [&'static str] {
    match provider {
        "claude" => &["claude-", "anthropic-"],
        "openai" => &["codex-"],
        "gemini" => &["gemini-"],
        "qwen" => &["qwen-"],
        "iflow" => &["iflow-"],
        "vertex" => &["vertex-"],
        "kiro" => &["kiro-"],
        "antigravity" => &["antigravity-"],
        "kimi" => &["kimi-"],
        "github" => &["github-"],
        "AWS" => &["aws-"],
        _ => &[],
    }
}

/// Extract provider from Amp-style API path
/// e.g., "/api/provider/anthropic/v1/messages" -> "claude"
pub fn detect_provider_from_path(path: &str) -> Option<String> {
    // First try Amp-style path
    if path.contains("/api/provider/") {
        let parts: Vec<&str> = path.split('/').collect();
        if let Some(idx) = parts.iter().position(|&p| p == "provider") {
            if let Some(provider) = parts.get(idx + 1) {
                return Some(match *provider {
                    "anthropic" => "claude".to_string(),
                    "openai" => "openai".to_string(),
                    "google" => "gemini".to_string(),
                    p => p.to_string(),
                });
            }
        }
    }

    // Fallback: infer from standard endpoint paths
    if path.contains("/v1/messages") || path.contains("/messages") {
        return Some("claude".to_string());
    }
    if path.contains("/v1/chat/completions") || path.contains("/chat/completions") {
        return Some("openai-compat".to_string());
    }
    if path.contains("/v1beta")
        || path.contains(":generateContent")
        || path.contains(":streamGenerateContent")
    {
        return Some("gemini".to_string());
    }

    None
}

/// Extract model from API path (for Gemini-style URLs)
pub fn extract_model_from_path(path: &str) -> Option<String> {
    if path.contains("/models/") {
        if let Some(idx) = path.find("/models/") {
            let model_part = &path[idx + 8..];
            let model = if let Some(colon_idx) = model_part.find(':') {
                &model_part[..colon_idx]
            } else if let Some(slash_idx) = model_part.find('/') {
                &model_part[..slash_idx]
            } else {
                model_part
            };
            if !model.is_empty() {
                return Some(model.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_provider_from_model_classifies_gemini_3_6_flash_high_as_antigravity() {
        assert_eq!(
            detect_provider_from_model("gemini-3.6-flash-high"),
            "antigravity"
        );
    }

    #[test]
    fn detect_provider_from_filename_known_prefixes() {
        assert_eq!(
            detect_provider_from_filename("claude-user@example.json"),
            "claude"
        );
        assert_eq!(
            detect_provider_from_filename("anthropic-foo.json"),
            "claude"
        );
        assert_eq!(detect_provider_from_filename("codex-bar.json"), "openai");
        assert_eq!(detect_provider_from_filename("gemini-baz.json"), "gemini");
        assert_eq!(detect_provider_from_filename("qwen-test.json"), "qwen");
        assert_eq!(detect_provider_from_filename("iflow-acct.json"), "iflow");
        assert_eq!(detect_provider_from_filename("vertex-proj.json"), "vertex");
        assert_eq!(detect_provider_from_filename("kiro-dev.json"), "kiro");
        assert_eq!(
            detect_provider_from_filename("antigravity-x.json"),
            "antigravity"
        );
        assert_eq!(detect_provider_from_filename("kimi-user.json"), "kimi");
        assert_eq!(detect_provider_from_filename("github-token.json"), "github");
        assert_eq!(detect_provider_from_filename("aws-creds.json"), "AWS");
    }

    #[test]
    fn detect_provider_from_filename_unknown() {
        assert_eq!(detect_provider_from_filename("random-file.json"), "unknown");
        assert_eq!(detect_provider_from_filename("config.json"), "unknown");
    }

    #[test]
    fn provider_filename_prefixes_roundtrip() {
        // Every known provider should have at least one prefix
        for provider in &[
            "claude",
            "openai",
            "gemini",
            "qwen",
            "iflow",
            "vertex",
            "kiro",
            "antigravity",
            "kimi",
        ] {
            let prefixes = provider_filename_prefixes(provider);
            assert!(
                !prefixes.is_empty(),
                "provider '{}' should have prefixes",
                provider
            );
            // Each prefix should map back to the same provider
            for prefix in prefixes {
                let filename = format!("{}test.json", prefix);
                assert_eq!(
                    detect_provider_from_filename(&filename),
                    *provider,
                    "prefix '{}' should map to provider '{}'",
                    prefix,
                    provider
                );
            }
        }
    }

    #[test]
    fn provider_filename_prefixes_unknown_returns_empty() {
        assert!(provider_filename_prefixes("nonexistent").is_empty());
    }
}
