import type { GeneratedNode, JsonRecord, PreferredEndpointRow, ProxyNodeRow } from "./types";

export interface MutationContext {
  node: ProxyNodeRow;
  tunnelHost?: string | null;
  trafficLabel?: string | null;
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
  if (/^(hysteria2|hy2):\/\//i.test(trimmed)) return "hysteria2";
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

function displayName(ctx: MutationContext): string {
  const parts = [ctx.node.name];
  if (ctx.endpoint) parts.push(ctx.endpoint.label || ctx.endpoint.value);
  if (ctx.trafficLabel) parts.push(ctx.trafficLabel);
  return parts.join(" | ");
}

export function parseEndpointTarget(value: string): { host: string; port?: string } {
  const trimmed = value.trim();
  if (!trimmed) return { host: "" };
  try {
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : new URL(`endpoint://${trimmed}`);
    return {
      host: url.hostname,
      port: url.port || undefined
    };
  } catch {
    // fall through
  }

  if (trimmed.startsWith("[") && trimmed.includes("]")) {
    const end = trimmed.indexOf("]");
    const host = trimmed.slice(1, end);
    const suffix = trimmed.slice(end + 1);
    return suffix.startsWith(":") && /^\d+$/.test(suffix.slice(1))
      ? { host, port: suffix.slice(1) }
      : { host };
  }

  const colonCount = (trimmed.match(/:/g) || []).length;
  if (colonCount === 1) {
    const [host, port] = trimmed.split(":");
    if (host && /^\d+$/.test(port || "")) return { host, port };
  }
  return { host: trimmed };
}

function endpointTarget(ctx: MutationContext): { host: string; port?: string } | null {
  if (!ctx.endpoint) return null;
  const target = parseEndpointTarget(ctx.endpoint.value);
  return target.host ? target : null;
}

function targetServer(ctx: MutationContext): string | null {
  return endpointTarget(ctx)?.host || ctx.tunnelHost || null;
}

function urlHostname(server: string): string {
  if (server.includes(":") && !server.startsWith("[") && !server.endsWith("]")) {
    return `[${server}]`;
  }
  return server;
}

function targetPort(rawPort: string | null, ctx: MutationContext): string {
  const configuredEndpointPort = ctx.endpoint?.port?.trim();
  if (configuredEndpointPort) return configuredEndpointPort;
  const endpointPort = endpointTarget(ctx)?.port;
  if (endpointPort) return endpointPort;
  if (ctx.endpoint) return rawPort && rawPort !== "" ? rawPort : "443";
  if (hasEdgeOverride(ctx)) return "443";
  return rawPort && rawPort !== "" ? rawPort : "443";
}

function splitHostCandidates(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function pickHostForContext(values: string[], ctx: MutationContext): string | null {
  if (ctx.tunnelHost) return ctx.tunnelHost;
  if (ctx.endpoint) return values[1] || values[0] || null;
  return values[0] || null;
}

function urlHostCandidates(url: URL): string[] {
  return [
    ...splitHostCandidates(url.searchParams.get("sni")),
    ...splitHostCandidates(url.searchParams.get("peer")),
    ...splitHostCandidates(url.searchParams.get("host"))
  ];
}

function vmessHostCandidates(parsed: JsonRecord): string[] {
  return [
    ...splitHostCandidates(parsed.sni),
    ...splitHostCandidates(parsed.host)
  ];
}

function outboundHostCandidates(output: JsonRecord): string[] {
  const tls = typeof output.tls === "object" && output.tls !== null && !Array.isArray(output.tls)
    ? (output.tls as JsonRecord)
    : {};
  const transport = typeof output.transport === "object" && output.transport !== null && !Array.isArray(output.transport)
    ? (output.transport as JsonRecord)
    : {};
  const headers = typeof transport.headers === "object" && transport.headers !== null && !Array.isArray(transport.headers)
    ? (transport.headers as JsonRecord)
    : {};
  return [
    ...splitHostCandidates(tls.server_name),
    ...splitHostCandidates(headers.Host)
  ];
}

function writeUrlTlsHost(url: URL, host: string, force: boolean): void {
  if (force || url.searchParams.has("sni")) url.searchParams.set("sni", host);
  if (url.searchParams.has("peer")) url.searchParams.set("peer", host);
  const type = (url.searchParams.get("type") || "").toLowerCase();
  if (force || url.searchParams.has("host") || type === "ws" || type === "http" || type === "xhttp" || type === "h2") {
    url.searchParams.set("host", host);
  }
  if (type === "grpc" && !url.searchParams.has("serviceName")) {
    url.searchParams.set("serviceName", "");
  }
}

function mutateUrlUri(raw: string, ctx: MutationContext): string {
  const url = new URL(raw);
  const server = targetServer(ctx);
  const host = pickHostForContext(urlHostCandidates(url), ctx);
  if (server) {
    url.hostname = urlHostname(server);
    url.port = targetPort(url.port, ctx);
  }
  url.hash = `#${encodeURIComponent(displayName(ctx))}`;
  if (host) {
    writeUrlTlsHost(url, host, Boolean(ctx.tunnelHost || ctx.endpoint));
  }
  return url.toString();
}

function mutateHysteria2Uri(raw: string, ctx: MutationContext): string {
  const url = new URL(raw);
  const server = targetServer(ctx);
  const host = pickHostForContext(urlHostCandidates(url), ctx);
  if (server) {
    url.hostname = urlHostname(server);
    url.port = targetPort(url.port, ctx);
  }
  url.hash = `#${encodeURIComponent(displayName(ctx))}`;
  if (host) {
    url.searchParams.set("sni", host);
  }
  return url.toString();
}

function mutateVmess(raw: string, ctx: MutationContext): string {
  const encoded = raw.replace(/^vmess:\/\//i, "");
  const parsed = JSON.parse(decodeBase64(encoded)) as JsonRecord;
  const server = targetServer(ctx);
  const host = pickHostForContext(vmessHostCandidates(parsed), ctx);
  if (server) {
    parsed.add = server;
    parsed.port = targetPort(typeof parsed.port === "string" || typeof parsed.port === "number" ? String(parsed.port) : null, ctx);
  }
  parsed.ps = displayName(ctx);
  if (host) {
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
  const label = `#${encodeURIComponent(displayName(ctx))}`;
  if (!body.includes("@")) {
    const details = parseShadowsocksDetails(raw);
    const server = targetServer(ctx);
    if (!details || !server) return raw;
    const credential = encodeBase64(`${details.method}:${details.password}`);
    return `ss://${credential}@${urlHostname(server)}:${targetPort(String(details.serverPort), ctx)}${query}${label}`;
  }
  const url = new URL(body);
  const server = targetServer(ctx);
  if (!server) return raw;
  url.hostname = urlHostname(server);
  url.port = targetPort(url.port, ctx);
  const params = url.searchParams;
  if (ctx.tunnelHost && params.has("plugin")) {
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
    if (protocol === "hysteria2") {
      return { ...base, uri: mutateHysteria2Uri(raw, ctx) };
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
  const host = pickHostForContext(outboundHostCandidates(output), ctx);
  if (server) {
    output.server = server;
    output.server_port = Number(targetPort(
      typeof output.server_port === "string" || typeof output.server_port === "number" ? String(output.server_port) : null,
      ctx
    ));
  }
  output.tag = displayName(ctx);
  if (host) {
    const tls = typeof output.tls === "object" && output.tls !== null && !Array.isArray(output.tls)
      ? (output.tls as JsonRecord)
      : {};
    tls.enabled = tls.enabled ?? true;
    tls.server_name = host;
    output.tls = tls;

    const transport = typeof output.transport === "object" && output.transport !== null && !Array.isArray(output.transport)
      ? (output.transport as JsonRecord)
      : {};
    if (transport.type === "ws" || transport.type === "http" || transport.type === "xhttp") {
      const headers = typeof transport.headers === "object" && transport.headers !== null && !Array.isArray(transport.headers)
        ? (transport.headers as JsonRecord)
        : {};
      headers.Host = host;
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
  const tag = displayName(ctx);
  try {
    if (protocol === "vless" || protocol === "trojan") {
      const url = new URL(raw);
      const host = pickHostForContext(urlHostCandidates(url), ctx) || server;
      const outbound: JsonRecord = {
        type: protocol,
        tag,
        server,
        server_port: Number(targetPort(url.port, ctx)),
        tls: { enabled: true, server_name: host }
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
          headers: { Host: host }
        } as unknown as JsonRecord;
      }
      return { ...base, outbound };
    }
    if (protocol === "vmess") {
      const vmess = JSON.parse(decodeBase64(raw.replace(/^vmess:\/\//i, ""))) as JsonRecord;
      const host = pickHostForContext(vmessHostCandidates(vmess), ctx) || server;
      return {
        ...base,
        outbound: {
          type: "vmess",
          tag,
          server,
          server_port: Number(targetPort(typeof vmess.port === "string" || typeof vmess.port === "number" ? String(vmess.port) : null, ctx)),
          uuid: typeof vmess.id === "string" ? vmess.id : "",
          security: typeof vmess.scy === "string" ? vmess.scy : "auto",
          tls: { enabled: true, server_name: host }
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
    if (protocol === "hysteria2") {
      const url = new URL(raw);
      const host = pickHostForContext(urlHostCandidates(url), ctx) || server;
      return {
        ...base,
        outbound: {
          type: "hysteria2",
          tag,
          server,
          server_port: Number(targetPort(url.port, ctx)),
          password: decodeURIComponent(url.username),
          tls: {
            enabled: true,
            server_name: host,
            insecure: url.searchParams.get("insecure") === "1" || url.searchParams.get("insecure") === "true"
          }
        } as JsonRecord
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
