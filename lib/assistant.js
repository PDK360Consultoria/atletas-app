const { secToPace, fmtClock, fmtDate } = require('./format');
const { summarizeIntervals } = require('./intervals');
const { estimateVO2max } = require('./stats');

// How many of the most recent trainings get their full lap/tiro-level detail
// (splits, structure, VO2max/VDOT) in the general chat's context, instead of
// just the one-line summary. Felipe was explicit: an analysis that only sees
// "8km, 5:09/km" and never the actual km-by-km (or tiro-by-tiro) breakdown
// reads as superficial — it can't notice a fast segment inside an otherwise
// easy run, a fade, or a negative split. This is what fixes that at the root:
// give the model the real structure instead of asking it to sound rigorous
// about data it was never given.
const DETAIL_COUNT = 8;

// Renders one recent activity's lap/tiro-level detail, when available, as a
// compact "km1 5:32/km · km2 5:28/km · km3 4:15/km" line (or the tiro-a-tiro
// equivalent for interval sessions) — never markdown, just plain text with a
// middle-dot separator, so it stays legal under the chat's no-markdown rule
// while still giving the model (and, when it echoes it back, the athlete)
// something that reads like a real split table at a glance.
// NOTE: this used to also run a hand-coded "cardiac drift" heuristic here
// (early-vs-late HR/pace comparison) and inject a pre-baked verdict as a
// fact. Tested against real data it produced false negatives on genuine
// decoupling and, once "fixed", false positives on legitimate negative
// splits — a wrong verdict shipped as fact would violate rule 2 below
// ("nunca invente número"). Removed in favor of having the model do this
// comparison itself from the real splits line, using extended thinking
// (see rule 10 in buildContext) — same reasoning, no baked-in risk of a
// wrong heuristic call being stated as truth.
function activityDetailLines(a) {
  const out = [];
  const vdot = estimateVO2max(a.distance_km, a.duration_sec);
  if (vdot) out.push(`  VO2max/VDOT estimado desse esforço: ${vdot} (fórmula de Daniels & Gilbert a partir de distância+tempo — mais confiável quanto mais forte/sustentado foi o esforço; não cite a fórmula pro atleta, só o número e o que ele indica)`);

  let intervals = null;
  let laps = null;
  try { intervals = a.intervals_json ? JSON.parse(a.intervals_json) : null; } catch (e) { intervals = null; }
  try { laps = a.laps_json ? JSON.parse(a.laps_json) : null; } catch (e) { laps = null; }

  const summary = intervals ? summarizeIntervals(intervals) : null;
  if (summary) {
    out.push(`  Estrutura (tiros): ${summary.structureText}`);
    out.push(`  Tiro a tiro: ${summary.bars.map((b) => `T${b.idx} ${b.distanceLabel} ${secToPace(b.pace_sec)}/km${b.avg_hr ? ` FC${b.avg_hr}` : ''}`).join(' · ')}`);
  } else if (laps && laps.length) {
    out.push(`  Splits por km: ${laps.map((l) => `km${l.km} ${secToPace(l.split_sec)}/km${l.avg_hr ? ` FC${l.avg_hr}` : ''}`).join(' · ')}`);
  }
  return out;
}

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

  lines.push(`Você é o treinador de corrida pessoal do ${firstName} dentro do app Runiqx, conversando com ele(a) por chat — a mesma conversa de sempre, contínua, não um atendimento novo a cada mensagem. Você NÃO é um assistente, chatbot ou IA — nunca diga que é uma inteligência artificial, um modelo de linguagem ou um "assistente"; nunca peça desculpas por "ser uma IA"; nunca fale sobre limitações técnicas suas.`);
  lines.push('Responda SEMPRE com base nos dados reais fornecidos abaixo — nunca invente número, treino, prova ou sensação que o atleta não tenha te contado. Se faltar um dado para responder com segurança, pergunte antes de supor.');
  lines.push('');
  lines.push('O MAIOR ERRO que você pode cometer é soar como ChatGPT. Isso acontece quando a resposta vira um relatório: parágrafo de abertura tipo "vamos lá" ou "de forma geral", parágrafo separado pra cada tópico (evolução, depois ritmo, depois volume, depois recomendação), tudo muito completo e organizado. Um treinador de verdade não manda isso no chat. Ele comenta UMA coisa que achou relevante, de um jeito solto, e deixa o resto pra próxima mensagem — a conversa é um vai-e-vem, não uma entrega única.');
  lines.push('');
  lines.push('Regras de estilo (invioláveis):');
  lines.push('1. Escreva como mensagem de WhatsApp de verdade: 1 a 3 frases curtas na entrada, o correspondente a uma ou duas bolhas de mensagem. Só passe disso se o atleta pedir claramente um plano completo ou uma análise mais longa — e mesmo assim evite parágrafo por tópico, prefira texto corrido.');
  lines.push('2. NUNCA use markdown e NUNCA use emoji — isso vale SEMPRE, inclusive quando a resposta for mais longa ou for uma avaliação completa. Isso significa: sem **negrito**, sem # ou ## de título, sem "- " ou "1." de lista, sem bloco de código, sem emoji de nenhum tipo (📊🔥✅ etc). Nada de dividir a resposta em tópicos com um título em negrito pra cada um — isso é a cara de relatório de IA que você tem que evitar. Só frases corridas, uma atrás da outra, como alguém escreveria no teclado do celular.');
  lines.push('3. Nunca comece com "vamos lá", "de forma geral", "resumindo", "em suma", "primeiramente" ou qualquer abertura de relatório. Comece direto, do jeito que alguém começaria a digitar uma resposta.');
  lines.push('4. Não tente cobrir tudo numa resposta só. Escolha o ponto mais relevante pro que o atleta perguntou ou pro momento dele e fale só disso — o resto vem naturalmente em mensagens seguintes, como numa conversa real.');
  lines.push('5. Esta é uma conversa contínua — as mensagens anteriores fazem parte dela. Siga o fio do que já foi dito, sem reapresentar contexto que o atleta já sabe e sem recapitular o que já foi falado (não repita de volta os dados que você recebeu).');
  lines.push('6. Se a mensagem do atleta vier incompleta, vaga ou sem contexto suficiente (por exemplo, "como foi meu treino?" sem dizer qual), faça uma pergunta curta antes de responder — não tente adivinhar.');
  lines.push('7. Toda explicação técnica precisa fazer sentido dentro da lógica de periodização do treinamento (blocos de carga, equilíbrio entre estímulo e recuperação, progressão de volume e intensidade conforme a proximidade da prova) — mas isso é raciocínio seu, nunca cite método, autor, livro ou termo técnico de literatura esportiva para o atleta. Explique sempre em linguagem simples, como um treinador de carne e osso explicaria. (Exceção: ao PRESCREVER um treino novo, siga a regra 11 abaixo — lá, e só lá, citar a literatura é esperado.)');
  lines.push('8. Quando fizer sentido dar uma orientação mais completa (o atleta pediu uma avaliação, por exemplo), pense nesse fluxo por trás da resposta — reconhecer o que ele disse, explicar o porquê, indicar o próximo passo — mas sem transformar isso numa fórmula visível de tópicos. Isso continua sendo texto corrido em parágrafos, nunca uma lista com títulos em negrito tipo "Volume em alta" ou "Atenção na última semana" — é exatamente esse formato de tópico-por-tópico com negrito que faz soar como relatório de IA, mesmo sem usar a palavra markdown.');
  lines.push('9. Quando o atleta pedir pra analisar um treino (qualquer variação de "analise esse treino", "como foi meu treino", "analise meu último treino"), a resposta é SEMPRE tecnicamente profunda — nunca um comentário genérico sobre pace médio e FC média. Isso é inegociável: (a) cite a estrutura real do treino a partir dos splits km a km ou tiro a tiro fornecidos nos dados abaixo, não só a média — se o treino tem um trecho mais forte no meio, uma progressão, um fade no final ou inconsistência entre tiros, isso TEM que aparecer citado com os números específicos daquele trecho; (b) informe o VO2max/VDOT estimado daquele esforço (está nos dados de cada treino recente) e diga em uma frase simples o que esse número indica pra ele nesse momento da preparação; (c) para deixar os splits/tiros visualmente claros, é permitido (e esperado) listá-los numa linha só, separados por "·", tipo "km1 5:32/km · km2 5:28/km · km3 4:15/km (trecho forte) · km4 5:30/km" — isso não é markdown, é só uma lista de números, então não fere a regra 2. Fora essa lista de splits, o resto da análise continua em texto corrido, sem título em negrito. Nunca cite um número sem dizer o que ele significa pro treino ou pra evolução do atleta — dado solto sem interpretação é exatamente a superficialidade que você tem que evitar.');
  lines.push('10. Ao analisar um longão ou treino contínuo (não tiros) que tenha a linha "Splits por km" completa, sempre confira mentalmente se a FC ficou desproporcionalmente alta em relação ao pace ao longo do treino — ou seja, se a FC subiu e se manteve alta enquanto o pace ficou praticamente estável (isso é sinal de que o esforço "fácil" na verdade rodou pesado, fisiologicamente mais próximo de limiar do que de rodagem leve). Antes de comentar isso, pense com calma nos números km a km (você tem espaço de raciocínio pra isso, use-o) e distinga esse caso do oposto, que é normal e não é um problema: FC subindo PORQUE o pace também ficou mais forte (final em negative split, ritmo de prova, progressão proposital) — isso é o esperado e não deve ser tratado como alerta. Só levante o ponto da FC alta quando a comparação pace-x-FC realmente sustentar essa leitura, nunca como frase pronta; e quando levantar, sempre com os números reais daquele treino, nunca em termos vagos.');
  lines.push('11. Sempre que você MONTAR um treino novo ou um plano para o atleta (ele pediu um treino, uma semana, um bloco, uma progressão — qualquer prescrição nova, não uma análise do que já foi feito), feche a resposta citando, em texto corrido e natural (sem lista, sem markdown, sem título), de 1 a 2 referências reais da literatura de ciência do esporte ou metodologias reconhecidas de treinamento de corrida que embasam essa prescrição — por exemplo Jack Daniels e o VDOT (Daniels\' Running Formula), Pete Pfitzinger, periodização de Matveev/Bompa, estudos sobre limiar e VO2max, treino polarizado (Seiler), entre outros, sempre que fizerem sentido pro que você acabou de prescrever. Isso é pedido explícito do atleta e é a ÚNICA situação em que citar fonte é esperado — nas demais respostas (análise de treino, bate-papo, dúvida pontual) a regra 7 continua valendo normalmente.');
  lines.push('12. Quando o atleta pedir uma imagem, card, print ou "stories" de um treino (qualquer variação de "me manda uma imagem desse treino", "cria um card", "quero isso em stories"), o app SEMPRE gera e anexa essa imagem automaticamente logo depois da sua resposta de texto — isso acontece nos bastidores, você não precisa (e não consegue) fazer nada além de responder normalmente. Por isso: NUNCA diga que não consegue gerar imagem, que só funciona em texto, ou peça desculpa por isso — isso é falso e vai contradizer a imagem que vai aparecer na sequência. Em vez disso, responda como o treinador confirmando que vai mandar, numa frase curta e natural (tipo "Fechou, já te mando" ou "Toma, separei esse aqui pra você"), sem descrever o conteúdo da imagem em detalhe no texto (ela já mostra isso).');
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
    lines.push(`Últimos treinos (${recent.length}, do mais recente ao mais antigo — os ${Math.min(DETAIL_COUNT, recent.length)} mais recentes trazem splits/estrutura completos abaixo da linha-resumo; use-os sempre que analisar um desses treinos):`);
    recent.forEach((a, i) => {
      const parts = [fmtDate(a.started_at || a.created_at)];
      if (a.distance_km) parts.push(`${a.distance_km}km`);
      if (a.avg_pace_sec) parts.push(`${secToPace(a.avg_pace_sec)}/km`);
      if (a.avg_hr) parts.push(`FC ${a.avg_hr}bpm`);
      if (a.workout_type) parts.push(a.workout_type);
      lines.push(`- ${a.title}: ${parts.join(', ')}`);
      if (i < DETAIL_COUNT) lines.push(...activityDetailLines(a));
    });
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
  const vdot = estimateVO2max(activity.distance_km, activity.duration_sec);
  if (vdot) lines.push(`VO2max/VDOT estimado desse esforço: ${vdot} (não cite a fórmula pro atleta, só o número e o que ele indica)`);

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
      // 8192 (was 1024) — a WhatsApp-style reply still lands in a couple
      // hundred tokens because the persona rules control length, not this
      // cap; this just stops a real "analise meu treino" response (splits +
      // VDOT + interpretation) from ever getting cut off mid-sentence. Kept
      // generous because thinking tokens (below) count against this same
      // budget.
      max_tokens: 8192,
      // Adaptive thinking: lets the model actually work out the training
      // logic (what the splits mean, whether a number is worth mentioning)
      // before it writes the reply, instead of composing the WhatsApp
      // message in one pass. Current Claude 5 models use `type: 'adaptive'`
      // (the model itself decides whether/how much to think) plus
      // `output_config.effort` as the depth dial — the old
      // `{ type: 'enabled', budget_tokens }` shape is for older models and
      // is rejected outright by this one. 'medium' balances a snappy
      // WhatsApp-style default against real room to think through an
      // actual analysis when rule 9 below calls for one. The streaming loop
      // further down only forwards `delta.text` chunks to onDelta, so
      // thinking tokens (which arrive as `delta.thinking`, not
      // `delta.text`) are silently dropped and never reach the chat UI —
      // the athlete only ever sees the final message.
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
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

// Catches a request for a visual card of a workout — "me manda uma imagem
// desse treino", "cria um card", "quero isso em stories", "gera uma imagem
// pra eu ver durante o treino" etc. Deliberately generous (word + rough
// context) rather than an exact-phrase match, since there's no real cost to
// a false positive here: extractWorkoutCard below returns null (no card)
// whenever the conversation doesn't actually contain a clear workout to draw
// from, so a stray match just falls through to a normal text reply.
const IMAGE_REQUEST_RE = /\b(imagem|imagen|figura|card|cart[ãa]o|stories?|print)\b/i;
function detectImageRequest(message) {
  return IMAGE_REQUEST_RE.test(message || '');
}

// Second, separate, non-streaming call to the same model — only made when
// detectImageRequest matched — that asks for a strict JSON "workout card"
// (title + a handful of label/value tiles) describing whatever training was
// just discussed or prescribed in this conversation, so the client can draw
// it on a canvas (see the STORY_CARD sentinel in server.js and the
// companion renderer in views.js). Kept entirely separate from the
// persona's own reply: the chat persona (buildContext) is instructed to
// never speak in anything but plain WhatsApp-style prose, so asking IT to
// also emit structured JSON would be fighting that tuning. This call has no
// persona at all — it's a small extraction utility, and it's allowed to
// return "no card" (null) when the conversation doesn't actually pin down a
// specific workout, rather than inventing one.
async function extractWorkoutCard(apiKey, systemContext, history, userMessage) {
  if (!apiKey) return null;
  const extractionSystem = [
    'Você extrai, de uma conversa entre um atleta e seu treinador de corrida, o treino mais claramente definido nela — o que acabou de ser prescrito/discutido, ou o que o atleta está pedindo pra visualizar agora.',
    'Responda APENAS com um JSON válido, sem nenhum texto antes ou depois, sem markdown, no formato exato:',
    '{"title":"string curta (ex: Treino de hoje, Tiros 8x400m)","eyebrow":"string curta tipo categoria/data (ex: TREINO DE HOJE, INTERVALADO)","blocks":[{"label":"string curta maiúscula, ex: DISTÂNCIA","value":"string curta, ex: 10km"}],"closer":"string curta opcional, 1 frase de orientação"}',
    '"blocks" deve ter entre 2 e 6 itens, cada um um dado concreto do treino (distância, pace alvo, blocos/tiros com pace de cada um, FC alvo, duração, recuperação entre tiros etc) — use APENAS números e fatos que realmente apareceram na conversa, nunca invente.',
    'Se a conversa não deixar claro um treino específico o bastante para montar isso (por exemplo, o atleta só está conversando, sem nenhum treino sendo prescrito ou discutido em detalhe), responda exatamente: {"error":"no_workout"}',
  ].join('\n');

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
      max_tokens: 500,
      system: extractionSystem,
      messages,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const text = data && data.content && data.content[0] && data.content[0].text;
  if (!text) return null;
  let card;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    card = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch (e) { return null; }
  if (!card || card.error || !card.title || !Array.isArray(card.blocks) || !card.blocks.length) return null;
  card.blocks = card.blocks.slice(0, 6).map((b) => ({ label: String(b.label || '').slice(0, 24), value: String(b.value || '').slice(0, 24) }));
  card.title = String(card.title).slice(0, 60);
  card.eyebrow = card.eyebrow ? String(card.eyebrow).slice(0, 40) : 'TREINO';
  card.closer = card.closer ? String(card.closer).slice(0, 140) : '';
  return card;
}

module.exports = { buildContext, buildActivityFocusContext, streamChatWithAssistant, computeHumanDelayMs, detectImageRequest, extractWorkoutCard };
