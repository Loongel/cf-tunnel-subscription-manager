import { describe, expect, it } from "vitest";
import { composeFallbackRawConfig, parseEndpointValues, parseProxySubscriptionContent } from "../src/importers";
import { encodeBase64, mutateShareUri, toSingBoxOutbound } from "../src/protocols";
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
  resolve_mode: "none",
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

  it("forces endpoint-derived VLESS output to port 443 without tunnel binding", () => {
    const raw = "vless://uuid@example.com:1443?type=ws&security=tls&sni=edge.example.com&host=edge.example.com&path=%2F#old";
    const result = mutateShareUri(raw, {
      node: { ...node(raw), use_tunnel: 0, selected_tunnel_id: null },
      endpoint,
      format: "v2ray"
    });
    expect(result.skipped).toBeFalsy();
    const parsed = new URL(result.uri || "");
    expect(parsed.hostname).toBe("162.159.1.1");
    expect(parsed.port).toBe("443");
    expect(parsed.searchParams.get("sni")).toBe("edge.example.com");
  });

  it("wraps IPv6 endpoint addresses in share-link URL authority hosts", () => {
    const raw = "vless://uuid@3xui.ora1.813711.xyz:1443?type=xhttp&security=tls&sni=v6.3xui.hk&host=v6.3xui.hk&path=%2F#old";
    const result = mutateShareUri(raw, {
      node: { ...node(raw), name: "vlessxhttp[fallback]-direct-out@usr", use_tunnel: 0, selected_tunnel_id: null },
      endpoint: { ...endpoint, value: "2400:3200::1", label: "v6.3xui.hk" },
      format: "v2ray"
    });
    expect(result.skipped).toBeFalsy();
    expect(result.uri).toContain("@[2400:3200::1]:443");
    expect(result.uri).not.toContain("@3xui.ora1.813711.xyz:1443");
    const parsed = new URL(result.uri || "");
    expect(parsed.hostname).toBe("[2400:3200::1]");
    expect(decodeURIComponent(parsed.hash.slice(1))).toBe("vlessxhttp[fallback]-direct-out@usr | v6.3xui.hk");
  });

  it("selects SNI deterministically for direct, endpoint-derived, and configured traffic nodes", () => {
    const raw = "vless://uuid@example.com:443?type=ws&security=tls&sni=first.example.com,second.example.com&host=first.example.com,second.example.com&path=%2F#old";
    const direct = mutateShareUri(raw, {
      node: { ...node(raw), use_tunnel: 0, selected_tunnel_id: null },
      format: "v2ray"
    });
    const directUrl = new URL(direct.uri || "");
    expect(directUrl.hostname).toBe("example.com");
    expect(directUrl.searchParams.get("sni")).toBe("first.example.com");
    expect(directUrl.searchParams.get("host")).toBe("first.example.com");

    const endpointDerived = mutateShareUri(raw, {
      node: { ...node(raw), use_tunnel: 0, selected_tunnel_id: null },
      endpoint,
      format: "v2ray"
    });
    const endpointUrl = new URL(endpointDerived.uri || "");
    expect(endpointUrl.hostname).toBe("162.159.1.1");
    expect(endpointUrl.port).toBe("443");
    expect(endpointUrl.searchParams.get("sni")).toBe("second.example.com");
    expect(endpointUrl.searchParams.get("host")).toBe("second.example.com");

    const configured = mutateShareUri(raw, {
      node: { ...node(raw), use_tunnel: 0, selected_tunnel_id: null },
      tunnelHost: "configured.example.com",
      endpoint,
      format: "v2ray"
    });
    const configuredUrl = new URL(configured.uri || "");
    expect(configuredUrl.hostname).toBe("162.159.1.1");
    expect(configuredUrl.searchParams.get("sni")).toBe("configured.example.com");
    expect(configuredUrl.searchParams.get("host")).toBe("configured.example.com");
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
    const parsed = JSON.parse(atob((result.uri || "").replace(/^vmess:\/\//, "")));
    expect(parsed.port).toBe("443");
  });

  it("forces endpoint-derived sing-box output to port 443", () => {
    const raw = JSON.stringify({
      type: "vless",
      tag: "old",
      server: "example.com",
      server_port: 1443,
      uuid: "uuid",
      tls: { enabled: true, server_name: "edge.example.com" }
    });
    const result = toSingBoxOutbound(raw, {
      node: { ...node(raw), source_type: "sing_box_outbound", protocol: "sing-box", use_tunnel: 0, selected_tunnel_id: null },
      endpoint,
      format: "sing-box"
    });
    expect(result.skipped).toBeFalsy();
    expect(result.outbound?.server).toBe("162.159.1.1");
    expect(result.outbound?.server_port).toBe(443);
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

  it("composes HTTP content nodes under a TLS carrier before import", () => {
    const carrier = "vless://carrier@example.com:443?type=ws&security=tls&sni=edge.example.com,edge-alt.example.com&host=edge.example.com,edge-alt.example.com&fp=chrome&alpn=h2%2Chttp%2F1.1#carrier";
    const child = "vless://child@origin.example.net:80?type=ws&security=none&sni=old.example.com&host=old.example.com&path=%2Fapp#content";
    const composed = composeFallbackRawConfig(child, "v2ray_uri", carrier, "v2ray_uri");
    const parsed = new URL(composed);
    expect(parsed.hostname).toBe("example.com");
    expect(parsed.port).toBe("443");
    expect(parsed.searchParams.get("security")).toBe("tls");
    expect(parsed.searchParams.get("sni")).toBe("edge.example.com,edge-alt.example.com");
    expect(parsed.searchParams.get("host")).toBe("edge.example.com,edge-alt.example.com");
    expect(parsed.searchParams.get("fp")).toBe("chrome");
    expect(parsed.searchParams.get("alpn")).toBe("h2,http/1.1");
    expect(parsed.searchParams.get("path")).toBe("/app");
  });

  it("does not copy REALITY parameters onto WS fallback children because Xray rejects that transport/security pair", () => {
    const carrier = "vless://carrier@example.com:443?type=tcp&security=reality&sni=edge.example.com&fp=chrome&pbk=public-key&sid=abcd&spx=%2Fspider#carrier";
    const child = "vless://child@origin.example.net:80?type=ws&path=%2Fapp#content";
    const composed = composeFallbackRawConfig(child, "v2ray_uri", carrier, "v2ray_uri");
    const parsed = new URL(composed);
    expect(parsed.searchParams.get("security")).toBe("tls");
    expect(parsed.searchParams.get("sni")).toBe("edge.example.com");
    expect(parsed.searchParams.get("host")).toBe("edge.example.com");
    expect(parsed.searchParams.get("fp")).toBe("chrome");
    expect(parsed.searchParams.has("pbk")).toBe(false);
    expect(parsed.searchParams.has("sid")).toBe(false);
    expect(parsed.searchParams.has("spx")).toBe(false);
  });

});
