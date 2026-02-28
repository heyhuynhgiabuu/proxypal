use std::env;
use std::fs;
use std::path::Path;
use std::process::Command;

const ALLOW_DOWNLOAD_ENV: &str = "PROXYPAL_ALLOW_SIDECAR_DOWNLOAD";

fn main() {
    println!("cargo:rerun-if-env-changed={}", ALLOW_DOWNLOAD_ENV);

    // Get the target triple for the current build
    let target = env::var("TARGET")
        .unwrap_or_else(|_| env::var("HOST").unwrap_or_else(|_| String::from("unknown")));

    let binary_name = get_binary_name(&target);
    let binaries_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
    let binary_path = binaries_dir.join(&binary_name);

    let is_ci = env::var("CI").is_ok();
    // For check-only flows we can skip sidecar enforcement.
    let is_check_only = env::var("PROXYPAL_SKIP_SIDECAR").is_ok();

    let needs_download = if !binary_path.exists() {
        println!("cargo:warning=Sidecar binary not found: {}", binary_name);
        true
    } else if !is_valid_binary(&binary_path) {
        println!(
            "cargo:warning=Sidecar binary is corrupted (gzip/invalid format): {}",
            binary_name
        );
        // Remove the invalid file so the download replaces it.
        let _ = fs::remove_file(&binary_path);
        true
    } else {
        false
    };

    if needs_download {
        if is_check_only {
            // Create a dummy binary so tauri_build::build() doesn't fail.
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
        } else if should_auto_download() {
            println!(
                "cargo:warning={} enabled; downloading sidecar binary",
                ALLOW_DOWNLOAD_ENV
            );
            download_binary(&binary_name, &binaries_dir);
        } else {
            panic!(
                "Required sidecar binary is missing or invalid: {}\nExpected at: {}\n\
Set {}=1 to auto-download during local development, or place the binary in src-tauri/binaries manually.\n\
You can also run `pnpm update-sidecar --force` to fetch the pinned release.",
                binary_name,
                binary_path.display(),
                ALLOW_DOWNLOAD_ENV
            );
        }
    }

    tauri_build::build()
}

fn should_auto_download() -> bool {
    env::var(ALLOW_DOWNLOAD_ENV)
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            normalized == "1" || normalized == "true" || normalized == "yes"
        })
        .unwrap_or(false)
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
/// Falls back to platform-specific shell scripts if Node is unavailable.
fn download_binary(binary_name: &str, binaries_dir: &Path) {
    let project_root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let node_script = project_root.join("scripts").join("update-sidecar.mjs");

    // Prefer the cross-platform Node.js script
    if node_script.exists() {
        let status = Command::new("node")
            .arg(&node_script)
            .arg("--force")
            .status();

        match status {
            Ok(s) if s.success() => {
                println!("cargo:warning=Sidecar binary downloaded successfully");
                return;
            }
            Ok(s) => {
                println!(
                    "cargo:warning=Node script exited with code {:?}, trying shell fallback",
                    s.code()
                );
            }
            Err(e) => {
                println!(
                    "cargo:warning=Failed to run node ({}), trying shell fallback",
                    e
                );
            }
        }
    }

    // Fallback to platform-specific shell scripts in src-tauri/scripts/
    let scripts_dir = binaries_dir.parent().unwrap().join("scripts");

    #[cfg(not(windows))]
    {
        let script_path = scripts_dir.join("download-binaries.sh");
        if script_path.exists() {
            let status = Command::new("bash")
                .arg(&script_path)
                .arg(binary_name)
                .status()
                .expect("Failed to execute download script");

            if !status.success() {
                panic!(
                    "Failed to download sidecar binary: {}.\n\
                    Run manually: pnpm update-sidecar --force\n\
                    Or: bash src-tauri/scripts/download-binaries.sh {}",
                    binary_name, binary_name
                );
            }
        } else {
            panic!(
                "Sidecar binary missing: {}.\n\
                Run: pnpm update-sidecar --force",
                binary_name
            );
        }
    }

    #[cfg(windows)]
    {
        let script_path = scripts_dir.join("download-binaries.ps1");
        if script_path.exists() {
            let status = Command::new("powershell")
                .arg("-ExecutionPolicy")
                .arg("Bypass")
                .arg("-File")
                .arg(&script_path)
                .arg(binary_name)
                .status()
                .expect("Failed to execute download script");

            if !status.success() {
                panic!(
                    "Failed to download sidecar binary: {}.\n\
                    Run manually: pnpm update-sidecar --force",
                    binary_name
                );
            }
        } else {
            panic!(
                "Sidecar binary missing: {}.\n\
                Run: pnpm update-sidecar --force",
                binary_name
            );
        }
    }
}

fn get_binary_name(target: &str) -> String {
    let base_name = "cli-proxy-api";

    // Map Rust target triples to our binary naming convention
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
