import { insertEvent } from "./agent-api";
import { all, first, run } from "./db";
import { cleanupStaleTunnels } from "./tunnel-registry";
import type { Env, TunnelRow } from "./types";
import { makeId, nowIso, safeJson } from "./utils";

const HEALTHY_STATUS = new Set([200, 204, 301, 302, 401, 403, 404]);
const RESTART_FAILURE_THRESHOLD = 3;
const RESTART_COOLDOWN_SECONDS = 610;
const AGENT_STALE_SECONDS = 360;

interface PendingRow {
  count: number;
}

export async function runScheduled(env: Env): Promise<void> {
  await expireCommands(env);
  await markStaleAgents(env);
  await cleanupStaleTunnels(env);
  await probeHttpTunnels(env);
}

async function expireCommands(env: Env): Promise<void> {
  await run(
    env.DB,
    `UPDATE commands
     SET status = 'expired', finished_at = ?
     WHERE status IN ('pending', 'running') AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP`,
    nowIso()
  );
}

async function markStaleAgents(env: Env): Promise<void> {
  await run(
    env.DB,
    `UPDATE agents
     SET status = 'stale', updated_at = ?
     WHERE status = 'online' AND last_seen_at IS NOT NULL
       AND unixepoch(?) - unixepoch(last_seen_at) > ?`,
    nowIso(),
    nowIso(),
    AGENT_STALE_SECONDS
  );
}

async function probeHttpTunnels(env: Env): Promise<void> {
  const tunnels = await all<TunnelRow>(
    env.DB,
    `SELECT * FROM tunnels
     WHERE type = 'quick' AND public_url IS NOT NULL
       AND (public_url LIKE 'http://%' OR public_url LIKE 'https://%')
     ORDER BY updated_at DESC
     LIMIT 50`
  );

  for (const tunnel of tunnels) {
    await probeOne(env, tunnel);
  }
}

async function probeOne(env: Env, tunnel: TunnelRow): Promise<void> {
  const timestamp = nowIso();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(tunnel.public_url as string, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal
    });
    const healthy = HEALTHY_STATUS.has(response.status);
    if (healthy) {
      await run(
        env.DB,
        `UPDATE tunnels SET health_status = 'healthy', last_probe_status = ?, failure_count = 0, updated_at = ?
         WHERE id = ?`,
        String(response.status),
        timestamp,
        tunnel.id
      );
      return;
    }
    await recordFailure(env, tunnel, `HTTP ${response.status}`);
  } catch (error) {
    await recordFailure(env, tunnel, error instanceof Error ? error.message : "probe failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function recordFailure(env: Env, tunnel: TunnelRow, reason: string): Promise<void> {
  const timestamp = nowIso();
  const nextFailureCount = tunnel.failure_count + 1;
  const nextHealth = nextFailureCount >= RESTART_FAILURE_THRESHOLD ? "unhealthy" : "degraded";
  await run(
    env.DB,
    `UPDATE tunnels SET health_status = ?, last_probe_status = ?, failure_count = ?, updated_at = ?
     WHERE id = ?`,
    nextHealth,
    reason,
    nextFailureCount,
    timestamp,
    tunnel.id
  );
  await insertEvent(env, tunnel.agent_id, tunnel.id, "probe_failed", "warning", reason, {
    publicUrl: tunnel.public_url,
    failureCount: nextFailureCount
  });

  if (nextFailureCount >= RESTART_FAILURE_THRESHOLD && canRestart(tunnel)) {
    await queueRestartCommand(env, tunnel, "cron", reason);
  }
}

function canRestart(tunnel: TunnelRow): boolean {
  if (!tunnel.last_restart_command_at) return true;
  const previous = Date.parse(tunnel.last_restart_command_at);
  if (Number.isNaN(previous)) return true;
  return Date.now() - previous > RESTART_COOLDOWN_SECONDS * 1000;
}

export async function queueRestartCommand(
  env: Env,
  tunnel: TunnelRow,
  createdBy: "cron" | "admin" | "system",
  reason: string
): Promise<string | null> {
  const pending = await first<PendingRow>(
    env.DB,
    `SELECT COUNT(*) AS count FROM commands
     WHERE tunnel_id = ? AND status IN ('pending', 'running')`,
    tunnel.id
  );
  if ((pending?.count || 0) > 0) return null;

  const commandId = makeId("cmd");
  const payload = {
    tunnelId: tunnel.id,
    tunnelKey: tunnel.tunnel_key,
    targetUrl: tunnel.target_url,
    reason
  };
  await run(
    env.DB,
    `INSERT INTO commands (id, agent_id, tunnel_id, type, payload_json, status, created_by, created_at, expires_at)
     VALUES (?, ?, ?, 'restart_tunnel', ?, 'pending', ?, ?, datetime('now', '+10 minutes'))`,
    commandId,
    tunnel.agent_id,
    tunnel.id,
    safeJson(payload),
    createdBy,
    nowIso()
  );
  await run(env.DB, "UPDATE tunnels SET last_restart_command_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), tunnel.id);
  await insertEvent(env, tunnel.agent_id, tunnel.id, "restart_command_created", "warning", "restart command created", payload);
  return commandId;
}
