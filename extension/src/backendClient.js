'use strict';

const vscode = require('vscode');
const https = require('https');
const http = require('http');

function getBackendConfig() {
  const config = vscode.workspace.getConfiguration('streamsense');
  return {
    enabled: config.get('backendEnabled'),
    url: config.get('backendUrl'),
    apiKey: config.get('backendApiKey'), // nouvelle config
  };
}

function doRequest(url) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https://');
    const lib = isHttps ? https : http;

    const req = lib.get(url, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function fetchStreamsFromBackend() {
  const { enabled, url } = getBackendConfig();
  if (!enabled || !url) return null;

  try {
    const base = url.replace(/\/$/, '');
    const json = await doRequest(`${base}/streams`);
    return json.streams || [];
  } catch (err) {
    console.warn('[StreamSense] Erreur backend /streams:', err.message);
    return null;
  }
}

async function fetchDemoMetricsFromBackend() {
  const { enabled, url } = getBackendConfig();
  if (!enabled || !url) return null;

  try {
    const base = url.replace(/\/$/, '');
    const json = await doRequest(`${base}/metrics/demo`);
    return json.metrics || [];
  } catch (err) {
    console.warn('[StreamSense] Erreur backend /metrics/demo:', err.message);
    return null;
  }
}

module.exports = {
  fetchStreamsFromBackend,
  fetchDemoMetricsFromBackend,
};