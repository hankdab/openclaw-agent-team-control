function createInitialState() {
  return {
    source: "mock",
    updatedAt: new Date().toISOString(),
    metrics: [
      { label: "Daily Tokens", value: "128k", delta: "今日累计" },
      { label: "Active Tasks", value: "3", delta: "示例任务" },
      { label: "Healthy Nodes", value: "3 / 3", delta: "单机演示" },
      { label: "Agent Throughput", value: "143 turns/min", delta: "模拟吞吐" },
      { label: "Cost Burn", value: "未计费", delta: "模拟数据" },
    ],
    gateways: [
      {
        id: "gw-local",
        name: "本机 Gateway",
        region: "127.0.0.1",
        health: "healthy",
        sessions: 3,
        throughput: "模拟事件流",
      },
    ],
    nodes: [
      {
        id: "node-browser-01",
        name: "Browser Pool 01",
        lane: "browser",
        region: "sg",
        health: "healthy",
        queueDepth: 5,
        cpu: 61,
        memory: 48,
        capabilities: ["playwright", "vision", "captcha-review"],
        agents: [
          { id: "agent-research", role: "researcher", status: "busy" },
          { id: "agent-ops", role: "dispatcher", status: "idle" },
        ],
      },
      {
        id: "node-code-02",
        name: "Code Pool 02",
        lane: "code",
        region: "hk",
        health: "healthy",
        queueDepth: 3,
        cpu: 74,
        memory: 68,
        capabilities: ["docker", "nodejs", "python", "git"],
        agents: [
          { id: "agent-coder", role: "coder", status: "busy" },
          { id: "agent-review", role: "reviewer", status: "busy" },
        ],
      },
      {
        id: "node-data-03",
        name: "Data Pool 03",
        lane: "data",
        region: "tokyo",
        health: "warning",
        queueDepth: 7,
        cpu: 82,
        memory: 79,
        capabilities: ["etl", "postgres", "embeddings"],
        agents: [{ id: "agent-report", role: "reporter", status: "idle" }],
      },
    ],
    agents: [
      {
        id: "agent-ops",
        name: "Dispatcher",
        kind: "control",
        parentSource: "root",
        runtime: "OpenClaw Native",
        model: "gpt-5.4-mini",
        status: "idle",
        sandbox: "strict-routing",
        nodeId: "node-browser-01",
        tools: ["route", "bind-session", "policy-check"],
        tokenRate: "9.1k/min",
        successRate: "99.2%",
        latencyP95: "0.8s",
      },
      {
        id: "agent-research",
        name: "Researcher",
        kind: "execution",
        parentId: "agent-ops",
        parentSource: "actual",
        runtime: "OpenClaw Native",
        model: "gpt-5.4",
        status: "busy",
        sandbox: "browser-strict",
        activeTaskId: "task-mercury",
        nodeId: "node-browser-01",
        tools: ["playwright", "extract", "canvas"],
        tokenRate: "23k/min",
        successRate: "95.4%",
        latencyP95: "3.2s",
      },
      {
        id: "agent-coder",
        name: "Coder",
        kind: "execution",
        parentId: "agent-ops",
        parentSource: "actual",
        runtime: "ACP / Codex",
        model: "gpt-5-codex",
        status: "busy",
        sandbox: "repo-write",
        activeTaskId: "task-raven",
        nodeId: "node-code-02",
        tools: ["patch", "test", "git", "shell"],
        tokenRate: "31k/min",
        successRate: "92.1%",
        latencyP95: "7.4s",
      },
      {
        id: "agent-review",
        name: "Reviewer",
        kind: "execution",
        parentId: "agent-coder",
        parentSource: "actual",
        runtime: "ACP / Claude Code",
        model: "claude-code",
        status: "busy",
        sandbox: "repo-read",
        activeTaskId: "task-raven",
        nodeId: "node-code-02",
        tools: ["diff", "risk-scan", "commentary"],
        tokenRate: "11k/min",
        successRate: "96.8%",
        latencyP95: "4.6s",
        lastError: "Flaky test on payments contract branch",
      },
      {
        id: "agent-report",
        name: "Reporter",
        kind: "execution",
        parentId: "agent-ops",
        parentSource: "actual",
        runtime: "OpenClaw Native",
        model: "gpt-5.4-mini",
        status: "idle",
        sandbox: "readonly-data",
        nodeId: "node-data-03",
        tools: ["sql", "chart", "export"],
        tokenRate: "4.4k/min",
        successRate: "98.7%",
        latencyP95: "1.7s",
      },
    ],
    tasks: [
      {
        id: "task-raven",
        title: "Checkout funnel regression investigation",
        tenant: "retail-growth",
        status: "running",
        priority: "P0",
        budget: "$18",
        createdAt: "07:52",
        eta: "11 min",
        agentId: "agent-coder",
        nodeId: "node-code-02",
        summary:
          "Dispatcher split the incident into reproduction, code patch, and peer review. Review is waiting on one flaky CI branch.",
        steps: [
          { id: "s1", label: "Reproduce issue", owner: "Researcher", status: "completed" },
          { id: "s2", label: "Patch service", owner: "Coder", status: "running" },
          { id: "s3", label: "Risk review", owner: "Reviewer", status: "blocked" },
          { id: "s4", label: "Ship status note", owner: "Reporter", status: "pending" },
        ],
      },
      {
        id: "task-mercury",
        title: "Competitor landing page intelligence sweep",
        tenant: "strategy-lab",
        status: "running",
        priority: "P1",
        budget: "$9",
        createdAt: "08:11",
        eta: "7 min",
        agentId: "agent-research",
        nodeId: "node-browser-01",
        summary:
          "Browser agents are collecting pricing, hero copy, and signup flows. Canvas snapshot already generated for operator review.",
        steps: [
          { id: "m1", label: "Capture homepage", owner: "Researcher", status: "completed" },
          { id: "m2", label: "Extract pricing", owner: "Researcher", status: "running" },
          { id: "m3", label: "Summarize changes", owner: "Reporter", status: "pending" },
        ],
      },
      {
        id: "task-atlas",
        title: "Weekly KPI narrative draft",
        tenant: "exec-office",
        status: "dispatching",
        priority: "P2",
        budget: "$4",
        createdAt: "08:19",
        eta: "16 min",
        agentId: "agent-report",
        nodeId: "node-data-03",
        summary:
          "Queued behind ETL pressure on the data pool. Scheduler is considering failover to a standby node.",
        steps: [
          { id: "a1", label: "Load metrics", owner: "Reporter", status: "dispatching" },
          { id: "a2", label: "Draft narrative", owner: "Reporter", status: "pending" },
          { id: "a3", label: "Human approval", owner: "Ops", status: "pending" },
        ],
      },
    ],
    events: [
      {
        id: "e1",
        ts: "08:24:17",
        level: "warn",
        source: "scheduler",
        message: "task-atlas delayed: data pool queue depth exceeded threshold 6",
      },
      {
        id: "e2",
        ts: "08:23:41",
        level: "info",
        source: "reviewer",
        message: "task-raven risk review paused until flaky test rerun finishes",
      },
      {
        id: "e3",
        ts: "08:22:53",
        level: "info",
        source: "researcher",
        message: "Canvas snapshot published for mercury homepage pricing comparison",
      },
      {
        id: "e4",
        ts: "08:21:06",
        level: "error",
        source: "node-data-03",
        message: "ETL worker latency rose above 4.8s p95; autoscale recommendation generated",
      },
      {
        id: "e5",
        ts: "08:20:14",
        level: "info",
        source: "dispatcher",
        message: "task-raven spawned reviewer sub-agent on code pool with repo-read policy",
      },
    ],
  };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function choose(list) {
  return list[randomInt(0, list.length - 1)];
}

function nowTime() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

export function createMockProvider() {
  let state = createInitialState();

  return {
    mode: "mock",
    async init() {},
    getOverview() {
      return state;
    },
    getTask(taskId) {
      return state.tasks.find((task) => task.id === taskId) ?? null;
    },
    async tick() {
      const selectedTask = choose(state.tasks);
      const selectedAgent = state.agents.find((agent) => agent.id === selectedTask.agentId) ?? state.agents[0];
      const level = choose(["info", "warn"]);

      if (selectedTask.status === "dispatching" && Math.random() > 0.6) {
        selectedTask.status = "running";
        selectedTask.steps[0].status = "running";
      }

      const event = {
        id: `evt-${Date.now()}`,
        ts: nowTime(),
        level,
        source: selectedAgent.name.toLowerCase(),
        message:
          level === "warn"
            ? `${selectedAgent.name} signaled budget pressure on ${selectedTask.id}`
            : `${selectedAgent.name} heartbeat synced for ${selectedTask.title}`,
      };

      state = {
        ...state,
        updatedAt: new Date().toISOString(),
        events: [event, ...state.events].slice(0, 20),
        nodes: state.nodes.map((node) => ({
          ...node,
          cpu: Math.max(18, Math.min(96, node.cpu + randomInt(-4, 5))),
          memory: Math.max(20, Math.min(96, node.memory + randomInt(-3, 4))),
          queueDepth: Math.max(0, Math.min(9, node.queueDepth + randomInt(-1, 2))),
        })),
      };

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
