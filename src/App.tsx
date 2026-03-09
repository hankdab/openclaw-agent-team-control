import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Activity,
  ArrowDownToLine,
  Bot,
  ChevronDown,
  ChevronUp,
  Clock3,
  Cpu,
  Database,
  ExternalLink,
  File as FileIcon,
  FileCode2,
  FileImage,
  FileText,
  Home,
  History,
  Image as ImageIcon,
  Music4,
  Paperclip,
  Radar,
  Search,
  Send,
  Shield,
  Sparkles,
  TimerReset,
  UserRound,
  Video,
  Waypoints,
} from "lucide-react";
import ReactFlow, { Background, MarkerType, MiniMap, Position, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import {
  connectControlPlane,
  fetchAgentContext,
  fetchChatHistory,
  fetchOpenClawBootstrap,
  fetchOverview,
  runOpenClawBootstrap,
  sendAgentCommand,
  type AgentCommandAttachment,
  type AgentContextResponse,
  type ChatHistoryMessage,
  type ControlPlaneLogEvent,
  type MessageAttachment,
  type OpenClawBootstrapStatus,
  type OverviewResponse,
} from "./api";
import type { Agent, TaskStatus } from "./types";

const statusClass: Record<TaskStatus, string> = {
  pending: "is-pending",
  dispatching: "is-dispatching",
  running: "is-running",
  blocked: "is-blocked",
  failed: "is-failed",
  completed: "is-completed",
};

const metricLabelMap: Record<string, string> = {
  "Daily Tokens": "今日 Token",
  "Active Tasks": "运行任务",
  "Healthy Nodes": "健康节点",
  "Agent Throughput": "Agent 吞吐",
  "Cost Burn": "今日费用",
};

const taskStatusLabelMap: Record<TaskStatus, string> = {
  pending: "待开始",
  dispatching: "分派中",
  running: "运行中",
  blocked: "阻塞",
  failed: "失败",
  completed: "完成",
};

const agentStatusLabelMap: Record<string, string> = {
  idle: "空闲",
  busy: "忙碌",
  paused: "暂停",
};

const healthLabelMap: Record<string, string> = {
  healthy: "正常",
  warning: "离线",
  degraded: "异常",
};

const parentSourceLabelMap: Record<string, string> = {
  root: "直接入口",
  inferred: "推断父级",
  actual: "真实链路",
};

type ViewMode = "home" | "swarm";

type ChatMessage = ChatHistoryMessage;
type SelectedAttachment = AgentCommandAttachment & { id: string };
const MAX_INLINE_ATTACHMENT_BYTES = 120_000;
const MAX_BINARY_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const textLikeExtensions = [".md", ".txt", ".json", ".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".py", ".yaml", ".yml", ".csv"];

function shortenMiddle(value: string, keep = 10) {
  if (value.length <= keep * 2 + 3) {
    return value;
  }

  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
}

function formatTime(input?: string) {
  return input
    ? new Date(input).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "--";
}

function formatLooseTime(input?: string) {
  if (!input) {
    return "--";
  }

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(input)) {
    return input;
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return input;
  }

  return formatTime(parsed.toISOString());
}

function formatClock(input: number, timeZone: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  }).format(input);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 102.4) / 10} KB`;
  }

  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

function localAttachmentToCard(attachment: SelectedAttachment): MessageAttachment {
  const objectUrl =
    attachment.contentMode === "stored_file" && attachment.binaryBase64
      ? `data:${attachment.type || "application/octet-stream"};base64,${attachment.binaryBase64}`
      : undefined;

  let previewKind: MessageAttachment["previewKind"] = "file";
  const lowerName = attachment.name.toLowerCase();
  if ((attachment.type || "").startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/.test(lowerName)) {
    previewKind = "image";
  } else if (attachment.contentMode === "inline_text" || (attachment.type || "").startsWith("text/")) {
    previewKind = "text";
  } else if (attachment.type === "application/pdf" || lowerName.endsWith(".pdf")) {
    previewKind = "pdf";
  } else if ((attachment.type || "").startsWith("audio/")) {
    previewKind = "audio";
  } else if ((attachment.type || "").startsWith("video/")) {
    previewKind = "video";
  }

  return {
    id: attachment.id,
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    contentMode: attachment.contentMode,
    previewKind,
    previewUrl: objectUrl,
    downloadUrl: objectUrl,
    textExcerpt: attachment.contentMode === "inline_text" ? attachment.content?.slice(0, 180) : "",
    storedPath: attachment.sourcePath,
  };
}

function attachmentIcon(attachment: MessageAttachment) {
  if (attachment.previewKind === "image") {
    return attachment.previewUrl ? <ImageIcon size={16} /> : <FileImage size={16} />;
  }
  if (attachment.previewKind === "text") {
    return /\.(ts|tsx|js|jsx|py|css|html|json|ya?ml)$/i.test(attachment.name) ? <FileCode2 size={16} /> : <FileText size={16} />;
  }
  if (attachment.previewKind === "audio") {
    return <Music4 size={16} />;
  }
  if (attachment.previewKind === "video") {
    return <Video size={16} />;
  }
  return <FileIcon size={16} />;
}

function isInlineTextCandidate(file: File) {
  const lowerName = file.name.toLowerCase();
  return file.type.startsWith("text/") || textLikeExtensions.some((extension) => lowerName.endsWith(extension));
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("file_read_failed"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

async function toSelectedAttachment(file: File): Promise<SelectedAttachment> {
  const inline = isInlineTextCandidate(file) && file.size <= MAX_INLINE_ATTACHMENT_BYTES;
  const sourcePath = "path" in file && typeof (file as File & { path?: string }).path === "string"
    ? (file as File & { path?: string }).path
    : "";
  const canStoreBinary = !inline && file.size > 0 && file.size <= MAX_BINARY_ATTACHMENT_BYTES;
  let binaryBase64 = "";

  if (canStoreBinary && !sourcePath) {
    const dataUrl = await readFileAsDataUrl(file);
    binaryBase64 = dataUrl.split(",", 2)[1] ?? "";
  }

  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    type: file.type || "unknown",
    size: file.size,
    sourcePath,
    binaryBase64,
    content: inline ? (await file.text()).slice(0, 12000) : "",
    contentMode: inline ? "inline_text" : sourcePath || binaryBase64 ? "stored_file" : "metadata_only",
  };
}

const timeZoneOptions = [
  "Asia/Shanghai",
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
];

function App() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("home");
  const [commandAgentId, setCommandAgentId] = useState<string>("");
  const [commandText, setCommandText] = useState<string>("");
  const [commandPending, setCommandPending] = useState(false);
  const [chatByAgent, setChatByAgent] = useState<Record<string, ChatMessage[]>>({});
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [selectedAttachments, setSelectedAttachments] = useState<SelectedAttachment[]>([]);
  const [agentContextById, setAgentContextById] = useState<Record<string, AgentContextResponse>>({});
  const [collapsedAgentIds, setCollapsedAgentIds] = useState<Record<string, boolean>>({});
  const [unreadByAgentId, setUnreadByAgentId] = useState<Record<string, number>>({});
  const [agentFilterText, setAgentFilterText] = useState("");
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [selectedTimeZone, setSelectedTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai");
  const [timeMenuOpen, setTimeMenuOpen] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [deployPanelOpen, setDeployPanelOpen] = useState(false);
  const [bootstrapStatus, setBootstrapStatus] = useState<OpenClawBootstrapStatus | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [bootstrapRunning, setBootstrapRunning] = useState(false);
  const [bootstrapLogs, setBootstrapLogs] = useState<string[]>([]);
  const [bootstrapError, setBootstrapError] = useState("");
  const chatConversationRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const commandAgentIdRef = useRef("");
  const chatByAgentRef = useRef<Record<string, ChatMessage[]>>({});

  useEffect(() => {
    commandAgentIdRef.current = commandAgentId;
  }, [commandAgentId]);

  useEffect(() => {
    chatByAgentRef.current = chatByAgent;
  }, [chatByAgent]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;

    fetchOverview()
      .then((payload) => {
        if (!alive) {
          return;
        }

        setOverview(payload);
        setSelectedTaskId(payload.tasks[0]?.id ?? "");
        setCommandAgentId(payload.agents[0]?.id ?? "");
      })
      .catch((requestError: Error) => {
        if (alive) {
          setError(requestError.message);
        }
      });

    const socket = connectControlPlane(
      (payload) => {
        if (!alive) {
          return;
        }

        setOverview(payload);
        setSelectedTaskId((current) => current || payload.tasks[0]?.id || "");
        setCommandAgentId((current) => current || payload.agents[0]?.id || "");
      },
      (tick) => {
        if (!alive) {
          return;
        }

        setOverview((current) =>
          current
            ? {
                ...current,
                source: tick.source,
                updatedAt: tick.updatedAt,
                metrics: tick.metrics,
                tasks: tick.tasks,
                nodes: tick.nodes,
                events: tick.events,
              }
            : current,
        );
      },
      (event) => {
        if (!alive) {
          return;
        }

        if (event.type === "control-plane.log") {
          const logEvent = event as ControlPlaneLogEvent;
          setOverview((current) =>
            current
              ? {
                  ...current,
                  events: [logEvent.payload, ...current.events.filter((item) => item.id !== logEvent.payload.id)].slice(0, 12),
                }
              : current,
          );
          return;
        }

        setAgentContextById((current) => {
          if (event.type === "agent.command.started") {
            const existing = current[event.payload.agentId] ?? {
              ok: true,
              agentId: event.payload.agentId,
              updatedAt: event.payload.ts,
              messages: chatByAgentRef.current[event.payload.agentId] ?? [],
              toolCalls: [],
            };

            return {
              ...current,
              [event.payload.agentId]: {
                ...existing,
                updatedAt: event.payload.ts,
                toolCalls: [...(event.payload.toolCalls ?? []), ...existing.toolCalls.filter((tool) => tool.status !== "running")].slice(0, 12),
              },
            };
          }

          if (event.type === "agent.command.progress") {
            const existing = current[event.payload.agentId] ?? {
              ok: true,
              agentId: event.payload.agentId,
              updatedAt: event.payload.ts,
              messages: chatByAgentRef.current[event.payload.agentId] ?? [],
              toolCalls: [],
            };

            return {
              ...current,
              [event.payload.agentId]: {
                ...existing,
                updatedAt: event.payload.ts,
                toolCalls: [...(event.payload.toolCalls ?? []), ...existing.toolCalls.filter((tool) => !String(tool.id).startsWith("planned-"))].slice(0, 12),
              },
            };
          }

          if (event.payload.context) {
            return {
              ...current,
              [event.payload.agentId]: event.payload.context,
            };
          }

          return current;
        });

        if (event.payload.context?.messages) {
          setChatByAgent((current) => ({
            ...current,
            [event.payload.agentId]: event.payload.context?.messages ?? current[event.payload.agentId] ?? [],
          }));
        }

        if (event.payload.agentId !== commandAgentIdRef.current && event.type !== "agent.command.progress") {
          setUnreadByAgentId((current) => ({
            ...current,
            [event.payload.agentId]: Math.min((current[event.payload.agentId] ?? 0) + 1, 99),
          }));
        }
      },
    );

    socket.addEventListener("error", () => {
      if (alive) {
        setError("websocket_connection_failed");
      }
    });

    return () => {
      alive = false;
      socket.close();
    };
  }, []);

  const metrics = overview?.metrics ?? [];
  const gateways = overview?.gateways ?? [];
  const nodes = overview?.nodes ?? [];
  const agents = overview?.agents ?? [];
  const tasks = overview?.tasks ?? [];
  const liveEvents = overview?.events ?? [];
  const sourceLabel = overview?.source === "real" ? "真实 OpenClaw" : "模拟数据";
  const sourceHint =
    overview?.source === "real"
      ? "当前展示的是这台 Mac 上的真实 OpenClaw 状态"
      : "当前展示的是模拟数据，本机 Gateway 暂时未连通";
  const updatedLabel = formatTime(overview?.updatedAt);
  const currentClock = formatClock(clockNow, selectedTimeZone);
  const timeZoneLabel = selectedTimeZone.split("/").pop()?.split("_").join(" ") ?? selectedTimeZone;

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? tasks[0],
    [selectedTaskId, tasks],
  );
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === commandAgentId) ?? agents[0],
    [agents, commandAgentId],
  );
  const modelOptions = useMemo(
    () =>
      Array.from(new Set(agents.map((agent) => agent.model)))
        .filter(Boolean)
        .map((model) => ({
          model,
          agentId: agents.find((agent) => agent.model === model)?.id ?? "",
        })),
    [agents],
  );

  const dailyTokenMetric = metrics.find((metric) => metric.label === "Daily Tokens");
  const activeTaskMetric = metrics.find((metric) => metric.label === "Active Tasks");
  const costMetric = metrics.find((metric) => metric.label === "Cost Burn");
  const chatMessages = chatByAgent[commandAgentId] ?? [];
  const selectedAgentContext = agentContextById[commandAgentId];
  const selectedContextMessages = (selectedAgentContext?.messages ?? chatMessages).slice(-6);
  const selectedToolCalls = (selectedAgentContext?.toolCalls ?? []).slice(-8).reverse();
  const normalizedAgentFilter = agentFilterText.trim().toLowerCase();
  const runningTasks = tasks.filter((task) => task.status === "running" || task.status === "dispatching");
  const runningToolCalls = Object.values(agentContextById)
    .flatMap((context) => context.toolCalls ?? [])
    .filter((toolCall) => toolCall.status === "running" || toolCall.status === "pending")
    .slice(0, 3);
  const collaborationSummary = useMemo(() => {
    if (runningToolCalls.length > 0) {
      const firstTool = runningToolCalls[0];
      return `当前有 ${runningToolCalls.length} 个工具阶段在推进，最近动作：${firstTool.name}`;
    }

    if (runningTasks.length > 0) {
      return `当前有 ${runningTasks.length} 个任务在运行，优先任务：${runningTasks[0]?.title ?? "未知任务"}`;
    }

    if (selectedAgent) {
      return `${selectedAgent.name} 当前${agentStatusLabelMap[selectedAgent.status] ?? "待命"}，可直接继续对话`;
    }

    return "当前没有活跃任务，可以直接发起新的协作命令";
  }, [runningTasks, runningToolCalls, selectedAgent]);

  const agentTreeRows = useMemo(() => {
    const byParent = new Map<string, Agent[]>();
    const roots: Agent[] = [];
    const fallbackRootId = agents.find((agent) => agent.kind === "control")?.id;

    const activityScore = (agent: Agent) => {
      const updatedAt = agentContextById[agent.id]?.updatedAt ? new Date(agentContextById[agent.id].updatedAt ?? 0).getTime() : 0;
      const unread = unreadByAgentId[agent.id] ?? 0;
      const linkedTask = tasks.find((task) => task.agentId === agent.id && task.status === "running") ? 1 : 0;
      const busy = agent.status === "busy" ? 1 : 0;
      return updatedAt + unread * 1_000_000_000 + linkedTask * 500_000_000 + busy * 250_000_000;
    };

    const includeAgent = (agent: Agent) => {
      const isActive =
        agent.status === "busy" ||
        (unreadByAgentId[agent.id] ?? 0) > 0 ||
        tasks.some((task) => task.agentId === agent.id && (task.status === "running" || task.status === "dispatching")) ||
        (agentContextById[agent.id]?.toolCalls ?? []).some((toolCall) => toolCall.status === "running" || toolCall.status === "pending");

      const matchesFilter =
        !normalizedAgentFilter ||
        agent.name.toLowerCase().includes(normalizedAgentFilter) ||
        agent.model.toLowerCase().includes(normalizedAgentFilter) ||
        agent.runtime.toLowerCase().includes(normalizedAgentFilter);

      return matchesFilter && (!showActiveOnly || isActive);
    };

    for (const agent of agents) {
      if (!includeAgent(agent)) {
        continue;
      }

      const parentId =
        agent.parentId && agents.some((candidate) => candidate.id === agent.parentId)
          ? agent.parentId
          : agent.kind === "execution" && fallbackRootId && agent.id !== fallbackRootId
            ? fallbackRootId
            : undefined;

      if (!parentId) {
        roots.push(agent);
        continue;
      }

      const siblings = byParent.get(parentId) ?? [];
      siblings.push(agent);
      siblings.sort((left, right) => activityScore(right) - activityScore(left));
      byParent.set(parentId, siblings);
    }

    roots.sort((left, right) => activityScore(right) - activityScore(left));

    const rows: Array<{ agent: Agent; depth: number; hasChildren: boolean }> = [];
    const visit = (agent: Agent, depth: number) => {
      const children = byParent.get(agent.id) ?? [];
      rows.push({ agent, depth, hasChildren: children.length > 0 });
      if (collapsedAgentIds[agent.id]) {
        return;
      }

      for (const child of children) {
        visit(child, depth + 1);
      }
    };

    for (const root of roots) {
      visit(root, 0);
    }

    return rows;
  }, [agentContextById, agents, collapsedAgentIds, normalizedAgentFilter, showActiveOnly, tasks, unreadByAgentId]);

  function getAgentPreview(agentId: string) {
    const messages = agentContextById[agentId]?.messages ?? chatByAgent[agentId] ?? [];
    const lastMessage = messages[messages.length - 1];
    if (lastMessage) {
      return {
        text: shortenMiddle(lastMessage.text.replace(/\s+/g, " "), 18),
        ts: formatTime(lastMessage.ts),
      };
    }

    const linkedTask = tasks.find((task) => task.agentId === agentId);
    if (linkedTask) {
      return {
        text: linkedTask.summary,
        ts: formatLooseTime(linkedTask.createdAt),
      };
    }

    return {
      text: agentStatusLabelMap[agents.find((agent) => agent.id === agentId)?.status ?? ""] ?? "暂无消息",
      ts: "--",
    };
  }

  function getAgentTask(agentId: string) {
    return tasks.find((task) => task.agentId === agentId && (task.status === "running" || task.status === "dispatching")) ?? null;
  }

  function scrollChatToBottom(behavior: ScrollBehavior = "smooth") {
    const container = chatConversationRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
  }

  async function loadChatHistory(agentId: string, options?: { openPanel?: boolean }) {
    if (!agentId) {
      return;
    }

    setHistoryLoading(true);
    try {
      const history = await fetchChatHistory(agentId);
      setChatByAgent((current) => ({
        ...current,
        [agentId]: history,
      }));
      if (options?.openPanel) {
        setHistoryOpen(true);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "chat_history_request_failed");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadAgentContext(agentId: string) {
    if (!agentId) {
      return;
    }

    try {
      const context = await fetchAgentContext(agentId);
      setAgentContextById((current) => ({
        ...current,
        [agentId]: context,
      }));
      setChatByAgent((current) => ({
        ...current,
        [agentId]: context.messages ?? current[agentId] ?? [],
      }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "agent_context_request_failed");
    }
  }

  async function loadBootstrapStatus() {
    setBootstrapLoading(true);
    setBootstrapError("");
    try {
      const status = await fetchOpenClawBootstrap();
      setBootstrapStatus(status);
    } catch (requestError) {
      setBootstrapError(requestError instanceof Error ? requestError.message : "部署状态读取失败");
    } finally {
      setBootstrapLoading(false);
    }
  }

  async function handleBootstrapRun() {
    setBootstrapRunning(true);
    setBootstrapError("");
    setBootstrapLogs(["开始检测依赖并部署 OpenClaw..."]);
    try {
      const result = await runOpenClawBootstrap();
      if (!result.ok) {
        throw new Error(result.error || "部署失败");
      }
      setBootstrapLogs(result.logs ?? []);
      setBootstrapStatus(result.status ?? null);
    } catch (requestError) {
      setBootstrapError(requestError instanceof Error ? requestError.message : "部署失败");
    } finally {
      setBootstrapRunning(false);
    }
  }

  function handleConversationScroll() {
    const container = chatConversationRef.current;
    if (!container) {
      return;
    }

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isNearBottom = distanceToBottom < 48;
    shouldStickToBottomRef.current = isNearBottom;
    setShowScrollToBottom(!isNearBottom && chatMessages.length > 0);
  }

  function handleHistoryOpen() {
    void loadChatHistory(commandAgentId, { openPanel: true });
  }

  useEffect(() => {
    if (!commandAgentId) {
      return;
    }

    shouldStickToBottomRef.current = true;
    setShowScrollToBottom(false);
    setUnreadByAgentId((current) => {
      if (!current[commandAgentId]) {
        return current;
      }

      return {
        ...current,
        [commandAgentId]: 0,
      };
    });
    void loadChatHistory(commandAgentId);
    void loadAgentContext(commandAgentId);
  }, [commandAgentId]);

  useEffect(() => {
    if (!chatMessages.length) {
      setShowScrollToBottom(false);
      return;
    }

    if (shouldStickToBottomRef.current) {
      window.requestAnimationFrame(() => {
        scrollChatToBottom(chatMessages.length <= 1 ? "auto" : "smooth");
      });
      setShowScrollToBottom(false);
    }
  }, [chatMessages]);

  const topologyNodes: Node[] = [
    ...gateways.map((gateway, index) => ({
      id: gateway.id,
      position: { x: 80, y: 80 + index * 170 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: { width: 190, border: "none", background: "transparent" },
      data: {
        label: (
          <div className="flow-card flow-card-gateway">
            <span className={`pill ${gateway.health}`}>{healthLabelMap[gateway.health] ?? gateway.health}</span>
            <strong>{gateway.name}</strong>
            <span>{gateway.region}</span>
            <small>{gateway.sessions} 个会话</small>
          </div>
        ),
      },
      type: "default",
      draggable: false,
    })),
    ...nodes.map((node, index) => ({
      id: node.id,
      position: { x: 420, y: 50 + index * 170 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: { width: 190, border: "none", background: "transparent" },
      data: {
        label: (
          <div className="flow-card">
            <span className={`pill ${node.health}`}>{node.lane}</span>
            <strong>{node.name}</strong>
            <span>{node.region}</span>
            <small>队列 {node.queueDepth}</small>
          </div>
        ),
      },
      type: "default",
      draggable: false,
    })),
    ...agents.map((agent, index) => ({
      id: agent.id,
      position: { x: 760, y: 18 + index * 112 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: { width: 200, border: "none", background: "transparent" },
      data: {
        label: (
          <div className="flow-card flow-card-agent">
            <span className={`pill ${agent.status === "busy" ? "warning" : "healthy"}`}>
              {agentStatusLabelMap[agent.status] ?? agent.status}
            </span>
            <strong>{agent.name}</strong>
            <span>{agent.model}</span>
            <small>{agent.runtime}</small>
          </div>
        ),
      },
      type: "default",
      draggable: false,
    })),
  ];

  const topologyEdges: Edge[] = [
    ...nodes.flatMap((node, index) => {
      const gateway = gateways[index % Math.max(gateways.length, 1)];
      return gateway
        ? [
            {
              id: `${gateway.id}-${node.id}`,
              source: gateway.id,
              target: node.id,
              markerEnd: { type: MarkerType.ArrowClosed },
            },
          ]
        : [];
    }),
    ...agents.map((agent) => ({
      id: `${agent.nodeId}-${agent.id}`,
      source: agent.nodeId,
      target: agent.id,
      markerEnd: { type: MarkerType.ArrowClosed },
      animated: agent.status === "busy",
    })),
  ];

  async function handleCommandSubmit() {
    const text = commandText.trim();
    if (!commandAgentId || (!text && selectedAttachments.length === 0)) {
      return;
    }

    const ts = formatTime(new Date().toISOString());
    const localAttachmentCards = selectedAttachments.map(localAttachmentToCard);
    const outgoingMessage = text || "请查看附件";
    setCommandPending(true);
    setChatByAgent((current) => ({
      ...current,
      [commandAgentId]: [
        ...(current[commandAgentId] ?? []),
        {
          id: `u-${Date.now()}`,
          side: "user",
          text: outgoingMessage,
          ts,
          attachments: localAttachmentCards,
        },
      ],
    }));
    setCommandText("");
    setSelectedAttachments([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    try {
      const response = await sendAgentCommand(
        commandAgentId,
        outgoingMessage,
        selectedAttachments.map(({ id, ...attachment }) => attachment),
      );
      setChatByAgent((current) => ({
        ...current,
        [commandAgentId]: [
          ...(current[commandAgentId] ?? []),
          {
            id: `a-${Date.now()}`,
            side: "agent",
            text: response.reply || response.error || "没有返回内容",
            ts: formatTime(new Date().toISOString()),
          },
        ],
      }));
      void loadAgentContext(commandAgentId);
    } catch (requestError) {
      setChatByAgent((current) => ({
        ...current,
        [commandAgentId]: [
          ...(current[commandAgentId] ?? []),
          {
            id: `a-${Date.now()}`,
            side: "agent",
            text: requestError instanceof Error ? requestError.message : "发送失败",
            ts: formatTime(new Date().toISOString()),
          },
        ],
      }));
      void loadAgentContext(commandAgentId);
    } finally {
      setCommandPending(false);
    }
  }

  function handleModelSelect(agentId: string) {
    if (!agentId) {
      return;
    }

    setCommandAgentId(agentId);
    setModelMenuOpen(false);
  }

  function handleAttachmentPick() {
    fileInputRef.current?.click();
  }

  async function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const resolved = await Promise.all(files.map((file) => toSelectedAttachment(file)));
    setSelectedAttachments(resolved);
  }

  function handleAttachmentRemove(name: string) {
    setSelectedAttachments((current) => {
      const next = current.filter((file) => file.name !== name);
      if (fileInputRef.current && next.length === 0) {
        fileInputRef.current.value = "";
      }
      return next;
    });
  }

  if (!overview) {
    return (
      <div className="shell desktop-shell">
        <div className="loading-panel">
          <strong>正在加载控制台...</strong>
          <span>{error || "正在从本机服务读取集群状态。"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="shell desktop-shell">
      <aside className="nav-rail">
        <div className="nav-brand">
          <div className="brand-mark" aria-label="OATC" />
          <div className="nav-brand-copy">
            <strong>OATC</strong>
          </div>
          {deployPanelOpen ? (
            <div className="deploy-panel">
              <div className="deploy-panel-head">
                <strong>部署 OpenClaw</strong>
                <button className="ghost-action small-action" onClick={() => setDeployPanelOpen(false)} type="button">
                  收起
                </button>
              </div>
              <div className="deploy-panel-body">
                {bootstrapLoading ? <p className="deploy-muted">正在检测依赖环境...</p> : null}
                {bootstrapStatus ? (
                  <div className="deploy-check-list">
                    {bootstrapStatus.checks.map((check) => (
                      <div key={check.name} className={`deploy-check ${check.ok ? "ok" : "bad"}`}>
                        <strong>{check.name}</strong>
                        <span>{check.ok ? "已就绪" : "缺失"}</span>
                      </div>
                    ))}
                    <div className={`deploy-check ${bootstrapStatus.workspaceReady ? "ok" : "bad"}`}>
                      <strong>workspace</strong>
                      <span>{bootstrapStatus.workspaceReady ? "已创建" : "未创建"}</span>
                    </div>
                    <div className={`deploy-check ${bootstrapStatus.configReady ? "ok" : "bad"}`}>
                      <strong>config</strong>
                      <span>{bootstrapStatus.configReady ? "已存在" : "未初始化"}</span>
                    </div>
                  </div>
                ) : null}
                {bootstrapError ? <p className="deploy-error">{bootstrapError}</p> : null}
                {bootstrapLogs.length > 0 ? (
                  <div className="deploy-log-list">
                    {bootstrapLogs.map((line, index) => (
                      <p key={`${line}-${index}`}>{line}</p>
                    ))}
                  </div>
                ) : (
                  <p className="deploy-muted">点击下方按钮会自动检测依赖、安装 openclaw，并完成基础配置。</p>
                )}
              </div>
              <div className="deploy-panel-actions">
                <button className="ghost-action small-action" onClick={() => void loadBootstrapStatus()} type="button" disabled={bootstrapLoading || bootstrapRunning}>
                  重新检测
                </button>
                <button className="deploy-run-button" onClick={() => void handleBootstrapRun()} type="button" disabled={bootstrapRunning}>
                  {bootstrapRunning ? "部署中..." : "一键部署"}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="nav-menu">
          <button className={`nav-item ${viewMode === "home" ? "active" : ""}`} onClick={() => setViewMode("home")} type="button">
            <Home size={18} />
            <span>首页</span>
          </button>
          <button className={`nav-item ${viewMode === "swarm" ? "active" : ""}`} onClick={() => setViewMode("swarm")} type="button">
            <Radar size={18} />
            <span>蜂群管理</span>
          </button>
        </div>

        <div className="nav-footer">
          <button
            className={`deploy-entry ${deployPanelOpen ? "active" : ""}`}
            onClick={() => {
              const nextOpen = !deployPanelOpen;
              setDeployPanelOpen(nextOpen);
              if (nextOpen && !bootstrapStatus && !bootstrapLoading) {
                void loadBootstrapStatus();
              }
            }}
            type="button"
            aria-label="部署 OpenClaw"
            title="部署 OpenClaw"
          >
            <Shield size={16} />
          </button>
          <div className="nav-meta-label">更新时间</div>
          <div className="nav-meta-value">{updatedLabel}</div>
        </div>
      </aside>

      <section className="main-stage">
        <header className="stage-header">
          <div>
            <h1>{viewMode === "home" ? "首页" : "蜂群管理"}</h1>
            <p>{sourceHint}</p>
          </div>
          <div className="header-tools">
            <div className="time-card">
              <span>当前时间</span>
              <strong>{currentClock}</strong>
            </div>
            <div className="time-zone-switch">
              <button className="ghost-action compact-action" onClick={() => setTimeMenuOpen((current) => !current)} type="button">
                <TimerReset size={15} />
                <span>{timeZoneLabel}</span>
              </button>
              {timeMenuOpen ? (
                <div className="time-zone-menu">
                  {timeZoneOptions.map((timeZone) => (
                    <button
                      key={timeZone}
                      className={`time-zone-option ${selectedTimeZone === timeZone ? "active" : ""}`}
                      onClick={() => {
                        setSelectedTimeZone(timeZone);
                        setTimeMenuOpen(false);
                      }}
                      type="button"
                    >
                      <strong>{timeZone.split("/").pop()?.split("_").join(" ") ?? timeZone}</strong>
                      <span>{timeZone}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {viewMode === "home" ? (
          <main className="home-chat-layout">
            <section className="chat-stage">
              <div className="chat-stage-header">
                <div>
                  <h2>{selectedAgent?.name ?? "未选择 Agent"}</h2>
                  <p>
                    {selectedAgent?.runtime ?? "--"} · {agentStatusLabelMap[selectedAgent?.status ?? ""] ?? "未知"}
                  </p>
                </div>
                <div className="chat-stage-metrics">
                  {[dailyTokenMetric, activeTaskMetric, costMetric]
                    .filter(Boolean)
                    .map((metric) => (
                      <div key={metric!.label} className="mini-stat">
                        <span>{metricLabelMap[metric!.label] ?? metric!.label}</span>
                        <strong>{metric!.value}</strong>
                      </div>
                    ))}
                  <button className="ghost-action compact-action" onClick={handleHistoryOpen} type="button">
                    <History size={15} />
                    <span>{historyLoading ? "加载中" : "历史"}</span>
                  </button>
                </div>
              </div>
              <div className="collab-summary-bar">
                <div className="collab-summary-main">
                  <strong>当前协作态</strong>
                  <span>{collaborationSummary}</span>
                </div>
                <div className="collab-summary-tags">
                  <span>{runningTasks.length} 个运行任务</span>
                  <span>{runningToolCalls.length} 个活跃工具阶段</span>
                  <span>{agents.filter((agent) => agent.status === "busy").length} 个忙碌 Agent</span>
                </div>
              </div>

              <div className="chat-conversation-shell">
                <div className="chat-conversation" ref={chatConversationRef} onScroll={handleConversationScroll}>
                {chatMessages.length === 0 ? (
                  <div className="chat-empty">
                    <Bot size={24} />
                    <p>右侧选择 Agent 后，直接在这里开始对话。</p>
                  </div>
                ) : (
                  chatMessages.map((message) => (
                    <div key={message.id} className={`chat-bubble-row ${message.side}`}>
                      <div className={`chat-bubble ${message.side}`}>
                        <p>{message.text}</p>
                        {message.attachments?.length ? (
                          <div className="message-attachments">
                            {message.attachments.map((attachment) => (
                              <article key={attachment.id} className="file-card">
                                <div className="file-card-head">
                                  <span className="file-card-icon">{attachmentIcon(attachment)}</span>
                                  <div className="file-card-meta">
                                    <strong>{attachment.name}</strong>
                                    <span>
                                      {attachment.previewKind === "text"
                                        ? "文本"
                                        : attachment.previewKind === "image"
                                          ? "图片"
                                          : attachment.previewKind === "pdf"
                                            ? "PDF"
                                            : attachment.previewKind === "audio"
                                              ? "音频"
                                              : attachment.previewKind === "video"
                                                ? "视频"
                                                : "文件"}{" "}
                                      · {formatFileSize(attachment.size)}
                                    </span>
                                  </div>
                                  {attachment.downloadUrl ? (
                                    <a className="file-card-action" href={attachment.downloadUrl} target="_blank" rel="noreferrer">
                                      <ExternalLink size={14} />
                                    </a>
                                  ) : null}
                                </div>
                                {attachment.previewKind === "image" && attachment.previewUrl ? (
                                  <img className="file-card-image" src={attachment.previewUrl} alt={attachment.name} />
                                ) : null}
                                {attachment.previewKind === "text" && attachment.textExcerpt ? (
                                  <pre className="file-card-text">{attachment.textExcerpt}</pre>
                                ) : null}
                                {attachment.storedPath ? <code className="file-card-path">{attachment.storedPath}</code> : null}
                              </article>
                            ))}
                          </div>
                        ) : null}
                        <span>{formatTime(message.ts)}</span>
                      </div>
                    </div>
                  ))
                )}
                </div>
                {showScrollToBottom ? (
                  <button className="scroll-to-bottom" onClick={() => scrollChatToBottom()} type="button">
                    <ArrowDownToLine size={16} />
                    <span>到底</span>
                  </button>
                ) : null}
                {historyOpen ? (
                  <aside className="history-drawer">
                    <div className="history-drawer-head">
                      <div>
                        <strong>对话历史</strong>
                        <span>{selectedAgent?.name ?? "--"}</span>
                      </div>
                      <button className="ghost-action small-action" onClick={() => setHistoryOpen(false)} type="button">
                        关闭
                      </button>
                    </div>
                    <div className="history-drawer-body">
                      {chatMessages.length === 0 ? (
                        <p className="history-empty">{historyLoading ? "正在读取历史..." : "暂无历史记录"}</p>
                      ) : (
                        chatMessages.map((message) => (
                          <article key={`history-${message.id}`} className="history-item">
                            <div className="history-item-head">
                              <strong>{message.side === "user" ? "我" : selectedAgent?.name ?? "Agent"}</strong>
                              <span>{formatTime(message.ts)}</span>
                            </div>
                            <p>{message.text}</p>
                            {message.attachments?.length ? (
                              <div className="history-attachments">
                                {message.attachments.map((attachment) => (
                                  <div key={attachment.id} className="history-attachment-row">
                                    {attachmentIcon(attachment)}
                                    <span>{attachment.name}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </article>
                        ))
                      )}
                    </div>
                  </aside>
                ) : null}
              </div>

              <div className="chat-input-bar">
                <input ref={fileInputRef} type="file" hidden multiple onChange={handleAttachmentChange} />
                {selectedAttachments.length > 0 ? (
                  <div className="attachment-strip">
                    {selectedAttachments.map((file) => (
                      <button
                        key={file.id}
                        className="attachment-chip"
                        onClick={() => handleAttachmentRemove(file.name)}
                        type="button"
                        title="移除附件"
                      >
                        <Paperclip size={12} />
                        <span>{file.name}</span>
                        <small>
                          {file.contentMode === "inline_text"
                            ? `全文 ${formatFileSize(file.size)}`
                            : file.contentMode === "stored_file"
                              ? "文件可读"
                              : "仅元数据"}
                        </small>
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="composer-shell">
                  <textarea
                    placeholder="输入你想让 agent 执行的命令"
                    value={commandText}
                    onChange={(event) => setCommandText(event.target.value)}
                    rows={4}
                  />
                  <div className="chat-input-actions">
                    <div className="composer-hint">
                      当前模型：{selectedAgent?.model ?? "--"}
                    </div>
                    <div className="composer-actions">
                      <div className="model-switch">
                        <button
                          className="icon-action compact-icon-action"
                          onClick={() => setModelMenuOpen((current) => !current)}
                          type="button"
                          aria-label="切换模型"
                          title={`切换模型：${selectedAgent?.model ?? "--"}`}
                        >
                          <Sparkles size={16} />
                        </button>
                        {modelMenuOpen ? (
                          <div className="model-menu model-menu-inline">
                            {modelOptions.map((option) => (
                              <button
                                key={option.model}
                                className={`model-option ${selectedAgent?.model === option.model ? "active" : ""}`}
                                onClick={() => handleModelSelect(option.agentId)}
                                type="button"
                              >
                                <strong>{option.model}</strong>
                                <span>{agents.find((agent) => agent.id === option.agentId)?.name ?? "--"}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <button className="icon-action" type="button" aria-label="上传附件" onClick={handleAttachmentPick}>
                        <Paperclip size={16} />
                      </button>
                      <button className="send-button" onClick={handleCommandSubmit} type="button" disabled={commandPending}>
                        <Send size={16} />
                        <span>{commandPending ? "发送中" : "发送"}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </main>
        ) : (
          <main className="swarm-layout">
            <section className="content-card topology-card">
              <div className="section-head">
                <h2>
                  <Radar size={18} /> 集群拓扑
                </h2>
                <p>网关、节点与 Agent 的当前关系</p>
              </div>
              <div className="flow-shell">
                <ReactFlow nodes={topologyNodes} edges={topologyEdges} fitView nodesDraggable={false}>
                  <MiniMap />
                  <Background gap={20} size={1} />
                </ReactFlow>
              </div>
            </section>

            <section className="content-card">
              <div className="section-head">
                <h2>
                  <Waypoints size={18} /> 任务列表
                </h2>
                <p>当前会话与任务摘要</p>
              </div>
              <div className="task-list">
                {tasks.map((task) => (
                  <button
                    key={task.id}
                    className={`task-card ${task.id === selectedTask?.id ? "selected" : ""}`}
                    onClick={() => setSelectedTaskId(task.id)}
                    type="button"
                  >
                    <div className="task-headline">
                      <span className={`pill ${statusClass[task.status]}`}>{taskStatusLabelMap[task.status]}</span>
                      <span className="priority">{task.priority}</span>
                    </div>
                    <strong>{task.title}</strong>
                    <p>{task.summary}</p>
                    <div className="task-meta">
                      <span>{task.tenant}</span>
                      <span>{task.eta}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="content-card">
              <div className="section-head row">
                <div>
                  <h2>
                    <Sparkles size={18} /> 任务流程
                  </h2>
                  <p>{selectedTask?.title ?? "未选择任务"}</p>
                </div>
                <div className="task-stats">
                  <span>
                    <Clock3 size={14} /> {selectedTask?.eta ?? "--"}
                  </span>
                  <span>
                    <Shield size={14} /> {selectedTask?.budget ?? "--"}
                  </span>
                </div>
              </div>
              <div className="workflow-list">
                {(selectedTask?.steps ?? []).map((step) => (
                  <div key={step.id} className="workflow-row">
                    <div className="workflow-main">
                      <strong>{step.label}</strong>
                      <span>{step.owner}</span>
                    </div>
                    <span className={`pill ${statusClass[step.status]}`}>{taskStatusLabelMap[step.status]}</span>
                  </div>
                ))}
              </div>
              <div className="task-brief">
                <p>{selectedTask?.summary ?? "未选择任务。"}</p>
              </div>
            </section>

            <section className="content-card">
              <div className="section-head">
                <h2>
                  <Bot size={18} /> Agent 详情
                </h2>
                <p>{selectedAgent?.name ?? "未知"} · {selectedAgent?.runtime ?? "--"}</p>
              </div>
              <article className="inspector-card">
                <div className="inspector-top">
                  <div>
                    <strong>{selectedAgent?.model ?? "--"}</strong>
                    <span className={`pill ${selectedAgent?.status === "busy" ? "warning" : "healthy"}`}>
                      {agentStatusLabelMap[selectedAgent?.status ?? ""] ?? "未知"}
                    </span>
                  </div>
                  <span>{selectedAgent?.sandbox ?? "--"}</span>
                </div>
                <dl className="stat-pairs">
                  <div>
                    <dt>节点</dt>
                    <dd title={selectedAgent?.nodeId ?? "--"}>
                      {selectedAgent?.nodeId ? shortenMiddle(selectedAgent.nodeId, 12) : "--"}
                    </dd>
                  </div>
                  <div>
                    <dt>Token</dt>
                    <dd>{selectedAgent?.tokenRate ?? "--"}</dd>
                  </div>
                  <div>
                    <dt>成功率</dt>
                    <dd>{selectedAgent?.successRate ?? "--"}</dd>
                  </div>
                  <div>
                    <dt>P95</dt>
                    <dd>{selectedAgent?.latencyP95 ?? "--"}</dd>
                  </div>
                </dl>
                <div className="tool-chips">
                  {(selectedAgent?.tools ?? []).map((tool) => (
                    <span key={tool}>{tool}</span>
                  ))}
                </div>
              </article>
              <div className="node-strip">
                {nodes.map((node) => (
                  <div key={node.id} className="node-card">
                    <div className="node-card-head">
                      <strong>{node.name}</strong>
                      <span className={`pill ${node.health}`}>{healthLabelMap[node.health] ?? node.health}</span>
                    </div>
                    <div className="usage-bars">
                      <label>
                        <Cpu size={14} /> CPU
                        <progress max="100" value={node.cpu} />
                        <span>{node.cpu}%</span>
                      </label>
                      <label>
                        <Database size={14} /> MEM
                        <progress max="100" value={node.memory} />
                        <span>{node.memory}%</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="content-card">
              <div className="section-head">
                <h2>
                  <Activity size={18} /> 事件流
                </h2>
                <p>最近的运行事件和系统提示</p>
              </div>
              <div className="event-list">
                {liveEvents.map((event) => (
                  <div key={event.id} className={`event-row ${event.level}`}>
                    <span className="event-ts">{event.ts}</span>
                    <span className="event-source">{event.source}</span>
                    <p>{event.message}</p>
                  </div>
                ))}
              </div>
            </section>
          </main>
        )}
      </section>

      <aside className="chat-pane">
        <div className="chat-toolbar">
          <div className="chat-toolbar-head">
            <h2>协作会话</h2>
            <span className="chat-toolbar-meta">
              {agentTreeRows.length} 会话 · {agents.filter((agent) => agent.status === "busy").length} 忙碌 ·{" "}
              {Object.values(unreadByAgentId).reduce((sum, count) => sum + count, 0)} 未读
            </span>
          </div>
          <span>选择 agent 直接介入当前协作</span>
        </div>

        <div className="chat-pane-section">
          <section className="agent-group">
            <div className="agent-toolbar">
              <label className="agent-search">
                <Search size={14} />
                <input
                  value={agentFilterText}
                  onChange={(event) => setAgentFilterText(event.target.value)}
                  placeholder="搜索 agent / 模型"
                />
              </label>
              <button
                className={`agent-filter-toggle ${showActiveOnly ? "active" : ""}`}
                onClick={() => setShowActiveOnly((current) => !current)}
                type="button"
              >
                只看活跃
              </button>
            </div>
            <div className="chat-agent-list">
              {agentTreeRows.length === 0 ? (
                <div className="agent-empty-state">当前筛选条件下没有匹配的 Agent</div>
              ) : (
                agentTreeRows.map(({ agent, depth, hasChildren }) => {
                  const preview = getAgentPreview(agent.id);
                  const isCollapsed = collapsedAgentIds[agent.id];
                  const unreadCount = unreadByAgentId[agent.id] ?? 0;
                  const linkedTask = getAgentTask(agent.id);
                  const hasRunningTool = (agentContextById[agent.id]?.toolCalls ?? []).some(
                    (toolCall) => toolCall.status === "running" || toolCall.status === "pending",
                  );
                  return (
                    <div key={agent.id} className={`tree-agent-row depth-${depth}`}>
                      <div className="tree-agent-indent" style={{ width: `${depth * 16}px` }} />
                      {hasChildren ? (
                        <button
                          className="tree-toggle"
                          onClick={() =>
                            setCollapsedAgentIds((current) => ({
                              ...current,
                              [agent.id]: !current[agent.id],
                            }))
                          }
                          type="button"
                          aria-label={isCollapsed ? "展开子 Agent" : "收起子 Agent"}
                        >
                          {isCollapsed ? "+" : "-"}
                        </button>
                      ) : (
                        <span className="tree-toggle ghost" />
                      )}
                      <button
                        className={`chat-agent-item ${commandAgentId === agent.id ? "active" : ""}`}
                        onClick={() => setCommandAgentId(agent.id)}
                        type="button"
                      >
                        <div className="chat-agent-avatar">
                          <UserRound size={16} />
                          <span className={`agent-status-dot ${agent.status === "busy" ? "busy" : agent.status}`} />
                        </div>
                        <div className="chat-agent-meta">
                          <div className="chat-agent-row">
                            <strong>{agent.name}</strong>
                            <div className="chat-agent-flags">
                              {unreadCount > 0 ? <span className="unread-badge">{unreadCount}</span> : null}
                              <time>{preview.ts}</time>
                            </div>
                          </div>
                          <div className="chat-agent-tags">
                            {linkedTask ? (
                              <span className={`tree-task-tag ${statusClass[linkedTask.status]}`}>{linkedTask.title}</span>
                            ) : hasRunningTool ? (
                              <span className="tree-task-tag is-dispatching">工具运行中</span>
                            ) : (
                              <span className={`tree-source-tag ${agent.parentSource ?? "root"}`}>
                                {parentSourceLabelMap[agent.parentSource ?? "root"]}
                              </span>
                            )}
                          </div>
                          <span>{preview.text}</span>
                        </div>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>

        <div className={`chat-pane-section context-panel ${contextPanelOpen ? "open" : "collapsed"}`}>
          <button className="context-panel-head context-panel-toggle" onClick={() => setContextPanelOpen((current) => !current)} type="button">
            <div>
              <strong>当前 Agent 上下文</strong>
              <span>{selectedAgent?.name ?? "--"} · {selectedAgent?.model ?? "--"}</span>
            </div>
            <div className="context-panel-head-side">
              <span className={`pill ${selectedAgent?.status === "busy" ? "warning" : "healthy"}`}>
                {agentStatusLabelMap[selectedAgent?.status ?? ""] ?? "未知"}
              </span>
              {contextPanelOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </div>
          </button>
          {contextPanelOpen ? (
            <>
              <div className="context-meta-grid">
                <div>
                  <span>运行时</span>
                  <strong>{selectedAgent?.runtime ?? "--"}</strong>
                </div>
                <div>
                  <span>Token</span>
                  <strong>{selectedAgent?.tokenRate ?? "--"}</strong>
                </div>
              </div>
              <div className="context-history">
                {selectedContextMessages.length === 0 ? (
                  <p className="context-empty">当前还没有可展示的上下文，先发一条消息。</p>
                ) : (
                  selectedContextMessages.map((message) => (
                    <article key={`context-${message.id}`} className="context-snippet">
                      <div className="context-snippet-head">
                        <strong>{message.side === "user" ? "我" : selectedAgent?.name ?? "Agent"}</strong>
                        <span>{formatTime(message.ts)}</span>
                      </div>
                      <p>{message.text}</p>
                    </article>
                  ))
                )}
              </div>
              <div className="context-tool-panel">
                <div className="context-tool-head">
                  <strong>最近 Tool Calls</strong>
                  <span>{selectedToolCalls.length} 条</span>
                </div>
                <div className="context-tool-list">
                  {selectedToolCalls.length === 0 ? (
                    <p className="context-empty">当前还没有工具调用记录。</p>
                  ) : (
                    selectedToolCalls.map((toolCall) => (
                      <article key={toolCall.id} className="tool-call-item">
                        <div className="tool-call-head">
                          <strong>{toolCall.name}</strong>
                          <span>{formatTime(toolCall.ts)}</span>
                        </div>
                        <div className="tool-call-meta">
                          <span
                            className={`pill ${
                              toolCall.status === "failed"
                                ? "degraded"
                                : toolCall.status === "running" || toolCall.status === "pending"
                                  ? "warning"
                                  : "healthy"
                            }`}
                          >
                            {toolCall.status === "failed"
                              ? "失败"
                              : toolCall.status === "running"
                                ? "运行中"
                                : toolCall.status === "pending"
                                  ? "等待中"
                                  : "完成"}
                          </span>
                        </div>
                        <p>{toolCall.summary || "无参数摘要"}</p>
                      </article>
                    ))
                  )}
                </div>
              </div>
              <div className="context-tools">
                {(selectedAgent?.tools ?? []).map((tool) => (
                  <span key={tool}>{tool}</span>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

export default App;
