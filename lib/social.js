const crypto = require('node:crypto');
const { fmtClock, secToPace } = require('./format');

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

// Inserts a notification row for `userId` unless they triggered their own
// action (no one needs to be told they reacted to their own post).
function notify(db, { userId, actorUserId, type, postId, body }) {
  if (!userId || userId === actorUserId) return;
  db.prepare('INSERT INTO notifications (user_id, actor_user_id, type, post_id, body) VALUES (?,?,?,?,?)')
    .run(userId, actorUserId, type, postId || null, body || null);
}

module.exports = { slugify, ensurePublicSlug, buildShareDraft, notify };
