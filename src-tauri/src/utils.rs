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
    
    if model_lower.contains("claude") || model_lower.contains("sonnet") || 
       model_lower.contains("opus") || model_lower.contains("haiku") {
        return "claude".to_string();
    }
    if model_lower.contains("gpt") || model_lower.contains("codex") || 
       model_lower.starts_with("o3") || model_lower.starts_with("o1") {
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
    if model_lower.contains("antigravity") {
        return "antigravity".to_string();
    }
    
    "unknown".to_string()
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
    if path.contains("/v1beta") || path.contains(":generateContent") || path.contains(":streamGenerateContent") {
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
