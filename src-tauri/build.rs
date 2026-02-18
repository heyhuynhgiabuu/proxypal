use std::env;
use std::path::Path;
use std::process::Command;

const ALLOW_DOWNLOAD_ENV: &str = "PROXYPAL_ALLOW_SIDECAR_DOWNLOAD";

fn main() {
    println!("cargo:rerun-if-env-changed={}", ALLOW_DOWNLOAD_ENV);

    // Get the target triple for the current build
    let target = env::var("TARGET").unwrap_or_else(|_| {
        // Fallback to host target
        env::var("HOST").unwrap_or_else(|_| String::from("unknown"))
    });

    // Map target to binary name
    let binary_name = get_binary_name(&target);
    let binaries_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
    let binary_path = binaries_dir.join(&binary_name);

    if !binary_path.exists() {
        if should_auto_download() {
            download_binary(&binary_name);
        } else {
            panic!(
				"Required sidecar binary is missing: {}\nExpected at: {}\n\
Set {}=1 to auto-download during local development, or place the binary in src-tauri/binaries manually.",
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

fn download_binary(binary_name: &str) {
    println!("cargo:warning=Binary not found: {}", binary_name);
    println!(
        "cargo:warning={} enabled; downloading pinned CLIProxyAPI sidecar binary",
        ALLOW_DOWNLOAD_ENV
    );

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
            .arg(binary_name)
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
            .arg(binary_name)
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
