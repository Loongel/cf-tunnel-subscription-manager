import { describe, expect, it } from "vitest";
import { parseEndpointValues, parseProxySubscriptionContent } from "../src/importers";
import { encodeBase64, mutateShareUri } from "../src/protocols";
import { subscriptionUrls } from "../src/settings";
import type { PreferredEndpointRow, ProxyNodeRow } from "../src/types";

function node(raw: string): ProxyNodeRow {
  return {
    id: "node_1",
    name: "s1-vless",
    remark: null,
    source_type: "v2ray_uri",
    raw_config: raw,
    protocol: "vless",
    enabled: 1,
    use_tunnel: 1,
    selected_tunnel_id: "tun_1",
    created_at: "",
    updated_at: ""
  };
}

const endpoint: PreferredEndpointRow = {
  id: "endpoint_1",
  type: "ip",
  value: "162.159.1.1",
  label: "CF IP A",
  enabled: 1,
  scope: "global",
  default_selected: 1,
  sort_order: 0,
  created_at: "",
  updated_at: ""
};

describe("protocol adapter", () => {
  it("mutates VLESS CDN host fields", () => {
    const raw = "vless://uuid@example.com:443?type=ws&security=tls&path=%2F#old";
    const result = mutateShareUri(raw, {
      node: node(raw),
      tunnelHost: "abc.trycloudflare.com",
      endpoint,
      format: "v2ray"
    });
    expect(result.skipped).toBeFalsy();
    expect(result.uri).toContain("162.159.1.1");
    const parsed = new URL(result.uri || "");
    expect(parsed.searchParams.get("sni")).toBe("abc.trycloudflare.com");
    expect(parsed.searchParams.get("host")).toBe("abc.trycloudflare.com");
  });

  it("mutates VMess host fields", () => {
    const vmess = {
      v: "2",
      ps: "old",
      add: "example.com",
      port: "443",
      id: "uuid",
      aid: "0",
      net: "ws",
      type: "none",
      host: "example.com",
      path: "/",
      tls: "tls"
    };
    const raw = "vmess://" + encodeBase64(JSON.stringify(vmess));
    const result = mutateShareUri(raw, {
      node: { ...node(raw), protocol: "vmess" },
      tunnelHost: "abc.trycloudflare.com",
      endpoint,
      format: "passwall2"
    });
    expect(result.skipped).toBeFalsy();
    expect(result.uri).toMatch(/^vmess:\/\//);
  });

  it("mutates Shadowsocks SIP002 endpoint", () => {
    const raw = "ss://YWVzLTEyOC1nY206cGFzcw@example.com:8388?plugin=v2ray-plugin%3Bmode%3Dwebsocket#old";
    const result = mutateShareUri(raw, {
      node: { ...node(raw), protocol: "shadowsocks" },
      tunnelHost: "abc.trycloudflare.com",
      endpoint,
      format: "v2ray"
    });
    expect(result.skipped).toBeFalsy();
    expect(result.uri).toContain("162.159.1.1");
    expect(result.uri).toContain("host%3Dabc.trycloudflare.com");
  });

  it("builds subscription URLs with encoded token", () => {
    const urls = subscriptionUrls("https://worker.example.com", "sub_token/with+chars");
    expect(urls.v2ray).toBe("https://worker.example.com/sub/v2ray/sub_token%2Fwith%2Bchars");
    expect(urls.passwall2).toContain("/sub/passwall2/");
    expect(urls.singBox).toContain("/sub/sing-box/");
  });

  it("splits endpoint batch input by whitespace and punctuation", () => {
    expect(parseEndpointValues("162.159.1.1, 104.16.1.1\ncdn.example.com 162.159.1.1")).toEqual([
      "162.159.1.1",
      "104.16.1.1",
      "cdn.example.com"
    ]);
  });

  it("imports base64 encoded share-link subscriptions", () => {
    const body = encodeBase64([
      "vless://uuid@example.com:443?type=ws&security=tls#alpha",
      "trojan://pass@example.net:443#beta"
    ].join("\n"));
    const parsed = parseProxySubscriptionContent(body, "remote");
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ name: "alpha", sourceType: "v2ray_uri", protocol: "vless" });
    expect(parsed[1]).toMatchObject({ name: "beta", sourceType: "v2ray_uri", protocol: "trojan" });
  });

  it("imports sing-box proxy outbounds and skips selector outbounds", () => {
    const parsed = parseProxySubscriptionContent(JSON.stringify({
      outbounds: [
        { type: "selector", tag: "auto", outbounds: ["a"] },
        { type: "vless", tag: "edge-a", server: "example.com", server_port: 443, uuid: "uuid" }
      ]
    }));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ name: "edge-a", sourceType: "sing_box_outbound", protocol: "sing-box" });
  });
});
