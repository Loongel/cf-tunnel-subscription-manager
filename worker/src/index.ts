import { handleAdminApi, handlePublicApi, refreshEnabledImportSources } from "./admin-api";
import { handleAgentApi } from "./agent-api";
import { runScheduled } from "./cron";
import { getSubscriptionToken } from "./settings";
import { buildSubscription, parseSubscriptionOptions } from "./subscriptions";
import type { Env, SubscriptionOptions } from "./types";
import { html, HttpError, json, routeError, sameToken } from "./utils";
import { renderAdminUi } from "./ui";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
            "access-control-allow-headers": "authorization,content-type"
          }
        });
      }

      if (url.pathname === "/" || url.pathname === "/admin") {
        return html(renderAdminUi(env));
      }
      if (url.pathname.startsWith("/api/agent/")) {
        return await handleAgentApi(request, env, url);
      }
      if (url.pathname.startsWith("/api/public/")) {
        return await handlePublicApi(request, env, url);
      }
      if (url.pathname.startsWith("/api/admin/")) {
        return await handleAdminApi(request, env, url);
      }
      if (url.pathname.startsWith("/sub/")) {
        return await handleSubscription(env, url);
      }
      if (url.pathname === "/health") {
        return json({ ok: true });
      }
      throw new HttpError(404, "route not found");
    } catch (error) {
      return routeError(error);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(Promise.all([
      runScheduled(env),
      refreshEnabledImportSources(env)
    ]).then(() => undefined));
  }
};

async function handleSubscription(env: Env, url: URL): Promise<Response> {
  const match = /^\/sub\/(v2ray|passwall2|sing-box)\/([^/]+)$/.exec(url.pathname);
  if (!match) throw new HttpError(404, "subscription route not found");
  const format = match[1] as SubscriptionOptions["format"];
  const token = decodeURIComponent(match[2]);
  const expected = await getSubscriptionToken(env);
  if (!sameToken(token, expected)) {
    throw new HttpError(401, "subscription token required");
  }

  const cacheKey = `sub:${format}:${url.search}`;
  if (env.SUB_CACHE) {
    const cached = await env.SUB_CACHE.get(cacheKey);
    if (cached) {
      return new Response(cached, {
        headers: { "content-type": format === "sing-box" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8" }
      });
    }
  }

  const result = await buildSubscription(env, parseSubscriptionOptions(format, url));
  if (env.SUB_CACHE) {
    await env.SUB_CACHE.put(cacheKey, result.content, { expirationTtl: 300 });
  }
  return new Response(result.content, {
    headers: {
      "content-type": result.contentType,
      "cache-control": "private, max-age=300"
    }
  });
}
