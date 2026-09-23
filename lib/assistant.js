const { secToPace, fmtClock, fmtDate } = require('./format');

// Builds a compact Portuguese context block describing the athlete, their
// goal, recent training and progress — sent as the system prompt so the
// assistant can answer questions grounded in real data, never invented.
function buildContext(user, races, activities, evolution) {
  const upcoming = races.filter((r) => r.race_date && new Date(r.race_date) >= new Date());
  const recent = activities.slice(0, 12);

const lines = [];
  lines.push(`Você é o assistente pessoal de treino do ${user.name.split(' ')[0]} dentro do app Atletas. Responda SOMENTE com base nos dados reais fornecidos abaixo — nunca invente números, treinos ou provas que não estejam listados. Se não souber algo, diga que não tem esse dado. Seja direto, use português do Brasil, e converse como um treinador experiente e próximo.`);
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

// Calls the Anthropic API directly via fetch (no SDK package — none can be
// npm-installed in this environment). Uses the athlete's OWN API key, entered
// in Settings, so usage and billing are theirs — never a shared/platform key.
async function chatWithAssistant(apiKey, systemContext, history, userMessage) {
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
    max_tokens: 2000,
    system: systemContext,
    messages,
  }),
});

const data = await res.json();
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  const text = (data.content || []).map((b) => b.text || '').join('').trim();
  return text || '(sem resposta)';
}

module.exports = { buildContext, chatWithAssistant };
