'use strict';

const vscode = require('vscode');

class StatusBarManager {
  constructor(context, engine) {
    this._engine = engine;

    // Main status item
    this._item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right, 1000
    );
    this._item.command = 'streamsense.openDashboard';

    // Alert badge
    this._alertItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right, 999
    );
    this._alertItem.command = 'streamsense.openDashboard';

    context.subscriptions.push(this._item, this._alertItem);

    const cfg = vscode.workspace.getConfiguration('streamsense');
    if (cfg.get('enableStatusBar')) {
      this.update();
      this._item.show();
    }

    // Listen for data changes
    engine.on('data', () => this.update());
    engine.on('alert', () => this.update());
    engine.on('sourceChange', () => this.update());
  }

  update() {
    const snap = this._engine.getSnapshot();
    const srcCount = this._engine.sources.filter(s => s.status === 'connected').length;
    const alertCount = this._engine.alerts.filter(a => {
      const age = Date.now() - new Date(a.timestamp).getTime();
      return age < 5 * 60 * 1000; // last 5 minutes
    }).length;
    const hasAnomaly = Object.values(snap).some(s => s.anomaly);
    const running = this._engine.isRunning;

    if (running) {
      const txn = snap.transactions?.current?.toFixed(0) || '—';
      this._item.text = `$(pulse) StreamSense · ${txn}/s`;
      this._item.tooltip = `StreamSense — Live · ${srcCount} source(s) connected\nClick to open dashboard`;
      this._item.backgroundColor = hasAnomaly
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
      this._item.color = hasAnomaly ? new vscode.ThemeColor('statusBarItem.warningForeground') : undefined;
    } else {
      this._item.text = `$(debug-pause) StreamSense · Paused`;
      this._item.tooltip = 'StreamSense — Paused. Click to open dashboard.';
      this._item.backgroundColor = undefined;
      this._item.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
    }

    if (alertCount > 0) {
      this._alertItem.text = `$(warning) ${alertCount}`;
      this._alertItem.tooltip = `${alertCount} active alert(s) — click to view`;
      this._alertItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this._alertItem.show();
    } else {
      this._alertItem.hide();
    }
  }

  dispose() {
    this._item.dispose();
    this._alertItem.dispose();
  }
}

module.exports = { StatusBarManager };
