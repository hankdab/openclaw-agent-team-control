import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import express from "express";
import { WebSocketServer } from "ws";
import { createControlPlane } from "./control-plane.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const publicDir = fs.existsSync(distDir) ? distDir : rootDir;
const runtimeDir = path.join(rootDir, ".runtime");
const attachmentStoreDir = path.join(runtimeDir, "attachments");
const app = express();
const port = Number(process.env.PORT || 4317);
const tickIntervalMs = Number(process.env.TICK_INTERVAL_MS || 10000);
const execFileAsync = promisify(execFile);
const agentContext = new Map();
const commandProgressTimers = new Map();
const recentRealtimeLogIds = [];
const homeDir = process.env.HOME || rootDir;
const openclawWorkspaceDir = path.join(homeDir, ".openclaw", "workspace");
const openclawConfigPath = path.join(homeDir, ".openclaw", "openclaw.json");

fs.mkdirSync(attachmentStoreDir, { recursive: true });

app.use(express.json());

const controlPlane = await createControlPlane();

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

function getContext(agentId) {
  return (
    agentContext.get(agentId) ?? {
      messages: [],
      toolCalls: [],
      updatedAt: null,
    }
  );
}

function extractToolCalls(raw) {
  const collected = [];
  const seen = new WeakSet();

  function walk(value) {
    if (!value || typeof value !== "object") {
      return;
    }

    if (seen.has(value)) {
      return;
    }

    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }

    const toolName =
      (typeof value.toolName === "string" && value.toolName) ||
      (typeof value.name === "string" &&
      (value.type === "tool_call" || value.tool || value.arguments || value.input || value.args)
        ? value.name
        : "");

    if (toolName) {
      collected.push({
        id: `tool-${Date.now()}-${collected.length}`,
        name: toolName,
        status: typeof value.status === "string" ? value.status : "completed",
        summary:
          typeof value.summary === "string"
            ? value.summary
            : typeof value.arguments === "string"
              ? value.arguments
              : JSON.stringify(value.arguments ?? value.input ?? value.args ?? {}).slice(0, 160),
        ts: new Date().toISOString(),
      });
    }

    for (const nested of Object.values(value)) {
      walk(nested);
    }
  }

  walk(raw);
  return collected.slice(0, 20);
}

function inferPlannedTools(message) {
  const normalized = String(message).toLowerCase();
  if (/搜索|查|research|search/.test(normalized)) {
    return ["web_search"];
  }
  if (/代码|文件|patch|fix|test|仓库|repo/.test(normalized)) {
    return ["patch", "test"];
  }
  return ["route"];
}

function sanitizeAttachmentName(name) {
  return path.basename(String(name || "attachment")).replace(/[^a-zA-Z0-9._-]/g, "-");
}

function detectPreviewKind(attachment) {
  const type = String(attachment.type || "").toLowerCase();
  const name = String(attachment.name || "").toLowerCase();

  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/.test(name)) {
    return "image";
  }
  if (type === "application/pdf" || name.endsWith(".pdf")) {
    return "pdf";
  }
  if (type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg)$/.test(name)) {
    return "audio";
  }
  if (type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/.test(name)) {
    return "video";
  }
  if (
    attachment.contentMode === "inline_text" ||
    type.startsWith("text/") ||
    /\.(md|txt|json|ts|tsx|js|jsx|css|html|py|yaml|yml|csv)$/.test(name)
  ) {
    return "text";
  }

  return "file";
}

function normalizeAttachments(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => ({
      name: String(item?.name || "").trim(),
      type: String(item?.type || "").trim(),
      size: Number(item?.size || 0),
      sourcePath: String(item?.sourcePath || "").trim(),
      binaryBase64: typeof item?.binaryBase64 === "string" ? item.binaryBase64 : "",
      content: typeof item?.content === "string" ? item.content : "",
      contentMode:
        item?.contentMode === "inline_text"
          ? "inline_text"
          : item?.contentMode === "stored_file"
            ? "stored_file"
            : "metadata_only",
    }))
    .filter((item) => item.name);
}

function materializeAttachments(attachments) {
  return attachments.map((attachment, index) => {
    const safeName = sanitizeAttachmentName(attachment.name);
    const targetPath = path.join(
      attachmentStoreDir,
      `${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}-${safeName}`,
    );

    let storedPath = "";

    try {
      if (attachment.sourcePath && fs.existsSync(attachment.sourcePath) && fs.statSync(attachment.sourcePath).isFile()) {
        fs.copyFileSync(attachment.sourcePath, targetPath);
        storedPath = targetPath;
      } else if (attachment.binaryBase64) {
        fs.writeFileSync(targetPath, Buffer.from(attachment.binaryBase64, "base64"));
        storedPath = targetPath;
      } else if (attachment.contentMode === "inline_text" && attachment.content) {
        fs.writeFileSync(targetPath, attachment.content, "utf8");
        storedPath = targetPath;
      }
    } catch {
      storedPath = "";
    }

    return {
      ...attachment,
      id: path.basename(storedPath || targetPath),
      storedPath,
    };
  });
}

function buildAttachmentCards(attachments) {
  return attachments.map((attachment) => {
    const previewKind = detectPreviewKind(attachment);
    const safeId = attachment.id || path.basename(attachment.storedPath || sanitizeAttachmentName(attachment.name));
    const previewUrl = attachment.storedPath ? `/api/attachments/${encodeURIComponent(safeId)}` : undefined;

    return {
      id: safeId,
      name: attachment.name,
      type: attachment.type || "application/octet-stream",
      size: attachment.size,
      contentMode: attachment.contentMode,
      previewKind,
      previewUrl,
      downloadUrl: previewUrl,
      textExcerpt:
        previewKind === "text"
          ? String(attachment.content || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 180)
          : "",
      storedPath: attachment.storedPath || "",
    };
  });
}

function buildCommandMessage(message, attachments) {
  if (!attachments.length) {
    return message;
  }

  const attachmentBlocks = attachments.map((attachment, index) => {
    const header = `[附件 ${index + 1}] ${attachment.name} (${attachment.type || "unknown"}, ${attachment.size} bytes)`;
    const storageNote = attachment.storedPath ? `已接收并保存到: ${attachment.storedPath}` : "未拿到文件实体，仅保留元数据。";

    if (attachment.contentMode === "inline_text" && attachment.content) {
      return `${header}\n${storageNote}\n内容全文:\n${attachment.content.slice(0, 12000)}`;
    }

    if (attachment.storedPath) {
      return `${header}\n${storageNote}\n请直接读取该本地文件。`;
    }

    return `${header}\n${storageNote}`;
  });

  return `${message}\n\n${attachmentBlocks.join("\n\n")}`;
}

function buildHistoryMessage(message, attachments) {
  if (!attachments.length) {
    return message;
  }

  const summary = attachments
    .map((attachment) => `${attachment.name}${attachment.storedPath ? "（已接收）" : "（元数据）"}`)
    .join("，");

  return `${message || "请查看附件"}\n\n[附件] ${summary}`;
}

function appendContext(agentId, payload) {
  const existing = getContext(agentId);
  const next = {
    messages: [...existing.messages, ...(payload.messages ?? [])].slice(-200),
    toolCalls: [...existing.toolCalls, ...(payload.toolCalls ?? [])].slice(-80),
    updatedAt: payload.updatedAt ?? new Date().toISOString(),
  };
  agentContext.set(agentId, next);
}

function clearCommandProgress(agentId) {
  const timers = commandProgressTimers.get(agentId) ?? [];
  for (const timerId of timers) {
    clearTimeout(timerId);
  }
  commandProgressTimers.delete(agentId);
}

function scheduleProgressEvents(agentId, message) {
  clearCommandProgress(agentId);
  const plannedTools = inferPlannedTools(message);
  const createdAt = Date.now();

  const timers = plannedTools.map((toolName, index) =>
    setTimeout(() => {
      const toolCalls = plannedTools.slice(0, index + 1).map((name, toolIndex) => ({
        id: `planned-${agentId}-${toolIndex}`,
        name,
        status: toolIndex === index ? "running" : "completed",
        summary: toolIndex === index ? `正在执行 ${name}` : `${name} 已完成阶段处理`,
        ts: new Date().toISOString(),
      }));

      broadcast({
        type: "agent.command.progress",
        payload: {
          agentId,
          ts: new Date(createdAt + (index + 1) * 900).toISOString(),
          toolCalls,
        },
      });
    }, (index + 1) * 900),
  );

  commandProgressTimers.set(agentId, timers);
}

function shortTimeFromTs(ts) {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function rememberRealtimeLogId(id) {
  recentRealtimeLogIds.unshift(id);
  if (recentRealtimeLogIds.length > 120) {
    recentRealtimeLogIds.length = 120;
  }
}

function summarizeRealtimeLog(line) {
  if (!line || line.type !== "log") {
    return null;
  }

  const rawMessage = String(line.message ?? "").replace(/\s+/g, " ").trim();
  if (!rawMessage || rawMessage === "[]" || rawMessage.startsWith("{") || rawMessage.startsWith("[")) {
    return null;
  }

  let message = rawMessage;
  if (message.includes("钉钉 Stream 客户端已连接")) {
    message = "钉钉连接已建立";
  } else if (message.includes("启动钉钉 Stream 客户端")) {
    message = "正在启动钉钉连接";
  } else if (message.includes("auto-restart attempt")) {
    message = message.replace(/\[default\]\s*/g, "");
  } else if (message.includes("connect success")) {
    message = "网关连接成功";
  }

  return {
    id: `rt-${line.time}-${line.subsystem ?? "gateway"}-${message}`,
    ts: shortTimeFromTs(line.time ?? Date.now()),
    level: line.level === "error" ? "error" : line.level === "warn" || /restart|retry|disconnect/i.test(message) ? "warn" : "info",
    source: line.subsystem ?? "gateway",
    message: message.slice(0, 160),
  };
}

async function commandInfo(name, versionArgs = ["--version"]) {
  try {
    const { stdout } = await execFileAsync("bash", ["-lc", `command -v ${name}`], {
      env: process.env,
      timeout: 8000,
    });
    const resolvedPath = stdout.trim();
    let version = "";

    try {
      const versionResult = await execFileAsync(name, versionArgs, {
        env: process.env,
        timeout: 8000,
        maxBuffer: 512 * 1024,
      });
      version = (versionResult.stdout || versionResult.stderr).trim().split("\n")[0] || "";
    } catch {
      version = "";
    }

    return {
      name,
      ok: true,
      path: resolvedPath,
      version,
    };
  } catch {
    return {
      name,
      ok: false,
      path: "",
      version: "",
    };
  }
}

async function collectBootstrapStatus() {
  const checks = await Promise.all([
    commandInfo("node"),
    commandInfo("npm"),
    commandInfo("git"),
    commandInfo("python3", ["--version"]),
    commandInfo("openclaw"),
  ]);

  return {
    checks,
    workspaceDir: openclawWorkspaceDir,
    workspaceReady: fs.existsSync(openclawWorkspaceDir),
    configPath: openclawConfigPath,
    configReady: fs.existsSync(openclawConfigPath),
  };
}

async function runBootstrapDeployment() {
  const logs = [];
  const before = await collectBootstrapStatus();
  const openclawInstalled = before.checks.find((check) => check.name === "openclaw")?.ok;

  if (!openclawInstalled) {
    logs.push("未检测到 openclaw，开始安装");
    await execFileAsync("npm", ["install", "-g", "openclaw"], {
      env: process.env,
      timeout: 10 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
    });
    logs.push("openclaw 安装完成");
  } else {
    logs.push("已检测到 openclaw，跳过安装");
  }

  fs.mkdirSync(openclawWorkspaceDir, { recursive: true });
  logs.push(`工作区已准备：${openclawWorkspaceDir}`);

  await execFileAsync(
    "openclaw",
    ["setup", "--non-interactive", "--workspace", openclawWorkspaceDir],
    {
      env: process.env,
      timeout: 2 * 60 * 1000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  logs.push("基础配置已写入");

  await execFileAsync("openclaw", ["doctor", "--non-interactive", "--repair"], {
    env: process.env,
    timeout: 2 * 60 * 1000,
    maxBuffer: 2 * 1024 * 1024,
  });
  logs.push("环境检测与修复完成");

  await execFileAsync("openclaw", ["config", "validate"], {
    env: process.env,
    timeout: 30 * 1000,
    maxBuffer: 512 * 1024,
  });
  logs.push("配置校验通过");

  return {
    ok: true,
    logs,
    status: await collectBootstrapStatus(),
  };
}

function startRealtimeLogFollower() {
  if (controlPlane.mode !== "real") {
    return;
  }

  const child = spawn("openclaw", ["logs", "--json", "--follow", "--limit", "0", "--interval", "1000"], {
    env: process.env,
    stdio: ["ignore", "pipe", "ignore"],
  });

  const reader = createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    let parsed = null;
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = null;
    }

    const event = summarizeRealtimeLog(parsed);
    if (!event || recentRealtimeLogIds.includes(event.id)) {
      return;
    }

    rememberRealtimeLogId(event.id);
    broadcast({
      type: "control-plane.log",
      payload: event,
    });
  });

  child.once("close", () => {
    setTimeout(() => {
      startRealtimeLogFollower();
    }, 2000);
  });
}

app.get("/healthz", (_req, res) => {
  const overview = controlPlane.getOverview();
  res.json({
    ok: true,
    service: "openclaw-cluster-console",
    port,
    source: overview?.source ?? controlPlane.mode,
    updatedAt: overview?.updatedAt ?? null,
  });
});

app.get("/api/overview", (_req, res) => {
  res.json(controlPlane.getOverview());
});

app.get("/api/runtime", (_req, res) => {
  const overview = controlPlane.getOverview();
  res.json({
    mode: controlPlane.mode,
    source: overview?.source ?? controlPlane.mode,
    updatedAt: overview?.updatedAt ?? null,
  });
});

app.get("/api/chat-history/:agentId", (req, res) => {
  const agentId = String(req.params.agentId || "").trim();
  if (!agentId) {
    res.status(400).json({ error: "agentId_required" });
    return;
  }

  res.json({
    ok: true,
    agentId,
    messages: getContext(agentId).messages,
  });
});

app.get("/api/agent-context/:agentId", (req, res) => {
  const agentId = String(req.params.agentId || "").trim();
  if (!agentId) {
    res.status(400).json({ error: "agentId_required" });
    return;
  }

  res.json({
    ok: true,
    agentId,
    ...getContext(agentId),
  });
});

app.get("/api/openclaw/bootstrap", async (_req, res) => {
  try {
    res.json({
      ok: true,
      ...(await collectBootstrapStatus()),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "bootstrap_status_failed",
    });
  }
});

app.post("/api/openclaw/bootstrap", async (_req, res) => {
  try {
    res.json(await runBootstrapDeployment());
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "bootstrap_run_failed",
    });
  }
});

app.get("/api/attachments/:attachmentId", (req, res) => {
  const attachmentId = path.basename(String(req.params.attachmentId || "").trim());
  if (!attachmentId) {
    res.status(400).json({ error: "attachment_id_required" });
    return;
  }

  const attachmentPath = path.join(attachmentStoreDir, attachmentId);
  if (!fs.existsSync(attachmentPath) || !fs.statSync(attachmentPath).isFile()) {
    res.status(404).json({ error: "attachment_not_found" });
    return;
  }

  res.sendFile(attachmentPath);
});

app.get("/api/tasks/:taskId", (req, res) => {
  const task = controlPlane.getTask(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: "task_not_found" });
    return;
  }

  res.json(task);
});

app.post("/api/agent-command", async (req, res) => {
  const agentId = String(req.body?.agentId || "").trim();
  const message = String(req.body?.message || "").trim();
  const attachments = materializeAttachments(normalizeAttachments(req.body?.attachments));
  const historyMessage = buildHistoryMessage(message, attachments);
  const effectiveMessage = buildCommandMessage(message, attachments);
  const ts = new Date().toISOString();

  if (!agentId || !effectiveMessage.trim()) {
    res.status(400).json({ error: "agentId_and_message_required" });
    return;
  }

  const plannedTools = inferPlannedTools(effectiveMessage);
  broadcast({
    type: "agent.command.started",
    payload: {
      agentId,
      message: effectiveMessage,
      ts,
      toolCalls: plannedTools.map((toolName, index) => ({
        id: `planned-${Date.now()}-${index}`,
        name: toolName,
        status: index === 0 ? "running" : "pending",
        summary: index === 0 ? `正在准备执行 ${toolName}` : `${toolName} 等待中`,
        ts,
      })),
    },
  });
  scheduleProgressEvents(agentId, effectiveMessage);

  if (controlPlane.mode === "mock" || controlPlane.getOverview()?.source === "mock") {
    const reply = `模拟回复：${agentId} 已收到指令“${message || "附件请求"}”`;
    const toolName = /搜索|查|research/i.test(message)
      ? "web_search"
      : /代码|文件|patch|修/i.test(message)
        ? "patch"
        : "route";
    const attachmentCards = buildAttachmentCards(attachments);
    appendContext(agentId, {
      messages: [
        { id: `u-${Date.now()}`, side: "user", text: historyMessage, ts, attachments: attachmentCards },
        { id: `a-${Date.now()}`, side: "agent", text: reply, ts: new Date().toISOString() },
      ],
      toolCalls: [
        {
          id: `tool-${Date.now()}`,
          name: toolName,
          status: "completed",
          summary: `模拟执行 ${toolName}，处理指令：${message || "附件请求"}`,
          ts: new Date().toISOString(),
        },
      ],
    });
    clearCommandProgress(agentId);
    broadcast({
      type: "agent.command.completed",
      payload: {
        agentId,
        ts: new Date().toISOString(),
        context: getContext(agentId),
      },
    });
    res.json({
      ok: true,
      mode: "mock",
      agentId,
      reply,
      raw: null,
    });
    return;
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      "openclaw",
      ["agent", "--agent", agentId, "--message", effectiveMessage, "--json"],
      {
        timeout: 180000,
        maxBuffer: 2 * 1024 * 1024,
        env: process.env,
      },
    );

    const output = stdout.trim() || stderr.trim();
    let parsed = null;
    try {
      parsed = JSON.parse(output);
    } catch {
      parsed = null;
    }

    const reply =
      parsed?.result?.payloads?.[0]?.text ??
      parsed?.result?.payloads?.map?.((item) => item?.text).filter(Boolean).join("\n") ??
      parsed?.result?.text ??
      parsed?.text ??
      parsed?.reply ??
      parsed?.message ??
      parsed?.output ??
      output;
    const attachmentCards = buildAttachmentCards(attachments);

    appendContext(agentId, {
      messages: [
        { id: `u-${Date.now()}`, side: "user", text: historyMessage, ts, attachments: attachmentCards },
        { id: `a-${Date.now()}`, side: "agent", text: reply, ts: new Date().toISOString() },
      ],
      toolCalls: extractToolCalls(parsed),
    });
    clearCommandProgress(agentId);
    broadcast({
      type: "agent.command.completed",
      payload: {
        agentId,
        ts: new Date().toISOString(),
        context: getContext(agentId),
      },
    });

    res.json({
      ok: true,
      mode: "real",
      agentId,
      reply,
      raw: parsed ?? output,
    });
  } catch (error) {
    const errorText = error instanceof Error ? error.message : "agent_command_failed";
    const attachmentCards = buildAttachmentCards(attachments);
    appendContext(agentId, {
      messages: [
        { id: `u-${Date.now()}`, side: "user", text: historyMessage, ts, attachments: attachmentCards },
        { id: `a-${Date.now()}`, side: "agent", text: errorText, ts: new Date().toISOString() },
      ],
      toolCalls: [
        {
          id: `tool-${Date.now()}`,
          name: "agent_command",
          status: "failed",
          summary: errorText,
          ts: new Date().toISOString(),
        },
      ],
    });
    clearCommandProgress(agentId);
    broadcast({
      type: "agent.command.failed",
      payload: {
        agentId,
        ts: new Date().toISOString(),
        context: getContext(agentId),
        error: errorText,
      },
    });
    res.status(500).json({
      ok: false,
      error: errorText,
    });
  }
});

app.use(express.static(publicDir));

app.get(/.*/, (_req, res) => {
  const entryFile = path.join(publicDir, "index.html");
  if (fs.existsSync(entryFile)) {
    res.sendFile(entryFile);
    return;
  }

  res.status(503).json({
    error: "frontend_not_built",
    hint: "Run `npm run build` before `npm start`.",
  });
});

const server = app.listen(port, "0.0.0.0", () => {
  const overview = controlPlane.getOverview();
  console.log(
    `OpenClaw cluster console listening on http://localhost:${port} (source=${overview?.source ?? controlPlane.mode})`,
  );
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "control-plane.bootstrap",
      payload: controlPlane.getOverview(),
    }),
  );
});

startRealtimeLogFollower();

setInterval(async () => {
  try {
    const message = JSON.stringify(await controlPlane.tick());
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  } catch (error) {
    console.error("[control-plane] tick failed");
    console.error(error instanceof Error ? error.message : error);
  }
}, tickIntervalMs);
