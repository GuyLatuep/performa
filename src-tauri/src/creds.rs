//! Secure storage of Jira credentials in the OS keychain
//! (macOS Keychain / Windows Credential Manager) via the `keyring` crate.
//! The API token never leaves the Rust process — the frontend only ever
//! receives non-secret metadata (site + email).

use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "performa";
const ACCOUNT: &str = "jira-credentials";

#[derive(Serialize, Deserialize, Clone)]
pub struct Credentials {
    /// Jira Cloud base URL, e.g. `https://your-team.atlassian.net`
    pub site: String,
    pub email: String,
    pub token: String,
}

/// Non-secret subset returned to the frontend.
#[derive(Serialize, Clone)]
pub struct CredentialsMeta {
    pub site: String,
    pub email: String,
}

impl From<&Credentials> for CredentialsMeta {
    fn from(c: &Credentials) -> Self {
        CredentialsMeta {
            site: c.site.clone(),
            email: c.email.clone(),
        }
    }
}

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("keychain error: {e}"))
}

pub fn load() -> Result<Option<Credentials>, String> {
    match entry()?.get_password() {
        Ok(json) => {
            let creds =
                serde_json::from_str(&json).map_err(|e| format!("corrupt credentials: {e}"))?;
            Ok(Some(creds))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keychain read failed: {e}")),
    }
}

pub fn save(creds: &Credentials) -> Result<(), String> {
    let json = serde_json::to_string(creds).map_err(|e| e.to_string())?;
    entry()?
        .set_password(&json)
        .map_err(|e| format!("keychain write failed: {e}"))
}

pub fn clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain delete failed: {e}")),
    }
}
