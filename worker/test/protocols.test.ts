import { describe, expect, it } from "vitest";
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
});
