use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    // Password auth is not supported in non-interactive mode. Use key_file.
    pub key_file: Option<String>,
    pub remote_port: u16,
    pub local_port: u16, // usually config.port (8317) but configurable
    #[serde(default)]
    pub enabled: bool, // If true, should be connected
}
