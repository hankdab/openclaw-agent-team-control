import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function timeAgoFromMs(ageMs) {
  const minutes = Math.max(1, Math.round(ageMs / 60000));
  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.round(minutes / 60);
  return `${hours} h ago`;
}

function shortTimeFromTs(ts) {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function healthFromChannelState(channel) {
  if (!channel?.configured) {
    return "degraded";
  }

  if (channel.lastError) {
    return "degraded";
  }

  if (!channel.running) {
    return "warning";
  }

  return "healthy";
}

function laneFromPresenceMode(mode) {
  if (mode === "webchat") {
    return "operator";
  }

  if (mode === "gateway") {
    return "gateway";
  }

  return "node";
}

function nodeHealthFromPresence(reason) {
  if (reason === "disconnect") {
    return "warning";
  }

  return "healthy";
}

function safeJsonParse(input, fallback) {
  try {
    return JSON.parse(input);
  } catch {
    return fallback;
  }
}

async function runOpenClaw(args) {
  const { stdout } = await execFileAsync("openclaw", args, {
    timeout: 15000,
    maxBuffer: 2 * 1024 * 1024,
    env: process.env,
  });
  return stdout;
}

function parseJsonOutput(stdout, fallback) {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "{" || line === "[") {
      const joined = lines.slice(index).join("\n");
      return safeJsonParse(joined, fallback);
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("{") || line.startsWith("[")) {
      const joined = lines.slice(index).join("\n");
      return safeJsonParse(joined, fallback);
    }
  }

  const joined = lines.join("\n");
  const start = joined.search(/[\[{]/);
  if (start >= 0) {
    return safeJsonParse(joined.slice(start), fallback);
  }

  return fallback;
}

function deriveParent(agentId, sessionsByAgent, defaultAgentId) {
  const recent = sessionsByAgent.get(agentId)?.recent?.[0];
  const key = recent?.key ?? "";

  if (!key || agentId === defaultAgentId) {
    return { parentId: undefined, parentSource: "root" };
  }

  if (key.includes(":openai-user:") || key.includes(":dingtalk-connector:")) {
    return { parentId: undefined, parentSource: "root" };
  }

  const parentMatch = key.match(/:agent:([^:]+)/);
  if (parentMatch?.[1] && parentMatch[1] !== agentId) {
    return { parentId: parentMatch[1], parentSource: "actual" };
  }

  if (recent?.systemSent) {
    return { parentId: defaultAgentId, parentSource: "inferred" };
  }

  return {
    parentId: defaultAgentId && defaultAgentId !== agentId ? defaultAgentId : undefined,
    parentSource: defaultAgentId && defaultAgentId !== agentId ? "inferred" : "root",
  };
}

function summarizeLogLine(line) {
  const message = String(line.message ?? "").replace(/\s+/g, " ").trim();

  if (!message || message === "[]" || message.startsWith("{") || message.startsWith("[")) {
    return null;
  }

  if (message.includes("插件已注册")) {
    return {
      source: line.subsystem ?? "plugins",
      level: "info",
      message: "扩展插件已加载",
    };
  }

  if (message.includes("plugins.allow is empty")) {
    return {
      source: line.subsystem ?? "plugins",
      level: "warn",
      message: "插件白名单未显式配置",
    };
  }

  if (/tool|agent|session|channel/i.test(message) || line.subsystem) {
    return {
      source: line.subsystem ?? "gateway",
      level: line.level === "error" ? "error" : line.level === "warn" ? "warn" : "info",
      message: message.slice(0, 160),
    };
  }

  return null;
}

async function collectRealSnapshot() {
  const [
    healthRaw,
    statusRaw,
    presenceRaw,
    agentsRaw,
    bindingsRaw,
    nodesRaw,
    costRaw,
    logsRaw,
  ] = await Promise.all([
    runOpenClaw(["health", "--json"]),
    runOpenClaw(["gateway", "call", "status", "--json"]),
    runOpenClaw(["gateway", "call", "system-presence", "--json"]),
    runOpenClaw(["agents", "list", "--json"]),
    runOpenClaw(["agents", "bindings", "--json"]),
    runOpenClaw(["nodes", "status", "--json"]),
    runOpenClaw(["gateway", "usage-cost", "--json"]),
    runOpenClaw(["logs", "--json", "--limit", "14"]),
  ]);

  const health = parseJsonOutput(healthRaw, {});
  const status = parseJsonOutput(statusRaw, {});
  const presence = parseJsonOutput(presenceRaw, []);
  const agentList = parseJsonOutput(agentsRaw, []);
  const bindings = parseJsonOutput(bindingsRaw, []);
  const nodeStatus = parseJsonOutput(nodesRaw, { nodes: [] });
  const usageCost = parseJsonOutput(costRaw, { totals: { totalCost: 0, totalTokens: 0 } });
  const logLines = logsRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeJsonParse(line, null))
    .filter((line) => line?.type === "log");

  const gateway = {
    id: "local-gateway",
    name: "Local OpenClaw Gateway",
    region: "127.0.0.1",
    health: Object.values(health.channels ?? {}).some((channel) => channel?.lastError)
      ? "warning"
      : "healthy",
    sessions: status.sessions?.count ?? health.sessions?.count ?? 0,
    throughput: `${(status.sessions?.recent ?? []).length} recent sessions`,
  };

  const pairedNodes = (nodeStatus.nodes ?? []).map((node) => ({
    id: node.id ?? node.nodeId ?? node.displayName ?? `node-${Math.random().toString(16).slice(2)}`,
    name: node.displayName ?? node.name ?? node.id ?? "Paired Node",
    lane: "paired",
    region: node.platform ?? "node",
    health: node.online ? "healthy" : "warning",
    queueDepth: 0,
    cpu: node.online ? 42 : 0,
    memory: node.online ? 39 : 0,
    capabilities: node.capabilities ?? [],
    agents: [],
  }));

  const presenceNodes = presence
    .filter((item) => item.mode !== "gateway")
    .map((item) => ({
      id: `presence-${item.instanceId ?? item.host}`,
      name: item.host,
      lane: laneFromPresenceMode(item.mode),
      region: item.platform ?? item.ip ?? "unknown",
      health: nodeHealthFromPresence(item.reason),
      queueDepth: 0,
      cpu: item.mode === "backend" ? 20 : 12,
      memory: item.mode === "backend" ? 22 : 15,
      capabilities: item.roles ?? item.scopes ?? [],
      agents: [],
    }));

  const nodes = [...presenceNodes, ...pairedNodes];
  if (nodes.length === 0) {
    nodes.push({
      id: "node-local-host",
      name: "Local Host",
      lane: "gateway",
      region: "macOS",
      health: "healthy",
      queueDepth: 0,
      cpu: 18,
      memory: 26,
      capabilities: ["gateway", "workspace"],
      agents: [],
    });
  }

  const sessionsByAgent = new Map((status.sessions?.byAgent ?? []).map((item) => [item.agentId, item]));
  const defaultNodeId = nodes[0]?.id ?? "node-local-host";

  const mappedAgents = agentList.map((agent) => {
    const sessionInfo = sessionsByAgent.get(agent.id);
    const recent = sessionInfo?.recent?.[0];
    const isBusy = Boolean(recent && recent.age < 30 * 60 * 1000);
    const nodeId =
      nodes.find((node) => node.lane === "gateway" || node.lane === "operator")?.id ?? defaultNodeId;

    return {
      id: agent.id,
      name: agent.id,
      kind: agent.isDefault ? "control" : "execution",
      parentSource: agent.isDefault ? "root" : undefined,
      runtime: "OpenClaw Native",
      model: agent.model?.split("/").at(-1) ?? "unknown",
      status: isBusy ? "busy" : "idle",
      sandbox: "workspace",
      nodeId,
      tools: sessionInfo ? ["sessions", "routing"] : ["routing"],
      tokenRate: recent ? `${recent.totalTokens ?? 0} tok` : "0 tok",
      successRate: recent?.abortedLastRun ? "0%" : "100%",
      latencyP95: recent ? `${Math.max(1, Math.round((recent.outputTokens ?? 0) / 100))}s` : "--",
      lastError: recent?.abortedLastRun ? "Last run aborted" : undefined,
    };
  });

  const knownAgentIds = new Set(mappedAgents.map((agent) => agent.id));
  const derivedAgents = Array.from(sessionsByAgent.entries())
    .filter(([agentId]) => !knownAgentIds.has(agentId))
    .map(([agentId, sessionInfo]) => {
      const recent = sessionInfo?.recent?.[0];
      const nodeId =
        nodes.find((node) => node.lane === "gateway" || node.lane === "operator")?.id ?? defaultNodeId;

      return {
        id: agentId,
        name: agentId,
        kind: agentId === health.defaultAgentId ? "control" : "execution",
        parentSource: agentId === health.defaultAgentId ? "root" : undefined,
        runtime: "OpenClaw Session",
        model: recent?.model ?? status.sessions?.defaults?.model ?? "unknown",
        status: recent && recent.age < 30 * 60 * 1000 ? "busy" : "idle",
        sandbox: "workspace",
        nodeId,
        tools: ["sessions"],
        tokenRate: recent ? `${recent.totalTokens ?? 0} tok` : "0 tok",
        successRate: recent?.abortedLastRun ? "0%" : "100%",
        latencyP95: recent ? `${Math.max(1, Math.round((recent.outputTokens ?? 0) / 100))}s` : "--",
        lastError: recent?.abortedLastRun ? "Last run aborted" : undefined,
      };
    });

  const agents = [...mappedAgents, ...derivedAgents];
  const rootControlAgentId = health.defaultAgentId ?? agents.find((agent) => agent.kind === "control")?.id;

  for (const agent of agents) {
    if (!agent.parentId || !agent.parentSource) {
      const parent = deriveParent(agent.id, sessionsByAgent, rootControlAgentId);
      agent.parentId = parent.parentId;
      agent.parentSource = parent.parentSource;
    }
  }

  for (const node of nodes) {
    node.agents = agents
      .filter((agent) => agent.nodeId === node.id)
      .map((agent) => ({
        id: agent.id,
        role: agent.kind,
        status: agent.status,
      }));
  }

  const tasks = (status.sessions?.recent ?? []).slice(0, 8).map((session, index) => {
    const agentId = session.agentId ?? agents[0]?.id ?? "main";
    const nodeId = agents.find((agent) => agent.id === agentId)?.nodeId ?? defaultNodeId;
    const statusValue = session.abortedLastRun ? "failed" : session.age < 30 * 60 * 1000 ? "running" : "completed";

    return {
      id: session.sessionId ?? `session-${index}`,
      title: session.key ?? `Session ${index + 1}`,
      tenant: session.kind ?? "direct",
      status: statusValue,
      priority: index === 0 ? "P0" : index < 3 ? "P1" : "P2",
      budget: `${session.contextTokens ?? 0} ctx`,
      createdAt: shortTimeFromTs((session.updatedAt ?? Date.now()) - (session.age ?? 0)),
      eta: statusValue === "running" ? "active" : "settled",
      agentId,
      nodeId,
      summary: `Model ${session.model ?? "unknown"} · ${session.totalTokens ?? 0} total tokens · ${timeAgoFromMs(session.age ?? 0)}`,
      steps: [
        {
          id: `step-${session.sessionId ?? index}-1`,
          label: "Context loaded",
          owner: agentId,
          status: "completed",
        },
        {
          id: `step-${session.sessionId ?? index}-2`,
          label: "Session active",
          owner: agentId,
          status: statusValue === "running" ? "running" : statusValue,
        },
      ],
    };
  });

  const healthyNodes = nodes.filter((node) => node.health === "healthy").length;
  const totalNodes = nodes.length;
  const totalTokensToday = usageCost.daily?.at(-1)?.totalTokens ?? usageCost.totals?.totalTokens ?? 0;
  const totalCostToday = usageCost.daily?.at(-1)?.totalCost ?? usageCost.totals?.totalCost ?? 0;

  const costDisplay =
    Number(totalCostToday ?? 0) > 0 ? `$${Number(totalCostToday ?? 0).toFixed(2)}` : "未计费";

  const metrics = [
    {
      label: "Daily Tokens",
      value: `${Math.round(totalTokensToday / 1000)}k`,
      delta: "今日累计",
    },
    { label: "Active Tasks", value: String(tasks.length), delta: `${status.sessions?.count ?? 0} sessions` },
    { label: "Healthy Nodes", value: `${healthyNodes} / ${totalNodes}`, delta: `${presence.length} present` },
    {
      label: "Agent Throughput",
      value: `${Math.round(totalTokensToday / 1000)}k tokens`,
      delta: `${health.defaultAgentId ?? "main"} default`,
    },
    {
      label: "Cost Burn",
      value: costDisplay,
      delta: usageCost.totals?.missingCostEntries ? "partial pricing" : "from usage logs",
    },
  ];

  const channelEvents = Object.entries(health.channels ?? {}).map(([channelId, channel]) => ({
    id: `channel-${channelId}`,
    ts: shortTimeFromTs(Date.now()),
    level: channel.lastError ? "error" : channel.running ? "info" : "warn",
    source: channelId,
    message: channel.lastError
      ? String(channel.lastError)
      : channel.running
        ? "Channel connected"
        : "Channel configured but not running",
  }));

  const parsedLogEvents = logLines
    .map((line, index) => {
      const parsed = summarizeLogLine(line);
      if (!parsed) {
        return null;
      }

      return {
        id: `log-${index}-${line.time}`,
        ts: shortTimeFromTs(line.time ?? Date.now()),
        level: parsed.level,
        source: parsed.source,
        message: parsed.message,
      };
    })
    .filter(Boolean)
    .reverse();

  const events = [...channelEvents, ...parsedLogEvents].slice(0, 12);

  return {
    source: "real",
    updatedAt: new Date().toISOString(),
    metrics,
    gateways: [gateway],
    nodes,
    agents,
    tasks,
    events,
    bindings,
    channels: health.channels ?? {},
  };
}

export function createRealProvider() {
  let state = null;

  return {
    mode: "real",
    async init() {
      state = await collectRealSnapshot();
    },
    getOverview() {
      return state;
    },
    getTask(taskId) {
      return state?.tasks.find((task) => task.id === taskId) ?? null;
    },
    async tick() {
      state = await collectRealSnapshot();
      return {
        type: "control-plane.tick",
        payload: {
          source: state.source,
          updatedAt: state.updatedAt,
          metrics: state.metrics,
          tasks: state.tasks,
          nodes: state.nodes,
          events: state.events,
        },
      };
    },
  };
}
