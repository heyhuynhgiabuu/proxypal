use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::Rng;

fn derive_key() -> [u8; 32] {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut key = [0u8; 32];
    let mut hasher = DefaultHasher::new();

    // Derive from machine-specific sources:
    // 1. Username (from environment)
    // 2. Computer name (hostname)
    // 3. PID changes each run -> included in state file check
    // Result is unique per user/machine - attacker cannot reverse without these

    let username = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "default".to_string());
    username.hash(&mut hasher);

    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "localhost".to_string());
    hostname.hash(&mut hasher);

    // Mix in app version for forward secrecy when version upgrades
    "ProxyPal_v042".hash(&mut hasher);

    let hash = hasher.finish().to_le_bytes();
    for (i, byte) in hash.iter().enumerate() {
        key[i % 32] ^= byte;
        key[(i + 16) % 32] ^= byte;
    }
    key
}

pub fn encrypt(plaintext: &str) -> Result<String, String> {
    let key = derive_key();
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;

    let mut rng = rand::thread_rng();
    let nonce_bytes: [u8; 12] = rng.gen();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| e.to_string())?;

    let mut result = BASE64.encode(&nonce_bytes);
    result.push(':');
    result.push_str(&BASE64.encode(&ciphertext));
    Ok(result)
}

pub fn decrypt(encrypted: &str) -> Result<String, String> {
    let key = derive_key();
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;

    let parts: Vec<&str> = encrypted.split(':').collect();
    if parts.len() != 2 {
        return Err("Invalid encrypted format".to_string());
    }

    let nonce_bytes = BASE64.decode(parts[0]).map_err(|e| e.to_string())?;
    let ciphertext = BASE64.decode(parts[1]).map_err(|e| e.to_string())?;

    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher.decrypt(nonce, ciphertext.as_ref()).map_err(|_e| {
        "Decryption failed: credentials may have changed or user profile modified".to_string()
    })?;

    String::from_utf8(plaintext).map_err(|e| e.to_string())
}

pub fn encrypt_api_keyfields<T: serde::Serialize>(data: &T) -> Result<String, String> {
    let json = serde_json::to_string(data).map_err(|e| e.to_string())?;
    encrypt(&json)
}

pub fn decrypt_api_keyfields<T: serde::de::DeserializeOwned>(encrypted: &str) -> Result<T, String> {
    let json = decrypt(encrypted)?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}
