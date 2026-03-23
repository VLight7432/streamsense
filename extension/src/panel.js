'use strict';

const vscode = require('vscode');
const path   = require('path');
const { fetchDemoMetricsFromBackend, fetchLicenseProfile } = require('./backendClient');

class DashboardPanel {
  static currentPanel = null;
  static viewType = 'streamsenseDashboard';

  static createOrShow(context, engine) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'StreamSense Dashboard',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, 'media'))
        ]
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, context, engine);
  }

  constructor(panel, context, engine) {
    this._panel   = panel;
    this._context = context;
    this._engine  = engine;
    this._disposed = false;

    this._panel.webview.html = this._getHtml();
    this._panel.iconPath = vscode.Uri.file(
      path.join(context.extensionPath, 'resources', 'icon-mono.svg')
    );

    // Envoyer le plan de licence au webview
    this._initLicenseBadge();

    // Send data updates to webview
    this._dataListener = engine.on('data', () => {
      if (!this._disposed) this._sendSnapshot();
    });
    engine.on('alert', (alert) => {
      if (!this._disposed) {
        this._panel.webview.postMessage({ type: 'alert', alert });
      }
    });

    // Handle messages from webview
    this._panel.webview.onDidReceiveMessage(msg => this._handleMessage(msg));

    // Cleanup
    this._panel.onDidDispose(() => this.dispose());

    // Initial data push
    setTimeout(() => this._sendSnapshot(), 300);
  }

  async _initLicenseBadge() {
    try {
      const profile = await fetchLicenseProfile();
      this._panel.webview.postMessage({ type: 'licenseProfile', profile });
    } catch (e) {
      // en cas d'erreur, on reste silencieux et on n'affiche pas de badge spécifique
    }
  }

  async _sendSnapshot() {
    // Snapshot local (simulation / backend streams déjà intégrés par le moteur)
    const snap = this._engine.getSnapshot();

    // Enrichir avec les métriques backend demo si dispo
    try {
      const backendMetrics = await fetchDemoMetricsFromBackend();
      if (Array.isArray(backendMetrics) && backendMetrics.length > 0) {
        for (const m of backendMetrics) {
          // mappe les streamId backend sur les clés connues du moteur
          const key = m.streamId; // ex: 'transactions', 'errors', 'latency'
          const s = snap[key];
          if (!s) continue;
          const value = typeof m.value === 'number' ? m.value : s.current;
          s.current = value;
          s.history = [...(s.history || []), value].slice(-60);
        }
      }
    } catch (e) {
      console.warn('[StreamSense] Erreur lors de la récupération des métriques backend demo:', e.message);
    }

    const alerts = this._engine.alerts.slice(0, 20);
    const sources = this._engine.sources;
    this._panel.webview.postMessage({
      type: 'snapshot',
      payload: { snap, alerts, sources, isRunning: this._engine.isRunning }
    });
  }

  async _handleMessage(msg) {
    switch (msg.type) {
      case 'ready':
        this._sendSnapshot();
        this._panel.webview.postMessage({ type: 'alertConfig', config: this._engine.getAlertConfig() });
        break;
      case 'getAlertConfig':
        this._panel.webview.postMessage({ type: 'alertConfig', config: this._engine.getAlertConfig() });
        break;
      case 'updateAlertConfig':
        this._engine.setAlertConfig(msg.config);
        this._panel.webview.postMessage({ type: 'alertConfig', config: this._engine.getAlertConfig() });
        break;
      case 'toggleStream':
        this._engine.toggle();
        this._sendSnapshot();
        break;
      case 'injectAnomaly':
        this._engine.injectAnomaly(msg.streamKey, 5000);
        break;
      case 'clearAlerts':
        this._engine.clearAlerts();
        this._sendSnapshot();
        break;
      case 'connectSource':
        await vscode.commands.executeCommand('streamsense.connectSource');
        break;
      case 'analyzeAI': {
        const snap = this._engine.getSnapshot();
        const alerts = this._engine.alerts.slice(0, 5);
        const cfg = vscode.workspace.getConfiguration('streamsense');
        const apiKey = cfg.get('apiKey') || '';

        this._panel.webview.postMessage({ type: 'aiLoading' });

        try {
          const summary = Object.values(snap)
            .map(s => `${s.label}: ${s.current.toFixed(1)}${s.unit}${s.anomaly ? ' ⚠' : ''}`)
            .join(' | ');

          const body = {
            model: 'claude-sonnet-4-6',
            max_tokens: 1000,
            messages: [{
              role: 'user',
              content: `Tu es un analyste de données expert. Analyse ces métriques temps réel d'une plateforme:\n\n${summary}\n\nAlertes actives: ${alerts.length > 0 ? alerts.map(a => a.message).join(', ') : 'aucune'}\n\nDonne une analyse concise en 3-4 phrases: situation actuelle, cause probable si anomalie, et recommandation actionnable. Réponds en français professionnel, sans bullet points.`
            }]
          };

          const headers = { 'Content-Type': 'application/json' };
          if (apiKey) { headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01'; }

          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST', headers, body: JSON.stringify(body)
          });
          const data = await res.json();
          const text = data.content?.[0]?.text || 'Analyse indisponible.';
          this._panel.webview.postMessage({ type: 'aiResult', text });
        } catch (e) {
          this._panel.webview.postMessage({ type: 'aiResult', text: `Erreur: ${e.message}` });
        }
        break;
      }
    }
  }

  triggerAIAnalysis() {
    this._handleMessage({ type: 'analyzeAI' });
  }

  focusStream(streamKey) {
    this._panel.webview.postMessage({ type: 'focusStream', streamKey });
  }

  dispose() {
    this._disposed = true;
    DashboardPanel.currentPanel = null;
    this._panel.dispose();
  }

  _getHtml() {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src https://fonts.gstatic.com; connect-src https://api.anthropic.com https://fonts.googleapis.com;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>StreamSense</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap');
  :root {
    --bg: var(--vscode-editor-background, #06080b);
    --fg: var(--vscode-editor-foreground, #c5d5e8);
    --border: var(--vscode-panel-border, #1a2332);
    --input-bg: var(--vscode-input-background, #0b0f14);
    --btn: var(--vscode-button-background, #00c8f0);
    --btn-fg: var(--vscode-button-foreground, #000);
    --cyan: #00c8f0; --green: #00e87a; --red: #ff3355;
    --amber: #f0a800; --purple: #a78bfa; --orange: #fb923c;
    --muted: #4a6478;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--fg); font-family: 'DM Mono', monospace; font-size: 12px; }

  /* Header */
  .header { display:flex; align-items:center; justify-content:space-between; padding:12px 20px; border-bottom:1px solid var(--border); position:sticky; top:0; background:var(--bg); z-index:100; }
  .logo { font-family:'Bebas Neue',sans-serif; font-size:20px; letter-spacing:2px; color:#fff; }
  .logo span { color:var(--cyan); }
  .header-actions { display:flex; gap:8px; align-items:center; }
  .status-dot { width:8px; height:8px; border-radius:50%; animation:blink 2s infinite; }
  .status-dot.on { background:var(--green); } .status-dot.off { background:var(--muted); animation:none; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
  button { background:var(--input-bg); border:1px solid var(--border); color:var(--fg); padding:5px 12px; cursor:pointer; font-family:inherit; font-size:11px; border-radius:2px; letter-spacing:1px; transition:all 0.15s; }
  button:hover { border-color:var(--cyan); color:var(--cyan); }
  button.primary { background:var(--cyan); color:#000; border-color:var(--cyan); font-weight:500; }
  button.primary:hover { background:#fff; }
  button.danger { border-color:var(--red)55; color:var(--red); }

  /* Plan badge */
  .plan-badge { font-size:10px; padding:2px 6px; border-radius:10px; border:1px solid var(--border); color:var(--muted); text-transform:uppercase; letter-spacing:1.5px; }
  .plan-badge.pro { border-color:var(--cyan); color:var(--cyan); }
  .plan-badge.lifetime { border-color:var(--amber); color:var(--amber); }

  /* Tabs */
  .tabs { display:flex; border-bottom:1px solid var(--border); padding:0 20px; }
  .tab { padding:10px 16px; cursor:pointer; font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:var(--muted); border-bottom:2px solid transparent; transition:all 0.15s; }
  .tab.active { color:var(--cyan); border-bottom-color:var(--cyan); }
  .tab-pane { display:none; padding:20px; } .tab-pane.active { display:block; }

  /* Metrics grid */
  .metrics-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:16px; }
  .metric-card { background:var(--input-bg); border:1px solid var(--border); padding:14px 16px; border-radius:2px; transition:border-color 0.3s; }
  .metric-card.anomaly { border-color:var(--anomaly-color,var(--red)); box-shadow:0 0 12px var(--anomaly-color,var(--red))22; }
  .metric-label { color:var(--muted); font-size:10px; letter-spacing:2px; text-transform:uppercase; margin-bottom:6px; }
  .metric-val { font-family:'Bebas Neue',sans-serif; font-size:28px; letter-spacing:1px; transition:color 0.3s; }
  .metric-unit { font-size:11px; color:var(--muted); margin-left:4px; }
  .metric-badge { display:inline-block; font-size:9px; letter-spacing:1.5px; padding:2px 6px; border:1px solid; border-radius:1px; margin-top:4px; text-transform:uppercase; }

  /* Mini sparkline */
  canvas.spark { width:100%; height:36px; display:block; margin-top:8px; }

  /* Charts */
  .charts-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .chart-card { background:var(--input-bg); border:1px solid var(--border); padding:14px; border-radius:2px; }
  .chart-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
  .chart-title { color:var(--fg); font-size:11px; font-weight:500; }
  .chart-val { font-family:'Bebas Neue',sans-serif; font-size:22px; }
  canvas.chart { width:100%; height:80px; display:block; }

  /* Alerts */
  .alert-list { display:flex; flex-direction:column; gap:8px; }
  .alert-item { background:var(--input-bg); border-left:3px solid; padding:12px 16px; border-radius:0 2px 2px 0; }
  .alert-top { display:flex; justify-content:space-between; margin-bottom:4px; }
  .alert-msg { color:#fff; font-size:12px; font-weight:500; }
  .alert-time { color:var(--muted); font-size:10px; }
  .alert-detail { color:var(--muted); font-size:11px; line-height:1.5; }
  .no-alerts { text-align:center; padding:40px; color:var(--muted); }
  .no-alerts .ok { font-size:32px; margin-bottom:12px; color:var(--green); }

  /* AI panel */
  .ai-panel { background:var(--input-bg); border:1px solid var(--cyan)44; padding:20px; border-radius:2px; position:relative; min-height:120px; }
  .ai-panel::before { content:''; position:absolute; top:0; left:0; right:0; height:2px; background:linear-gradient(90deg,transparent,var(--cyan),transparent); }
  .ai-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
  .ai-title { color:var(--cyan); font-size:12px; font-weight:500; letter-spacing:1px; }
  .ai-text { color:var(--fg); line-height:1.8; font-size:12px; border-left:3px solid var(--cyan)44; padding-left:14px; }
  .ai-loading { display:flex; gap:6px; align-items:center; color:var(--muted); }
  .ai-dot { width:6px; height:6px; background:var(--cyan); border-radius:50%; animation:pulse 1s infinite; }
  .ai-dot:nth-child(2){animation-delay:0.2s} .ai-dot:nth-child(3){animation-delay:0.4s}
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.2} }

  /* Inject panel */
  .inject-grid { display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; }
  .inject-btn { border:1px solid; padding:6px 14px; cursor:pointer; font-size:10px; letter-spacing:1.5px; background:transparent; transition:all 0.2s; border-radius:2px; }

  /* Sources */
  .source-list { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; }
  .source-item { background:var(--input-bg); border:1px solid var(--border); padding:12px 16px; border-radius:2px; display:flex; justify-content:space-between; align-items:center; }
  .source-name { color:#fff; font-size:12px; }
  .source-status { font-size:10px; letter-spacing:1px; }
  .source-status.connected { color:var(--green); } .source-status.connecting { color:var(--amber); }

  /* Scrollbar */
  ::-webkit-scrollbar { width:4px; } ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:var(--border); border-radius:2px; }

  /* Alert config */
  .config-grid { display:flex; flex-direction:column; gap:10px; }
  .config-card { background:var(--input-bg); border:1px solid var(--border); border-radius:2px; padding:14px 16px; }
  .config-card-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
  .config-card-title { font-size:12px; font-weight:500; }
  .config-fields { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; }
  .config-field { display:flex; flex-direction:column; gap:4px; }
  .config-label { font-size:10px; color:var(--muted); letter-spacing:1.5px; text-transform:uppercase; }
  .config-input { background:#ffffff08; border:1px solid var(--border); color:var(--fg); padding:5px 8px; font-family:inherit; font-size:12px; border-radius:2px; width:100%; }
  .config-input:focus { outline:none; border-color:var(--cyan); }
  .config-toggle { display:flex; align-items:center; gap:8px; cursor:pointer; }
  .config-toggle input[type=checkbox] { width:14px; height:14px; accent-color:var(--cyan); cursor:pointer; }
  .config-save { margin-top:16px; display:flex; justify-content:flex-end; gap:8px; align-items:center; }
  .config-saved { color:var(--green); font-size:11px; opacity:0; transition:opacity 0.3s; }
  .config-saved.show { opacity:1; }
</style>
</head>
<body>

<div class="header">
  <span class="logo">Stream<span>Sense</span></span>
  <div class="header-actions">
    <span id="planBadge" class="plan-badge">FREE</span>
    <div class="status-dot on" id="statusDot"></div>
    <span id="statusText" style="color:var(--muted);font-size:11px">LIVE</span>
    <button onclick="send('toggleStream')">⏸ Pause</button>
    <button class="primary" onclick="send('analyzeAI'); setTab('ai')">✦ Analyser IA</button>
  </div>
</div>

<div class="tabs">
  <div class="tab active" onclick="setTab('dashboard', this)">Dashboard</div>
  <div class="tab" onclick="setTab('charts', this)">Charts</div>
  <div class="tab" onclick="setTab('alerts', this)">Alertes <span id="alertCount"></span></div>
  <div class="tab" onclick="setTab('ai', this)">Analyse IA</div>
  <div class="tab" onclick="setTab('sources', this)">Sources</div>
  <div class="tab" onclick="setTab('config', this)">⚙ Config</div>
</div>

<!-- DASHBOARD -->
<div id="tab-dashboard" class="tab-pane active">
  <div class="metrics-grid" id="metricsGrid"></div>
  <div style="margin-top:8px">
    <div style="color:var(--muted);font-size:10px;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">
      🧪 Simulateur d'anomalies
    </div>
    <div class="inject-grid" id="injectGrid"></div>
  </div>
</div>

<!-- CHARTS -->
<div id="tab-charts" class="tab-pane">
  <div class="charts-grid" id="chartsGrid"></div>
</div>

<!-- ALERTS -->
<div id="tab-alerts" class="tab-pane">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <span style="color:var(--muted);font-size:11px">Détection par z-score + CUSUM</span>
    <button class="danger" onclick="send('clearAlerts')">✕ Effacer</button>
  </div>
  <div class="alert-list" id="alertList"></div>
</div>

<!-- AI -->
<div id="tab-ai" class="tab-pane">
  <div style="margin-bottom:16px;display:flex;gap:10px;align-items:center">
    <div style="color:var(--muted);font-size:11px;flex:1">Analyse Claude Sonnet en temps réel de vos flux</div>
    <button class="primary" onclick="send('analyzeAI')">↻ Relancer</button>
  </div>
  <div class="ai-panel">
    <div class="ai-header">
      <span class="ai-title">✦ Intelligence artificielle</span>
    </div>
    <div id="aiContent" style="color:var(--muted);font-size:12px">
      Cliquez sur "Analyser IA" pour obtenir une analyse en temps réel.
    </div>
  </div>
  <div style="margin-top:16px;background:var(--input-bg);border:1px solid var(--border);padding:16px;border-radius:2px">
    <div style="color:var(--muted);font-size:10px;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px">Snapshot actuel</div>
    <div id="aiSnapshot" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px"></div>
  </div>
</div>

<!-- CONFIG -->
<div id="tab-config" class="tab-pane">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
    <span style="color:var(--muted);font-size:11px">Seuils de détection par flux — Z-Score &amp; CUSUM</span>
    <button class="primary" onclick="saveAlertConfig()">Enregistrer</button>
  </div>
  <div class="config-grid" id="configGrid"></div>
  <div class="config-save">
    <span class="config-saved" id="configSaved">✓ Enregistré</span>
  </div>
</div>

<!-- SOURCES -->
<div id="tab-sources" class="tab-pane">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
    <span style="color:var(--muted);font-size:11px">Sources connectées</span>
    <button onclick="send('connectSource')">+ Connecter une source</button>
  </div>
  <div class="source-list" id="sourceList"></div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  let state = { snap: {}, alerts: [], sources: [], isRunning: true };
  let alertConfig = {};
  let chartHistories = {};
  let activeTab = 'dashboard';

  function send(type, data) { vscode.postMessage({ type, ...data }); }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setPlanBadge(profile) {
    const el = document.getElementById('planBadge');
    if (!el) return;
    const plan = (profile && profile.plan || 'free').toLowerCase();
    el.className = 'plan-badge';
    if (plan === 'pro') el.classList.add('pro');
    if (plan === 'lifetime') el.classList.add('lifetime');
    el.textContent = plan.toUpperCase();
  }

  function setTab(id, el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-' + id).classList.add('active');
    if (el) el.classList.add('active');
    activeTab = id;
    if (id === 'charts') renderCharts();
    if (id === 'config') { if (Object.keys(alertConfig).length) renderAlertConfig(); else send('getAlertConfig'); }
  }

  // ── Sparkline ──────────────────────────────────────────────────────────────
  function drawSpark(canvas, data, color) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    const H = canvas.height = 36 * window.devicePixelRatio;
    ctx.clearRect(0, 0, W, H);
    if (!data || data.length < 2) return;
    const min = Math.min(...data), max = Math.max(...data);
    const range = max - min || 1;
    const w = W / (data.length - 1);
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = i * w, y = H - ((v - min) / range) * H * 0.8 - H * 0.1;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 1.5 * window.devicePixelRatio;
    ctx.stroke();
    // Gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color + '44'); grad.addColorStop(1, color + '00');
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
  }

  function drawChart(canvas, data, color, height = 80) {
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.offsetWidth * dpr;
    const H = canvas.height = height * dpr;
    ctx.clearRect(0, 0, W, H);
    if (!data || data.length < 2) return;
    const min = Math.min(...data) * 0.9, max = Math.max(...data) * 1.05;
    const range = max - min || 1;
    const w = W / (data.length - 1);
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = i * w, y = H - ((v - min) / range) * H * 0.85 - H * 0.05;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 2 * dpr; ctx.stroke();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color + '55'); grad.addColorStop(1, color + '00');
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
  }

  // ── Render dashboard ───────────────────────────────────────────────────────
  function renderDashboard() {
    const grid = document.getElementById('metricsGrid');
    const snap = state.snap;
    if (!Object.keys(snap).length) return;

    grid.innerHTML = Object.entries(snap).map(([key, s]) => {
      const val = s.current >= 1000
        ? (s.current / 1000).toFixed(1) + 'k'
        : s.current.toFixed(key === 'errors' ? 2 : 0);
      return \`
        <div class="metric-card \${s.anomaly ? 'anomaly' : ''}" style="--anomaly-color:\${s.color}" id="mc-\${key}">
          <div class="metric-label">\${s.label}</div>
          <div>
            <span class="metric-val" style="color:\${s.color}">\${val}</span>
            <span class="metric-unit">\${s.unit}</span>
          </div>
          \${s.anomaly ? \`<div class="metric-badge" style="color:\${s.color};border-color:\${s.color}44">⚠ anomalie</div>\` : ''}
          <canvas class="spark" id="spark-\${key}"></canvas>
        </div>
      \`;
    }).join('');

    // Draw sparklines after DOM update
    requestAnimationFrame(() => {
      for (const [key, s] of Object.entries(snap)) {
        const canvas = document.getElementById('spark-' + key);
        if (canvas) drawSpark(canvas, s.history, s.color);
      }
    });

    // Inject buttons
    const injectGrid = document.getElementById('injectGrid');
    if (injectGrid && !injectGrid.children.length) {
      injectGrid.innerHTML = Object.entries(snap).map(([key, s]) =>
        \`<button class="inject-btn" style="color:\${s.color};border-color:\${s.color}44"
          onclick="injectAnomaly('\${key}', this)">\${s.label}</button>\`
      ).join('');
    }
  }

  function injectAnomaly(key, btn) {
    send('injectAnomaly', { streamKey: key });
    const orig = btn.textContent;
    btn.textContent = '⚡ INJECTION...';
    btn.style.background = btn.style.color;
    btn.style.color = '#000';
    setTimeout(() => { btn.textContent = orig; btn.style.background = 'transparent'; btn.style.color = ''; }, 5000);
  }

  // ── Render charts ──────────────────────────────────────────────────────────
  function renderCharts() {
    const grid = document.getElementById('chartsGrid');
    const snap = state.snap;
    if (!Object.keys(snap).length) return;

    if (!grid.children.length) {
      grid.innerHTML = Object.entries(snap).map(([key, s]) => \`
        <div class="chart-card" style="border-color:\${s.anomaly ? s.color + '55' : 'var(--border)'}">
          <div class="chart-header">
            <span class="chart-title">\${s.label}</span>
            <span class="chart-val" id="cv-\${key}" style="color:\${s.color}">—</span>
          </div>
          <canvas class="chart" id="chart-\${key}"></canvas>
        </div>
      \`).join('');
    }

    requestAnimationFrame(() => {
      for (const [key, s] of Object.entries(snap)) {
        const cv = document.getElementById('cv-' + key);
        const canvas = document.getElementById('chart-' + key);
        if (cv) {
          const v = s.current;
          cv.textContent = (v >= 1000 ? (v/1000).toFixed(1)+'k' : v.toFixed(key === 'errors' ? 2 : 0)) + s.unit;
        }
        if (canvas) drawChart(canvas, s.history, s.color, 80);
      }
    });
  }

  // ── Render alerts ──────────────────────────────────────────────────────────
  function renderAlerts() {
    const list = document.getElementById('alertList');
    const alerts = state.alerts;
    const countEl = document.getElementById('alertCount');
    if (countEl) countEl.textContent = alerts.length > 0 ? \`(\${alerts.length})\` : '';

    if (!alerts.length) {
      list.innerHTML = \`<div class="no-alerts"><div class="ok">✓</div>Aucune anomalie détectée<br><span style="font-size:10px;color:var(--muted)">Tous les flux sont dans les normes</span></div>\`;
      return;
    }

    list.innerHTML = alerts.map(a => \`
      <div class="alert-item" style="border-color:\${escapeHtml(a.color)}">
        <div class="alert-top">
          <span class="alert-msg">\${escapeHtml(a.message)}</span>
          <span class="alert-time">\${new Date(a.timestamp).toLocaleTimeString('fr-FR')}</span>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <span class="metric-badge" style="color:\${escapeHtml(a.color)};border-color:\${escapeHtml(a.color)}44">\${escapeHtml(a.severity)}</span>
        </div>
        <div class="alert-detail">\${escapeHtml(a.detail)}</div>
      </div>
    \`).join('');
  }

  // ── Render AI snapshot ────────────────────────────────────────────────────
  function renderAISnapshot() {
    const container = document.getElementById('aiSnapshot');
    if (!container) return;
    container.innerHTML = Object.entries(state.snap).map(([key, s]) => \`
      <div style="background:#ffffff08;padding:8px 12px;border-radius:2px;">
        <div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:1.5px">\${s.label}</div>
        <div style="color:\${s.color};font-family:'Bebas Neue',sans-serif;font-size:20px">\${s.current.toFixed(1)}\${s.unit}</div>
        \${s.anomaly ? \`<div style="color:\${s.color};font-size:9px">⚠ ANOMALIE</div>\` : ''}
      </div>
    \`).join('');
  }

  // ── Render sources ────────────────────────────────────────────────────────
  function renderSources() {
    const list = document.getElementById('sourceList');
    list.innerHTML = state.sources.map(s => \`
      <div class="source-item">
        <div>
          <div class="source-name">\${escapeHtml(s.type)}</div>
          \${s.config?.host ? \`<div style="color:var(--muted);font-size:10px">\${escapeHtml(s.config.host)}\${s.config.database ? '/' + escapeHtml(s.config.database) : ''}</div>\` : ''}
        </div>
        <span class="source-status \${escapeHtml(s.status)}">\${escapeHtml(s.status.toUpperCase())}</span>
      </div>
    \`).join('') || '<div style="color:var(--muted);padding:20px;text-align:center">Aucune source connectée</div>';
  }

  // ── Alert config ───────────────────────────────────────────────────────────
  function renderAlertConfig() {
    const grid = document.getElementById('configGrid');
    if (!grid || !Object.keys(alertConfig).length) return;

    grid.innerHTML = Object.entries(alertConfig).map(([key, cfg]) => \`
      <div class="config-card" id="cfg-\${escapeHtml(key)}">
        <div class="config-card-header">
          <span class="config-card-title" style="color:\${escapeHtml(cfg.color)}">\${escapeHtml(cfg.label)}</span>
          <label class="config-toggle">
            <input type="checkbox" id="cfg-enabled-\${escapeHtml(key)}" \${cfg.enabled ? 'checked' : ''}>
            <span style="font-size:11px;color:var(--muted)">Activé</span>
          </label>
        </div>
        <div class="config-fields">
          <div class="config-field">
            <label class="config-label" for="cfg-warnz-\${escapeHtml(key)}">Seuil Warning (σ)</label>
            <input class="config-input" type="number" id="cfg-warnz-\${escapeHtml(key)}"
              min="0.5" max="10" step="0.1" value="\${cfg.warnZ}">
          </div>
          <div class="config-field">
            <label class="config-label" for="cfg-critz-\${escapeHtml(key)}">Seuil Critique (σ)</label>
            <input class="config-input" type="number" id="cfg-critz-\${escapeHtml(key)}"
              min="0.5" max="10" step="0.1" value="\${cfg.critZ}">
          </div>
          <div class="config-field">
            <label class="config-label" for="cfg-cusum-\${escapeHtml(key)}">CUSUM Limite</label>
            <input class="config-input" type="number" id="cfg-cusum-\${escapeHtml(key)}"
              min="1" max="100" step="1" value="\${cfg.cusumLimit}">
          </div>
        </div>
      </div>
    \`).join('');
  }

  function saveAlertConfig() {
    const config = {};
    for (const key of Object.keys(alertConfig)) {
      const enabled    = document.getElementById(\`cfg-enabled-\${key}\`)?.checked ?? true;
      const warnZ      = parseFloat(document.getElementById(\`cfg-warnz-\${key}\`)?.value) || alertConfig[key].warnZ;
      const critZ      = parseFloat(document.getElementById(\`cfg-critz-\${key}\`)?.value) || alertConfig[key].critZ;
      const cusumLimit = parseInt(document.getElementById(\`cfg-cusum-\${key}\`)?.value)   || alertConfig[key].cusumLimit;
      config[key] = { enabled, warnZ, critZ, cusumLimit };
    }
    send('updateAlertConfig', { config });

    // Feedback visuel
    const saved = document.getElementById('configSaved');
    if (saved) {
      saved.classList.add('show');
      setTimeout(() => saved.classList.remove('show'), 2000);
    }
  }

  // ── Message handler ────────────────────────────────────────────────────────
  window.addEventListener('message', ({ data: msg }) => {
    if (msg.type === 'snapshot') {
      state = { ...state, ...msg.payload };
      renderDashboard();
      renderCharts(); // keep up to date
      renderAlerts();
      renderSources();
      renderAISnapshot();

      const dot = document.getElementById('statusDot');
      const txt = document.getElementById('statusText');
      dot.className = 'status-dot ' + (state.isRunning ? 'on' : 'off');
      txt.textContent = state.isRunning ? 'LIVE' : 'PAUSE';
    }
    if (msg.type === 'alert') {
      state.alerts.unshift(msg.alert);
      if (state.alerts.length > 50) state.alerts.pop();
      renderAlerts();
    }
    if (msg.type === 'aiLoading') {
      document.getElementById('aiContent').innerHTML = \`
        <div class="ai-loading">
          <div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div>
          <span style="margin-left:8px">Analyse en cours…</span>
        </div>\`;
    }
    if (msg.type === 'aiResult') {
      const aiEl = document.getElementById('aiContent');
      const div = document.createElement('div');
      div.className = 'ai-text';
      div.textContent = msg.text;
      aiEl.innerHTML = '';
      aiEl.appendChild(div);
    }
    if (msg.type === 'alertConfig') {
      alertConfig = msg.config;
      renderAlertConfig();
    }
    if (msg.type === 'focusStream') {
      setTab('charts');
    }
    if (msg.type === 'licenseProfile') {
      setPlanBadge(msg.profile);
    }
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  send('ready');
</script>
</body>
</html>`;
  }
}

module.exports = { DashboardPanel };
