# StreamSense for VS Code

> **Real-time anomaly detection for your data streams — directly in your editor.**

[![Version](https://img.shields.io/badge/version-0.1.3-00c8f0.svg)](https://marketplace.visualstudio.com/items?itemName=streamsense.streamsense)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## What is StreamSense?

StreamSense brings production data monitoring directly into your development workflow. Connect your databases, APIs, and services, and get instant AI-powered anomaly alerts without leaving VS Code.

**Key principle:** 15 minutes from install to first insight.

---

## Features

### 🔴 Live Data Streams
- Monitor 6+ key metrics simultaneously in real time
- Configurable refresh rate (default: 1s)
- Beautiful sparkline charts in the dashboard panel

### 🧠 AI-Powered Anomaly Detection
- **Z-Score algorithm** for spike detection (configurable threshold, default: 2.5σ)
- **CUSUM algorithm** for progressive drift detection
- AI analysis powered by Claude Sonnet: not just "something is wrong" but *why* and *what to do*

### 🔌 Data Source Connectors
- PostgreSQL, MySQL, MongoDB, Redis
- Kafka, AWS CloudWatch
- Stripe API, Shopify
- Google Analytics, Datadog
- Custom HTTP endpoints

### 📊 VS Code Native UI
- **Activity bar sidebar** with Sources, Alerts, and Metrics tree views
- **Webview Dashboard** with real-time charts (Cmd/Ctrl+Shift+S)
- **Status bar** showing live transaction rate and alert count
- **Native notifications** for critical anomalies

---

## Getting Started

### 1. Install the extension
```bash
ext install streamsense.streamsense
```

### 2. Open the dashboard
Press `Cmd+Shift+S` (Mac) or `Ctrl+Shift+S` (Windows/Linux), or click the StreamSense icon in the Activity Bar.

### 3. Choose your mode

#### Demo Mode (local only)
No configuration needed. StreamSense runs in **Demo Mode** automatically, simulating realistic e-commerce data streams so you can explore all features immediately.

#### Backend Mode (beta)
If you have access to a StreamSense backend (e.g. Azure App Service + Supabase):

Add this to your VS Code settings (JSON view):

```jsonc
{
  "streamsense.backendEnabled": true,
  "streamsense.backendUrl": "https://streamsense-backend.azurewebsites.net",
  "streamsense.backendApiKey": "your-backend-api-key"
}
```

- `backendEnabled` : active l’utilisation du backend au lieu du simulateur pur.
- `backendUrl` : URL de votre backend StreamSense (HTTP/HTTPS).
- `backendApiKey` : clé API envoyée dans l’en-tête `x-streamsense-key` pour protéger votre backend.

### 4. (Optionnel) Configurer votre API key IA

Pour l’analyse IA, ajoutez votre clé StreamSense/Claude dans les settings :

```jsonc
{
  "streamsense.apiKey": "sk-..."
}
```

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `streamsense.apiKey` | `""` | StreamSense / Claude API key for AI analysis |
| `streamsense.apiUrl` | `https://stream-sense.org/api` | Cloud API endpoint (future SaaS) |
| `streamsense.refreshInterval` | `2000` | Data refresh in ms (min: 500) |
| `streamsense.anomalyThreshold` | `2.5` | Z-score threshold (σ) |
| `streamsense.enableNotifications` | `true` | VS Code notifications for critical anomalies |
| `streamsense.enableStatusBar` | `true` | Status bar indicator |
| `streamsense.autoConnect` | `true` | Auto-connect on startup |
| `streamsense.backendEnabled` | `false` | Enable local/remote backend instead of pure demo mode |
| `streamsense.backendUrl` | `http://localhost:4000` | Backend URL (local dev or deployed, e.g. Azure App Service) |
| `streamsense.backendApiKey` | `""` | Optional backend API key sent as `x-streamsense-key` |

---

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| `StreamSense: Open Dashboard` | `Ctrl+Shift+S` | Open main webview dashboard |
| `StreamSense: Connect Data Source` | — | Add a new data source |
| `StreamSense: Analyze with AI` | — | Trigger Claude AI analysis |
| `StreamSense: Pause/Resume Stream` | — | Toggle data streaming |
| `StreamSense: Clear All Alerts` | — | Clear the alert history |

---

## Demo Mode

No data source? No problem. StreamSense runs in **Demo Mode** automatically, simulating realistic e-commerce data streams so you can explore all features immediately.

Use the **Anomaly Simulator** in the dashboard to inject artificial anomalies and see detection in action.

---

## Privacy & Security

- All data processing happens **locally** by default
- When `backendEnabled` is `true`, only the data needed for metrics/alerts is sent to **your** backend URL
- Backend requests can be protected with `x-streamsense-key` (see `streamsense.backendApiKey`)
- API keys are stored in VS Code's secure secret storage when possible
- No telemetry or data collection without explicit consent
- GDPR compliant — your data never leaves your infrastructure / backend

---

## Roadmap

- [ ] v0.2: Webhook alerts (Slack, email)
- [ ] v0.3: Custom alert rules (natural language)  
- [ ] v0.4: Historical data visualization
- [ ] v0.5: Team sharing & collaborative monitoring
- [ ] v1.0: Full StreamSense platform integration

---

## Contributing

StreamSense is in **private beta**. [Join the waitlist](https://stream-sense.org) to get early access and influence the roadmap.

Bug reports and feature requests: [GitHub Issues](https://github.com/VLight7432/streamsense/issues)

---

## License

MIT © 2026 StreamSense

---

*Built with ❤️ for developers who care about their data.*
