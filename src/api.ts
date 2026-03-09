import type {
  Agent,
  ClusterNode,
  ControlPlaneSource,
  EventItem,
  Gateway,
  Metric,
  Task,
} from "./types";

export interface OverviewResponse {
  source: ControlPlaneSource;
  updatedAt: string;
  metrics: Metric[];
  gateways: Gateway[];
  nodes: ClusterNode[];
  agents: Agent[];
  tasks: Task[];
  events: EventItem[];
}

export interface TickResponse {
  type: "control-plane.tick";
  payload: {
    source: ControlPlaneSource;
    updatedAt: string;
    metrics: Metric[];
    tasks: Task[];
    nodes: ClusterNode[];
    events: EventItem[];
  };
}

export interface AgentCommandEvent {
  type: "agent.command.started" | "agent.command.progress" | "agent.command.completed" | "agent.command.failed";
  payload: {
    agentId: string;
    ts: string;
    message?: string;
    error?: string;
    toolCalls?: AgentToolCall[];
    context?: AgentContextResponse;
  };
}

export interface ControlPlaneLogEvent {
  type: "control-plane.log";
  payload: EventItem;
}

export type RealtimeControlPlaneEvent = AgentCommandEvent | ControlPlaneLogEvent;

export interface AgentCommandResponse {
  ok: boolean;
  mode: "real" | "mock";
  agentId: string;
  reply?: string;
  raw?: unknown;
  error?: string;
}

export interface AgentCommandAttachment {
  name: string;
  type: string;
  size: number;
  sourcePath?: string;
  binaryBase64?: string;
  content?: string;
  contentMode: "inline_text" | "stored_file" | "metadata_only";
}

export interface MessageAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  contentMode: "inline_text" | "stored_file" | "metadata_only";
  previewKind: "image" | "text" | "pdf" | "audio" | "video" | "file";
  previewUrl?: string;
  downloadUrl?: string;
  textExcerpt?: string;
  storedPath?: string;
}

export interface ChatHistoryMessage {
  id: string;
  side: "user" | "agent";
  text: string;
  ts: string;
  attachments?: MessageAttachment[];
}

export interface AgentToolCall {
  id: string;
  name: string;
  status: string;
  summary: string;
  ts: string;
}

export interface AgentContextResponse {
  ok: boolean;
  agentId: string;
  updatedAt: string | null;
  messages: ChatHistoryMessage[];
  toolCalls: AgentToolCall[];
}

export interface OpenClawBootstrapCheck {
  name: string;
  ok: boolean;
  path: string;
  version: string;
}

export interface OpenClawBootstrapStatus {
  ok: boolean;
  checks: OpenClawBootstrapCheck[];
  workspaceDir: string;
  workspaceReady: boolean;
  configPath: string;
  configReady: boolean;
  error?: string;
}

export interface OpenClawBootstrapRunResponse {
  ok: boolean;
  logs?: string[];
  status?: OpenClawBootstrapStatus;
  error?: string;
}

export async function fetchOverview(): Promise<OverviewResponse> {
  const response = await fetch("/api/overview");
  if (!response.ok) {
    throw new Error(`overview_request_failed:${response.status}`);
  }

  return response.json();
}

export function connectControlPlane(
  onBootstrap: (overview: OverviewResponse) => void,
  onTick: (tick: TickResponse["payload"]) => void,
  onEvent?: (event: RealtimeControlPlaneEvent) => void,
) {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data) as
      | { type: "control-plane.bootstrap"; payload: OverviewResponse }
      | TickResponse
      | RealtimeControlPlaneEvent;

    if (message.type === "control-plane.bootstrap") {
      onBootstrap(message.payload);
      return;
    }

    if (message.type === "control-plane.tick") {
      onTick(message.payload);
      return;
    }

    if (message.type === "control-plane.log" || message.type.startsWith("agent.command.")) {
      onEvent?.(message);
    }
  });

  return socket;
}

export async function sendAgentCommand(
  agentId: string,
  message: string,
  attachments: AgentCommandAttachment[] = [],
): Promise<AgentCommandResponse> {
  const response = await fetch("/api/agent-command", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ agentId, message, attachments }),
  });

  return response.json();
}

export async function fetchChatHistory(agentId: string): Promise<ChatHistoryMessage[]> {
  const response = await fetch(`/api/chat-history/${encodeURIComponent(agentId)}`);
  if (!response.ok) {
    throw new Error(`chat_history_request_failed:${response.status}`);
  }

  const payload = (await response.json()) as { messages?: ChatHistoryMessage[] };
  return payload.messages ?? [];
}

export async function fetchAgentContext(agentId: string): Promise<AgentContextResponse> {
  const response = await fetch(`/api/agent-context/${encodeURIComponent(agentId)}`);
  if (!response.ok) {
    throw new Error(`agent_context_request_failed:${response.status}`);
  }

  return response.json();
}

export async function fetchOpenClawBootstrap(): Promise<OpenClawBootstrapStatus> {
  const response = await fetch("/api/openclaw/bootstrap");
  return response.json();
}

export async function runOpenClawBootstrap(): Promise<OpenClawBootstrapRunResponse> {
  const response = await fetch("/api/openclaw/bootstrap", {
    method: "POST",
  });
  return response.json();
}
