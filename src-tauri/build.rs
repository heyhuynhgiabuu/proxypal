use std::env;
use std::fs;
use std::path::Path;
use std::process::Command;

fn main() {
    // Load .env file for build-time environment variables (OAuth credentials, etc.)
    // The .env file is gitignored; see .env.example for required variables.
    let dotenv_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".env");
    if dotenv_path.exists() {
        if let Ok(content) = fs::read_to_string(&dotenv_path) {
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((key, value)) = line.split_once('=') {
                    let key = key.trim();
                    let value = value.trim().trim_matches('"').trim_matches('\'');
                    // Only emit if not already set (CI/env overrides .env file)
                    if env::var(key).is_err() {
                        // cargo:rustc-env makes the var available to env!() in source code
                        println!("cargo:rustc-env={}={}", key, value);
                    }
                }
            }
        }
    }
    // Also forward env vars already set (e.g., from CI) so env!() can see them
    for key in &["ANTIGRAVITY_CLIENT_ID", "ANTIGRAVITY_CLIENT_SECRET"] {
        if let Ok(val) = env::var(key) {
            println!("cargo:rustc-env={}={}", key, val);
        }
    }
    println!("cargo:rerun-if-changed=../.env");

    // Get the target triple for the current build
    let target = env::var("TARGET")
        .unwrap_or_else(|_| env::var("HOST").unwrap_or_else(|_| String::from("unknown")));

    let binary_name = get_binary_name(&target);
    let binaries_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
    let binary_path = binaries_dir.join(&binary_name);

    let is_ci = env::var("CI").is_ok();
    // CARGO_PRIMARY_PACKAGE is set during check/build of the workspace root package.
    // For `cargo check`, Tauri doesn't bundle sidecars, so we can skip validation.
    // The release workflow downloads the binary before `cargo build`.
    let is_check_only = env::var("PROXYPAL_SKIP_SIDECAR").is_ok();

    let needs_download = if !binary_path.exists() {
        println!("cargo:warning=Sidecar binary not found: {}", binary_name);
        true
    } else if !is_valid_binary(&binary_path) {
        println!(
            "cargo:warning=Sidecar binary is corrupted (gzip/invalid format): {}",
            binary_name
        );
        // Remove the invalid file so the download replaces it
        let _ = fs::remove_file(&binary_path);
        true
    } else {
        false
    };

    if needs_download {
        if is_check_only {
            // Create a dummy binary so tauri_build::build() doesn't fail
            let _ = fs::create_dir_all(&binaries_dir);
            fs::write(&binary_path, b"PLACEHOLDER").unwrap_or_else(|e| {
                println!("cargo:warning=Failed to create placeholder binary: {}", e);
            });
            println!(
                "cargo:warning=Sidecar binary not available, using placeholder for check-only build"
            );
        } else if is_ci {
            panic!(
                "Sidecar binary missing or corrupted in CI: {}.\n\
                The CI workflow must download and extract the binary before cargo build.\n\
                Check the 'Download CLI Proxy API' step in your workflow.",
                binary_name
            );
        } else {
            println!("cargo:warning=Downloading sidecar from CLIProxyAPI releases...");
            download_binary(&binary_name);
        }
    }

    tauri_build::build()
}

/// Validate that the file is a real executable, not a gzip archive or other invalid format.
/// Checks the file's magic bytes:
///   - gzip: starts with 0x1f 0x8b
///   - Mach-O 64-bit: starts with 0xcf 0xfa 0xed 0xfe
///   - ELF: starts with 0x7f 'E' 'L' 'F'
///   - PE (Windows): starts with 'M' 'Z'
fn is_valid_binary(path: &Path) -> bool {
    let Ok(bytes) = fs::read(path) else {
        return false;
    };
    if bytes.len() < 4 {
        return false;
    }

    // Reject gzip archives (0x1f 0x8b)
    if bytes[0] == 0x1f && bytes[1] == 0x8b {
        return false;
    }

    // Accept known executable formats
    let is_macho = bytes[0] == 0xcf && bytes[1] == 0xfa && bytes[2] == 0xed && bytes[3] == 0xfe;
    let is_elf = bytes[0] == 0x7f && bytes[1] == b'E' && bytes[2] == b'L' && bytes[3] == b'F';
    let is_pe = bytes[0] == b'M' && bytes[1] == b'Z';

    is_macho || is_elf || is_pe
}

/// Download the sidecar binary using the cross-platform Node.js script.
/// This is the only supported download path because it resolves the pinned
/// version and verifies the release checksum before installing the binary.
fn download_binary(binary_name: &str) {
    let project_root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let node_script = project_root.join("scripts").join("update-sidecar.mjs");

    if !node_script.exists() {
        panic!(
            "Pinned sidecar updater is missing: {}.\n\
            Restore scripts/update-sidecar.mjs and run: pnpm update-sidecar --force",
            node_script.display()
        );
    }

    let status = Command::new("node")
        .arg(&node_script)
        .arg("--force")
        .arg(binary_name)
        .status()
        .unwrap_or_else(|e| {
            panic!(
                "Failed to run the pinned sidecar updater: {}.\n\
                Install Node.js and run: pnpm update-sidecar --force",
                e
            )
        });

    if !status.success() {
        panic!(
            "Pinned sidecar updater failed for {} with code {:?}.\n\
            Run manually: pnpm update-sidecar --force {}",
            binary_name,
            status.code(),
            binary_name
        );
    }

    println!("cargo:warning=Sidecar binary downloaded successfully");
}

fn get_binary_name(target: &str) -> String {
    let base_name = "cli-proxy-api";

    let suffix = match target {
        "aarch64-apple-darwin" => "aarch64-apple-darwin",
        "x86_64-apple-darwin" => "x86_64-apple-darwin",
        "aarch64-unknown-linux-gnu" => "aarch64-unknown-linux-gnu",
        "x86_64-unknown-linux-gnu" => "x86_64-unknown-linux-gnu",
        "aarch64-pc-windows-msvc" => "aarch64-pc-windows-msvc.exe",
        "x86_64-pc-windows-msvc" => "x86_64-pc-windows-msvc.exe",
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
                #[cfg(target_os = "macos")]
                {
                    #[cfg(target_arch = "aarch64")]
                    {
                        "aarch64-apple-darwin"
                    }
                    #[cfg(target_arch = "x86_64")]
                    {
                        "x86_64-apple-darwin"
                    }
                }
                #[cfg(target_os = "linux")]
                {
                    #[cfg(target_arch = "aarch64")]
                    {
                        "aarch64-unknown-linux-gnu"
                    }
                    #[cfg(target_arch = "x86_64")]
                    {
                        "x86_64-unknown-linux-gnu"
                    }
                }
                #[cfg(target_os = "windows")]
                {
                    #[cfg(target_arch = "aarch64")]
                    {
                        "aarch64-pc-windows-msvc.exe"
                    }
                    #[cfg(target_arch = "x86_64")]
                    {
                        "x86_64-pc-windows-msvc.exe"
                    }
                }
            }
        }
    };

    format!("{}-{}", base_name, suffix)
}
