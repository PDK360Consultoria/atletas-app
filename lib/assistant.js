const { secToPace, fmtClock, fmtDate } = require('./format');
const { summarizeIntervals } = require('./intervals');

// Builds a compact Portuguese context block describing the athlete, their
// goal, recent training and progress — sent as the system prompt so the
// coach can answer questions grounded in real data, never invented.
function buildContext(user, races, activities, evolution) {
  const upcoming = races.filter((r) => r.race_date && new Date(r.race_date) >= new Date());
  const recent = activities.slice(0, 12);

  const lines = [];
  lines.push(`Você é o Coach de Corrida do ${user.name.split(' ')[0]} dentro do app Atletas — não um "assistente", e sim o treinador pessoal dele(a), acompanhando a rotina de perto.`);
  lines.push('Responda SOMENTE com base nos dados reais fornecidos abaixo — nunca invente números, treinos ou provas que não estejam listados. Se não souber algo, diga que não tem esse dado.');
  lines.push('');
  lines.push('Estilo de resposta (siga à risca, isso é crítico):');
  lines.push('- Escreva como se estivesse mandando mensagem de WhatsApp/chat para o atleta: frases curtas, diretas, tom próximo e humano, português do Brasil.');
  lines.push('- NUNCA use markdown: nada de #, ##, **, *, listas com "-" ou numeradas, blocos de código. Apenas texto corrido, como uma pessoa digitando.');
  lines.push('- Respostas curtas por padrão: 2 a 5 frases. Só se estenda se o atleta pedir claramente mais detalhe ou um plano completo.');
  lines.push('- Não repita tudo que já foi dito na conversa. Vá direto ao ponto, como um treinador experiente que já conhece o histórico.');
  lines.push('');
  lines.push(`Atleta: ${user.name}${user.city ? `, ${user.city}` : ''}`);
  if (user.goal_race_name) lines.push(`Meta: ${user.goal_race_name}${user.goal_time_sec ? ` em ${fmtClock(user.goal_time_sec)}` : ''}`);
  if (user.bio) lines.push(`Bio: ${user.bio}`);

  if (upcoming.length) {
    lines.push('');
    lines.push('Próximas provas:');
    for (const r of upcoming) {
      lines.push(`- ${r.name}, ${fmtDate(r.race_date)}${r.distance_km ? `, ${r.distance_km}km` : ''}${r.goal_time_sec ? `, meta ${fmtClock(r.goal_time_sec)}` : ''}`);
    }
  }

  if (evolution && evolution.totalCount) {
    lines.push('');
    lines.push('Evolução geral:');
    lines.push(`- Total percorrido: ${evolution.totalKm.toFixed(0)}km em ${evolution.totalCount} treinos`);
    lines.push(`- Este mês: ${evolution.kmThisMonth.toFixed(1)}km (mês passado: ${evolution.kmLastMonth.toFixed(1)}km)`);
    lines.push(`- Ritmo médio geral: ${secToPace(evolution.avgPaceSec)}/km`);
    if (evolution.longest) lines.push(`- Maior distância: ${evolution.longest.distance_km}km ("${evolution.longest.title}")`);
    if (evolution.bestPace) lines.push(`- Melhor ritmo: ${secToPace(evolution.bestPace.avg_pace_sec)}/km ("${evolution.bestPace.title}")`);
    lines.push(`- Volume semanal (últimas 8 semanas, em km): ${evolution.weeks.map((w) => w.km.toFixed(0)).join(', ')}`);
  }

  if (recent.length) {
    lines.push('');
    lines.push('Últimos treinos:');
    for (const a of recent) {
      const parts = [fmtDate(a.started_at || a.created_at)];
      if (a.distance_km) parts.push(`${a.distance_km}km`);
      if (a.avg_pace_sec) parts.push(`${secToPace(a.avg_pace_sec)}/km`);
      if (a.avg_hr) parts.push(`FC ${a.avg_hr}bpm`);
      if (a.workout_type) parts.push(a.workout_type);
      lines.push(`- ${a.title}: ${parts.join(', ')}`);
    }
  } else {
    lines.push('');
    lines.push('Ainda não há treinos registrados.');
  }

  return lines.join('\n');
}

// Builds the extra context block prepended when the athlete is chatting from
// a specific activity's page ("conversar com o coach sobre esse treino") —
// pins that training's real data (and its interval structure, when it's a
// tiro workout) as the priority topic, on top of the general context.
function buildActivityFocusContext(activity, laps, intervals) {
  const summary = summarizeIntervals(intervals);
  const lines = [];
  lines.push('');
  lines.push('O atleta abriu esta conversa a partir da página de UM treino específico — priorize esse treino nas suas respostas, mesmo que ele pergunte algo mais geral:');
  lines.push(`Treino em foco: "${activity.title}" (${activity.workout_type || 'não especificado'}), ${fmtDate(activity.started_at || activity.created_at)}`);
  lines.push(`Distância: ${activity.distance_km ?? '—'}km · Duração: ${fmtClock(activity.duration_sec)} · Pace médio: ${secToPace(activity.avg_pace_sec)}/km`);
  if (activity.avg_hr) lines.push(`FC média: ${activity.avg_hr}bpm${activity.max_hr ? ` · FC máxima: ${activity.max_hr}bpm` : ''}`);

  if (summary) {
    lines.push(`Este treino foi um INTERVALADO/TIROS: ${summary.structureText}`);
    lines.push(`Pace médio nos tiros: ${secToPace(summary.avgPaceSec)}/km`);
    lines.push('Tiro a tiro:');
    for (const b of summary.bars) {
      lines.push(`- Tiro ${b.idx} (${b.distanceLabel}): ${secToPace(b.pace_sec)}/km${b.avg_hr ? `, FC ${b.avg_hr}bpm` : ''}${b.isFastest ? ' (mais rápido)' : ''}`);
    }
  } else if (laps && laps.length) {
    lines.push(`Splits por km: ${laps.map((l) => `km${l.km} ${secToPace(l.split_sec)}/km`).join(', ')}`);
  }

  if (activity.ai_analysis) {
    lines.push('');
    lines.push(`Análise técnica já gerada para este treino (use como base, não repita literalmente):\n${activity.ai_analysis}`);
  }

  return lines.join('\n');
}

// Streams the reply from the Anthropic API word-by-word, calling onDelta(text)
// for each chunk of text as it arrives, so the UI can type it out live like a
// real chat instead of blocking on the full response. Returns the full
// accumulated text once the stream ends. Uses the athlete's OWN API key
// (entered in Settings) — usage/billing stays on their own Anthropic account.
async function streamChatWithAssistant(apiKey, systemContext, history, userMessage, onDelta) {
  if (!apiKey) throw new Error('missing_api_key');

  const messages = [...history, { role: 'user', content: userMessage }];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: systemContext,
      messages,
      stream: true,
    }),
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data && data.error && data.error.message) msg = data.error.message;
    } catch (e) {}
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep the last (possibly partial) line for next round

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let evt;
      try { evt = JSON.parse(payload); } catch (e) { continue; }
      if (evt.type === 'content_block_delta' && evt.delta && typeof evt.delta.text === 'string') {
        full += evt.delta.text;
        if (onDelta) onDelta(evt.delta.text);
      } else if (evt.type === 'error' && evt.error) {
        throw new Error(evt.error.message || 'Erro no streaming.');
      }
    }
  }

  return full.trim() || '(sem resposta)';
}

module.exports = { buildContext, buildActivityFocusContext, streamChatWithAssistant };
