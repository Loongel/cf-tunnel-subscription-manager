import { requireAgent } from "./auth";
import { all, first, run } from "./db";
import type { AgentHeartbeatBody, AgentRegisterBody, Env, JsonRecord, TunnelRow, TunnelStatusBody } from "./types";
import { HttpError, json, makeId, normalizeHostname, nowIso, readJson, requiredString, safeJson } from "./utils";

interface CommandRow {
  id: string;
  agent_id: string;
  tunnel_id: string | null;
  type: string;
  payload_json: string;
  created_at: string;
}

export async function handleAgentApi(request: Request, env: Env, url: URL): Promise<Response> {
  requireAgent(request, env);
  const path = url.pathname;

  if (request.method === "POST" && path === "/api/agent/register") {
    const body = await readJson<AgentRegisterBody>(request);
    await upsertAgent(env, body);
    await insertEvent(env, body.agentId, null, "agent_register", "info", "agent registered", body.capabilities || {});
    return json({ ok: true });
  }

  if (request.method === "POST" && path === "/api/agent/heartbeat") {
    const body = await readJson<AgentHeartbeatBody>(request);
    await upsertAgent(env, body);
    const reportedTunnelKeys: string[] = [];
    for (const tunnel of body.tunnels || []) {
      if (typeof tunnel.tunnelKey === "string" && tunnel.tunnelKey.trim() !== "") {
        reportedTunnelKeys.push(tunnel.tunnelKey.trim());
      }
      await upsertTunnel(env, body, tunnel);
    }
    if (Array.isArray(body.tunnels)) {
      await deleteMissingAgentTunnels(env, requiredString(body.agentId, "agentId"), reportedTunnelKeys);
    }
    return json({ ok: true });
  }

  if (request.method === "POST" && path === "/api/agent/events") {
    const body = await readJson<JsonRecord>(request);
    const agentId = requiredString(body.agentId, "agentId");
    await insertEvent(
      env,
      agentId,
      typeof body.tunnelId === "string" ? body.tunnelId : null,
      typeof body.eventType === "string" ? body.eventType : "agent_event",
      typeof body.severity === "string" ? body.severity : "info",
      typeof body.message === "string" ? body.message : null,
      body
    );
    return json({ ok: true });
  }

  if (request.method === "GET" && path === "/api/agent/commands") {
    const agentId = requiredString(url.searchParams.get("agentId"), "agentId");
    const rows = await all<CommandRow>(
      env.DB,
      `SELECT * FROM commands
       WHERE agent_id = ? AND status = 'pending' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       ORDER BY created_at
       LIMIT 10`,
      agentId
    );
    for (const row of rows) {
      await run(env.DB, "UPDATE commands SET status = 'running', claimed_at = ? WHERE id = ?", nowIso(), row.id);
    }
    return json({
      commands: rows.map((row) => ({
        id: row.id,
        type: row.type,
        tunnelId: row.tunnel_id,
        payload: parsePayload(row.payload_json),
        createdAt: row.created_at
      }))
    });
  }

  const ackMatch = /^\/api\/agent\/commands\/([^/]+)\/ack$/.exec(path);
  if (request.method === "POST" && ackMatch) {
    const commandId = ackMatch[1];
    const body = await readJson<JsonRecord>(request);
    const status = body.status === "failed" ? "failed" : "succeeded";
    await run(
      env.DB,
      "UPDATE commands SET status = ?, finished_at = ?, result_json = ? WHERE id = ?",
      status,
      nowIso(),
      safeJson(body.result || body),
      commandId
    );
    return json({ ok: true });
  }

  throw new HttpError(404, "agent route not found");
}

async function upsertAgent(env: Env, body: AgentRegisterBody): Promise<void> {
  const agentId = requiredString(body.agentId, "agentId");
  const timestamp = nowIso();
  await run(
    env.DB,
    `INSERT INTO agents (
      id, instance_id, hostname, swarm_node_name, stack_name, service_name,
      image_version, cloudflared_version, status, capabilities_json, last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'online', ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      instance_id = excluded.instance_id,
      hostname = excluded.hostname,
      swarm_node_name = excluded.swarm_node_name,
      stack_name = excluded.stack_name,
      service_name = excluded.service_name,
      image_version = excluded.image_version,
      cloudflared_version = excluded.cloudflared_version,
      status = 'online',
      capabilities_json = excluded.capabilities_json,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at`,
    agentId,
    body.instanceId || null,
    body.hostname || null,
    body.swarmNodeName || null,
    body.stackName || null,
    body.serviceName || null,
    body.imageVersion || null,
    body.cloudflaredVersion || null,
    safeJson(body.capabilities || {}),
    timestamp,
    timestamp,
    timestamp
  );
}

async function upsertTunnel(env: Env, agent: AgentHeartbeatBody, tunnel: TunnelStatusBody): Promise<void> {
  const agentId = requiredString(agent.agentId, "agentId");
  const tunnelKey = requiredString(tunnel.tunnelKey, "tunnelKey");
  const tunnelId = stableTunnelId(agentId, tunnelKey);
  const current = await first<TunnelRow>(env.DB, "SELECT * FROM tunnels WHERE id = ?", tunnelId);
  const publicHostname = tunnel.publicHostname || normalizeHostname(tunnel.publicUrl) || null;
  const publicUrl = tunnel.publicUrl || (publicHostname ? `https://${publicHostname}` : null);
  const urlChanged = current && current.public_url !== publicUrl;
  const timestamp = nowIso();

  await run(
    env.DB,
    `INSERT INTO tunnels (
      id, agent_id, tunnel_key, type, target_url, public_url, public_hostname,
      swarm_node_name, metrics_port, process_status, health_status, last_error,
      restart_count, started_at, last_seen_at, last_url_changed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      target_url = excluded.target_url,
      public_url = excluded.public_url,
      public_hostname = excluded.public_hostname,
      swarm_node_name = excluded.swarm_node_name,
      metrics_port = excluded.metrics_port,
      process_status = excluded.process_status,
      health_status = excluded.health_status,
      last_error = excluded.last_error,
      restart_count = excluded.restart_count,
      started_at = excluded.started_at,
      last_seen_at = excluded.last_seen_at,
      last_url_changed_at = CASE
        WHEN tunnels.public_url IS NOT excluded.public_url THEN excluded.last_url_changed_at
        ELSE tunnels.last_url_changed_at
      END,
      updated_at = excluded.updated_at`,
    tunnelId,
    agentId,
    tunnelKey,
    tunnel.type,
    tunnel.targetUrl || null,
    publicUrl,
    publicHostname,
    agent.swarmNodeName || null,
    tunnel.metricsPort || null,
    tunnel.processStatus || tunnel.status || "unknown",
    tunnel.healthStatus || tunnel.health || "unknown",
    tunnel.lastError || null,
    tunnel.restartCount || 0,
    tunnel.startedAt || null,
    tunnel.lastSeenAt || timestamp,
    timestamp,
    timestamp,
    timestamp
  );

  if (urlChanged) {
    await insertEvent(env, agentId, tunnelId, "tunnel_url_changed", "info", `${tunnelKey} URL changed`, {
      oldPublicUrl: current?.public_url || null,
      newPublicUrl: publicUrl,
      targetUrl: tunnel.targetUrl || null
    });
  }
}

async function deleteMissingAgentTunnels(env: Env, agentId: string, reportedTunnelKeys: string[]): Promise<void> {
  if (reportedTunnelKeys.length === 0) {
    await run(env.DB, "DELETE FROM tunnels WHERE agent_id = ?", agentId);
    return;
  }
  const unique = Array.from(new Set(reportedTunnelKeys));
  const placeholders = unique.map(() => "?").join(", ");
  await run(
    env.DB,
    `DELETE FROM tunnels WHERE agent_id = ? AND tunnel_key NOT IN (${placeholders})`,
    agentId,
    ...unique
  );
}

export async function insertEvent(
  env: Env,
  agentId: string | null,
  tunnelId: string | null,
  eventType: string,
  severity: string,
  message: string | null,
  details: unknown
): Promise<void> {
  await run(
    env.DB,
    `INSERT INTO tunnel_events (id, agent_id, tunnel_id, event_type, severity, message, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    makeId("evt"),
    agentId,
    tunnelId,
    eventType,
    severity,
    message,
    safeJson(details),
    nowIso()
  );
}

function parsePayload(input: string): JsonRecord {
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonRecord) : {};
  } catch {
    return {};
  }
}

function stableTunnelId(agentId: string, tunnelKey: string): string {
  const safe = `${agentId}_${tunnelKey}`.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `tun_${safe.slice(0, 96)}`;
}
