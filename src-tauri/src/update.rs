//! Best-effort update check against the project's GitHub releases.

use serde::{Deserialize, Serialize};

/// Repo whose releases are checked for newer versions.
const GITHUB_REPO: &str = "GuyLatuep/performa";

#[derive(Serialize)]
pub struct UpdateInfo {
    #[serde(rename = "currentVersion")]
    pub current_version: String,
    #[serde(rename = "latestVersion")]
    pub latest_version: String,
    /// Release page with the downloadable assets.
    #[serde(rename = "downloadUrl")]
    pub download_url: String,
    #[serde(rename = "isNewer")]
    pub is_newer: bool,
}

#[derive(Deserialize)]
struct LatestRelease {
    tag_name: String,
    html_url: String,
}

pub async fn check(current_version: &str) -> Result<UpdateInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_default();
    let resp = client
        .get(format!(
            "https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
        ))
        .header("User-Agent", "performa-update-check")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub returned {}", resp.status()));
    }
    let release: LatestRelease = resp
        .json()
        .await
        .map_err(|e| format!("unexpected GitHub response: {e}"))?;

    let is_newer = parse_version(&release.tag_name) > parse_version(current_version);
    Ok(UpdateInfo {
        current_version: current_version.to_string(),
        latest_version: release.tag_name,
        download_url: checked_release_url(release.html_url),
        is_newer,
    })
}

/// The URL is handed to the OS opener, so only accept a page inside this
/// project's repo; anything else falls back to the releases overview.
fn checked_release_url(url: String) -> String {
    if url.starts_with(&format!("https://github.com/{GITHUB_REPO}/")) {
        url
    } else {
        format!("https://github.com/{GITHUB_REPO}/releases")
    }
}

/// Lenient semver-ish parse: optional leading `v`, numeric
/// major.minor.patch, pre-release/build suffixes ignored.
fn parse_version(s: &str) -> (u64, u64, u64) {
    let core = s.trim().trim_start_matches('v');
    let core = core.split(['-', '+']).next().unwrap_or("");
    let mut nums = core.split('.').map(|p| p.parse::<u64>().unwrap_or(0));
    (
        nums.next().unwrap_or(0),
        nums.next().unwrap_or(0),
        nums.next().unwrap_or(0),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_parsing() {
        assert_eq!(parse_version("v1.2.3"), (1, 2, 3));
        assert_eq!(parse_version("0.4.0"), (0, 4, 0));
        assert_eq!(parse_version("v2.0.0-beta.1"), (2, 0, 0));
        assert_eq!(parse_version("garbage"), (0, 0, 0));
        assert!(parse_version("v0.4.1") > parse_version("0.4.0"));
    }

    #[test]
    fn release_url_is_pinned_to_the_repo() {
        let good = format!("https://github.com/{GITHUB_REPO}/releases/tag/v1.0.0");
        assert_eq!(checked_release_url(good.clone()), good);
        assert_eq!(
            checked_release_url("https://evil.example.com/x".into()),
            format!("https://github.com/{GITHUB_REPO}/releases")
        );
    }
}
