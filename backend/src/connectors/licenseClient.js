// backend/src/connectors/licenseClient.js

async function validateApiKey(apiKey) {
  if (!apiKey) {
    return { valid: false, reason: 'missing_api_key' };
  }

  const url = process.env.LICENSE_SERVICE_URL || 'https://stream-sense.org/api/validate-key';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });

  if (!res.ok) {
    throw new Error(`Licence server error: ${res.status}`);
  }

  const data = await res.json();
  // attendu: { valid, plan, email, features: {...} }
  return data;
}

module.exports = { validateApiKey };