#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith("--")) {
    const next = process.argv[i + 1];
    if (!next || next.startsWith("--")) args.set(arg, "true");
    else {
      args.set(arg, next);
      i += 1;
    }
  }
}

const subUrl = args.get("--url");
const xrayBin = args.get("--xray") || process.env.XRAY_BIN || "xray";
const connect = args.get("--connect") === "true";
const probeUrl = args.get("--probe-url") || "https://www.cloudflare.com/cdn-cgi/trace";
const timeoutMs = Number(args.get("--timeout-ms") || 15000);
const limit = Number(args.get("--limit") || 0);

if (!subUrl) {
  console.error("Usage: validate-v2ray-subscription.mjs --url <subscription-url> [--xray <path>] [--connect] [--limit N]");
  process.exit(2);
}

const body = await fetchText(subUrl);
const links = decodeSubscription(body).filter(Boolean);
const selectedLinks = limit > 0 ? links.slice(0, limit) : links;
const tempDir = await mkdtemp(join(tmpdir(), "xray-sub-"));
const results = [];

try {
  for (let index = 0; index < selectedLinks.length; index += 1) {
    const link = selectedLinks[index];
    const label = linkLabel(link) || `node-${index + 1}`;
    const item = { index: index + 1, label, syntax: "pending", connect: connect ? "pending" : "skipped", error: "" };
    try {
      const outbound = outboundFromShareLink(link);
      const configPath = join(tempDir, `node-${index + 1}.json`);
      await writeFile(configPath, JSON.stringify(configForOutbound(outbound), null, 2));
      await runProcess(xrayBin, ["run", "-test", "-c", configPath], { timeoutMs });
      item.syntax = "ok";
      if (connect) {
        const port = 20000 + index;
        await writeFile(configPath, JSON.stringify(configForOutbound(outbound, port), null, 2));
        await probeThroughXray(xrayBin, configPath, port, probeUrl, timeoutMs);
        item.connect = "ok";
      }
    } catch (error) {
      if (item.syntax === "pending") item.syntax = "fail";
      else if (connect && item.connect === "pending") item.connect = "fail";
      item.error = error instanceof Error ? error.message : String(error);
    }
    results.push(item);
    console.log(`${item.index}. ${item.syntax}/${item.connect} ${item.label}${item.error ? ` :: ${item.error}` : ""}`);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

const syntaxFailed = results.filter((item) => item.syntax !== "ok").length;
const connectFailed = connect ? results.filter((item) => item.connect !== "ok").length : 0;
console.log(JSON.stringify({
  total: links.length,
  checked: selectedLinks.length,
  syntaxOk: results.length - syntaxFailed,
  syntaxFailed,
  connectOk: connect ? results.length - connectFailed : 0,
  connectFailed
}, null, 2));
process.exit(syntaxFailed || connectFailed ? 1 : 0);

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "cf-tunnel-sub-validator/0.1" } });
  if (!response.ok) throw new Error(`subscription fetch failed: HTTP ${response.status}`);
  return await response.text();
}

function decodeSubscription(input) {
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (/^(vless|vmess|trojan|ss):\/\//im.test(trimmed)) {
    return trimmed.split(/\r?\n/).map((line) => line.trim());
  }
  const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8").split(/\r?\n/).map((line) => line.trim());
}

function linkLabel(link) {
  if (/^vmess:\/\//i.test(link)) {
    try {
      const parsed = JSON.parse(Buffer.from(link.replace(/^vmess:\/\//i, ""), "base64").toString("utf8"));
      return parsed.ps || parsed.add || "";
    } catch {
      return "";
    }
  }
  try {
    return decodeURIComponent(new URL(link).hash.replace(/^#/, ""));
  } catch {
    return "";
  }
}

function outboundFromShareLink(link) {
  if (/^vless:\/\//i.test(link)) return urlOutbound(link, "vless");
  if (/^trojan:\/\//i.test(link)) return urlOutbound(link, "trojan");
  if (/^vmess:\/\//i.test(link)) return vmessOutbound(link);
  if (/^ss:\/\//i.test(link)) return shadowsocksOutbound(link);
  throw new Error("unsupported share link protocol");
}

function urlOutbound(link, protocol) {
  const url = new URL(link);
  const port = Number(url.port || 443);
  const user = protocol === "vless"
    ? { id: decodeURIComponent(url.username), encryption: url.searchParams.get("encryption") || "none" }
    : { password: decodeURIComponent(url.username) };
  if (protocol === "vless" && url.searchParams.get("flow")) user.flow = url.searchParams.get("flow");
  const outbound = {
    protocol,
    tag: linkLabel(link) || protocol,
    settings: {
      vnext: protocol === "vless" ? [{ address: url.hostname, port, users: [user] }] : undefined,
      servers: protocol === "trojan" ? [{ address: url.hostname, port, password: user.password }] : undefined
    },
    streamSettings: streamSettingsFromUrl(url)
  };
  if (protocol === "trojan") delete outbound.settings.vnext;
  else delete outbound.settings.servers;
  return outbound;
}

function vmessOutbound(link) {
  const vmess = JSON.parse(Buffer.from(link.replace(/^vmess:\/\//i, ""), "base64").toString("utf8"));
  const fake = new URL("vmess://user@example.com");
  fake.searchParams.set("type", vmess.net || "tcp");
  fake.searchParams.set("security", vmess.tls || "none");
  if (vmess.sni) fake.searchParams.set("sni", vmess.sni);
  if (vmess.host) fake.searchParams.set("host", vmess.host);
  if (vmess.path) fake.searchParams.set("path", vmess.path);
  return {
    protocol: "vmess",
    tag: vmess.ps || vmess.add || "vmess",
    settings: {
      vnext: [{
        address: vmess.add,
        port: Number(vmess.port || 443),
        users: [{ id: vmess.id, alterId: Number(vmess.aid || 0), security: vmess.scy || "auto" }]
      }]
    },
    streamSettings: streamSettingsFromUrl(fake)
  };
}

function shadowsocksOutbound(link) {
  const url = new URL(link);
  let credential = decodeURIComponent(url.username);
  if (!credential.includes(":")) credential = Buffer.from(credential, "base64").toString("utf8");
  const separator = credential.indexOf(":");
  if (separator < 0) throw new Error("invalid Shadowsocks credential");
  return {
    protocol: "shadowsocks",
    tag: linkLabel(link) || "shadowsocks",
    settings: {
      servers: [{
        address: url.hostname,
        port: Number(url.port || 443),
        method: credential.slice(0, separator),
        password: credential.slice(separator + 1)
      }]
    }
  };
}

function streamSettingsFromUrl(url) {
  const network = (url.searchParams.get("type") || "tcp").toLowerCase();
  const security = (url.searchParams.get("security") || "none").toLowerCase();
  const stream = { network, security };
  const sni = url.searchParams.get("sni") || url.searchParams.get("peer") || url.searchParams.get("host") || url.hostname;
  if (security === "tls") stream.tlsSettings = { serverName: sni };
  if (security === "reality") stream.realitySettings = { serverName: sni, publicKey: url.searchParams.get("pbk") || "", shortId: url.searchParams.get("sid") || "" };
  if (network === "ws") {
    stream.wsSettings = {
      path: url.searchParams.get("path") || "/",
      headers: url.searchParams.get("host") ? { Host: url.searchParams.get("host") } : undefined
    };
  }
  if (network === "grpc") stream.grpcSettings = { serviceName: url.searchParams.get("serviceName") || "" };
  if (network === "http" || network === "h2") stream.httpSettings = { path: url.searchParams.get("path") || "/", host: hostList(url.searchParams.get("host")) };
  if (network === "xhttp") stream.xhttpSettings = { path: url.searchParams.get("path") || "/", host: url.searchParams.get("host") || undefined };
  return stream;
}

function hostList(value) {
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : undefined;
}

function configForOutbound(outbound, socksPort = null) {
  return {
    log: { loglevel: "warning" },
    inbounds: socksPort ? [{
      listen: "127.0.0.1",
      port: socksPort,
      protocol: "socks",
      settings: { udp: false }
    }] : [],
    outbounds: [outbound]
  };
}

async function probeThroughXray(xrayBin, configPath, port, url, timeoutMs) {
  const child = spawn(xrayBin, ["run", "-c", configPath], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  try {
    await wait(1200);
    await runProcess("curl", ["-fsS", "--max-time", String(Math.ceil(timeoutMs / 1000)), "--socks5-hostname", `127.0.0.1:${port}`, url], { timeoutMs: timeoutMs + 2000 });
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}${stderr ? `; xray: ${stderr.slice(-300)}` : ""}`);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([onceExit(child), wait(1500)]);
    if (!child.killed) child.kill("SIGKILL");
  }
}

function runProcess(command, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}${stderr ? `: ${stderr.slice(-500)}` : ""}`));
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function onceExit(child) {
  return new Promise((resolve) => child.once("exit", resolve));
}
