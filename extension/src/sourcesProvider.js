'use strict';

const vscode = require('vscode');
const { STREAM_DEFINITIONS } = require('./streamEngine');

// ── Sources Provider ──────────────────────────────────────────────────────────
class SourcesProvider {
  constructor(context, engine) {
    this._engine = engine;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }

  refresh() { this._emitter.fire(); }

  getTreeItem(element) { return element; }

  async getChildren(element) {
    // Si on est à la racine de l’arbre, on s’appuie sur les sources connues
    if (!element) {
      // Optionnel : on pourrait, à terme, mapper les streams backend sur des "sources" ici.
      if (this._engine.sources.length === 0) {
        return [new vscode.TreeItem('No sources connected', vscode.TreeItemCollapsibleState.None)];
      }
      return this._engine.sources.map(src => {
        const item = new vscode.TreeItem(src.type, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = src.id;
        item.contextValue = 'source';
        item.tooltip = `${src.type}\nStatus: ${src.status}\nConnected: ${src.connectedAt || 'N/A'}`;
        item.iconPath = src.status === 'connected'
          ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'))
          : src.status === 'connecting'
          ? new vscode.ThemeIcon('loading~spin')
          : new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconFailed'));
        item.description = src.status;
        return item;
      });
    }

    // Children: show config details
    const src = this._engine.sources.find(s => s.id === element.id);
    if (!src) return [];
    const children = [];
    for (const [k, v] of Object.entries(src.config || {})) {
      const child = new vscode.TreeItem(`${k}: ${k.toLowerCase().includes('key') ? '••••••' : v}`);
      child.iconPath = new vscode.ThemeIcon('symbol-property');
      children.push(child);
    }
    return children;
  }
}

// ── Alerts Provider ───────────────────────────────────────────────────────────
class AlertsProvider {
  constructor(context, engine) {
    this._engine = engine;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }

  refresh() { this._emitter.fire(); }
  getTreeItem(element) { return element; }

  getChildren(element) {
    if (!element) {
      const alerts = this._engine.alerts.slice(0, 50);
      if (alerts.length === 0) {
        const ok = new vscode.TreeItem('✓ All systems nominal');
        ok.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
        return [ok];
      }
      return alerts.map(alert => {
        const item = new vscode.TreeItem(alert.message, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = alert.id;
        item.tooltip = alert.detail;
        item.description = new Date(alert.timestamp).toLocaleTimeString();
        item.iconPath = alert.severity === 'critical'
          ? new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
          : new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
        item.contextValue = 'alert';
        item.command = {
          command: 'streamsense.focusStream',
          title: 'View Stream',
          arguments: [alert.streamKey]
        };
        return item;
      });
    }

    // Alert details
    const alert = this._engine.alerts.find(a => a.id === element.id);
    if (!alert) return [];
    return [
      this._detailItem('Stream', alert.label, 'graph'),
      this._detailItem('Severity', alert.severity.toUpperCase(), 'shield'),
      this._detailItem('Time', new Date(alert.timestamp).toLocaleString(), 'calendar'),
      this._detailItem('Detail', alert.detail, 'info'),
    ];
  }

  _detailItem(label, value, icon) {
    const item = new vscode.TreeItem(`${label}: ${value}`);
    item.iconPath = new vscode.ThemeIcon(icon);
    return item;
  }
}

// ── Metrics Provider ──────────────────────────────────────────────────────────
class MetricsProvider {
  constructor(context, engine) {
    this._engine = engine;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }

  refresh() { this._emitter.fire(); }
  getTreeItem(el) { return el; }

  getChildren(element) {
    const snap = this._engine.getSnapshot();

    if (!element) {
      return Object.entries(snap).map(([key, data]) => {
        const val = data.current.toFixed(key === 'errors' ? 2 : 0);
        const item = new vscode.TreeItem(
          `${data.label}`,
          vscode.TreeItemCollapsibleState.Collapsed
        );
        item.id = `metric-${key}`;
        item.description = `${val}${data.unit}`;
        item.tooltip = `Z-score: ${data.zscore.toFixed(2)}σ`;
        item.iconPath = data.anomaly
          ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'))
          : new vscode.ThemeIcon('graph-line');
        item.contextValue = 'metric';
        return item;
      });
    }

    // Metric details
    const key = element.id?.replace('metric-', '');
    const data = snap[key];
    if (!data) return [];

    const h = data.history;
    const avg = h.length ? (h.reduce((a, b) => a + b, 0) / h.length).toFixed(1) : 'N/A';
    const min = h.length ? Math.min(...h).toFixed(1) : 'N/A';
    const max = h.length ? Math.max(...h).toFixed(1) : 'N/A';

    return [
      this._stat('Current', `${data.current.toFixed(1)}${data.unit}`, 'pulse'),
      this._stat('Average', `${avg}${data.unit}`, 'symbol-numeric'),
      this._stat('Min / Max', `${min} / ${max}${data.unit}`, 'arrow-both'),
      this._stat('Z-Score', `${data.zscore.toFixed(2)}σ`, 'beaker'),
      this._stat('Status', data.anomaly ? '⚠ ANOMALY' : '✓ Normal', data.anomaly ? 'warning' : 'pass'),
    ];
  }

  _stat(label, value, icon) {
    const item = new vscode.TreeItem(`${label}: ${value}`);
    item.iconPath = new vscode.ThemeIcon(icon);
    return item;
  }
}

module.exports = { SourcesProvider, AlertsProvider, MetricsProvider };
