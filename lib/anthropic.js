const { secToPace, fmtClock } = require('./format');

// Calls the Anthropic API directly via fetch (no SDK package — none can be
// npm-installed in this environment). Uses the athlete's OWN API key, entered
// in Settings, so usage and billing are theirs — never a shared/platform key.
async function analyzeActivity(apiKey, activity, laps) {
  if (!apiKey) throw new Error('missing_api_key');

  const lapsText = (laps || [])
    .map((l) => `km ${l.km}: ${secToPace(l.split_sec)}/km${l.avg_hr ? `, FC média ${l.avg_hr}bpm` : ''}`)
    .join('\n');

  const prompt = `Você é um treinador técnico de corrida. Analise ESTE treino usando SOMENTE os dados abaixo — nunca invente números que não estejam aqui.

Treino: ${activity.title} (${activity.workout_type || 'não especificado'})
Distância: ${activity.distance_km} km
Duração: ${fmtClock(activity.duration_sec)}
Pace médio: ${secToPace(activity.avg_pace_sec)}/km
FC média: ${activity.avg_hr || 'não registrada'} bpm
FC máxima: ${activity.max_hr || 'não registrada'} bpm
Ganho de elevação: ${activity.elevation_gain_m || 0} m

Splits por km:
${lapsText || '(sem splits detalhados)'}

Escreva uma análise curta e técnica (máximo 180 palavras, em português) cobrindo: 1) o que os dados mostram sobre o pacing, 2) a resposta cardíaca (se houver dado), 3) um ponto de atenção ou recomendação concreta para o próximo treino. Seja direto, sem enrolação, sem inventar métricas que não foram dadas.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  const text = (data.content || []).map((b) => b.text || '').join('').trim();
  return text || '(sem resposta)';
}

module.exports = { analyzeActivity };
