const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const dotenv = require('dotenv');
const { listStreams } = require('./services/streamsService');

// Charger les variables d'environnement
dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// Endpoint de santé
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'streamsense-backend' });
});

// Route réelle : liste des streams depuis Supabase
app.get('/streams', async (req, res) => {
  try {
    const streams = await listStreams();
    res.json({ items: streams });
  } catch (err) {
    console.error('[StreamSense] Erreur GET /streams:', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// WebSocket basique
wss.on('connection', (ws) => {
  console.log('Client WebSocket connecté');

  ws.on('message', (message) => {
    console.log('Message reçu:', message.toString());
    // Echo simple pour l’instant
    ws.send(JSON.stringify({ type: 'echo', payload: message.toString() }));
  });

  ws.on('close', () => {
    console.log('Client WebSocket déconnecté');
  });
});

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`StreamSense backend listening on http://localhost:${PORT}`);
});
