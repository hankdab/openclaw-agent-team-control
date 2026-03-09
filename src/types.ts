export type TaskStatus =
  | "pending"
  | "dispatching"
  | "running"
  | "blocked"
  | "failed"
  | "completed";

export type HealthState = "healthy" | "warning" | "degraded";

export interface Metric {
  label: string;
  value: string;
  delta: string;
}

export type ControlPlaneSource = "real" | "mock";

export interface Gateway {
  id: string;
  name: string;
  region: string;
  health: HealthState;
  sessions: number;
  throughput: string;
}

export interface NodeAgentRef {
  id: string;
  role: string;
  status: "idle" | "busy" | "paused";
}

export interface ClusterNode {
  id: string;
  name: string;
  lane: string;
  region: string;
  health: HealthState;
  queueDepth: number;
  cpu: number;
  memory: number;
  capabilities: string[];
  agents: NodeAgentRef[];
}

export interface Agent {
  id: string;
  name: string;
  kind: "control" | "execution";
  parentId?: string;
  parentSource?: "actual" | "inferred" | "root";
  runtime: string;
  model: string;
  status: "idle" | "busy" | "paused";
  sandbox: string;
  activeTaskId?: string;
  nodeId: string;
  tools: string[];
  tokenRate: string;
  successRate: string;
  latencyP95: string;
  lastError?: string;
}

export interface TaskStep {
  id: string;
  label: string;
  owner: string;
  status: TaskStatus;
}

export interface Task {
  id: string;
  title: string;
  tenant: string;
  status: TaskStatus;
  priority: "P0" | "P1" | "P2";
  budget: string;
  createdAt: string;
  eta: string;
  agentId: string;
  nodeId: string;
  summary: string;
  steps: TaskStep[];
}

export interface EventItem {
  id: string;
  ts: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
}
