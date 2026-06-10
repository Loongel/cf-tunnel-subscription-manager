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
  host?: string;
  transport?: string;
  tlsParams?: Record<string, string>;
  vmessTlsParams?: JsonRecord;
  singBoxTls?: JsonRecord;
  tls: boolean;
}

const SHARE_TLS_PARAM_KEYS = [
  "security",
  "sni",
  "peer",
  "fp",
  "alpn",
  "allowInsecure",
  "pbk",
  "sid",
  "spx",
  "flow"
];

const VMESS_TLS_KEYS = ["sni", "host", "fp", "alpn", "allowInsecure"];

export function inspectRawConfig(rawConfig: string, sourceType = "v2ray_uri"): RawConfigInfo {
  if (sourceType === "sing_box_outbound") return inspectSingBoxRawConfig(rawConfig);
  if (/^vmess:\/\//i.test(rawConfig)) return inspectVmessRawConfig(rawConfig);
  try {
    const url = new URL(rawConfig);
    const security = (url.searchParams.get("security") || "").toLowerCase();
    const sni = url.searchParams.get("sni") || url.searchParams.get("peer") || url.searchParams.get("host") || undefined;
    const tlsParams = pickSearchParams(url.searchParams, SHARE_TLS_PARAM_KEYS);
    return {
      server: url.hostname || undefined,
      port: url.port || undefined,
      sni,
      host: url.searchParams.get("host") || undefined,
      transport: url.searchParams.get("type") || undefined,
      tlsParams,
      tls: security === "tls" || url.port === "443" || Boolean(sni)
    };
  } catch {
    return { tls: false };
  }
}

export function composeFallbackRawConfig(
  childRawConfig: string,
  childSourceType: string,
  carrierRawConfig: string,
  carrierSourceType: string
): string {
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
      host: typeof parsed.host === "string" ? parsed.host : undefined,
      transport: network,
      vmessTlsParams: pickRecordStrings(parsed, VMESS_TLS_KEYS),
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
    const headers = isRecord(transport.headers) ? transport.headers : {};
    const server = typeof outbound.server === "string" ? outbound.server : undefined;
    const port = typeof outbound.server_port === "string" || typeof outbound.server_port === "number" ? String(outbound.server_port) : undefined;
    const sni = typeof tls.server_name === "string" ? tls.server_name : undefined;
    return {
      server,
      port,
      sni,
      host: typeof headers.Host === "string" ? headers.Host : undefined,
      transport: typeof transport.type === "string" ? transport.type : undefined,
      singBoxTls: isRecord(tls) ? { ...tls } : undefined,
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
    const transport = (url.searchParams.get("type") || "").toLowerCase();
    const tlsParams = tlsParamsForTransport(carrier.tlsParams || {}, transport);
    for (const [key, value] of Object.entries(tlsParams)) {
      url.searchParams.set(key, value);
    }
    if (carrier.sni || carrier.server) url.searchParams.set("sni", carrier.sni || carrier.server || "");
    if ((transport === "ws" || transport === "http" || transport === "xhttp" || transport === "h2") && (carrier.host || carrier.sni || carrier.server)) {
      url.searchParams.set("host", carrier.host || carrier.sni || carrier.server || "");
    }
    return url.toString();
  } catch {
    return rawConfig;
  }
}

function tlsParamsForTransport(params: Record<string, string>, transport: string): Record<string, string> {
  if ((params.security || "").toLowerCase() !== "reality" || realitySupportedTransport(transport)) return params;
  const output: Record<string, string> = { ...params, security: "tls" };
  for (const key of ["pbk", "sid", "spx"]) delete output[key];
  return output;
}

function realitySupportedTransport(transport: string): boolean {
  return transport === "" || transport === "tcp" || transport === "raw" || transport === "xhttp" || transport === "grpc";
}

function composeVmessRawConfig(rawConfig: string, carrier: RawConfigInfo): string {
  try {
    const parsed = JSON.parse(decodeBase64(rawConfig.replace(/^vmess:\/\//i, ""))) as JsonRecord;
    parsed.add = carrier.server || parsed.add;
    if (carrier.port) parsed.port = carrier.port;
    if (carrier.tls) parsed.tls = "tls";
    for (const [key, value] of Object.entries(carrier.vmessTlsParams || {})) {
      parsed[key] = value;
    }
    if (carrier.sni || carrier.server) {
      parsed.sni = carrier.sni || carrier.server || "";
      parsed.host = carrier.host || carrier.sni || carrier.server || "";
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
      Object.assign(tls, carrier.singBoxTls || {});
      tls.enabled = true;
      tls.server_name = carrier.sni || carrier.server || "";
      outbound.tls = tls;
    }
    const transport = isRecord(outbound.transport) ? (outbound.transport as JsonRecord) : null;
    if (transport && (transport.type === "ws" || transport.type === "http" || transport.type === "xhttp")) {
      const headers = isRecord(transport.headers) ? (transport.headers as JsonRecord) : {};
      headers.Host = carrier.host || carrier.sni || carrier.server || "";
      transport.headers = headers;
    }
    return JSON.stringify(parsed);
  } catch {
    return rawConfig;
  }
}

function pickSearchParams(params: URLSearchParams, keys: string[]): Record<string, string> {
  const output: Record<string, string> = {};
  for (const key of keys) {
    const value = params.get(key);
    if (value) output[key] = value;
  }
  return output;
}

function pickRecordStrings(record: JsonRecord, keys: string[]): JsonRecord {
  const output: JsonRecord = {};
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") output[key] = value;
  }
  return output;
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
