// Extras do Feed: resumo da semana (com ranking leve entre quem você segue),
// stories (treinos compartilhados nas últimas 24h) e @menções.

function brtToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function weekStartStr() {
  const d = new Date(brtToday() + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function weekSummary(db, user, computeWeeklyStreak) {
  const followees = db.prepare('SELECT followee_id FROM follows WHERE follower_id = ?').all(user.id).map((r) => r.followee_id);
  const ids = [user.id, ...followees];
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT u.id, u.name, u.avatar_path,
      COALESCE(SUM(a.distance_km), 0) AS km, COUNT(a.id) AS n, COALESCE(SUM(a.duration_sec), 0) AS sec
    FROM users u
    LEFT JOIN activities a ON a.user_id = u.id AND (u.id = ? OR a.source != 'strava') AND substr(COALESCE(a.started_at, a.created_at), 1, 10) >= ?
    WHERE u.id IN (${ph})
    GROUP BY u.id
    ORDER BY km DESC, u.name ASC`).all(user.id, weekStartStr(), ...ids);
  const mine = rows.find((r) => r.id === user.id) || { km: 0, n: 0, sec: 0 };
  const all = db.prepare('SELECT started_at, created_at FROM activities WHERE user_id = ?').all(user.id);
  return {
    km: Math.round(mine.km * 10) / 10,
    runs: mine.n,
    sec: mine.sec,
    streakWeeks: computeWeeklyStreak(all),
    ranking: rows.slice(0, 5).map((r) => ({ id: r.id, name: r.name, avatar_path: r.avatar_path, km: Math.round(r.km * 10) / 10, me: r.id === user.id })),
    hasFollows: followees.length > 0,
  };
}

function recentStories(db, user) {
  const rows = db.prepare(`SELECT p.id, p.user_id, p.photos_json, p.photo_path, u.name, u.avatar_path,
      a.title, a.distance_km, a.duration_sec, a.avg_pace_sec, a.workout_type, a.source
    FROM posts p
    JOIN users u ON u.id = p.user_id
    JOIN activities a ON a.id = p.activity_id
    WHERE p.created_at >= datetime('now', '-24 hours')
      AND p.user_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
      AND p.user_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = ?)
    ORDER BY p.id DESC LIMIT 60`).all(user.id, user.id);
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    let photo = r.photo_path || null;
    try { const ph = r.photos_json ? JSON.parse(r.photos_json) : null; if (ph && ph.length) photo = ph[0]; } catch (e) { /* ignore */ }
    // Strava policy: Strava-sourced numbers are shown only to their owner.
    const hide = r.source === 'strava' && r.user_id !== user.id;
    out.push({ postId: r.id, userId: r.user_id, me: r.user_id === user.id, name: r.name, avatar: r.avatar_path, title: hide ? null : r.title,
      km: hide ? null : r.distance_km, sec: hide ? null : r.duration_sec, pace: hide ? null : r.avg_pace_sec, type: hide ? null : r.workout_type, photo });
  }
  out.sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0));
  return out.slice(0, 14);
}

function mentionMapFor(db, posts) {
  const slugs = new Set();
  for (const p of posts) {
    const re = /(?:^|[\s(])@([a-zA-Z0-9_-]{2,40})/g;
    let m;
    while ((m = re.exec(p.body || ''))) slugs.add(m[1].toLowerCase());
  }
  const map = {};
  if (!slugs.size) return map;
  const list = [...slugs].slice(0, 30);
  const rows = db.prepare(`SELECT public_slug FROM users WHERE LOWER(public_slug) IN (${list.map(() => '?').join(',')})`).all(...list);
  for (const r of rows) if (r.public_slug) map[r.public_slug.toLowerCase()] = true;
  return map;
}

module.exports = { weekSummary, recentStories, mentionMapFor };
