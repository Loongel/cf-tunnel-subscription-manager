import type { GeneratedNode, JsonRecord, PreferredEndpointRow, ProxyNodeRow } from "./types";

export interface MutationContext {
  node: ProxyNodeRow;
  tunnelHost?: string | null;
  endpoint?: PreferredEndpointRow | null;
  format: "v2ray" | "passwall2" | "sing-box";
}

export function inferProtocol(raw: string, sourceType?: string): string {
  const trimmed = raw.trim();
  if (sourceType === "sing_box_outbound") return "sing-box";
  if (/^vless:\/\//i.test(trimmed)) return "vless";
  if (/^vmess:\/\//i.test(trimmed)) return "vmess";
  if (/^trojan:\/\//i.test(trimmed)) return "trojan";
  if (/^ss:\/\//i.test(trimmed)) return "shadowsocks";
  try {
    const parsed = JSON.parse(trimmed) as JsonRecord;
    if (typeof parsed.type === "string") return parsed.type;
    if (Array.isArray(parsed.outbounds)) return "sing-box";
  } catch {
    // keep unknown
  }
  return "unknown";
}

export function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function hasEdgeOverride(ctx: MutationContext): boolean {
  return Boolean(ctx.endpoint || ctx.tunnelHost);
}

export function decodeBase64(input: string): string {
  const normalized = input.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function displayName(node: ProxyNodeRow, endpoint?: PreferredEndpointRow | null): string {
  const suffix = endpoint ? endpoint.label || endpoint.value : "tunnel";
  return endpoint ? `${node.name} | ${suffix}` : node.name;
}

function targetServer(ctx: MutationContext): string | null {
  return ctx.endpoint?.value || ctx.tunnelHost || null;
}

function targetPort(rawPort: string | null, ctx: MutationContext): string {
  if (hasEdgeOverride(ctx)) return "443";
  return rawPort && rawPort !== "" ? rawPort : "443";
}

function tunnelHost(ctx: MutationContext): string | null {
  return ctx.tunnelHost || ctx.endpoint?.value || null;
}

function mutateUrlUri(raw: string, ctx: MutationContext): string {
  const url = new URL(raw);
  const server = targetServer(ctx);
  if (!server) return raw;
  const host = tunnelHost(ctx) || server;
  url.hostname = server;
  url.port = targetPort(url.port, ctx);
  url.hash = `#${encodeURIComponent(displayName(ctx.node, ctx.endpoint))}`;
  if (ctx.node.use_tunnel && ctx.tunnelHost) {
    const keys = ["sni", "peer"];
    for (const key of keys) {
      if (url.searchParams.has(key) || key === "sni") url.searchParams.set(key, host);
    }
    const type = (url.searchParams.get("type") || "").toLowerCase();
    if (type === "ws" || url.searchParams.has("host")) {
      url.searchParams.set("host", host);
    }
    if (type === "grpc" && !url.searchParams.has("serviceName")) {
      url.searchParams.set("serviceName", "");
    }
  }
  return url.toString();
}

function mutateVmess(raw: string, ctx: MutationContext): string {
  const encoded = raw.replace(/^vmess:\/\//i, "");
  const parsed = JSON.parse(decodeBase64(encoded)) as JsonRecord;
  const server = targetServer(ctx);
  if (!server) return raw;
  const host = tunnelHost(ctx) || server;
  parsed.add = server;
  parsed.port = targetPort(typeof parsed.port === "string" || typeof parsed.port === "number" ? String(parsed.port) : null, ctx);
  parsed.ps = displayName(ctx.node, ctx.endpoint);
  if (ctx.node.use_tunnel && ctx.tunnelHost) {
    parsed.sni = host;
    parsed.host = host;
  }
  return `vmess://${encodeBase64(JSON.stringify(parsed))}`;
}

function parseShadowsocks(raw: string, ctx: MutationContext): string {
  const hashIndex = raw.indexOf("#");
  const body = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const queryIndex = body.indexOf("?");
  const query = queryIndex >= 0 ? body.slice(queryIndex) : "";
  const label = `#${encodeURIComponent(displayName(ctx.node, ctx.endpoint))}`;
  if (!body.includes("@")) {
    const details = parseShadowsocksDetails(raw);
    const server = targetServer(ctx);
    if (!details || !server) return raw;
    const credential = encodeBase64(`${details.method}:${details.password}`);
    return `ss://${credential}@${server}:${targetPort(String(details.serverPort), ctx)}${query}${label}`;
  }
  const url = new URL(body);
  const server = targetServer(ctx);
  if (!server) return raw;
  url.hostname = server;
  url.port = targetPort(url.port, ctx);
  const params = url.searchParams;
  if (ctx.node.use_tunnel && ctx.tunnelHost && params.has("plugin")) {
    const plugin = params.get("plugin") || "";
    if (!/host=/i.test(plugin)) {
      params.set("plugin", `${plugin};host=${ctx.tunnelHost}`);
    }
  }
  return `${url.toString()}${label}`;
}

function parseShadowsocksDetails(raw: string): {
  method: string;
  password: string;
  serverPort: number;
} | null {
  const withoutScheme = raw.replace(/^ss:\/\//i, "");
  const withoutHash = withoutScheme.split("#")[0];
  const withoutQuery = withoutHash.split("?")[0];
  let credentialPart = "";
  let serverPart = "";

  if (withoutQuery.includes("@")) {
    const idx = withoutQuery.lastIndexOf("@");
    credentialPart = decodeURIComponent(withoutQuery.slice(0, idx));
    serverPart = withoutQuery.slice(idx + 1);
    if (!credentialPart.includes(":")) {
      try {
        credentialPart = decodeBase64(credentialPart);
      } catch {
        return null;
      }
    }
  } else {
    try {
      const decoded = decodeBase64(withoutQuery);
      const idx = decoded.lastIndexOf("@");
      if (idx < 0) return null;
      credentialPart = decoded.slice(0, idx);
      serverPart = decoded.slice(idx + 1);
    } catch {
      return null;
    }
  }

  const credentialIdx = credentialPart.indexOf(":");
  const portIdx = serverPart.lastIndexOf(":");
  if (credentialIdx < 0 || portIdx < 0) return null;
  const port = Number(serverPart.slice(portIdx + 1));
  if (!Number.isFinite(port)) return null;
  return {
    method: credentialPart.slice(0, credentialIdx),
    password: credentialPart.slice(credentialIdx + 1),
    serverPort: port
  };
}

export function mutateShareUri(raw: string, ctx: MutationContext): GeneratedNode {
  const protocol = inferProtocol(raw, ctx.node.source_type);
  const base: GeneratedNode = {
    id: `${ctx.node.id}:${ctx.endpoint?.id || "direct"}`,
    sourceNodeId: ctx.node.id,
    sourceName: ctx.node.name,
    endpointId: ctx.endpoint?.id,
    endpointValue: ctx.endpoint?.value,
    endpointType: ctx.endpoint?.type,
    tunnelHost: ctx.tunnelHost || undefined,
    protocol
  };
  try {
    if (protocol === "vless" || protocol === "trojan") {
      return { ...base, uri: mutateUrlUri(raw, ctx) };
    }
    if (protocol === "vmess") {
      return { ...base, uri: mutateVmess(raw, ctx) };
    }
    if (protocol === "shadowsocks") {
      return { ...base, uri: parseShadowsocks(raw, ctx) };
    }
    return { ...base, skipped: true, reason: `unsupported protocol: ${protocol}` };
  } catch (error) {
    return {
      ...base,
      skipped: true,
      reason: error instanceof Error ? error.message : "failed to mutate share URI"
    };
  }
}

function cloneRecord(input: JsonRecord): JsonRecord {
  return JSON.parse(JSON.stringify(input)) as JsonRecord;
}

function mutateOutboundObject(raw: JsonRecord, ctx: MutationContext): JsonRecord {
  const output = cloneRecord(raw);
  const server = targetServer(ctx);
  if (!server) return output;
  output.server = server;
  output.server_port = Number(targetPort(
    typeof output.server_port === "string" || typeof output.server_port === "number" ? String(output.server_port) : null,
    ctx
  ));
  output.tag = displayName(ctx.node, ctx.endpoint);
  if (ctx.node.use_tunnel && ctx.tunnelHost) {
    const tls = typeof output.tls === "object" && output.tls !== null && !Array.isArray(output.tls)
      ? (output.tls as JsonRecord)
      : {};
    tls.enabled = tls.enabled ?? true;
    tls.server_name = ctx.tunnelHost;
    output.tls = tls;

    const transport = typeof output.transport === "object" && output.transport !== null && !Array.isArray(output.transport)
      ? (output.transport as JsonRecord)
      : {};
    if ((transport.type === "ws" || transport.type === "http") && ctx.tunnelHost) {
      const headers = typeof transport.headers === "object" && transport.headers !== null && !Array.isArray(transport.headers)
        ? (transport.headers as JsonRecord)
        : {};
      headers.Host = ctx.tunnelHost;
      transport.headers = headers;
      output.transport = transport;
    }
  }
  return output;
}

export function toSingBoxOutbound(raw: string, ctx: MutationContext): GeneratedNode {
  const protocol = inferProtocol(raw, ctx.node.source_type);
  const base: GeneratedNode = {
    id: `${ctx.node.id}:${ctx.endpoint?.id || "direct"}`,
    sourceNodeId: ctx.node.id,
    sourceName: ctx.node.name,
    endpointId: ctx.endpoint?.id,
    endpointValue: ctx.endpoint?.value,
    endpointType: ctx.endpoint?.type,
    tunnelHost: ctx.tunnelHost || undefined,
    protocol
  };

  try {
    const parsed = JSON.parse(raw) as JsonRecord;
    if (Array.isArray(parsed.outbounds)) {
      return { ...base, outbound: mutateOutboundObject(parsed.outbounds[0] as JsonRecord, ctx) };
    }
    if (typeof parsed.type === "string") {
      return { ...base, outbound: mutateOutboundObject(parsed, ctx) };
    }
  } catch {
    // fall through to share URI conversion
  }

  const server = targetServer(ctx);
  if (!server) return { ...base, skipped: true, reason: "missing server" };
  const tag = displayName(ctx.node, ctx.endpoint);
  try {
    if (protocol === "vless" || protocol === "trojan") {
      const url = new URL(raw);
      const outbound: JsonRecord = {
        type: protocol,
        tag,
        server,
        server_port: Number(targetPort(url.port, ctx)),
        tls: { enabled: true, server_name: ctx.tunnelHost || server }
      };
      if (protocol === "vless") {
        outbound.uuid = decodeURIComponent(url.username);
      } else {
        outbound.password = decodeURIComponent(url.username);
      }
      const network = url.searchParams.get("type");
      if (network === "ws") {
        outbound.transport = {
          type: "ws",
          path: url.searchParams.get("path") || "/",
          headers: { Host: ctx.tunnelHost || server }
        } as unknown as JsonRecord;
      }
      return { ...base, outbound };
    }
    if (protocol === "vmess") {
      const vmess = JSON.parse(decodeBase64(raw.replace(/^vmess:\/\//i, ""))) as JsonRecord;
      return {
        ...base,
        outbound: {
          type: "vmess",
          tag,
          server,
          server_port: Number(targetPort(typeof vmess.port === "string" || typeof vmess.port === "number" ? String(vmess.port) : null, ctx)),
          uuid: typeof vmess.id === "string" ? vmess.id : "",
          security: typeof vmess.scy === "string" ? vmess.scy : "auto",
          tls: { enabled: true, server_name: ctx.tunnelHost || server }
        } as JsonRecord
      };
    }
    if (protocol === "shadowsocks") {
      const details = parseShadowsocksDetails(raw);
      if (!details) return { ...base, skipped: true, reason: "unsupported Shadowsocks URI shape" };
      return {
        ...base,
        outbound: {
          type: "shadowsocks",
          tag,
          server,
          server_port: Number(targetPort(String(details.serverPort), ctx)),
          method: details.method,
          password: details.password
        }
      };
    }
    return { ...base, skipped: true, reason: `unsupported protocol: ${protocol}` };
  } catch (error) {
    return {
      ...base,
      skipped: true,
      reason: error instanceof Error ? error.message : "failed to build sing-box outbound"
    };
  }
}
