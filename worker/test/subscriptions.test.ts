import { describe, expect, it } from "vitest";
import { listGeneratedNodes } from "../src/subscriptions";
import type { Env, PreferredEndpointRow, ProxyNodeRow } from "../src/types";

type TableMap = {
  nodes: ProxyNodeRow[];
  endpoints: PreferredEndpointRow[];
  endpointSelections?: Array<{ proxy_node_id: string; endpoint_id: string; enabled: number }>;
  tunnelSelections?: Array<Record<string, unknown>>;
  sniSelections?: Array<{ proxy_node_id: string; sni_id: string; hostname: string; enabled: number }>;
  groups?: Array<{ name: string; endpoint_mode: string; endpoint_filter_json: string; enabled: number }>;
};

class MockStatement {
  private params: unknown[] = [];

  constructor(private readonly tables: TableMap, private readonly query: string) {}

  bind(...params: unknown[]): MockStatement {
    this.params = params;
    return this;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.rows() as T[] };
  }

  async first<T>(): Promise<T | null> {
    return (this.rows()[0] as T | undefined) || null;
  }

  private rows(): unknown[] {
    if (this.query.includes("FROM proxy_nodes")) return this.tables.nodes;
    if (this.query.includes("FROM preferred_endpoints")) return this.tables.endpoints;
    if (this.query.includes("FROM proxy_node_endpoint_selections")) return this.tables.endpointSelections || [];
    if (this.query.includes("FROM proxy_node_tunnel_selections")) return this.tables.tunnelSelections || [];
    if (this.query.includes("FROM proxy_node_sni_selections")) return this.tables.sniSelections || [];
    if (this.query.includes("FROM groups")) {
      return (this.tables.groups || []).filter((group) => group.name === this.params[0] && group.enabled === 1);
    }
    return [];
  }
}

function env(tables: TableMap): Env {
  return {
    DB: {
      prepare(query: string) {
        return new MockStatement(tables, query);
      }
    } as unknown as D1Database,
    ADMIN_TOKEN: "admin",
    AGENT_TOKEN: "agent",
    SUBSCRIPTION_TOKEN: "sub"
  };
}

function node(id: string, name: string): ProxyNodeRow {
  return {
    id,
    name,
    remark: null,
    source_type: "v2ray_uri",
    raw_config: "vless://00000000-0000-4000-8000-000000000000@origin.example:80?type=ws&path=%2Fapp#old",
    protocol: "vless",
    enabled: 1,
    use_tunnel: 0,
    selected_tunnel_id: null,
    created_at: "",
    updated_at: ""
  };
}

const endpoint: PreferredEndpointRow = {
  id: "endpoint_1",
  type: "ip",
  value: "104.16.0.1",
  label: "cf-ip",
  enabled: 1,
  scope: "global",
  default_selected: 1,
  sort_order: 0,
  created_at: "",
  updated_at: ""
};

describe("subscription generation", () => {
  it("applies custom SNI traffic even when the source node is not a cloudflared tunnel node", async () => {
    const generated = await listGeneratedNodes(env({
      nodes: [node("node_1", "content")],
      endpoints: [endpoint],
      sniSelections: [{ proxy_node_id: "node_1", sni_id: "sni_1", hostname: "edge.example.com", enabled: 1 }]
    }), {
      format: "v2ray",
      group: null,
      includeDisabled: false,
      endpointMode: "selected"
    });

    expect(generated).toHaveLength(1);
    expect(generated[0]).toMatchObject({
      id: "node_1:sni:sni_1:endpoint_1",
      sourceNodeId: "node_1",
      sniId: "sni_1",
      endpointValue: "104.16.0.1",
      tunnelHost: "edge.example.com"
    });
    const parsed = new URL(generated[0].uri || "");
    expect(parsed.hostname).toBe("104.16.0.1");
    expect(parsed.port).toBe("443");
    expect(parsed.searchParams.get("sni")).toBe("edge.example.com");
    expect(parsed.searchParams.get("host")).toBe("edge.example.com");
  });

  it("falls back to current generated nodes from the same source when saved group member ids are stale", async () => {
    const generated = await listGeneratedNodes(env({
      nodes: [node("node_1", "content-a"), node("node_2", "content-b")],
      endpoints: [endpoint],
      sniSelections: [{ proxy_node_id: "node_1", sni_id: "sni_1", hostname: "edge.example.com", enabled: 1 }],
      groups: [{
        name: "abcd",
        endpoint_mode: "selected",
        endpoint_filter_json: JSON.stringify({ derivedNodeIds: ["node_1:sni:sni_old:endpoint_old"] }),
        enabled: 1
      }]
    }), {
      format: "v2ray",
      group: "abcd",
      includeDisabled: false,
      endpointMode: "selected"
    });

    expect(generated.map((item) => item.id)).toEqual(["node_1:sni:sni_1:endpoint_1"]);
  });
});
