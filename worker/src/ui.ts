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
      --bg: #f6f7f9;
      --panel: #ffffff;
      --line: #d8dee8;
      --soft: #eef2f6;
      --text: #17202a;
      --muted: #647181;
      --accent: #0f766e;
      --accent-weak: #e6f4f1;
      --bad: #b42318;
      --warn: #b54708;
      --ok: #067647;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    header { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 18px; border-bottom: 1px solid var(--line); background: var(--panel); position: sticky; top: 0; z-index: 10; }
    h1 { font-size: 18px; margin: 0; letter-spacing: 0; }
    h2 { font-size: 15px; margin: 0; letter-spacing: 0; }
    h3 { font-size: 14px; margin: 0 0 10px; letter-spacing: 0; }
    main { max-width: 1440px; margin: 0 auto; padding: 16px; }
    nav { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 14px; }
    button, input, select, textarea { font: inherit; }
    button { border: 1px solid var(--line); background: #fff; color: var(--text); border-radius: 6px; padding: 7px 10px; cursor: pointer; min-height: 34px; white-space: nowrap; }
    button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    button.active { border-color: var(--accent); color: var(--accent); background: var(--accent-weak); }
    button.danger { color: var(--bad); }
    button:disabled { cursor: not-allowed; opacity: 0.55; }
    label { display: grid; gap: 5px; color: var(--muted); font-size: 12px; }
    input, select, textarea { width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 8px; background: #fff; color: var(--text); min-height: 36px; }
    select[multiple] { min-height: 116px; }
    textarea { min-height: 108px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid var(--line); text-align: left; padding: 8px; vertical-align: top; }
    th { color: var(--muted); font-weight: 600; background: #fbfcfe; position: sticky; top: 62px; z-index: 2; }
    pre { white-space: pre-wrap; overflow: auto; max-height: 520px; }
    .tokenbar { display: grid; grid-template-columns: minmax(200px, 420px) auto auto; gap: 8px; align-items: center; }
    .notice { margin: 0 0 12px; border: 1px solid var(--line); border-radius: 6px; padding: 9px 10px; background: #fff; color: var(--muted); min-height: 38px; }
    .notice.ok { color: var(--ok); border-color: #a9e3c5; background: #f0fdf4; }
    .notice.error { color: var(--bad); border-color: #fecdca; background: #fff1f3; }
    .notice.warn { color: var(--warn); border-color: #fedf89; background: #fffbeb; }
    .grid { display: grid; gap: 12px; }
    .metrics { grid-template-columns: repeat(4, minmax(150px, 1fr)); }
    .metric { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px; min-height: 76px; }
    .metric .value { font-size: 25px; line-height: 1; margin-top: 8px; }
    .section { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px; margin-bottom: 14px; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .row-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .formgrid { display: grid; grid-template-columns: repeat(4, minmax(160px, 1fr)); gap: 10px; align-items: end; }
    .formgrid .wide { grid-column: span 2; }
    .formgrid .full { grid-column: 1 / -1; }
    .split { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(340px, 0.92fr); gap: 12px; align-items: start; }
    .two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: start; }
    .stack { display: grid; gap: 12px; }
    .hidden { display: none; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; word-break: break-all; }
    .muted { color: var(--muted); }
    .small { font-size: 12px; }
    .status { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 8px; font-size: 12px; border: 1px solid var(--line); background: #fff; white-space: nowrap; }
    .status.healthy, .status.online, .status.enabled { color: var(--ok); border-color: #a9e3c5; background: #f0fdf4; }
    .status.unhealthy, .status.failed, .status.offline, .status.disabled { color: var(--bad); border-color: #fecdca; background: #fff1f3; }
    .status.degraded, .status.stale, .status.warning, .status.unknown { color: var(--warn); border-color: #fedf89; background: #fffbeb; }
    .checkbox { width: 18px; min-height: 18px; }
    @media (max-width: 980px) {
      header { align-items: stretch; flex-direction: column; }
      .tokenbar, .metrics, .formgrid, .split, .two { grid-template-columns: 1fr; }
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
      <button id="saveToken" class="primary">Login</button>
      <button id="clearToken">Logout</button>
    </div>
  </header>
  <main>
    <div id="notice" class="notice warn">Public status loaded. Login unlocks management actions.</div>
    <nav id="tabs">
      <button data-tab="dashboard" class="active">Dashboard</button>
      <button data-tab="tunnels">Tunnels</button>
      <button data-tab="nodes">Proxy Nodes</button>
      <button data-tab="endpoints">Preferred Endpoints</button>
      <button data-tab="subscriptions">Subscriptions</button>
    </nav>

    <section id="dashboard" class="view">
      <div class="grid metrics">
        <div class="metric"><div class="muted">Agents Online</div><div id="metricAgents" class="value">0/0</div></div>
        <div class="metric"><div class="muted">Tunnels Healthy</div><div id="metricHealthy" class="value">0/0</div></div>
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
        <table><thead><tr><th>Type</th><th>Health</th><th>Swarm Node</th><th>Target</th><th>Public Host</th><th>Seen</th><th>Actions</th></tr></thead><tbody id="tunnelsBody"></tbody></table>
      </div>
    </section>

    <section id="nodes" class="view hidden">
      <div class="split">
        <div class="stack">
          <div class="section">
            <div class="toolbar">
              <h2>Node Sources</h2>
              <div class="actions"><button id="refreshNodes">Refresh</button><button id="cancelNodeEdit">Cancel Edit</button></div>
            </div>
            <div class="formgrid">
              <label>Name<input id="sourceName" placeholder="s1-vless"></label>
              <label>Remark<input id="sourceRemark" placeholder="optional"></label>
              <label>Enabled<select id="sourceEnabled"><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
              <div class="actions"><button id="saveNodeSource" class="primary">Add Source</button></div>
              <label class="full">Raw Config<textarea id="sourceRaw" placeholder="vless://, vmess://, trojan://, ss:// or sing-box outbound JSON"></textarea></label>
            </div>
          </div>

          <div class="section">
            <h2>Import From Subscription</h2>
            <div class="formgrid">
              <label class="wide">Subscription URLs<textarea id="importUrls" placeholder="https://example.com/sub.txt"></textarea></label>
              <label class="wide">Paste Content<textarea id="importContent" placeholder="base64 subscription, share links, or sing-box JSON"></textarea></label>
              <label>Name Prefix<input id="importPrefix" placeholder="optional"></label>
              <div class="actions"><button id="importSubscription" class="primary">Import Nodes</button></div>
            </div>
          </div>
        </div>

        <div class="section">
          <h2>Traffic Binding</h2>
          <div class="formgrid">
            <label class="wide">Nodes<select id="bindingNodes" multiple></select></label>
            <label>Traffic Path<select id="bindingMode"><option value="direct">Direct</option><option value="tunnel">Cloudflare Tunnel</option></select></label>
            <label>Tunnel<select id="bindingTunnel"></select></label>
            <label class="wide">Preferred Endpoints<select id="bindingEndpoints" multiple></select></label>
            <div class="actions">
              <button id="applyBinding" class="primary">Apply Binding</button>
              <button id="clearBindingEndpoints">Clear Endpoints</button>
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <table><thead><tr><th>Select</th><th>Node</th><th>Protocol</th><th>Traffic Path</th><th>Endpoints</th><th>Enabled</th><th>Actions</th></tr></thead><tbody id="nodesBody"></tbody></table>
      </div>
    </section>

    <section id="endpoints" class="view hidden">
      <div class="section">
        <div class="toolbar">
          <h2>Preferred Endpoint Pool</h2>
          <div class="actions"><button id="refreshEndpoints">Refresh</button><button id="cancelEndpointEdit">Cancel Edit</button></div>
        </div>
        <div class="formgrid">
          <label>Type<select id="endpointType"><option value="ip">IP</option><option value="domain">Domain</option></select></label>
          <label>Availability<select id="endpointScope"><option value="global">Global Pool</option><option value="node">Selected Nodes</option></select></label>
          <label>Fallback<select id="endpointDefault"><option value="false">Explicit Selection</option><option value="true">Default Fallback</option></select></label>
          <label>Enabled<select id="endpointEnabled"><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
          <label class="wide">Values<textarea id="endpointValues" placeholder="162.159.1.1, 104.16.1.1&#10;cdn.example.com"></textarea></label>
          <label>Label<input id="endpointLabel" placeholder="optional"></label>
          <label>Sort Order<input id="endpointSort" type="number" value="0"></label>
          <label class="wide">Visible To<select id="endpointNodes" multiple></select></label>
          <div class="actions"><button id="createEndpoint" class="primary">Add Endpoints</button></div>
        </div>
      </div>
      <div class="section">
        <table><thead><tr><th>Type</th><th>Value</th><th>Availability</th><th>Fallback</th><th>Visible To</th><th>Enabled</th><th>Actions</th></tr></thead><tbody id="endpointsBody"></tbody></table>
      </div>
    </section>

    <section id="subscriptions" class="view hidden">
      <div class="split">
        <div class="section">
          <div class="toolbar"><h2>Subscription Links</h2><button id="rotateSubscriptionToken" class="danger">Rotate Token</button></div>
          <table><tbody id="subscriptionLinks"></tbody></table>
          <h2>Groups</h2>
          <div class="formgrid">
            <label>Group Name<input id="groupName" placeholder="group"></label>
            <label class="wide">Members<select id="groupNodes" multiple></select></label>
            <label>Endpoint Mode<select id="groupEndpointMode"><option value="selected">Node Selections</option><option value="ip">IP Only</option><option value="domain">Domain Only</option><option value="all">All Visible</option><option value="none">No Preferred Endpoint</option></select></label>
            <div class="actions"><button id="createGroup" class="primary">Add Group</button></div>
          </div>
          <table><thead><tr><th>Name</th><th>Endpoint Mode</th><th>Members</th><th>Actions</th></tr></thead><tbody id="groupsBody"></tbody></table>
        </div>
        <div class="section">
          <h2>Preview</h2>
          <div class="formgrid">
            <label>Format<select id="previewFormat"><option value="v2ray">V2Ray</option><option value="passwall2">PassWall2</option><option value="sing-box">sing-box</option></select></label>
            <label>Group Filter<input id="previewGroup" placeholder="optional"></label>
            <label>Endpoint Mode<select id="previewEndpointMode"><option value="selected">Node Selections</option><option value="ip">IP Only</option><option value="domain">Domain Only</option><option value="all">All Visible</option><option value="none">No Preferred Endpoint</option></select></label>
            <div class="actions"><button id="runPreview" class="primary">Preview</button></div>
          </div>
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

    const byId = (id) => document.getElementById(id);
    const tokenInput = byId('tokenInput');
    const notice = byId('notice');
    const metricAgents = byId('metricAgents');
    const metricHealthy = byId('metricHealthy');
    const metricUnhealthy = byId('metricUnhealthy');
    const metricCommands = byId('metricCommands');
    const eventsBody = byId('eventsBody');
    const tunnelsBody = byId('tunnelsBody');
    const nodesBody = byId('nodesBody');
    const endpointsBody = byId('endpointsBody');
    const groupsBody = byId('groupsBody');
    const subscriptionLinks = byId('subscriptionLinks');
    const previewOutput = byId('previewOutput');

    tokenInput.value = localStorage.getItem('adminToken') || '';

    function hasToken() {
      return Boolean((localStorage.getItem('adminToken') || '').trim());
    }
    function authHeaders() {
      return { Authorization: 'Bearer ' + (localStorage.getItem('adminToken') || ''), 'Content-Type': 'application/json' };
    }
    function setNotice(message, kind) {
      notice.textContent = message;
      notice.className = 'notice' + (kind ? ' ' + kind : '');
    }
    function formatError(err) {
      const text = String((err && err.message) || err || 'Request failed');
      if (text.includes('401') || text.toLowerCase().includes('token')) return 'Login failed. Check the admin token.';
      return text.length > 240 ? text.slice(0, 240) + '...' : text;
    }
    async function api(path, opts) {
      const res = await fetch(path, { ...(opts || {}), headers: { ...authHeaders(), ...((opts && opts.headers) || {}) } });
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      if (res.status === 204) return null;
      return await res.json();
    }
    async function publicApi(path) {
      const res = await fetch(path);
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      return await res.json();
    }
    function esc(v) {
      return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function selectedValues(el) {
      return Array.from(el.selectedOptions).map((o) => o.value).filter(Boolean);
    }
    function unique(values) {
      return Array.from(new Set(values.filter(Boolean)));
    }
    function statusPill(value) {
      const clean = String(value || 'unknown');
      return '<span class="status ' + esc(clean) + '">' + esc(clean) + '</span>';
    }
    function lockedRow(cols) {
      return '<tr><td colspan="' + cols + '" class="muted">Login required.</td></tr>';
    }
    function markSelected(select, values) {
      const set = new Set(values || []);
      Array.from(select.options).forEach((option) => { option.selected = set.has(option.value); });
    }
    function applyMetrics(data) {
      state.overview = data;
      const agents = data.agents || {};
      const tunnels = data.tunnels || {};
      const commands = data.commands || {};
      metricAgents.textContent = String(agents.online || 0) + '/' + String(agents.total || 0);
      metricHealthy.textContent = String(tunnels.healthy || 0) + '/' + String(tunnels.total || 0);
      metricUnhealthy.textContent = String(tunnels.unhealthy || 0);
      metricCommands.textContent = String(commands.pending || 0);
    }
    function clearPrivateViews() {
      eventsBody.innerHTML = lockedRow(4);
      tunnelsBody.innerHTML = lockedRow(7);
      nodesBody.innerHTML = lockedRow(7);
      endpointsBody.innerHTML = lockedRow(7);
      groupsBody.innerHTML = lockedRow(4);
      subscriptionLinks.innerHTML = '<tr><td class="muted">Login required.</td></tr>';
      previewOutput.textContent = '';
      state.tunnels = [];
      state.nodes = [];
      state.endpoints = [];
      state.groups = [];
      renderTunnelOptions();
      renderNodeOptions();
      renderEndpointOptions();
    }
    function activate(tab) {
      document.querySelectorAll('.view').forEach((el) => el.classList.toggle('hidden', el.id !== tab));
      document.querySelectorAll('#tabs button').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
      refreshAll();
    }

    byId('tabs').addEventListener('click', (e) => {
      if (e.target.dataset && e.target.dataset.tab) activate(e.target.dataset.tab);
    });

    async function refreshPublicOverview() {
      const data = await publicApi('/api/public/overview');
      applyMetrics(data);
      return data;
    }
    async function refreshDashboard() {
      const data = await api('/api/admin/overview');
      applyMetrics(data);
      eventsBody.innerHTML = (data.recentEvents || []).map((row) =>
        '<tr><td>' + esc(row.created_at) + '</td><td>' + statusPill(row.severity) + '</td><td>' + esc(row.event_type) + '</td><td>' + esc(row.message) + '</td></tr>'
      ).join('') || '<tr><td colspan="4" class="muted">No events.</td></tr>';
      renderSubscriptionLinks();
    }
    async function refreshTunnels() {
      const data = await api('/api/admin/tunnels');
      state.tunnels = data.tunnels || [];
      renderTunnelOptions();
      tunnelsBody.innerHTML = state.tunnels.map((row) =>
        '<tr><td>' + esc(row.type) + '</td><td>' + statusPill(row.health_status) + '</td><td>' + esc(row.swarm_node_name || row.agent_id) + '</td><td class="mono">' + esc(row.target_url) + '</td><td class="mono">' + esc(row.public_hostname) + '</td><td>' + esc(row.last_seen_at) + '</td><td class="row-actions"><button data-copy="' + esc(row.public_hostname || '') + '">Copy</button>' + (row.type === 'quick' ? '<button data-restart="' + esc(row.id) + '">Restart</button>' : '') + '</td></tr>'
      ).join('') || '<tr><td colspan="7" class="muted">No tunnels.</td></tr>';
    }
    async function refreshNodes() {
      const data = await api('/api/admin/proxy-nodes');
      state.nodes = data.proxyNodes || [];
      renderNodeOptions();
      nodesBody.innerHTML = state.nodes.map((row) => {
        const path = row.use_tunnel ? (row.tunnel_public_hostname || row.selected_tunnel_id || 'Tunnel not selected') : 'Direct';
        const endpointCount = (row.selectedEndpointIds || []).length;
        return '<tr><td><input class="checkbox" type="checkbox" data-node-check="' + esc(row.id) + '"></td><td>' + esc(row.name) + '<br><span class="muted">' + esc(row.remark || '') + '</span></td><td>' + esc(row.protocol) + '</td><td class="mono">' + esc(path) + '</td><td>' + esc(endpointCount) + '</td><td>' + statusPill(row.enabled ? 'enabled' : 'disabled') + '</td><td class="row-actions"><button data-edit-node="' + esc(row.id) + '">Edit Source</button><button data-bind-node="' + esc(row.id) + '">Bind</button><button data-delete-node="' + esc(row.id) + '" class="danger">Delete</button></td></tr>';
      }).join('') || '<tr><td colspan="7" class="muted">No proxy nodes.</td></tr>';
    }
    async function refreshEndpoints() {
      const data = await api('/api/admin/preferred-endpoints');
      state.endpoints = data.preferredEndpoints || [];
      renderEndpointOptions();
      endpointsBody.innerHTML = state.endpoints.map((row) =>
        '<tr><td>' + esc(row.type) + '</td><td class="mono">' + esc(row.value) + '<br><span class="muted">' + esc(row.label || '') + '</span></td><td>' + esc(row.scope === 'global' ? 'Global Pool' : 'Selected Nodes') + '</td><td>' + esc(row.default_selected ? 'Default Fallback' : 'Explicit Selection') + '</td><td>' + esc(row.scope === 'global' ? 'All nodes' : ((row.proxyNodeIds || []).length + ' nodes')) + '</td><td>' + statusPill(row.enabled ? 'enabled' : 'disabled') + '</td><td class="row-actions"><button data-edit-endpoint="' + esc(row.id) + '">Edit</button><button data-delete-endpoint="' + esc(row.id) + '" class="danger">Delete</button></td></tr>'
      ).join('') || '<tr><td colspan="7" class="muted">No preferred endpoints.</td></tr>';
    }
    async function refreshGroups() {
      const data = await api('/api/admin/groups');
      state.groups = data.groups || [];
      renderGroupNodeOptions();
      groupsBody.innerHTML = state.groups.map((row) =>
        '<tr><td>' + esc(row.name) + '</td><td>' + esc(row.endpoint_mode) + '</td><td>' + esc((row.proxyNodeIds || []).length) + '</td><td class="row-actions"><button data-edit-group="' + esc(row.id) + '">Edit</button><button data-delete-group="' + esc(row.id) + '" class="danger">Delete</button></td></tr>'
      ).join('') || '<tr><td colspan="4" class="muted">No groups.</td></tr>';
    }

    function renderTunnelOptions() {
      const options = '<option value="">Select tunnel</option>' + state.tunnels.map((t) =>
        '<option value="' + esc(t.id) + '">' + esc((t.swarm_node_name || t.agent_id) + ' / ' + (t.target_url || t.public_hostname || t.tunnel_key)) + '</option>'
      ).join('');
      byId('bindingTunnel').innerHTML = options;
    }
    function renderNodeOptions() {
      const options = state.nodes.map((n) => '<option value="' + esc(n.id) + '">' + esc(n.name) + '</option>').join('');
      byId('bindingNodes').innerHTML = options;
      byId('endpointNodes').innerHTML = options;
      byId('groupNodes').innerHTML = options;
    }
    function renderEndpointOptions() {
      const options = state.endpoints.map((e) => {
        const label = (e.label || e.value) + ' / ' + e.type + ' / ' + (e.scope === 'global' ? 'global' : 'node');
        return '<option value="' + esc(e.id) + '">' + esc(label) + '</option>';
      }).join('');
      byId('bindingEndpoints').innerHTML = options;
    }
    function renderGroupNodeOptions() {
      byId('groupNodes').innerHTML = state.nodes.map((n) => '<option value="' + esc(n.id) + '">' + esc(n.name) + '</option>').join('');
    }
    function renderSubscriptionLinks() {
      const base = BASE_URL || location.origin;
      const urls = (state.overview && state.overview.subscriptionUrls) || {};
      const rows = [
        ['V2Ray', urls.v2ray || base + '/sub/v2ray/'],
        ['PassWall2', urls.passwall2 || base + '/sub/passwall2/'],
        ['sing-box', urls.singBox || base + '/sub/sing-box/']
      ];
      subscriptionLinks.innerHTML = rows.map(([name, url]) => '<tr><th>' + name + '</th><td class="mono">' + esc(url) + '</td><td><button data-copy="' + esc(url) + '">Copy</button></td></tr>').join('');
    }

    function resetNodeSourceForm() {
      editingNodeId = null;
      byId('saveNodeSource').textContent = 'Add Source';
      byId('sourceName').value = '';
      byId('sourceRemark').value = '';
      byId('sourceRaw').value = '';
      byId('sourceEnabled').value = 'true';
    }
    function resetEndpointForm() {
      editingEndpointId = null;
      byId('createEndpoint').textContent = 'Add Endpoints';
      byId('endpointType').value = 'ip';
      byId('endpointScope').value = 'global';
      byId('endpointDefault').value = 'false';
      byId('endpointEnabled').value = 'true';
      byId('endpointValues').value = '';
      byId('endpointLabel').value = '';
      byId('endpointSort').value = '0';
      markSelected(byId('endpointNodes'), []);
      updateEndpointScopeState();
    }
    function resetGroupForm() {
      editingGroupId = null;
      byId('createGroup').textContent = 'Add Group';
      byId('groupName').value = '';
      byId('groupEndpointMode').value = 'selected';
      markSelected(byId('groupNodes'), []);
    }
    function updateEndpointScopeState() {
      const nodeScoped = byId('endpointScope').value === 'node';
      byId('endpointNodes').disabled = !nodeScoped;
      if (!nodeScoped) markSelected(byId('endpointNodes'), []);
    }
    function selectedBindingNodeIds() {
      const checked = Array.from(document.querySelectorAll('[data-node-check]:checked')).map((input) => input.dataset.nodeCheck);
      return unique(checked.concat(selectedValues(byId('bindingNodes'))));
    }
    function loadBindingFromNode(row) {
      markSelected(byId('bindingNodes'), [row.id]);
      byId('bindingMode').value = row.use_tunnel ? 'tunnel' : 'direct';
      byId('bindingTunnel').value = row.selected_tunnel_id || '';
      markSelected(byId('bindingEndpoints'), row.selectedEndpointIds || []);
    }

    document.body.addEventListener('click', async (e) => {
      const t = e.target;
      if (!t || !t.dataset) return;
      try {
        if (t.dataset.copy) {
          await navigator.clipboard.writeText(t.dataset.copy);
          setNotice('Copied.', 'ok');
        }
        if (t.dataset.restart) {
          await api('/api/admin/tunnels/' + t.dataset.restart + '/restart', { method: 'POST', body: '{}' });
          setNotice('Restart command queued.', 'ok');
          await refreshTunnels();
        }
        if (t.dataset.editNode) {
          const row = state.nodes.find((item) => item.id === t.dataset.editNode);
          if (row) {
            editingNodeId = row.id;
            byId('saveNodeSource').textContent = 'Save Source';
            byId('sourceName').value = row.name || '';
            byId('sourceRemark').value = row.remark || '';
            byId('sourceRaw').value = row.raw_config || '';
            byId('sourceEnabled').value = row.enabled ? 'true' : 'false';
          }
        }
        if (t.dataset.bindNode) {
          const row = state.nodes.find((item) => item.id === t.dataset.bindNode);
          if (row) loadBindingFromNode(row);
        }
        if (t.dataset.deleteNode) {
          await api('/api/admin/proxy-nodes/' + t.dataset.deleteNode, { method: 'DELETE' });
          setNotice('Node deleted.', 'ok');
          await refreshNodes();
        }
        if (t.dataset.editEndpoint) {
          const row = state.endpoints.find((item) => item.id === t.dataset.editEndpoint);
          if (row) {
            editingEndpointId = row.id;
            byId('createEndpoint').textContent = 'Save Endpoint';
            byId('endpointType').value = row.type || 'ip';
            byId('endpointScope').value = row.scope || 'global';
            byId('endpointDefault').value = row.default_selected ? 'true' : 'false';
            byId('endpointEnabled').value = row.enabled ? 'true' : 'false';
            byId('endpointValues').value = row.value || '';
            byId('endpointLabel').value = row.label || '';
            byId('endpointSort').value = String(row.sort_order || 0);
            markSelected(byId('endpointNodes'), row.proxyNodeIds || []);
            updateEndpointScopeState();
          }
        }
        if (t.dataset.deleteEndpoint) {
          await api('/api/admin/preferred-endpoints/' + t.dataset.deleteEndpoint, { method: 'DELETE' });
          setNotice('Endpoint deleted.', 'ok');
          await refreshEndpoints();
        }
        if (t.dataset.editGroup) {
          const row = state.groups.find((item) => item.id === t.dataset.editGroup);
          if (row) {
            editingGroupId = row.id;
            byId('createGroup').textContent = 'Save Group';
            byId('groupName').value = row.name || '';
            byId('groupEndpointMode').value = row.endpoint_mode || 'selected';
            markSelected(byId('groupNodes'), row.proxyNodeIds || []);
          }
        }
        if (t.dataset.deleteGroup) {
          await api('/api/admin/groups/' + t.dataset.deleteGroup, { method: 'DELETE' });
          setNotice('Group deleted.', 'ok');
          await refreshGroups();
        }
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    });

    byId('saveToken').onclick = async () => {
      localStorage.setItem('adminToken', tokenInput.value.trim());
      await refreshAll(true);
    };
    byId('clearToken').onclick = async () => {
      localStorage.removeItem('adminToken');
      tokenInput.value = '';
      await refreshAll();
      setNotice('Logged out. Public status remains visible.', 'warn');
    };
    byId('cancelNodeEdit').onclick = resetNodeSourceForm;
    byId('cancelEndpointEdit').onclick = resetEndpointForm;
    byId('endpointScope').onchange = updateEndpointScopeState;

    byId('saveNodeSource').onclick = async () => {
      try {
        const path = editingNodeId ? '/api/admin/proxy-nodes/' + editingNodeId : '/api/admin/proxy-nodes';
        const method = editingNodeId ? 'PATCH' : 'POST';
        const wasEditing = Boolean(editingNodeId);
        await api(path, { method, body: JSON.stringify({
          name: byId('sourceName').value,
          remark: byId('sourceRemark').value,
          rawConfig: byId('sourceRaw').value,
          enabled: byId('sourceEnabled').value === 'true'
        }) });
        resetNodeSourceForm();
        setNotice(wasEditing ? 'Node source saved.' : 'Node source added.', 'ok');
        await refreshNodes();
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    };
    byId('importSubscription').onclick = async () => {
      try {
        const data = await api('/api/admin/proxy-nodes/import-subscription', {
          method: 'POST',
          body: JSON.stringify({
            urls: byId('importUrls').value,
            content: byId('importContent').value,
            namePrefix: byId('importPrefix').value,
            enabled: true
          })
        });
        byId('importUrls').value = '';
        byId('importContent').value = '';
        setNotice('Imported ' + data.imported + ' nodes' + (data.errors && data.errors.length ? '; ' + data.errors.join('; ') : '.') , data.imported ? 'ok' : 'warn');
        await refreshNodes();
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    };
    byId('applyBinding').onclick = async () => {
      try {
        const ids = selectedBindingNodeIds();
        if (ids.length === 0) throw new Error('Select at least one node.');
        const useTunnel = byId('bindingMode').value === 'tunnel';
        if (useTunnel && !byId('bindingTunnel').value) throw new Error('Select a tunnel for tunnel traffic path.');
        await Promise.all(ids.map((id) => api('/api/admin/proxy-nodes/' + id, {
          method: 'PATCH',
          body: JSON.stringify({
            useTunnel,
            selectedTunnelId: useTunnel ? byId('bindingTunnel').value : null,
            selectedEndpointIds: selectedValues(byId('bindingEndpoints'))
          })
        })));
        setNotice('Binding applied to ' + ids.length + ' node(s).', 'ok');
        await refreshNodes();
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    };
    byId('clearBindingEndpoints').onclick = async () => {
      try {
        const ids = selectedBindingNodeIds();
        if (ids.length === 0) throw new Error('Select at least one node.');
        await Promise.all(ids.map((id) => api('/api/admin/proxy-nodes/' + id, {
          method: 'PATCH',
          body: JSON.stringify({ selectedEndpointIds: [] })
        })));
        markSelected(byId('bindingEndpoints'), []);
        setNotice('Endpoint selections cleared for ' + ids.length + ' node(s).', 'ok');
        await refreshNodes();
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    };
    byId('createEndpoint').onclick = async () => {
      try {
        const path = editingEndpointId ? '/api/admin/preferred-endpoints/' + editingEndpointId : '/api/admin/preferred-endpoints';
        const method = editingEndpointId ? 'PATCH' : 'POST';
        const wasEditing = Boolean(editingEndpointId);
        const body = {
          type: byId('endpointType').value,
          label: byId('endpointLabel').value,
          scope: byId('endpointScope').value,
          defaultSelected: byId('endpointDefault').value === 'true',
          enabled: byId('endpointEnabled').value === 'true',
          sortOrder: Number(byId('endpointSort').value || 0),
          proxyNodeIds: byId('endpointScope').value === 'node' ? selectedValues(byId('endpointNodes')) : []
        };
        if (editingEndpointId) body.value = byId('endpointValues').value;
        else body.values = byId('endpointValues').value;
        const data = await api(path, { method, body: JSON.stringify(body) });
        resetEndpointForm();
        const count = data.preferredEndpoints ? data.preferredEndpoints.length : 1;
        setNotice(wasEditing ? 'Endpoint saved.' : 'Added ' + count + ' endpoint(s).', 'ok');
        await refreshEndpoints();
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    };
    byId('createGroup').onclick = async () => {
      try {
        const path = editingGroupId ? '/api/admin/groups/' + editingGroupId : '/api/admin/groups';
        const method = editingGroupId ? 'PATCH' : 'POST';
        const wasEditing = Boolean(editingGroupId);
        await api(path, { method, body: JSON.stringify({
          name: byId('groupName').value,
          endpointMode: byId('groupEndpointMode').value,
          proxyNodeIds: selectedValues(byId('groupNodes'))
        }) });
        resetGroupForm();
        setNotice(wasEditing ? 'Group saved.' : 'Group added.', 'ok');
        await refreshGroups();
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    };
    byId('rotateSubscriptionToken').onclick = async () => {
      try {
        await api('/api/admin/subscriptions/rotate-token', { method: 'POST', body: '{}' });
        setNotice('Subscription token rotated.', 'ok');
        await refreshDashboard();
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    };
    byId('runPreview').onclick = async () => {
      try {
        const params = new URLSearchParams({ format: byId('previewFormat').value, endpointMode: byId('previewEndpointMode').value });
        if (byId('previewGroup').value) params.set('group', byId('previewGroup').value);
        previewOutput.textContent = JSON.stringify(await api('/api/admin/subscriptions/preview?' + params.toString()), null, 2);
        setNotice('Preview updated.', 'ok');
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    };
    byId('refreshDashboard').onclick = () => hasToken() ? refreshDashboard().catch((err) => setNotice(formatError(err), 'error')) : refreshAll();
    byId('refreshTunnels').onclick = () => refreshTunnels().catch((err) => setNotice(formatError(err), 'error'));
    byId('refreshNodes').onclick = () => refreshNodes().catch((err) => setNotice(formatError(err), 'error'));
    byId('refreshEndpoints').onclick = () => refreshEndpoints().catch((err) => setNotice(formatError(err), 'error'));

    async function refreshAll(fromLogin) {
      try {
        await refreshPublicOverview();
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
      if (!hasToken()) {
        clearPrivateViews();
        if (!fromLogin) setNotice('Public status loaded. Login unlocks management actions.', 'warn');
        return;
      }
      try {
        await refreshDashboard();
        await refreshTunnels();
        await refreshNodes();
        await refreshEndpoints();
        await refreshGroups();
        if (fromLogin) setNotice('Signed in.', 'ok');
      } catch (err) {
        clearPrivateViews();
        setNotice(formatError(err), 'error');
      }
    }

    updateEndpointScopeState();
    refreshAll(false);
  </script>
</body>
</html>`;
}
