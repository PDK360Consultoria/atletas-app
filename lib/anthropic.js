const { secToPace, fmtClock } = require('./format');

// Calls the Anthropic API directly via fetch (no SDK package — none can be
// npm-installed in this environment). Uses the athlete's OWN API key, entered
// in Settings, so usage and billing are theirs — never a shared/platform key.
async function analyzeActivity(apiKey, activity, laps) {
  if (!apiKey) throw new Error('missing_api_key');

const lapsText = (laps || [])
  .map((l) => `km ${l.km}: ${secToPace(l.split_sec)}/km${l.avg_hr ? `, FC média ${l.avg_hr}bpm` : ''}`)
  .join('\n');

const prompt = `Você é um treinador técnico de corrida de elite, especialista em fisiologia do esforço e em preparação para maratona. Analise ESTE treino em profundidade usando SOMENTE os dados abaixo — nunca invente números, sensações ou métricas que não estejam aqui. Quando um dado não existir, diga que não foi registrado em vez de estimar.

Treino: ${activity.title} (${activity.workout_type || 'não especificado'})
Distância: ${activity.distance_km} km
Duração: ${fmtClock(activity.duration_sec)}
Pace médio: ${secToPace(activity.avg_pace_sec)}/km
FC média: ${activity.avg_hr || 'não registrada'} bpm
FC máxima: ${activity.max_hr || 'não registrada'} bpm
Ganho de elevação: ${activity.elevation_gain_m || 0} m

Splits por km:
${lapsText || '(sem splits detalhados)'}

Escreva uma análise técnica completa e bem estruturada em português (250 a 450 palavras). Formate a resposta EXATAMENTE assim, usando markdown simples (## para títulos de seção, - para listas, ** para destacar números/termos-chave), sem introduções nem despedidas:

## Resumo do treino
Um parágrafo curto contextualizando o treino (tipo, exigência, o que ele representa no plano de maratona).

## Pacing
Como o ritmo evoluiu km a km (consistência, negative/positive split, quedas ou picos), citando os splits relevantes.

## Resposta cardíaca
O que a FC média/máxima (se houver) indica sobre o esforço e a eficiência aeróbica. Se não houver dado de FC, diga isso claramente e siga em frente.

## Pontos fortes
1 a 3 itens em lista do que funcionou bem neste treino.

## Atenção
1 a 3 itens em lista com riscos, sinais de fadiga ou desvios do esperado para esse tipo de treino.

## Recomendação para o próximo treino
Um parágrafo direto e acionável, específico para o objetivo de maratona sub-3:30, com uma sugestão concreta (pace alvo, tipo de treino, foco de recuperação, etc.).

Seja direto, técnico e sem enrolação. Não repita os números brutos sem interpretá-los.`;

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-5',
    max_tokens: 3000,
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
