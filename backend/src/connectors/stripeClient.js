const Stripe = require('stripe');
const dotenv = require('dotenv');

dotenv.config();

let stripe = null;

function getStripeClient() {
  if (stripe) return stripe;

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    console.warn('[StreamSense] Stripe non configuré (STRIPE_SECRET_KEY manquant)');
    return null;
  }

  stripe = new Stripe(secretKey, {
    apiVersion: '2023-10-16',
  });

  return stripe;
}

module.exports = {
  getStripeClient,
};
