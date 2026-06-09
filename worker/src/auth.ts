import type { Env } from "./types";
import { getBearerToken, HttpError, sameToken } from "./utils";

export function requireAdmin(request: Request, env: Env): void {
  if (!sameToken(getBearerToken(request), env.ADMIN_TOKEN)) {
    throw new HttpError(401, "admin token required");
  }
}

export function requireAgent(request: Request, env: Env): void {
  if (!sameToken(getBearerToken(request), env.AGENT_TOKEN)) {
    throw new HttpError(401, "agent token required");
  }
}
