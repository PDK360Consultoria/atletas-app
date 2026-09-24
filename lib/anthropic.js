const { secToPace, fmtClock } = require('./format');
const { summarizeIntervals } = require('./intervals');

// Calls the Anthropic API directly via fetch (no SDK package — none can be
// npm-installed in this environment). Uses the athlete's OWN API key, entered
// in Settings, so usage and billing are theirs — never a shared/platform key.
async function analyzeActivity(apiKey, activity, laps, intervals) {
  if (!apiKey) throw new Error('missing_api_key');

  const summary = summarizeIntervals(intervals);

  const header = `Treino: ${activity.title} (${activity.workout_type || 'não especificado'})
Distância: ${activity.distance_km} km
Duração: ${fmtClock(activity.duration_sec)}
Pace médio: ${secToPace(activity.avg_pace_sec)}/km
FC média: ${activity.avg_hr || 'não registrada'} bpm
FC máxima: ${activity.max_hr || 'não registrada'} bpm
Ganho de elevação: ${activity.elevation_gain_m || 0} m`;

  let prompt;

  if (summary) {
    // Interval/tiro workout: the whole analysis must be grounded in the
    // per-rep data, never in generic continuous-run pacing — that's exactly
    // what this branch exists to fix.
    const repsText = summary.bars
      .map((b) => `Tiro ${b.idx} (${b.distanceLabel}): ${secToPace(b.pace_sec)}/km, tempo ${fmtClock(b.moving_time_sec)}${b.avg_hr ? `, FC média ${b.avg_hr}bpm` : ''}${b.max_hr ? `, FC máx ${b.max_hr}bpm` : ''}${b.isFastest ? '  ← tiro mais rápido' : ''}`)
      .join('\n');

    prompt = `Você é um treinador técnico de corrida de elite, especialista em treinos intervalados (tiros) e em preparação para maratona. Este é um TREINO DE TIROS/INTERVALADO — analise a estrutura tiro a tiro abaixo, NUNCA como uma corrida contínua. Use SOMENTE os dados fornecidos — nunca invente números, sensações ou métricas. Quando um dado não existir, diga que não foi registrado em vez de estimar.

${header}

Estrutura do treino: ${summary.structureText}
Número de tiros: ${summary.count}
Tempo total nos tiros: ${summary.totalTimeLabel}
Pace médio nos tiros: ${secToPace(summary.avgPaceSec)}/km
FC média nos tiros: ${summary.avgHr || 'não registrada'} bpm
FC máxima nos tiros: ${summary.maxHr || 'não registrada'} bpm

Tiro a tiro:
${repsText}

Escreva uma análise técnica completa e bem estruturada em português (250 a 450 palavras), focada inteiramente na execução dos tiros. Formate a resposta EXATAMENTE assim, usando markdown simples (## para títulos de seção, - para listas, ** para destacar números/termos-chave), sem introduções nem despedidas:

## Resumo do treino
Um parágrafo curto contextualizando a estrutura do treino (quantos tiros, distâncias, o que ele representa no plano de maratona).

## Execução tiro a tiro
Como o pace variou de um tiro para o outro (consistência entre repetições da mesma distância, se houve queda de rendimento ao longo da série, qual foi o tiro mais rápido e o mais lento), citando os tiros relevantes.

## Resposta cardíaca
O que a FC média/máxima em cada bloco de tiros indica sobre o esforço e a recuperação entre repetições. Se não houver dado de FC, diga isso claramente e siga em frente.

## Pontos fortes
1 a 3 itens em lista do que funcionou bem nesta série de tiros.

## Atenção
1 a 3 itens em lista com riscos, sinais de fadiga ou desvios do esperado para esse tipo de treino intervalado.

## Recomendação para o próximo treino
Um parágrafo direto e acionável, específico para o objetivo de maratona sub-3:30, com uma sugestão concreta para a próxima sessão de tiros (distâncias, pace alvo, número de repetições, foco de recuperação, etc.).

Seja direto, técnico e sem enrolação. Não repita os números brutos sem interpretá-los.`;
  } else {
    const lapsText = (laps || [])
      .map((l) => `km ${l.km}: ${secToPace(l.split_sec)}/km${l.avg_hr ? `, FC média ${l.avg_hr}bpm` : ''}`)
      .join('\n');

    prompt = `Você é um treinador técnico de corrida de elite, especialista em fisiologia do esforço e em preparação para maratona. Analise ESTE treino em profundidade usando SOMENTE os dados abaixo — nunca invente números, sensações ou métricas que não estejam aqui. Quando um dado não existir, diga que não foi registrado em vez de estimar.

${header}

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
  }

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
