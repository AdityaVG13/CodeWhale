use super::*;
use crate::command_catalog::{BuiltinCommand, CommandCatalog, UserCommand};

fn builtin(name: &str, aliases: Vec<String>) -> BuiltinCommand {
    BuiltinCommand {
        name: name.to_string(),
        aliases,
        usage: format!("/{name} [value]"),
        description_id: codewhale_localization::MessageId::CmdModelDescription,
        subcommands: Vec::new(),
        takes_arguments: true,
        requires_argument: true,
        requires_required_argument: false,
        composer_wants_trailing_space: true,
        palette_runs_directly: false,
        show_in_empty_discovery: true,
        discovery: codewhale_command_contract::CommandDiscovery::Primary,
        unlisted: false,
    }
}

fn user(name: &str) -> UserCommand {
    UserCommand {
        name: name.to_string(),
        aliases: Vec::new(),
        description: Some("Pick the fast route.".to_string()),
        usage: None,
        takes_arguments: false,
        hidden: false,
        extension: false,
        builtin_bindings: vec![name.to_string()],
    }
}

struct Catalog(PathBuf);
impl CommandCatalog for Catalog {
    fn answers_to(&self, name: &str) -> bool {
        matches!(name, "model" | "profile")
    }
    fn builtins(&self) -> Vec<BuiltinCommand> {
        let mut profile = builtin("profile", Vec::new());
        profile.requires_required_argument = true;
        vec![builtin("model", Vec::new()), profile]
    }
    fn user_commands(&self, workspace: &Path) -> Vec<UserCommand> {
        if workspace == self.0 {
            vec![user("model")]
        } else {
            Vec::new()
        }
    }
}

fn entry<'a>(commands: &'a [CommandCatalogEntry], name: &str) -> &'a CommandCatalogEntry {
    commands
        .iter()
        .find(|command| command.name == name)
        .unwrap_or_else(|| panic!("catalog must contain {name}"))
}

#[test]
fn command_catalog_marks_user_shadowing_of_builtin_names_and_aliases() {
    let builtins = [
        builtin("model", vec![]),
        builtin("subagents", vec!["agents".to_string()]),
    ];
    let users = [user("model"), user("agents")];
    let commands = command_catalog(&builtins, &users);

    let model = entry(&commands, "model");
    assert_eq!(model.shadowed_by.as_deref(), Some("model"));

    // The shadowing user command is served as a prompt-bound row.
    let user_model = commands
        .iter()
        .find(|command| command.name == "model" && command.kind == "user")
        .expect("user command row");
    assert_eq!(user_model.binding, "prompt");

    // A user command colliding with a builtin's alias shadows that spelling:
    // `agents` is a `subagents` alias, so the builtin reports it while keeping
    // its canonical name.
    let subagents = entry(&commands, "subagents");
    assert_eq!(subagents.kind, "builtin");
    assert_eq!(subagents.shadowed_by, None);
    assert!(
        subagents.shadowed_aliases.iter().any(|a| a == "agents"),
        "shadowed_aliases must report the taken spelling: {:?}",
        subagents.shadowed_aliases
    );
}

#[tokio::test]
async fn get_v1_commands_serves_the_catalog_over_http() -> Result<()> {
    let _env = lock_test_env();
    let temp = tempfile::tempdir()?;
    let root = temp.path().join("commands-route");
    let sessions_dir = root.join("sessions");
    let workspace = root.join("workspace");
    fs::create_dir_all(&workspace)?;
    let _catalog =
        crate::command_catalog::CatalogGuard::install(Arc::new(Catalog(workspace.clone())));

    let Some((addr, _runtime_threads, handle)) =
        spawn_test_server_with_root_token_mobile_workspace(
            root,
            sessions_dir,
            None,
            false,
            workspace,
        )
        .await?
    else {
        return Ok(());
    };
    let client = crate::tls::reqwest_client();

    let body: serde_json::Value = client
        .get(format!("http://{addr}/v1/commands"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let commands = body["commands"].as_array().expect("commands array");
    assert!(
        commands
            .iter()
            .any(|command| command["kind"] == "builtin" && command["binding"] == "host"),
        "the route must serve builtins: {commands:?}"
    );

    // The workspace user command named `model` shadows the builtin: the
    // builtin reports the shadow and the winning definition is served.
    let builtin_model = commands
        .iter()
        .find(|command| command["name"] == "model" && command["kind"] == "builtin")
        .expect("builtin model row");
    assert_eq!(builtin_model["shadowed_by"], "model");
    let user_model = commands
        .iter()
        .find(|command| command["name"] == "model" && command["kind"] == "user")
        .expect("user model row");
    assert_eq!(user_model["binding"], "prompt");
    // A template without `$ARGUMENTS` runs bare from the palette.
    assert_eq!(user_model["requires_required_argument"], false);
    assert_eq!(user_model["palette_runs_directly"], true);
    assert_eq!(user_model["show_in_empty_discovery"], true);

    let profile = commands
        .iter()
        .find(|command| command["name"] == "profile" && command["kind"] == "builtin")
        .expect("builtin profile row");
    assert_eq!(profile["requires_required_argument"], true);
    assert_eq!(profile["palette_runs_directly"], false);

    handle.abort();
    Ok(())
}

/// B4: `GET /v1/hooks` serves the hook set Runtime threads run, from the
/// engine's own loader, with credential-shaped values masked.
#[tokio::test]
async fn get_v1_hooks_serves_the_runtime_hook_set() -> Result<()> {
    let _env = lock_test_env();
    let temp = tempfile::tempdir()?;
    let root = temp.path().join("hooks-route");
    let sessions_dir = root.join("sessions");
    let workspace = root.join("workspace");
    fs::create_dir_all(&workspace)?;
    let config = Config {
        hooks: Some(crate::hooks::HooksConfig {
        hooks: vec![
            crate::hooks::Hook::new(
                crate::hooks::HookEvent::ToolCallAfter,
                "curl -H 'Authorization: Bearer sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789' https://example.invalid",
            )
            .with_name("notify"),
        ],
        enabled: true,
        ..crate::hooks::HooksConfig::default()
    }),
        ..Config::default()
    };

    let Some((addr, _runtime_threads, handle)) =
        spawn_test_server_with_root_token_mobile_workspace_and_overrides(
            root,
            sessions_dir,
            None,
            false,
            workspace,
            TestServerOverrides {
                config: Some(config),
                ..TestServerOverrides::default()
            },
        )
        .await?
    else {
        return Ok(());
    };
    let client = crate::tls::reqwest_client();
    let body: serde_json::Value = client
        .get(format!("http://{addr}/v1/hooks"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(body["enabled"], true);
    let hooks = body["hooks"].as_array().expect("hooks array");
    assert_eq!(hooks.len(), 1, "{body}");
    assert_eq!(hooks[0]["name"], "notify");
    assert_eq!(hooks[0]["event"], "tool_call_after");
    assert_eq!(hooks[0]["source"], "global");
    let command = hooks[0]["command"].as_str().expect("command");
    assert!(command.starts_with("curl"), "{command}");
    assert!(!command.contains("sk-ant-api03-AbCd"), "{command}");

    let missing = client
        .get(format!("http://{addr}/v1/hooks?thread_id=thr_missing"))
        .send()
        .await?;
    assert_eq!(missing.status(), reqwest::StatusCode::NOT_FOUND);
    handle.abort();
    Ok(())
}

#[test]
fn hook_listing_masks_url_paths_and_userinfo() {
    assert_eq!(
        redact_hook_command_for_listing(
            "curl -X POST https://hooks.slack.com/services/T000/B000/XXXXsecret -d @-"
        ),
        "curl -X POST https://hooks.slack.com/[redacted] -d @-"
    );
    assert_eq!(
        redact_hook_command_for_listing("notify 'https://user:pw@example.test/hook?k=v'"),
        "notify 'https://example.test/[redacted]'"
    );
    assert_eq!(
        redact_hook_command_for_listing("ping https://example.test"),
        "ping https://example.test"
    );
    assert_eq!(
        redact_hook_command_for_listing("./scripts/lint.sh --fix"),
        "./scripts/lint.sh --fix"
    );
}
