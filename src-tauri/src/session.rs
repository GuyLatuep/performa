//! The signed-in session every Jira command runs against, and the rules for
//! building, replacing and dropping it while commands race each other.

use crate::creds;
use crate::jira::{JiraClient, Myself};
use std::sync::atomic::{AtomicU64, Ordering};

/// Client + account id, built once from the stored credentials and cached so
/// commands neither re-read the keychain nor re-fetch `myself` on every call.
#[derive(Clone)]
pub struct Session {
    pub client: JiraClient,
    pub account_id: String,
    /// How the user's mentions render in comment text — the mentions scan
    /// needs it to narrow its candidate search (see `jira::mentions`).
    pub display_name: String,
}

impl Session {
    pub fn new(client: JiraClient, me: &Myself) -> Self {
        Self {
            client,
            account_id: me.account_id.clone(),
            display_name: me.display_name.clone(),
        }
    }
}

#[derive(Default)]
pub struct AppState {
    slot: tokio::sync::Mutex<Option<Session>>,
    /// Bumped whenever the stored credentials change — by [`Self::sign_in`]
    /// and by [`Self::sign_out`]. [`Self::session`] reads it before the
    /// keychain load and checks it again under the lock, so a build that
    /// started before a sign-out cannot install its result afterwards.
    generation: AtomicU64,
}

impl AppState {
    fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// Mark the stored credentials as changed, invalidating any session build
    /// already in flight.
    fn bump_generation(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
    }

    /// The cached session, or build (and cache) one from the stored credentials.
    ///
    /// The keychain read and the `myself` round-trip deliberately run *without*
    /// the lock held. Holding it would make one command's session build block
    /// every other command for the full 30s HTTP timeout, so an unreachable Jira
    /// costs one stall per queued command instead of one overall — and the app
    /// fires several commands at once on startup. The price is that commands
    /// racing on a cold start may each fetch `myself` once; the first result to
    /// land is kept and the rest reuse it.
    ///
    /// The generation read here and re-checked in [`install_session`] is what
    /// keeps that lock-free build honest across a sign-out — see there.
    pub async fn session(&self) -> Result<Session, String> {
        let cached = self.slot.lock().await.clone();
        if let Some(s) = cached {
            return Ok(s);
        }
        let started_at = self.generation();
        let creds = creds::load()?.ok_or_else(|| "not configured".to_string())?;
        let client = JiraClient::new(&creds);
        let me = client.myself().await?;
        let built = Session::new(client, &me);
        let mut guard = self.slot.lock().await;
        install_session(&mut guard, built, started_at, self.generation())
    }

    /// Replace the session with one built from freshly saved credentials.
    pub async fn sign_in(&self, session: Session) {
        // Before the slot is written, so a build already in flight against the
        // old credentials cannot land on top of this one.
        self.bump_generation();
        *self.slot.lock().await = Some(session);
    }

    /// Drop the session. Only the in-memory side — the keychain entry is the
    /// caller's to clear.
    pub async fn sign_out(&self) {
        // Bumped while the lock is held, so a session build racing this
        // sign-out either reads the old generation (and is refused on the way
        // in) or reads the new one (and finds the slot already empty).
        let mut guard = self.slot.lock().await;
        self.bump_generation();
        *guard = None;
    }
}

/// Decide what a finished session build may do to the session slot.
///
/// Three cases, and the last one is the reason this exists:
///
/// - Somebody else already installed a session — reuse theirs, whoever won.
/// - The slot is empty and the credentials have not moved — install ours.
/// - The slot is empty *because* the credentials moved under us. A command
///   that entered [`AppState::session`] before a sign-out and whose `myself`
///   landed after it would otherwise write the signed-out account's client
///   back in, and every later command would keep using credentials the user
///   believes are gone until the process restarts. Install nothing and report
///   what is now true: there are no credentials.
fn install_session(
    slot: &mut Option<Session>,
    built: Session,
    generation_at_start: u64,
    generation_now: u64,
) -> Result<Session, String> {
    if let Some(existing) = slot.as_ref() {
        return Ok(existing.clone());
    }
    if generation_at_start != generation_now {
        return Err("not configured".to_string());
    }
    Ok(slot.insert(built).clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::creds::Credentials;

    fn test_session(account: &str) -> Session {
        let creds = Credentials {
            site: "https://example.atlassian.net".into(),
            email: "a@b.c".into(),
            token: "t".into(),
        };
        Session {
            client: JiraClient::new(&creds),
            account_id: account.into(),
            display_name: "Test User".into(),
        }
    }

    #[test]
    fn a_session_build_installs_into_an_empty_slot() {
        let mut slot = None;
        let got = install_session(&mut slot, test_session("me"), 7, 7).expect("installed");
        assert_eq!(got.account_id, "me");
        assert_eq!(slot.expect("stored").account_id, "me");
    }

    #[test]
    fn a_session_installed_by_somebody_else_wins() {
        // Two commands raced on a cold start; the first to land is kept and
        // the loser reuses it rather than replacing it.
        let mut slot = Some(test_session("first"));
        let got = install_session(&mut slot, test_session("second"), 7, 7).expect("reused");
        assert_eq!(got.account_id, "first");
        assert_eq!(slot.expect("stored").account_id, "first");
    }

    #[test]
    fn a_sign_out_mid_build_is_not_undone_by_the_build() {
        // The whole point: a sign-out ran while `myself` was in flight. The
        // finished build must not resurrect the old account.
        let mut slot = None;
        let Err(err) = install_session(&mut slot, test_session("old"), 7, 8) else {
            panic!("a build begun before the sign-out must be refused");
        };
        assert_eq!(err, "not configured");
        assert!(slot.is_none(), "the signed-out slot must stay empty");
    }

    #[test]
    fn generations_only_move_forward() {
        let state = AppState::default();
        let start = state.generation();
        state.bump_generation();
        assert_ne!(state.generation(), start);
    }

    #[tokio::test]
    async fn signing_in_and_out_moves_the_generation_and_the_slot() {
        let state = AppState::default();
        let start = state.generation();

        state.sign_in(test_session("me")).await;
        assert_ne!(state.generation(), start);
        assert_eq!(state.session().await.expect("cached").account_id, "me");

        let signed_in = state.generation();
        state.sign_out().await;
        assert_ne!(state.generation(), signed_in);
        assert!(state.slot.lock().await.is_none());
    }
}
