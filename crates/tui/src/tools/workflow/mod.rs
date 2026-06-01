//! WhaleFlow TUI integration — AgentSpawner implementation and tool registration.
//!
//! Implements [`codewhale_whaleflow::AgentSpawner`] using CodeWhale's existing
//! [`SubAgentManager`](crate::tools::subagent::SubAgentManager) /
//! [`SubAgentRuntime`](crate::tools::subagent::SubAgentRuntime) infrastructure,
//! enabling whaleFlow's declarative scheduler to fan out sub-agents with
//! optional git-worktree isolation.

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use codewhale_whaleflow::{AgentResult, AgentSpawner, SpawnError, WorktreeManager};
use serde_json::Value;

use crate::tools::spec::{ToolCapability, ToolContext, ToolError, ToolResult, ToolSpec};
use crate::tools::subagent::{
    SharedSubAgentManager, SubAgentRuntime, SubAgentStatus, SubAgentType,
};

/// Implements [`AgentSpawner`] using CodeWhale's `SubAgentManager`.
///
/// Each call to [`spawn`](AgentSpawner::spawn) fans out a background sub-agent
/// via [`SubAgentManager::spawn_background`], then polls
/// [`SubAgentManager::get_result`] until the agent reaches a terminal state.
/// When a `cwd` is supplied (worktree isolation), the worktree is created
/// before spawn, and its changes are extracted and applied back to the
/// main workspace on success.
pub struct WhaleFlowSpawner {
    manager: SharedSubAgentManager,
    runtime: SubAgentRuntime,
    workspace: PathBuf,
}

impl WhaleFlowSpawner {
    /// Create a new spawner.
    ///
    /// The `runtime` is used as the template for each child sub-agent; the
    /// child runtime is derived via [`SubAgentRuntime::background_runtime`]
    /// so children are detached from the parent turn's cancellation token.
    #[must_use]
    pub fn new(
        manager: SharedSubAgentManager,
        runtime: SubAgentRuntime,
        workspace: PathBuf,
    ) -> Self {
        Self {
            manager,
            runtime,
            workspace,
        }
    }
}

#[async_trait]
impl AgentSpawner for WhaleFlowSpawner {
    async fn spawn(
        &self,
        task_id: String,
        prompt: String,
        agent_type: Option<String>,
        cwd: Option<PathBuf>,
    ) -> Result<AgentResult, SpawnError> {
        // For worktree isolation: create the worktree if cwd is set
        // (the scheduler pre-computes the path based on isolation mode).
        // `WorktreeManager::create` is idempotent — no-op if the worktree
        // already exists (e.g. reused across parallel phases).
        let actual_cwd = if cwd.is_some() {
            let worktree_path = WorktreeManager::create(&task_id, &self.workspace)?;
            Some(worktree_path)
        } else {
            None
        };

        // Determine agent type. Default to General (full tool access).
        let subagent_type = agent_type
            .as_deref()
            .and_then(SubAgentType::from_str)
            .unwrap_or_default();

        // Derive a detached child runtime so the sub-agent outlives the
        // scheduler's turn token.
        let mut child_runtime = self.runtime.background_runtime();
        if let Some(ref cwd_path) = actual_cwd {
            child_runtime.context.workspace = cwd_path.clone();
        }

        // Spawn via the shared sub-agent manager.
        let spawn_result = {
            let mut mgr = self.manager.write().await;
            mgr.spawn_background(
                Arc::clone(&self.manager),
                child_runtime,
                subagent_type,
                prompt,
                None, // full tool access — same as a top-level sub-agent
            )
            .map_err(|e| SpawnError::SpawnFailed(format!("{e}")))?
        };

        let agent_id = spawn_result.agent_id.clone();

        tracing::debug!(
            agent_id = %agent_id,
            task_id = %task_id,
            "WhaleFlow spawned sub-agent"
        );

        // Poll for completion. The sub-agent manager updates the snapshot
        // in-place when the background task finishes.
        loop {
            let snapshot = {
                let mgr = self.manager.read().await;
                mgr.get_result(&agent_id)
                    .map_err(|e| SpawnError::Internal(format!("{e}")))?
            };

            match snapshot.status {
                SubAgentStatus::Running => {
                    // Still running — back off before next poll.
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                }
                SubAgentStatus::Completed => {
                    let summary = snapshot.result.clone().unwrap_or_default();
                    let elapsed_ms = Some(snapshot.duration_ms);

                    // Clean up worktree if we created one: extract the
                    // diff patch, apply it to the main workspace, then
                    // remove the worktree. Best-effort — we already have
                    // the agent result, so worktree cleanup failures are
                    // logged but don't fail the task.
                    if cwd.is_some() {
                        if let Ok(patch) =
                            WorktreeManager::extract_changes(&task_id, &self.workspace)
                        {
                            if !patch.trim().is_empty() {
                                if let Err(e) =
                                    WorktreeManager::apply_patch(&self.workspace, &patch)
                                {
                                    tracing::warn!(
                                        task_id = %task_id,
                                        error = %e,
                                        "Failed to apply worktree patch"
                                    );
                                }
                            }
                        }
                        if let Err(e) = WorktreeManager::remove(&task_id, &self.workspace) {
                            tracing::warn!(
                                task_id = %task_id,
                                error = %e,
                                "Failed to remove worktree"
                            );
                        }
                    }

                    return Ok(AgentResult {
                        task_id,
                        success: true,
                        summary,
                        files_touched: Vec::new(),
                        raw_output: snapshot.result,
                        tokens_used: None,
                        cost_usd: None,
                        elapsed_ms,
                        last_checkpoint: None,
                    });
                }
                SubAgentStatus::Failed(err) | SubAgentStatus::Interrupted(err) => {
                    let _ = WorktreeManager::remove(&task_id, &self.workspace);
                    return Err(SpawnError::SpawnFailed(err));
                }
                SubAgentStatus::Cancelled => {
                    let _ = WorktreeManager::remove(&task_id, &self.workspace);
                    return Err(SpawnError::Cancelled(
                        "agent cancelled".to_string(),
                    ));
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// workflow_run tool
// ---------------------------------------------------------------------------

/// The `workflow_run` tool — exposed to DeepSeek so it can orchestrate
/// multi-agent workflows via WhaleFlow's declarative scheduler.
pub struct WorkflowRunTool {
    spawner: Arc<WhaleFlowSpawner>,
}

impl WorkflowRunTool {
    /// Create a new `workflow_run` tool backed by the given spawner.
    #[must_use]
    pub fn new(spawner: Arc<WhaleFlowSpawner>) -> Self {
        Self { spawner }
    }
}

#[async_trait]
impl ToolSpec for WorkflowRunTool {
    fn name(&self) -> &'static str {
        "workflow_run"
    }

    fn description(&self) -> &'static str {
        concat!(
            "Run a declarative multi-agent workflow. Provide a JSON config with a goal and phases, ",
            "each containing tasks with prompts, dependencies, and optional isolation. ",
            "The scheduler will fan out sub-agents, pipe results between dependent tasks, ",
            "and return a structured result summarizing every agent's output."
        )
    }

    fn input_schema(&self) -> Value {
        serde_json::from_str(codewhale_whaleflow::tool::WORKFLOW_RUN_SCHEMA)
            .unwrap_or_else(|_| serde_json::json!({}))
    }

    fn capabilities(&self) -> Vec<ToolCapability> {
        vec![ToolCapability::ReadOnly]
    }

    fn supports_parallel(&self) -> bool {
        false
    }

    async fn execute(
        &self,
        input: Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        // Extract the `config` sub-object and serialize it as the
        // WorkflowConfig JSON that the whaleflow scheduler expects.
        let config = input
            .get("config")
            .cloned()
            .ok_or_else(|| ToolError::missing_field("config"))?;

        let config_json =
            serde_json::to_string(&config).map_err(|e| {
                ToolError::invalid_input(format!("failed to serialize config: {e}"))
            })?;

        let spawner: Arc<dyn AgentSpawner> = self.spawner.clone();

        match codewhale_whaleflow::tool::execute_workflow(&config_json, spawner).await {
            Ok(result_json) => Ok(ToolResult::success(result_json)),
            Err(err) => Ok(ToolResult::error(err)),
        }
    }
}
