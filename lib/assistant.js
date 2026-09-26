const { secToPace, fmtClock, fmtDate } = require('./format');
const { summarizeIntervals } = require('./intervals');

// Classifies where the athlete sits in the run-up to their target race, in
// plain training-load terms (never named to the athlete, and never as a
// citation) — purely so the model's reasoning about volume/intensity/
// recovery trade-offs matches where they actually are in the buildup,
// instead of giving generic advice that ignores the calendar.
function racePhaseNote(weeksOut) {
  if (weeksOut == null) return null;
  if (weeksOut > 16) return 'Fase atual: base aeróbica — foco em consolidar volume e regularidade, intensidade ainda secundária.';
  if (weeksOut > 8) return 'Fase atual: desenvolvimento — é hora de ganhar qualidade (ritmo de prova, tiros, longões progressivos) em cima da base já construída.';
  if (weeksOut > 3) return 'Fase atual: específica/pico — os estímulos mais importantes da preparação acontecem agora (longões mais longos, blocos em ritmo de prova); a recuperação entre eles importa tanto quanto o estímulo.';
  if (weeksOut > 1) return 'Fase atual: polimento final — volume deve estar caindo, intensidade pontual se mantém, o objetivo é chegar descansado e não fazer nada novo ou arriscado.';
  return 'Fase atual: semana da prova — só afinar, sem cargas novas; o trabalho pesado já foi feito.';
}

// Reads the last N weekly-volume points (already computed by computeEvolution)
// and flags an unusually large jump in the most recent week vs. its own
// trailing average, so the coach's reasoning about fadiga/recuperação is
// grounded in the athlete's actual recent pattern instead of generic caution.
function loadTrendNote(weeks) {
  if (!weeks || weeks.length < 3) return null;
  const last = weeks[weeks.length - 1].km;
  const prior = weeks.slice(0, -1);
  const priorAvg = prior.reduce((s, w) => s + w.km, 0) / prior.length;
  if (!priorAvg) return null;
  const ratio = last / priorAvg;
  if (ratio >= 1.35) return `Sinal de carga: a última semana (${last.toFixed(0)}km) ficou bem acima da média das anteriores (${priorAvg.toFixed(0)}km) — vale considerar recuperação antes de somar mais volume.`;
  if (ratio <= 0.55 && last > 0) return `Sinal de carga: a última semana (${last.toFixed(0)}km) caiu bastante frente à média anterior (${priorAvg.toFixed(0)}km) — pode ser polimento planejado ou pode ser um sinal de queda de rotina, vale entender o motivo antes de comentar.`;
  return null;
}

// Builds a compact Portuguese context block describing the athlete, their
// goal, recent training and progress — sent as the system prompt so the
// coach can answer questions grounded in real data, never invented. The
// persona/style rules below encode Felipe's brief for a chat that reads as
// a real human treinador texting on WhatsApp, not an "assistente de IA":
// individual, never generic, never markdown/emoji, always validating the
// athlete before explaining anything technical, and always closing with a
// concrete next step plus a human sign-off — with the technical reasoning
// silently grounded in periodização esportiva (blocos de carga, relação
// estímulo x recuperação, progressão de volume/intensidade por mesociclo)
// without ever naming a method, author or book to the athlete.
function buildContext(user, races, activities, evolution) {
  const now = new Date();
  const upcoming = races
    .filter((r) => r.race_date && new Date(r.race_date) >= now)
    .sort((a, b) => new Date(a.race_date) - new Date(b.race_date));
  const goalRace = upcoming[0] || null;
  const weeksOut = goalRace ? (new Date(goalRace.race_date) - now) / (1000 * 60 * 60 * 24 * 7) : null;
  const recent = activities.slice(0, 30);

  const firstName = user.name.split(' ')[0];
  const lines = [];

  lines.push(`Você é o treinador de corrida pessoal do ${firstName} dentro do app Atletas. Você NÃO é um assistente, chatbot ou IA — você é o coach dele(a), conversando por chat como faria com qualquer atleta que acompanha de perto. Nunca diga que é uma inteligência artificial, um modelo de linguagem ou um "assistente"; nunca peça desculpas por "ser uma IA"; nunca fale sobre limitações técnicas suas.`);
  lines.push('Responda SEMPRE com base nos dados reais fornecidos abaixo — nunca invente número, treino, prova ou sensação que o atleta não tenha te contado. Se faltar um dado para responder com segurança, pergunte antes de supor.');
  lines.push('');
  lines.push('Regras de estilo (invioláveis):');
  lines.push('1. Escreva como mensagem de WhatsApp: frases curtas, diretas, tom próximo, português do Brasil coloquial (sem ser vulgar). Nunca soe institucional, genérico ou como texto de manual.');
  lines.push('2. NUNCA use markdown (#, **, listas com "-" ou números, blocos de código) e NUNCA use emoji. Só texto corrido, como alguém digitando de verdade.');
  lines.push('3. Respostas curtas por padrão (2 a 5 frases). Só se estenda se o atleta pedir claramente mais detalhe ou um plano completo — e mesmo assim, sem virar bula técnica.');
  lines.push('4. Se a mensagem do atleta vier incompleta, vaga ou sem contexto suficiente (por exemplo, "como foi meu treino?" sem dizer qual, ou uma dúvida que depende de algo que ele não disse), faça uma pergunta curta de esclarecimento antes de responder — não tente adivinhar.');
  lines.push('5. Nunca repita tudo que já foi dito na conversa nem liste de volta os dados que você recebeu — use-os para embasar a resposta, mas fale como quem já sabe disso de cor.');
  lines.push('6. Toda explicação técnica precisa fazer sentido dentro da lógica de periodização do treinamento (blocos de carga, equilíbrio entre estímulo e recuperação, progressão de volume e intensidade conforme a proximidade da prova) — mas isso é raciocínio seu, nunca cite método, autor, livro ou termo técnico de literatura esportiva para o atleta. Explique sempre em linguagem simples, como um treinador de carne e osso explicaria.');
  lines.push('');
  lines.push('Estrutura da resposta (siga essa ordem sempre que a mensagem pedir uma orientação real, não só um "oi"):');
  lines.push('- Uma saudação breve e humana (nada de "Olá! Como posso ajudar?").');
  lines.push('- Validação individual: reconheça o que o atleta disse ou sentiu antes de mais nada, do jeito que um treinador que se importa faria.');
  lines.push('- Explicação técnica em linguagem simples, conectando com o que os dados dele mostram.');
  lines.push('- Orientação prática e concreta do próximo passo (o que fazer agora, no próximo treino, ou até a prova).');
  lines.push('- Um fechamento humano e próximo (uma frase curta de incentivo ou combinado, não um "qualquer dúvida estou à disposição").');
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

  if (weeksOut != null) {
    lines.push('');
    lines.push(`Faltam ${weeksOut.toFixed(1)} semanas para a prova-alvo (${goalRace.name}). ${racePhaseNote(weeksOut)}`);
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
    const trend = loadTrendNote(evolution.weeks);
    if (trend) lines.push(`- ${trend}`);
  }

  if (recent.length) {
    lines.push('');
    lines.push(`Últimos treinos (${recent.length}, do mais recente ao mais antigo):`);
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

// A real coach never answers a WhatsApp message the instant it lands — there's
// always a beat of "lendo, pensando". Returns a small randomized delay (ms) to
// hold before the reply starts streaming, scaled a bit by message length so a
// longer question feels like it got a longer read, capped so it never feels
// like the app hung.
function computeHumanDelayMs(messageLength) {
  const base = 900 + Math.random() * 1200;
  const lengthBonus = Math.min(1200, (messageLength || 0) * 6);
  return Math.round(base + lengthBonus);
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

module.exports = { buildContext, buildActivityFocusContext, streamChatWithAssistant, computeHumanDelayMs };
