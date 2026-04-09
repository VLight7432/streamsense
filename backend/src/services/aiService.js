const { getClaudeClient } = require('../connectors/claudeClient');

const MODEL      = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `Tu es un expert en monitoring de systèmes de production en temps réel.
Tu reçois des métriques enrichies (valeur courante, Z-score, tendance par régression linéaire, statistiques sur 60 secondes) et tu produis une analyse opérationnelle précise.

Règles :
- Réponds en français professionnel, sans bullet points, en 3-4 phrases maximum.
- Si aucune anomalie : confirme la stabilité et signale toute tendance préoccupante.
- Si anomalie : identifie la métrique la plus critique, propose une cause probable et une action immédiate.
- Utilise les Z-scores pour qualifier la sévérité (>2σ = warning, >3σ = critique).
- Utilise la tendance (hausse/baisse/stable + %) pour contextualiser l'évolution.
- Ne répète pas les chiffres bruts si ce n'est pas utile — priorise l'interprétation.`;

function severityLabel(zscore) {
  if (zscore >= 3)   return 'CRITIQUE';
  if (zscore >= 2)   return 'WARNING';
  if (zscore >= 1.5) return 'Élevé';
  return 'Normal';
}

function buildMetricsBlock(metrics) {
  return metrics.map(m => {
    const trend    = m.trend   || { direction: 'stable', changePct: 0 };
    const s        = m.stats   || {};
    const severity = severityLabel(m.zscore || 0);
    const anomalyTag = m.anomaly ? ' ⚠ ANOMALIE' : '';

    return [
      `● ${m.label}${anomalyTag}`,
      `  Valeur actuelle : ${m.current.toFixed(1)}${m.unit}`,
      `  Z-score : ${(m.zscore || 0).toFixed(2)}σ — ${severity}`,
      `  Tendance (60s) : ${trend.direction}${Math.abs(trend.changePct) > 0 ? ` (${trend.changePct > 0 ? '+' : ''}${trend.changePct}%)` : ''}`,
      s.avg !== undefined
        ? `  Stats (60s) : moy=${s.avg}${m.unit}  min=${s.min}${m.unit}  max=${s.max}${m.unit}  σ=${s.stddev}`
        : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

/**
 * @param {{ metrics: Array<{label, current, unit, anomaly, zscore, trend, stats}>, alerts: string[] }} payload
 * @returns {Promise<string>}
 */
async function analyzeMetrics({ metrics, alerts }) {
  const claude = getClaudeClient();
  if (!claude) throw new Error('claude_not_configured');

  const anomalies   = metrics.filter(m => m.anomaly);
  const hasAnomaly  = anomalies.length > 0;
  const alertsBlock = alerts.length > 0
    ? `ALERTES ACTIVES (${alerts.length}) :\n${alerts.map(a => `  – ${a}`).join('\n')}`
    : 'ALERTES : aucune';

  const userContent = `SNAPSHOT SYSTÈME — ${new Date().toISOString()}

${buildMetricsBlock(metrics)}

${alertsBlock}

${hasAnomaly
  ? `FOCUS ANOMALIES : ${anomalies.map(m => `${m.label} (z=${(m.zscore || 0).toFixed(2)}σ)`).join(', ')}`
  : 'Aucune anomalie détectée sur ce snapshot.'}

Analyse :`;

  const message = await claude.messages.create({
    model:      MODEL,
    max_tokens: MAX_TOKENS,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userContent }],
  });

  return message.content[0]?.text || 'Analyse indisponible.';
}

module.exports = { analyzeMetrics };
