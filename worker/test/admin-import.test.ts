import { describe, expect, it } from "vitest";
import { __adminApiTestHooks } from "../src/admin-api";
import type { Env, PreferredEndpointRow, ProxyNodeRow } from "../src/types";

type EndpointSelection = { proxy_node_id: string; endpoint_id: string; enabled: number };
type TrafficBinding = { proxy_node_id: string; traffic_key: string; enabled: number };
type SniSelection = { proxy_node_id: string; sni_id: string; enabled: number };
type EndpointScope = { proxy_node_id: string; endpoint_id: string };

type TableMap = {
  nodes: ProxyNodeRow[];
  endpoints: PreferredEndpointRow[];
  endpointSelections: EndpointSelection[];
  endpointScopes?: EndpointScope[];
  trafficBindings?: TrafficBinding[];
  sniSelections?: SniSelection[];
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
      const [
        id,
        name,
        remark,
        sourceType,
        rawConfig,
        importKey,
        importSourceName,
        rawConfigHash,
        protocol,
        enabled,
        useTunnel,
        selectedTunnelId,
        createdAt,
        updatedAt
      ] = this.params;
      this.tables.nodes.push({
        id: String(id),
        name: String(name),
        remark: typeof remark === "string" ? remark : null,
        source_type: String(sourceType),
        raw_config: String(rawConfig),
        import_key: typeof importKey === "string" ? importKey : null,
        import_source_name: typeof importSourceName === "string" ? importSourceName : null,
        raw_config_hash: typeof rawConfigHash === "string" ? rawConfigHash : null,
        protocol: String(protocol),
        enabled: Number(enabled),
        use_tunnel: Number(useTunnel),
        selected_tunnel_id: typeof selectedTunnelId === "string" ? selectedTunnelId : null,
        created_at: String(createdAt),
        updated_at: String(updatedAt)
      });
      return;
    }

    if (this.query.includes("DELETE FROM proxy_nodes")
      && this.query.includes("remark IN")
      && this.query.includes("import_source_name IN")) {
      const remarks = new Set(this.params.map(String));
      const deletedIds = new Set(this.tables.nodes
        .filter((row) => (row.remark && remarks.has(row.remark)) || (row.import_source_name && remarks.has(row.import_source_name)))
        .map((row) => row.id));
      this.tables.nodes = this.tables.nodes.filter((row) => !deletedIds.has(row.id));
      this.tables.endpointSelections = this.tables.endpointSelections.filter((row) => !deletedIds.has(row.proxy_node_id));
      this.tables.endpointScopes = (this.tables.endpointScopes || []).filter((row) => !deletedIds.has(row.proxy_node_id));
      this.tables.trafficBindings = (this.tables.trafficBindings || []).filter((row) => !deletedIds.has(row.proxy_node_id));
      this.tables.sniSelections = (this.tables.sniSelections || []).filter((row) => !deletedIds.has(row.proxy_node_id));
      return;
    }
    if (this.query.startsWith("DELETE FROM proxy_nodes WHERE remark IN")) {
      const remarks = new Set(this.params.map(String));
      const deletedIds = new Set(this.tables.nodes.filter((row) => row.remark && remarks.has(row.remark)).map((row) => row.id));
      this.tables.nodes = this.tables.nodes.filter((row) => !deletedIds.has(row.id));
      this.tables.endpointSelections = this.tables.endpointSelections.filter((row) => !deletedIds.has(row.proxy_node_id));
      this.tables.endpointScopes = (this.tables.endpointScopes || []).filter((row) => !deletedIds.has(row.proxy_node_id));
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
    if (this.query.startsWith("INSERT OR IGNORE INTO preferred_endpoint_node_scopes")) {
      const [endpointId, nodeId] = this.params.map(String);
      const rows = this.tables.endpointScopes || [];
      if (!rows.some((row) => row.proxy_node_id === nodeId && row.endpoint_id === endpointId)) {
        rows.push({ proxy_node_id: nodeId, endpoint_id: endpointId });
      }
      this.tables.endpointScopes = rows;
      return;
    }
    if (this.query.startsWith("DELETE FROM proxy_node_traffic_bindings")) {
      const nodeId = String(this.params[0]);
      this.tables.trafficBindings = (this.tables.trafficBindings || []).filter((row) => row.proxy_node_id !== nodeId);
      return;
    }
    if (this.query.startsWith("INSERT OR REPLACE INTO proxy_node_traffic_bindings")) {
      const [nodeId, trafficKey] = this.params.map(String);
      this.tables.trafficBindings = (this.tables.trafficBindings || []).filter(
        (row) => !(row.proxy_node_id === nodeId && row.traffic_key === trafficKey)
      );
      this.tables.trafficBindings.push({ proxy_node_id: nodeId, traffic_key: trafficKey, enabled: 1 });
    }
    if (this.query.startsWith("DELETE FROM proxy_node_sni_selections")) {
      const nodeId = String(this.params[0]);
      this.tables.sniSelections = (this.tables.sniSelections || []).filter((row) => row.proxy_node_id !== nodeId);
      return;
    }
    if (this.query.startsWith("INSERT OR REPLACE INTO proxy_node_sni_selections")) {
      const [nodeId, sniId] = this.params.map(String);
      this.tables.sniSelections = (this.tables.sniSelections || []).filter(
        (row) => !(row.proxy_node_id === nodeId && row.sni_id === sniId)
      );
      this.tables.sniSelections.push({ proxy_node_id: nodeId, sni_id: sniId, enabled: 1 });
    }
  }

  private rows(): unknown[] {
    if (this.query.includes("SELECT id, name, import_key FROM proxy_nodes WHERE remark IN")) {
      const remarks = new Set(this.params.map(String));
      return this.tables.nodes.filter((row) => row.remark && remarks.has(row.remark)).map(({ id, name, import_key }) => ({ id, name, import_key }));
    }
    if (this.query.includes("FROM proxy_nodes n")
      && this.query.includes("LEFT JOIN proxy_node_mutable_state")
      && this.query.includes("WHERE n.remark IN")) {
      const remarks = new Set(this.params.map(String));
      return this.tables.nodes
        .filter((row) => (row.remark && remarks.has(row.remark)) || (row.import_source_name && remarks.has(row.import_source_name)))
        .map(({ id, name, remark, enabled, import_key }) => ({ id, name, remark, enabled, import_key }));
    }
    if (this.query.includes("FROM proxy_node_endpoint_selections s")) {
      const nodeIds = new Set(this.params.map(String));
      const nodeScopedEndpoints = new Set(this.tables.endpoints.filter((row) => row.scope === "node").map((row) => row.id));
      return this.tables.endpointSelections.filter(
        (row) => row.enabled === 1 && nodeIds.has(row.proxy_node_id) && nodeScopedEndpoints.has(row.endpoint_id)
      );
    }
    if (this.query.includes("FROM preferred_endpoint_node_scopes s")) {
      const nodeIds = new Set(this.params.map(String));
      const exclusiveEndpoints = new Set(this.tables.endpoints
        .filter((row) => row.scope === "node" && row.selection_mode === "exclusive")
        .map((row) => row.id));
      return (this.tables.endpointScopes || []).filter(
        (row) => nodeIds.has(row.proxy_node_id) && exclusiveEndpoints.has(row.endpoint_id)
      );
    }
    if (this.query.includes("FROM proxy_node_traffic_bindings")) {
      const nodeIds = new Set(this.params.map(String));
      return (this.tables.trafficBindings || []).filter((row) => row.enabled === 1 && nodeIds.has(row.proxy_node_id));
    }
    if (this.query.includes("FROM proxy_node_sni_selections")) {
      const nodeIds = new Set(this.params.map(String));
      return (this.tables.sniSelections || []).filter((row) => row.enabled === 1 && nodeIds.has(row.proxy_node_id));
    }
    if (this.query.includes("SELECT id")
      && this.query.includes("FROM preferred_endpoints")
      && this.query.includes("selection_mode <> 'exclusive'")) {
      const ids = new Set(this.params.map(String));
      return this.tables.endpoints
        .filter((row) => ids.has(row.id) && row.scope === "node" && row.selection_mode !== "exclusive")
        .map((row) => ({ id: row.id }));
    }
    if (this.query.includes("SELECT * FROM proxy_nodes WHERE id = ?")) {
      return this.tables.nodes.filter((row) => row.id === this.params[0]);
    }
    if (this.query.includes("SELECT * FROM proxy_nodes WHERE name = ?")) {
      return this.tables.nodes.filter((row) => row.name === this.params[0]);
    }
    if (this.query.includes("SELECT * FROM proxy_nodes WHERE import_key = ?")) {
      return this.tables.nodes.filter((row) => row.import_key === this.params[0]);
    }
    if (this.query.includes("SELECT import_key FROM proxy_nodes")) {
      return this.tables.nodes.map((row) => ({ import_key: row.import_key || null }));
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

function node(id: string, name: string, remark: string, rawConfig: string, rawHash: string): ProxyNodeRow {
  return {
    id,
    name,
    remark,
    source_type: "v2ray_uri",
    raw_config: rawConfig,
    import_key: `import:v1:${remark}:${rawHash}`,
    import_source_name: remark,
    raw_config_hash: rawHash,
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
    const rawConfig = "vless://00000000-0000-4000-8000-000000000000@new.example:443?security=tls&type=ws#content";
    const tables: TableMap = {
      nodes: [node("old_node", "content", "managed-sub", rawConfig, "0eeaed8594ef0d34470debacf478e7c3f72f4140")],
      endpoints: [
        {
          id: "endpoint_private",
          type: "ip",
          value: "192.168.1.120",
          label: null,
          resolve_mode: "none",
          selection_mode: "additive",
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
          selection_mode: "additive",
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
        rawConfig,
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

  it("preserves exclusive endpoint scopes when imported nodes are replaced", async () => {
    const rawConfig = "vless://00000000-0000-4000-8000-000000000000@new.example:443?security=tls&type=ws#content";
    const tables: TableMap = {
      nodes: [node("old_node", "content", "managed-sub", rawConfig, "0eeaed8594ef0d34470debacf478e7c3f72f4140")],
      endpoints: [{
        id: "endpoint_exclusive",
        type: "domain",
        value: "edge.example.com",
        label: "exclusive-edge",
        resolve_mode: "none",
        selection_mode: "exclusive",
        enabled: 1,
        scope: "node",
        default_selected: 0,
        sort_order: 0,
        created_at: "",
        updated_at: ""
      }],
      endpointSelections: [
        { proxy_node_id: "old_node", endpoint_id: "endpoint_exclusive", enabled: 1 }
      ],
      endpointScopes: [
        { proxy_node_id: "old_node", endpoint_id: "endpoint_exclusive" }
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
        rawConfig,
        protocol: "vless"
      }]
    });

    expect(result).toMatchObject({ imported: 1, deletedOld: 1, skipped: 0 });
    expect(tables.nodes).toHaveLength(1);
    expect(tables.endpointScopes).toEqual([
      { proxy_node_id: tables.nodes[0].id, endpoint_id: "endpoint_exclusive" }
    ]);
    expect(tables.endpointSelections).toEqual([
      { proxy_node_id: tables.nodes[0].id, endpoint_id: "endpoint_exclusive", enabled: 1 }
    ]);
  });

  it("preserves imported node display state and traffic bindings when refreshed", async () => {
    const rawConfig = "vless://00000000-0000-4000-8000-000000000000@new.example:443?security=tls&type=ws#content";
    const oldNode = node("old_node", "custom alias", "custom remark", rawConfig, "0eeaed8594ef0d34470debacf478e7c3f72f4140");
    oldNode.import_key = "import:v1:managed-sub:0eeaed8594ef0d34470debacf478e7c3f72f4140";
    oldNode.import_source_name = "managed-sub";
    oldNode.enabled = 0;
    const tables: TableMap = {
      nodes: [oldNode],
      endpoints: [],
      endpointSelections: [],
      trafficBindings: [{ proxy_node_id: "old_node", traffic_key: "swarm:hd01|target:http://s1:80", enabled: 1 }],
      sniSelections: [{ proxy_node_id: "old_node", sni_id: "sni_1", enabled: 1 }]
    };

    const result = await __adminApiTestHooks.importProxyNodes(env(tables), {
      remark: "managed-sub",
      replaceExistingForRemark: true,
      candidates: [{
        id: "candidate_1",
        sourceName: "managed-sub",
        sourceType: "v2ray_uri",
        name: "content",
        rawConfig,
        protocol: "vless"
      }]
    });

    expect(result).toMatchObject({ imported: 1, deletedOld: 1, skipped: 0 });
    expect(tables.nodes).toHaveLength(1);
    expect(tables.nodes[0]).toMatchObject({
      name: "custom alias",
      remark: "custom remark",
      enabled: 0,
      use_tunnel: 1
    });
    expect(tables.trafficBindings).toEqual([
      { proxy_node_id: tables.nodes[0].id, traffic_key: "swarm:hd01|target:http://s1:80", enabled: 1 }
    ]);
    expect(tables.sniSelections).toEqual([
      { proxy_node_id: tables.nodes[0].id, sni_id: "sni_1", enabled: 1 }
    ]);
  });

  it("imports same-name nodes when their raw configs differ", async () => {
    const tables: TableMap = { nodes: [], endpoints: [], endpointSelections: [] };

    const result = await __adminApiTestHooks.importProxyNodes(env(tables), {
      remark: "sui.hk",
      candidates: [
        {
          id: "candidate_1",
          sourceName: "https://sub.example.com/a.txt",
          sourceGroup: "sui.hk",
          sourceType: "v2ray_uri",
          name: "direct-out@usr",
          rawConfig: "vless://00000000-0000-4000-8000-000000000001@one.example:443?security=tls&type=ws#direct-out%40usr",
          protocol: "vless"
        },
        {
          id: "candidate_2",
          sourceName: "https://sub.example.com/b.txt",
          sourceGroup: "sui.hk",
          sourceType: "v2ray_uri",
          name: "direct-out@usr",
          rawConfig: "vless://00000000-0000-4000-8000-000000000002@two.example:443?security=tls&type=ws#direct-out%40usr",
          protocol: "vless"
        }
      ]
    });

    expect(result).toMatchObject({ imported: 2, updated: 0, skipped: 0 });
    expect(tables.nodes).toHaveLength(2);
    expect(new Set(tables.nodes.map((row) => row.import_key)).size).toBe(2);
    expect(tables.nodes.map((row) => row.name).sort()).toEqual(["a direct-out@usr", "b direct-out@usr"]);
  });

  it("keeps import identity stable for volatile reality params", async () => {
    const tables: TableMap = { nodes: [], endpoints: [], endpointSelections: [] };

    const result = await __adminApiTestHooks.importProxyNodes(env(tables), {
      remark: "usually@3xui.hk",
      candidates: [
        {
          id: "candidate_1",
          sourceName: "usually@3xui.hk",
          sourceGroup: "usually@3xui.hk",
          sourceType: "v2ray_uri",
          name: "reality-node",
          rawConfig: "vless://00000000-0000-4000-8000-000000000001@origin.example:443?security=reality&type=tcp&fp=chrome&sni=hkust.edu.hk&sid=aaa&spx=bbb#reality-node",
          protocol: "vless"
        },
        {
          id: "candidate_2",
          sourceName: "usually@3xui.hk",
          sourceGroup: "usually@3xui.hk",
          sourceType: "v2ray_uri",
          name: "reality-node",
          rawConfig: "vless://00000000-0000-4000-8000-000000000001@origin.example:443?security=reality&type=tcp&fp=chrome&sni=hkust.edu.hk&sid=ccc&spx=ddd#reality-node",
          protocol: "vless"
        }
      ]
    });

    expect(result).toMatchObject({ imported: 1, updated: 0, skipped: 1 });
    expect(tables.nodes).toHaveLength(1);
    expect(tables.nodes[0].name).toBe("reality-node");
  });

  it("derives imported node names from the selected TLS carrier before duplicate fallback", async () => {
    const tables: TableMap = { nodes: [], endpoints: [], endpointSelections: [] };

    const result = await __adminApiTestHooks.importProxyNodes(env(tables), {
      remark: "managed-sub",
      candidates: [
        {
          id: "carrier",
          sourceName: "managed-sub",
          sourceGroup: "managed-sub",
          sourceType: "v2ray_uri",
          name: "xxx-tls-entry",
          rawConfig: "vless://00000000-0000-4000-8000-000000000003@carrier.example:443?security=tls&type=ws&sni=carrier.example#carrier",
          protocol: "vless",
          asTlsCarrier: true
        },
        {
          id: "child",
          sourceName: "managed-sub",
          sourceGroup: "managed-sub",
          sourceType: "v2ray_uri",
          name: "node-c",
          rawConfig: "vless://00000000-0000-4000-8000-000000000004@origin.example:80?type=ws#child",
          protocol: "vless",
          parentIds: ["carrier"]
        }
      ]
    });

    expect(result).toMatchObject({ imported: 2, skipped: 0 });
    expect(tables.nodes.map((row) => row.name)).toContain("node-c <xxx-tls-entry>");
  });
});
