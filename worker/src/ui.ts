import type { Env } from "./types";

export function renderAdminUi(env: Env): string {
  const baseUrl = env.PUBLIC_BASE_URL || "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cloudflare Tunnel Subscription Manager</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b1020;
      --surface: #111827;
      --panel: #141c2c;
      --panel-2: #182235;
      --panel-3: #0f1726;
      --line: #263348;
      --line-strong: #3a4a63;
      --text: #eef4fb;
      --muted: #a7b4c4;
      --faint: #6f7f93;
      --accent: #60a5fa;
      --accent-2: #93c5fd;
      --selected: #ea580c;
      --selected-soft: rgba(234, 88, 12, 0.16);
      --selected-text: #fffaf5;
      --ok: #34d399;
      --warn: #fbbf24;
      --bad: #fb7185;
      --shadow: rgba(0, 0, 0, 0.28);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
      background: rgba(11, 16, 32, 0.92);
      backdrop-filter: blur(10px);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    h1 { font-size: 18px; margin: 0; letter-spacing: 0; }
    h2 { font-size: 15px; margin: 0; letter-spacing: 0; }
    h3 { font-size: 13px; margin: 0; letter-spacing: 0; color: var(--text); }
    main { max-width: 1480px; margin: 0 auto; padding: 16px; }
    nav { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 14px; }
    button, input, select, textarea { font: inherit; }
    button {
      border: 1px solid var(--line);
      background: var(--panel-2);
      color: var(--text);
      border-radius: 6px;
      padding: 7px 10px;
      cursor: pointer;
      min-height: 34px;
      white-space: nowrap;
    }
    button:hover { border-color: var(--accent); background: #1d2a40; }
    button.primary { background: #2563eb; color: #f8fbff; border-color: #3b82f6; box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.18) inset; }
    button.primary:hover { background: #1d4ed8; }
    button.active { border-color: var(--accent); color: #dbeafe; background: rgba(96, 165, 250, 0.14); }
    button.danger { color: var(--bad); }
    button.subtle { color: var(--muted); }
    button:disabled { cursor: not-allowed; opacity: 0.55; }
    label { display: grid; gap: 5px; color: var(--muted); font-size: 12px; }
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px;
      background: var(--surface);
      color: var(--text);
      min-height: 36px;
      outline: none;
    }
    input:focus, select:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.16); }
    select[multiple] { min-height: 128px; }
    select option {
      background: var(--surface);
      color: var(--text);
      padding: 7px 8px;
    }
    select option:checked,
    select option:checked:hover,
    select option:checked:focus,
    select:focus option:checked {
      background: var(--selected) linear-gradient(0deg, var(--selected), var(--selected));
      color: var(--selected-text);
      box-shadow: 0 0 0 999px var(--selected) inset;
    }
    select option:disabled {
      color: #7f8b9a;
      background: #1b2433;
    }
    textarea { min-height: 108px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid var(--line); text-align: left; padding: 9px 8px; vertical-align: top; }
    th { color: var(--muted); font-weight: 600; background: #151f31; position: sticky; top: 62px; z-index: 2; }
    pre { white-space: pre-wrap; overflow: auto; max-height: 520px; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brandmark { width: 26px; height: 26px; border: 1px solid var(--accent); border-radius: 6px; display: grid; place-items: center; color: #dbeafe; background: rgba(96, 165, 250, 0.12); font-size: 14px; }
    .tokenbar { display: grid; grid-template-columns: minmax(220px, 430px) auto auto; gap: 8px; align-items: center; }
    .notice { margin: 0 0 12px; border: 1px solid var(--line); border-radius: 6px; padding: 9px 10px; background: rgba(20, 28, 44, 0.88); color: var(--muted); min-height: 38px; }
    .notice {
      position: fixed;
      top: 58px;
      left: 50%;
      transform: translateX(-50%);
      width: min(920px, calc(100vw - 24px));
      z-index: 50;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.42);
      opacity: 0;
      pointer-events: none;
      transition: opacity 160ms ease, transform 160ms ease;
    }
    .notice.show { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0); }
    .notice button { min-height: 26px; padding: 2px 8px; border-color: transparent; background: transparent; color: var(--muted); }
    .notice.ok { color: var(--ok); border-color: rgba(52, 211, 153, 0.42); background: rgba(52, 211, 153, 0.09); }
    .notice.error { color: var(--bad); border-color: rgba(251, 113, 133, 0.42); background: rgba(251, 113, 133, 0.08); }
    .notice.warn { color: var(--warn); border-color: rgba(251, 191, 36, 0.42); background: rgba(251, 191, 36, 0.08); }
    .grid { display: grid; gap: 12px; }
    .metrics { grid-template-columns: repeat(4, minmax(150px, 1fr)); }
    .metric { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px; min-height: 78px; box-shadow: 0 12px 28px var(--shadow); }
    .metric .value { font-size: 25px; line-height: 1; margin-top: 8px; color: var(--accent-2); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .section { background: rgba(20, 28, 44, 0.96); border: 1px solid var(--line); border-radius: 6px; padding: 12px; margin-bottom: 14px; box-shadow: 0 12px 28px var(--shadow); }
    .subpanel { border: 1px solid var(--line); background: var(--panel-3); border-radius: 6px; padding: 10px; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .row-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .formgrid { display: grid; grid-template-columns: repeat(4, minmax(160px, 1fr)); gap: 10px; align-items: end; }
    .formgrid .wide { grid-column: span 2; }
    .formgrid .full { grid-column: 1 / -1; }
    .split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(420px, 0.85fr); gap: 12px; align-items: start; }
    .node-layout { grid-template-columns: 1fr; }
    .stack { display: grid; gap: 12px; }
    .binding-grid { display: grid; grid-template-columns: minmax(360px, 1.12fr) minmax(360px, 0.88fr); gap: 12px; align-items: stretch; }
    .binding-picker, .binding-editor { min-height: 390px; }
    .filterbar { display: grid; grid-template-columns: minmax(0, 1fr) minmax(140px, auto); gap: 8px; align-items: center; margin-bottom: 8px; }
    .binding-node-select { display: none; }
    .binding-list { display: grid; gap: 7px; max-height: clamp(300px, 42vh, 620px); overflow: auto; padding-right: 3px; }
    .binding-row { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 8px; align-items: center; border: 1px solid var(--line); background: var(--surface); border-radius: 6px; padding: 8px; cursor: pointer; }
    .binding-row:hover { border-color: var(--accent); }
    .binding-row.selected { border-color: #fb923c; background: var(--selected-soft); box-shadow: 0 0 0 1px rgba(251, 146, 60, 0.25) inset; }
    .binding-row input { width: 16px; min-height: 16px; }
    .binding-row-main { min-width: 0; }
    .binding-row-main strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
    .binding-row-main span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 12px; margin-top: 2px; }
    .binding-row-badges { display: flex; gap: 5px; flex-wrap: wrap; justify-content: flex-end; }
    .mini-badge { border: 1px solid var(--line-strong); border-radius: 999px; color: var(--muted); font-size: 11px; padding: 2px 7px; background: #121b2a; white-space: nowrap; }
    .mini-badge.active { color: var(--accent-2); border-color: rgba(96, 165, 250, 0.48); background: rgba(96, 165, 250, 0.1); }
    .binding-field { display: grid; gap: 8px; }
    .binding-field select[multiple] { min-height: clamp(170px, 24vh, 320px); }
    .hidden { display: none; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; word-break: break-all; }
    .muted { color: var(--muted); }
    .small { font-size: 12px; }
    .count { color: var(--accent-2); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .status { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 8px; font-size: 12px; border: 1px solid var(--line); background: #111827; white-space: nowrap; }
    .status.healthy, .status.online, .status.enabled { color: var(--ok); border-color: rgba(52, 211, 153, 0.42); background: rgba(52, 211, 153, 0.09); }
    .status.unhealthy, .status.failed, .status.offline, .status.disabled { color: var(--bad); border-color: rgba(251, 113, 133, 0.42); background: rgba(251, 113, 133, 0.08); }
    .status.degraded, .status.stale, .status.warning, .status.unknown { color: var(--warn); border-color: rgba(251, 191, 36, 0.42); background: rgba(251, 191, 36, 0.08); }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; min-height: 34px; align-items: center; }
    .chip { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line-strong); border-radius: 999px; padding: 3px 8px; color: var(--accent-2); background: rgba(96, 165, 250, 0.1); font-size: 12px; }
    .check-list { display: grid; gap: 7px; max-height: 332px; overflow: auto; padding-right: 2px; }
    .check-row { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 8px; align-items: start; border: 1px solid var(--line); background: var(--surface); border-radius: 6px; padding: 8px; color: var(--text); }
    .check-row:hover { border-color: var(--accent); }
    .check-row input { width: 16px; min-height: 16px; margin-top: 2px; }
    .row-title { display: flex; justify-content: space-between; gap: 8px; color: var(--text); }
    .row-meta { color: var(--muted); font-size: 12px; margin-top: 3px; }
    .derived-grid { display: grid; gap: 9px; max-height: clamp(560px, 62vh, 820px); overflow: auto; padding-right: 2px; }
    .chip-row { display: grid; gap: 9px; align-items: start; border: 1px solid var(--line); background: var(--surface); border-radius: 6px; padding: 9px; }
    .chip-row-title { min-width: 0; }
    .chip-row-title strong { display: block; color: var(--accent-2); font-size: 12px; letter-spacing: 0; overflow-wrap: anywhere; line-height: 1.25; }
    .chip-row-title span { color: var(--muted); font-size: 12px; display: block; margin-top: 2px; }
    .chip-options { display: flex; gap: 7px; flex-wrap: wrap; align-items: center; }
    .select-chip { border: 1px solid var(--line-strong); border-radius: 999px; padding: 6px 11px; min-height: 31px; max-width: 100%; color: var(--muted); background: #1a2435; font-size: 12px; line-height: 1.2; text-align: left; }
    .select-chip:hover { color: var(--text); border-color: var(--accent); }
    .select-chip.selected { color: var(--selected-text); border-color: #fb923c; background: var(--selected); box-shadow: 0 0 0 2px var(--selected-soft); }
    .copy-chip { color: var(--accent-2); border-color: rgba(96, 165, 250, 0.38); background: rgba(96, 165, 250, 0.1); }
    .copy-chip:hover { color: #f8fbff; background: rgba(96, 165, 250, 0.18); }
    .select-chip .chip-main { font-weight: 700; }
    .select-chip .chip-sub { margin-left: 6px; color: rgba(231, 237, 243, 0.72); overflow-wrap: anywhere; }
    .select-chip span { pointer-events: none; }
    .group-chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .saved-groups-scroll { max-height: clamp(420px, 54vh, 760px); overflow: auto; border: 1px solid var(--line); border-radius: 6px; }
    .saved-groups-scroll table th { top: 0; }
    .group-member { display: inline-grid; grid-template-columns: minmax(160px, 260px) minmax(0, 1fr); gap: 6px; align-items: center; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); padding: 6px; max-width: 100%; }
    .group-member-name { color: var(--text); font-size: 12px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
    .group-member-tags { display: flex; flex-wrap: wrap; gap: 5px; min-width: 0; }
    .group-chip { display: inline-flex; align-items: center; border: 1px solid var(--line-strong); border-radius: 999px; padding: 4px 8px; color: var(--accent-2); background: rgba(96, 165, 250, 0.1); font-size: 12px; max-width: min(360px, 100%); line-height: 1.2; }
    .group-chip span { overflow-wrap: anywhere; }
    .link-chip-grid { display: grid; gap: 9px; }
    .link-chip-row { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 10px; align-items: center; }
    .link-chip-row strong { color: var(--muted); font-size: 12px; text-transform: uppercase; }
    .link-chips { display: flex; flex-wrap: wrap; gap: 7px; }
    .import-review { display: grid; gap: 10px; margin-top: 12px; }
    .import-list { display: grid; gap: 7px; }
    .import-row { display: grid; grid-template-columns: minmax(260px, 1.2fr) minmax(220px, 0.8fr) auto auto; gap: 8px; align-items: start; }
    .import-row.child { padding-left: 28px; border-left: 2px solid var(--selected); }
    .import-node { display: flex; align-items: center; gap: 6px 8px; flex-wrap: wrap; min-width: 0; border: 1px solid var(--line); background: var(--surface); border-radius: 6px; padding: 7px 9px; }
    .import-node.carrier { border-color: #fb923c; background: var(--selected-soft); }
    .import-node.removed { opacity: 0.64; }
    .import-node strong { flex: 1 1 100%; min-width: 0; overflow-wrap: anywhere; line-height: 1.25; }
    .import-node .meta { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .import-node .dup { color: var(--warn); font-size: 12px; white-space: nowrap; }
    .import-name-input { flex: 1 1 100%; min-width: 0; border: 0; padding: 0; background: transparent; color: var(--text); font: inherit; font-weight: 700; outline: none; overflow-wrap: anywhere; }
    .import-name-input:focus { color: var(--selected); }
    .tls-controls { display: grid; gap: 6px; }
    .endpoint-value-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(150px, 190px); gap: 10px; align-items: end; }
    .endpoint-value-grid label { min-width: 0; }
    @media (max-width: 1020px) {
      header { align-items: stretch; flex-direction: column; }
      .tokenbar, .metrics, .formgrid, .split, .binding-grid, .import-row { grid-template-columns: 1fr; }
      .chip-row { grid-template-columns: 1fr; }
      .endpoint-value-grid { grid-template-columns: 1fr; }
      .formgrid .wide { grid-column: span 1; }
      th { position: static; }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand"><div class="brandmark">CF</div><h1>Cloudflare Tunnel Subscription Manager</h1></div>
    <div class="tokenbar">
      <input id="tokenInput" type="password" autocomplete="off" placeholder="Admin token">
      <button id="saveToken" class="primary">Login</button>
      <button id="clearToken">Logout</button>
    </div>
  </header>
  <main>
    <div id="notice" class="notice"><span id="noticeText"></span><button id="noticeClose" aria-label="Dismiss notice">x</button></div>
    <nav id="tabs">
      <button data-tab="dashboard" class="active">Dashboard</button>
      <button data-tab="tunnels">Tunnels</button>
      <button data-tab="snis">SNI</button>
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
        <div class="toolbar"><h2>Agents</h2><button id="refreshAgents">Refresh</button></div>
        <table><thead><tr><th>ID</th><th>Hostname</th><th>Swarm Node</th><th>Status</th><th>Last Seen</th><th>Actions</th></tr></thead><tbody id="agentsBody"></tbody></table>
      </div>
      <div class="section">
        <div class="toolbar"><h2>Recent Events</h2><button id="refreshDashboard">Refresh</button></div>
        <table><thead><tr><th>Time</th><th>Severity</th><th>Event</th><th>Message</th></tr></thead><tbody id="eventsBody"></tbody></table>
      </div>
    </section>

    <section id="tunnels" class="view hidden">
      <div class="section">
        <div class="toolbar"><h2>Tunnels</h2><button id="refreshTunnels">Refresh</button></div>
        <table><thead><tr><th>Type</th><th>Health</th><th>Remark / Association</th><th>Public Host</th><th>Seen</th><th>Actions</th></tr></thead><tbody id="tunnelsBody"></tbody></table>
      </div>
    </section>

    <section id="snis" class="view hidden">
      <div class="section">
        <div class="toolbar">
          <h2>SNI Pool</h2>
          <div class="actions"><button id="refreshSnis">Refresh</button><button id="cancelSniEdit" class="subtle">Cancel Edit</button></div>
        </div>
        <div class="formgrid">
          <label>Name<input id="sniName" placeholder="edge-sni"></label>
          <label>Hostname<input id="sniHostname" placeholder="example.com"></label>
          <label>Enabled<select id="sniEnabled"><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
          <label>Sort Order<input id="sniSort" type="number" value="0"></label>
          <label class="wide">Remark<input id="sniRemark" placeholder="optional"></label>
          <div class="actions"><button id="saveSni" class="primary">Add SNI</button></div>
        </div>
      </div>
      <div class="section">
        <table><thead><tr><th>Name</th><th>Hostname</th><th>Enabled</th><th>Actions</th></tr></thead><tbody id="snisBody"></tbody></table>
      </div>
    </section>

    <section id="nodes" class="view hidden">
      <div class="actions" style="margin-bottom: 12px;">
        <button data-node-panel="nodeManagePanel" class="active">Node Management</button>
        <button data-node-panel="importManagePanel">Subscription Imports</button>
      </div>
      <div id="nodeManagePanel" class="node-panel">
      <div class="split node-layout">
        <div class="stack">
          <div class="section">
            <div class="toolbar">
              <h2>Node Sources</h2>
              <div class="actions"><button id="refreshNodes">Refresh</button><button id="cancelNodeEdit" class="subtle">Cancel Edit</button></div>
            </div>
            <div class="formgrid">
              <label>Name<input id="sourceName" placeholder="s1-vless"></label>
              <label>Remark<input id="sourceRemark" placeholder="optional"></label>
              <label>Enabled<select id="sourceEnabled"><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
              <div class="actions"><button id="saveNodeSource" class="primary">Add Source</button></div>
              <label class="full">Raw Config<textarea id="sourceRaw" placeholder="vless://, vmess://, trojan://, ss://, hysteria2:// or sing-box outbound JSON"></textarea></label>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="toolbar">
            <h2>Traffic Binding</h2>
            <div class="small muted"><span id="bindingSelectedCount" class="count">0</span> selected / <span id="bindingVisibleCount" class="count">0</span> visible</div>
          </div>
          <div class="binding-grid">
            <div class="subpanel binding-picker">
              <div class="toolbar">
                <h3>Nodes To Update</h3>
                <div class="actions"><button id="selectAllBindingNodes" class="subtle">Select All</button><button id="clearBindingNodes" class="subtle">Clear</button></div>
              </div>
              <div class="filterbar">
                <input id="bindingNodeFilter" placeholder="Search nodes">
                <select id="bindingNodeStatus"><option value="all">All nodes</option><option value="enabled">Enabled</option><option value="direct">Direct</option><option value="traffic">With traffic</option></select>
              </div>
              <select id="bindingNodes" class="binding-node-select" multiple></select>
              <div id="bindingNodeList" class="binding-list"></div>
            </div>
            <div class="subpanel stack binding-editor">
              <div class="binding-field">
                <div class="toolbar"><h3>Traffic / SNI</h3></div>
                <input id="bindingTrafficFilter" placeholder="Search traffic or SNI">
                <select id="bindingTraffic" multiple></select>
              </div>
              <div class="binding-field">
                <div class="toolbar"><h3>Additional Endpoints</h3></div>
                <input id="bindingEndpointFilter" placeholder="Search endpoints">
                <select id="bindingEndpoints" multiple></select>
              </div>
              <div class="actions">
                <button id="applyBinding" class="primary">Apply To Selected Nodes</button>
                <button id="clearBindingEndpoints" class="subtle">Clear Additional Endpoints</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <table><thead><tr><th>Node</th><th>Protocol</th><th>Traffic</th><th>Endpoints</th><th>Enabled</th><th>Actions</th></tr></thead><tbody id="nodesBody"></tbody></table>
      </div>
      </div>
      <div id="importManagePanel" class="node-panel hidden">
        <div class="section">
          <div class="toolbar"><h2>Subscription Import Sources</h2><button id="refreshImportSources">Refresh</button></div>
          <div class="formgrid">
            <label>Name<input id="importSourceName" placeholder="airport-a"></label>
            <label>Type<select id="importSourceKind"><option value="url">URL</option><option value="content">Pasted Content</option></select></label>
            <label class="wide">Subscription URLs<textarea id="importSourceUrl" placeholder="https://example.com/sub-a.txt&#10;https://example.com/sub-b.txt"></textarea></label>
            <label class="wide">Paste Content<textarea id="importSourceContent" placeholder="base64 subscription, share links including hysteria2://, or sing-box JSON"></textarea></label>
            <label>Name Prefix<input id="importPrefix" placeholder="optional"></label>
            <label>Enabled<select id="importSourceEnabled"><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
            <label>Exclude Keywords<input id="importExcludeKeywords" placeholder="expire, test"></label>
            <label>Include Keywords<input id="importIncludeKeywords" placeholder="hk, jp"></label>
            <div class="actions"><button id="saveImportSource" class="primary">Save Source</button><button id="cancelImportSourceEdit" class="subtle">Cancel Edit</button></div>
          </div>
        </div>
        <div class="section">
          <table><thead><tr><th>Name</th><th>Source</th><th>Rules</th><th>Last Run</th><th>Actions</th></tr></thead><tbody id="importSourcesBody"></tbody></table>
        </div>
        <div class="section">
          <div class="toolbar"><h2>Import Review</h2><div class="actions"><button id="previewImport" class="primary">Preview Source</button><button id="commitImport">Commit Selected</button><button id="saveImportRules">Save Rules</button></div></div>
          <div class="formgrid">
            <label class="wide">Ad-hoc Subscription URL<textarea id="importUrls" placeholder="https://example.com/sub.txt"></textarea></label>
            <label class="wide">Ad-hoc Paste Content<textarea id="importContent" placeholder="base64 subscription, share links including hysteria2://, or sing-box JSON"></textarea></label>
            <label class="wide">Keyword Filter<input id="importFilterText" placeholder="hk, test, expire"></label>
            <label>Filter Mode<select id="importFilterMode"><option value="exclude">Move matching to unused</option><option value="include">Keep only matching</option></select></label>
            <div class="actions"><button id="applyImportFilter" class="subtle">Apply Filter</button><button id="clearImportReview" class="subtle">Clear Preview</button></div>
          </div>
          <div id="importReview" class="import-review hidden">
            <div class="toolbar"><h3>Import Review</h3><div class="small muted"><span id="importActiveCount" class="count">0</span> selected / <span id="importRemovedCount" class="count">0</span> unused</div></div>
            <div class="subpanel">
              <div class="toolbar"><h3>Selected Nodes</h3><span class="small muted">Choose a TLS carrier for HTTP/content nodes before commit.</span></div>
              <div id="importActiveList" class="import-list"></div>
            </div>
            <div class="subpanel">
              <div class="toolbar"><h3>Unused Nodes</h3><span class="small muted">Removed before saving.</span></div>
              <div id="importRemovedList" class="import-list"></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="endpoints" class="view hidden">
      <div class="section">
        <div class="toolbar">
          <h2>Preferred Endpoint Pool</h2>
          <div class="actions"><button id="refreshEndpoints">Refresh</button><button id="cancelEndpointEdit" class="subtle">Cancel Edit</button></div>
        </div>
        <div class="formgrid">
          <label>Type<select id="endpointType"><option value="ip">IP</option><option value="domain">Domain</option><option value="redirect">Discovery URL</option></select></label>
          <label>Role<select id="endpointRole"><option value="global">Global Always On</option><option value="node">Binding Option</option><option value="exclusive">Exclusive Binding Option</option></select></label>
          <label>Domain Resolve<select id="endpointResolveMode"><option value="none">Do Not Resolve</option><option value="ipv4">Resolve IPv4</option><option value="ipv6">Resolve IPv6</option></select></label>
          <label>Enabled<select id="endpointEnabled"><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
          <label>Sort Order<input id="endpointSort" type="number" value="0"></label>
          <div class="endpoint-value-grid full">
            <label>Values<textarea id="endpointValues" placeholder="162.159.1.1, 104.16.1.1&#10;cdn.example.com&#10;https://discovery.example.com"></textarea></label>
            <label id="endpointPortLabel">Port<input id="endpointPort" inputmode="numeric" placeholder="留空使用原始端口" value="443"></label>
          </div>
          <label class="wide">Label<input id="endpointLabel" placeholder="optional"></label>
          <div id="endpointNodePicker" class="subpanel full hidden">
            <div class="toolbar">
              <h3 id="endpointNodePickerTitle">Exclusive Nodes</h3>
              <div class="small muted"><span id="endpointNodeSelectedCount" class="count">0</span> selected / <span id="endpointNodeVisibleCount" class="count">0</span> visible</div>
              <div class="actions"><button id="selectAllEndpointNodes" type="button" class="subtle">Select All</button><button id="clearEndpointNodes" type="button" class="subtle">Clear</button></div>
            </div>
            <div class="filterbar">
              <input id="endpointNodeFilter" placeholder="Search nodes">
              <select id="endpointNodeStatus"><option value="all">All nodes</option><option value="enabled">Enabled</option><option value="direct">Direct</option><option value="traffic">With traffic</option></select>
            </div>
            <select id="endpointNodeIds" class="binding-node-select" multiple></select>
            <div id="endpointNodeList" class="binding-list"></div>
          </div>
          <div class="actions"><button id="createEndpoint" class="primary">Add Endpoints</button></div>
        </div>
      </div>
      <div class="section">
        <table><thead><tr><th>Type</th><th>Value</th><th>Resolve</th><th>Role</th><th>Usage</th><th>Enabled</th><th>Actions</th></tr></thead><tbody id="endpointsBody"></tbody></table>
      </div>
    </section>

    <section id="subscriptions" class="view hidden">
      <div class="split">
        <div class="stack">
          <div class="section">
            <div class="toolbar"><h2>Subscription Links</h2><button id="rotateSubscriptionToken" class="danger">Rotate Token</button></div>
            <div id="subscriptionLinks" class="link-chip-grid"></div>
          </div>
          <div class="section">
            <div class="toolbar">
              <h2>Groups</h2>
              <button id="cancelGroupEdit" class="subtle">Cancel Edit</button>
            </div>
            <div class="formgrid">
              <label class="wide">Group Name<input id="groupName" placeholder="edge-auto"></label>
              <div class="actions"><button id="createGroup" class="primary">Save Group</button></div>
            </div>
            <div class="toolbar">
              <div class="small muted">Derived members selected <span id="groupSelectedCount" class="count">0</span></div>
              <div class="actions"><button id="selectAllDerived" class="subtle">Select All</button><button id="clearDerived" class="subtle">Clear</button></div>
            </div>
            <div class="filterbar">
              <input id="groupCandidateFilter" placeholder="Search derived nodes">
              <select id="groupCandidateMode"><option value="all">All derived</option><option value="selected">Selected only</option></select>
            </div>
            <div id="groupCandidateList" class="derived-grid"></div>
          </div>
        </div>
        <div class="stack">
          <div class="section">
            <h2>Preview</h2>
            <div class="formgrid">
              <label>Format<select id="previewFormat"><option value="v2ray">V2Ray</option><option value="passwall2">PassWall2</option><option value="sing-box">sing-box</option></select></label>
              <label>Group Filter<select id="previewGroup"><option value="">All generated nodes</option></select></label>
              <label>Endpoint Mode<select id="previewEndpointMode"><option value="selected">Node Selections</option><option value="ip">IP Only</option><option value="domain">Domain Only</option><option value="all">All Visible</option><option value="none">No Preferred Endpoint</option></select></label>
              <div class="actions"><button id="runPreview" class="primary">Preview</button></div>
            </div>
            <pre id="previewOutput" class="mono"></pre>
          </div>
          <div class="section">
            <h2>Saved Groups</h2>
            <div class="filterbar">
              <input id="savedGroupFilter" placeholder="Search groups or members">
              <select id="savedGroupMode"><option value="all">All groups</option><option value="nonempty">With members</option></select>
            </div>
            <div class="saved-groups-scroll"><table><thead><tr><th>Name</th><th>Members</th><th>Sample</th><th>Actions</th></tr></thead><tbody id="groupsBody"></tbody></table></div>
          </div>
        </div>
      </div>
    </section>
  </main>

  <script>
    const BASE_URL = ${JSON.stringify(baseUrl)};
    const state = { overview: null, tunnels: [], snis: [], nodes: [], endpoints: [], groups: [], generatedNodes: [], importSources: [], importCandidates: [], agents: [] };
    let editingNodeId = null;
    let editingEndpointId = null;
    let editingEndpointOriginalRole = null;
    let endpointNodeSelectionTouched = false;
    let editingGroupId = null;
    let editingSniId = null;
    let editingImportSourceId = null;
    let activeImportSourceId = null;
    const selectedDerivedIdSet = new Set();

    const byId = (id) => document.getElementById(id);
    const tokenInput = byId('tokenInput');
    const notice = byId('notice');
    const noticeText = byId('noticeText');
    const metricAgents = byId('metricAgents');
    const metricHealthy = byId('metricHealthy');
    const metricUnhealthy = byId('metricUnhealthy');
    const metricCommands = byId('metricCommands');
    const eventsBody = byId('eventsBody');
    const agentsBody = byId('agentsBody');
    const tunnelsBody = byId('tunnelsBody');
    const snisBody = byId('snisBody');
    const nodesBody = byId('nodesBody');
    const endpointsBody = byId('endpointsBody');
    const importSourcesBody = byId('importSourcesBody');
    const groupsBody = byId('groupsBody');
    const subscriptionLinks = byId('subscriptionLinks');
    const previewOutput = byId('previewOutput');

    tokenInput.value = localStorage.getItem('adminToken') || '';

    function hasToken() { return Boolean((localStorage.getItem('adminToken') || '').trim()); }
    function authHeaders() { return { Authorization: 'Bearer ' + (localStorage.getItem('adminToken') || ''), 'Content-Type': 'application/json' }; }
    function setNotice(message, kind) {
      noticeText.textContent = message;
      notice.className = 'notice' + (kind ? ' ' + kind : '');
      notice.classList.add('show');
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
    function selectedValues(el) { return Array.from(el.selectedOptions).map((o) => o.value).filter(Boolean); }
    function unique(values) { return Array.from(new Set(values.filter(Boolean))); }
    function statusPill(value) {
      const clean = String(value || 'unknown');
      return '<span class="status ' + esc(clean) + '">' + esc(clean) + '</span>';
    }
    function lockedRow(cols) { return '<tr><td colspan="' + cols + '" class="muted">Login required.</td></tr>'; }
    function markSelected(select, values) {
      const set = new Set(values || []);
      Array.from(select.options).forEach((option) => { option.selected = option.disabled || set.has(option.value); });
    }
    function selectedAdditionalEndpointIds() {
      const exclusiveIds = new Set(exclusiveEndpoints().map((endpoint) => endpoint.id));
      return selectedValues(byId('bindingEndpoints'))
        .filter((id) => !id.startsWith('global:') && !exclusiveIds.has(id));
    }
    function selectedEndpointNodeIds() {
      return selectedValues(byId('endpointNodeIds')).filter((id) => state.nodes.some((node) => node.id === id));
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
      agentsBody.innerHTML = lockedRow(6);
      tunnelsBody.innerHTML = lockedRow(6);
      nodesBody.innerHTML = lockedRow(6);
      endpointsBody.innerHTML = lockedRow(7);
      groupsBody.innerHTML = lockedRow(4);
      subscriptionLinks.innerHTML = '<div class="muted small">Login required.</div>';
      previewOutput.textContent = '';
      state.tunnels = [];
      state.snis = [];
      state.nodes = [];
      state.endpoints = [];
      state.importSources = [];
      state.groups = [];
      state.generatedNodes = [];
      state.agents = [];
      renderTunnelOptions();
      renderBindingNodeList();
      renderEndpointOptions();
      renderGeneratedNodeOptions();
      snisBody.innerHTML = lockedRow(4);
      importSourcesBody.innerHTML = lockedRow(5);
    }
    function activate(tab) {
      document.querySelectorAll('.view').forEach((el) => el.classList.toggle('hidden', el.id !== tab));
      document.querySelectorAll('#tabs button').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
    }

    byId('tabs').addEventListener('click', (e) => {
      if (e.target.dataset && e.target.dataset.tab) activate(e.target.dataset.tab);
    });

    async function refreshPublicOverview() {
      const data = await publicApi('/api/public/overview');
      applyMetrics(data);
      return data;
    }
    async function refreshAgents() {
      const data = await api('/api/admin/agents');
      state.agents = data.agents || [];
      agentsBody.innerHTML = state.agents.map((row) => {
        const isOffline = row.status !== 'online';
        return '<tr><td class="mono">' + esc(row.id) + '</td><td>' + esc(row.hostname || '-') + '</td><td>' + esc(row.swarm_node_name || '-') + '</td><td>' + statusPill(row.status) + '</td><td>' + esc(row.last_seen_at || '-') + '</td><td class="row-actions">' + (isOffline ? '<button data-delete-agent="' + esc(row.id) + '" class="danger">Remove</button>' : '') + '</td></tr>';
      }).join('') || '<tr><td colspan="6" class="muted">No agents.</td></tr>';
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
      tunnelsBody.innerHTML = state.tunnels.map((row) => {
        const displayLabel = row.remark || row.traffic_label || ((row.swarm_node_name || row.agent_id) + ' -> ' + (row.target_url || '-'));
        return '<tr><td>' + esc(row.type) + '</td><td>' + statusPill(row.health_status) + '</td><td>' + esc(displayLabel) + '</td><td class="mono">' + esc(row.public_hostname) + '</td><td>' + esc(row.last_seen_at) + '</td><td class="row-actions"><button data-copy="' + esc(row.public_hostname || '') + '">Copy</button><button data-edit-tunnel-remark="' + esc(row.id) + '">Remark</button>' + (row.type === 'quick' ? '<button data-restart="' + esc(row.id) + '">Restart</button>' : '') + '</td></tr>';
      }).join('') || '<tr><td colspan="6" class="muted">No tunnels.</td></tr>';
    }
    async function refreshSnis() {
      const data = await api('/api/admin/custom-snis');
      state.snis = data.customSnis || [];
      renderTunnelOptions();
      snisBody.innerHTML = state.snis.map((row) =>
        '<tr><td>' + esc(row.name) + '<br><span class="muted">' + esc(row.remark || '') + '</span></td><td class="mono">' + esc(row.hostname) + '</td><td>' + statusPill(row.enabled ? 'enabled' : 'disabled') + '</td><td class="row-actions"><button data-edit-sni="' + esc(row.id) + '">Edit</button><button data-delete-sni="' + esc(row.id) + '" class="danger">Delete</button></td></tr>'
      ).join('') || '<tr><td colspan="4" class="muted">No custom SNI.</td></tr>';
    }
    async function refreshNodes() {
      const data = await api('/api/admin/proxy-nodes');
      state.nodes = data.proxyNodes || [];
      renderBindingNodeList();
      renderEndpointNodeOptions();
      syncBindingEditorFromSelection();
      nodesBody.innerHTML = state.nodes.map((row) => {
        const trafficIds = trafficIdsForNode(row);
        const path = trafficIds.length ? (trafficIds.length + ' Tunnel / SNI') : 'Direct';
        const endpointText = globalEndpointsForNode(row).length + ' global + ' + ((row.selectedEndpointIds || []).length) + ' additional';
        return '<tr data-select-node="' + esc(row.id) + '"><td>' + esc(row.name) + '<br><span class="muted">' + esc(row.remark || '') + '</span></td><td>' + esc(row.protocol) + '</td><td class="mono">' + esc(path) + '</td><td>' + esc(endpointText) + '</td><td>' + statusPill(row.enabled ? 'enabled' : 'disabled') + '</td><td class="row-actions"><button data-edit-node="' + esc(row.id) + '">Edit</button><button data-bind-node="' + esc(row.id) + '">Bind</button><button data-delete-node="' + esc(row.id) + '" class="danger">Delete</button></td></tr>';
      }).join('') || '<tr><td colspan="6" class="muted">No proxy nodes.</td></tr>';
    }
    async function refreshEndpoints() {
      const data = await api('/api/admin/preferred-endpoints');
      state.endpoints = data.preferredEndpoints || [];
      renderEndpointOptions();
      renderEndpointNodeOptions();
      endpointsBody.innerHTML = sortedEndpointsForList().map((row) =>
        '<tr><td>' + esc(endpointTypeLabel(row)) + '</td><td class="mono">' + endpointValueCell(row) + '</td><td>' + esc(endpointResolveLabel(row)) + '</td><td>' + esc(endpointRoleLabel(row)) + '</td><td>' + esc(endpointUsageLabel(row)) + '</td><td>' + statusPill(row.enabled ? 'enabled' : 'disabled') + '</td><td class="row-actions"><button data-edit-endpoint="' + esc(row.id) + '">Edit</button><button data-delete-endpoint="' + esc(row.id) + '" class="danger">Delete</button></td></tr>'
      ).join('') || '<tr><td colspan="7" class="muted">No preferred endpoints.</td></tr>';
    }
    async function refreshGeneratedNodes() {
      const data = await api('/api/admin/subscriptions/generated-nodes?format=v2ray&endpointMode=selected');
      state.generatedNodes = (data.generatedNodes || []).filter((item) => !item.skipped);
      pruneSelectedDerivedIds();
      renderGeneratedNodeOptions();
    }
    async function refreshGroups() {
      const data = await api('/api/admin/groups');
      state.groups = data.groups || [];
      renderGroupOptions();
      renderSavedGroups();
      renderSubscriptionLinks();
    }
    async function refreshImportSources() {
      const data = await api('/api/admin/import-sources');
      state.importSources = data.importSources || [];
      importSourcesBody.innerHTML = state.importSources.map((row) => {
        const rules = row.rules || {};
        const exclude = (rules.excludeKeywords || []).join(', ');
        const include = (rules.includeKeywords || []).join(', ');
        const removed = (rules.removedKeys || []).length || 0;
        const parentCount = Object.keys(rules.parentKeysByKey || {}).length;
        const source = row.source_kind === 'url' ? row.url : 'pasted content';
        const ruleText = [include ? 'include: ' + include : '', exclude ? 'exclude: ' + exclude : '', removed ? removed + ' unused' : '', parentCount ? parentCount + ' fallback links' : ''].filter(Boolean).join(' / ') || '-';
        return '<tr><td>' + esc(row.name) + '<br>' + statusPill(row.enabled ? 'enabled' : 'disabled') + '</td><td class="mono">' + esc(source || '') + '</td><td>' + esc(ruleText) + '</td><td>' + esc(row.last_imported_at || row.last_error || '-') + '</td><td class="row-actions"><button data-edit-import-source="' + esc(row.id) + '">Edit</button><button data-preview-import-source="' + esc(row.id) + '">Preview</button><button data-refresh-import-source="' + esc(row.id) + '">Refresh</button><button data-delete-import-source="' + esc(row.id) + '" class="danger">Delete</button></td></tr>';
      }).join('') || '<tr><td colspan="5" class="muted">No import sources.</td></tr>';
    }

    function globalEndpoints() { return state.endpoints.filter((e) => e.enabled && e.scope === 'global'); }
    function globalEndpointsForNode(node) {
      return globalEndpoints().filter((e) => !(e.excludedProxyNodeIds || []).includes(node.id));
    }
    function globalEndpointsForBinding() {
      const nodes = selectedBindingNodes();
      if (nodes.length === 0) return globalEndpoints();
      return globalEndpoints().filter((e) => nodes.every((node) => !(e.excludedProxyNodeIds || []).includes(node.id)));
    }
    function exclusiveEndpoints() { return state.endpoints.filter((e) => e.enabled && e.scope !== 'global' && e.selection_mode === 'exclusive'); }
    function bindingEndpoints() { return state.endpoints.filter((e) => e.enabled && e.scope !== 'global' && e.selection_mode !== 'exclusive'); }
    function renderTunnelOptions() {
      const selected = new Set(selectedValues(byId('bindingTraffic')));
      const query = filterText('bindingTrafficFilter');
      const tunnelOptions = state.tunnels.filter((t) =>
        t.health_status === 'healthy' && t.traffic_key && t.public_hostname && t.target_url
      ).map((t) => {
        const value = 'traffic:' + t.traffic_key;
        const label = 'Tunnel: ' + (t.traffic_label || ((t.swarm_node_name || 'unknown-node') + ' -> ' + (t.target_url || 'unknown-target')));
        if (query && !selected.has(value) && !label.toLowerCase().includes(query)) return '';
        return '<option value="' + esc(value) + '">' + esc(label) + '</option>';
      }).join('');
      const sniOptions = state.snis.filter((s) => s.enabled).map((s) => {
        const value = 'sni:' + s.id;
        const display = s.remark || s.name || s.hostname;
        const label = 'SNI: ' + display;
        if (query && !selected.has(value) && !label.toLowerCase().includes(query)) return '';
        return '<option value="' + esc(value) + '">' + esc(label) + '</option>';
      }).join('');
      const options = tunnelOptions + sniOptions;
      byId('bindingTraffic').innerHTML = options;
      markSelected(byId('bindingTraffic'), Array.from(selected));
    }
    function syncBindingEditorFromSelection() {
      const ids = selectedBindingNodeIds();
      if (ids.length !== 1) return;
      const row = state.nodes.find((item) => item.id === ids[0]);
      if (!row) return;
      renderTunnelOptions();
      renderEndpointOptions();
      markSelected(byId('bindingTraffic'), trafficIdsForNode(row));
      markSelected(byId('bindingEndpoints'), row.selectedEndpointIds || []);
    }
    function trafficIdsForNode(node) {
      return node.selectedTrafficIds || [
        ...(node.selectedTrafficKeys || []).map((id) => 'traffic:' + id),
        ...(node.selectedSniIds || []).map((id) => 'sni:' + id)
      ];
    }
    function exclusiveEndpointsForNode(node) {
      const selected = new Set(node.selectedEndpointIds || []);
      return exclusiveEndpoints().filter((endpoint) =>
        selected.has(endpoint.id) || (endpoint.proxyNodeIds || []).includes(node.id)
      );
    }
    function hasExclusiveEndpoint(node) {
      return exclusiveEndpointsForNode(node).length > 0;
    }
    function selectedBindingNodes() {
      const ids = new Set(selectedBindingNodeIds());
      return state.nodes.filter((node) => ids.has(node.id));
    }
    function endpointEditableNodeIds(ids) {
      const idSet = new Set(ids || []);
      return state.nodes
        .filter((node) => idSet.has(node.id) && !hasExclusiveEndpoint(node))
        .map((node) => node.id);
    }
    function renderBindingNodeList() {
      const selected = new Set(selectedBindingNodeIds().filter((id) => state.nodes.some((node) => node.id === id)));
      byId('bindingNodes').innerHTML = state.nodes.map((n) => {
        const trafficIds = trafficIdsForNode(n);
        const traffic = trafficIds.length ? trafficIds.length + ' traffic' : 'direct';
        return '<option value="' + esc(n.id) + '">' + esc(n.name + ' / ' + n.protocol + ' / ' + traffic) + '</option>';
      }).join('');
      markSelected(byId('bindingNodes'), Array.from(selected));
      const visible = visibleBindingNodes();
      byId('bindingVisibleCount').textContent = String(visible.length);
      byId('bindingNodeList').innerHTML = visible.map((n) => bindingNodeRowHtml(n, selected.has(n.id))).join('') || '<div class="muted small">No matching nodes.</div>';
      updateBindingSelectedCount();
    }
    function bindingNodeRowHtml(node, selected) {
      const trafficIds = trafficIdsForNode(node);
      const traffic = trafficIds.length ? trafficIds.length + ' traffic' : 'direct';
      const endpoints = globalEndpointsForNode(node).length + '+' + ((node.selectedEndpointIds || []).length);
      return '<label class="binding-row' + (selected ? ' selected' : '') + '">' +
        '<input type="checkbox" data-binding-node-id="' + esc(node.id) + '"' + (selected ? ' checked' : '') + '>' +
        '<span class="binding-row-main"><strong>' + esc(node.name) + '</strong><span>' + esc(node.remark || node.protocol || '') + '</span></span>' +
        '<span class="binding-row-badges"><span class="mini-badge' + (node.enabled ? ' active' : '') + '">' + esc(node.enabled ? 'enabled' : 'disabled') + '</span><span class="mini-badge">' + esc(traffic) + '</span><span class="mini-badge">' + esc(endpoints) + '</span></span>' +
      '</label>';
    }
    function visibleBindingNodes() {
      const query = filterText('bindingNodeFilter');
      const mode = byId('bindingNodeStatus').value;
      return state.nodes.filter((node) => {
        const trafficIds = trafficIdsForNode(node);
        if (mode === 'enabled' && !node.enabled) return false;
        if (mode === 'direct' && trafficIds.length > 0) return false;
        if (mode === 'traffic' && trafficIds.length === 0) return false;
        if (!query) return true;
        return [node.name, node.remark, node.protocol].filter(Boolean).join(' ').toLowerCase().includes(query);
      });
    }
    function renderEndpointOptions() {
      const selected = new Set(selectedAdditionalEndpointIds());
      const query = filterText('bindingEndpointFilter');
      const selectedNodes = selectedBindingNodes();
      const singleExclusive = selectedNodes.length === 1 ? exclusiveEndpointsForNode(selectedNodes[0]) : [];
      if (singleExclusive.length > 0) {
        byId('bindingEndpointFilter').disabled = true;
        byId('bindingEndpointFilter').value = '';
        byId('bindingEndpoints').innerHTML = singleExclusive.map((e) =>
          '<option value="' + esc(e.id) + '" disabled selected>' + esc('Exclusive: ' + (e.label || e.value) + ' / ' + endpointTypeLabel(e)) + '</option>'
        ).join('');
        return;
      }
      byId('bindingEndpointFilter').disabled = false;
      const globals = globalEndpointsForBinding().map((e) =>
        '<option value="global:' + esc(e.id) + '" disabled selected>' + esc('Global: ' + (e.label || e.value) + ' / ' + endpointTypeLabel(e)) + '</option>'
      ).join('');
      const options = bindingEndpoints().map((e) => {
        const label = e.label || e.value;
        if (query && !selected.has(e.id) && !label.toLowerCase().includes(query)) return '';
        return '<option value="' + esc(e.id) + '">' + esc(label) + ' / ' + esc(endpointTypeLabel(e)) + '</option>';
      }).join('');
      byId('bindingEndpoints').innerHTML = globals + options;
      markSelected(byId('bindingEndpoints'), Array.from(selected));
    }
    function renderEndpointNodeOptions() {
      const selected = new Set(selectedEndpointNodeIds());
      byId('endpointNodeIds').innerHTML = state.nodes.map((node) =>
        '<option value="' + esc(node.id) + '">' + esc(node.name + ' / ' + (node.remark || node.protocol || '')) + '</option>'
      ).join('');
      markSelected(byId('endpointNodeIds'), Array.from(selected));
      const visible = visibleEndpointNodes();
      byId('endpointNodeVisibleCount').textContent = String(visible.length);
      byId('endpointNodeList').innerHTML = visible.map((node) => endpointNodeRowHtml(node, selected.has(node.id))).join('') || '<div class="muted small">No matching nodes.</div>';
      updateEndpointNodeSelectedCount();
    }
    function endpointNodeRowHtml(node, selected) {
      const trafficIds = trafficIdsForNode(node);
      const traffic = trafficIds.length ? trafficIds.length + ' traffic' : 'direct';
      return '<label class="binding-row' + (selected ? ' selected' : '') + '">' +
        '<input type="checkbox" data-endpoint-node-id="' + esc(node.id) + '"' + (selected ? ' checked' : '') + '>' +
        '<span class="binding-row-main"><strong>' + esc(node.name) + '</strong><span>' + esc(node.remark || node.protocol || '') + '</span></span>' +
        '<span class="binding-row-badges"><span class="mini-badge' + (node.enabled ? ' active' : '') + '">' + esc(node.enabled ? 'enabled' : 'disabled') + '</span><span class="mini-badge">' + esc(traffic) + '</span></span>' +
      '</label>';
    }
    function visibleEndpointNodes() {
      const query = filterText('endpointNodeFilter');
      const mode = byId('endpointNodeStatus').value;
      return state.nodes.filter((node) => {
        const trafficIds = trafficIdsForNode(node);
        if (mode === 'enabled' && !node.enabled) return false;
        if (mode === 'direct' && trafficIds.length > 0) return false;
        if (mode === 'traffic' && trafficIds.length === 0) return false;
        if (!query) return true;
        return [node.name, node.remark, node.protocol].filter(Boolean).join(' ').toLowerCase().includes(query);
      });
    }
    function markEndpointNodes(values) {
      const set = new Set(values || []);
      markSelected(byId('endpointNodeIds'), Array.from(set));
      document.querySelectorAll('[data-endpoint-node-id]').forEach((input) => {
        input.checked = set.has(input.dataset.endpointNodeId);
        const row = input.closest ? input.closest('.binding-row') : null;
        if (row) row.classList.toggle('selected', input.checked);
      });
      updateEndpointNodeSelectedCount();
    }
    function updateEndpointNodeSelectedCount() {
      byId('endpointNodeSelectedCount').textContent = String(selectedEndpointNodeIds().length);
    }
    function endpointResolveLabel(row) {
      if (row.discovery_mode === 'redirect') return 'Discover Target';
      if (row.type !== 'domain') return '-';
      if (row.resolve_mode === 'ipv4') return 'Resolve IPv4';
      if (row.resolve_mode === 'ipv6') return 'Resolve IPv6';
      return 'Do Not Resolve';
    }
    function endpointTypeValue(row) {
      return row.discovery_mode === 'redirect' ? 'redirect' : (row.type || 'ip');
    }
    function endpointTypeLabel(row) {
      if (row.discovery_mode === 'redirect') return 'Discovery';
      return row.type || 'ip';
    }
    function endpointListLabel(row) {
      return (row.label || row.value || '').trim();
    }
    function sortedEndpointsForList() {
      return [...state.endpoints].sort((a, b) => {
        const order = Number(a.sort_order || 0) - Number(b.sort_order || 0);
        if (order !== 0) return order;
        return endpointListLabel(a).localeCompare(endpointListLabel(b), undefined, { sensitivity: 'base' })
          || String(a.value || '').localeCompare(String(b.value || ''), undefined, { sensitivity: 'base' });
      });
    }
    function endpointValueCell(row) {
      const label = endpointListLabel(row);
      const port = '<br><span class="muted">' + esc(endpointPortLabel(row)) + '</span>';
      if (row.label && row.label !== row.value) {
        return '<strong>' + esc(label) + '</strong><br><span class="muted">' + esc(row.value || '') + '</span>' + port;
      }
      return esc(row.value || '') + port;
    }
    function endpointPortLabel(row) {
      return row.port ? 'Port: ' + row.port : 'Port: keep original';
    }
    function endpointRoleLabel(row) {
      if (row.scope === 'global') return 'Global Always On';
      if (row.selection_mode === 'exclusive') return 'Exclusive Binding Option';
      return 'Binding Option';
    }
    function endpointUsageLabel(row) {
      if (row.scope === 'global') return String((row.excludedProxyNodeIds || []).length) + ' excluded';
      if (row.selection_mode === 'exclusive') return String((row.proxyNodeIds || []).length) + ' exclusive nodes';
      return String((row.selectedProxyNodeIds || []).length) + ' bound nodes';
    }
    function endpointRoleUsesNodes(role) {
      return role === 'exclusive' || role === 'global';
    }
    function syncEndpointTypeControls() {
      const isDomain = byId('endpointType').value === 'domain';
      const isRedirect = byId('endpointType').value === 'redirect';
      byId('endpointResolveMode').disabled = !isDomain;
      if (!isDomain) byId('endpointResolveMode').value = 'none';
      byId('endpointPortLabel').classList.toggle('hidden', isRedirect);
      byId('endpointPort').disabled = isRedirect;
      if (isRedirect) byId('endpointPort').value = '';
      else if (!byId('endpointPort').value && !editingEndpointId) byId('endpointPort').value = '443';
    }
    function syncEndpointNodeControl() {
      const role = byId('endpointRole').value;
      const usesNodes = endpointRoleUsesNodes(role);
      byId('endpointNodePickerTitle').textContent = role === 'global' ? 'Excluded Nodes' : 'Exclusive Nodes';
      byId('endpointNodePicker').classList.toggle('hidden', !usesNodes);
      byId('endpointNodeIds').disabled = !usesNodes;
      if (usesNodes) renderEndpointNodeOptions();
      else markEndpointNodes([]);
    }
    function filterText(id) {
      const el = byId(id);
      return el ? el.value.trim().toLowerCase() : '';
    }
    function renderGeneratedNodeOptions() {
      const selected = new Set(selectedDerivedIds());
      const bySource = new Map();
      for (const item of filteredGeneratedNodes(selected)) {
        const rows = bySource.get(item.sourceName) || [];
        rows.push(item);
        bySource.set(item.sourceName, rows);
      }
      const html = Array.from(bySource.entries()).map(([sourceName, items]) => {
        const chips = items.map((item, index) => derivedChipHtml(item, selected.has(item.id), index + 1)).join('');
        const meta = items.length + ' derived';
        return '<div class="chip-row"><div class="chip-row-title"><strong>' + esc(sourceName) + '</strong><span>' + esc(meta) + '</span></div><div class="chip-options">' + chips + '</div></div>';
      }).join('');
      byId('groupCandidateList').innerHTML = html || '<div class="muted small">No generated nodes. Add nodes and endpoints first.</div>';
      updateGroupSelectedCount();
    }
    function filteredGeneratedNodes(selectedSet) {
      const selected = selectedSet || new Set(selectedDerivedIds());
      const query = filterText('groupCandidateFilter');
      const mode = byId('groupCandidateMode').value;
      return state.generatedNodes.filter((item) => {
        const label = derivedFullLabel(item).toLowerCase();
        const haystack = [item.sourceName, label, item.endpointValue, item.trafficLabel, item.tunnelHost, item.protocol].filter(Boolean).join(' ').toLowerCase();
        if (mode === 'selected' && !selected.has(item.id)) return false;
        if (query && !haystack.includes(query)) return false;
        return true;
      });
    }
    function renderSavedGroups() {
      const query = filterText('savedGroupFilter');
      const mode = byId('savedGroupMode').value;
      const rows = state.groups.filter((row) => {
        const ids = groupDisplayIds(row);
        if (mode === 'nonempty' && ids.length === 0) return false;
        if (!query) return true;
        return [row.name, ...ids.map((id) => generatedLabel(id))].join(' ').toLowerCase().includes(query);
      });
      groupsBody.innerHTML = rows.map((row) => {
        const ids = groupDisplayIds(row);
        return '<tr><td>' + esc(row.name) + '</td><td>' + esc(ids.length) + '</td><td>' + groupChipsHtml(ids) + '</td><td class="row-actions"><button data-edit-group="' + esc(row.id) + '">Edit</button><button data-delete-group="' + esc(row.id) + '" class="danger">Delete</button></td></tr>';
      }).join('') || '<tr><td colspan="4" class="muted">No groups.</td></tr>';
    }
    function renderGroupOptions() {
      const current = byId('previewGroup').value;
      byId('previewGroup').innerHTML = '<option value="">All generated nodes</option>' + state.groups.map((g) => '<option value="' + esc(g.name) + '">' + esc(g.name) + '</option>').join('');
      byId('previewGroup').value = current;
    }
    function renderSubscriptionLinks() {
      const urls = (state.overview && state.overview.subscriptionUrls) || {};
      const rows = [
        ['V2Ray', absoluteSubscriptionUrl(urls.v2ray || '/sub/v2ray/')],
        ['PassWall2', absoluteSubscriptionUrl(urls.passwall2 || '/sub/passwall2/')],
        ['sing-box', absoluteSubscriptionUrl(urls.singBox || '/sub/sing-box/')]
      ];
      const groups = [{ name: 'All', query: '' }, ...state.groups.map((group) => ({ name: group.name, query: '?group=' + encodeURIComponent(group.name) }))];
      subscriptionLinks.innerHTML = rows.map(([formatName, url]) => {
        const chips = groups.map((group) => {
          const fullUrl = url + group.query;
          return '<button type="button" class="select-chip copy-chip" data-copy="' + esc(fullUrl) + '" title="' + esc(fullUrl) + '"><span class="chip-main">' + esc(group.name) + '</span></button>';
        }).join('');
        return '<div class="link-chip-row"><strong>' + esc(formatName) + '</strong><div class="link-chips">' + chips + '</div></div>';
      }).join('');
    }
    function absoluteSubscriptionUrl(url) {
      const base = BASE_URL || location.origin;
      if (url.toLowerCase().startsWith('http://') || url.toLowerCase().startsWith('https://')) return url;
      return base + (url.startsWith('/') ? url : '/' + url);
    }
    function renderImportReview() {
      const review = byId('importReview');
      const active = state.importCandidates.filter((item) => !item.removed);
      const removed = state.importCandidates.filter((item) => item.removed);
      review.classList.toggle('hidden', state.importCandidates.length === 0);
      byId('importActiveCount').textContent = String(active.length);
      byId('importRemovedCount').textContent = String(removed.length);
      byId('importActiveList').innerHTML = orderedImportCandidates(active).map((item) => importRowHtml(item, active)).join('') || '<div class="muted small">No selected nodes.</div>';
      byId('importRemovedList').innerHTML = removed.map((item) => importRemovedRowHtml(item)).join('') || '<div class="muted small">No unused nodes.</div>';
    }
    function orderedImportCandidates(active) {
      const activeIds = new Set(active.map((item) => item.id));
      const childrenByParent = new Map();
      active.forEach((item) => {
        const parents = parentIdsForItem(item).filter((id) => activeIds.has(id));
        if (parents.length > 0) {
          const children = childrenByParent.get(parents[0]) || [];
          children.push(item);
          childrenByParent.set(parents[0], children);
        }
      });
      const output = [];
      active.forEach((item) => {
        if (parentIdsForItem(item).some((id) => activeIds.has(id))) return;
        output.push(item);
        (childrenByParent.get(item.id) || []).forEach((child) => output.push(child));
      });
      return output;
    }
    function importRowHtml(item, active) {
      const carriers = active.filter((candidate) => candidate.asTlsCarrier && candidate.id !== item.id);
      const selectedParents = parentIdsForItem(item).filter((id) => carriers.some((candidate) => candidate.id === id));
      const shownParents = item.asTlsCarrier ? ['__carrier'] : selectedParents.length > 0 ? selectedParents : [''];
      const hasParent = selectedParents.length > 0;
      const tlsControls = shownParents.map((selectedId, index) => {
        const parentOptions = '<option value="">No TLS carrier</option><option value="__carrier"' + (selectedId === '__carrier' ? ' selected' : '') + '>As TLS carrier</option>' + carriers.map((candidate) =>
          '<option value="' + esc(candidate.id) + '"' + (candidate.id === selectedId ? ' selected' : '') + '>' + esc(candidate.name) + '</option>'
        ).join('');
        return '<select data-import-parent="' + esc(item.id) + '" data-import-parent-index="' + String(index) + '">' + parentOptions + '</select>';
      }).join('');
      const canAddTls = !item.asTlsCarrier && carriers.length > selectedParents.length;
      const tlsMeta = compactSni(item.sni);
      const meta = [item.protocol, item.transport, item.server ? item.server + (item.port ? ':' + item.port : '') : null, tlsMeta].filter(Boolean).join(' / ');
      return '<div class="import-row' + (hasParent ? ' child' : '') + '">' +
        '<div class="import-node' + (item.asTlsCarrier ? ' carrier' : '') + '" title="' + esc(item.rawConfig) + '">' +
          '<input class="import-name-input" data-import-display-name="' + esc(item.id) + '" value="' + esc(item.name) + '" aria-label="Display name">' +
          '<span class="meta">' + esc(meta || item.sourceName) + '</span>' +
          (item.asTlsCarrier ? '<span class="dup">TLS carrier</span>' : '') +
          (item.duplicate ? '<span class="dup">will update existing</span>' : '') +
        '</div>' +
        '<div class="tls-controls">' + tlsControls + '</div>' +
        (canAddTls ? '<button data-add-import-tls="' + esc(item.id) + '" class="subtle">+TLS</button>' : '<span></span>') +
        '<button data-remove-import="' + esc(item.id) + '" class="subtle">Remove</button>' +
      '</div>';
    }
    function importRemovedRowHtml(item) {
      const tlsMeta = compactSni(item.sni);
      const meta = [item.protocol, item.server ? item.server + (item.port ? ':' + item.port : '') : null, tlsMeta].filter(Boolean).join(' / ');
      return '<div class="import-row"><div class="import-node removed"><strong>' + esc(item.name) + '</strong><span class="meta">' + esc(meta || item.sourceName) + '</span></div><span></span><button data-restore-import="' + esc(item.id) + '">Restore</button></div>';
    }
    function compactSni(value) {
      if (!value) return null;
      const items = String(value).split(/[,，\\s]+/).map((item) => item.trim()).filter(Boolean);
      if (items.length <= 1) return 'sni ' + String(value);
      return 'sni ' + items[0] + ' +' + (items.length - 1);
    }
    function importKeywords() {
      return byId('importFilterText').value.split(/[\s,，;；]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
    }
    function importSearchText(item) {
      return [item.name, item.protocol, item.server, item.sni, item.transport, item.sourceName].filter(Boolean).join(' ').toLowerCase();
    }
    function activeImportCandidatesForCommit() {
      const activeIds = new Set(state.importCandidates.filter((item) => !item.removed).map((item) => item.id));
      const carrierIds = new Set(state.importCandidates.filter((item) => !item.removed && item.asTlsCarrier).map((item) => item.id));
      return state.importCandidates
        .filter((item) => !item.removed)
        .map((item) => {
          const parentIds = parentIdsForItem(item).filter((id) => activeIds.has(id) && carrierIds.has(id));
          return { ...item, parentIds };
        });
    }
    function parentIdsForItem(item) {
      if (Array.isArray(item.parentIds)) return item.parentIds.filter(Boolean);
      return [];
    }
    function activeImportSource() {
      return activeImportSourceId ? state.importSources.find((source) => source.id === activeImportSourceId) : null;
    }
    function importRulesFromReview(baseRules) {
      const candidateById = new Map(state.importCandidates.map((item) => [item.id, item]));
      const candidateKeys = new Set(state.importCandidates.map((item) => item.importKey).filter(Boolean));
      const currentRules = baseRules || {};
      const parentKeysByKey = {};
      const carrierKeys = [];
      const displayNamesByKey = {};
      const removedKeys = [];

      (currentRules.removedKeys || []).forEach((key) => {
        if (!candidateKeys.has(key)) removedKeys.push(key);
      });
      (currentRules.carrierKeys || []).forEach((key) => {
        if (!candidateKeys.has(key)) carrierKeys.push(key);
      });
      Object.keys(currentRules.parentKeysByKey || {}).forEach((key) => {
        if (!candidateKeys.has(key)) parentKeysByKey[key] = currentRules.parentKeysByKey[key];
      });
      Object.keys(currentRules.displayNamesByKey || {}).forEach((key) => {
        if (!candidateKeys.has(key)) displayNamesByKey[key] = currentRules.displayNamesByKey[key];
      });

      state.importCandidates.forEach((item) => {
        if (!item.importKey) return;
        if ((item.name || '').trim() && (item.name || '').trim() !== (item.originalName || '').trim()) {
          displayNamesByKey[item.importKey] = item.name.trim();
        }
        if (item.removed) removedKeys.push(item.importKey);
        if (!item.removed && item.asTlsCarrier) carrierKeys.push(item.importKey);
        const parentKeys = parentIdsForItem(item)
          .map((id) => candidateById.get(id))
          .filter((parent) => parent && parent.asTlsCarrier && !item.removed && !parent.removed)
          .map((parent) => parent.importKey)
          .filter(Boolean);
        if (parentKeys.length > 0) {
          parentKeysByKey[item.importKey] = Array.from(new Set(parentKeys));
        }
      });
      return {
        excludeKeywords: byId('importExcludeKeywords').value.split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean),
        includeKeywords: byId('importIncludeKeywords').value.split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean),
        removedKeys: unique(removedKeys),
        carrierKeys: unique(carrierKeys),
        parentKeysByKey,
        displayNamesByKey
      };
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
      editingEndpointOriginalRole = null;
      endpointNodeSelectionTouched = false;
      byId('createEndpoint').textContent = 'Add Endpoints';
      byId('endpointType').value = 'ip';
      byId('endpointRole').value = 'global';
      byId('endpointResolveMode').value = 'none';
      byId('endpointEnabled').value = 'true';
      byId('endpointValues').value = '';
      byId('endpointLabel').value = '';
      byId('endpointPort').value = '443';
      byId('endpointSort').value = '0';
      byId('endpointNodeFilter').value = '';
      byId('endpointNodeStatus').value = 'all';
      markEndpointNodes([]);
      syncEndpointTypeControls();
      syncEndpointNodeControl();
    }
    function resetSniForm() {
      editingSniId = null;
      byId('saveSni').textContent = 'Add SNI';
      byId('sniName').value = '';
      byId('sniHostname').value = '';
      byId('sniRemark').value = '';
      byId('sniEnabled').value = 'true';
      byId('sniSort').value = '0';
    }
    function resetImportSourceForm() {
      editingImportSourceId = null;
      activeImportSourceId = null;
      byId('saveImportSource').textContent = 'Save Source';
      byId('importSourceName').value = '';
      byId('importSourceKind').value = 'url';
      byId('importSourceUrl').value = '';
      byId('importSourceContent').value = '';
      byId('importPrefix').value = '';
      byId('importSourceEnabled').value = 'true';
      byId('importExcludeKeywords').value = '';
      byId('importIncludeKeywords').value = '';
    }
    function resetGroupForm() {
      editingGroupId = null;
      byId('createGroup').textContent = 'Save Group';
      byId('groupName').value = '';
      markDerivedCandidates([]);
    }
    function selectedBindingNodeIds() {
      return selectedValues(byId('bindingNodes'));
    }
    function markBindingNodes(values) {
      const set = new Set(values || []);
      markSelected(byId('bindingNodes'), Array.from(set));
      document.querySelectorAll('[data-binding-node-id]').forEach((input) => {
        input.checked = set.has(input.dataset.bindingNodeId);
        const row = input.closest ? input.closest('.binding-row') : null;
        if (row) row.classList.toggle('selected', input.checked);
      });
      updateBindingSelectedCount();
      renderEndpointOptions();
    }
    function updateBindingSelectedCount() { byId('bindingSelectedCount').textContent = String(selectedBindingNodeIds().length); }
    function selectedDerivedIds() {
      return Array.from(selectedDerivedIdSet);
    }
    function markDerivedCandidates(values) {
      selectedDerivedIdSet.clear();
      for (const value of values || []) {
        if (value) selectedDerivedIdSet.add(value);
      }
      syncDerivedCandidateChips();
      updateGroupSelectedCount();
    }
    function toggleDerivedCandidate(id) {
      if (!id) return;
      if (selectedDerivedIdSet.has(id)) selectedDerivedIdSet.delete(id);
      else selectedDerivedIdSet.add(id);
      syncDerivedCandidateChips();
      updateGroupSelectedCount();
    }
    function syncDerivedCandidateChips() {
      document.querySelectorAll('[data-derived-id]').forEach((button) => {
        button.classList.toggle('selected', selectedDerivedIdSet.has(button.dataset.derivedId));
      });
    }
    function pruneSelectedDerivedIds() {
      const current = new Set(state.generatedNodes.map((item) => item.id));
      for (const id of Array.from(selectedDerivedIdSet)) {
        if (!current.has(id)) selectedDerivedIdSet.delete(id);
      }
    }
    function updateGroupSelectedCount() { byId('groupSelectedCount').textContent = String(selectedDerivedIds().length); }
    function loadBindingFromNode(row) {
      byId('bindingNodeFilter').value = '';
      byId('bindingNodeStatus').value = 'all';
      byId('bindingTrafficFilter').value = '';
      byId('bindingEndpointFilter').value = '';
      renderBindingNodeList();
      renderTunnelOptions();
      renderEndpointOptions();
      markBindingNodes([row.id]);
      const traffic = trafficIdsForNode(row);
      markSelected(byId('bindingTraffic'), traffic);
      markSelected(byId('bindingEndpoints'), row.selectedEndpointIds || []);
    }
    function loadNodeForEditing(row) {
      editingNodeId = row.id;
      byId('saveNodeSource').textContent = 'Save Source';
      byId('sourceName').value = row.name || '';
      byId('sourceRemark').value = row.remark || '';
      byId('sourceRaw').value = row.raw_config || '';
      byId('sourceEnabled').value = row.enabled ? 'true' : 'false';
      loadBindingFromNode(row);
    }
    function generatedLabel(id) {
      const item = state.generatedNodes.find((node) => node.id === id);
      if (!item) return id;
      return item.sourceName + ' / ' + derivedFullLabel(item);
    }
    function groupDisplayIds(row) {
      return (row.effectiveDerivedNodeIds && row.effectiveDerivedNodeIds.length > 0)
        ? row.effectiveDerivedNodeIds
        : (row.derivedNodeIds || []);
    }
    function derivedFullLabel(item) {
      const parts = derivedParts(item).map((part) => part.label);
      if (parts.length === 0) parts.push('Direct');
      return parts.join(' / ');
    }
    function derivedShortLabel(item) {
      return derivedFullLabel(item);
    }
    function derivedParts(item) {
      const parts = [];
      if (item.tunnelHost || item.sniId) {
        const label = item.trafficLabel || item.tunnelHost || item.sniId;
        parts.push({ label: label, value: label });
      } else {
        parts.push({ label: 'Direct', value: 'Direct' });
      }
      if (item.endpointId || item.endpointValue) {
        const endpoint = state.endpoints.find((row) => row.id === item.endpointId);
        const label = endpoint ? (endpoint.label || endpoint.value) : (item.endpointLabel || item.endpointValue || item.endpointId);
        parts.push({ label, value: label });
      }
      return parts;
    }
    function endpointLabel(id) {
      const endpoint = state.endpoints.find((item) => item.id === id);
      return endpoint ? (endpoint.label || endpoint.value) : null;
    }
    function derivedChipHtml(item, selected, index) {
      const title = derivedFullLabel(item);
      const parts = derivedParts(item);
      const main = parts.length > 0 ? parts.map((part) => part.label).join(' | ') : 'Direct';
      return '<button type="button" class="select-chip' + (selected ? ' selected' : '') + '" data-derived-id="' + esc(item.id) + '" title="' + esc(generatedLabel(item.id)) + '"><span class="chip-main">' + esc(main) + '</span></button>';
    }
    function groupChipsHtml(ids) {
      if (!ids || ids.length === 0) return '<span class="muted small">-</span>';
      const grouped = [];
      for (const id of ids) {
        const item = state.generatedNodes.find((node) => node.id === id);
        if (!item) {
          grouped.push({ id, name: id, title: id, tags: [{ label: id, value: id }] });
          continue;
        }
        let group = grouped.find((row) => row.name === item.sourceName);
        if (!group) {
          group = { id: item.sourceNodeId || item.sourceName, name: item.sourceName, title: item.sourceName, tags: [] };
          grouped.push(group);
        }
        const tag = { label: derivedFullLabel(item), value: generatedLabel(item.id) };
        if (!group.tags.some((existing) => existing.label === tag.label && existing.value === tag.value)) group.tags.push(tag);
      }
      return '<div class="group-chip-row">' + grouped.map((group) => {
        const tagHtml = group.tags.map((part) =>
          '<span class="group-chip" title="' + esc(part.value || part.label) + '"><span>' + esc(part.label) + '</span></span>'
        ).join('');
        return '<span class="group-member" title="' + esc(group.title) + '"><span class="group-member-name">' + esc(group.name) + '</span><span class="group-member-tags">' + tagHtml + '</span></span>';
      }).join('') + '</div>';
    }

    document.body.addEventListener('change', (e) => {
      const t = e.target;
      if (t && t.id === 'bindingNodes') updateBindingSelectedCount();
      if (t && t.dataset && t.dataset.bindingNodeId) {
        const selected = new Set(selectedBindingNodeIds());
        if (t.checked) selected.add(t.dataset.bindingNodeId);
        else selected.delete(t.dataset.bindingNodeId);
        markBindingNodes(Array.from(selected));
      }
      if (t && t.dataset && t.dataset.endpointNodeId) {
        endpointNodeSelectionTouched = true;
        const selected = new Set(selectedEndpointNodeIds());
        if (t.checked) selected.add(t.dataset.endpointNodeId);
        else selected.delete(t.dataset.endpointNodeId);
        markEndpointNodes(Array.from(selected));
      }
      if (t && t.dataset && t.dataset.importParent) {
        const item = state.importCandidates.find((candidate) => candidate.id === t.dataset.importParent);
        if (item) {
          const index = Number(t.dataset.importParentIndex || 0);
          if (t.value === '__carrier') {
            item.asTlsCarrier = true;
            item.parentIds = [];
            renderImportReview();
            return;
          }
          item.asTlsCarrier = false;
          const parentIds = parentIdsForItem(item);
          if (t.value) parentIds[index] = t.value;
          else parentIds.splice(index, 1);
          item.parentIds = Array.from(new Set(parentIds.filter(Boolean)));
          renderImportReview();
        }
      }
    });

    document.body.addEventListener('input', (e) => {
      const t = e.target;
      if (t && t.dataset && t.dataset.importDisplayName) {
        const item = state.importCandidates.find((candidate) => candidate.id === t.dataset.importDisplayName);
        if (item) item.name = t.value.trim() || item.originalName || item.name;
      }
    });

    document.body.addEventListener('click', async (e) => {
      const t = e.target;
      if (!t || !t.dataset) return;
      try {
        const selectableRow = t.closest ? t.closest('[data-select-node]') : null;
        if (selectableRow && !(t.closest && t.closest('button'))) {
          const row = state.nodes.find((item) => item.id === selectableRow.dataset.selectNode);
          if (row) loadNodeForEditing(row);
          return;
        }
        if (t.dataset.copy) {
          await navigator.clipboard.writeText(t.dataset.copy);
          setNotice('Copied.', 'ok');
        }
        if (t.dataset.editTunnelRemark) {
          const id = t.dataset.editTunnelRemark;
          const tunnel = state.tunnels.find((row) => row.id === id);
          if (tunnel) {
            const current = tunnel.remark || tunnel.traffic_label || '';
            const newRemark = prompt('Enter a display remark for this tunnel (leave empty to use default association label):', current);
            if (newRemark !== null) {
              await api('/api/admin/tunnels/' + esc(id), {
                method: 'PATCH',
                body: JSON.stringify({ remark: newRemark.trim() || null })
              });
              setNotice('Tunnel remark updated.', 'ok');
              await refreshTunnels();
            }
          }
        }
        if (t.dataset.deleteAgent) {
          const id = t.dataset.deleteAgent;
          if (confirm('Remove this offline agent? Any remaining tunnels will also be deleted.')) {
            await api('/api/admin/agents/' + esc(id), { method: 'DELETE' });
            setNotice('Agent removed.', 'ok');
            await refreshAgents();
            await refreshDashboard();
          }
        }
        if (t.dataset.derivedId) {
          toggleDerivedCandidate(t.dataset.derivedId);
        }
        if (t.dataset.nodePanel) {
          document.querySelectorAll('.node-panel').forEach((el) => el.classList.toggle('hidden', el.id !== t.dataset.nodePanel));
          document.querySelectorAll('[data-node-panel]').forEach((el) => el.classList.toggle('active', el.dataset.nodePanel === t.dataset.nodePanel));
        }
        if (t.dataset.removeImport) {
          const item = state.importCandidates.find((candidate) => candidate.id === t.dataset.removeImport);
          if (item) {
            item.removed = true;
            state.importCandidates.forEach((candidate) => {
              if (Array.isArray(candidate.parentIds)) {
                candidate.parentIds = candidate.parentIds.filter((id) => id !== item.id);
              }
            });
            renderImportReview();
          }
        }
        if (t.dataset.addImportTls) {
          const item = state.importCandidates.find((candidate) => candidate.id === t.dataset.addImportTls);
          if (item) {
            const active = state.importCandidates.filter((candidate) => !candidate.removed);
            const carriers = active.filter((candidate) => candidate.asTlsCarrier && candidate.id !== item.id);
            const current = new Set(parentIdsForItem(item));
            const next = carriers.find((candidate) => !current.has(candidate.id));
            if (next) {
              item.parentIds = [...current, next.id];
              renderImportReview();
            }
          }
        }
        if (t.dataset.restoreImport) {
          const item = state.importCandidates.find((candidate) => candidate.id === t.dataset.restoreImport);
          if (item) {
            item.removed = false;
            renderImportReview();
          }
        }
        if (t.dataset.restart) {
          await api('/api/admin/tunnels/' + t.dataset.restart + '/restart', { method: 'POST', body: '{}' });
          setNotice('Restart command queued.', 'ok');
          await refreshTunnels();
        }
        if (t.dataset.editSni) {
          const row = state.snis.find((item) => item.id === t.dataset.editSni);
          if (row) {
            editingSniId = row.id;
            byId('saveSni').textContent = 'Save SNI';
            byId('sniName').value = row.name || '';
            byId('sniHostname').value = row.hostname || '';
            byId('sniRemark').value = row.remark || '';
            byId('sniEnabled').value = row.enabled ? 'true' : 'false';
            byId('sniSort').value = String(row.sort_order || 0);
          }
        }
        if (t.dataset.deleteSni) {
          await api('/api/admin/custom-snis/' + t.dataset.deleteSni, { method: 'DELETE' });
          setNotice('SNI deleted.', 'ok');
          await refreshSnis();
          await refreshGeneratedNodes();
          await refreshGroups();
        }
        if (t.dataset.editImportSource) {
          const row = state.importSources.find((item) => item.id === t.dataset.editImportSource);
          if (row) {
            editingImportSourceId = row.id;
            activeImportSourceId = row.id;
            const rules = row.rules || {};
            byId('saveImportSource').textContent = 'Update Source';
            byId('importSourceName').value = row.name || '';
            byId('importSourceKind').value = row.source_kind || 'url';
            byId('importSourceUrl').value = row.url || '';
            byId('importSourceContent').value = row.content || '';
            byId('importPrefix').value = row.name_prefix || '';
            byId('importSourceEnabled').value = row.enabled ? 'true' : 'false';
            byId('importExcludeKeywords').value = (rules.excludeKeywords || []).join(', ');
            byId('importIncludeKeywords').value = (rules.includeKeywords || []).join(', ');
          }
        }
        if (t.dataset.previewImportSource) {
          activeImportSourceId = t.dataset.previewImportSource;
          const data = await api('/api/admin/import-sources/' + activeImportSourceId + '/preview');
          state.importCandidates = data.candidates || [];
          renderImportReview();
          setNotice('Source preview loaded ' + state.importCandidates.length + ' candidate node(s).', state.importCandidates.length ? 'ok' : 'warn');
        }
        if (t.dataset.refreshImportSource) {
          const data = await api('/api/admin/import-sources/' + t.dataset.refreshImportSource + '/refresh', { method: 'POST', body: '{}' });
          setNotice('Source refreshed: imported ' + data.imported + ', updated ' + data.updated + ', skipped ' + data.skipped + '.', data.imported || data.updated ? 'ok' : 'warn');
          await refreshImportSources();
          await refreshNodes();
          await refreshGeneratedNodes();
          await refreshGroups();
        }
        if (t.dataset.deleteImportSource) {
          await api('/api/admin/import-sources/' + t.dataset.deleteImportSource, { method: 'DELETE' });
          setNotice('Import source deleted.', 'ok');
          await refreshImportSources();
        }
        if (t.dataset.editNode) {
          const row = state.nodes.find((item) => item.id === t.dataset.editNode);
          if (row) loadNodeForEditing(row);
        }
        if (t.dataset.bindNode) {
          const row = state.nodes.find((item) => item.id === t.dataset.bindNode);
          if (row) loadBindingFromNode(row);
        }
        if (t.dataset.deleteNode) {
          await api('/api/admin/proxy-nodes/' + t.dataset.deleteNode, { method: 'DELETE' });
          setNotice('Node deleted.', 'ok');
          await refreshNodes();
          await refreshGeneratedNodes();
          await refreshGroups();
        }
        if (t.dataset.editEndpoint) {
          const row = state.endpoints.find((item) => item.id === t.dataset.editEndpoint);
          if (row) {
            editingEndpointId = row.id;
            editingEndpointOriginalRole = row.scope === 'node' && row.selection_mode === 'exclusive' ? 'exclusive' : (row.scope || 'global');
            const linkedNodeIds = row.selection_mode === 'exclusive' ? (row.proxyNodeIds || []) : (row.scope === 'global' ? (row.excludedProxyNodeIds || []) : []);
            if (endpointRoleUsesNodes(editingEndpointOriginalRole) && state.nodes.length === 0) {
              await refreshNodes();
            }
            if (linkedNodeIds.length > 0 && state.nodes.length === 0) {
              setNotice('Nodes failed to load, so endpoint node links cannot be edited safely.', 'error');
              return;
            }
            endpointNodeSelectionTouched = false;
            byId('createEndpoint').textContent = 'Save Endpoint';
            byId('endpointType').value = endpointTypeValue(row);
            byId('endpointRole').value = editingEndpointOriginalRole;
            byId('endpointResolveMode').value = row.resolve_mode || 'none';
            byId('endpointEnabled').value = row.enabled ? 'true' : 'false';
            byId('endpointValues').value = row.value || '';
            byId('endpointLabel').value = row.label || '';
            byId('endpointPort').value = row.port == null ? '' : String(row.port);
            byId('endpointSort').value = String(row.sort_order || 0);
            renderEndpointNodeOptions();
            markEndpointNodes(linkedNodeIds);
            syncEndpointTypeControls();
            syncEndpointNodeControl();
          }
        }
        if (t.dataset.deleteEndpoint) {
          await api('/api/admin/preferred-endpoints/' + t.dataset.deleteEndpoint, { method: 'DELETE' });
          setNotice('Endpoint deleted.', 'ok');
          await refreshEndpoints();
          await refreshGeneratedNodes();
          await refreshGroups();
        }
        if (t.dataset.editGroup) {
          const row = state.groups.find((item) => item.id === t.dataset.editGroup);
          if (row) {
            editingGroupId = row.id;
            byId('createGroup').textContent = 'Update Group';
            byId('groupName').value = row.name || '';
            markDerivedCandidates(groupDisplayIds(row));
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
    byId('cancelGroupEdit').onclick = resetGroupForm;
    byId('cancelSniEdit').onclick = resetSniForm;
    byId('cancelImportSourceEdit').onclick = resetImportSourceForm;
    byId('noticeClose').onclick = () => notice.classList.remove('show');
    byId('selectAllBindingNodes').onclick = () => markBindingNodes(unique([...selectedBindingNodeIds(), ...visibleBindingNodes().map((node) => node.id)]));
    byId('clearBindingNodes').onclick = () => markBindingNodes([]);
    byId('bindingNodeFilter').oninput = renderBindingNodeList;
    byId('bindingNodeStatus').onchange = renderBindingNodeList;
    byId('bindingTrafficFilter').oninput = renderTunnelOptions;
    byId('bindingEndpointFilter').oninput = renderEndpointOptions;
    byId('endpointType').onchange = syncEndpointTypeControls;
    byId('endpointRole').onchange = () => {
      endpointNodeSelectionTouched = true;
      markEndpointNodes([]);
      syncEndpointNodeControl();
    };
    byId('selectAllEndpointNodes').onclick = () => {
      endpointNodeSelectionTouched = true;
      markEndpointNodes(unique([...selectedEndpointNodeIds(), ...visibleEndpointNodes().map((node) => node.id)]));
    };
    byId('clearEndpointNodes').onclick = () => {
      endpointNodeSelectionTouched = true;
      markEndpointNodes([]);
    };
    byId('endpointNodeFilter').oninput = renderEndpointNodeOptions;
    byId('endpointNodeStatus').onchange = renderEndpointNodeOptions;
    byId('selectAllDerived').onclick = () => markDerivedCandidates(unique([...selectedDerivedIds(), ...filteredGeneratedNodes().map((node) => node.id)]));
    byId('clearDerived').onclick = () => markDerivedCandidates([]);
    byId('groupCandidateFilter').oninput = renderGeneratedNodeOptions;
    byId('groupCandidateMode').onchange = renderGeneratedNodeOptions;
    byId('savedGroupFilter').oninput = renderSavedGroups;
    byId('savedGroupMode').onchange = renderSavedGroups;

    byId('saveSni').onclick = async () => {
      try {
        const path = editingSniId ? '/api/admin/custom-snis/' + editingSniId : '/api/admin/custom-snis';
        const method = editingSniId ? 'PATCH' : 'POST';
        const wasEditing = Boolean(editingSniId);
        await api(path, { method, body: JSON.stringify({
          name: byId('sniName').value,
          hostname: byId('sniHostname').value,
          remark: byId('sniRemark').value,
          enabled: byId('sniEnabled').value === 'true',
          sortOrder: Number(byId('sniSort').value || 0)
        }) });
        resetSniForm();
        setNotice(wasEditing ? 'SNI saved.' : 'SNI added.', 'ok');
        await refreshSnis();
        await refreshGeneratedNodes();
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    };

    byId('saveImportSource').onclick = async () => {
      try {
        const path = editingImportSourceId ? '/api/admin/import-sources/' + editingImportSourceId : '/api/admin/import-sources';
        const method = editingImportSourceId ? 'PATCH' : 'POST';
        const rules = importRulesFromReview((activeImportSource() || {}).rules || {});
        const sourceKind = byId('importSourceKind').value;
        const data = await api(path, { method, body: JSON.stringify({
          name: byId('importSourceName').value,
          sourceKind,
          url: sourceKind === 'url' ? byId('importSourceUrl').value : null,
          content: sourceKind === 'content' ? byId('importSourceContent').value : null,
          namePrefix: byId('importPrefix').value,
          enabled: byId('importSourceEnabled').value === 'true',
          rules
        }) });
        activeImportSourceId = (data.importSource && data.importSource.id) || editingImportSourceId;
        editingImportSourceId = activeImportSourceId;
        byId('saveImportSource').textContent = 'Update Source';
        setNotice('Import source saved.', 'ok');
        await refreshImportSources();
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    };

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
        await refreshGeneratedNodes();
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    };
    byId('previewImport').onclick = async () => {
      try {
        let data;
        if (activeImportSourceId) {
          data = await api('/api/admin/import-sources/' + activeImportSourceId + '/preview');
        } else {
          data = await api('/api/admin/proxy-nodes/import-preview', {
            method: 'POST',
            body: JSON.stringify({
              urls: byId('importUrls').value,
              content: byId('importContent').value,
              namePrefix: byId('importPrefix').value
            })
          });
        }
        state.importCandidates = (data.candidates || []).map((item) => {
          const parentIds = Array.isArray(item.parentIds) ? item.parentIds.filter(Boolean) : [];
          return { ...item, removed: Boolean(item.removed), asTlsCarrier: Boolean(item.asTlsCarrier), parentIds };
        });
        renderImportReview();
        setNotice('Preview loaded ' + state.importCandidates.length + ' candidate node(s)' + (data.errors && data.errors.length ? '; ' + data.errors.join('; ') : '.') , state.importCandidates.length ? 'ok' : 'warn');
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    };
    byId('applyImportFilter').onclick = () => {
      const keywords = importKeywords();
      if (keywords.length === 0) {
        setNotice('Enter one or more keywords before applying import filter.', 'warn');
        return;
      }
      const include = byId('importFilterMode').value === 'include';
      state.importCandidates.forEach((item) => {
        const matched = keywords.some((keyword) => importSearchText(item).includes(keyword));
        item.removed = include ? !matched : matched;
        if (item.removed) {
          state.importCandidates.forEach((candidate) => {
            if (Array.isArray(candidate.parentIds)) {
              candidate.parentIds = candidate.parentIds.filter((id) => id !== item.id);
            }
          });
        }
      });
      renderImportReview();
      setNotice('Import filter applied.', 'ok');
    };
    byId('clearImportReview').onclick = () => {
      state.importCandidates = [];
      renderImportReview();
      setNotice('Import preview cleared.', 'warn');
    };
    byId('saveImportRules').onclick = async () => {
      try {
        if (!activeImportSourceId) throw new Error('Save or select an import source before saving rules.');
        await api('/api/admin/import-sources/' + activeImportSourceId, {
          method: 'PATCH',
          body: JSON.stringify({ rules: importRulesFromReview((activeImportSource() || {}).rules || {}) })
        });
        setNotice('Import rules saved.', 'ok');
        await refreshImportSources();
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    };
    byId('commitImport').onclick = async () => {
      try {
        const candidates = activeImportCandidatesForCommit();
        if (candidates.length === 0) throw new Error('No selected import candidates.');
        const source = activeImportSource();
        const rules = importRulesFromReview((source || {}).rules || {});
        if (activeImportSourceId) {
          await api('/api/admin/import-sources/' + activeImportSourceId, {
            method: 'PATCH',
            body: JSON.stringify({ rules })
          });
          await refreshImportSources();
        }
        const data = await api('/api/admin/proxy-nodes/import-subscription', {
          method: 'POST',
          body: JSON.stringify({
            candidates,
            enabled: true,
            ...(source ? {
              remark: source.name,
              replaceExistingForRemark: true,
              replaceExistingRemarks: source.source_kind === 'url' ? source.url || '' : ''
            } : {})
          })
        });
        state.importCandidates = [];
        renderImportReview();
        byId('importUrls').value = '';
        byId('importContent').value = '';
        setNotice('Imported ' + data.imported + ' new, updated ' + data.updated + ', skipped ' + data.skipped + (data.errors && data.errors.length ? '; ' + data.errors.join('; ') : '.') , data.imported || data.updated ? 'ok' : 'warn');
        await refreshNodes();
        await refreshGeneratedNodes();
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    };
    byId('applyBinding').onclick = async () => {
      try {
        const ids = selectedBindingNodeIds();
        if (ids.length === 0) throw new Error('Select at least one node in Nodes To Update.');
        const selectedTrafficIds = selectedValues(byId('bindingTraffic'));
        const selectedEndpointIds = selectedAdditionalEndpointIds();
        const endpointNodeIds = new Set(endpointEditableNodeIds(ids));
        await Promise.all(ids.map((id) => api('/api/admin/proxy-nodes/' + id, {
          method: 'PATCH',
          body: JSON.stringify({
            selectedTrafficIds,
            ...(endpointNodeIds.has(id) ? { selectedEndpointIds } : {})
          })
        })));
        await refreshNodes();
        renderTunnelOptions();
        renderEndpointOptions();
        markBindingNodes(ids.filter((id) => state.nodes.some((node) => node.id === id)));
        markSelected(byId('bindingTraffic'), selectedTrafficIds);
        markSelected(byId('bindingEndpoints'), selectedEndpointIds);
        await refreshGeneratedNodes();
        await refreshGroups();
        const skipped = ids.length - endpointNodeIds.size;
        setNotice('Binding applied to ' + ids.length + ' node(s)' + (skipped ? '; endpoint changes skipped for ' + skipped + ' exclusive node(s).' : '.'), 'ok');
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    };
    byId('clearBindingEndpoints').onclick = async () => {
      try {
        const ids = selectedBindingNodeIds();
        if (ids.length === 0) throw new Error('Select at least one node in Nodes To Update.');
        const endpointIds = endpointEditableNodeIds(ids);
        if (endpointIds.length === 0) throw new Error('Selected nodes use exclusive endpoints; clear or change them in Preferred Endpoints.');
        await Promise.all(endpointIds.map((id) => api('/api/admin/proxy-nodes/' + id, {
          method: 'PATCH',
          body: JSON.stringify({ selectedEndpointIds: [] })
        })));
        markSelected(byId('bindingEndpoints'), []);
        await refreshNodes();
        await refreshGeneratedNodes();
        await refreshGroups();
        setNotice('Additional endpoint selections cleared for ' + endpointIds.length + ' node(s)' + (endpointIds.length < ids.length ? '; exclusive node(s) skipped.' : '.'), 'ok');
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    };
    byId('createEndpoint').onclick = async () => {
      try {
        const path = editingEndpointId ? '/api/admin/preferred-endpoints/' + editingEndpointId : '/api/admin/preferred-endpoints';
        const method = editingEndpointId ? 'PATCH' : 'POST';
        const wasEditing = Boolean(editingEndpointId);
        const role = byId('endpointRole').value;
        const endpointType = byId('endpointType').value;
        const body = {
          type: endpointType,
          discoveryMode: endpointType === 'redirect' ? 'redirect' : 'static',
          resolveMode: byId('endpointResolveMode').value,
          label: byId('endpointLabel').value,
          port: byId('endpointPort').value,
          scope: role === 'exclusive' ? 'node' : role,
          selectionMode: role === 'exclusive' ? 'exclusive' : 'additive',
          enabled: byId('endpointEnabled').value === 'true',
          sortOrder: Number(byId('endpointSort').value || 0)
        };
        if (!editingEndpointId || endpointNodeSelectionTouched || role !== editingEndpointOriginalRole) {
          if (endpointRoleUsesNodes(role) && state.nodes.length === 0) {
            throw new Error('Nodes are not loaded. Refresh proxy nodes before saving endpoint node links.');
          }
          body.proxyNodeIds = role === 'exclusive' ? selectedValues(byId('endpointNodeIds')) : [];
          body.excludedProxyNodeIds = role === 'global' ? selectedValues(byId('endpointNodeIds')) : [];
        }
        if (editingEndpointId) body.value = byId('endpointValues').value;
        else body.values = byId('endpointValues').value;
        const data = await api(path, { method, body: JSON.stringify(body) });
        resetEndpointForm();
        const count = data.preferredEndpoints ? data.preferredEndpoints.length : 1;
        setNotice(wasEditing ? 'Endpoint saved.' : 'Added ' + count + ' endpoint(s).', 'ok');
        await refreshEndpoints();
        await refreshGeneratedNodes();
        await refreshGroups();
      } catch (err) {
        setNotice(formatError(err), 'error');
      }
    };
    byId('createGroup').onclick = async () => {
      try {
        const ids = selectedDerivedIds();
        if (ids.length === 0) throw new Error('Select at least one derived node for the group.');
        const path = editingGroupId ? '/api/admin/groups/' + editingGroupId : '/api/admin/groups';
        const method = editingGroupId ? 'PATCH' : 'POST';
        const wasEditing = Boolean(editingGroupId);
        await api(path, { method, body: JSON.stringify({
          name: byId('groupName').value,
          endpointMode: 'selected',
          derivedNodeIds: ids
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
    byId('refreshAgents').onclick = () => refreshAgents().catch((err) => setNotice(formatError(err), 'error'));
    byId('refreshTunnels').onclick = () => refreshTunnels().catch((err) => setNotice(formatError(err), 'error'));
    byId('refreshSnis').onclick = async () => {
      try { await refreshSnis(); await refreshGeneratedNodes(); } catch (err) { setNotice(formatError(err), 'error'); }
    };
    byId('refreshNodes').onclick = async () => {
      try { await refreshNodes(); await refreshGeneratedNodes(); } catch (err) { setNotice(formatError(err), 'error'); }
    };
    byId('refreshEndpoints').onclick = async () => {
      try { await refreshEndpoints(); await refreshGeneratedNodes(); } catch (err) { setNotice(formatError(err), 'error'); }
    };
    byId('refreshImportSources').onclick = () => refreshImportSources().catch((err) => setNotice(formatError(err), 'error'));

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
        await refreshAgents();
        await refreshTunnels();
        await refreshEndpoints();
        await refreshSnis();
        await refreshNodes();
        await refreshImportSources();
        await refreshGeneratedNodes();
        await refreshGroups();
        if (fromLogin) setNotice('Signed in.', 'ok');
      } catch (err) {
        clearPrivateViews();
        setNotice(formatError(err), 'error');
      }
    }

    syncEndpointTypeControls();
    syncEndpointNodeControl();
    refreshAll(false);
  </script>
</body>
</html>`;
}
