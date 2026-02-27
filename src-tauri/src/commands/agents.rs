//! CLI Agent & IDE Tool commands.
//!
//! Extracted from lib.rs — handles detection and configuration of CLI agents
//! (Claude Code, Codex, Gemini CLI, etc.) and IDE tools (Cursor, Continue, etc.).

use crate::state::AppState;
use crate::types::{AgentStatus, AvailableModel, DetectedTool};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::State;

// Detect installed CLI agents
#[tauri::command]
pub fn detect_cli_agents(state: State<AppState>) -> Vec<AgentStatus> {
    let home = dirs::home_dir().unwrap_or_default();
    let config = state.config.lock().unwrap();
    let endpoint = format!("http://127.0.0.1:{}", config.port);
    let mut agents = Vec::new();

    // 1. Claude Code - uses environment variables
    // Check if claude/claude-code binary exists
    let claude_installed = which_exists("claude");
    let claude_configured = check_env_configured("ANTHROPIC_BASE_URL", &endpoint);

    agents.push(AgentStatus {
        id: "claude-code".to_string(),
        name: "Claude Code".to_string(),
        description: "Anthropic's official CLI for Claude models".to_string(),
        installed: claude_installed,
        configured: claude_configured,
        config_type: "env".to_string(),
        config_path: None,
        logo: "/logos/claude.svg".to_string(),
        docs_url: "https://help.router-for.me/agent-client/claude-code.html".to_string(),
    });

    // 2. Codex - uses ~/.codex/config.toml and ~/.codex/auth.json
    let codex_installed = which_exists("codex");
    let codex_config = home.join(".codex/config.toml");
    let codex_configured = if codex_config.exists() {
        std::fs::read_to_string(&codex_config)
            .map(|c| c.contains("cliproxyapi") || c.contains(&endpoint))
            .unwrap_or(false)
    } else {
        false
    };

    agents.push(AgentStatus {
        id: "codex".to_string(),
        name: "Codex CLI".to_string(),
        description: "OpenAI's Codex CLI for GPT-5 models".to_string(),
        installed: codex_installed,
        configured: codex_configured,
        config_type: "file".to_string(),
        config_path: Some(codex_config.to_string_lossy().to_string()),
        logo: "/logos/openai.svg".to_string(),
        docs_url: "https://help.router-for.me/agent-client/codex.html".to_string(),
    });

    // 3. Gemini CLI - uses environment variables
    let gemini_installed = which_exists("gemini");
    let gemini_configured = check_env_configured("CODE_ASSIST_ENDPOINT", &endpoint)
        || check_env_configured("GOOGLE_GEMINI_BASE_URL", &endpoint);

    agents.push(AgentStatus {
        id: "gemini-cli".to_string(),
        name: "Gemini CLI".to_string(),
        description: "Google's Gemini CLI for Gemini models".to_string(),
        installed: gemini_installed,
        configured: gemini_configured,
        config_type: "env".to_string(),
        config_path: None,
        logo: "/logos/gemini.svg".to_string(),
        docs_url: "https://help.router-for.me/agent-client/gemini-cli.html".to_string(),
    });

    // 4. Factory Droid - uses ~/.factory/config.json
    let droid_installed = which_exists("droid") || which_exists("factory");
    let droid_config = home.join(".factory/config.json");
    let droid_configured = if droid_config.exists() {
        std::fs::read_to_string(&droid_config)
            .map(|c| c.contains(&endpoint) || c.contains("127.0.0.1:8317"))
            .unwrap_or(false)
    } else {
        false
    };

    agents.push(AgentStatus {
        id: "factory-droid".to_string(),
        name: "Factory Droid".to_string(),
        description: "Factory's AI coding agent".to_string(),
        installed: droid_installed,
        configured: droid_configured,
        config_type: "file".to_string(),
        config_path: Some(droid_config.to_string_lossy().to_string()),
        logo: "/logos/droid.svg".to_string(),
        docs_url: "https://help.router-for.me/agent-client/droid.html".to_string(),
    });

    // 5. Amp CLI - uses ~/.config/amp/settings.json or AMP_URL env
    let amp_installed = which_exists("amp");
    let amp_config = home.join(".config/amp/settings.json");
    let amp_configured = check_env_configured("AMP_URL", &endpoint) || {
        if amp_config.exists() {
            std::fs::read_to_string(&amp_config)
                .map(|c| c.contains(&endpoint) || c.contains("localhost:8317"))
                .unwrap_or(false)
        } else {
            false
        }
    };

    agents.push(AgentStatus {
        id: "amp-cli".to_string(),
        name: "Amp CLI".to_string(),
        description: "Sourcegraph's Amp coding assistant".to_string(),
        installed: amp_installed,
        configured: amp_configured,
        config_type: "both".to_string(),
        config_path: Some(amp_config.to_string_lossy().to_string()),
        logo: "/logos/amp.svg".to_string(),
        docs_url: "https://help.router-for.me/agent-client/amp-cli.html".to_string(),
    });

    // 6. OpenCode - uses opencode.json config file with custom provider
    let opencode_installed = which_exists("opencode");
    // Check for global opencode.json in ~/.config/opencode/opencode.json
    let opencode_global_config = home.join(".config/opencode/opencode.json");
    let opencode_configured = if opencode_global_config.exists() {
        // Check if our proxypal provider is configured
        std::fs::read_to_string(&opencode_global_config)
            .map(|content| content.contains("proxypal") && content.contains(&endpoint))
            .unwrap_or(false)
    } else {
        false
    };

    agents.push(AgentStatus {
        id: "opencode".to_string(),
        name: "OpenCode".to_string(),
        description: "Terminal-based AI coding assistant".to_string(),
        installed: opencode_installed,
        configured: opencode_configured,
        config_type: "config".to_string(),
        config_path: Some(opencode_global_config.to_string_lossy().to_string()),
        logo: "/logos/opencode.svg".to_string(),
        docs_url: "https://opencode.ai/docs/providers/".to_string(),
    });

    agents
}

// Helper to check if a command exists by checking common installation paths
// Note: Using `which` command doesn't work in production builds (sandboxed macOS app)
// so we check common binary locations directly
fn which_exists(cmd: &str) -> bool {
    let home = dirs::home_dir().unwrap_or_default();

    // Common binary installation paths (static)
    let mut paths = vec![
        // Homebrew (Apple Silicon)
        std::path::PathBuf::from("/opt/homebrew/bin"),
        // Homebrew (Intel) / system
        std::path::PathBuf::from("/usr/local/bin"),
        // System binaries
        std::path::PathBuf::from("/usr/bin"),
        // Cargo (Rust)
        home.join(".cargo/bin"),
        // npm global (default)
        home.join(".npm-global/bin"),
        // npm global (alternative)
        std::path::PathBuf::from("/usr/local/lib/node_modules/.bin"),
        // Local bin
        home.join(".local/bin"),
        // Go binaries
        home.join("go/bin"),
        // Bun binaries
        home.join(".bun/bin"),
        // OpenCode CLI
        home.join(".opencode/bin"),
    ];

    // WSL-specific paths: check Windows side binaries
    // On WSL, Windows paths are accessible via /mnt/c/
    if std::path::Path::new("/mnt/c").exists() {
        let windows_home =
            std::path::PathBuf::from("/mnt/c/Users").join(home.file_name().unwrap_or_default());

        // Add Windows-side paths
        paths.push(windows_home.join("scoop/shims")); // Scoop package manager
        paths.push(windows_home.join(".cargo/bin"));
        paths.push(windows_home.join("go/bin"));
        paths.push(windows_home.join(".bun/bin"));
        paths.push(windows_home.join("AppData/Local/npm"));
        paths.push(windows_home.join("AppData/Roaming/npm"));
    }

    // Windows-specific paths (when running on Windows directly)
    #[cfg(target_os = "windows")]
    {
        // AppData\Roaming\npm - where npm global packages are installed by default
        if let Some(app_data) = std::env::var_os("APPDATA") {
            let app_data_path = std::path::PathBuf::from(app_data);
            paths.push(app_data_path.join("npm"));
        }
        // AppData\Local paths
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            let local_app_data_path = std::path::PathBuf::from(local_app_data);
            paths.push(local_app_data_path.join("npm"));
            paths.push(local_app_data_path.join("scoop/shims"));
        }
        if let Some(program_files) = std::env::var_os("PROGRAMFILES") {
            paths.push(std::path::PathBuf::from(program_files).join("Git\\cmd"));
        }

        // Windows detecting WSL-installed binaries
        // Only search WSL paths if WSL is actually installed and available
        // Check by seeing if wsl.exe exists and can be executed
        let mut wsl_cmd = std::process::Command::new("wsl");
        wsl_cmd.arg("--status");
        #[cfg(target_os = "windows")]
        wsl_cmd.creation_flags(CREATE_NO_WINDOW);
        let wsl_available = wsl_cmd
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if wsl_available {
            // WSL paths accessible via \\wsl.localhost\<distro>\home\<user> or \\wsl$\<distro>\home\<user>
            let wsl_distros = ["Ubuntu", "Ubuntu-22.04", "Ubuntu-24.04", "Debian"];
            let username = home.file_name().unwrap_or_default().to_string_lossy();

            'wsl_search: for distro in &wsl_distros {
                // Try both WSL path formats (wsl.localhost is newer, wsl$ is legacy)
                for prefix in &[r"\\wsl.localhost", r"\\wsl$"] {
                    let wsl_home = std::path::PathBuf::from(format!(
                        r"{}\{}\home\{}",
                        prefix, distro, username
                    ));
                    if wsl_home.exists() {
                        // Standard Linux paths in WSL
                        paths.push(wsl_home.join(".local/bin"));
                        paths.push(wsl_home.join(".cargo/bin"));
                        paths.push(wsl_home.join(".bun/bin"));
                        paths.push(wsl_home.join("go/bin"));
                        paths.push(wsl_home.join(".opencode/bin"));

                        // NVM node versions in WSL
                        let wsl_nvm = wsl_home.join(".nvm/versions/node");
                        if wsl_nvm.exists() {
                            if let Ok(entries) = std::fs::read_dir(&wsl_nvm) {
                                for entry in entries.flatten() {
                                    let bin_path = entry.path().join("bin");
                                    if bin_path.exists() {
                                        paths.push(bin_path);
                                    }
                                }
                            }
                        }
                        break 'wsl_search; // Found valid distro, stop searching
                    }
                }
            }
        }
    }

    // Add NVM node versions - scan for installed node versions
    let nvm_dir = home.join(".nvm/versions/node");
    if nvm_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            for entry in entries.flatten() {
                let bin_path = entry.path().join("bin");
                if bin_path.exists() {
                    paths.push(bin_path);
                }
            }
        }
    }

    // Check all paths
    for path in &paths {
        // Check base command (no extension)
        if path.join(cmd).exists() {
            return true;
        }
        // On Windows, also check common executable extensions
        #[cfg(target_os = "windows")]
        {
            for ext in &[".cmd", ".exe", ".bat", ".ps1"] {
                if path.join(format!("{}{}", cmd, ext)).exists() {
                    return true;
                }
            }
        }
    }

    false
}

// Helper to check if env var is set to expected value
fn check_env_configured(var: &str, expected_prefix: &str) -> bool {
    std::env::var(var)
        .map(|v| v.starts_with(expected_prefix))
        .unwrap_or(false)
}

// Configure a CLI agent with ProxyPal
#[tauri::command]
pub async fn configure_cli_agent(
    state: State<'_, AppState>,
    agent_id: String,
    models: Vec<AvailableModel>,
) -> Result<serde_json::Value, String> {
    let (port, endpoint, endpoint_v1) = {
        let config = state.config.lock().unwrap();
        let port = config.port;
        let endpoint = format!("http://127.0.0.1:{}", port);
        let endpoint_v1 = format!("{}/v1", endpoint);
        (port, endpoint, endpoint_v1)
    }; // Mutex guard dropped here
    let home = dirs::home_dir().ok_or("Could not find home directory")?;

    // Precompute thinking/reasoning config for opencode
    let (thinking_budget, reasoning_effort) = {
        let config = state.config.lock().unwrap();
        let mode = if config.thinking_budget_mode.is_empty() {
            "medium"
        } else {
            &config.thinking_budget_mode
        };
        let custom = if config.thinking_budget_custom == 0 {
            16000
        } else {
            config.thinking_budget_custom
        };
        let budget: u64 = match mode {
            "low" => 2048,
            "medium" => 8192,
            "high" => 32768,
            "custom" => custom as u64,
            _ => 8192,
        };
        let effort = if config.reasoning_effort_level.is_empty() {
            "medium".to_string()
        } else {
            config.reasoning_effort_level.clone()
        };
        (budget, effort)
    };

    match agent_id.as_str() {
        "claude-code" => configure_claude_code_agent(&home, &endpoint, &models),

        "codex" => {
            // Create ~/.codex directory
            let codex_dir = home.join(".codex");
            std::fs::create_dir_all(&codex_dir).map_err(|e| e.to_string())?;

            // Write config.toml
            let config_content = format!(
                r#"# ProxyPal - Codex Configuration
model_provider = "cliproxyapi"
model = "gpt-5-codex"
model_reasoning_effort = "high"

[model_providers.cliproxyapi]
name = "cliproxyapi"
base_url = "{}/v1"
wire_api = "responses"
"#,
                endpoint
            );

            let config_path = codex_dir.join("config.toml");
            std::fs::write(&config_path, &config_content).map_err(|e| e.to_string())?;

            // Write auth.json
            let auth_content = r#"{
  "OPENAI_API_KEY": "proxypal-local"
}"#;
            let auth_path = codex_dir.join("auth.json");
            std::fs::write(&auth_path, auth_content).map_err(|e| e.to_string())?;

            Ok(serde_json::json!({
                "success": true,
                "configType": "file",
                "configPath": config_path.to_string_lossy(),
                "authPath": auth_path.to_string_lossy(),
                "instructions": "Codex has been configured. Run 'codex' to start using it."
            }))
        }

        "gemini-cli" => {
            // Generate shell config for Gemini CLI
            let shell_config = format!(
                r#"# ProxyPal - Gemini CLI Configuration
# Option 1: OAuth mode (local only)
export CODE_ASSIST_ENDPOINT="{}"

# Option 2: API Key mode (works with any IP/domain)
# export GOOGLE_GEMINI_BASE_URL="{}"
# export GEMINI_API_KEY="proxypal-local"
"#,
                endpoint, endpoint
            );

            Ok(serde_json::json!({
                "success": true,
                "configType": "env",
                "shellConfig": shell_config,
                "instructions": "Add the above to your ~/.bashrc, ~/.zshrc, or shell config file, then restart your terminal."
            }))
        }

        "factory-droid" => configure_factory_droid_agent(&home, &endpoint, &models),

        "amp-cli" => configure_amp_cli_agent(&home, port),

        "opencode" => configure_opencode_agent(
            &home,
            &endpoint,
            &endpoint_v1,
            &models,
            thinking_budget,
            &reasoning_effort,
        ),

        _ => Err(format!("Unknown agent: {}", agent_id)),
    }
}

fn configure_claude_code_agent(
    home: &std::path::Path,
    endpoint: &str,
    models: &[AvailableModel],
) -> Result<serde_json::Value, String> {
    // Write config to ~/.claude/settings.json (Claude Code's config file)
    let config_dir = home.join(".claude");
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let config_path = config_dir.join("settings.json");

    // Find best models for each tier from available models
    // Priority: Claude > Gemini-Claude > Gemini > GPT
    let find_model = |patterns: &[&str]| -> Option<String> {
        for pattern in patterns {
            if let Some(m) = models.iter().find(|m| m.id.contains(pattern)) {
                return Some(m.id.clone());
            }
        }
        None
    };

    // Opus tier: claude-opus > gpt-5(high)
    let opus_model = find_model(&["claude-opus-4", "claude-opus", "gpt-5"])
        .unwrap_or_else(|| "claude-opus-4-1-20250805".to_string());

    // Sonnet tier: claude-sonnet-4-5 > gpt-5
    let sonnet_model =
        find_model(&["claude-sonnet-4-5", "claude-sonnet-4", "claude-sonnet", "gpt-5"])
            .unwrap_or_else(|| "claude-sonnet-4-5-20250929".to_string());

    // Haiku tier: claude-haiku > gemini-claude-sonnet > gemini-2.5-flash > gpt-5(minimal)
    let haiku_model = find_model(&[
        "claude-3-5-haiku",
        "claude-haiku",
        "gemini-claude-sonnet-4-5",
        "gemini-2.5-flash",
        "gpt-5",
    ])
    .unwrap_or_else(|| "claude-3-5-haiku-20241022".to_string());

    // Build env config for Claude Code settings.json
    let env_config = serde_json::json!({
        "ANTHROPIC_BASE_URL": endpoint,
        "ANTHROPIC_AUTH_TOKEN": "proxypal-local",
        "ANTHROPIC_MODEL": sonnet_model,
        "ANTHROPIC_DEFAULT_OPUS_MODEL": opus_model,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": sonnet_model,
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": haiku_model
    });

    // If config exists, merge with existing (preserve other settings)
    let final_config = if config_path.exists() {
        if let Ok(existing) = std::fs::read_to_string(&config_path) {
            if let Ok(mut existing_json) = serde_json::from_str::<serde_json::Value>(&existing) {
                // Merge env into existing config
                if let Some(env) = existing_json.get_mut("env") {
                    if let Some(obj) = env.as_object_mut() {
                        // Update ProxyPal-related env vars
                        obj.insert(
                            "ANTHROPIC_BASE_URL".to_string(),
                            env_config["ANTHROPIC_BASE_URL"].clone(),
                        );
                        obj.insert(
                            "ANTHROPIC_AUTH_TOKEN".to_string(),
                            env_config["ANTHROPIC_AUTH_TOKEN"].clone(),
                        );
                        obj.insert(
                            "ANTHROPIC_MODEL".to_string(),
                            env_config["ANTHROPIC_MODEL"].clone(),
                        );
                        obj.insert(
                            "ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(),
                            env_config["ANTHROPIC_DEFAULT_OPUS_MODEL"].clone(),
                        );
                        obj.insert(
                            "ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(),
                            env_config["ANTHROPIC_DEFAULT_SONNET_MODEL"].clone(),
                        );
                        obj.insert(
                            "ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(),
                            env_config["ANTHROPIC_DEFAULT_HAIKU_MODEL"].clone(),
                        );
                    }
                } else {
                    existing_json["env"] = env_config;
                }
                existing_json
            } else {
                serde_json::json!({ "env": env_config })
            }
        } else {
            serde_json::json!({ "env": env_config })
        }
    } else {
        serde_json::json!({ "env": env_config })
    };

    let config_str = serde_json::to_string_pretty(&final_config).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, &config_str).map_err(|e| e.to_string())?;

    // Create a reference file with all available model options from each provider
    let reference_path = config_dir.join("proxypal-models.md");
    let reference_content = format!(
        r#"# ProxyPal Model Reference for Claude Code

Edit your `~/.claude/settings.json` and replace the model values in the `env` section.

## Current Configuration
```json
"ANTHROPIC_BASE_URL": "{}",
"ANTHROPIC_AUTH_TOKEN": "proxypal-local",
"ANTHROPIC_MODEL": "{}",
"ANTHROPIC_DEFAULT_OPUS_MODEL": "{}",
"ANTHROPIC_DEFAULT_SONNET_MODEL": "{}",
"ANTHROPIC_DEFAULT_HAIKU_MODEL": "{}"
```

## Available Models by Provider

### Claude (Anthropic)
| Tier | Model ID |
|------|----------|
| Opus | `claude-opus-4-1-20250805`, `claude-opus-4-5-20251101` |
| Sonnet | `claude-sonnet-4-5-20250929`, `claude-sonnet-4-20250514` |
| Haiku | `claude-3-5-haiku-20241022` |

### Gemini via Antigravity (with extended thinking)
| Tier | Model ID |
|------|----------|
| Opus | `claude-opus-4-5-thinking` |
| Sonnet | `claude-sonnet-4-5-thinking`, `claude-sonnet-4-5` |
| Haiku | `gemini-2.5-flash`, `gemini-2.5-flash-lite` |

### Gemini (Google)
| Tier | Model ID |
|------|----------|
| Opus | `gemini-2.5-pro` |
| Sonnet | `gemini-2.5-flash` |
| Haiku | `gemini-2.5-flash-lite` |

### Vertex AI (Google Cloud)
| Tier | Model ID |
|------|----------|
| Opus | `gemini-2.5-pro`, `gemini-3-pro-preview` |
| Sonnet | `gemini-2.5-flash`, `gemini-3-pro-image-preview` |
| Haiku | `gemini-2.5-flash-lite` |

> **Note**: Vertex AI uses Google Cloud service account authentication.
> Import your service account JSON in ProxyPal to use these models.

### OpenAI GPT-5
| Tier | Model ID |
|------|----------|
| Opus | `gpt-5(high)`, `gpt-5` |
| Sonnet | `gpt-5(medium)`, `gpt-5-codex` |
| Haiku | `gpt-5(minimal)`, `gpt-5(low)` |

### Qwen
| Tier | Model ID |
|------|----------|
| Opus | `qwen3-coder-plus`, `qwen3-max` |
| Sonnet | `qwen3-coder-plus` |
| Haiku | `qwen3-coder-flash`, `qwen3-235b-a22b-instruct` |

### iFlow
| Tier | Model ID |
|------|----------|
| Opus | `qwen3-max` |
| Sonnet | `qwen3-coder-plus` |
| Haiku | `qwen3-235b-a22b-instruct` |

## Example Configurations

### Use Gemini Antigravity (with thinking)
```json
"ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-5-thinking",
"ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-5-thinking",
"ANTHROPIC_DEFAULT_HAIKU_MODEL": "gemini-2.5-flash"
```

### Use OpenAI GPT-5
```json
"ANTHROPIC_DEFAULT_OPUS_MODEL": "gpt-5(high)",
"ANTHROPIC_DEFAULT_SONNET_MODEL": "gpt-5(medium)",
"ANTHROPIC_DEFAULT_HAIKU_MODEL": "gpt-5(minimal)"
```

### Use Qwen
```json
"ANTHROPIC_DEFAULT_OPUS_MODEL": "qwen3-coder-plus",
"ANTHROPIC_DEFAULT_SONNET_MODEL": "qwen3-coder-plus",
"ANTHROPIC_DEFAULT_HAIKU_MODEL": "qwen3-coder-flash"
```

---
Generated by ProxyPal. Run `claude` to start using Claude Code.
"#,
        endpoint, sonnet_model, opus_model, sonnet_model, haiku_model
    );

    std::fs::write(&reference_path, &reference_content).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "success": true,
        "configType": "config",
        "configPath": config_path.to_string_lossy(),
        "modelsConfigured": models.len(),
        "instructions": format!("ProxyPal configured for Claude Code. See {} for all available model options from different providers.", reference_path.to_string_lossy())
    }))
}

fn configure_factory_droid_agent(
    home: &std::path::Path,
    endpoint: &str,
    models: &[AvailableModel],
) -> Result<serde_json::Value, String> {
    // Create ~/.factory directory
    let factory_dir = home.join(".factory");
    std::fs::create_dir_all(&factory_dir).map_err(|e| e.to_string())?;

    // Build dynamic custom_models array from available models
    let proxypal_models: Vec<serde_json::Value> = models
        .iter()
        .map(|m| {
            let (base_url, provider) = match m.owned_by.as_str() {
                "anthropic" => (endpoint.to_string(), "anthropic"),
                _ => (format!("{}/v1", endpoint), "openai"),
            };

            // Add source indicator to model display name for clarity
            let display_name = match m.source.as_str() {
                "vertex" => format!("{} [Vertex]", m.id),
                "vertex+gemini-api" => format!("{} [Vertex+API]", m.id),
                "copilot" => format!("{} [Copilot]", m.id),
                _ => m.id.clone(),
            };

            serde_json::json!({
                "model": m.id,
                "model_display_name": display_name,
                "base_url": base_url,
                "api_key": "proxypal-local",
                "provider": provider
            })
        })
        .collect();

    let config_path = factory_dir.join("config.json");

    // Merge with existing config to preserve user's other custom_models
    let final_config = if config_path.exists() {
        if let Ok(existing) = std::fs::read_to_string(&config_path) {
            if let Ok(mut existing_json) = serde_json::from_str::<serde_json::Value>(&existing) {
                // Get existing custom_models, filter out proxypal entries, then add new ones
                let mut merged_models: Vec<serde_json::Value> = Vec::new();

                // Keep existing models that are NOT from proxypal (don't have proxypal-local api_key)
                if let Some(existing_models) =
                    existing_json.get("custom_models").and_then(|v| v.as_array())
                {
                    for model in existing_models {
                        let is_proxypal = model
                            .get("api_key")
                            .and_then(|v| v.as_str())
                            .map(|s| s == "proxypal-local")
                            .unwrap_or(false);
                        if !is_proxypal {
                            merged_models.push(model.clone());
                        }
                    }
                }

                // Add all proxypal models
                merged_models.extend(proxypal_models);

                // Update the custom_models field
                existing_json["custom_models"] = serde_json::json!(merged_models);
                existing_json
            } else {
                // Existing file is not valid JSON, create new
                serde_json::json!({ "custom_models": proxypal_models })
            }
        } else {
            // Can't read file, create new
            serde_json::json!({ "custom_models": proxypal_models })
        }
    } else {
        // No existing config, create new
        serde_json::json!({ "custom_models": proxypal_models })
    };

    let config_str = serde_json::to_string_pretty(&final_config).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, &config_str).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "success": true,
        "configType": "file",
        "configPath": config_path.to_string_lossy(),
        "modelsConfigured": models.len(),
        "instructions": "Factory Droid has been configured. Run 'droid' or 'factory' to start using it."
    }))
}

fn configure_amp_cli_agent(
    home: &std::path::Path,
    port: u16,
) -> Result<serde_json::Value, String> {
    // Create ~/.config/amp directory
    let amp_dir = home.join(".config/amp");
    std::fs::create_dir_all(&amp_dir).map_err(|e| e.to_string())?;

    // Amp CLI requires localhost URL (not 127.0.0.1) per CLIProxyAPI docs
    // See: https://help.router-for.me/agent-client/amp-cli.html
    let amp_endpoint = format!("http://localhost:{}", port);

    // NOTE: Model mappings are configured in CLIProxyAPI's config.yaml (proxy-config.yaml),
    // NOT in Amp's settings.json. Amp CLI doesn't support amp.modelMapping setting.
    // The mappings in ProxyPal settings are written to CLIProxyAPI config when proxy starts.
    // See: https://help.router-for.me/agent-client/amp-cli.html#model-fallback-behavior

    // ProxyPal settings to add/update (only valid Amp CLI settings)
    let proxypal_settings = serde_json::json!({
        // Core proxy URL - routes all Amp traffic through CLIProxyAPI
        "amp.url": amp_endpoint,

        // API key for authentication with the proxy
        // This matches the api-keys in CLIProxyAPI config
        "amp.apiKey": "proxypal-local",

        // Enable extended thinking for Claude models
        "amp.anthropic.thinking.enabled": true,

        // Enable TODOs tracking
        "amp.todos.enabled": true,

        // Git commit settings - add Amp thread link and co-author
        "amp.git.commit.ampThread.enabled": true,
        "amp.git.commit.coauthor.enabled": true,

        // Tool timeout (5 minutes)
        "amp.tools.stopTimeout": 300,

        // Auto-update mode
        "amp.updates.mode": "auto"
    });

    let config_path = amp_dir.join("settings.json");

    // Merge with existing config to preserve user's other settings
    let final_config = if config_path.exists() {
        if let Ok(existing) = std::fs::read_to_string(&config_path) {
            if let Ok(mut existing_json) = serde_json::from_str::<serde_json::Value>(&existing) {
                // Merge proxypal settings into existing config
                if let Some(existing_obj) = existing_json.as_object_mut() {
                    if let Some(new_obj) = proxypal_settings.as_object() {
                        for (key, value) in new_obj {
                            existing_obj.insert(key.clone(), value.clone());
                        }
                    }
                    // Remove invalid amp.modelMapping key if it exists
                    // Model mappings should be in CLIProxyAPI config, not Amp settings
                    existing_obj.remove("amp.modelMapping");
                }
                existing_json
            } else {
                // Existing file is not valid JSON, create new
                proxypal_settings
            }
        } else {
            // Can't read file, create new
            proxypal_settings
        }
    } else {
        // No existing config, create new
        proxypal_settings
    };

    let settings_content = serde_json::to_string_pretty(&final_config).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, &settings_content).map_err(|e| e.to_string())?;

    // Also provide env var option and API key instructions
    let shell_config = format!(
        r#"# ProxyPal - Amp CLI Configuration (alternative to settings.json)
export AMP_URL="{}"
export AMP_API_KEY="proxypal-local"

# For Amp cloud features, get your API key from https://ampcode.com/settings
# and add it to ProxyPal Settings > Amp CLI Integration > Amp API Key
"#,
        amp_endpoint
    );

    Ok(serde_json::json!({
        "success": true,
        "configType": "both",
        "configPath": config_path.to_string_lossy(),
        "shellConfig": shell_config,
        "instructions": "Amp CLI has been configured. Run 'amp' to start using it. The API key 'proxypal-local' is pre-configured for local proxy access."
    }))
}

fn configure_opencode_agent(
    home: &std::path::Path,
    _endpoint: &str,
    endpoint_v1: &str,
    models: &[AvailableModel],
    thinking_budget: u64,
    reasoning_effort: &str,
) -> Result<serde_json::Value, String> {
    let config_dir = home.join(".config/opencode");
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let config_path = config_dir.join("opencode.json");

    // Build dynamic models object from available models
    // OpenCode needs model configs with name and limits
    let mut models_obj = serde_json::Map::new();

    for m in models {
        let (context_limit, output_limit) =
            crate::commands::models::get_model_limits(&m.id, &m.owned_by, &m.source);
        let display_name =
            crate::commands::models::get_model_display_name(&m.id, &m.owned_by, &m.source);
        // Enable reasoning display for models with "-thinking" suffix
        let is_thinking_model = m.id.ends_with("-thinking");
        // Check if this is a GPT-5.x model (Codex reasoning models)
        let is_gpt5_model = m.id.starts_with("gpt-5");
        // Check if this is a Gemini 3 model (native thinking support)
        let is_gemini3_model = (m.id.starts_with("gemini-3-") || m.id.starts_with("gemini-3.1-"))
            && !m.id.contains("image");
        // Check if this is a Qwen3 or DeepSeek model with thinking support
        let is_qwen3_thinking = m.id.contains("qwen3") && m.id.contains("thinking");
        let is_deepseek_thinking = m.id.contains("deepseek") && m.id.contains("thinking");
        // Use user's configured thinking budget
        let min_thinking_output: u64 = thinking_budget + 8192; // thinking + 8K buffer for response
        let effective_output_limit = if is_thinking_model
            || is_gemini3_model
            || is_qwen3_thinking
            || is_deepseek_thinking
        {
            std::cmp::max(output_limit, min_thinking_output)
        } else {
            output_limit
        };

        // Determine modalities based on model capabilities
        // Multimodal models support text + image + pdf input
        let is_multimodal = m.id.starts_with("gemini-claude-")
            || m.id.starts_with("gemini-2.5-")
            || (m.id.starts_with("gemini-3-") && !m.id.contains("image"))
            || (m.id.starts_with("gemini-3.1-") && !m.id.contains("image"))
            || m.id.starts_with("gpt-4o")
            || m.id.starts_with("gpt-4.1")
            || m.id.starts_with("gpt-5")
            || m.id.starts_with("o1")
            || m.id.starts_with("o3")
            || m.id.starts_with("o4")
            || m.id.starts_with("claude-")
            || m.id.starts_with("copilot-gpt-4");

        let mut model_config = serde_json::json!({
            "name": display_name,
            "limit": { "context": context_limit, "output": effective_output_limit }
        });

        // Add modalities for multimodal models
        if is_multimodal {
            model_config["modalities"] = serde_json::json!({
                "input": ["text", "image", "pdf"],
                "output": ["text"]
            });
        }

        // Map thinking budget mode to thinking level string for Gemini 3 variants
        let thinking_level_from_budget = match thinking_budget {
            0..=2048 => "low",
            2049..=16383 => "medium",
            _ => "high",
        };

        if is_thinking_model || is_qwen3_thinking || is_deepseek_thinking {
            // Enable extended thinking
            model_config["reasoning"] = serde_json::json!(true);
            // Check if this is a Claude/Qwen3/DeepSeek thinking model (uses thinking.budgetTokens)
            // vs OpenAI o-series (uses reasoningEffort)
            let is_budget_thinking = (m.id.contains("claude")
                || m.id.contains("qwen3")
                || m.id.contains("deepseek"))
                && m.id.contains("thinking");
            if is_budget_thinking {
                // Add variants for gemini-claude-*-thinking models
                let low_budget = 8192u64;
                let max_budget = 32768u64;
                model_config["variants"] = serde_json::json!({
                    "low": {
                        "thinkingConfig": {
                            "thinkingBudget": low_budget
                        }
                    },
                    "max": {
                        "thinkingConfig": {
                            "thinkingBudget": max_budget
                        }
                    }
                });
                model_config["options"] = serde_json::json!({
                    "thinking": {
                        "type": "enabled",
                        "budgetTokens": thinking_budget
                    }
                });
            } else {
                // OpenAI o-series models use reasoningEffort
                model_config["options"] = serde_json::json!({
                    "reasoningEffort": "high"
                });
            }
        } else if is_gemini3_model {
            // Gemini 3 models use generationConfig.thinkingConfig
            model_config["reasoning"] = serde_json::json!(true);

            // Add variants for Gemini 3 models based on user's thinking budget
            model_config["variants"] = serde_json::json!({
                "low": {
                    "thinkingLevel": "low"
                },
                "medium": {
                    "thinkingLevel": "medium"
                },
                "high": {
                    "thinkingLevel": "high"
                }
            });

            model_config["options"] = serde_json::json!({
                "generationConfig": {
                    "thinkingConfig": {
                        "thinkingLevel": thinking_level_from_budget,
                        "includeThoughts": true
                    }
                }
            });
        } else if is_gpt5_model && reasoning_effort != "none" {
            // Add reasoning effort for GPT-5.x models (Codex)
            model_config["reasoning"] = serde_json::json!(true);
            model_config["options"] = serde_json::json!({
                "reasoningEffort": reasoning_effort
            });
        }
        models_obj.insert(m.id.clone(), model_config);
    }

    // Create or update opencode.json with proxypal provider
    // Use @ai-sdk/anthropic for native Anthropic API (better for Claude models with thinking)
    let opencode_config = serde_json::json!({
        "$schema": "https://opencode.ai/config.json",
        "provider": {
            "proxypal": {
                "npm": "@ai-sdk/anthropic",
                "name": "ProxyPal",
                "options": {
                    "baseURL": endpoint_v1,
                    "apiKey": "proxypal-local",
                    "includeUsage": true
                },
                "models": models_obj
            }
        }
    });

    // If config exists, merge with existing
    let final_config = if config_path.exists() {
        if let Ok(existing) = std::fs::read_to_string(&config_path) {
            if let Ok(mut existing_json) = serde_json::from_str::<serde_json::Value>(&existing) {
                // Merge provider into existing config
                if let Some(providers) = existing_json.get_mut("provider") {
                    if let Some(obj) = providers.as_object_mut() {
                        obj.insert(
                            "proxypal".to_string(),
                            opencode_config["provider"]["proxypal"].clone(),
                        );
                    }
                } else {
                    existing_json["provider"] = opencode_config["provider"].clone();
                }
                existing_json
            } else {
                opencode_config
            }
        } else {
            opencode_config
        }
    } else {
        opencode_config
    };

    let config_str = serde_json::to_string_pretty(&final_config).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, &config_str).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "success": true,
        "configType": "config",
        "configPath": config_path.to_string_lossy(),
        "modelsConfigured": models.len(),
        "instructions": "ProxyPal provider added to OpenCode. Run 'opencode' and use /models to select a model (e.g., proxypal/gemini-2.5-pro). OpenCode uses AI SDK (ai-sdk.dev) and models.dev registry."
    }))
}

// Get shell profile path
#[tauri::command]
pub fn get_shell_profile_path() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;

    // Check for common shell config files
    let shell = std::env::var("SHELL").unwrap_or_default();

    let profile_path = if shell.contains("zsh") {
        home.join(".zshrc")
    } else if shell.contains("bash") {
        // Prefer .bashrc on Linux, .bash_profile on macOS
        #[cfg(target_os = "macos")]
        let path = home.join(".bash_profile");
        #[cfg(not(target_os = "macos"))]
        let path = home.join(".bashrc");
        path
    } else if shell.contains("fish") {
        home.join(".config/fish/config.fish")
    } else {
        // Default to .profile
        home.join(".profile")
    };

    Ok(profile_path.to_string_lossy().to_string())
}

// Append environment config to shell profile
#[tauri::command]
pub fn append_to_shell_profile(content: String) -> Result<String, String> {
    let profile_path = get_shell_profile_path()?;
    let path = std::path::Path::new(&profile_path);

    // Read existing content
    let existing = std::fs::read_to_string(path).unwrap_or_default();

    // Check if ProxyPal config already exists
    if existing.contains("# ProxyPal") {
        return Err(
            "ProxyPal configuration already exists in shell profile. Please remove it first or update manually."
                .to_string(),
        );
    }

    // Append new config
    let new_content = format!("{}\n\n{}", existing.trim_end(), content);
    std::fs::write(path, new_content).map_err(|e| e.to_string())?;

    Ok(profile_path)
}

// Detect installed AI coding tools
#[tauri::command]
pub fn detect_ai_tools() -> Vec<DetectedTool> {
    let home = dirs::home_dir().unwrap_or_default();
    let mut tools = Vec::new();

    // Check for Cursor
    #[cfg(target_os = "macos")]
    let cursor_app = std::path::Path::new("/Applications/Cursor.app").exists();
    #[cfg(target_os = "windows")]
    let cursor_app = dirs::data_local_dir()
        .map(|p| p.join("Programs/cursor/Cursor.exe").exists())
        .unwrap_or(false);
    #[cfg(target_os = "linux")]
    let cursor_app = home
        .join(".local/share/applications/cursor.desktop")
        .exists()
        || std::path::Path::new("/usr/share/applications/cursor.desktop").exists();

    tools.push(DetectedTool {
        id: "cursor".to_string(),
        name: "Cursor".to_string(),
        installed: cursor_app,
        config_path: None, // Cursor doesn't support custom API base URL
        can_auto_configure: false,
    });

    // Check for VS Code (needed for Continue/Cline)
    #[cfg(target_os = "macos")]
    let vscode_installed =
        std::path::Path::new("/Applications/Visual Studio Code.app").exists();
    #[cfg(target_os = "windows")]
    let vscode_installed = dirs::data_local_dir()
        .map(|p| p.join("Programs/Microsoft VS Code/Code.exe").exists())
        .unwrap_or(false);
    #[cfg(target_os = "linux")]
    let vscode_installed = std::path::Path::new("/usr/bin/code").exists();

    // Check for Continue extension (config file)
    let continue_config = home.join(".continue");
    let continue_yaml = continue_config.join("config.yaml");
    let continue_json = continue_config.join("config.json");
    let continue_installed =
        continue_yaml.exists() || continue_json.exists() || continue_config.exists();

    tools.push(DetectedTool {
        id: "continue".to_string(),
        name: "Continue".to_string(),
        installed: continue_installed || vscode_installed,
        config_path: if continue_yaml.exists() {
            Some(continue_yaml.to_string_lossy().to_string())
        } else if continue_json.exists() {
            Some(continue_json.to_string_lossy().to_string())
        } else {
            Some(continue_yaml.to_string_lossy().to_string()) // Default to yaml
        },
        can_auto_configure: true, // Continue has editable config
    });

    // Check for Cline extension
    #[cfg(target_os = "macos")]
    let cline_storage =
        home.join("Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev");
    #[cfg(target_os = "windows")]
    let cline_storage = dirs::data_dir()
        .map(|p| p.join("Code/User/globalStorage/saoudrizwan.claude-dev"))
        .unwrap_or_default();
    #[cfg(target_os = "linux")]
    let cline_storage =
        home.join(".config/Code/User/globalStorage/saoudrizwan.claude-dev");

    tools.push(DetectedTool {
        id: "cline".to_string(),
        name: "Cline".to_string(),
        installed: cline_storage.exists() || vscode_installed,
        config_path: None, // Cline uses VS Code settings UI
        can_auto_configure: false,
    });

    // Check for Windsurf
    #[cfg(target_os = "macos")]
    let windsurf_app = std::path::Path::new("/Applications/Windsurf.app").exists();
    #[cfg(target_os = "windows")]
    let windsurf_app = dirs::data_local_dir()
        .map(|p| p.join("Programs/Windsurf/Windsurf.exe").exists())
        .unwrap_or(false);
    #[cfg(target_os = "linux")]
    let windsurf_app = std::path::Path::new("/usr/bin/windsurf").exists();

    tools.push(DetectedTool {
        id: "windsurf".to_string(),
        name: "Windsurf".to_string(),
        installed: windsurf_app,
        config_path: None,
        can_auto_configure: false,
    });

    tools
}

// Configure Continue extension with ProxyPal endpoint
#[tauri::command]
pub fn configure_continue(state: State<AppState>) -> Result<String, String> {
    let config = state.config.lock().unwrap();
    let endpoint = format!("http://localhost:{}/v1", config.port);

    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let continue_dir = home.join(".continue");

    // Create directory if it doesn't exist
    std::fs::create_dir_all(&continue_dir).map_err(|e| e.to_string())?;

    let config_path = continue_dir.join("config.yaml");

    // Check if config already exists
    let existing_content = std::fs::read_to_string(&config_path).unwrap_or_default();

    // If config exists and already has ProxyPal, update it
    if existing_content.contains("ProxyPal") || existing_content.contains(&endpoint) {
        return Ok("Continue is already configured with ProxyPal".to_string());
    }

    // Create new config or append to existing
    let new_config = if existing_content.is_empty() {
        format!(
            r#"# Continue configuration - Auto-configured by ProxyPal
name: ProxyPal Config
version: 0.0.1
schema: v1

models:
  - name: ProxyPal (Auto-routed)
    provider: openai
    model: gpt-4
    apiKey: proxypal-local
    apiBase: {}
    roles:
      - chat
      - edit
      - apply
"#,
            endpoint
        )
    } else {
        // Append ProxyPal model to existing config
        format!(
            r#"{}
  # Added by ProxyPal
  - name: ProxyPal (Auto-routed)
    provider: openai
    model: gpt-4
    apiKey: proxypal-local
    apiBase: {}
    roles:
      - chat
      - edit
      - apply
"#,
            existing_content.trim_end(),
            endpoint
        )
    };

    std::fs::write(&config_path, new_config).map_err(|e| e.to_string())?;

    Ok(config_path.to_string_lossy().to_string())
}

// Windows CREATE_NO_WINDOW flag (used by which_exists on Windows)
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// Get setup instructions for a specific tool
#[tauri::command]
pub fn get_tool_setup_info(tool_id: String, state: State<AppState>) -> Result<serde_json::Value, String> {
    let config = state.config.lock().unwrap();
    let endpoint = format!("http://localhost:{}/v1", config.port);
    
    let info = match tool_id.as_str() {
        "cursor" => serde_json::json!({
            "name": "Cursor",
            "logo": "/logos/cursor.svg",
            "canAutoConfigure": false,
            "note": "Cursor doesn't support custom API base URLs. Use your connected providers' API keys directly in Cursor settings.",
            "steps": [
                {
                    "title": "Open Cursor Settings",
                    "description": "Press Cmd+, (Mac) or Ctrl+, (Windows) and go to 'Models'"
                },
                {
                    "title": "Add API Keys",
                    "description": "Enter your API keys for Claude, OpenAI, or other providers directly"
                }
            ]
        }),
        "continue" => serde_json::json!({
            "name": "Continue",
            "logo": "/logos/continue.svg",
            "canAutoConfigure": true,
            "steps": [
                {
                    "title": "Auto-Configure",
                    "description": "Click the button below to automatically configure Continue"
                },
                {
                    "title": "Or Manual Setup",
                    "description": "Open ~/.continue/config.yaml and add:"
                }
            ],
            "manualConfig": format!(r#"models:
  - name: ProxyPal
    provider: openai
    model: gpt-4
    apiKey: proxypal-local
    apiBase: {}"#, endpoint),
            "endpoint": endpoint
        }),
        "cline" => serde_json::json!({
            "name": "Cline",
            "logo": "/logos/cline.svg",
            "canAutoConfigure": false,
            "steps": [
                {
                    "title": "Open Cline Settings",
                    "description": "Click the Cline icon in VS Code sidebar, then click the gear icon"
                },
                {
                    "title": "Select API Provider",
                    "description": "Choose 'OpenAI Compatible' from the provider dropdown"
                },
                {
                    "title": "Set Base URL",
                    "description": "Enter the ProxyPal endpoint:",
                    "copyable": endpoint.clone()
                },
                {
                    "title": "Set API Key",
                    "description": "Enter: proxypal-local",
                    "copyable": "proxypal-local".to_string()
                },
                {
                    "title": "Select Model",
                    "description": "Enter any model name (e.g., gpt-4, claude-3-sonnet)"
                }
            ],
            "endpoint": endpoint
        }),
        "windsurf" => serde_json::json!({
            "name": "Windsurf",
            "logo": "/logos/windsurf.svg",
            "canAutoConfigure": false,
            "note": "Windsurf doesn't support custom API endpoints. It only supports direct API keys for Claude models.",
            "steps": [
                {
                    "title": "Not Supported",
                    "description": "Windsurf routes all requests through Codeium servers and doesn't allow custom endpoints."
                }
            ]
        }),
        _ => return Err(format!("Unknown tool: {}", tool_id)),
    };
    
    Ok(info)
}
