import { decodeBase64, inferProtocol } from "./protocols";
import type { JsonRecord } from "./types";

export interface ParsedProxyNode {
  name: string;
  rawConfig: string;
  sourceType: "v2ray_uri" | "sing_box_outbound";
  protocol: string;
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
        protocol: inferProtocol(link, "v2ray_uri")
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
        protocol: inferProtocol(rawConfig, "sing_box_outbound")
      };
    });
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
