import { first, run } from "./db";
import type { Env } from "./types";
import { makeSecret, nowIso } from "./utils";

interface SettingRow {
  value: string;
}

const SUBSCRIPTION_TOKEN_KEY = "subscription_token";

export async function getSubscriptionToken(env: Env): Promise<string> {
  const row = await first<SettingRow>(env.DB, "SELECT value FROM settings WHERE key = ?", SUBSCRIPTION_TOKEN_KEY);
  return row?.value || env.SUBSCRIPTION_TOKEN;
}

export async function rotateSubscriptionToken(env: Env): Promise<string> {
  const token = makeSecret("sub");
  await run(
    env.DB,
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    SUBSCRIPTION_TOKEN_KEY,
    token,
    nowIso()
  );
  return token;
}

export function subscriptionUrls(base: string, token: string): Record<string, string> {
  return {
    v2ray: `${base}/sub/v2ray/${encodeURIComponent(token)}`,
    passwall2: `${base}/sub/passwall2/${encodeURIComponent(token)}`,
    singBox: `${base}/sub/sing-box/${encodeURIComponent(token)}`
  };
}
