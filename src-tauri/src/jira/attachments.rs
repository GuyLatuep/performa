//! Files on an issue: listing what is there, fetching one, adding and removing.
//!
//! Split from [] because attachments are the one part of the
//! issue view that moves *bytes* rather than JSON. That difference is what the
//! module is about: the transfers need their own timeout, they write to the
//! filesystem, and they carry the credentials that must never reach the
//! webview — none of which is true of anything else the view reads.

use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};

use serde_json::Value;

use super::issue::{author_name, stamp};
use super::types::*;
use super::JiraClient;

/// How long a file transfer may take.
///
/// The client's global 30s covers a whole request including its body, which is
/// right for the JSON calls and far too short for a file: Jira allows 10 MB
/// attachments, and a slow uplink needs minutes for one. Worse, a POST that
/// times out may already have been accepted — the user would see an error
/// beside an attachment that did land.
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// A ceiling on an issue-type icon. Jira's are a couple of kB; anything past
/// this is not the 16px glyph a row is asking for, and a data URL built from it
/// would be handed straight to the webview.
const MAX_ICON_BYTES: usize = 512 * 1024;

impl JiraClient {
    /// Fetch one attachment's bytes and write them beside the app's other
    /// scratch files, returning the path.
    ///
    /// Downloaded here rather than in the webview because this is where the
    /// credentials are: Jira's attachment content is behind the same auth as
    /// everything else, and a URL the webview could fetch would mean handing
    /// the webview a credential.
    pub async fn download_attachment(
        &self,
        attachment_id: &str,
        filename: &str,
        dir: &Path,
    ) -> Result<PathBuf, String> {
        let resp = self
            .http
            .get(self.url(&format!("/rest/api/3/attachment/content/{attachment_id}")))
            .header("Authorization", &self.auth)
            .send()
            .await
            .map_err(|e| format!("attachment download failed: {e}"))?;
        let resp = Self::check(resp).await?;
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("attachment download failed: {e}"))?;

        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|e| format!("could not create the download folder: {e}"))?;
        // Namespaced by attachment id: two issues can each hold a "report.pdf",
        // and the second must not quietly overwrite the first.
        let path = dir.join(format!("{attachment_id}-{filename}"));
        // Async rather than `std::fs`: a multi-megabyte write inside an async
        // command would hold a tokio worker for its whole duration, stalling the
        // background scans sharing the runtime.
        tokio::fs::write(&path, &bytes)
            .await
            .map_err(|e| format!("could not write {}: {e}", path.display()))?;
        log::info!(
            "downloaded attachment {attachment_id} ({} bytes) to {}",
            bytes.len(),
            path.display()
        );
        Ok(path)
    }

    /// One issue type's icon, as a `data:` URL the webview can put in an
    /// `<img>`.
    ///
    /// Here rather than in the webview for the same reason attachments are:
    /// Jira's avatar endpoints are behind the same auth as everything else, so
    /// the fetch has to happen where the credentials are.
    ///
    /// The URL comes out of Jira's own JSON, but it reaches this method by way
    /// of the webview — so it is checked against the configured site before a
    /// request carrying the `Authorization` header is sent anywhere near it.
    pub async fn issue_type_icon(&self, url: &str) -> Result<String, String> {
        if !on_site(&self.site, url) {
            return Err(format!("icon URL is not on {}: {url}", self.site));
        }
        let resp = self
            .http
            .get(url)
            .header("Authorization", &self.auth)
            .send()
            .await
            .map_err(|e| format!("icon download failed: {e}"))?;
        let resp = Self::check(resp).await?;
        // Read before trusting the length header: a chunked response has none.
        let mime = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|v| v.split(';').next().unwrap_or(v).trim().to_string())
            .filter(|v| v.starts_with("image/"))
            .unwrap_or_else(|| "image/png".to_string());
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("icon download failed: {e}"))?;
        if bytes.len() > MAX_ICON_BYTES {
            return Err(format!("icon at {url} is larger than an icon should be"));
        }
        Ok(format!("data:{mime};base64,{}", STANDARD.encode(&bytes)))
    }

    /// Remove one attachment from an issue.
    ///
    /// Jira has no undo for this — the file is gone from the issue for
    /// everyone, not just this user — so the confirmation belongs in front of
    /// the call, in the view.
    pub async fn delete_attachment(&self, attachment_id: &str) -> Result<(), String> {
        let result = self
            .send_ok(
                self.http
                    .delete(self.url(&format!("/rest/api/3/attachment/{attachment_id}"))),
            )
            .await;
        match &result {
            Ok(()) => log::info!("deleted attachment {attachment_id}"),
            Err(e) => log::error!("deleting attachment {attachment_id} failed: {e}"),
        }
        result
    }

    /// Attach one file to an issue.
    ///
    /// `X-Atlassian-Token: no-check` is Jira's XSRF opt-out and is required on
    /// this endpoint; without it the request is rejected outright.
    pub async fn upload_attachment(&self, issue_key: &str, path: &Path) -> Result<(), String> {
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| format!("{} has no file name", path.display()))?
            .to_string();
        let bytes =
            std::fs::read(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
        let part = reqwest::multipart::Part::bytes(bytes).file_name(filename.clone());
        let form = reqwest::multipart::Form::new().part("file", part);
        let result = self
            .send_ok(
                self.http
                    .post(self.url(&format!("/rest/api/3/issue/{issue_key}/attachments")))
                    .header("X-Atlassian-Token", "no-check")
                    .timeout(TRANSFER_TIMEOUT)
                    .multipart(form),
            )
            .await;
        match &result {
            Ok(()) => log::info!("attached {filename} to {issue_key}"),
            Err(e) => log::error!("attaching {filename} to {issue_key} failed: {e}"),
        }
        result
    }
}

/// The issue's attachments, newest first. An absent or malformed field simply
/// means no attachments — the rest of the issue is still worth showing.
pub(super) fn attachments(value: Option<&Value>) -> Vec<Attachment> {
    let Some(raw) = value else { return Vec::new() };
    let Ok(parsed) = serde_json::from_value::<Vec<RawAttachment>>(raw.clone()) else {
        return Vec::new();
    };
    let mut items: Vec<(i64, Attachment)> = parsed
        .into_iter()
        .map(|a| {
            let (created_at, created_ts) = stamp(&a.created);
            (
                created_ts,
                Attachment {
                    id: a.id,
                    filename: a.filename,
                    size: a.size,
                    mime_type: a.mime_type,
                    author: author_name(a.author.as_ref()),
                    created_at,
                },
            )
        })
        .collect();
    items.sort_by_key(|(ts, _)| std::cmp::Reverse(*ts));
    items.into_iter().map(|(_, a)| a).collect()
}

/// Is `url` on the configured site?
///
/// A plain `starts_with` is not enough. The site is stored with its trailing
/// slash trimmed (see `JiraClient::new`), so `https://you.atlassian.net` is
/// also a prefix of `https://you.atlassian.net.evil.example/x.png` — and the
/// only caller sends the `Authorization` header, so letting that through hands
/// the API token to whoever registered the longer name. The match has to end
/// on a path boundary, which is the same rule `normalize_site` applies when
/// the site is first accepted.
fn on_site(site: &str, url: &str) -> bool {
    url.len() > site.len() && url.starts_with(site) && url.as_bytes()[site.len()] == b'/'
}

#[cfg(test)]
mod tests {
    use super::*;

    const SITE: &str = "https://example.atlassian.net";

    #[test]
    fn an_icon_on_the_site_is_accepted() {
        assert!(on_site(
            SITE,
            "https://example.atlassian.net/images/type.png"
        ));
    }

    #[test]
    fn a_look_alike_host_is_not_on_the_site() {
        // The whole point: a prefix match would send the API token here.
        assert!(!on_site(
            SITE,
            "https://example.atlassian.net.evil.example/x.png"
        ));
        assert!(!on_site(SITE, "https://example.atlassian.net.evil.example"));
    }

    #[test]
    fn an_unrelated_host_is_not_on_the_site() {
        assert!(!on_site(SITE, "https://evil.example/x.png"));
        assert!(!on_site(
            SITE,
            "https://evil.example/?u=https://example.atlassian.net/"
        ));
    }

    #[test]
    fn the_bare_site_carries_no_icon() {
        // No path, so nothing to fetch — and it keeps the indexing in
        // `on_site` in bounds.
        assert!(!on_site(SITE, SITE));
    }
}
