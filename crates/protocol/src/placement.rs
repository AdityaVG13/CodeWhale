use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EnvironmentKind {
    Local,
    Remote,
    Cloud,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EnvironmentResources {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cpu_cores: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory_mib: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gpus: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExecutionEnvironment {
    pub id: String,
    pub kind: EnvironmentKind,
    #[serde(default)]
    pub resources: EnvironmentResources,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub data: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persistent: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_per_hour_microusd: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PlacementRequirements {
    #[serde(default)]
    pub environments: Vec<String>,
    #[serde(default)]
    pub kinds: Vec<EnvironmentKind>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub data: Vec<String>,
    #[serde(default)]
    pub resources: EnvironmentResources,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persistent: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_cost_per_hour_microusd: Option<u64>,
    #[serde(default)]
    pub prefer: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlacementRefusalCode {
    EnvironmentNotAllowed,
    KindNotAllowed,
    MissingCapability,
    MissingData,
    InsufficientResources,
    PersistenceMismatch,
    CostUnknown,
    CostLimit,
    WorkerBusy,
    UnsupportedHost,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlacementRefusal {
    pub code: PlacementRefusalCode,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlacementCandidate {
    pub worker_id: String,
    pub environment: ExecutionEnvironment,
    pub eligible: bool,
    pub refusals: Vec<PlacementRefusal>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlacementDecision {
    pub task_id: String,
    pub worker_id: Option<String>,
    pub environment_id: Option<String>,
    pub reason: String,
    pub candidates: Vec<PlacementCandidate>,
}
