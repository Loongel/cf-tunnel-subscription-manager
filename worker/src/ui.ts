import type { Env } from "./types";

export function renderAdminUi(env: Env): string {
  const baseUrl = env.PUBLIC_BASE_URL || "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CF Tunnel Control</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --line: #d9dee7;
      --text: #17202a;
      --muted: #5f6b7a;
      --accent: #0f766e;
      --bad: #b42318;
      --warn: #b54708;
      --ok: #067647;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line); background: var(--panel); position: sticky; top: 0; z-index: 5; }
    h1 { font-size: 18px; margin: 0; letter-spacing: 0; }
    h2 { font-size: 15px; margin: 0 0 12px; letter-spacing: 0; }
    main { max-width: 1400px; margin: 0 auto; padding: 16px; }
    nav { display: flex; gap: 8px; flex-wrap: wrap; }
    button, input, select, textarea { font: inherit; }
    button { border: 1px solid var(--line); background: #fff; color: var(--text); border-radius: 6px; padding: 7px 10px; cursor: pointer; min-height: 34px; }
    button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    button.active { border-color: var(--accent); color: var(--accent); }
    button.danger { color: var(--bad); }
    input, select, textarea { width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 8px; background: #fff; color: var(--text); min-height: 36px; }
    textarea { min-height: 96px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    .tokenbar { display: grid; grid-template-columns: minmax(180px, 420px) auto auto; gap: 8px; align-items: center; }
    .band { background: var(--panel); border-bottom: 1px solid var(--line); }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
    .grid { display: grid; gap: 12px; }
    .metrics { grid-template-columns: repeat(4, minmax(150px, 1fr)); }
    .metric { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px; min-height: 74px; }
    .metric .value { font-size: 26px; line-height: 1; margin-top: 8px; }
    .section { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px; margin-bottom: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid var(--line); text-align: left; padding: 8px; vertical-align: top; }
    th { color: var(--muted); font-weight: 600; background: #fbfcfe; position: sticky; top: 62px; }
    .status { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 8px; font-size: 12px; border: 1px solid var(--line); }
    .status.healthy, .status.online { color: var(--ok); border-color: #a9e3c5; background: #f0fdf4; }
    .status.unhealthy, .status.failed, .status.offline { color: var(--bad); border-color: #fecdca; background: #fff1f3; }
    .status.degraded, .status.stale, .status.warning { color: var(--warn); border-color: #fedf89; background: #fffbeb; }
    .muted { color: var(--muted); }
    .row-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .formgrid { display: grid; grid-template-columns: repeat(4, minmax(160px, 1fr)); gap: 10px; align-items: end; }
    .formgrid .wide { grid-column: span 2; }
    .hidden { display: none; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; word-break: break-all; }
    .split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 420px); gap: 12px; }
    @media (max-width: 900px) {
      header { align-items: stretch; flex-direction: column; gap: 10px; }
      .tokenbar { grid-template-columns: 1fr; }
      .metrics, .formgrid, .split { grid-template-columns: 1fr; }
      .formgrid .wide { grid-column: span 1; }
      th { position: static; }
    }
  </style>
</head>
<body>
  <header>
    <h1>CF Tunnel Control</h1>
    <div class="tokenbar">
      <input id="tokenInput" type="password" autocomplete="off" placeholder="Admin token">
      <button id="saveToken" class="primary">Save</button>
      <button id="clearToken">Clear</button>
    </div>
  </header>
  <main>
    <nav id="tabs">
      <button data-tab="dashboard" class="active">Dashboard</button>
      <button data-tab="tunnels">Tunnels</button>
      <button data-tab="nodes">Proxy Nodes</button>
      <button data-tab="endpoints">Preferred Endpoints</button>
      <button data-tab="subscriptions">Subscriptions</button>
    </nav>

    <section id="dashboard" class="view">
      <div class="grid metrics">
        <div class="metric"><div class="muted">Agents Online</div><div id="metricAgents" class="value">0</div></div>
        <div class="metric"><div class="muted">Tunnels Healthy</div><div id="metricHealthy" class="value">0</div></div>
        <div class="metric"><div class="muted">Tunnels Unhealthy</div><div id="metricUnhealthy" class="value">0</div></div>
        <div class="metric"><div class="muted">Commands Pending</div><div id="metricCommands" class="value">0</div></div>
      </div>
      <div class="section">
        <div class="toolbar"><h2>Recent Events</h2><button id="refreshDashboard">Refresh</button></div>
        <table><thead><tr><th>Time</th><th>Severity</th><th>Event</th><th>Message</th></tr></thead><tbody id="eventsBody"></tbody></table>
      </div>
    </section>

    <section id="tunnels" class="view hidden">
      <div class="section">
        <div class="toolbar"><h2>Tunnels</h2><button id="refreshTunnels">Refresh</button></div>
        <table><thead><tr><th>Type</th><th>Health</th><th>Node</th><th>Target</th><th>Public Host</th><th>Seen</th><th>Actions</th></tr></thead><tbody id="tunnelsBody"></tbody></table>
      </div>
    </section>

    <section id="nodes" class="view hidden">
      <div class="section">
        <div class="toolbar"><h2>Proxy Nodes</h2><button id="refreshNodes">Refresh</button></div>
        <div class="formgrid">
          <input id="nodeName" placeholder="Node name">
          <input id="nodeRemark" placeholder="Remark">
          <select id="nodeTunnel"></select>
          <select id="nodeUseTunnel"><option value="false">Direct</option><option value="true">Use tunnel</option></select>
          <textarea id="nodeRaw" class="wide" placeholder="vless://, vmess://, trojan://, ss:// or sing-box outbound JSON"></textarea>
          <select id="nodeEndpoints" class="wide" multiple></select>
          <button id="createNode" class="primary">Add Node</button>
        </div>
      </div>
      <div class="section">
        <table><thead><tr><th>Node</th><th>Protocol</th><th>Tunnel</th><th>Endpoints</th><th>Enabled</th><th>Actions</th></tr></thead><tbody id="nodesBody"></tbody></table>
      </div>
    </section>

    <section id="endpoints" class="view hidden">
      <div class="section">
        <div class="toolbar"><h2>Preferred Endpoints</h2><button id="refreshEndpoints">Refresh</button></div>
        <div class="formgrid">
          <select id="endpointType"><option value="ip">IP</option><option value="domain">Domain</option></select>
          <input id="endpointValue" placeholder="Value">
          <input id="endpointLabel" placeholder="Label">
          <select id="endpointScope"><option value="global">Global</option><option value="node">Node-specific</option></select>
          <select id="endpointNodes" class="wide" multiple></select>
          <select id="endpointDefault"><option value="false">Not default</option><option value="true">Default selected</option></select>
          <button id="createEndpoint" class="primary">Add Endpoint</button>
        </div>
      </div>
      <div class="section">
        <table><thead><tr><th>Type</th><th>Value</th><th>Scope</th><th>Default</th><th>Visible To</th><th>Actions</th></tr></thead><tbody id="endpointsBody"></tbody></table>
      </div>
    </section>

    <section id="subscriptions" class="view hidden">
      <div class="split">
        <div class="section">
          <h2>Subscription Links</h2>
          <button id="rotateSubscriptionToken" class="danger">Rotate Token</button>
          <table><tbody id="subscriptionLinks"></tbody></table>
          <h2>Groups</h2>
          <div class="formgrid">
            <input id="groupName" placeholder="Group name">
            <select id="groupNodes" class="wide" multiple></select>
            <select id="groupEndpointMode"><option value="selected">Node selections</option><option value="ip">IP only</option><option value="domain">Domain only</option><option value="all">All visible</option><option value="none">No preferred endpoint</option></select>
            <button id="createGroup" class="primary">Add Group</button>
          </div>
          <table><thead><tr><th>Name</th><th>Endpoint Mode</th><th>Members</th><th>Actions</th></tr></thead><tbody id="groupsBody"></tbody></table>
        </div>
        <div class="section">
          <h2>Preview</h2>
          <select id="previewFormat"><option value="v2ray">V2Ray</option><option value="passwall2">PassWall2</option><option value="sing-box">sing-box</option></select>
          <input id="previewGroup" placeholder="Group filter">
          <select id="previewEndpointMode"><option value="selected">Node selections</option><option value="ip">IP only</option><option value="domain">Domain only</option><option value="all">All visible</option><option value="none">No preferred endpoint</option></select>
          <button id="runPreview" class="primary">Preview</button>
          <pre id="previewOutput" class="mono"></pre>
        </div>
      </div>
    </section>
  </main>

  <script>
    const BASE_URL = ${JSON.stringify(baseUrl)};
    const state = { overview: null, tunnels: [], nodes: [], endpoints: [], groups: [] };
    let editingNodeId = null;
    let editingEndpointId = null;
    let editingGroupId = null;
    const tokenInput = document.getElementById('tokenInput');
    tokenInput.value = localStorage.getItem('adminToken') || '';
    const authHeaders = () => ({ Authorization: 'Bearer ' + (localStorage.getItem('adminToken') || ''), 'Content-Type': 'application/json' });
    async function api(path, opts = {}) {
      const res = await fetch(path, { ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) } });
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      if (res.status === 204) return null;
      return await res.json();
    }
    function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function selectedValues(el) { return Array.from(el.selectedOptions).map(o => o.value).filter(Boolean); }
    function statusPill(value) { return '<span class="status ' + esc(value) + '">' + esc(value || 'unknown') + '</span>'; }
    function activate(tab) {
      document.querySelectorAll('.view').forEach(el => el.classList.toggle('hidden', el.id !== tab));
      document.querySelectorAll('#tabs button').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
      refreshAll();
    }
    document.getElementById('tabs').addEventListener('click', e => { if (e.target.dataset.tab) activate(e.target.dataset.tab); });
    document.getElementById('saveToken').onclick = () => { localStorage.setItem('adminToken', tokenInput.value); refreshAll(); };
    document.getElementById('clearToken').onclick = () => { localStorage.removeItem('adminToken'); tokenInput.value = ''; };

    async function refreshDashboard() {
      const data = await api('/api/admin/overview');
      state.overview = data;
      metricAgents.textContent = data.agents.online || 0;
      metricHealthy.textContent = data.tunnels.healthy || 0;
      metricUnhealthy.textContent = data.tunnels.unhealthy || 0;
      metricCommands.textContent = data.commands.pending || 0;
      eventsBody.innerHTML = (data.recentEvents || []).map(row =>
        '<tr><td>' + esc(row.created_at) + '</td><td>' + statusPill(row.severity) + '</td><td>' + esc(row.event_type) + '</td><td>' + esc(row.message) + '</td></tr>'
      ).join('');
      renderSubscriptionLinks();
    }
    async function refreshTunnels() {
      const data = await api('/api/admin/tunnels');
      state.tunnels = data.tunnels || [];
      renderTunnelOptions();
      tunnelsBody.innerHTML = state.tunnels.map(row =>
        '<tr><td>' + esc(row.type) + '</td><td>' + statusPill(row.health_status) + '</td><td>' + esc(row.swarm_node_name || row.agent_id) + '</td><td class="mono">' + esc(row.target_url) + '</td><td class="mono">' + esc(row.public_hostname) + '</td><td>' + esc(row.last_seen_at) + '</td><td class="row-actions"><button data-copy="' + esc(row.public_hostname || '') + '">Copy</button>' + (row.type === 'quick' ? '<button data-restart="' + esc(row.id) + '">Restart</button>' : '') + '</td></tr>'
      ).join('');
    }
    async function refreshNodes() {
      const data = await api('/api/admin/proxy-nodes');
      state.nodes = data.proxyNodes || [];
      renderEndpointNodeOptions();
      nodesBody.innerHTML = state.nodes.map(row =>
        '<tr><td>' + esc(row.name) + '<br><span class="muted">' + esc(row.remark) + '</span></td><td>' + esc(row.protocol) + '</td><td class="mono">' + esc(row.tunnel_public_hostname || row.selected_tunnel_id || '-') + '</td><td>' + esc((row.selectedEndpointIds || []).length) + '</td><td>' + statusPill(row.enabled ? 'enabled' : 'disabled') + '</td><td class="row-actions"><button data-edit-node="' + esc(row.id) + '">Edit</button><button data-delete-node="' + esc(row.id) + '" class="danger">Delete</button></td></tr>'
      ).join('');
    }
    async function refreshEndpoints() {
      const data = await api('/api/admin/preferred-endpoints');
      state.endpoints = data.preferredEndpoints || [];
      renderEndpointOptions();
      endpointsBody.innerHTML = state.endpoints.map(row =>
        '<tr><td>' + esc(row.type) + '</td><td class="mono">' + esc(row.value) + '<br><span class="muted">' + esc(row.label) + '</span></td><td>' + esc(row.scope) + '</td><td>' + esc(row.default_selected ? 'yes' : 'no') + '</td><td>' + esc((row.proxyNodeIds || []).length) + '</td><td class="row-actions"><button data-edit-endpoint="' + esc(row.id) + '">Edit</button><button data-delete-endpoint="' + esc(row.id) + '" class="danger">Delete</button></td></tr>'
      ).join('');
    }
    async function refreshGroups() {
      const data = await api('/api/admin/groups');
      state.groups = data.groups || [];
      renderGroupNodeOptions();
      groupsBody.innerHTML = state.groups.map(row =>
        '<tr><td>' + esc(row.name) + '</td><td>' + esc(row.endpoint_mode) + '</td><td>' + esc((row.proxyNodeIds || []).length) + '</td><td class="row-actions"><button data-edit-group="' + esc(row.id) + '">Edit</button><button data-delete-group="' + esc(row.id) + '" class="danger">Delete</button></td></tr>'
      ).join('');
    }
    function renderTunnelOptions() {
      const options = '<option value="">No tunnel</option>' + state.tunnels.map(t => '<option value="' + esc(t.id) + '">' + esc((t.swarm_node_name || t.agent_id) + ' / ' + (t.target_url || t.public_hostname || t.tunnel_key)) + '</option>').join('');
      nodeTunnel.innerHTML = options;
    }
    function renderEndpointOptions() {
      const options = state.endpoints.map(e => '<option value="' + esc(e.id) + '">' + esc((e.label || e.value) + ' / ' + e.scope) + '</option>').join('');
      nodeEndpoints.innerHTML = options;
    }
    function renderEndpointNodeOptions() {
      const options = state.nodes.map(n => '<option value="' + esc(n.id) + '">' + esc(n.name) + '</option>').join('');
      endpointNodes.innerHTML = options;
    }
    function renderGroupNodeOptions() {
      const options = state.nodes.map(n => '<option value="' + esc(n.id) + '">' + esc(n.name) + '</option>').join('');
      groupNodes.innerHTML = options;
    }
    function renderSubscriptionLinks() {
      const base = BASE_URL || location.origin;
      const urls = state.overview?.subscriptionUrls || {};
      const rows = [
        ['V2Ray', urls.v2ray || base + '/sub/v2ray/'],
        ['PassWall2', urls.passwall2 || base + '/sub/passwall2/'],
        ['sing-box', urls.singBox || base + '/sub/sing-box/']
      ];
      subscriptionLinks.innerHTML = rows.map(([name, url]) => '<tr><th>' + name + '</th><td class="mono">' + esc(url) + '</td><td><button data-copy="' + esc(url) + '">Copy</button></td></tr>').join('');
    }
    function markSelected(select, values) {
      const set = new Set(values || []);
      Array.from(select.options).forEach(option => { option.selected = set.has(option.value); });
    }
    function resetNodeForm() {
      editingNodeId = null;
      createNode.textContent = 'Add Node';
      nodeName.value = nodeRemark.value = nodeRaw.value = '';
      nodeTunnel.value = '';
      nodeUseTunnel.value = 'false';
      markSelected(nodeEndpoints, []);
    }
    function resetEndpointForm() {
      editingEndpointId = null;
      createEndpoint.textContent = 'Add Endpoint';
      endpointValue.value = endpointLabel.value = '';
      endpointType.value = 'ip';
      endpointScope.value = 'global';
      endpointDefault.value = 'false';
      markSelected(endpointNodes, []);
    }
    function resetGroupForm() {
      editingGroupId = null;
      createGroup.textContent = 'Add Group';
      groupName.value = '';
      groupEndpointMode.value = 'selected';
      markSelected(groupNodes, []);
    }
    document.body.addEventListener('click', async e => {
      const t = e.target;
      if (t.dataset.copy) await navigator.clipboard.writeText(t.dataset.copy);
      if (t.dataset.restart) { await api('/api/admin/tunnels/' + t.dataset.restart + '/restart', { method: 'POST', body: '{}' }); await refreshTunnels(); }
      if (t.dataset.editNode) {
        const row = state.nodes.find(item => item.id === t.dataset.editNode);
        if (row) {
          editingNodeId = row.id;
          createNode.textContent = 'Save Node';
          nodeName.value = row.name || '';
          nodeRemark.value = row.remark || '';
          nodeRaw.value = row.raw_config || '';
          nodeTunnel.value = row.selected_tunnel_id || '';
          nodeUseTunnel.value = row.use_tunnel ? 'true' : 'false';
          markSelected(nodeEndpoints, row.selectedEndpointIds || []);
        }
      }
      if (t.dataset.editEndpoint) {
        const row = state.endpoints.find(item => item.id === t.dataset.editEndpoint);
        if (row) {
          editingEndpointId = row.id;
          createEndpoint.textContent = 'Save Endpoint';
          endpointType.value = row.type || 'ip';
          endpointValue.value = row.value || '';
          endpointLabel.value = row.label || '';
          endpointScope.value = row.scope || 'global';
          endpointDefault.value = row.default_selected ? 'true' : 'false';
          markSelected(endpointNodes, row.proxyNodeIds || []);
        }
      }
      if (t.dataset.editGroup) {
        const row = state.groups.find(item => item.id === t.dataset.editGroup);
        if (row) {
          editingGroupId = row.id;
          createGroup.textContent = 'Save Group';
          groupName.value = row.name || '';
          groupEndpointMode.value = row.endpoint_mode || 'selected';
          markSelected(groupNodes, row.proxyNodeIds || []);
        }
      }
      if (t.dataset.deleteNode) { await api('/api/admin/proxy-nodes/' + t.dataset.deleteNode, { method: 'DELETE' }); await refreshNodes(); }
      if (t.dataset.deleteEndpoint) { await api('/api/admin/preferred-endpoints/' + t.dataset.deleteEndpoint, { method: 'DELETE' }); await refreshEndpoints(); }
      if (t.dataset.deleteGroup) { await api('/api/admin/groups/' + t.dataset.deleteGroup, { method: 'DELETE' }); await refreshGroups(); }
    });
    createNode.onclick = async () => {
      const path = editingNodeId ? '/api/admin/proxy-nodes/' + editingNodeId : '/api/admin/proxy-nodes';
      const method = editingNodeId ? 'PATCH' : 'POST';
      await api(path, { method, body: JSON.stringify({
        name: nodeName.value, remark: nodeRemark.value, rawConfig: nodeRaw.value,
        useTunnel: nodeUseTunnel.value === 'true', selectedTunnelId: nodeTunnel.value || null,
        selectedEndpointIds: selectedValues(nodeEndpoints)
      }) });
      resetNodeForm();
      await refreshNodes();
    };
    createEndpoint.onclick = async () => {
      const path = editingEndpointId ? '/api/admin/preferred-endpoints/' + editingEndpointId : '/api/admin/preferred-endpoints';
      const method = editingEndpointId ? 'PATCH' : 'POST';
      await api(path, { method, body: JSON.stringify({
        type: endpointType.value, value: endpointValue.value, label: endpointLabel.value,
        scope: endpointScope.value, defaultSelected: endpointDefault.value === 'true',
        proxyNodeIds: selectedValues(endpointNodes)
      }) });
      resetEndpointForm();
      await refreshEndpoints();
    };
    createGroup.onclick = async () => {
      const path = editingGroupId ? '/api/admin/groups/' + editingGroupId : '/api/admin/groups';
      const method = editingGroupId ? 'PATCH' : 'POST';
      await api(path, { method, body: JSON.stringify({
        name: groupName.value,
        endpointMode: groupEndpointMode.value,
        proxyNodeIds: selectedValues(groupNodes)
      }) });
      resetGroupForm();
      await refreshGroups();
    };
    rotateSubscriptionToken.onclick = async () => {
      await api('/api/admin/subscriptions/rotate-token', { method: 'POST', body: '{}' });
      await refreshDashboard();
    };
    runPreview.onclick = async () => {
      const params = new URLSearchParams({ format: previewFormat.value, endpointMode: previewEndpointMode.value });
      if (previewGroup.value) params.set('group', previewGroup.value);
      previewOutput.textContent = JSON.stringify(await api('/api/admin/subscriptions/preview?' + params.toString()), null, 2);
    };
    refreshDashboard.onclick = refreshDashboard;
    refreshTunnels.onclick = refreshTunnels;
    refreshNodes.onclick = refreshNodes;
    refreshEndpoints.onclick = refreshEndpoints;
    async function refreshAll() {
      try {
        await Promise.all([refreshDashboard(), refreshTunnels()]);
        await refreshNodes();
        await refreshEndpoints();
        await refreshGroups();
      } catch (err) {
        previewOutput.textContent = String(err.message || err);
      }
    }
    refreshAll();
  </script>
</body>
</html>`;
}
