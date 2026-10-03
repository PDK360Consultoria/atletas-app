const crypto = require('node:crypto');
const { fmtClock, secToPace } = require('./format');

const EXPERIENCE_LABELS = {
  iniciante: 'iniciante',
  intermediario: 'intermediário',
  avancado: 'avançado',
};

// The athlete's member number, shown at signup ("Você é o atleta Nº 001") —
// simply their row id, zero-padded to 3 digits. Felipe was the very first
// account created, so he's naturally #001; this never needs its own counter
// column, the id already is one.
function memberNumber(user) {
  return String(user.id).padStart(3, '0');
}

// Builds the short personalized read shown right after signup, from the
// pre-diagnosis fields the athlete just filled in (experience, weekly
// volume, goal race/time, injury history — all optional, so this degrades
// gracefully to a shorter generic read when some are missing instead of
// ever inventing a number the athlete didn't give). Plain text, no
// markdown — same house style as the coach chat.
function buildDiagnosis(user) {
  const first = (user.name || '').split(' ')[0] || 'Atleta';
  const bits = [];

  const level = EXPERIENCE_LABELS[user.experience_level] || null;
  if (level && user.weekly_km) {
    bits.push(`Você chega como corredor(a) ${level}, rodando cerca de ${user.weekly_km}km por semana hoje.`);
  } else if (level) {
    bits.push(`Você chega como corredor(a) ${level}.`);
  } else if (user.weekly_km) {
    bits.push(`Você chega rodando cerca de ${user.weekly_km}km por semana hoje.`);
  } else {
    bits.push(`Você está começando a registrar seus treinos por aqui.`);
  }

  if (user.goal_race_name) {
    bits.push(`Sua meta é a ${user.goal_race_name}${user.goal_time_sec ? `, em ${fmtClock(user.goal_time_sec)}` : ''} — é isso que vai guiar o que o Coach vai te mostrar daqui pra frente.`);
  } else {
    bits.push('Ainda sem uma prova-alvo definida — você pode cadastrar uma a qualquer momento em Provas, e o Coach passa a calcular tudo em cima dela.');
  }

  if (user.injury_notes && user.injury_notes.trim()) {
    bits.push(`Anotamos o que você contou sobre ${user.injury_notes.trim().length > 60 ? 'seu histórico' : user.injury_notes.trim()} — o Coach vai levar isso em conta antes de sugerir qualquer progressão de carga.`);
  }

  bits.push(`Bem-vindo(a) ao Runiqx, ${first}.`);
  return bits.join(' ');
}

// Public-profile slugs are short, URL-safe, and derived from the athlete's
// name so the link reads nicely (e.g. /u/felipe-de-paula), falling back to a
// random suffix only when that base is already taken by someone else.
function slugify(name) {
  return (name || 'atleta')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'atleta';
}

// Generates and persists a public_slug for a user the first time their
// public profile link is needed (Settings page load, or a direct /u/:slug
// miss triggering a lookup isn't possible — so this always runs from
// Settings). Mutates `user.public_slug` in place so the caller doesn't need
// a second read. Idempotent: returns the existing slug if already set.
function ensurePublicSlug(db, user) {
  if (user.public_slug) return user.public_slug;
  const base = slugify(user.name);
  let slug = base;
  let attempt = 0;
  const exists = db.prepare('SELECT id FROM users WHERE public_slug = ? AND id != ?');
  while (exists.get(slug, user.id)) {
    attempt += 1;
    slug = `${base}-${crypto.randomBytes(2).toString('hex')}`;
    if (attempt > 8) { slug = `${base}-${Date.now()}`; break; }
  }
  db.prepare('UPDATE users SET public_slug = ? WHERE id = ?').run(slug, user.id);
  user.public_slug = slug;
  return slug;
}

// Builds a short, ready-to-edit post draft from an activity's own stats plus
// (when available) the opening line of its AI analysis — so "compartilhar
// treino" gives the athlete something real to start from instead of a blank
// textarea, without needing a fresh AI call just to draft a caption.
function buildShareDraft(activity) {
  const bits = [];
  if (activity.distance_km) {
    let line = `${activity.distance_km}km`;
    if (activity.duration_sec) line += ` em ${fmtClock(activity.duration_sec)}`;
    if (activity.avg_pace_sec) line += ` (pace ${secToPace(activity.avg_pace_sec)}/km)`;
    bits.push(line);
  }
  if (activity.ai_analysis) {
    const m = /##\s*Resumo do treino\s*\n+([\s\S]*?)(\n\s*##|$)/i.exec(activity.ai_analysis);
    const raw = m ? m[1] : activity.ai_analysis;
    const firstLine = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    if (firstLine) bits.push(firstLine.replace(/\*\*/g, ''));
  }
  return bits.join('\n\n');
}

// Same idea as buildShareDraft, but for the "🏆 Recorde pessoal" prompt on
// an activity that just beat the athlete's own history (see
// detectPersonalRecord in lib/stats.js) — leads with the celebration instead
// of burying it, since that's the whole reason this draft exists.
function buildPRShareDraft(activity, prInfo) {
  const bits = [`🏆 Recorde pessoal! ${prInfo && prInfo.label ? prInfo.label : ''}`.trim()];
  if (activity.distance_km) {
    let line = `${activity.distance_km}km`;
    if (activity.duration_sec) line += ` em ${fmtClock(activity.duration_sec)}`;
    if (activity.avg_pace_sec) line += ` (pace ${secToPace(activity.avg_pace_sec)}/km)`;
    bits.push(line);
  }
  return bits.join('\n\n');
}

// The reaction types a post can receive (see the `type` column on
// `reactions`, migrated in db.js). Order here is the order they render in
// the picker. Kept small on purpose — more than a handful of reaction kinds
// stops being a quick tap and starts being a decision.
const REACTION_TYPES = [
  { key: 'kudos', emoji: '👏', label: 'Apoio' },
  { key: 'fire', emoji: '🔥', label: 'Forte' },
  { key: 'pr', emoji: '🏆', label: 'Recorde' },
  { key: 'strong', emoji: '💪', label: 'Disposição' },
];
const REACTION_KEYS = REACTION_TYPES.map((r) => r.key);

// Inserts a notification row for `userId` unless they triggered their own
// action (no one needs to be told they reacted to their own post).
function notify(db, { userId, actorUserId, type, postId, body }) {
  if (!userId || userId === actorUserId) return;
  db.prepare('INSERT INTO notifications (user_id, actor_user_id, type, post_id, body) VALUES (?,?,?,?,?)')
    .run(userId, actorUserId, type, postId || null, body || null);
}

// Guards a redirect target against being hijacked into an open redirect:
// only a same-site path starting with one of the given prefixes (and never
// a protocol-relative "//host" URL) is allowed through; anything else falls
// back to the given default.
function safePath(value, prefixes, fallback) {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') &&
      prefixes.some((p) => value === p || value.startsWith(p))) {
    return value;
  }
  return fallback;
}

module.exports = { slugify, ensurePublicSlug, buildShareDraft, buildPRShareDraft, REACTION_TYPES, REACTION_KEYS, notify, safePath, memberNumber, buildDiagnosis };
