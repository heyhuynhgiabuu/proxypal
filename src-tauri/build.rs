use std::env;
use std::path::Path;
use std::process::Command;

fn main() {
    // Get the target triple for the current build
    let target = env::var("TARGET").unwrap_or_else(|_| {
        // Fallback to host target
        env::var("HOST").unwrap_or_else(|_| String::from("unknown"))
    });

    // Map target to binary name
    let binary_name = get_binary_name(&target);
    let binaries_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
    let binary_path = binaries_dir.join(&binary_name);

    // Download binary if it doesn't exist
    // Skip download in CI - binaries are downloaded in workflow steps
    let is_ci = env::var("CI").is_ok();
    
    if !binary_path.exists() {
        if is_ci {
            // In CI, binaries should be downloaded by workflow - just warn
            println!("cargo:warning=Binary not found: {} (expected CI to download it)", binary_name);
        } else {
            println!("cargo:warning=Binary not found: {}", binary_name);
            println!("cargo:warning=Downloading from CLIProxyAPI releases...");

            #[cfg(windows)]
            let status = {
                let script_path = Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("scripts")
                    .join("download-binaries.ps1");
                Command::new("powershell")
                    .arg("-ExecutionPolicy")
                    .arg("Bypass")
                    .arg("-File")
                    .arg(&script_path)
                    .arg(&binary_name)
                    .status()
                    .expect("Failed to execute download script")
            };

            #[cfg(not(windows))]
            let status = {
                let script_path = Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("scripts")
                    .join("download-binaries.sh");
                Command::new("bash")
                    .arg(&script_path)
                    .arg(&binary_name)
                    .status()
                    .expect("Failed to execute download script")
            };

            if !status.success() {
                #[cfg(windows)]
                panic!(
                    "Failed to download binary: {}. Run scripts/download-binaries.ps1 manually.",
                    binary_name
                );
                #[cfg(not(windows))]
                panic!(
                    "Failed to download binary: {}. Run scripts/download-binaries.sh manually.",
                    binary_name
                );
            }
        }
    }

    tauri_build::build()
}

fn get_binary_name(target: &str) -> String {
    let base_name = "cliproxyapi";
    
    // Map Rust target triples to our binary naming convention
    let suffix = match target {
        "aarch64-apple-darwin" => "aarch64-apple-darwin",
        "x86_64-apple-darwin" => "x86_64-apple-darwin",
        "aarch64-unknown-linux-gnu" => "aarch64-unknown-linux-gnu",
        "x86_64-unknown-linux-gnu" => "x86_64-unknown-linux-gnu",
        "aarch64-pc-windows-msvc" => "aarch64-pc-windows-msvc.exe",
        "x86_64-pc-windows-msvc" => "x86_64-pc-windows-msvc.exe",
        // Fallback for other targets
        _ => {
            if target.contains("darwin") {
                if target.contains("aarch64") {
                    "aarch64-apple-darwin"
                } else {
                    "x86_64-apple-darwin"
                }
            } else if target.contains("linux") {
                if target.contains("aarch64") {
                    "aarch64-unknown-linux-gnu"
                } else {
                    "x86_64-unknown-linux-gnu"
                }
            } else if target.contains("windows") {
                if target.contains("aarch64") {
                    "aarch64-pc-windows-msvc.exe"
                } else {
                    "x86_64-pc-windows-msvc.exe"
                }
            } else {
                // Default to current platform
                #[cfg(target_os = "macos")]
                {
                    #[cfg(target_arch = "aarch64")]
                    { "aarch64-apple-darwin" }
                    #[cfg(target_arch = "x86_64")]
                    { "x86_64-apple-darwin" }
                }
                #[cfg(target_os = "linux")]
                {
                    #[cfg(target_arch = "aarch64")]
                    { "aarch64-unknown-linux-gnu" }
                    #[cfg(target_arch = "x86_64")]
                    { "x86_64-unknown-linux-gnu" }
                }
                #[cfg(target_os = "windows")]
                {
                    #[cfg(target_arch = "aarch64")]
                    { "aarch64-pc-windows-msvc.exe" }
                    #[cfg(target_arch = "x86_64")]
                    { "x86_64-pc-windows-msvc.exe" }
                }
            }
        }
    };

    format!("{}-{}", base_name, suffix)
}
