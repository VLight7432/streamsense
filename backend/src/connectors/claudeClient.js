const Anthropic = require('@anthropic-ai/sdk');

let client = null;

function getClaudeClient() {
  if (client) return client;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[StreamSense] Claude non configuré (ANTHROPIC_API_KEY manquant)');
    return null;
  }

  client = new Anthropic({ apiKey });
  return client;
}

module.exports = { getClaudeClient };
