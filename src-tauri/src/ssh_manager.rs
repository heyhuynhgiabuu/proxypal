use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use tokio::sync::Notify;

use crate::types::ssh::SshConfig;

#[derive(Clone, serde::Serialize)]
struct SshStatusUpdate {
    id: String,
    status: String,
    message: Option<String>,
}

struct RunningConnection {
    notify_stop: Arc<Notify>,
    #[allow(dead_code)] // we hold the handle to keep the task alive
    handle: tauri::async_runtime::JoinHandle<()>,
}

pub struct SshManager {
    connections: Arc<Mutex<HashMap<String, RunningConnection>>>,
}

impl SshManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn connect(&self, app: AppHandle, config: SshConfig) {
        let connections = self.connections.clone();
        let config_id = config.id.clone();
        
        // Remove existing connection if any
        self.disconnect(&config.id);

        let notify_stop = Arc::new(Notify::new());
        let notify_clone = notify_stop.clone();
        let config_clone = config.clone();
        
        // Helper to emit status
        let emit_status = move |status: &str, msg: Option<String>| {
            let _ = app.emit("ssh-status-changed", SshStatusUpdate {
                id: config_clone.id.clone(),
                status: status.to_string(),
                message: msg,
            });
        };

        let emit_status_clone = emit_status.clone(); // For inside the loop

        let handle = tauri::async_runtime::spawn(async move {
            emit_status_clone("connecting", Some("Initializing...".into()));
            
            loop {
                let mut cmd = Command::new("ssh");
                cmd.arg("-N"); 
                cmd.arg("-v"); // Enable verbose logging for debugging
                
                // Essential options for non-interactive automation
                cmd.arg("-o").arg("BatchMode=yes"); // CRITICAL: Fail instead of prompting for pass/key
                cmd.arg("-o").arg("ServerAliveInterval=15");
                cmd.arg("-o").arg("ServerAliveCountMax=3");
                cmd.arg("-o").arg("ExitOnForwardFailure=yes");
                // SECURITY: 'accept-new' auto-accepts the first key (good for automation)
                // but rejects changed keys (prevents MITM).
                // Requires OpenSSH 7.6+ (standard on Windows 10/11).
                cmd.arg("-o").arg("StrictHostKeyChecking=accept-new");
                cmd.arg("-o").arg("UserKnownHostsFile=/dev/null");
                
                cmd.arg("-R").arg(format!("{}:127.0.0.1:{}", config.remote_port, config.local_port));
                
                if let Some(key) = &config.key_file {
                    if !key.is_empty() {
                         // On Windows, paths might need handling, but Command args usually handle it.
                         // But let's be safe and quote it or just pass it as is.
                         // Rust Command passing argument handles spaces automatically.
                         cmd.arg("-i").arg(key);
                    }
                }
                
                cmd.arg("-p").arg(config.port.to_string());
                cmd.arg(format!("{}@{}", config.username, config.host));

                // Debug print
                emit_status_clone("connecting", Some(format!("Connecting to {}...", config.host)));

                // Setup pipes
                cmd.stdout(std::process::Stdio::null())
                   .stderr(std::process::Stdio::piped())
                   .stdin(std::process::Stdio::null()); // Ensure no input can be requested
                   
                #[cfg(windows)]
                {
                    const CREATE_NO_WINDOW: u32 = 0x08000000;
                    cmd.creation_flags(CREATE_NO_WINDOW);
                }

                // CRITICAL: Ensure process is killed if handle is dropped
                cmd.kill_on_drop(true);

                // Shared state to detect fatal errors
                let fatal_error = Arc::new(std::sync::atomic::AtomicBool::new(false));
                let fatal_error_clone = fatal_error.clone();

                match cmd.spawn() {
                    Ok(mut child) => {
                         // Initial status
                         emit_status_clone("connecting", Some("Authenticating...".into()));
                         
                         let stderr = child.stderr.take();
                         let emit_stderr = emit_status_clone.clone();
                         
                         let stderr_reader = async move {
                             if let Some(stderr) = stderr {
                                 use tokio::io::{AsyncBufReadExt, BufReader};
                                 let reader = BufReader::new(stderr);
                                 let mut lines = reader.lines();
                                 while let Ok(Some(line)) = lines.next_line().await {
                                    //  println!("[SSH Stderr] {}", line);
                                     
                                     let line_lower = line.to_lowercase();
                                     if line_lower.contains("entering interactive session") 
                                        || line_lower.contains("remote forward success") 
                                        || line_lower.contains("authenticated to") 
                                        || line_lower.contains("authentication succeeded") {
                                         emit_stderr("connected", Some("Tunnel established".into()));
                                     } else if line_lower.contains("remote port forwarding failed") {
                                         emit_stderr("error", Some("Remote port unavailable".into()));
                                         fatal_error_clone.store(true, std::sync::atomic::Ordering::Relaxed);
                                     } else if line_lower.contains("permission denied") {
                                          emit_stderr("error", Some("Auth failed".into()));
                                          fatal_error_clone.store(true, std::sync::atomic::Ordering::Relaxed);
                                     } else if !line.trim().is_empty() {
                                         // Log but don't change status
                                     }
                                 }
                             }
                             None::<String>
                         };

                         // Run wait and stderr reading concurrently
                         tokio::select! {
                             exit_status = child.wait() => {
                                 match exit_status {
                                     Ok(status) => {
                                         if status.success() {
                                              emit_status_clone("disconnected", Some("Closed normally".into()));
                                         } else {
                                              // Only emit generic error if we didn't already catch a fatal one
                                              if !fatal_error.load(std::sync::atomic::Ordering::Relaxed) {
                                                  emit_status_clone("error", Some(format!("Exited code: {:?}", status.code())));
                                              }
                                         }
                                     }
                                     Err(e) => {
                                         emit_status_clone("error", Some(format!("Wait error: {}", e)));
                                     }
                                 }
                             }
                             _ = stderr_reader => {
                                 // Stderr stream ended
                                 let _ = child.wait().await;
                             }
                             _ = notify_clone.notified() => {
                                 let _ = child.kill().await;
                                 emit_status_clone("disconnected", Some("User disconnected".into()));
                                 break;
                             }
                         }
                    },
                    Err(e) => {
                        emit_status_clone("error", Some(format!("Failed to start cmd: {}", e)));
                    }
                }
                
                // Retry logic
                emit_status_clone("reconnecting", Some("Retrying in 5s...".into()));
                
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                    _ = notify_clone.notified() => {
                        emit_status_clone("disconnected", Some("User disconnected".into()));
                        break;
                    }
                }
            }
        });

        connections.lock().unwrap().insert(config_id, RunningConnection {
            notify_stop,
            handle,
        });
    }

    pub fn disconnect(&self, id: &str) {
        let mut connections = self.connections.lock().unwrap();
        if let Some(conn) = connections.remove(id) {
            conn.notify_stop.notify_one();
        }
    }
    
    pub fn disconnect_all(&self) {
        println!("[SSH Manager] Shutting down all connections...");
        let mut connections = self.connections.lock().unwrap();
        for (id, conn) in connections.iter() {
            println!("[SSH Manager] Stopping connection: {}", id);
            conn.notify_stop.notify_one();
        }
        connections.clear();
    }

    #[allow(dead_code)]
    pub fn get_status(&self, id: &str) -> String {
       // Ideally status is tracked. But for now, if it's in the map, it's "running" (enabled).
       // Real-time status comes via events. This is just for initial checks or check if "enabled".
       let connections = self.connections.lock().unwrap();
       if connections.contains_key(id) {
           "active".to_string()
       } else {
           "inactive".to_string()
       }
    }
}
