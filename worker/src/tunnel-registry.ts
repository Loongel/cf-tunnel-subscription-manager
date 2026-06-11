import { run } from "./db";
import type { Env } from "./types";
import { nowIso } from "./utils";

export interface TunnelIdentity {
  swarm_node_name?: string | null;
  target_url?: string | null;
  remark?: string | null;
}

export function tunnelTrafficKey(tunnel: TunnelIdentity): string | null {
  const swarmNode = (tunnel.swarm_node_name || "").trim();
  const targetUrl = (tunnel.target_url || "").trim();
  if (!swarmNode || !targetUrl) return null;
  return `swarm:${swarmNode}|target:${targetUrl}`;
}

export function tunnelTrafficLabel(tunnel: TunnelIdentity): string {
  if (tunnel.remark && tunnel.remark.trim()) return tunnel.remark.trim();
  const swarmNode = (tunnel.swarm_node_name || "unknown-node").trim();
  const targetUrl = (tunnel.target_url || "unknown-target").trim();
  return `${swarmNode} -> ${targetUrl}`;
}

export async function cleanupStaleTunnels(env: Env): Promise<void> {
  const timestamp = nowIso();
  await run(
    env.DB,
    `DELETE FROM tunnels
     WHERE type = 'quick'
       AND (
         (public_hostname IS NULL
          AND unixepoch(?) - unixepoch(COALESCE(last_seen_at, updated_at, created_at)) > 300)
         OR
         (health_status IN ('unknown', 'degraded', 'unhealthy')
          AND unixepoch(?) - unixepoch(COALESCE(last_seen_at, updated_at, created_at)) > 900)
         OR
         (agent_id IN (SELECT id FROM agents WHERE status IN ('stale', 'offline'))
          AND unixepoch(?) - unixepoch(COALESCE(last_seen_at, updated_at, created_at)) > 300)
       )`,
    timestamp,
    timestamp,
    timestamp
  );
}
