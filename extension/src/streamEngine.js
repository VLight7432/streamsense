'use strict';

const EventEmitter = require('events');
const { fetchStreamsFromBackend } = require('./backendClient');

// ── Z-Score anomaly detection ────────────────────────────────────────────────
function zScore(values) {
  if (values.length < 10) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std  = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return std > 0 ? Math.abs((values[values.length - 1] - mean) / std) : 0;
}

// ── CUSUM (Cumulative Sum) for drift detection ────────────────────────────────
function cusum(values, k = 0.5) {
  if (values.length < 5) return { upper: 0, lower: 0 };
  const mean = values.slice(0, -5).reduce((a, b) => a + b, 0) / (values.length - 5);
  let upper = 0, lower = 0;
  for (const v of values.slice(-5)) {
    upper = Math.max(0, upper + (v - mean) - k);
    lower = Math.max(0, lower - (v - mean) - k);
  }
  return { upper, lower };
}

// ── Stream definitions ────────────────────────────────────────────────────────
const STREAM_DEFINITIONS = {
  transactions: { label: 'Transactions/s',    unit: '/s',  base: 450,  noise: 40,  color: '#00c8f0', warn: 2.5, crit: 3.5 },
  errors:       { label: 'API Error Rate',    unit: '%',   base: 1.2,  noise: 0.8, color: '#ff3355', warn: 2.0, crit: 3.0 },
  latency:      { label: 'P95 Latency',       unit: 'ms',  base: 180,  noise: 30,  color: '#f0a800', warn: 2.5, crit: 3.5 },
  users:        { label: 'Active Users',      unit: '',    base: 2400, noise: 150, color: '#00e87a', warn: 2.5, crit: 3.5 },
  revenue:      { label: 'Revenue/min',       unit: '€',   base: 1240, noise: 200, color: '#a78bfa', warn: 2.5, crit: 3.5 },
  cpu:          { label: 'CPU Usage',         unit: '%',   base: 42,   noise: 12,  color: '#fb923c', warn: 2.0, crit: 2.8 },
};

class StreamEngine extends EventEmitter {
  constructor(context) {
    super();
    this.context  = context;
    this.streams  = {};
    this.sources  = [];
    this.alerts   = [];
    this.isRunning = false;
    this._interval = null;
    this._tick     = 0;
    this._injectAnomaly = null;

    // Init stream buffers
    for (const key of Object.keys(STREAM_DEFINITIONS)) {
      this.streams[key] = { history: [], anomaly: false, zscore: 0 };
    }
  }

  async initialize() {
    // Restore saved sources from workspace state
    const saved = this.context.workspaceState.get('streamsense.sources', []);
    this.sources = saved.length > 0 ? saved : [
      { id: 'demo-1', type: 'Demo Mode',    status: 'connected', icon: '⬡' },
    ];

    // Start demo mode automatically
    this.start();
  }

  // ── Alert config ──────────────────────────────────────────────────────────
  getAlertConfig() {
    const saved = this.context.workspaceState.get('streamsense.alertConfig', {});
    const config = {};
    for (const [key, def] of Object.entries(STREAM_DEFINITIONS)) {
      config[key] = {
        enabled:    saved[key]?.enabled    ?? true,
        warnZ:      saved[key]?.warnZ      ?? def.warn,
        critZ:      saved[key]?.critZ      ?? def.crit,
        cusumLimit: saved[key]?.cusumLimit ?? 10,
        label:      def.label,
        color:      def.color,
        unit:       def.unit,
      };
    }
    return config;
  }

  setAlertConfig(config) {
    // Ne stocker que les champs éditables (pas label/color/unit)
    const toSave = {};
    for (const [key, val] of Object.entries(config)) {
      if (!STREAM_DEFINITIONS[key]) continue;
      toSave[key] = {
        enabled:    !!val.enabled,
        warnZ:      Math.max(0.5, Number(val.warnZ)      || STREAM_DEFINITIONS[key].warn),
        critZ:      Math.max(0.5, Number(val.critZ)      || STREAM_DEFINITIONS[key].crit),
        cusumLimit: Math.max(1,   Number(val.cusumLimit) || 10),
      };
    }
    this.context.workspaceState.update('streamsense.alertConfig', toSave);
  }

  // Récupère un snapshot de streams depuis le backend si activé,
  // sinon retourne le snapshot local (démo) existant.
  async getStreamsSnapshot() {
    // Essayer le backend (beta)
    const backendStreams = await fetchStreamsFromBackend();
    if (Array.isArray(backendStreams) && backendStreams.length > 0) {
      const snapshot = {};
      for (const [key, def] of Object.entries(STREAM_DEFINITIONS)) {
        const match = backendStreams.find(s => s.key === key || s.id === key || s.name === def.label);
        const value = match && typeof match.current === 'number' ? match.current : def.base;
        const stream = this.streams[key];
        stream.history.push(value);
        if (stream.history.length > 200) stream.history.shift();

        const h = stream.history;
        snapshot[key] = {
          ...def,
          current: h.length > 0 ? h[h.length - 1] : def.base,
          history: h.slice(-60),
          anomaly: stream.anomaly,
          zscore:  stream.zscore,
        };
      }
      return snapshot;
    }

    // Fallback: comportement actuel (mode démo)
    return this.getSnapshot();
  }

  async getStreams() {
    // 1. Essayer le backend
    const backendStreams = await fetchStreamsFromBackend();
    if (Array.isArray(backendStreams) && backendStreams.length > 0) {
      return backendStreams.map(s => ({
        id: s.id,
        name: s.name,
        status: s.status || 'running',
        // ...adapter au format attendu par le reste de StreamSense...
      }));
    }

    // 2. Fallback sur la simulation locale existante
    return this.getSnapshot();
  }

  start() {
    if (this._interval) return;
    this.isRunning = true;
    this._interval = setInterval(() => this._tick_(), 
      Math.max(500, this.context.workspaceState.get('streamsense.interval', 1000))
    );
    this.emit('sourceChange');
  }

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    this.isRunning = false;
    this.emit('sourceChange');
  }

  toggle() {
    this.isRunning ? this.stop() : this.start();
  }

  _tick_() {
    this._tick++;
    const t = this._tick;
    const newAlerts = [];

    for (const [key, def] of Object.entries(STREAM_DEFINITIONS)) {
      const inject = this._injectAnomaly === key;
      const seasonal = Math.sin(t / 20) * def.noise * 0.4;
      const noise    = (Math.random() - 0.5) * def.noise;
      const spike    = inject ? def.base * (Math.random() > 0.5 ? 3.2 : -0.65) : 0;
      const value    = Math.max(0, def.base + seasonal + noise + spike);

      const stream = this.streams[key];
      stream.history.push(value);
      if (stream.history.length > 200) stream.history.shift();

      // Anomaly detection
      const window = stream.history.slice(-40);
      const z = zScore(window);
      const drift = cusum(window);
      stream.zscore = z;

      const alertCfg = this.getAlertConfig()[key];
      const warnZ      = alertCfg.warnZ;
      const critZ      = alertCfg.critZ;
      const cusumLimit = alertCfg.cusumLimit;
      const enabled    = alertCfg.enabled;

      const wasAnomaly = stream.anomaly;
      stream.anomaly = enabled && (z > warnZ || drift.upper > cusumLimit || drift.lower > cusumLimit);

      // New anomaly detected → create alert
      if (stream.anomaly && !wasAnomaly) {
        const severity = z > critZ ? 'critical' : 'warning';
        const alert = {
          id:       `${key}-${Date.now()}`,
          streamKey: key,
          label:    def.label,
          color:    def.color,
          message:  `${def.label} anomaly: ${value.toFixed(1)}${def.unit} (z=${z.toFixed(2)}σ)`,
          detail:   `Detected via ${z > warnZ ? 'Z-Score' : 'CUSUM drift'}. ${severity === 'critical' ? 'Immediate action recommended.' : 'Monitor closely.'}`,
          severity,
          timestamp: new Date().toISOString(),
        };
        this.alerts.unshift(alert);
        if (this.alerts.length > 100) this.alerts.pop();
        newAlerts.push(alert);
        this.emit('alert', alert);
      }
    }

    this.emit('data', { streams: this.streams, tick: t });
  }

  // ── Sources management ───────────────────────────────────────────────────
  async addSource(source) {
    const id = `src-${Date.now()}`;
    const entry = { id, ...source, status: 'connecting', connectedAt: new Date().toISOString() };
    this.sources.push(entry);
    this._saveState();

    // Simulate connection
    setTimeout(() => {
      entry.status = 'connected';
      this._saveState();
      this.emit('sourceChange');
    }, 1200);

    this.emit('sourceChange');
    if (!this.isRunning) this.start();
    return entry;
  }

  removeSource(id) {
    this.sources = this.sources.filter(s => s.id !== id);
    this._saveState();
    this.emit('sourceChange');
  }

  reconnectAll() {
    for (const s of this.sources) {
      if (s.status === 'error') { s.status = 'connecting'; }
    }
    this._saveState();
    this.emit('sourceChange');
  }

  clearAlerts() { this.alerts = []; this.emit('data'); }

  injectAnomaly(streamKey, durationMs = 5000) {
    this._injectAnomaly = streamKey;
    setTimeout(() => { this._injectAnomaly = null; }, durationMs);
  }

  getSnapshot() {
    const snapshot = {};
    for (const [key, def] of Object.entries(STREAM_DEFINITIONS)) {
      const h = this.streams[key].history;
      snapshot[key] = {
        ...def,
        current: h.length > 0 ? h[h.length - 1] : def.base,
        history: h.slice(-60),
        anomaly: this.streams[key].anomaly,
        zscore:  this.streams[key].zscore,
      };
    }
    return snapshot;
  }

  _saveState() {
    this.context.workspaceState.update('streamsense.sources', this.sources);
  }
}

module.exports = { StreamEngine, STREAM_DEFINITIONS };
