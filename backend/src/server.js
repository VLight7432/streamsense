const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const { listStreams } = require('./services/streamsService');
const { getStripeClient } = require('./connectors/stripeClient');
const { licenseMiddleware } = require('./authMiddleware');

// Charger les variables d'environnement
dotenv.config();

// ── Logger minimal structuré ───────────────────────────────────────────────
function log(level, message, extra = {}) {
  const payload = { level, message, time: new Date().toISOString(), ...extra };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}
const info = (m, e) => log('info', m, e);
const warn = (m, e) => log('warn', m, e);
const error = (m, e) => log('error', m, e);

// ── Middleware de clé API backend ─────────────────────────────────────────
const REQUIRED_API_KEY = process.env.STREAMSENSE_API_KEY || null;

function apiKeyMiddleware(req, res, next) {
  if (!REQUIRED_API_KEY) return next();

  const key = req.headers['x-streamsense-key'];
  if (key !== REQUIRED_API_KEY) {
    warn('Unauthorized request', { path: req.path, ip: req.ip, ua: req.headers['user-agent'] });
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ── CORS : restreint aux origines autorisées ───────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:4000')
  .split(',').map(o => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    // Autoriser les requêtes sans origin (ex: extensions VS Code, curl)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(null, false); // Refuser sans lever d'exception (pas de stack trace exposée)
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'x-streamsense-key', 'x-streamsense-license', 'x-streamsense-apikey'],
}));

// ── Rate limiting global ───────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});
app.use(limiter);

// Rate limit strict pour le billing (évite le brute force)
const billingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'too_many_requests' },
});

app.use(express.json({ limit: '64kb' }));

// Endpoint de santé (public)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'streamsense-backend' });
});

// Profil de licence (dev/bêta permissif, prod strict selon authMiddleware)
app.get('/license/profile', licenseMiddleware, (req, res) => {
  const license = req.license || {};
  const plan = license.plan || 'free';
  const email = license.email || null;
  res.json({ plan, email, valid: !!license.valid, reason: license.reason || null });
});

// Espace /api/pro protégé par licence (pour tests / future prod)
app.use('/api/pro', licenseMiddleware);
app.get('/api/pro/metrics', (req, res) => {
  const { plan, email, features } = req.license || {};
  res.json({ ok: true, plan: plan || 'unknown', email: email || null, features: features || {} });
});

// Routes principales protégées par clé backend
app.use(['/streams', '/metrics/demo', '/billing/checkout'], apiKeyMiddleware);
app.use('/billing/checkout', billingLimiter);

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

// Billing (test) : créer une session Stripe Checkout
app.post('/billing/checkout', async (req, res) => {
  const stripe = getStripeClient();
  if (!stripe) {
    error('Stripe client not configured');
    return res.status(500).json({ error: 'stripe_not_configured' });
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  const successUrl = process.env.BILLING_SUCCESS_URL || 'http://localhost:3000/success';
  const cancelUrl = process.env.BILLING_CANCEL_URL || 'http://localhost:3000/cancel';

  if (!priceId) {
    warn('Stripe price id missing (STRIPE_PRICE_ID)');
    return res.status(500).json({ error: 'stripe_price_not_configured' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    info('Created Stripe checkout session', { sessionId: session.id });
    return res.json({ url: session.url, id: session.id });
  } catch (e) {
    error('Error in /billing/checkout', { err: e.message || String(e) });
    return res.status(500).json({ error: 'stripe_error' });
  }
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

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    error(`Port ${PORT} already in use. Kill the process with: lsof -ti:${PORT} | xargs kill -9`);
    process.exit(1);
  } else {
    throw err;
  }
});

server.listen(PORT, () => {
  info('StreamSense backend listening', { port: PORT, env: process.env.NODE_ENV || 'development' });
});
