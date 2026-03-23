'use strict';

const vscode = require('vscode');
const https = require('https');
const http = require('http');

function getBackendConfig() {
  const config = vscode.workspace.getConfiguration('streamsense');
  return {
    enabled: config.get('backendEnabled'),
    url: config.get('backendUrl'),
    apiKey: config.get('backendApiKey'),    // clé backend (STREAMSENSE_API_KEY)
    license: config.get('apiKey'),          // clé de licence produit (streamsense.apiKey)
  };
}

function doRequest(url) {
  const { apiKey, license } = getBackendConfig();

  // Validation de l'URL : uniquement http/https, pas de file:// ou autres protocoles
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return Promise.reject(new Error('Invalid backend URL'));
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return Promise.reject(new Error('Invalid backend URL protocol'));
  }

  return new Promise((resolve, reject) => {
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options = {
      headers: {},
    };

    if (apiKey) {
      options.headers['x-streamsense-key'] = apiKey;
    }
    if (license) {
      options.headers['x-streamsense-license'] = license;
    }

    const req = lib.get(url, options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
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

async function fetchLicenseProfile() {
  const { enabled, url } = getBackendConfig();
  if (!enabled || !url) return { plan: 'free', valid: false, email: null, reason: null };

  try {
    const base = url.replace(/\/$/, '');
    const json = await doRequest(`${base}/license/profile`);
    return {
      plan: json.plan || 'free',
      valid: !!json.valid,
      email: json.email || null,
      reason: json.reason || null,
    };
  } catch (err) {
    console.warn('[StreamSense] Erreur backend /license/profile:', err.message);
    return { plan: 'free', valid: false, email: null, reason: 'error' };
  }
}

module.exports = {
  fetchStreamsFromBackend,
  fetchDemoMetricsFromBackend,
  fetchLicenseProfile,
};