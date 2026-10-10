// Memoria dos treinos prescritos: o que o coach montou (ou o atleta informou
// que esta combinado) fica salvo e volta no contexto das proximas conversas,
// por texto e por voz, para o coach retomar o plano em vez de recriar outro.

const SENTINEL_RE = /\n?\[\[STORY_CARD\]\][\s\S]*?\[\[\/STORY_CARD\]\]/g;

const VERBS = /\b(monta|monte|montar|prescrev\w*|prescri\w*|passa|passe|manda|mande|me d[aá]|me d[eê]|quero|preciso|qual|como (?:fa[cç]o|vai ser|ser[aá])|o que (?:eu )?(?:fa[cç]o|tenho)|sugere|sugira|planej\w*)(?![a-zA-ZÀ-ÿ])/i;
const OBJECTS = /\b(treino|long[aã]o|longo|plano|semana|bloco|progress[aã]o|tiros?|intervalado|rodagem|regenerativo|estrat[eé]gia|gel|prepara[cç][aã]o|polimento|taper|pr[eé]-?prova)\b/i;
const WHEN_A = /\b(amanh[ãa]|hoje|s[áa]bado|domingo|essa semana|semana que vem)(?![a-zA-ZÀ-ÿ])[^.?!]{0,30}\b(treino|long[aã]o|tiros?|rodagem|intervalado)\b/i;
const WHEN_B = /\b(treino|long[aã]o|tiros?|rodagem|intervalado)\b[^.?!]{0,30}\b(amanh[ãa]|hoje|s[áa]bado|domingo)(?![a-zA-ZÀ-ÿ])/i;
const ANALYSIS = /\b(analis\w*|an[aá]lise|como foi)\b/i;

// O atleta esta pedindo um treino/plano/orientacao de treino?
function detectPlanRequest(text) {
  const t = String(text || '');
  if (!t.trim() || ANALYSIS.test(t)) return false;
  return (VERBS.test(t) && OBJECTS.test(t)) || WHEN_A.test(t) || WHEN_B.test(t);
}

function paceCount(text) {
  return (String(text || '').match(/\b\d{1,2}:\d{2}\b/g) || []).length;
}

// O texto parece um plano de treino com numeros (paces/tempos)?
function looksLikePlan(text, minLen) {
  const t = String(text || '');
  return t.length >= (minLen || 160) && paceCount(t) >= 2;
}

function clean(text) {
  return String(text || '').replace(SENTINEL_RE, '').trim();
}

function savePlan(db, userId, { source, title, content }) {
  const body = clean(content).slice(0, 6000);
  if (!body) return false;
  const last = db.prepare('SELECT content FROM coach_plans WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId);
  if (last && last.content === body) return false;
  db.prepare('INSERT INTO coach_plans (user_id, source, title, content) VALUES (?,?,?,?)')
    .run(userId, source === 'atleta' ? 'atleta' : 'coach', String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120) || null, body);
  return true;
}

function recentPlans(db, userId) {
  return db.prepare("SELECT * FROM coach_plans WHERE user_id = ? AND created_at >= datetime('now','-30 days') ORDER BY id DESC LIMIT 4").all(userId);
}

function dayLabel(sqlUtc) {
  const d = new Date(String(sqlUtc).replace(' ', 'T') + 'Z');
  if (isNaN(d)) return '';
  const local = new Date(d.getTime() - 3 * 3600 * 1000); // Brasilia
  return `${String(local.getUTCDate()).padStart(2, '0')}/${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Bloco de contexto com os treinos prescritos recentemente.
function plansContext(plans) {
  const lines = [''];
  if (!plans || !plans.length) {
    lines.push('Treinos que você já prescreveu ou que o atleta informou como combinados: nenhum registrado. Se o atleta citar o treino de amanhã/de hoje ou "o longão" sem dizer o que é, NÃO invente nem diga que foi combinado: pergunte o que ele tem combinado ou ofereça montar.');
    return lines.join('\n');
  }
  lines.push('Treinos que você já prescreveu ou que o atleta informou como combinados (do mais recente ao mais antigo). Este é o "combinado": quando ele falar do treino de amanhã, de hoje ou "do longão", retome ESTE plano com os números dele, sem recriar outro, a menos que ele peça para mudar:');
  for (const p of plans) {
    const who = p.source === 'atleta' ? 'informado pelo atleta' : 'prescrito por você';
    lines.push(`- ${dayLabel(p.created_at)} (${who})${p.title ? ': ' + p.title : ''}`);
    lines.push('  ' + String(p.content).replace(/\s*\n\s*/g, ' / ').slice(0, 1500));
  }
  return lines.join('\n');
}

module.exports = { detectPlanRequest, looksLikePlan, savePlan, recentPlans, plansContext };
