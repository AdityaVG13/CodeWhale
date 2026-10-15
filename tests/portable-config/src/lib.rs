//! Normal-library proof of the complete actual config command group.
//!
//! Mounts the real group root (`mod.rs`) — not its children separately — so the
//! whole group, including its 19-command portable inventory, compiles as an
//! independent library with no TUI dependency.
#[path = "../../../crates/tui/src/commands/groups/config/mod.rs"]
pub mod config_group;
