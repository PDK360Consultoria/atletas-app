// Cards de imagem (Stories) do treino, no padrao do skill treino-stories-post:
//  - card completo 1080x1920 (fundo escuro)
//  - resumo pequeno com fundo transparente (para sobrepor a uma foto)
// Dois tipos:
//  - "realizado": montado DIRETO dos dados reais do treino (sem IA, nada inventado)
//  - "planejado": preparacao/treino que o coach prescreveu na conversa
//    (extraido da conversa pela IA, usando so numeros que apareceram nela)
// O desenho em si acontece no navegador (ver STORYCARD_JS, lib/storycard_client.js).
const { secToPace, fmtClock } = require('./format');
const { summarizeIntervals } = require('./intervals');

const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const CREDIT = 'Runiqx · runiqx.com';

function dateLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${String(d.getDate()).padStart(2, '0')} ${MESES[d.getMonth()]}`;
}

function kmText(km) {
  if (km == null || !Number.isFinite(Number(km))) return '';
  const n = Math.round(Number(km) * 100) / 100;
  return String(n).replace('.', ',');
}

// "N dias pra <prova>. Meta ..." a partir da proxima prova do atleta.
function countdown(user, races) {
  const now = new Date();
  const next = (races || [])
    .filter((r) => r.race_date && new Date(r.race_date) >= new Date(now.toDateString()))
    .sort((a, b) => new Date(a.race_date) - new Date(b.race_date))[0];
  if (!next) return { closer: '', closerBold: '' };
  const days = Math.ceil((new Date(next.race_date) - now) / 86400000);
  const bold = days <= 0 ? 'É hoje' : `${days} ${days === 1 ? 'dia' : 'dias'}`;
  const goal = next.goal_time_sec ? ` Meta ${fmtClock(next.goal_time_sec)}.` : '';
  const text = days <= 0 ? ` — ${next.name}.${goal}` : ` pra ${next.name}.${goal}`;
  return { closer: bold + text, closerBold: bold };
}

function bucketBars(bars, max) {
  if (bars.length <= max) return bars;
  const size = Math.ceil(bars.length / max);
  const out = [];
  for (let i = 0; i < bars.length; i += size) {
    const chunk = bars.slice(i, i + size);
    const avg = chunk.reduce((s, b) => s + b.value, 0) / chunk.length;
    out.push({ label: String(chunk[0].label), text: secToPace(avg), value: avg });
  }
  return out;
}

// Card do treino REALIZADO, so com dados reais.
function activityCard(activity, laps, intervals, user, races) {
  if (!activity) return null;
  const summary = summarizeIntervals(intervals);
  const type = (activity.workout_type || '').trim();
  const when = dateLabel(activity.started_at || activity.created_at);
  const title = String(activity.title || type || 'Treino').slice(0, 40);

  let bars = [];
  let chartTitle = 'Pace por km';
  if (summary && summary.bars && summary.bars.length) {
    chartTitle = 'Pace por tiro';
    bars = summary.bars.map((b) => ({ label: String(b.idx), text: secToPace(b.pace_sec), value: b.pace_sec }));
  } else if (laps && laps.length >= 2) {
    bars = laps.filter((l) => l.split_sec).map((l) => ({ label: String(l.km), text: secToPace(l.split_sec), value: l.split_sec }));
  }
  bars = bucketBars(bars, 24);

  let sub = '';
  if (bars.length >= 3 && !summary) {
    const first = bars[0], last = bars[bars.length - 1];
    const diff = first.value - last.value;
    if (diff >= 10) sub = `Ritmo caindo do km ${first.label} ao km ${last.label}. ${first.text} → ${last.text}.`;
    else if (diff <= -10) sub = `Ritmo subindo ao longo do treino. ${first.text} → ${last.text}.`;
    else {
      const best = bars.reduce((m, b) => (b.value < m.value ? b : m), bars[0]);
      sub = `Ritmo constante. Melhor parcial: ${best.text}/km.`;
    }
  } else if (summary) {
    sub = summary.structureText ? String(summary.structureText).slice(0, 90) : '';
  }

  const hero = [
    { k: 'Tempo', v: fmtClock(activity.duration_sec), u: '' },
    { k: 'Pace médio', v: secToPace(activity.avg_pace_sec), u: '/km' },
  ];
  const stats = [];
  if (activity.avg_hr) stats.push({ k: 'FC média', v: String(Math.round(activity.avg_hr)), u: 'bpm' });
  if (activity.max_hr) stats.push({ k: 'FC máxima', v: String(Math.round(activity.max_hr)), u: 'bpm' });
  if (stats.length < 2 && activity.elevation_gain_m) stats.push({ k: 'Ganho de elevação', v: String(Math.round(activity.elevation_gain_m)), u: 'm' });

  const cd = countdown(user, races);
  return {
    kind: 'realizado',
    eyebrow: `${title}${when ? ' · ' + when : ''}`.toUpperCase().slice(0, 48),
    headline: kmText(activity.distance_km) || '—',
    unit: 'km',
    hero,
    sub,
    stats,
    chart: bars.length >= 2 ? { title: chartTitle, mode: 'pace', bars } : null,
    closer: cd.closer,
    closerBold: cd.closerBold,
    credit: CREDIT,
    overlayTitle: title.toUpperCase(),
    overlay: [
      { k: 'Distância', v: kmText(activity.distance_km), u: ' km' },
      { k: 'Tempo', v: fmtClock(activity.duration_sec), u: '' },
      { k: 'Pace médio', v: secToPace(activity.avg_pace_sec), u: '/km' },
    ],
  };
}

const IMAGE_REQUEST_RE = /\b(imagem|imagen|figura|card|cart[ãa]o|stories?|print|postagem|postar|compartilhar)\b/i;
function detectImageRequest(message) {
  return IMAGE_REQUEST_RE.test(message || '');
}

function clip(s, n) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n); }
function cleanPair(p) {
  if (!p || (!p.v && p.v !== 0)) return null;
  return { k: clip(p.k, 24), v: clip(p.v, 14), u: clip(p.u, 8) };
}

// Valida/limpa o JSON vindo da IA (treino PLANEJADO).
function sanitizePlanned(raw, user, races) {
  if (!raw || raw.error || typeof raw !== 'object') return null;
  const headline = clip(raw.headline, 14);
  if (!headline) return null;
  const hero = (Array.isArray(raw.hero) ? raw.hero : []).map(cleanPair).filter(Boolean).slice(0, 2);
  const stats = (Array.isArray(raw.stats) ? raw.stats : []).map(cleanPair).filter(Boolean).slice(0, 2);
  if (!hero.length && !stats.length) return null;
  let chart = null;
  if (raw.chart && Array.isArray(raw.chart.bars) && raw.chart.bars.length >= 2) {
    const bars = raw.chart.bars.slice(0, 24).map((b) => ({ label: clip(b.label, 6), text: clip(b.text, 8), value: Number(b.value) || 0 }));
    const mode = raw.chart.mode === 'pace' ? 'pace' : 'plain';
    chart = { title: clip(raw.chart.title, 30) || 'Plano', mode, bars };
  }
  const cd = countdown(user, races);
  const own = clip(raw.closer, 120);
  const title = clip(raw.eyebrow, 40) || 'TREINO PLANEJADO';
  const overlaySrc = hero.concat(stats).slice(0, 3);
  return {
    kind: 'planejado',
    eyebrow: title.toUpperCase(),
    headline,
    unit: clip(raw.unit, 8),
    hero,
    sub: clip(raw.sub, 100),
    stats,
    chart,
    closer: own || cd.closer,
    closerBold: own ? '' : cd.closerBold,
    credit: CREDIT,
    overlayTitle: title.toUpperCase(),
    overlay: overlaySrc,
  };
}

async function extractPlannedCard(apiKey, context, history, userMessage, user, races) {
  const system = [
    'Você extrai de uma conversa entre um atleta e seu treinador de corrida o treino (ou a preparação) mais claramente definido nela: o treino que acabou de ser prescrito/discutido, ou o que o atleta quer visualizar agora (treino de amanhã, preparação para a prova, plano da semana etc).',
    'Responda APENAS com JSON válido, sem texto antes ou depois, sem markdown, neste formato exato:',
    '{"kind":"planejado"|"realizado","use_last_activity":false,"eyebrow":"CATEGORIA · QUANDO (ex: TREINO DE AMANHÃ, PREPARAÇÃO PARA A PROVA, INTERVALADO)","headline":"o número/dado título curto (ex: 8×400, 12, 5:10)","unit":"unidade curta opcional (ex: m, km, /km)","hero":[{"k":"RÓTULO","v":"valor","u":"unidade"}],"sub":"uma frase curta de contexto","stats":[{"k":"RÓTULO","v":"valor","u":"unidade"}],"chart":{"title":"título curto","mode":"plain","bars":[{"label":"1","text":"3:50","value":80}]},"closer":"uma frase curta de orientação (opcional)"}',
    'Regras: "hero" tem até 2 itens grandes (ex: distância total, pace alvo); "stats" até 2 itens menores (ex: FC alvo, recuperação). "chart" é OPCIONAL: use só se o treino tiver uma estrutura repetida (tiros, blocos, progressão) com um valor por barra; em "mode":"pace" os "value" são segundos por km e a barra mais rápida fica mais alta; em "mode":"plain" "value" é a altura relativa 10 a 100. Se não houver estrutura, use "chart":null.',
    'Use APENAS números e fatos que realmente apareceram na conversa ou no contexto do atleta. Nunca invente pace, distância ou FC.',
    'Se o atleta pede uma imagem do treino que ELE JÁ FEZ (treino de hoje, o último treino, o treino realizado), responda {"kind":"realizado","use_last_activity":true} e mais nada.',
    'Se a conversa não deixa claro nenhum treino específico, responda exatamente {"error":"no_workout"}.',
  ].join('\n');
  const messages = [...(history || []).slice(-10), { role: 'user', content: userMessage }];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 900, system: system + '\n\nContexto do atleta:\n' + String(context || '').slice(0, 6000), messages }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const text = data && data.content && data.content[0] && data.content[0].text;
  if (!text) return null;
  let raw;
  try { const m = text.match(/\{[\s\S]*\}/); raw = JSON.parse(m ? m[0] : text); } catch (e) { return null; }
  return raw;
}

// Decide qual card montar. activities: lista do atleta (mais recente primeiro).
async function resolveCard({ apiKey, user, races, activities, activity, laps, intervals, context, history, userMessage }) {
  const parse = (a) => ({
    laps: a.laps_json ? JSON.parse(a.laps_json) : [],
    intervals: a.intervals_json ? JSON.parse(a.intervals_json) : [],
  });
  const latestCard = () => {
    const a = (activities || [])[0];
    if (!a) return null;
    const p = parse(a);
    return activityCard(a, p.laps, p.intervals, user, races);
  };
  // Conversa de UM treino: o card e desse treino.
  if (activity) return activityCard(activity, laps || [], intervals || [], user, races);
  // Sem chave de IA: so da pra montar o do ultimo treino.
  if (!apiKey) return latestCard();
  const raw = await extractPlannedCard(apiKey, context, history, userMessage, user, races);
  if (!raw) return latestCard();
  if (raw.kind === 'realizado' || raw.use_last_activity) return latestCard();
  return sanitizePlanned(raw, user, races) || latestCard();
}

module.exports = { activityCard, resolveCard, detectImageRequest, sanitizePlanned, countdown };
