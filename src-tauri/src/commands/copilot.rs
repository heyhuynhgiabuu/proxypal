use crate::state::AppState;
use crate::types::{CopilotApiDetection, CopilotApiInstallResult, CopilotStatus};
use tauri::{Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;

// ============================================
// Copilot API Management (via copilot-api)
// ============================================

#[tauri::command]
pub fn get_copilot_status(state: State<AppState>) -> CopilotStatus {
    state.copilot_status.lock().unwrap().clone()
}

#[tauri::command]
pub async fn start_copilot(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<CopilotStatus, String> {
    let config = state.config.lock().unwrap().clone();
    let port = config.copilot.port;
    
    // Check if copilot is enabled
    if !config.copilot.enabled {
        return Err("Copilot is not enabled in settings".to_string());
    }
    
    // First, check if copilot-api is already running on this port (maybe externally)
    let client = crate::build_management_client();
    let health_url = format!("http://127.0.0.1:{}/v1/models", port);
    if let Ok(response) = client
        .get(&health_url)
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
    {
        if response.status().is_success() {
            // Already running and healthy - just update status
            let new_status = {
                let mut status = state.copilot_status.lock().unwrap();
                status.running = true;
                status.port = port;
                status.endpoint = format!("http://localhost:{}", port);
                status.authenticated = true;
                status.clone()
            };
            let _ = app.emit("copilot-status-changed", new_status.clone());
            return Ok(new_status);
        }
    }
    
    // Kill any existing copilot process we're tracking
    {
        let mut process = state.copilot_process.lock().unwrap();
        if let Some(child) = process.take() {
            let _ = child.kill(); // Ignore errors, process might already be dead
        }
    }
    
    // Small delay to let port be released
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    
    // Check if copilot-api is installed globally (faster startup)
    let detection = detect_copilot_api(app.clone()).await?;
    
    if !detection.node_available {
        let checked = detection.checked_node_paths.join(", ");
        return Err(format!(
            "Node.js is required for GitHub Copilot support.\n\n\
            Checked paths: {}\n\n\
            Please install Node.js from https://nodejs.org/ or via a version manager (nvm, volta, fnm) and restart ProxyPal.",
            if checked.is_empty() { "none".to_string() } else { checked }
        ));
    }
    
    // Check Node.js version >= 20.16.0 (required for process.getBuiltinModule)
    if let Some(ref version_str) = detection.node_version {
        // Parse version like "v20.16.0" or "v18.19.0"
        let version_clean = version_str.trim_start_matches('v');
        let parts: Vec<&str> = version_clean.split('.').collect();
        if parts.len() >= 2 {
            let major: u32 = parts[0].parse().unwrap_or(0);
            let minor: u32 = parts[1].parse().unwrap_or(0);
            
            // Require Node.js >= 20.16.0
            if major < 20 || (major == 20 && minor < 16) {
                return Err(format!(
                    "Node.js version {} is too old for GitHub Copilot support.\n\n\
                    The copilot-api package requires Node.js 20.16.0 or later.\n\
                    Your current version: {}\n\n\
                    Please upgrade Node.js:\n\
                    • Download from https://nodejs.org/ (LTS recommended)\n\
                    • Or use a version manager: nvm install 22 / volta install node@22\n\n\
                    After upgrading, restart ProxyPal.",
                    version_str, version_str
                ));
            }
        }
    }
    
    // Determine command and arguments based on installation status
    let (bin_path, mut args) = if detection.installed {
        // Use copilot-api directly
        let copilot_bin = detection.copilot_bin.clone()
            .ok_or_else(|| format!(
                "copilot-api binary path not found.\n\n\
                Checked paths: {}",
                detection.checked_copilot_paths.join(", ")
            ))?;
        println!("[copilot] Using globally installed copilot-api: {}{}", 
            copilot_bin,
            detection.version.as_ref().map(|v| format!(" v{}", v)).unwrap_or_default());
        (copilot_bin, vec![])
    } else if let Some(bunx_bin) = detection.bunx_bin.clone() {
        // Prefer bunx since copilot-api is now a Bun package (requires Bun >= 1.2.x)
        println!("[copilot] Using bunx: {} copilot-api start", bunx_bin);
        (bunx_bin, vec!["copilot-api".to_string()])
    } else if let Some(npx_bin) = detection.npx_bin.clone() {
        // Fallback to npx (may work with older versions)
        println!("[copilot] Using npx: {} copilot-api@latest", npx_bin);
        (npx_bin, vec!["copilot-api@latest".to_string()])
    } else {
        return Err(
            "Could not start GitHub Copilot bridge.\n\n\
            The copilot-api package now requires Bun (recommended) or Node.js.\n\n\
            Option 1 - Install Bun (recommended):\n\
            • macOS/Linux: curl -fsSL https://bun.sh/install | bash\n\
            • Then restart ProxyPal\n\n\
            Option 2 - Run manually in terminal:\n\
            • bunx copilot-api start --port 4141\n\
            • Or: npx copilot-api@latest start --port 4141\n\n\
            For more info: https://github.com/ericc-ch/copilot-api".to_string()
        );
    };
    
    // Add common arguments
    args.push("start".to_string());
    args.push("--port".to_string());
    args.push(port.to_string());
    
    // Add account type if specified
    if !config.copilot.account_type.is_empty() {
        args.push("--account".to_string());
        args.push(config.copilot.account_type.clone());
    }
    
    // Add GitHub token if specified (for direct authentication)
    if !config.copilot.github_token.is_empty() {
        args.push("--github-token".to_string());
        args.push(config.copilot.github_token.clone());
    }
    
    // Add rate limit if specified
    if let Some(rate_limit) = config.copilot.rate_limit {
        args.push("--rate-limit".to_string());
        args.push(rate_limit.to_string());
    }
    
    // Add rate limit wait flag (copilot-api uses --wait)
    if config.copilot.rate_limit_wait {
        args.push("--wait".to_string());
    }
    
    println!("[copilot] Executing: {} {}", bin_path, args.join(" "));
    
    let command = app.shell().command(&bin_path).args(&args);
    
    let (mut rx, child) = command.spawn().map_err(|e| format!("Failed to spawn copilot-api: {}. Make sure Node.js is installed.", e))?;
    
    // Store the child process
    {
        let mut process = state.copilot_process.lock().unwrap();
        *process = Some(child);
    }
    
    // Update status to running (but not yet authenticated)
    {
        let mut status = state.copilot_status.lock().unwrap();
        status.running = true;
        status.port = port;
        status.endpoint = format!("http://localhost:{}", port);
        status.authenticated = false;
    }
    
    // Listen for stdout/stderr in background task
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        
        println!("[copilot] Starting stdout/stderr listener...");
        
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    println!("[copilot-api] {}", text);
                    
                    // Check for successful login message
                    // copilot-api outputs "Listening on: http://localhost:PORT/" when ready
                    let text_lower = text.to_lowercase();
                    if text_lower.contains("listening on") || text.contains("Logged in as") || text.contains("Server running") {
                        // Update authenticated status
                        if let Some(state) = app_handle.try_state::<AppState>() {
                            let mut status = state.copilot_status.lock().unwrap();
                            status.authenticated = true;
                            let _ = app_handle.emit("copilot-status-changed", status.clone());
                            println!("[copilot] ✓ Authenticated via stdout detection");
                        }
                    }
                    
                    // Check for auth URL in output
                    if text.contains("https://github.com/login/device") || text.contains("device code") {
                        // Emit auth required event
                        let _ = app_handle.emit("copilot-auth-required", text.to_string());
                        println!("[copilot] Auth required - device code flow initiated");
                    }
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    eprintln!("[copilot-api ERROR] {}", text);
                    
                    // Some processes log to stderr even for non-errors
                    // Check if it's actually a login/running message
                    let text_lower = text.to_lowercase();
                    if text_lower.contains("listening on") || text.contains("Logged in as") || text.contains("Server running") {
                        if let Some(state) = app_handle.try_state::<AppState>() {
                            let mut status = state.copilot_status.lock().unwrap();
                            status.authenticated = true;
                            let _ = app_handle.emit("copilot-status-changed", status.clone());
                            println!("[copilot] ✓ Authenticated via stderr detection");
                        }
                    }
                }
                CommandEvent::Terminated(payload) => {
                    println!("[copilot-api] Process terminated: {:?}", payload);
                    // Update status when process dies
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        let mut status = state.copilot_status.lock().unwrap();
                        status.running = false;
                        status.authenticated = false;
                        let _ = app_handle.emit("copilot-status-changed", status.clone());
                    }
                    break;
                }
                _ => {}
            }
        }
    });
    
    // Wait for copilot-api to be ready (up to 8 seconds)
    // bunx/npx may need to download packages on first run, which takes ~5s
    let client = crate::build_management_client();
    let health_url = format!("http://127.0.0.1:{}/v1/models", port);
    
    for i in 0..16 {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        
        // Check if stdout listener already detected authentication
        {
            let status = state.copilot_status.lock().unwrap();
            if status.authenticated {
                println!("[copilot] ✓ Ready via stdout detection at {:.1}s", (i + 1) as f32 * 0.5);
                let status_clone = status.clone();
                let _ = app.emit("copilot-status-changed", status_clone.clone());
                return Ok(status_clone);
            }
            if !status.running {
                return Err("Copilot process stopped unexpectedly".to_string());
            }
        }
        
        // Also check health endpoint
        if let Ok(response) = client
            .get(&health_url)
            .timeout(std::time::Duration::from_secs(1))
            .send()
            .await
        {
            if response.status().is_success() {
                println!("[copilot] ✓ Ready via health check at {:.1}s", (i + 1) as f32 * 0.5);
                let new_status = {
                    let mut status = state.copilot_status.lock().unwrap();
                    status.authenticated = true;
                    status.clone()
                };
                let _ = app.emit("copilot-status-changed", new_status.clone());
                return Ok(new_status);
            }
        }
    }
    
    // Return with "running but not authenticated" status after timeout
    // The background task will continue polling and emit status updates
    let initial_status = state.copilot_status.lock().unwrap().clone();
    println!("[copilot] Returning after 8s wait: running={}, authenticated={}", initial_status.running, initial_status.authenticated);
    let _ = app.emit("copilot-status-changed", initial_status.clone());
    
    // Spawn background task to poll for authentication
    // This runs independently and emits status updates as authentication completes
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let client = crate::build_management_client();
        let health_url = format!("http://127.0.0.1:{}/v1/models", port);
        
        // Poll for up to 60 seconds to catch slower authentication (especially on first run)
        for i in 0..120 {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            
            // Check if stdout listener already detected authentication
            if let Some(state) = app_handle.try_state::<AppState>() {
                let status = state.copilot_status.lock().unwrap();
                if status.authenticated {
                    println!("✓ Copilot authenticated via stdout detection at {:.1}s", i as f32 * 0.5);
                    return;
                }
                // If process stopped, exit polling
                if !status.running {
                    println!("⚠ Copilot process stopped, ending auth poll");
                    return;
                }
            }
            
            // Also check health endpoint
            if let Ok(response) = client
                .get(&health_url)
                .timeout(std::time::Duration::from_secs(2))
                .send()
                .await
            {
                if response.status().is_success() {
                    println!("✓ Copilot authenticated via health check at {:.1}s", i as f32 * 0.5);
                    // Update status
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        let new_status = {
                            let mut status = state.copilot_status.lock().unwrap();
                            status.authenticated = true;
                            status.clone()
                        };
                        let _ = app_handle.emit("copilot-status-changed", new_status);
                    }
                    return;
                }
            }
            
            // Log progress every 10 seconds
            if i > 0 && i % 20 == 0 {
                println!("⏳ Waiting for Copilot authentication... ({:.0}s elapsed)", i as f32 * 0.5);
            }
        }
        
        println!("⚠ Copilot authentication poll timed out after 60s - user may need to complete GitHub auth manually");
    });
    
    Ok(initial_status)
}

#[tauri::command]
pub async fn stop_copilot(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<CopilotStatus, String> {
    // Check if running
    {
        let status = state.copilot_status.lock().unwrap();
        if !status.running {
            return Ok(status.clone());
        }
    }
    
    // Kill the child process
    {
        let mut process = state.copilot_process.lock().unwrap();
        if let Some(child) = process.take() {
            child.kill().map_err(|e| format!("Failed to kill copilot-api: {}", e))?;
        }
    }
    
    // Update status
    let new_status = {
        let mut status = state.copilot_status.lock().unwrap();
        status.running = false;
        status.authenticated = false;
        status.clone()
    };
    
    // Emit status update
    let _ = app.emit("copilot-status-changed", new_status.clone());
    
    Ok(new_status)
}

#[tauri::command]
pub async fn check_copilot_health(state: State<'_, AppState>) -> Result<CopilotStatus, String> {
    let config = state.config.lock().unwrap().clone();
    let port = config.copilot.port;
    
    let client = crate::build_management_client();
    let health_url = format!("http://127.0.0.1:{}/v1/models", port);
    
    let (running, authenticated) = match client
        .get(&health_url)
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
    {
        Ok(response) => (true, response.status().is_success()),
        Err(_) => (false, false),
    };
    
    // Update status
    let new_status = {
        let mut status = state.copilot_status.lock().unwrap();
        status.running = running;
        status.authenticated = authenticated;
        if running {
            status.port = port;
            status.endpoint = format!("http://localhost:{}", port);
        }
        status.clone()
    };
    
    Ok(new_status)
}

#[tauri::command]
pub async fn detect_copilot_api(app: tauri::AppHandle) -> Result<CopilotApiDetection, String> {
    // Common Node.js installation paths on macOS/Linux
    // GUI apps don't inherit shell PATH, so we need to check common locations
    // Including version managers: Volta, nvm, fnm, asdf
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("~"));
    let home_str = home.to_string_lossy();
    
    // Helper: find nvm node binary by checking versions directory
    let find_nvm_node = |home: &std::path::Path| -> Option<String> {
        let nvm_versions = home.join(".nvm/versions/node");
        if nvm_versions.exists() {
            // Try to read the default alias first
            let default_alias = home.join(".nvm/alias/default");
            if let Ok(alias) = std::fs::read_to_string(&default_alias) {
                let alias = alias.trim();
                // Find matching version directory
                if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                    for entry in entries.flatten() {
                        let name = entry.file_name();
                        let name_str = name.to_string_lossy();
                        if name_str.starts_with(&format!("v{}", alias)) || name_str == alias {
                            let node_path = entry.path().join("bin/node");
                            if node_path.exists() {
                                return Some(node_path.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
            // Fallback: use the most recent version (sorted alphabetically, last is usually newest)
            if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                let mut versions: Vec<_> = entries
                    .flatten()
                    .filter(|e| e.path().join("bin/node").exists())
                    .collect();
                versions.sort_by(|a, b| b.file_name().cmp(&a.file_name())); // Descending
                if let Some(entry) = versions.first() {
                    let node_path = entry.path().join("bin/node");
                    return Some(node_path.to_string_lossy().to_string());
                }
            }
        }
        None
    };
    
    let mut node_paths: Vec<String> = if cfg!(target_os = "macos") {
        vec![
            // Version managers (most common for developers)
            format!("{}/.volta/bin/node", home_str),      // Volta
            format!("{}/.fnm/current/bin/node", home_str), // fnm
            format!("{}/.asdf/shims/node", home_str),      // asdf
            // System package managers
            "/opt/homebrew/bin/node".to_string(),      // Apple Silicon Homebrew
            "/usr/local/bin/node".to_string(),          // Intel Homebrew / manual install
            "/usr/bin/node".to_string(),                // System install
            "/opt/local/bin/node".to_string(),          // MacPorts
        ]
    } else if cfg!(target_os = "windows") {
        vec![
            // Standard Windows Node.js installation paths
            "C:\\Program Files\\nodejs\\node.exe".to_string(),
            "C:\\Program Files (x86)\\nodejs\\node.exe".to_string(),
            // Version managers on Windows
            format!("{}/.volta/bin/node.exe", home_str),  // Volta
            format!("{}/AppData/Roaming/nvm/current/node.exe", home_str), // nvm-windows
            format!("{}/AppData/Local/fnm_multishells/node.exe", home_str), // fnm
            format!("{}/scoop/apps/nodejs/current/node.exe", home_str), // Scoop
            format!("{}/scoop/apps/nodejs-lts/current/node.exe", home_str), // Scoop LTS
            // Chocolatey installation path
            "C:\\ProgramData\\chocolatey\\bin\\node.exe".to_string(),
            // Windows Store / winget paths
            format!("{}/AppData/Local/Microsoft/WindowsApps/node.exe", home_str),
            // npm global bin (for detecting npm-installed tools)
            format!("{}/AppData/Roaming/npm/node.exe", home_str),
            // PowerShell profile paths (pnpm, yarn global)
            format!("{}/AppData/Local/pnpm/node.exe", home_str),
            // Fallback to PATH (works with any terminal: CMD, PowerShell, Windows Terminal)
            "node.exe".to_string(),
            "node".to_string(),
        ]
    } else {
        vec![
            // Version managers
            format!("{}/.volta/bin/node", home_str),
            format!("{}/.fnm/current/bin/node", home_str),
            format!("{}/.asdf/shims/node", home_str),
            // System paths
            "/usr/bin/node".to_string(),
            "/usr/local/bin/node".to_string(),
            "/home/linuxbrew/.linuxbrew/bin/node".to_string(),
        ]
    };
    
    // Add nvm path if found (nvm doesn't use a simple symlink structure)
    if cfg!(not(target_os = "windows")) {
        if let Some(nvm_node) = find_nvm_node(&home) {
            node_paths.insert(0, nvm_node); // Prioritize nvm
        }
    };
    
    // Find working node binary and get version
    let mut node_bin: Option<String> = None;
    let mut node_version: Option<String> = None;
    for path in &node_paths {
        let check = app.shell().command(path).args(["--version"]).output().await;
        if let Ok(ref output) = check {
            if output.status.success() {
                node_bin = Some(path.to_string());
                node_version = Some(String::from_utf8_lossy(&output.stdout).trim().to_string());
                break;
            }
        }
    }
    
    // Also try just "node" in case PATH is available
    if node_bin.is_none() {
        let check = app.shell().command("node").args(["--version"]).output().await;
        if let Ok(ref output) = check {
            if output.status.success() {
                node_bin = Some("node".to_string());
                node_version = Some(String::from_utf8_lossy(&output.stdout).trim().to_string());
            }
        }
    }
    
    if node_bin.is_none() {
        // Even without Node, check if bunx is available (bun can run copilot-api)
        let bunx_paths: Vec<String> = if cfg!(target_os = "macos") {
            vec![
                format!("{}/.bun/bin/bunx", home_str),
                "/opt/homebrew/bin/bunx".to_string(),
                "/usr/local/bin/bunx".to_string(),
            ]
        } else if cfg!(target_os = "windows") {
            vec![
                format!("{}/.bun/bin/bunx.exe", home_str),
                format!("{}/AppData/Local/bun/bunx.exe", home_str),
            ]
        } else {
            vec![
                format!("{}/.bun/bin/bunx", home_str),
                "/usr/local/bin/bunx".to_string(),
            ]
        };
        
        let mut bunx_bin: Option<String> = None;
        for path in &bunx_paths {
            let check = app.shell().command(path).args(["--version"]).output().await;
            if check.as_ref().map(|o| o.status.success()).unwrap_or(false) {
                bunx_bin = Some(path.clone());
                println!("[copilot] Found bunx at: {} (no Node.js needed)", path);
                break;
            }
        }
        
        if bunx_bin.is_some() {
            // Bun available, can still run copilot-api via bunx
            return Ok(CopilotApiDetection {
                installed: false,
                version: None,
                copilot_bin: None,
                npx_bin: None,
                npm_bin: None,
                node_bin: None,
                node_version: None,
                bunx_bin,
                node_available: true, // Mark as available since bunx works
                checked_node_paths: node_paths,
                checked_copilot_paths: vec![],
            });
        }
        
        return Ok(CopilotApiDetection {
            installed: false,
            version: None,
            copilot_bin: None,
            npx_bin: None,
            npm_bin: None,
            node_bin: None,
            node_version: None,
            bunx_bin: None,
            node_available: false,
            checked_node_paths: node_paths,
            checked_copilot_paths: vec![],
        });
    }
    
    // Derive npm/npx paths from node path (handle Windows and Unix paths)
    let npx_bin = node_bin.as_ref().map(|n| {
        if cfg!(target_os = "windows") {
            if n == "node" || n == "node.exe" {
                "npx.cmd".to_string()
            } else {
                n.replace("\\node.exe", "\\npx.cmd")
                    .replace("/node.exe", "/npx.cmd")
                    .replace("\\node", "\\npx")
                    .replace("/node", "/npx")
            }
        } else {
            let n_trimmed = n.trim();
            if n_trimmed == "node" {
                "npx".to_string()
            } else if n_trimmed.ends_with("/node") {
                let node_len = "/node".len();
                format!("{}/npx", &n_trimmed[..n_trimmed.len() - node_len])
            } else {
                // Fallback: npx should be alongside node
                "npx".to_string()
            }
        }
    }).unwrap_or_else(|| if cfg!(target_os = "windows") { "npx.cmd".to_string() } else { "npx".to_string() });
    
    let npm_bin = node_bin.as_ref().map(|n| {
        if cfg!(target_os = "windows") {
            n.replace("\\node.exe", "\\npm.cmd")
                .replace("/node.exe", "/npm.cmd")
                .replace("\\node", "\\npm")
                .replace("/node", "/npm")
        } else {
            n.replace("/node", "/npm")
        }
    }).unwrap_or_else(|| if cfg!(target_os = "windows") { "npm.cmd".to_string() } else { "npm".to_string() });
    
    // Check for bun/bunx (preferred over npx - faster startup)
    let bunx_paths: Vec<String> = if cfg!(target_os = "macos") {
        vec![
            format!("{}/.bun/bin/bunx", home_str),
            "/opt/homebrew/bin/bunx".to_string(),
            "/usr/local/bin/bunx".to_string(),
        ]
    } else if cfg!(target_os = "windows") {
        vec![
            format!("{}/.bun/bin/bunx.exe", home_str),
            format!("{}/AppData/Local/bun/bunx.exe", home_str),
        ]
    } else {
        vec![
            format!("{}/.bun/bin/bunx", home_str),
            "/usr/local/bin/bunx".to_string(),
        ]
    };
    
    let mut bunx_bin: Option<String> = None;
    for path in &bunx_paths {
        let check = app.shell().command(path).args(["--version"]).output().await;
        if check.as_ref().map(|o| o.status.success()).unwrap_or(false) {
            bunx_bin = Some(path.clone());
            println!("[copilot] Found bunx at: {}", path);
            break;
        }
    }
    
    // Try to find copilot-api binary directly first
    let copilot_paths: Vec<String> = if cfg!(target_os = "macos") {
        vec![
            // Version managers (most common for developers)
            format!("{}/.volta/bin/copilot-api", home_str),
            format!("{}/.nvm/current/bin/copilot-api", home_str),
            format!("{}/.fnm/current/bin/copilot-api", home_str),
            format!("{}/.asdf/shims/copilot-api", home_str),
            // Package managers
            "/opt/homebrew/bin/copilot-api".to_string(),
            "/usr/local/bin/copilot-api".to_string(),
            "/usr/bin/copilot-api".to_string(),
            // pnpm/yarn global bins
            format!("{}/Library/pnpm/copilot-api", home_str),
            format!("{}/.local/share/pnpm/copilot-api", home_str),
            format!("{}/.yarn/bin/copilot-api", home_str),
            format!("{}/.config/yarn/global/node_modules/.bin/copilot-api", home_str),
        ]
    } else if cfg!(target_os = "windows") {
        vec![
            // npm global bin (most common location after npm install -g)
            format!("{}/AppData/Roaming/npm/copilot-api.cmd", home_str),
            // Version managers on Windows
            format!("{}/.volta/bin/copilot-api.exe", home_str),  // Volta
            format!("{}/AppData/Roaming/nvm/current/copilot-api.cmd", home_str), // nvm-windows
            format!("{}/scoop/apps/nodejs/current/bin/copilot-api.cmd", home_str), // Scoop
            // Fallback to PATH
            "copilot-api.cmd".to_string(),
            "copilot-api".to_string(),
        ]
    } else {
        vec![
            format!("{}/.volta/bin/copilot-api", home_str),
            format!("{}/.nvm/current/bin/copilot-api", home_str),
            format!("{}/.fnm/current/bin/copilot-api", home_str),
            format!("{}/.asdf/shims/copilot-api", home_str),
            "/usr/local/bin/copilot-api".to_string(),
            "/usr/bin/copilot-api".to_string(),
        ]
    };
    
    for path in &copilot_paths {
        let check = app.shell().command(path).args(["--version"]).output().await;
        if check.as_ref().map(|o| o.status.success()).unwrap_or(false) {
            return Ok(CopilotApiDetection {
                installed: true,
                version: None,
                copilot_bin: Some(path.to_string()),
                npx_bin: Some(npx_bin),
                npm_bin: Some(npm_bin),
                node_bin: node_bin.clone(),
                node_version: node_version.clone(),
                bunx_bin,
                node_available: true,
                checked_node_paths: node_paths,
                checked_copilot_paths: copilot_paths,
            });
        }
    }
    
    // Check if copilot-api is installed globally via npm
    let npm_list = app
        .shell()
        .command(&npm_bin)
        .args(["list", "-g", "copilot-api", "--depth=0", "--json"])
        .output()
        .await;
    
    if let Ok(output) = npm_list {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) {
                if let Some(deps) = json.get("dependencies") {
                    if let Some(copilot) = deps.get("copilot-api") {
                        let version = copilot.get("version")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        
                        // npm says it's installed, derive copilot-api path from npm prefix
                        let copilot_bin = node_bin.as_ref()
                            .map(|n| {
                                if cfg!(target_os = "windows") {
                                    // Windows: node.exe -> copilot-api.cmd
                                    n.replace("\\node.exe", "\\copilot-api.cmd")
                                        .replace("/node.exe", "/copilot-api.cmd")
                                        .replace("\\node", "\\copilot-api.cmd")
                                        .replace("/node", "/copilot-api.cmd")
                                } else {
                                    n.replace("/node", "/copilot-api")
                                }
                            })
                            .unwrap_or_else(|| {
                                if cfg!(target_os = "windows") {
                                    "copilot-api.cmd".to_string()
                                } else {
                                    "copilot-api".to_string()
                                }
                            });
                        
                        return Ok(CopilotApiDetection {
                            installed: true,
                            version,
                            copilot_bin: Some(copilot_bin),
                            npx_bin: Some(npx_bin),
                            npm_bin: Some(npm_bin),
                            node_bin: node_bin.clone(),
                            node_version: node_version.clone(),
                            bunx_bin,
                            node_available: true,
                            checked_node_paths: node_paths,
                            checked_copilot_paths: copilot_paths,
                        });
                    }
                }
            }
        }
    }
    
    // Not installed globally
    Ok(CopilotApiDetection {
        installed: false,
        version: None,
        copilot_bin: None,
        npx_bin: Some(npx_bin),
        npm_bin: Some(npm_bin),
        node_bin: node_bin.clone(),
        node_version,
        bunx_bin,
        node_available: true,
        checked_node_paths: node_paths,
        checked_copilot_paths: copilot_paths,
    })
}

#[tauri::command]
pub async fn install_copilot_api(app: tauri::AppHandle) -> Result<CopilotApiInstallResult, String> {
    // Find npm binary - GUI apps don't inherit shell PATH on macOS
    // Including version managers: Volta, nvm, fnm, asdf
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("~"));
    let home_str = home.to_string_lossy();
    
    let npm_paths: Vec<String> = if cfg!(target_os = "macos") {
        vec![
            // Version managers (most common for developers)
            format!("{}/.volta/bin/npm", home_str),
            format!("{}/.nvm/current/bin/npm", home_str),
            format!("{}/.fnm/current/bin/npm", home_str),
            format!("{}/.asdf/shims/npm", home_str),
            // System package managers
            "/opt/homebrew/bin/npm".to_string(),
            "/usr/local/bin/npm".to_string(),
            "/usr/bin/npm".to_string(),
            "/opt/local/bin/npm".to_string(),
        ]
    } else if cfg!(target_os = "windows") {
        vec![
            // Standard Windows Node.js installation paths
            "C:\\Program Files\\nodejs\\npm.cmd".to_string(),
            "C:\\Program Files (x86)\\nodejs\\npm.cmd".to_string(),
            // Version managers on Windows
            format!("{}/.volta/bin/npm.exe", home_str),  // Volta
            format!("{}/AppData/Roaming/nvm/current/npm.cmd", home_str), // nvm-windows
            format!("{}/AppData/Local/fnm_multishells/npm.cmd", home_str), // fnm
            format!("{}/scoop/apps/nodejs/current/npm.cmd", home_str), // Scoop
            format!("{}/scoop/apps/nodejs-lts/current/npm.cmd", home_str), // Scoop LTS
            format!("{}/AppData/Roaming/npm/npm.cmd", home_str),
            // Fallback to PATH
            "npm.cmd".to_string(),
            "npm".to_string(),
        ]
    } else {
        vec![
            format!("{}/.volta/bin/npm", home_str),
            format!("{}/.nvm/current/bin/npm", home_str),
            format!("{}/.fnm/current/bin/npm", home_str),
            format!("{}/.asdf/shims/npm", home_str),
            "/usr/bin/npm".to_string(),
            "/usr/local/bin/npm".to_string(),
            "/home/linuxbrew/.linuxbrew/bin/npm".to_string(),
        ]
    };
    
    let mut npm_bin: Option<String> = None;
    for path in &npm_paths {
        let check = app.shell().command(path).args(["--version"]).output().await;
        if check.as_ref().map(|o| o.status.success()).unwrap_or(false) {
            npm_bin = Some(path.to_string());
            break;
        }
    }
    
    // Also try just "npm" in case PATH is available
    if npm_bin.is_none() {
        let check = app.shell().command("npm").args(["--version"]).output().await;
        if check.as_ref().map(|o| o.status.success()).unwrap_or(false) {
            npm_bin = Some("npm".to_string());
        }
    }
    
    let npm_bin = match npm_bin {
        Some(bin) => bin,
        None => {
            return Ok(CopilotApiInstallResult {
                success: false,
                message: "Node.js/npm is required. Please install Node.js from https://nodejs.org/".to_string(),
                version: None,
            });
        }
    };
    
    // Install copilot-api globally
    let install_output = app
        .shell()
        .command(&npm_bin)
        .args(["install", "-g", "copilot-api"])
        .output()
        .await
        .map_err(|e| format!("Failed to run npm install: {}", e))?;
    
    if !install_output.status.success() {
        let stderr = String::from_utf8_lossy(&install_output.stderr);
        return Ok(CopilotApiInstallResult {
            success: false,
            message: format!("Installation failed: {}", stderr),
            version: None,
        });
    }
    
    // Get the installed version
    let detection = detect_copilot_api(app).await?;
    
    if detection.installed {
        Ok(CopilotApiInstallResult {
            success: true,
            message: format!("Successfully installed copilot-api{}", 
                detection.version.as_ref().map(|v| format!(" v{}", v)).unwrap_or_default()),
            version: detection.version,
        })
    } else {
        Ok(CopilotApiInstallResult {
            success: false,
            message: "Installation completed but copilot-api was not found. You may need to restart your terminal.".to_string(),
            version: None,
        })
    }
}
