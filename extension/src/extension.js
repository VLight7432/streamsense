'use strict';

const vscode = require('vscode');
const { DashboardPanel } = require('./panel');
const { SourcesProvider } = require('./sourcesProvider');
const { AlertsProvider } = require('./alertsProvider');
const { MetricsProvider } = require('./metricsProvider');
const { StreamEngine } = require('./streamEngine');
const { StatusBarManager } = require('./statusBar');

let streamEngine;
let statusBar;

/**
 * Called when the extension is activated.
 */
async function activate(context) {
  console.log('[StreamSense] Extension activating...');

  // ── Initialize stream engine ──────────────────────────────────────────────
  streamEngine = new StreamEngine(context);
  await streamEngine.initialize();

  // ── Status bar ────────────────────────────────────────────────────────────
  statusBar = new StatusBarManager(context, streamEngine);

  // ── Tree view providers ───────────────────────────────────────────────────
  const sourcesProvider = new SourcesProvider(context, streamEngine);
  const alertsProvider  = new AlertsProvider(context, streamEngine);
  const metricsProvider = new MetricsProvider(context, streamEngine);

  vscode.window.registerTreeDataProvider('streamsense.sourcesView', sourcesProvider);
  vscode.window.registerTreeDataProvider('streamsense.alertsView',  alertsProvider);
  vscode.window.registerTreeDataProvider('streamsense.metricsView', metricsProvider);

  // Refresh tree views on new data
  streamEngine.on('data', () => {
    metricsProvider.refresh();
  });
  streamEngine.on('alert', (alert) => {
    alertsProvider.refresh();
    statusBar.update();

    const cfg = vscode.workspace.getConfiguration('streamsense');
    if (cfg.get('enableNotifications') && alert.severity === 'critical') {
      vscode.window.showWarningMessage(
        `⚠ StreamSense: ${alert.message}`,
        'Open Dashboard'
      ).then(action => {
        if (action === 'Open Dashboard') {
          DashboardPanel.createOrShow(context, streamEngine);
        }
      });
    }
  });
  streamEngine.on('sourceChange', () => {
    sourcesProvider.refresh();
    statusBar.update();
  });

  // ── Commands ──────────────────────────────────────────────────────────────
  context.subscriptions.push(

    vscode.commands.registerCommand('streamsense.openDashboard', () => {
      DashboardPanel.createOrShow(context, streamEngine);
    }),

    vscode.commands.registerCommand('streamsense.connectSource', async () => {
      const sources = [
        'PostgreSQL', 'MySQL', 'MongoDB', 'Redis',
        'Kafka', 'Stripe API', 'Shopify', 'Google Analytics',
        'AWS CloudWatch', 'Datadog', 'Custom HTTP Endpoint'
      ];
      const picked = await vscode.window.showQuickPick(sources, {
        placeHolder: 'Select a data source to connect',
        title: 'StreamSense — Connect Data Source'
      });
      if (!picked) return;

      // Source-specific config
      let config = {};
      if (['PostgreSQL', 'MySQL', 'MongoDB'].includes(picked)) {
        const host = await vscode.window.showInputBox({ prompt: `${picked} host`, value: 'localhost' });
        if (!host) return;
        const dbName = await vscode.window.showInputBox({ prompt: 'Database name' });
        if (!dbName) return;
        config = { host, database: dbName };
      } else if (picked === 'Stripe API') {
        const key = await vscode.window.showInputBox({
          prompt: 'Stripe Secret Key (sk_...)',
          password: true
        });
        if (!key) return;
        config = { apiKey: key };
      } else if (picked === 'Custom HTTP Endpoint') {
        const url = await vscode.window.showInputBox({ prompt: 'Endpoint URL', value: 'https://' });
        if (!url) return;
        config = { url };
      }

      await streamEngine.addSource({ type: picked, config });
      vscode.window.showInformationMessage(`✓ StreamSense: ${picked} connected successfully`);
    }),

    vscode.commands.registerCommand('streamsense.analyzeWithAI', async () => {
      DashboardPanel.createOrShow(context, streamEngine);
      // Trigger AI analysis in the panel
      setTimeout(() => {
        DashboardPanel.currentPanel?.triggerAIAnalysis();
      }, 500);
    }),

    vscode.commands.registerCommand('streamsense.toggleStream', () => {
      streamEngine.toggle();
      statusBar.update();
      const state = streamEngine.isRunning ? 'resumed' : 'paused';
      vscode.window.showInformationMessage(`StreamSense stream ${state}`);
    }),

    vscode.commands.registerCommand('streamsense.clearAlerts', () => {
      streamEngine.clearAlerts();
      alertsProvider.refresh();
      statusBar.update();
    }),

    vscode.commands.registerCommand('streamsense.refreshSources', () => {
      sourcesProvider.refresh();
      streamEngine.reconnectAll();
    }),

    // Inline alert action: jump to dashboard for this stream
    vscode.commands.registerCommand('streamsense.focusStream', (streamKey) => {
      DashboardPanel.createOrShow(context, streamEngine);
      DashboardPanel.currentPanel?.focusStream(streamKey);
    })
  );

  // ── Welcome message on first install ─────────────────────────────────────
  const isFirstInstall = context.globalState.get('streamsense.firstInstall', true);
  if (isFirstInstall) {
    context.globalState.update('streamsense.firstInstall', false);
    vscode.window.showInformationMessage(
      '⬡ StreamSense installed! Open the dashboard to start monitoring your data.',
      'Open Dashboard',
      'Configure API Key'
    ).then(action => {
      if (action === 'Open Dashboard') {
        DashboardPanel.createOrShow(context, streamEngine);
      } else if (action === 'Configure API Key') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'streamsense.apiKey');
      }
    });
  }

  // Auto-start stream
  const cfg = vscode.workspace.getConfiguration('streamsense');
  if (cfg.get('autoConnect') && streamEngine.sources.length > 0) {
    streamEngine.start();
  }

  console.log('[StreamSense] Extension activated ✓');
}

/**
 * Called when the extension is deactivated.
 */
function deactivate() {
  streamEngine?.stop();
  statusBar?.dispose();
  console.log('[StreamSense] Extension deactivated');
}

module.exports = { activate, deactivate };
