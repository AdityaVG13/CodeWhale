//! Consolidated harness for plain `#[test]`/`#[tokio::test]` acceptance suites.
//!
//! See `crates/tui/tests/README.md` for why this exists: 17 small integration
//! binaries each re-linked the full `codewhale-tui` graph — one harness keeps the
//! same test names (`integration::adaptive_evidence_acceptance::...`) so
//! `cargo test -p codewhale-tui adaptive_evidence_acceptance` still filters.

#[path = "../support/binary.rs"]
mod binary;

// Production modules that are `#[path]`-included by the test files below and
// that themselves use `crate::`. They must exist at the harness crate root so
// `crate::config`, `crate::shell_dispatcher`, etc. resolve when the same
// files are compiled as `crate::integration::<test>::<module>`.

#[path = "../../src/config/home.rs"]
#[allow(dead_code)]
mod config;
#[path = "../../src/eval.rs"]
mod eval;
#[path = "../../src/skills/frontmatter.rs"]
mod frontmatter;
#[path = "../../src/skills/install.rs"]
#[allow(dead_code)]
mod install;
#[path = "../support/llm_client.rs"]
mod llm_client;
#[path = "../../src/network_policy.rs"]
mod network_policy;
/// `skills/install.rs` reads downloads through `crate::utils`; only the
/// capped body reader is needed, so only that file is included.
#[path = "../../src/utils/response_body.rs"]
mod utils;
mod tools {
    pub mod web {
        pub mod guard {
            pub type DnsPin = Option<(String, std::net::IpAddr)>;

            pub fn fetch_target_host(url: &reqwest::Url) -> anyhow::Result<String> {
                url.host_str()
                    .map(str::to_ascii_lowercase)
                    .ok_or_else(|| anyhow::anyhow!("URL must include a host"))
            }

            pub fn guarded_reqwest_client_builder() -> reqwest::ClientBuilder {
                codewhale_release::tls::reqwest_client_builder().no_proxy()
            }

            pub async fn validate_fetch_destination(
                _host: String,
                _decider: Option<&crate::network_policy::NetworkPolicyDecider>,
                _tool: &str,
                _resolve: bool,
            ) -> anyhow::Result<DnsPin> {
                Ok(None)
            }
        }
    }
}
mod mcp {
    pub fn configured_mcp_proxy<F>(
        _url: &reqwest::Url,
        _disallow_ambient_proxy: bool,
        _read_environment: F,
    ) -> anyhow::Result<Option<reqwest::Proxy>>
    where
        F: FnMut(&str) -> std::result::Result<String, std::env::VarError>,
    {
        Ok(None)
    }
}
/// `network_policy.rs` resolves its audit file through `crate::audit`. The
/// harness has no audit module, so it gets a per-process scratch log: like the
/// production cfg(test) path (#6534), a test never appends to the real
/// `~/.codewhale/audit.log`.
mod audit {
    pub fn audit_log_path() -> Option<std::path::PathBuf> {
        Some(
            std::env::temp_dir()
                .join(format!("codewhale-it-audit-{}", std::process::id()))
                .join("audit.log"),
        )
    }
}
#[path = "../../src/skills/package_digest.rs"]
#[allow(dead_code)]
mod package_digest;
#[path = "../../src/shell_dispatcher.rs"]
mod shell_dispatcher;
// The legacy text tool-call parser lives in codewhale-core now; keep the
// `crate::tool_parser` path the suites use.
use codewhale_core::tool_parser;
// `shell_dispatcher` reaches raw mode through the runtime's terminal port.
use codewhale_runtime::host_terminal;

mod adaptive_evidence_acceptance;
mod cache_guard;
mod coordination_acceptance;
mod diagnostic_read_only;
mod dotenv_authority;
mod eval_harness;
mod exec_persistent_service;
mod exec_stream_drop_acceptance;
mod exec_turn_usage;
mod integration_mock_llm;
mod issue_report_acceptance;
mod lifecycle_outbox_exec;
mod palette_audit;
mod protocol_recovery;
mod reasoning_content_replayed_after_tool_call;
mod shell_denial_acceptance;
mod skill_cli;
mod telemetry_contract;
mod verifiers_harness_contract;
mod workflow_tool_stream_acceptance;
