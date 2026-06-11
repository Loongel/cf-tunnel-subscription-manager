import { describe, expect, it } from "vitest";
import { __adminApiTestHooks } from "../src/admin-api";
import type { Env, PreferredEndpointRow, ProxyNodeRow } from "../src/types";

type EndpointSelection = { proxy_node_id: string; endpoint_id: string; enabled: number };

type TableMap = {
  nodes: ProxyNodeRow[];
  endpoints: PreferredEndpointRow[];
  endpointSelections: EndpointSelection[];
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

  async run(): Promise<void> {
    if (this.query.startsWith("INSERT INTO proxy_nodes")) {
      const [id, name, remark, sourceType, rawConfig, protocol, enabled, useTunnel, selectedTunnelId, createdAt, updatedAt] = this.params;
      this.tables.nodes.push({
        id: String(id),
        name: String(name),
        remark: typeof remark === "string" ? remark : null,
        source_type: String(sourceType),
        raw_config: String(rawConfig),
        protocol: String(protocol),
        enabled: Number(enabled),
        use_tunnel: Number(useTunnel),
        selected_tunnel_id: typeof selectedTunnelId === "string" ? selectedTunnelId : null,
        created_at: String(createdAt),
        updated_at: String(updatedAt)
      });
      return;
    }

    if (this.query.startsWith("DELETE FROM proxy_nodes WHERE remark IN")) {
      const remarks = new Set(this.params.map(String));
      const deletedIds = new Set(this.tables.nodes.filter((row) => row.remark && remarks.has(row.remark)).map((row) => row.id));
      this.tables.nodes = this.tables.nodes.filter((row) => !deletedIds.has(row.id));
      this.tables.endpointSelections = this.tables.endpointSelections.filter((row) => !deletedIds.has(row.proxy_node_id));
      return;
    }

    if (this.query.startsWith("DELETE FROM proxy_node_endpoint_selections")) {
      const nodeId = String(this.params[0]);
      this.tables.endpointSelections = this.tables.endpointSelections.filter((row) => row.proxy_node_id !== nodeId);
      return;
    }

    if (this.query.startsWith("INSERT OR REPLACE INTO proxy_node_endpoint_selections")) {
      const [nodeId, endpointId] = this.params.map(String);
      this.tables.endpointSelections = this.tables.endpointSelections.filter(
        (row) => !(row.proxy_node_id === nodeId && row.endpoint_id === endpointId)
      );
      this.tables.endpointSelections.push({ proxy_node_id: nodeId, endpoint_id: endpointId, enabled: 1 });
    }
  }

  private rows(): unknown[] {
    if (this.query.includes("SELECT id, name FROM proxy_nodes WHERE remark IN")) {
      const remarks = new Set(this.params.map(String));
      return this.tables.nodes.filter((row) => row.remark && remarks.has(row.remark)).map(({ id, name }) => ({ id, name }));
    }
    if (this.query.includes("FROM proxy_node_endpoint_selections s")) {
      const nodeIds = new Set(this.params.map(String));
      const nodeScopedEndpoints = new Set(this.tables.endpoints.filter((row) => row.scope === "node").map((row) => row.id));
      return this.tables.endpointSelections.filter(
        (row) => row.enabled === 1 && nodeIds.has(row.proxy_node_id) && nodeScopedEndpoints.has(row.endpoint_id)
      );
    }
    if (this.query.includes("SELECT * FROM proxy_nodes WHERE id = ?")) {
      return this.tables.nodes.filter((row) => row.id === this.params[0]);
    }
    if (this.query.includes("SELECT * FROM proxy_nodes WHERE name = ?")) {
      return this.tables.nodes.filter((row) => row.name === this.params[0]);
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

function node(id: string, name: string, remark: string): ProxyNodeRow {
  return {
    id,
    name,
    remark,
    source_type: "v2ray_uri",
    raw_config: "vless://00000000-0000-4000-8000-000000000000@old.example:80?type=ws#content",
    protocol: "vless",
    enabled: 1,
    use_tunnel: 0,
    selected_tunnel_id: null,
    created_at: "",
    updated_at: ""
  };
}

describe("admin import refresh", () => {
  it("preserves node-scoped endpoint selections when imported nodes are replaced", async () => {
    const tables: TableMap = {
      nodes: [node("old_node", "content", "managed-sub")],
      endpoints: [
        {
          id: "endpoint_private",
          type: "ip",
          value: "192.168.1.120",
          label: null,
          resolve_mode: "none",
          enabled: 1,
          scope: "node",
          default_selected: 0,
          sort_order: 0,
          created_at: "",
          updated_at: ""
        },
        {
          id: "endpoint_global",
          type: "domain",
          value: "cdn.example.com",
          label: null,
          resolve_mode: "none",
          enabled: 1,
          scope: "global",
          default_selected: 1,
          sort_order: 0,
          created_at: "",
          updated_at: ""
        }
      ],
      endpointSelections: [
        { proxy_node_id: "old_node", endpoint_id: "endpoint_private", enabled: 1 },
        { proxy_node_id: "old_node", endpoint_id: "endpoint_global", enabled: 1 }
      ]
    };

    const result = await __adminApiTestHooks.importProxyNodes(env(tables), {
      remark: "managed-sub",
      replaceExistingForRemark: true,
      candidates: [{
        id: "candidate_1",
        sourceName: "managed-sub",
        sourceType: "v2ray_uri",
        name: "content",
        rawConfig: "vless://00000000-0000-4000-8000-000000000000@new.example:443?security=tls&type=ws#content",
        protocol: "vless"
      }]
    });

    expect(result).toMatchObject({ imported: 1, deletedOld: 1, skipped: 0 });
    expect(tables.nodes).toHaveLength(1);
    expect(tables.nodes[0].id).not.toBe("old_node");
    expect(tables.endpointSelections).toEqual([
      { proxy_node_id: tables.nodes[0].id, endpoint_id: "endpoint_private", enabled: 1 }
    ]);
  });
});
