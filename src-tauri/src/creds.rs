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

#[cfg(test)]
mod tests {
    //! What is reachable without a real keychain.
    //!
    //! `keyring`'s mock store gives every `Entry` its own empty credential, and
    //! [`entry`] builds a fresh one per call — so `save` followed by `load`
    //! does not round-trip here, and the branches behind a *stored* value
    //! (parsing it, and the "corrupt credentials" error beside it) cannot be
    //! reached. Threading a store seam through this module would buy those two
    //! branches at the cost of a layer that exists only for the tests, which is
    //! a bad trade for a file whose job is to keep a token out of reach.
    //!
    //! What is covered is the part that does not need a keychain at all: the
    //! conversion the frontend receives, the JSON that gets stored, and the
    //! absent-entry paths through all three functions.

    use super::*;
    use std::sync::Once;

    /// Point the `keyring` crate at its in-memory store.
    ///
    /// Process-wide, hence the `Once`: without it the tests would talk to the
    /// real login keychain, which on macOS means a permission prompt in CI and
    /// a test that writes to the developer's own credentials.
    fn use_mock_keychain() {
        static INIT: Once = Once::new();
        INIT.call_once(|| {
            keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        });
    }

    fn creds() -> Credentials {
        Credentials {
            site: "https://team.atlassian.net".to_string(),
            email: "anna@example.com".to_string(),
            token: "s3cret-api-token".to_string(),
        }
    }

    #[test]
    fn the_frontend_copy_carries_no_token() {
        // The whole reason `CredentialsMeta` exists. Serialised rather than
        // field-checked: what matters is what crosses the IPC boundary, and a
        // token reaching the webview is the one failure this module must not
        // have.
        let meta = CredentialsMeta::from(&creds());
        let json = serde_json::to_string(&meta).unwrap();

        assert!(!json.contains("s3cret-api-token"), "token leaked: {json}");
        assert!(!json.contains("token"), "token field present: {json}");
    }

    #[test]
    fn the_frontend_copy_keeps_the_site_and_email() {
        // Both are shown on the settings screen, so dropping either would
        // leave it looking unconfigured.
        let meta = CredentialsMeta::from(&creds());

        assert_eq!(meta.site, "https://team.atlassian.net");
        assert_eq!(meta.email, "anna@example.com");
    }

    #[test]
    fn credentials_survive_the_round_trip_through_json() {
        // This is exactly what `save` writes and `load` reads back.
        let json = serde_json::to_string(&creds()).unwrap();
        let back: Credentials = serde_json::from_str(&json).unwrap();

        assert_eq!(back.site, "https://team.atlassian.net");
        assert_eq!(back.email, "anna@example.com");
        assert_eq!(back.token, "s3cret-api-token");
    }

    #[test]
    fn nothing_stored_is_not_an_error() {
        // First run: the app asks for credentials before any exist, and a
        // missing entry has to read as "not set up yet" rather than a failure.
        use_mock_keychain();

        assert!(matches!(load(), Ok(None)));
    }

    #[test]
    fn saving_reaches_the_keychain() {
        use_mock_keychain();

        assert!(save(&creds()).is_ok());
    }

    #[test]
    fn clearing_what_was_never_stored_succeeds() {
        // Signing out twice, or before signing in, is not a failure — and the
        // command behind it would surface one to the user.
        use_mock_keychain();

        assert!(clear().is_ok());
    }
}
