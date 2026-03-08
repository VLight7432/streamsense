const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const dotenv = require('dotenv');
const { listStreams } = require('./services/streamsService');

// Charger les variables d'environnement
dotenv.config();

// ── Logger minimal structuré ───────────────────────────────────────────────
function log(level, message, extra = {}) {
  const payload = {
    level,
    message,
    time: new Date().toISOString(),
    ...extra,
  };
  // Pour l’instant, on reste sur console.log, mais au format JSON
  // pour être facilement exploitable par Azure / autres collecteurs.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}

function info(message, extra) { log('info', message, extra); }
function warn(message, extra) { log('warn', message, extra); }
function error(message, extra) { log('error', message, extra); }

// ── Middleware de clé API ─────────────────────────────────────────────────
const REQUIRED_API_KEY = process.env.STREAMSENSE_API_KEY || null;

function apiKeyMiddleware(req, res, next) {
  if (!REQUIRED_API_KEY) {
    // Si aucune clé n’est configurée, on laisse tout passer (mode dev/bêta).
    return next();
  }

  const key = req.headers['x-streamsense-key'];
  if (key !== REQUIRED_API_KEY) {
    warn('Unauthorized request', {
      path: req.path,
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
    return res.status(401).json({ error: 'unauthorized' });
  }

  return next();
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// Endpoint de santé (public)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'streamsense-backend' });
});

// Appliquer la clé API sur les routes suivantes
app.use(['/streams', '/metrics/demo'], apiKeyMiddleware);

// Route réelle : liste des streams depuis Supabase
app.get('/streams', async (req, res) => {
  try {
    const streams = await listStreams();
    info('Fetched streams', { count: streams.length });
    res.json({ streams });
  } catch (e) {
    error('Error in /streams', { err: e.message || String(e) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// Route de démo : métriques simulées pour la bêta
app.get('/metrics/demo', (req, res) => {
  const now = Date.now();

  const metrics = [
    {
      streamId: 'transactions',
      metric: 'transactions_per_second',
      unit: '/s',
      value: 400 + Math.round(Math.random() * 80),
      timestamp: new Date(now).toISOString(),
    },
    {
      streamId: 'errors',
      metric: 'error_rate',
      unit: '%',
      value: +(0.8 + Math.random() * 1.2).toFixed(2),
      timestamp: new Date(now).toISOString(),
    },
    {
      streamId: 'latency',
      metric: 'p95_latency',
      unit: 'ms',
      value: 160 + Math.round(Math.random() * 50),
      timestamp: new Date(now).toISOString(),
    },
  ];

  info('Served demo metrics', { count: metrics.length });
  res.json({ metrics });
});

// WebSocket basique pour la bêta (echo + logs)
wss.on('connection', (ws, req) => {
  info('WebSocket client connected', { ip: req.socket.remoteAddress });

  ws.on('message', (message) => {
    const text = message.toString();
    info('WS message received', { payload: text.slice(0, 200) });
    ws.send(JSON.stringify({ type: 'echo', payload: text }));
  });

  ws.on('error', (err) => {
    error('WebSocket error', { err: err.message || String(err) });
  });

  ws.on('close', () => {
    info('WebSocket client disconnected');
  });
});

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  info('StreamSense backend listening', { port: PORT, env: process.env.NODE_ENV || 'development' });
});
