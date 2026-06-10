import { decodeBase64, encodeBase64, inferProtocol } from "./protocols";
import type { JsonRecord } from "./types";

export interface ParsedProxyNode {
  name: string;
  rawConfig: string;
  sourceType: "v2ray_uri" | "sing_box_outbound";
  protocol: string;
  server?: string;
  port?: string;
  sni?: string;
  transport?: string;
  tls: boolean;
}

const SHARE_LINK_RE = /^(vless|vmess|trojan|ss):\/\//i;
const PROXY_OUTBOUND_TYPES = new Set(["vless", "vmess", "trojan", "shadowsocks", "ss"]);

export function parseEndpointValues(input: unknown): string[] {
  const values = Array.isArray(input) ? input : typeof input === "string" ? [input] : [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    for (const token of value.split(/[\s,，;；]+/)) {
      const trimmed = token.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      output.push(trimmed);
    }
  }
  return output;
}

export function parseProxySubscriptionContent(content: string, sourceName = "subscription"): ParsedProxyNode[] {
  const bodies = contentVariants(content);
  const parsed: ParsedProxyNode[] = [];
  const seen = new Set<string>();

  for (const body of bodies) {
    for (const item of parseSingBoxOutbounds(body)) {
      if (seen.has(item.rawConfig)) continue;
      seen.add(item.rawConfig);
      parsed.push(item);
    }

    for (const link of extractShareLinks(body)) {
      if (seen.has(link)) continue;
      seen.add(link);
      parsed.push({
        name: shareLinkName(link) || fallbackName(sourceName, parsed.length + 1),
        rawConfig: link,
        sourceType: "v2ray_uri",
        protocol: inferProtocol(link, "v2ray_uri"),
        ...inspectRawConfig(link, "v2ray_uri")
      });
    }
  }

  return parsed;
}

function contentVariants(content: string): string[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  const variants = [trimmed];
  const compact = trimmed.replace(/\s+/g, "");
  if (!SHARE_LINK_RE.test(trimmed) && compact.length > 12) {
    try {
      const decoded = decodeBase64(compact).trim();
      if (decoded && decoded !== trimmed) variants.push(decoded);
    } catch {
      // Not a base64 subscription body.
    }
  }
  return variants;
}

function extractShareLinks(content: string): string[] {
  const byLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => SHARE_LINK_RE.test(line));
  if (byLine.length > 0) return byLine;

  const matches = content.match(/(?:vless|vmess|trojan|ss):\/\/[^\s"'<>]+/gi);
  return matches || [];
}

function parseSingBoxOutbounds(content: string): ParsedProxyNode[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  const outbounds = normalizeOutbounds(parsed);
  return outbounds
    .filter(isProxyOutbound)
    .map((outbound, index) => {
      const rawConfig = JSON.stringify(outbound);
      return {
        name: outboundName(outbound, index + 1),
        rawConfig,
        sourceType: "sing_box_outbound",
        protocol: inferProtocol(rawConfig, "sing_box_outbound"),
        ...inspectRawConfig(rawConfig, "sing_box_outbound")
      };
    });
}

interface RawConfigInfo {
  server?: string;
  port?: string;
  sni?: string;
  transport?: string;
  tls: boolean;
}

export function inspectRawConfig(rawConfig: string, sourceType = "v2ray_uri"): RawConfigInfo {
  if (sourceType === "sing_box_outbound") return inspectSingBoxRawConfig(rawConfig);
  if (/^vmess:\/\//i.test(rawConfig)) return inspectVmessRawConfig(rawConfig);
  try {
    const url = new URL(rawConfig);
    const security = (url.searchParams.get("security") || "").toLowerCase();
    const sni = url.searchParams.get("sni") || url.searchParams.get("peer") || url.searchParams.get("host") || undefined;
    return {
      server: url.hostname || undefined,
      port: url.port || undefined,
      sni,
      transport: url.searchParams.get("type") || undefined,
      tls: security === "tls" || url.port === "443" || Boolean(sni)
    };
  } catch {
    return { tls: false };
  }
}

export function composeFallbackRawConfig(childRawConfig: string, childSourceType: string, carrierRawConfig: string, carrierSourceType: string): string {
  const carrier = inspectRawConfig(carrierRawConfig, carrierSourceType);
  if (!carrier.server) return childRawConfig;
  if (childSourceType === "sing_box_outbound") return composeSingBoxRawConfig(childRawConfig, carrier);
  if (/^vmess:\/\//i.test(childRawConfig)) return composeVmessRawConfig(childRawConfig, carrier);
  return composeShareRawConfig(childRawConfig, carrier);
}

function inspectVmessRawConfig(rawConfig: string): RawConfigInfo {
  try {
    const parsed = JSON.parse(decodeBase64(rawConfig.replace(/^vmess:\/\//i, ""))) as JsonRecord;
    const server = typeof parsed.add === "string" ? parsed.add : undefined;
    const port = typeof parsed.port === "string" || typeof parsed.port === "number" ? String(parsed.port) : undefined;
    const sni = typeof parsed.sni === "string" ? parsed.sni : typeof parsed.host === "string" ? parsed.host : undefined;
    const network = typeof parsed.net === "string" ? parsed.net : undefined;
    return {
      server,
      port,
      sni,
      transport: network,
      tls: parsed.tls === "tls" || port === "443" || Boolean(sni)
    };
  } catch {
    return { tls: false };
  }
}

function inspectSingBoxRawConfig(rawConfig: string): RawConfigInfo {
  try {
    const parsed = JSON.parse(rawConfig) as JsonRecord;
    const outbound = Array.isArray(parsed.outbounds) && isRecord(parsed.outbounds[0])
      ? parsed.outbounds[0]
      : parsed;
    const tls = isRecord(outbound.tls) ? outbound.tls : {};
    const transport = isRecord(outbound.transport) ? outbound.transport : {};
    const server = typeof outbound.server === "string" ? outbound.server : undefined;
    const port = typeof outbound.server_port === "string" || typeof outbound.server_port === "number" ? String(outbound.server_port) : undefined;
    const sni = typeof tls.server_name === "string" ? tls.server_name : undefined;
    return {
      server,
      port,
      sni,
      transport: typeof transport.type === "string" ? transport.type : undefined,
      tls: tls.enabled === true || port === "443" || Boolean(sni)
    };
  } catch {
    return { tls: false };
  }
}

function composeShareRawConfig(rawConfig: string, carrier: RawConfigInfo): string {
  try {
    const url = new URL(rawConfig);
    url.hostname = carrier.server || url.hostname;
    if (carrier.port) url.port = carrier.port;
    if (carrier.tls) url.searchParams.set("security", "tls");
    if (carrier.sni || carrier.server) url.searchParams.set("sni", carrier.sni || carrier.server || "");
    const transport = (url.searchParams.get("type") || "").toLowerCase();
    if ((transport === "ws" || transport === "http") && (carrier.sni || carrier.server)) {
      url.searchParams.set("host", carrier.sni || carrier.server || "");
    }
    return url.toString();
  } catch {
    return rawConfig;
  }
}

function composeVmessRawConfig(rawConfig: string, carrier: RawConfigInfo): string {
  try {
    const parsed = JSON.parse(decodeBase64(rawConfig.replace(/^vmess:\/\//i, ""))) as JsonRecord;
    parsed.add = carrier.server || parsed.add;
    if (carrier.port) parsed.port = carrier.port;
    if (carrier.tls) parsed.tls = "tls";
    if (carrier.sni || carrier.server) {
      parsed.sni = carrier.sni || carrier.server || "";
      parsed.host = carrier.sni || carrier.server || "";
    }
    return `vmess://${encodeBase64(JSON.stringify(parsed))}`;
  } catch {
    return rawConfig;
  }
}

function composeSingBoxRawConfig(rawConfig: string, carrier: RawConfigInfo): string {
  try {
    const parsed = JSON.parse(rawConfig) as JsonRecord;
    const outbound = Array.isArray(parsed.outbounds) && isRecord(parsed.outbounds[0])
      ? (parsed.outbounds[0] as JsonRecord)
      : parsed;
    outbound.server = carrier.server || outbound.server;
    if (carrier.port) outbound.server_port = Number(carrier.port);
    if (carrier.tls) {
      const tls = isRecord(outbound.tls) ? (outbound.tls as JsonRecord) : {};
      tls.enabled = true;
      tls.server_name = carrier.sni || carrier.server || "";
      outbound.tls = tls;
    }
    const transport = isRecord(outbound.transport) ? (outbound.transport as JsonRecord) : null;
    if (transport && (transport.type === "ws" || transport.type === "http")) {
      const headers = isRecord(transport.headers) ? (transport.headers as JsonRecord) : {};
      headers.Host = carrier.sni || carrier.server || "";
      transport.headers = headers;
    }
    return JSON.stringify(parsed);
  } catch {
    return rawConfig;
  }
}


function normalizeOutbounds(parsed: unknown): JsonRecord[] {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const record = parsed as JsonRecord;
  if (Array.isArray(record.outbounds)) {
    return record.outbounds.filter(isRecord);
  }
  return isRecord(record) && typeof record.type === "string" ? [record] : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isProxyOutbound(outbound: JsonRecord): boolean {
  const type = typeof outbound.type === "string" ? outbound.type.toLowerCase() : "";
  return PROXY_OUTBOUND_TYPES.has(type) || typeof outbound.server === "string";
}

function outboundName(outbound: JsonRecord, index: number): string {
  const tag = typeof outbound.tag === "string" ? outbound.tag.trim() : "";
  if (tag) return cleanName(tag);
  const type = typeof outbound.type === "string" ? outbound.type : "outbound";
  const server = typeof outbound.server === "string" ? outbound.server : String(index);
  return cleanName(`${type}-${server}`);
}

function shareLinkName(link: string): string | null {
  if (/^vmess:\/\//i.test(link)) return vmessName(link);
  try {
    const url = new URL(link);
    if (url.hash) return cleanName(decodeURIComponent(url.hash.slice(1)));
    return cleanName(url.hostname || url.protocol.replace(":", ""));
  } catch {
    return null;
  }
}

function vmessName(link: string): string | null {
  try {
    const decoded = decodeBase64(link.replace(/^vmess:\/\//i, ""));
    const parsed = JSON.parse(decoded) as JsonRecord;
    const ps = typeof parsed.ps === "string" ? parsed.ps : "";
    const add = typeof parsed.add === "string" ? parsed.add : "";
    return cleanName(ps || add || "vmess");
  } catch {
    return null;
  }
}

function cleanName(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, 96) || "imported-node";
}

function fallbackName(sourceName: string, index: number): string {
  return cleanName(`${sourceName}-${index}`);
}
