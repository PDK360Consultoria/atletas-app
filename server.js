const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const crypto = require('node:crypto');

const db = require('./db');
const { hashPassword, verifyPassword, createSession, getUserFromToken, destroySession, parseCookies } = require('./lib/auth');
const { readBody, parseUrlEncoded, parseMultipart, serializeCookie } = require('./lib/http');
const { parseClock, secToPace } = require('./lib/format');
const { parseActivityFile } = require('./lib/gpx');
const { analyzeActivity } = require('./lib/anthropic');
const strava = require('./lib/strava');
const { computeEvolution, computeMedals } = require('./lib/stats');
const { buildContext, buildActivityFocusContext, streamChatWithAssistant } = require('./lib/assistant');
const { fetchNearbyRaces } = require('./lib/races');
const { buildMonthCalendar } = require('./lib/calendar');
const { ensurePublicSlug, buildShareDraft, notify } = require('./lib/social');
const views = require('./views');
const { coachPage } = require('./views_coach');

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function html(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}
function redirect(res, location, cookie) {
  const headers = { location };
  if (cookie) headers['set-cookie'] = cookie;
  res.writeHead(302, headers);
  res.end();
}
function notFound(res) {
  html(res, 404, '<h1>404</h1><p>Página não encontrada. <a href="/">Voltar</a></p>');
}
function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host}`;
}

async function handle(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);
  const method = req.method;

  // static
  if (method === 'GET' && pathname === '/style.css') {
    const css = fs.readFileSync(path.join(__dirname, 'public', 'style.css'));
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
    return res.end(css);
  }

  const cookies = parseCookies(req);

  // Feed photos — auth-gated (the feed itself is only visible to signed-in
  // athletes). Filename is generated server-side, so this regex is just a
  // sanity check, not a real parsing surface.
  const uploadMatch = method === 'GET' ? /^\/uploads\/([a-zA-Z0-9._-]+)$/.exec(pathname) : null;
  if (uploadMatch) {
    if (!getUserFromToken(cookies.session)) return redirect(res, '/login');
    const filePath = path.join(UPLOAD_DIR, uploadMatch[1]);
    if (!filePath.startsWith(UPLOAD_DIR) || !fs.existsSync(filePath)) return notFound(res);
    const ext = path.extname(filePath).toLowerCase();
    const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'private, max-age=86400' });
    return res.end(fs.readFileSync(filePath));
  }

  const user = getUserFromToken(cookies.session);
  const isForm = method === 'POST' && (req.headers['content-type'] || '').includes('application/x-www-form-urlencoded');
  const isMultipart = method === 'POST' && (req.headers['content-type'] || '').includes('multipart/form-data');

  let fields = {}, files = {};
  if (isForm) {
    const buf = await readBody(req).catch(() => null);
    fields = buf ? parseUrlEncoded(buf) : {};
  } else if (isMultipart) {
    try {
      const buf = await readBody(req);
      ({ fields, files } = parseMultipart(buf, req.headers['content-type']));
    } catch (e) {
      return html(res, 413, 'Arquivo muito grande.');
    }
  }

  const requireAuth = () => { if (!user) { redirect(res, '/login'); return false; } return true; };

  try {
    // ---------- auth ----------
    if (method === 'GET' && pathname === '/login') return html(res, 200, views.loginPage(parsed.query.error));
    if (method === 'POST' && pathname === '/login') {
      const u = db.prepare('SELECT * FROM users WHERE email = ?').get((fields.email || '').toLowerCase().trim());
      if (!u || !verifyPassword(fields.password || '', u.password_salt, u.password_hash)) {
        return html(res, 200, views.loginPage('E-mail ou senha incorretos.'));
      }
      const token = createSession(u.id);
      return redirect(res, '/', serializeCookie('session', token, { maxAge: 30 * 24 * 3600 }));
    }

    if (method === 'GET' && pathname === '/signup') return html(res, 200, views.signupPage(parsed.query.error));
    if (method === 'POST' && pathname === '/signup') {
      const email = (fields.email || '').toLowerCase().trim();
      if (!fields.name || !email || !fields.password || fields.password.length < 6) {
        return html(res, 200, views.signupPage('Preencha todos os campos (senha com 6+ caracteres).'));
      }
      const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (exists) return html(res, 200, views.signupPage('Já existe uma conta com este e-mail.'));
      const { hash, salt } = hashPassword(fields.password);
      const info = db.prepare('INSERT INTO users (name, email, password_hash, password_salt) VALUES (?, ?, ?, ?)')
        .run(fields.name.trim(), email, hash, salt);
      const token = createSession(info.lastInsertRowid);
      return redirect(res, '/', serializeCookie('session', token, { maxAge: 30 * 24 * 3600 }));
    }

    if (method === 'GET' && pathname === '/logout') {
      destroySession(cookies.session);
      return redirect(res, '/login', serializeCookie('session', '', { expire: true }));
    }

    // ---------- dashboard ----------
    if (method === 'GET' && pathname === '/') {
      if (!requireAuth()) return;
      if (user.strava_refresh_token) {
        const staleFor = user.strava_last_synced_at ? (Math.floor(Date.now() / 1000) - user.strava_last_synced_at) : Infinity;
        if (staleFor > 900) {
          await strava.syncUserActivities(db, user).catch((e) => console.error('[strava auto-sync]', e));
        }
      }
      const races = db.prepare('SELECT * FROM races WHERE user_id = ? ORDER BY race_date ASC').all(user.id);
      const today = new Date();
      const nextRace = races.find((r) => r.race_date && new Date(r.race_date) >= today) || races[0] || null;
      const daysToRace = nextRace && nextRace.race_date
        ? Math.max(0, Math.ceil((new Date(nextRace.race_date) - today) / 86400000))
        : null;
      const recentActivities = db.prepare('SELECT * FROM activities WHERE user_id = ? ORDER BY COALESCE(started_at, created_at) DESC LIMIT 8').all(user.id);
      const allActivities = db.prepare('SELECT * FROM activities WHERE user_id = ?').all(user.id);
      const evolution = computeEvolution(allActivities);
      const weekKm = evolution.weeks[evolution.weeks.length - 1].km;
      const medals = computeMedals(allActivities);

      let calYear = today.getFullYear(), calMonth = today.getMonth() + 1;
      if (parsed.query.month && /^\d{4}-\d{2}$/.test(parsed.query.month)) {
        const [y, mo] = parsed.query.month.split('-').map((n) => parseInt(n, 10));
        if (y >= 2000 && mo >= 1 && mo <= 12) { calYear = y; calMonth = mo; }
      }
      const calendar = buildMonthCalendar(calYear, calMonth, allActivities, races);

      return html(res, 200, views.dashboardPage({ user, nextRace, daysToRace, recentActivities, weekKm, evolution, medals, calendar }));
    }

    // ---------- races ----------
    if (method === 'GET' && pathname === '/races') {
      if (!requireAuth()) return;
      const races = db.prepare('SELECT * FROM races WHERE user_id = ? ORDER BY race_date ASC').all(user.id);
      const nearbyRaces = await fetchNearbyRaces(user.city, 60);
      return html(res, 200, views.racesPage(user, races, nearbyRaces, parsed.query.added));
    }
    if (method === 'POST' && pathname === '/races') {
      if (!requireAuth()) return;
      const goalSec = parseClock(fields.goal_time);
      db.prepare('INSERT INTO races (user_id, name, race_date, distance_km, city, goal_time_sec) VALUES (?,?,?,?,?,?)')
        .run(user.id, fields.name, fields.race_date || null, fields.distance_km ? parseFloat(fields.distance_km) : null, fields.city || null, goalSec);
      return redirect(res, '/races');
    }
    if (method === 'POST' && pathname === '/races/quickadd') {
      if (!requireAuth()) return;
      if (fields.name && fields.race_date) {
        const exists = db.prepare('SELECT id FROM races WHERE user_id = ? AND name = ? AND race_date = ?').get(user.id, fields.name, fields.race_date);
        if (!exists) {
          db.prepare('INSERT INTO races (user_id, name, race_date, distance_km, city) VALUES (?,?,?,?,?)')
            .run(user.id, fields.name, fields.race_date, fields.distance_km ? parseFloat(fields.distance_km) : null, fields.city || null);
        }
      }
      return redirect(res, '/races?added=1');
    }
    let m;
    if (method === 'POST' && (m = /^\/races\/(\d+)\/delete$/.exec(pathname))) {
      if (!requireAuth()) return;
      db.prepare('DELETE FROM races WHERE id = ? AND user_id = ?').run(m[1], user.id);
      return redirect(res, '/races');
    }

    // ---------- activities ----------
    if (method === 'GET' && pathname === '/activities') {
      if (!requireAuth()) return;
      const activities = db.prepare('SELECT * FROM activities WHERE user_id = ? ORDER BY COALESCE(started_at, created_at) DESC').all(user.id);
      return html(res, 200, views.activitiesPage(user, activities, parsed.query.synced));
    }
    if (method === 'GET' && pathname === '/activities/new') {
      if (!requireAuth()) return;
      const races = db.prepare('SELECT * FROM races WHERE user_id = ? ORDER BY race_date ASC').all(user.id);
      return html(res, 200, views.activityNewPage(user, races, parsed.query.error));
    }
    if (method === 'POST' && pathname === '/activities/upload') {
      if (!requireAuth()) return;
      const races = db.prepare('SELECT * FROM races WHERE user_id = ? ORDER BY race_date ASC').all(user.id);
      const file = files.file;
      if (!file) return html(res, 200, views.activityNewPage(user, races, 'Selecione um arquivo .gpx ou .tcx.'));
      let summary;
      try {
        summary = parseActivityFile(file.data.toString('utf8'), file.filename);
      } catch (e) {
        summary = null;
      }
      if (!summary) return html(res, 200, views.activityNewPage(user, races, 'Não consegui ler esse arquivo. Confira se é um .gpx ou .tcx válido com pontos de GPS e horário.'));

      const savedName = `${Date.now()}_${file.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, savedName), file.data);

      const info = db.prepare(`INSERT INTO activities
        (user_id, race_id, title, workout_type, source, raw_filename, distance_km, duration_sec, avg_pace_sec, avg_hr, max_hr, elevation_gain_m, started_at, laps_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        user.id,
        fields.race_id ? parseInt(fields.race_id, 10) : null,
        fields.title || 'Treino',
        fields.workout_type || null,
        summary.source,
        savedName,
        summary.distance_km,
        summary.duration_sec,
        summary.avg_pace_sec,
        summary.avg_hr,
        summary.max_hr,
        summary.elevation_gain_m,
        summary.started_at,
        JSON.stringify(summary.laps)
      );
      return redirect(res, `/activities/${info.lastInsertRowid}`);
    }
    if (method === 'POST' && pathname === '/activities/manual') {
      if (!requireAuth()) return;
      const duration = parseClock(fields.duration);
      const distance = parseFloat(fields.distance_km);
      const avgPace = duration && distance ? Math.round(duration / distance) : null;
      const info = db.prepare(`INSERT INTO activities
        (user_id, title, workout_type, source, distance_km, duration_sec, avg_pace_sec, avg_hr, max_hr, started_at, notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        user.id, fields.title, fields.workout_type || null, 'manual',
        distance || null, duration || null, avgPace,
        fields.avg_hr ? parseInt(fields.avg_hr, 10) : null,
        fields.max_hr ? parseInt(fields.max_hr, 10) : null,
        fields.started_at || null, fields.notes || null
      );
      return redirect(res, `/activities/${info.lastInsertRowid}`);
    }

    if (method === 'GET' && (m = /^\/activities\/(\d+)$/.exec(pathname))) {
      if (!requireAuth()) return;
      const activity = db.prepare('SELECT * FROM activities WHERE id = ? AND user_id = ?').get(m[1], user.id);
      if (!activity) return notFound(res);
      const laps = activity.laps_json ? JSON.parse(activity.laps_json) : [];
      const intervals = activity.intervals_json ? JSON.parse(activity.intervals_json) : [];
      const evolution = computeEvolution(db.prepare('SELECT * FROM activities WHERE user_id = ?').all(user.id));
      return html(res, 200, views.activityDetailPage({ user, activity, laps, intervals, evolution, aiEnabled: !!user.anthropic_api_key }));
    }
    if (method === 'POST' && (m = /^\/activities\/(\d+)\/rename$/.exec(pathname))) {
      if (!requireAuth()) return;
      const title = (fields.title || '').trim();
      if (title) {
        db.prepare('UPDATE activities SET title = ? WHERE id = ? AND user_id = ?').run(title, m[1], user.id);
      }
      return redirect(res, `/activities/${m[1]}`);
    }
    if (method === 'POST' && (m = /^\/activities\/(\d+)\/analyze$/.exec(pathname))) {
      if (!requireAuth()) return;
      const activity = db.prepare('SELECT * FROM activities WHERE id = ? AND user_id = ?').get(m[1], user.id);
      if (!activity) return notFound(res);
      const laps = activity.laps_json ? JSON.parse(activity.laps_json) : [];
      const intervals = activity.intervals_json ? JSON.parse(activity.intervals_json) : [];
      try {
        const text = await analyzeActivity(user.anthropic_api_key, activity, laps, intervals);
        db.prepare('UPDATE activities SET ai_analysis = ? WHERE id = ?').run(text, activity.id);
      } catch (e) {
        db.prepare('UPDATE activities SET ai_analysis = ? WHERE id = ?').run(`Não foi possível gerar a análise agora (${e.message}).`, activity.id);
      }
      return redirect(res, `/activities/${activity.id}`);
    }
    if (method === 'GET' && (m = /^\/activities\/(\d+)\/story$/.exec(pathname))) {
      if (!requireAuth()) return;
      const activity = db.prepare('SELECT * FROM activities WHERE id = ? AND user_id = ?').get(m[1], user.id);
      if (!activity) return notFound(res);
      return html(res, 200, views.storyPage(user, activity));
    }
    if (method === 'POST' && (m = /^\/activities\/(\d+)\/delete$/.exec(pathname))) {
      if (!requireAuth()) return;
      db.prepare('DELETE FROM blocks WHERE activity_id = ?').run(m[1]);
      db.prepare('DELETE FROM posts WHERE activity_id = ?').run(m[1]);
      db.prepare('DELETE FROM activities WHERE id = ? AND user_id = ?').run(m[1], user.id);
      return redirect(res, '/activities');
    }

    // ---------- feed ----------
    // Shared feed: every registered athlete sees everyone else's posts (no
    // follow graph — see README's "sem grafo social" note, which this
    // intentionally supersedes per the athlete's own request).
    if (method === 'GET' && pathname === '/feed') {
      if (!requireAuth()) return;
      const posts = db.prepare(`SELECT p.*, a.title as activity_title, a.workout_type as activity_workout_type,
          a.distance_km as activity_distance_km, a.duration_sec as activity_duration_sec,
          a.avg_pace_sec as activity_avg_pace_sec, a.elevation_gain_m as activity_elevation_gain_m,
          a.source as activity_source,
          u.name as author_name, u.public_slug as author_slug, u.avatar_path as author_avatar_path,
          (SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id) as kudos_count,
          EXISTS(SELECT 1 FROM reactions r WHERE r.post_id = p.id AND r.user_id = ?) as reacted,
          (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comment_count
        FROM posts p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN activities a ON a.id = p.activity_id
        ORDER BY p.created_at DESC LIMIT 100`).all(user.id);

      if (posts.length) {
        const placeholders = posts.map(() => '?').join(',');
        const comments = db.prepare(`SELECT c.*, u.name as author_name, u.avatar_path as author_avatar_path FROM comments c
          JOIN users u ON u.id = c.user_id
          WHERE c.post_id IN (${placeholders}) ORDER BY c.created_at ASC`).all(...posts.map((p) => p.id));
        const byPost = new Map();
        for (const c of comments) {
          if (!byPost.has(c.post_id)) byPost.set(c.post_id, []);
          byPost.get(c.post_id).push(c);
        }
        posts.forEach((p) => { p.comments = byPost.get(p.id) || []; });
      }

      let shareDraft = null, shareActivity = null;
      if (parsed.query.share_activity) {
        shareActivity = db.prepare('SELECT * FROM activities WHERE id = ? AND user_id = ?').get(parsed.query.share_activity, user.id);
        if (shareActivity) shareDraft = buildShareDraft(shareActivity);
      }
      return html(res, 200, views.feedPage(user, posts, { shareDraft, shareActivity }));
    }
    if (method === 'POST' && pathname === '/feed') {
      if (!requireAuth()) return;
      if (fields.body && fields.body.trim()) {
        let photoPath = null;
        const photo = files.photo;
        if (photo && photo.data && photo.data.length) {
          const ext = (path.extname(photo.filename || '').slice(0, 5) || '').replace(/[^.a-zA-Z0-9]/g, '');
          photoPath = `post_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
          fs.writeFileSync(path.join(UPLOAD_DIR, photoPath), photo.data);
        }
        db.prepare('INSERT INTO posts (user_id, activity_id, body, photo_path) VALUES (?,?,?,?)')
          .run(user.id, fields.activity_id ? parseInt(fields.activity_id, 10) : null, fields.body.trim(), photoPath);
      }
      return redirect(res, fields.activity_id ? `/activities/${fields.activity_id}` : '/feed');
    }
    if (method === 'POST' && (m = /^\/feed\/(\d+)\/react$/.exec(pathname))) {
      if (!requireAuth()) return;
      const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(m[1]);
      if (!post) return notFound(res);
      const existing = db.prepare('SELECT id FROM reactions WHERE post_id = ? AND user_id = ?').get(post.id, user.id);
      if (existing) {
        db.prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
      } else {
        db.prepare('INSERT INTO reactions (post_id, user_id) VALUES (?,?)').run(post.id, user.id);
        notify(db, { userId: post.user_id, actorUserId: user.id, type: 'kudos', postId: post.id, body: `${user.name} curtiu seu post` });
      }
      return redirect(res, '/feed');
    }
    if (method === 'POST' && (m = /^\/feed\/(\d+)\/comment$/.exec(pathname))) {
      if (!requireAuth()) return;
      const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(m[1]);
      if (!post) return notFound(res);
      const body = (fields.body || '').trim();
      if (body) {
        db.prepare('INSERT INTO comments (post_id, user_id, body) VALUES (?,?,?)').run(post.id, user.id, body);
        notify(db, { userId: post.user_id, actorUserId: user.id, type: 'comment', postId: post.id, body: `${user.name} comentou no seu post` });
      }
      return redirect(res, '/feed');
    }

    // ---------- public profile (no login) ----------
    if (method === 'GET' && (m = /^\/u\/([a-zA-Z0-9-]+)$/.exec(pathname))) {
      const profileUser = db.prepare('SELECT * FROM users WHERE public_slug = ?').get(m[1]);
      if (!profileUser) return notFound(res);
      const activities = db.prepare('SELECT * FROM activities WHERE user_id = ?').all(profileUser.id);
      const evolution = computeEvolution(activities);
      const medals = computeMedals(activities);
      const upcomingRaces = db.prepare(`SELECT * FROM races WHERE user_id = ? AND (race_date IS NULL OR race_date >= date('now')) ORDER BY race_date ASC LIMIT 3`).all(profileUser.id);
      return html(res, 200, views.publicProfilePage(user, profileUser, evolution, upcomingRaces, medals));
    }

    // ---------- notifications (in-app only) ----------
    if (method === 'GET' && pathname === '/api/notifications') {
      if (!user) { res.writeHead(401); return res.end('{"error":"auth"}'); }
      const notifications = db.prepare(`SELECT n.*, u.name as actor_name FROM notifications n
        JOIN users u ON u.id = n.actor_user_id
        WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 30`).all(user.id);
      const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read_at IS NULL').get(user.id).c;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ notifications, unread }));
    }
    if (method === 'POST' && pathname === '/api/notifications/read') {
      if (!user) { res.writeHead(401); return res.end('{"error":"auth"}'); }
      db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`).run(user.id);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end('{"ok":true}');
    }

    // ---------- settings ----------
    if (method === 'GET' && pathname === '/settings') {
      if (!requireAuth()) return;
      const slug = ensurePublicSlug(db, user);
      return html(res, 200, views.settingsPage(user, {
        saved: parsed.query.saved,
        stravaConnected: parsed.query.strava_connected,
        stravaError: parsed.query.strava_error,
        stravaDisconnected: parsed.query.strava_disconnected,
        stravaConfigured: strava.isConfigured(),
        publicUrl: `${baseUrl(req)}/u/${slug}`,
      }));
    }
    if (method === 'POST' && pathname === '/settings') {
      if (!requireAuth()) return;
      const goalSec = parseClock(fields.goal_time);
      const photo = files.avatar;
      if (photo && photo.data && photo.data.length) {
        const ext = (path.extname(photo.filename || '').slice(0, 5) || '').replace(/[^.a-zA-Z0-9]/g, '') || '.jpg';
        const avatarPath = `avatar_${user.id}_${Date.now()}${ext}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, avatarPath), photo.data);
        db.prepare('UPDATE users SET avatar_path=? WHERE id=?').run(avatarPath, user.id);
      }
      db.prepare('UPDATE users SET name=?, city=?, bio=?, goal_race_name=?, goal_time_sec=? WHERE id=?')
        .run(fields.name, fields.city || null, fields.bio || null, fields.goal_race_name || null, goalSec, user.id);
      return redirect(res, '/settings?saved=1');
    }
    if (method === 'POST' && pathname === '/settings/api-key') {
      if (!requireAuth()) return;
      const key = (fields.anthropic_api_key || '').trim();
      if (key && !key.includes('••')) {
        db.prepare('UPDATE users SET anthropic_api_key=? WHERE id=?').run(key, user.id);
      }
      return redirect(res, '/settings?saved=1');
    }

    // ---------- strava ----------
    if (method === 'GET' && pathname === '/strava/connect') {
      if (!requireAuth()) return;
      if (!strava.isConfigured()) return html(res, 200, views.settingsPage(user, { stravaConfigured: false }));
      const state = crypto.randomBytes(16).toString('hex');
      const redirectUri = `${baseUrl(req)}/strava/callback`;
      const authUrl = strava.getAuthorizeUrl(redirectUri, state);
      const headers = {
        location: authUrl,
        'set-cookie': serializeCookie('strava_state', state, { maxAge: 600 }),
      };
      res.writeHead(302, headers);
      return res.end();
    }
    if (method === 'GET' && pathname === '/strava/callback') {
      if (!requireAuth()) return;
      const { code, state, error } = parsed.query;
      if (error) return redirect(res, '/settings?strava_error=1');
      if (!state || state !== cookies.strava_state) return redirect(res, '/settings?strava_error=1');
      try {
        const redirectUri = `${baseUrl(req)}/strava/callback`;
        const tok = await strava.exchangeCodeForToken(code, redirectUri);
        db.prepare(`UPDATE users SET strava_athlete_id=?, strava_access_token=?, strava_refresh_token=?, strava_token_expires_at=?, strava_connected_at=datetime('now') WHERE id=?`)
          .run(String(tok.athlete && tok.athlete.id), tok.access_token, tok.refresh_token, tok.expires_at, user.id);
      } catch (e) {
        console.error(e);
        return redirect(res, '/settings?strava_error=1', serializeCookie('strava_state', '', { expire: true }));
      }
      return redirect(res, '/settings?strava_connected=1', serializeCookie('strava_state', '', { expire: true }));
    }
    if (method === 'POST' && pathname === '/strava/disconnect') {
      if (!requireAuth()) return;
      db.prepare('UPDATE users SET strava_athlete_id=NULL, strava_access_token=NULL, strava_refresh_token=NULL, strava_token_expires_at=NULL, strava_connected_at=NULL WHERE id=?').run(user.id);
      return redirect(res, '/settings?strava_disconnected=1');
    }
    if (method === 'POST' && pathname === '/strava/sync') {
      if (!requireAuth()) return;
      const full = parsed.query.full === '1' || fields.full === '1';
      const result = await strava.syncUserActivities(db, user, { full }).catch((e) => { console.error(e); return { count: 0, error: 'sync_failed' }; });
      if (result.error) return redirect(res, '/settings?strava_error=1');
      return redirect(res, `/activities?synced=${result.count}`);
    }

    // ---------- coach chat ----------
    if (method === 'GET' && pathname === '/assistant') {
      if (!requireAuth()) return;
      const messages = db.prepare('SELECT * FROM chat_messages WHERE user_id = ? AND activity_id IS NULL ORDER BY created_at ASC, id ASC').all(user.id);
      return html(res, 200, views.coachChatPage(user, messages, { aiEnabled: !!user.anthropic_api_key, error: parsed.query.error }));
    }
    if (method === 'POST' && pathname === '/assistant/clear') {
      if (!requireAuth()) return;
      db.prepare('DELETE FROM chat_messages WHERE user_id = ? AND activity_id IS NULL').run(user.id);
      return redirect(res, '/assistant');
    }

    // JSON history for the floating coach widget (lazy-loaded so it doesn't
    // slow down every page load).
    if (method === 'GET' && pathname === '/api/coach/history') {
      if (!user) { res.writeHead(401); return res.end('{"error":"auth"}'); }
      const messages = db.prepare('SELECT role, content, created_at FROM chat_messages WHERE user_id = ? AND activity_id IS NULL ORDER BY created_at ASC, id ASC').all(user.id);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ messages, aiEnabled: !!user.anthropic_api_key }));
    }

    // Same as above but scoped to one activity's own chat thread, used by the
    // "conversar com o coach sobre esse treino" widget on the activity page.
    if (method === 'GET' && (m = /^\/api\/coach\/activity\/(\d+)\/history$/.exec(pathname))) {
      if (!user) { res.writeHead(401); return res.end('{"error":"auth"}'); }
      const activity = db.prepare('SELECT id FROM activities WHERE id = ? AND user_id = ?').get(m[1], user.id);
      if (!activity) { res.writeHead(404); return res.end('{"error":"not_found"}'); }
      const messages = db.prepare('SELECT role, content, created_at FROM chat_messages WHERE user_id = ? AND activity_id = ? ORDER BY created_at ASC, id ASC').all(user.id, activity.id);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ messages, aiEnabled: !!user.anthropic_api_key }));
    }

    // Streams the coach's reply as plain chunked text so the client can type
    // it out live, word by word — used by the full chat page, the floating
    // widget, and the per-activity chat. The body is raw JSON ({message,
    // activity_id?}); the response body is the raw streamed answer text (no
    // SSE framing needed client-side). When activity_id is present, the
    // reply is grounded in that specific training's data and the thread is
    // kept separate from the athlete's general coach conversation.
    if (method === 'POST' && pathname === '/api/coach/send') {
      if (!user) { res.writeHead(401); return res.end('auth'); }
      let body = {};
      try {
        const raw = await readBody(req);
        body = JSON.parse(raw.toString('utf8') || '{}');
      } catch (e) { body = {}; }
      const text = (body.message || '').trim();
      if (!text) { res.writeHead(400); return res.end('empty'); }
      if (!user.anthropic_api_key) { res.writeHead(412); return res.end('missing_key'); }

      let activity = null;
      if (body.activity_id) {
        activity = db.prepare('SELECT * FROM activities WHERE id = ? AND user_id = ?').get(body.activity_id, user.id);
        if (!activity) { res.writeHead(404); return res.end('activity_not_found'); }
      }
      const activityId = activity ? activity.id : null;

      db.prepare('INSERT INTO chat_messages (user_id, role, content, activity_id) VALUES (?,?,?,?)').run(user.id, 'user', text, activityId);

      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-cache',
        'x-accel-buffering': 'no',
      });

      let full = '';
      try {
        const races = db.prepare('SELECT * FROM races WHERE user_id = ? ORDER BY race_date ASC').all(user.id);
        const activities = db.prepare('SELECT * FROM activities WHERE user_id = ? ORDER BY COALESCE(started_at, created_at) DESC').all(user.id);
        const evolution = computeEvolution(activities);
        let context = buildContext(user, races, activities, evolution);
        if (activity) {
          const laps = activity.laps_json ? JSON.parse(activity.laps_json) : [];
          const intervals = activity.intervals_json ? JSON.parse(activity.intervals_json) : [];
          context += '\n' + buildActivityFocusContext(activity, laps, intervals);
        }
        const priorRows = db.prepare('SELECT * FROM chat_messages WHERE user_id = ? AND activity_id IS ? ORDER BY created_at ASC, id ASC').all(user.id, activityId);
        const history = priorRows.slice(0, -1).slice(-20).map((m) => ({ role: m.role, content: m.content }));
        full = await streamChatWithAssistant(user.anthropic_api_key, context, history, text, (delta) => {
          res.write(delta);
        });
      } catch (e) {
        const msg = `Não consegui responder agora (${e.message}).`;
        if (!full) res.write(msg);
        full = full || msg;
      }
      db.prepare('INSERT INTO chat_messages (user_id, role, content, activity_id) VALUES (?,?,?,?)').run(user.id, 'assistant', full, activityId);
      return res.end();
    }

    // ---------- live coach ----------
    if (method === 'GET' && pathname === '/coach') {
      if (!requireAuth()) return;
      return html(res, 200, coachPage(user));
    }

    return notFound(res);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<h1>Erro interno</h1><pre>${(err && err.message) || err}</pre>`);
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end('Erro interno');
    }
  });
});

server.listen(PORT, () => {
  console.log(`Atletas app rodando em http://localhost:${PORT}`);
});
