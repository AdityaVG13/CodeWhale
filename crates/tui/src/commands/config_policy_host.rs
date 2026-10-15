//! Host registration/action conversion for the portable policy inventory.
use super::CommandResult;
use super::groups::config::policy::portable_handlers;
use crate::tui::app::App;
use codewhale_command_contract::handler::CommandHandler;
use codewhale_command_contract::metadata::{CommandInfo, RegisterCommand};
use codewhale_command_contract::outcome::ConfigPolicyCommandResult;

struct Registration<const INDEX: usize>;
impl<const INDEX: usize> RegisterCommand<CommandResult> for Registration<INDEX> {
    fn info() -> &'static CommandInfo {
        portable_handlers()[INDEX].0
    }
    fn handler() -> CommandHandler<CommandResult> {
        match portable_handlers()[INDEX].1 {
            CommandHandler::Contextual { capabilities, .. } => CommandHandler::Contextual {
                capabilities,
                handler: |contexts, args| match portable_handlers()[INDEX].1 {
                    CommandHandler::Contextual { handler, .. } => {
                        host_result(handler(contexts, args))
                    }
                    _ => CommandResult::error("policy command handler shape changed"),
                },
            },
            _ => CommandHandler::Pure(|_| {
                CommandResult::error("policy command requires a contextual handler")
            }),
        }
    }
}
pub(super) fn permissions(app: &mut App, args: Option<&str>) -> CommandResult {
    execute::<0>(app, args)
}
#[cfg(test)]
pub(super) fn status(app: &mut App, args: Option<&str>) -> CommandResult {
    execute::<1>(app, args)
}
fn execute<const INDEX: usize>(app: &mut App, args: Option<&str>) -> CommandResult {
    match Registration::<INDEX>::handler() {
        CommandHandler::Contextual {
            capabilities,
            handler,
        } => handler(
            app.command_contexts_with_config(None)
                .contexts(capabilities),
            args,
        ),
        CommandHandler::Pure(handler) => handler(args),
    }
}
fn host_result(result: ConfigPolicyCommandResult) -> CommandResult {
    CommandResult {
        message: result.message,
        is_error: result.is_error,
        action: result
            .action
            .map(super::config_host::config_action_to_app_action),
    }
}
