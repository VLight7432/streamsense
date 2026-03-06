# StreamSense Backend

Backend Node.js pour StreamSense : API HTTP (Express) + WebSocket, prêt pour une intégration avec Supabase/PostgreSQL et Stripe.

## Démarrage

```bash
npm install
npm run start
```

Par défaut, le serveur écoute sur `http://localhost:4000`.

- Endpoint de santé : `GET /health`
- WebSocket : `ws://localhost:4000`

Configurez les variables d’environnement dans un fichier `.env` à la racine :

```bash
PORT=4000
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
```
