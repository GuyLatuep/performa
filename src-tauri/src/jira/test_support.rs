//! Scaffolding for the client's async tests.
//!
//! A real HTTP server on localhost rather than a stubbed `reqwest`: what these
//! tests are about is the round trip — the query the client builds, the JSON it
//! gets back, and the shape it turns that into — and a hand-stubbed transport
//! would only prove the stub matches the code that calls it.
//!
//! No seam was needed in the client for this. [`JiraClient::new`] takes the
//! base URL from the credentials it is handed and every request goes through
//! `self.url(path)`, so pointing one at a mock server is a matter of passing a
//! different site.

use serde_json::Value;
use wiremock::matchers::{method, path, path_regex};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::JiraClient;
use crate::creds::Credentials;

/// A client talking to `server`, with credentials that are never checked —
/// the mock answers whatever arrives.
pub(super) fn client_for(server: &MockServer) -> JiraClient {
    JiraClient::new(&Credentials {
        site: server.uri(),
        email: "tester@example.com".to_string(),
        token: "token".to_string(),
    })
}

/// Answer one GET path with this JSON, as many times as it is asked.
pub(super) async fn mount_get(server: &MockServer, at: &str, body: Value) {
    Mock::given(method("GET"))
        .and(path(at))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .mount(server)
        .await;
}

/// The same, for paths that carry an id — `at` is a regex.
pub(super) async fn mount_get_matching(server: &MockServer, at: &str, body: Value) {
    Mock::given(method("GET"))
        .and(path_regex(at))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .mount(server)
        .await;
}

/// Answer a GET with a failure, so the error paths can be reached.
pub(super) async fn mount_get_failing(server: &MockServer, at: &str, status: u16, body: Value) {
    Mock::given(method("GET"))
        .and(path_regex(at))
        .respond_with(ResponseTemplate::new(status).set_body_json(body))
        .mount(server)
        .await;
}

/// The site's field catalog, which `issue_detail` resolves names through.
/// Every test that opens an issue needs one mounted.
pub(super) fn field_catalog() -> Value {
    serde_json::json!([
        { "id": "summary", "name": "Summary" },
        { "id": "customfield_101", "name": "Plant no." },
        { "id": "customfield_102", "name": "Line" },
        { "id": "customfield_103", "name": "Request Type" },
    ])
}

/// How many requests the server has seen for a path, so a test can show that a
/// cache spared the second one.
pub(super) async fn requests_to(server: &MockServer, containing: &str) -> usize {
    server
        .received_requests()
        .await
        .unwrap_or_default()
        .iter()
        .filter(|r| r.url.path().contains(containing))
        .count()
}
