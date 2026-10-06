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
const { computeEvolution, computeMedals, detectPersonalRecord, computeWeeklyStreak } = require('./lib/stats');
const { buildContext, buildActivityFocusContext, buildVoiceInstructions, streamChatWithAssistant, computeHumanDelayMs, detectImageRequest, extractWorkoutCard } = require('./lib/assistant');
const { mintRealtimeSession, synthesizeSpeech } = require('./lib/openai');
const { weekSummary, recentStories, mentionMapFor } = require('./lib/feedextras');
const { getNews } = require('./lib/news');
const { fetchNearbyRaces } = require('./lib/races');
const { buildMonthCalendar } = require('./lib/calendar');
const { ensurePublicSlug, buildShareDraft, buildPRShareDraft, REACTION_KEYS, notify, safePath, memberNumber, buildDiagnosis } = require('./lib/social');
const views = require('./views');
const { coachPage } = require('./views_coach');
const { professorPage } = require('./views_professor');

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

// AI features (Professor, Coach chat, análise automática de treino) used to
// require every single user to bring their own Anthropic API key — a real
// barrier for non-technical athletes. Felipe now covers usage on his own
// Anthropic account by default (ANTHROPIC_SHARED_API_KEY, set in Render's
// environment settings), while a user can still paste their own key in
// Configurações to use their own account/billing instead — that choice
// always wins when present.
const SHARED_ANTHROPIC_KEY = (process.env.ANTHROPIC_SHARED_API_KEY || '').trim();
function apiKeyFor(user) {
  return (user && user.anthropic_api_key) || SHARED_ANTHROPIC_KEY || '';
}

// Same bring-your-own-key pattern as the Anthropic key above, but for the
// Professor's live voice (OpenAI Realtime API) — a different provider, so a
// separate key. No SHARED_OPENAI_API_KEY is set by default (voice-to-voice
// audio is billed quite a bit higher per minute than a text reply, so this
// is left as an opt-in cost Felipe can choose to cover later by setting the
// env var in Render, exactly like he did for ANTHROPIC_SHARED_API_KEY —
// until then, each athlete pastes their own OpenAI key in Configurações).
const SHARED_OPENAI_KEY = (process.env.OPENAI_SHARED_API_KEY || '').trim();
function openaiApiKeyFor(user) {
  return (user && user.openai_api_key) || SHARED_OPENAI_KEY || '';
}

// The two fixed lines of the Professor's "bom dia" ritual, synthesized once
// (by whichever athlete's OpenAI key hits it first) and kept in memory.
const BOMDIA_LINES = { '1': 'Bom dia, meu atleta!', '2': 'Como você está hoje? Como foram os treinos?' };
const bomdiaVoiceCache = new Map(); // line -> Promise<Buffer>

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

  // Generic static asset serving for public/ (images used by marketing
  // pages, currently just the landing hero shot) — filename only, no
  // subdirectories, same traversal guard as the /uploads handler below.
  const assetMatch = method === 'GET' ? /^\/assets\/([a-zA-Z0-9._-]+)$/.exec(pathname) : null;
  if (assetMatch) {
    const PUBLIC_DIR = path.join(__dirname, 'public');
    const filePath = path.join(PUBLIC_DIR, assetMatch[1]);
    if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) return notFound(res);
    const ext = path.extname(filePath).toLowerCase();
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=604800' });
    return res.end(fs.readFileSync(filePath));
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

  let fields = {}, files = {}, filesAll = [];
  if (isForm) {
    const buf = await readBody(req).catch(() => null);
    fields = buf ? parseUrlEncoded(buf) : {};
  } else if (isMultipart) {
    try {
      const buf = await readBody(req, 45 * 1024 * 1024);
      ({ fields, files, filesAll } = parseMultipart(buf, req.headers['content-type']));
    } catch (e) {
      return html(res, 413, 'Arquivo muito grande.');
    }
  }

  const requireAuth = () => { if (!user) { redirect(res, '/login'); return false; } return true; };
  // 404s (not a redirect) for a logged-in non-admin — the admin dashboard's
  // existence isn't something a regular athlete needs to know about.
  const requireAdmin = () => {
    if (!user) { redirect(res, '/login'); return false; }
    if (!user.is_admin) { notFound(res); return false; }
    return true;
  };

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
        return html(res, 200, views.signupPage('Preencha todos os campos (senha com 6+ caracteres).', fields));
      }
      const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (exists) return html(res, 200, views.signupPage('Já existe uma conta com este e-mail.', fields));
      const { hash, salt } = hashPassword(fields.password);
      const EXPERIENCE_VALUES = ['iniciante', 'intermediario', 'avancado'];
      const experienceLevel = EXPERIENCE_VALUES.includes(fields.experience_level) ? fields.experience_level : null;
      const weeklyKm = fields.weekly_km ? parseFloat(String(fields.weekly_km).replace(',', '.')) : null;
      const goalTimeSec = fields.goal_time ? parseClock(fields.goal_time) : null;
      const info = db.prepare(`INSERT INTO users
          (name, email, password_hash, password_salt, experience_level, weekly_km, goal_race_name, goal_time_sec, injury_notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(fields.name.trim(), email, hash, salt, experienceLevel, Number.isFinite(weeklyKm) ? weeklyKm : null,
          (fields.goal_race_name || '').trim() || null, goalTimeSec, (fields.injury_notes || '').trim() || null);
      db.prepare('UPDATE users SET member_number = (SELECT COALESCE(MAX(member_number), 0) + 1 FROM users WHERE id != ?) WHERE id = ?').run(info.lastInsertRowid, info.lastInsertRowid);
      const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
      ensurePublicSlug(db, newUser);
      const token = createSession(newUser.id);
      return redirect(res, '/welcome', serializeCookie('session', token, { maxAge: 30 * 24 * 3600 }));
    }

    if (method === 'GET' && pathname === '/logout') {
      destroySession(cookies.session);
      return redirect(res, '/login', serializeCookie('session', '', { expire: true }));
    }

    // One-time (but revisitable) welcome screen right after signup: shows the
    // athlete's member number and a short personalized read built from the
    // pre-diagnosis fields they just filled in (see buildDiagnosis).
    if (method === 'GET' && pathname === '/welcome') {
      if (!requireAuth()) return;
      return html(res, 200, views.welcomePage(user, {
        stravaConfigured: strava.isConfigured(),
        stravaConnected: parsed.query.strava_connected,
        stravaError: parsed.query.strava_error,
      }));
    }

    // ---------- discover (find other athletes, Strava-style) ----------
    if (method === 'GET' && pathname === '/discover') {
      if (!requireAuth()) return;
      const q = (parsed.query.q || '').trim();
      let rows;
      if (q) {
        rows = db.prepare(`SELECT * FROM users WHERE id != ? AND (name LIKE ? OR city LIKE ?) ORDER BY name ASC LIMIT 40`)
          .all(user.id, `%${q}%`, `%${q}%`);
      } else {
        rows = db.prepare(`SELECT * FROM users WHERE id != ? ORDER BY created_at DESC LIMIT 40`).all(user.id);
      }
      const followingIds = new Set(db.prepare('SELECT followee_id FROM follows WHERE follower_id = ?').all(user.id).map((r) => r.followee_id));
      const athletes = rows.map((u) => {
        ensurePublicSlug(db, u);
        const activities = db.prepare('SELECT * FROM activities WHERE user_id = ?').all(u.id);
        const evolution = computeEvolution(activities);
        const followerCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE followee_id = ?').get(u.id).c;
        return { user: u, evolution, followerCount, isFollowing: followingIds.has(u.id) };
      });
      return html(res, 200, views.discoverPage(user, athletes, q));
    }

    // ---------- dashboard ----------
    if (method === 'GET' && pathname === '/') {
      if (!user) return html(res, 200, views.landingPage());
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
      const weeklyStreak = computeWeeklyStreak(allActivities);

      let calYear = today.getFullYear(), calMonth = today.getMonth() + 1;
      if (parsed.query.month && /^\d{4}-\d{2}$/.test(parsed.query.month)) {
        const [y, mo] = parsed.query.month.split('-').map((n) => parseInt(n, 10));
        if (y >= 2000 && mo >= 1 && mo <= 12) { calYear = y; calMonth = mo; }
      }
      const calendar = buildMonthCalendar(calYear, calMonth, allActivities, races);

      return html(res, 200, views.dashboardPage({ user, nextRace, daysToRace, recentActivities, weekKm, evolution, medals, calendar, weeklyStreak }));
    }

    // ---------- races ----------
    if (method === 'GET' && pathname === '/races') {
      if (!requireAuth()) return;
      const races = db.prepare('SELECT * FROM races WHERE user_id = ? ORDER BY race_date ASC').all(user.id);
      const region = ['auto', 'litoral', 'pr', 'custom'].includes(parsed.query.region) ? parsed.query.region : 'auto';
      const customQuery = (parsed.query.q || '').trim();
      const nearbyRaces = await fetchNearbyRaces({ city: user.city, days: 60, region, customQuery });
      return html(res, 200, views.racesPage(user, races, nearbyRaces, parsed.query.added, region, customQuery));
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
        (user_id, race_id, title, workout_type, source, raw_filename, distance_km, duration_sec, avg_pace_sec, avg_hr, max_hr, elevation_gain_m, started_at, laps_json, route_polyline)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
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
        JSON.stringify(summary.laps),
        summary.route_polyline || null
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
      const allActivities = db.prepare('SELECT * FROM activities WHERE user_id = ?').all(user.id);
      activity.zones_obs_max = allActivities.reduce((mx, a) => Math.max(mx, a.max_hr || 0), 0);
      const evolution = computeEvolution(allActivities);
      const prInfo = detectPersonalRecord(activity, allActivities);
      const alreadyShared = !!db.prepare('SELECT 1 FROM posts WHERE activity_id = ?').get(activity.id);
      return html(res, 200, views.activityDetailPage({ user, activity, laps, intervals, evolution, prInfo, alreadyShared, aiEnabled: !!apiKeyFor(user) }));
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
        const text = await analyzeActivity(apiKeyFor(user), activity, laps, intervals);
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
    // Shared feed: every registered athlete sees everyone else's posts by
    // default (no follow graph required to see someone — see README's "sem
    // grafo social" note, superseded per the athlete's own request). Follows
    // (below) are a curation layer on top of that: scope=following narrows
    // the same feed to just your own posts + people you follow, it never
    // hides anyone from the default "Todos" view.
    const FEED_PAGE_SIZE = 20;
    if (method === 'GET' && pathname === '/feed') {
      if (!requireAuth()) return;
      if (parsed.query.view === 'noticias') {
        const newsCat = (parsed.query.cat || '').toString();
        const news = await getNews(newsCat);
        return html(res, 200, views.feedPage(user, [], { view: 'noticias', news, newsCat }));
      }
      const scope = parsed.query.scope === 'following' ? 'following' : 'all';
      const beforeId = parsed.query.before_id ? parseInt(parsed.query.before_id, 10) : null;

      const view = parsed.query.view === 'meu' ? 'meu' : 'pub';
      const where = [];
      const params = [];
      if (beforeId) { where.push('p.id < ?'); params.push(beforeId); }
      if (view === 'meu') {
        where.push('p.user_id = ?');
        params.push(user.id);
      } else if (scope === 'following') {
        where.push('(p.user_id = ? OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))');
        params.push(user.id, user.id);
      }
      const tag = (parsed.query.tag || '').toString().toLowerCase().replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 40);
      if (tag) { where.push("LOWER(p.body) LIKE ? ESCAPE '\\'"); params.push('%#' + tag + '%'); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const rows = db.prepare(`SELECT p.*, a.title as activity_title, a.workout_type as activity_workout_type,
          a.distance_km as activity_distance_km, a.duration_sec as activity_duration_sec,
          a.avg_pace_sec as activity_avg_pace_sec, a.elevation_gain_m as activity_elevation_gain_m,
          a.source as activity_source, a.laps_json as activity_laps_json,
          a.route_polyline as activity_route_polyline, a.started_at as activity_started_at, u.city as author_city,
          a.intervals_json as activity_intervals_json, a.avg_hr as activity_avg_hr, u.hr_zones_json as author_hr_zones_json,
          (SELECT MAX(max_hr) FROM activities WHERE user_id = p.user_id) as author_obs_max_hr,
          u.name as author_name, u.public_slug as author_slug, u.avatar_path as author_avatar_path
        FROM posts p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN activities a ON a.id = p.activity_id
        ${whereSql}
        ORDER BY p.id DESC LIMIT ?`).all(...params, FEED_PAGE_SIZE + 1);

      const hasMore = rows.length > FEED_PAGE_SIZE;
      const posts = rows.slice(0, FEED_PAGE_SIZE);
      const nextBeforeId = hasMore ? posts[posts.length - 1].id : null;
      // Pace-by-km chart on the card (see paceBarsHtml in views.js) — parsed
      // here rather than shipping the raw JSON column into the view layer.
      posts.forEach((p) => {
        try { p.activity_laps = p.activity_laps_json ? JSON.parse(p.activity_laps_json) : null; }
        catch (e) { p.activity_laps = null; }
        let photos = [];
        try { photos = p.photos_json ? JSON.parse(p.photos_json) : []; } catch (e) { photos = []; }
        if (!photos.length && p.photo_path) photos = [p.photo_path];
        p.photos = photos;
      });

      // Specific PR wording ("Pace mais rápido já registrado em ~20km")
      // instead of a bare "Recorde" badge — recomputed here against the
      // author's current full history (not stored at post-creation time, so
      // it stays accurate even if later runs change the picture), batched
      // per author so a page with several posts from the same athlete only
      // loads their activities once.
      const prPosts = posts.filter((p) => p.is_pr && p.activity_id);
      if (prPosts.length) {
        const activitiesByAuthor = new Map();
        for (const p of prPosts) {
          if (!activitiesByAuthor.has(p.user_id)) {
            activitiesByAuthor.set(p.user_id, db.prepare('SELECT * FROM activities WHERE user_id = ?').all(p.user_id));
          }
          const authorActivities = activitiesByAuthor.get(p.user_id);
          const activity = authorActivities.find((a) => a.id === p.activity_id);
          if (activity) {
            const pr = detectPersonalRecord(activity, authorActivities);
            if (pr.isPR) p.pr_label = pr.label;
          }
        }
      }

      if (posts.length) {
        const placeholders = posts.map(() => '?').join(',');
        const postIds = posts.map((p) => p.id);
        const comments = db.prepare(`SELECT c.*, u.name as author_name, u.avatar_path as author_avatar_path FROM comments c
          JOIN users u ON u.id = c.user_id
          WHERE c.post_id IN (${placeholders}) ORDER BY c.created_at ASC`).all(...postIds);
        const byPost = new Map();
        for (const c of comments) {
          if (!byPost.has(c.post_id)) byPost.set(c.post_id, []);
          byPost.get(c.post_id).push(c);
        }

        // Reaction counts per type + which types the current viewer already
        // used, grouped in JS rather than N separate subqueries per post —
        // one query for the whole page either way, this just avoids 4x the
        // subqueries now that there are 4 reaction types instead of 1.
        const reactionRows = db.prepare(`SELECT post_id, user_id, type FROM reactions WHERE post_id IN (${placeholders})`).all(...postIds);
        const reactionsByPost = new Map();
        for (const r of reactionRows) {
          if (!reactionsByPost.has(r.post_id)) reactionsByPost.set(r.post_id, { counts: {}, mine: new Set() });
          const entry = reactionsByPost.get(r.post_id);
          entry.counts[r.type] = (entry.counts[r.type] || 0) + 1;
          if (r.user_id === user.id) entry.mine.add(r.type);
        }

        posts.forEach((p) => {
          p.comments = byPost.get(p.id) || [];
          const entry = reactionsByPost.get(p.id);
          p.reactionCounts = entry ? entry.counts : {};
          p.myReactions = entry ? entry.mine : new Set();
        });
      }

      let shareDraft = null, shareActivity = null, isPrShare = false;
      if (parsed.query.share_activity) {
        shareActivity = db.prepare('SELECT * FROM activities WHERE id = ? AND user_id = ?').get(parsed.query.share_activity, user.id);
        if (shareActivity) {
          if (parsed.query.pr === '1') {
            const otherActivities = db.prepare('SELECT * FROM activities WHERE user_id = ?').all(user.id);
            const prInfo = detectPersonalRecord(shareActivity, otherActivities);
            shareDraft = buildPRShareDraft(shareActivity, prInfo);
            isPrShare = true;
          } else {
            shareDraft = buildShareDraft(shareActivity);
          }
        }
      }

      // A quick-pick list of recent trainings not yet posted, so opening the
      // Feed directly (not via "Compartilhar treino" on an activity) doesn't
      // start from a blank composer with no obvious next step.
      let recentUnshared = db.prepare(`SELECT id, title, workout_type, distance_km, avg_pace_sec, started_at, created_at FROM activities
        WHERE user_id = ? AND id NOT IN (SELECT activity_id FROM posts WHERE activity_id IS NOT NULL)
        ORDER BY COALESCE(started_at, created_at) DESC LIMIT 8`).all(user.id);
      // Sem escolha explícita, já deixa o treino mais recente selecionado.
      if (!shareActivity && recentUnshared.length) shareActivity = db.prepare('SELECT * FROM activities WHERE id = ?').get(recentUnshared[0].id);
      if (shareActivity && !recentUnshared.some((a) => a.id === shareActivity.id)) recentUnshared.unshift(shareActivity);

      let week = null, stories = [];
      let profile = null;
      if (view === 'meu') {
        profile = {
          posts: db.prepare('SELECT COUNT(*) AS c FROM posts WHERE user_id = ?').get(user.id).c,
          followers: db.prepare('SELECT COUNT(*) AS c FROM follows WHERE followee_id = ?').get(user.id).c,
          following: db.prepare('SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?').get(user.id).c,
        };
      }
      if (!beforeId && !tag && view === 'pub') {
        try { week = weekSummary(db, user, computeWeeklyStreak); } catch (e) { console.error('[feed week]', e.message); }
        try { stories = recentStories(db, user); } catch (e) { console.error('[feed stories]', e.message); }
      }
      let mentionMap = {};
      try { mentionMap = mentionMapFor(db, posts); } catch (e) { /* menções são opcionais */ }

      return html(res, 200, views.feedPage(user, posts, {
        shareDraft, shareActivity, isPrShare, recentUnshared, scope, nextBeforeId, beforeId, week, stories, mentionMap, tag, view, profile, editBio: parsed.query.edit === '1',
      }));
    }
    if (method === 'POST' && pathname === '/feed') {
      if (!requireAuth()) return;
      const wantsJson = (req.headers['x-requested-with'] || '') === 'fetch';
      const body = (fields.body || '').trim().slice(0, 2200);
      const location = (fields.location || '').trim().slice(0, 80) || null;
      // O treino precisa ser do próprio atleta.
      let activityId = null;
      if (fields.activity_id) {
        const act = db.prepare('SELECT id FROM activities WHERE id = ? AND user_id = ?').get(parseInt(fields.activity_id, 10), user.id);
        if (act) activityId = act.id;
      }
      // Fotos (até 6): só imagens, nome gerado no servidor.
      const saved = [];
      const okExt = { '.jpg': 1, '.jpeg': 1, '.png': 1, '.webp': 1, '.gif': 1 };
      for (const f of filesAll.filter((x) => x.name === 'photo').slice(0, 6)) {
        if (!f.data || !f.data.length || f.data.length > 12 * 1024 * 1024) continue;
        let ext = path.extname(f.filename || '').toLowerCase();
        if (!okExt[ext]) {
          const ct = (f.contentType || '').toLowerCase();
          ext = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : ct.includes('gif') ? '.gif' : ct.includes('jpeg') || ct.includes('jpg') ? '.jpg' : '';
        }
        if (!ext) continue;
        const name = `post_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, name), f.data);
        saved.push(name);
      }
      // Todo post leva um treino (mapa, zonas, pace) e uma legenda.
      if (!activityId || !body) {
        saved.forEach((n) => fs.promises.unlink(path.join(UPLOAD_DIR, n)).catch(() => {}));
        const error = !activityId ? 'Escolha o treino que vai compartilhar.' : 'Escreva uma legenda para o post.';
        if (wantsJson) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error })); }
        return redirect(res, '/feed');
      }
      db.prepare('INSERT INTO posts (user_id, activity_id, body, photo_path, photos_json, location, is_pr) VALUES (?,?,?,?,?,?,?)')
        .run(user.id, activityId, body, saved[0] || null, saved.length ? JSON.stringify(saved) : null, location, fields.is_pr === '1' ? 1 : 0);
      const dest = '/feed';
      if (wantsJson) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, redirect: dest })); }
      return redirect(res, dest);
    }
    if (method === 'POST' && pathname === '/feed/bio') {
      if (!requireAuth()) return;
      const bio = (fields.bio || '').trim().slice(0, 300);
      db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio || null, user.id);
      return redirect(res, '/feed?view=meu');
    }
    if (method === 'POST' && (m = /^\/feed\/(\d+)\/react$/.exec(pathname))) {
      if (!requireAuth()) return;
      const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(m[1]);
      if (!post) return notFound(res);
      const type = REACTION_KEYS.includes(fields.type) ? fields.type : 'kudos';
      const existing = db.prepare('SELECT id FROM reactions WHERE post_id = ? AND user_id = ? AND type = ?').get(post.id, user.id, type);
      if (existing) {
        db.prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
      } else {
        db.prepare('INSERT INTO reactions (post_id, user_id, type) VALUES (?,?,?)').run(post.id, user.id, type);
        const emoji = { kudos: '👏', fire: '🔥', pr: '🏆', strong: '💪' }[type] || '👏';
        notify(db, { userId: post.user_id, actorUserId: user.id, type: 'kudos', postId: post.id, body: `${user.name} reagiu ${emoji} ao seu post` });
      }
      return redirect(res, safePath(fields.return_to, ['/feed'], '/feed'));
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
      return redirect(res, safePath(fields.return_to, ['/feed'], '/feed'));
    }
    // Only the post's own author can remove it — cleans up its photo file
    // (if any) and every row that references it (reactions, comments,
    // notifications) since this DB has no ON DELETE CASCADE set up.
    if (method === 'POST' && (m = /^\/feed\/(\d+)\/delete$/.exec(pathname))) {
      if (!requireAuth()) return;
      const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(m[1]);
      if (!post) return notFound(res);
      if (post.user_id !== user.id) { res.writeHead(403); return res.end('Você só pode excluir seus próprios posts.'); }
      if (post.photo_path) {
        const photoFile = path.join(UPLOAD_DIR, post.photo_path);
        fs.promises.unlink(photoFile).catch(() => {});
      }
      db.prepare('DELETE FROM reactions WHERE post_id = ?').run(post.id);
      db.prepare('DELETE FROM comments WHERE post_id = ?').run(post.id);
      db.prepare('DELETE FROM notifications WHERE post_id = ?').run(post.id);
      db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
      return redirect(res, safePath(fields.return_to, ['/feed'], '/feed'));
    }

    // ---------- public profile (no login) ----------
    if (method === 'GET' && (m = /^\/u\/([a-zA-Z0-9-]+)$/.exec(pathname))) {
      const profileUser = db.prepare('SELECT * FROM users WHERE public_slug = ?').get(m[1]);
      if (!profileUser) return notFound(res);
      const activities = db.prepare('SELECT * FROM activities WHERE user_id = ?').all(profileUser.id);
      const evolution = computeEvolution(activities);
      const medals = computeMedals(activities);
      const weeklyStreak = computeWeeklyStreak(activities);
      const upcomingRaces = db.prepare(`SELECT * FROM races WHERE user_id = ? AND (race_date IS NULL OR race_date >= date('now')) ORDER BY race_date ASC LIMIT 3`).all(profileUser.id);
      const followerCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE followee_id = ?').get(profileUser.id).c;
      const followingCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?').get(profileUser.id).c;
      const isFollowing = !!user && user.id !== profileUser.id &&
        !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(user.id, profileUser.id);
      return html(res, 200, views.publicProfilePage(user, profileUser, evolution, upcomingRaces, medals, { followerCount, followingCount, isFollowing, weeklyStreak }));
    }
    if (method === 'POST' && (m = /^\/u\/([a-zA-Z0-9-]+)\/follow$/.exec(pathname))) {
      if (!requireAuth()) return;
      const profileUser = db.prepare('SELECT * FROM users WHERE public_slug = ?').get(m[1]);
      if (!profileUser) return notFound(res);
      if (profileUser.id !== user.id) {
        const existing = db.prepare('SELECT id FROM follows WHERE follower_id = ? AND followee_id = ?').get(user.id, profileUser.id);
        if (existing) {
          db.prepare('DELETE FROM follows WHERE id = ?').run(existing.id);
        } else {
          db.prepare('INSERT INTO follows (follower_id, followee_id) VALUES (?,?)').run(user.id, profileUser.id);
          notify(db, { userId: profileUser.id, actorUserId: user.id, type: 'follow', body: `${user.name} passou a seguir você` });
        }
      }
      return redirect(res, safePath(fields.return_to, ['/u/', '/discover'], `/u/${m[1]}`));
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
        aiSharedAvailable: !!SHARED_ANTHROPIC_KEY,
        aiVoiceSharedAvailable: !!SHARED_OPENAI_KEY,
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
    if (method === 'POST' && pathname === '/settings/openai-api-key') {
      if (!requireAuth()) return;
      const key = (fields.openai_api_key || '').trim();
      if (key && !key.includes('••')) {
        db.prepare('UPDATE users SET openai_api_key=? WHERE id=?').run(key, user.id);
      }
      return redirect(res, '/settings?saved=1');
    }

    // ---------- strava ----------
    if (method === 'GET' && pathname === '/strava/connect') {
      if (!requireAuth()) return;
      if (!strava.isConfigured()) return html(res, 200, views.settingsPage(user, { stravaConfigured: false, aiSharedAvailable: !!SHARED_ANTHROPIC_KEY, aiVoiceSharedAvailable: !!SHARED_OPENAI_KEY }));
      const state = crypto.randomBytes(16).toString('hex');
      const redirectUri = `${baseUrl(req)}/strava/callback`;
      const authUrl = strava.getAuthorizeUrl(redirectUri, state);
      // Lets the welcome screen send people through the OAuth dance and get
      // dropped back on /welcome afterwards instead of /settings — a
      // brand-new signup hasn't seen the rest of the app yet, so landing on
      // Settings right away would feel like a detour. Only a known internal
      // destination is accepted here, never an arbitrary redirect target.
      const returnTo = parsed.query.return_to === 'welcome' ? 'welcome' : '';
      const setCookies = [serializeCookie('strava_state', state, { maxAge: 600 })];
      if (returnTo) setCookies.push(serializeCookie('strava_return_to', returnTo, { maxAge: 600 }));
      const headers = {
        location: authUrl,
        'set-cookie': setCookies,
      };
      res.writeHead(302, headers);
      return res.end();
    }
    if (method === 'GET' && pathname === '/strava/callback') {
      if (!requireAuth()) return;
      const { code, state, error } = parsed.query;
      const returnTo = cookies.strava_return_to === 'welcome' ? '/welcome' : '/settings';
      const clearCookies = [serializeCookie('strava_state', '', { expire: true }), serializeCookie('strava_return_to', '', { expire: true })];
      if (error) return redirect(res, `${returnTo}?strava_error=1`, clearCookies);
      if (!state || state !== cookies.strava_state) return redirect(res, `${returnTo}?strava_error=1`, clearCookies);
      try {
        const redirectUri = `${baseUrl(req)}/strava/callback`;
        const tok = await strava.exchangeCodeForToken(code, redirectUri);
        db.prepare(`UPDATE users SET strava_athlete_id=?, strava_access_token=?, strava_refresh_token=?, strava_token_expires_at=?, strava_connected_at=datetime('now') WHERE id=?`)
          .run(String(tok.athlete && tok.athlete.id), tok.access_token, tok.refresh_token, tok.expires_at, user.id);
      } catch (e) {
        console.error(e);
        return redirect(res, `${returnTo}?strava_error=1`, clearCookies);
      }
      return redirect(res, `${returnTo}?strava_connected=1`, clearCookies);
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
      let activeActivity = null;
      if (parsed.query.activity) {
        activeActivity = db.prepare('SELECT * FROM activities WHERE id = ? AND user_id = ?').get(parsed.query.activity, user.id) || null;
      }
      const activeActivityId = activeActivity ? activeActivity.id : null;
      const messages = db.prepare('SELECT * FROM chat_messages WHERE user_id = ? AND activity_id IS ? ORDER BY created_at ASC, id ASC').all(user.id, activeActivityId);
      return html(res, 200, views.coachChatPage(user, messages, {
        aiEnabled: !!apiKeyFor(user),
        error: parsed.query.error,
        activeActivityId,
        activeTitle: activeActivity ? activeActivity.title : 'Geral',
      }));
    }
    if (method === 'POST' && pathname === '/assistant/clear') {
      if (!requireAuth()) return;
      const rawId = (fields.activity_id || '').trim();
      const activityId = rawId ? Number(rawId) : null;
      db.prepare('DELETE FROM chat_messages WHERE user_id = ? AND activity_id IS ?').run(user.id, activityId);
      return redirect(res, activityId ? `/assistant?activity=${activityId}` : '/assistant');
    }

    // Lists the athlete's coach conversations for the /assistant sidebar:
    // the always-present general thread plus one per activity that already
    // has messages (most recent first), and separately the activities that
    // don't have a thread yet, for the "nova conversa" picker.
    if (method === 'GET' && pathname === '/api/coach/threads') {
      if (!user) { res.writeHead(401); return res.end('{"error":"auth"}'); }
      const rows = db.prepare(`
        SELECT cm.activity_id AS activityId, a.title AS activityTitle
        FROM chat_messages cm
        LEFT JOIN activities a ON a.id = cm.activity_id
        WHERE cm.user_id = ?
        GROUP BY cm.activity_id
      `).all(user.id);
      if (!rows.some((r) => r.activityId == null)) {
        rows.unshift({ activityId: null, activityTitle: null });
      }
      const threads = rows.map((r) => {
        const last = db.prepare('SELECT content, created_at FROM chat_messages WHERE user_id = ? AND activity_id IS ? ORDER BY created_at DESC, id DESC LIMIT 1').get(user.id, r.activityId);
        return {
          activityId: r.activityId,
          title: r.activityId ? (r.activityTitle || 'Treino') : 'Geral',
          date: last ? last.created_at : null,
          snippet: last ? last.content.slice(0, 90) : '',
        };
      }).sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return b.date.localeCompare(a.date);
      });
      const startable = db.prepare(`
        SELECT id AS activityId, title, started_at AS startedAt
        FROM activities
        WHERE user_id = ? AND id NOT IN (SELECT COALESCE(activity_id, -1) FROM chat_messages WHERE user_id = ?)
        ORDER BY COALESCE(started_at, created_at) DESC
        LIMIT 20
      `).all(user.id, user.id);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ threads, startable }));
    }

    // Deletes a whole coach conversation (all its messages). For the general
    // thread this just empties it — it always stays in the list — while an
    // activity thread disappears from "Conversas" and returns to the "nova
    // conversa" picker until the athlete starts it again.
    if (method === 'POST' && pathname === '/api/coach/threads/delete') {
      if (!user) { res.writeHead(401); return res.end('{"error":"auth"}'); }
      let body = {};
      try {
        const raw = await readBody(req);
        body = JSON.parse(raw.toString('utf8') || '{}');
      } catch (e) { body = {}; }
      const activityId = body.activity_id ? Number(body.activity_id) : null;
      db.prepare('DELETE FROM chat_messages WHERE user_id = ? AND activity_id IS ?').run(user.id, activityId);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true }));
    }

    // JSON history for the floating coach widget (lazy-loaded so it doesn't
    // slow down every page load).
    if (method === 'GET' && pathname === '/api/coach/history') {
      if (!user) { res.writeHead(401); return res.end('{"error":"auth"}'); }
      const messages = db.prepare('SELECT role, content, created_at FROM chat_messages WHERE user_id = ? AND activity_id IS NULL ORDER BY created_at ASC, id ASC').all(user.id);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ messages, aiEnabled: !!apiKeyFor(user) }));
    }

    // Same as above but scoped to one activity's own chat thread, used by the
    // "conversar com o coach sobre esse treino" widget on the activity page.
    if (method === 'GET' && (m = /^\/api\/coach\/activity\/(\d+)\/history$/.exec(pathname))) {
      if (!user) { res.writeHead(401); return res.end('{"error":"auth"}'); }
      const activity = db.prepare('SELECT id FROM activities WHERE id = ? AND user_id = ?').get(m[1], user.id);
      if (!activity) { res.writeHead(404); return res.end('{"error":"not_found"}'); }
      const messages = db.prepare('SELECT role, content, created_at FROM chat_messages WHERE user_id = ? AND activity_id = ? ORDER BY created_at ASC, id ASC').all(user.id, activity.id);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ messages, aiEnabled: !!apiKeyFor(user) }));
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
      if (!apiKeyFor(user)) { res.writeHead(412); return res.end('missing_key'); }
      // The Professor page sends voice:true — it's a live spoken
      // conversation during a run, not a WhatsApp-style text thread, so the
      // reply needs to start (and read aloud) differently: no artificial
      // "humano lendo a mensagem" delay (dead air mid-run reads as the
      // Professor being broken, not as realism), lower thinking effort for
      // a faster first word, and a persona note so the model doesn't read
      // out something only legible on screen (a "·"-separated splits list,
      // for instance).
      const isVoice = body.voice === true;

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
        if (isVoice) {
          context += '\n\nEsta conversa está acontecendo por VOZ, ao vivo, durante a corrida do atleta — ele está te ouvindo por um sintetizador de fala, não lendo texto na tela. Isso muda a forma da resposta: 1 frase, no máximo 2, bem curtas; NUNCA liste splits/paces em sequência separados por "·" ou vírgula (regra 9 não se aplica aqui — isso é ilegível em voz alta), cite no máximo um número, falado como alguém falaria em voz alta; nunca use qualquer formatação visual. Se a pergunta pedir uma análise longa, responda só o ponto mais importante e diga que pode detalhar mais se ele quiser.';
        }
        const priorRows = db.prepare('SELECT * FROM chat_messages WHERE user_id = ? AND activity_id IS ? ORDER BY created_at ASC, id ASC').all(user.id, activityId);
        const history = priorRows.slice(0, -1).slice(-20).map((m) => ({ role: m.role, content: m.content }));
        // A human treinador never replies the instant a WhatsApp message
        // lands — hold briefly before the reply starts streaming in. That
        // realism is backwards for a live spoken exchange: dead air after
        // you finish talking just reads as the Professor hanging, so voice
        // skips straight to streaming.
        if (!isVoice) {
          await new Promise((resolve) => setTimeout(resolve, computeHumanDelayMs(text.length)));
        }
        full = await streamChatWithAssistant(apiKeyFor(user), context, history, text, (delta) => {
          res.write(delta);
        }, { effort: isVoice ? 'low' : 'medium' });

        // A request for a visual ("manda uma imagem desse treino", "quero em
        // stories"...) gets a second, separate, non-streaming call that
        // extracts a small structured "card" from the conversation (see
        // extractWorkoutCard) — kept entirely apart from the persona reply
        // above so the chat's own no-markdown/no-emoji house style is never
        // touched. The card rides along as a sentinel appended after the
        // human reply; the client (COACH_CHAT_SCRIPT) strips it out of the
        // visible text and draws it on a canvas instead. Silently skipped
        // (no sentinel at all) when the conversation doesn't actually pin
        // down a specific workout to draw.
        if (detectImageRequest(text)) {
          const card = await extractWorkoutCard(apiKeyFor(user), context, history, text).catch(() => null);
          if (card) {
            const sentinel = `\n[[STORY_CARD]]${JSON.stringify(card)}[[/STORY_CARD]]`;
            res.write(sentinel);
            full += sentinel;
          }
        }
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

    // ---------- professor (voice/JARVIS-style front end) ----------
    // The page itself still shares the coach's persona/training data with
    // /assistant (see buildVoiceInstructions, which starts from the exact
    // same buildContext as the text chat) — but the live conversation now
    // runs over a direct WebRTC connection to OpenAI's Realtime API
    // (voice-to-voice, see /api/professor/realtime-session below and
    // lib/openai.js), not through /api/coach/send + the Anthropic text
    // stream + browser TTS like the text chat still does.
    if (method === 'GET' && pathname === '/professor') {
      if (!requireAuth()) return;
      return html(res, 200, professorPage(user, { voiceEnabled: !!openaiApiKeyFor(user) }));
    }

    // Mints a short-lived OpenAI Realtime API session for the Professor's
    // live voice call — called by the browser right when "Hey Professor"
    // (or the manual start) is heard, never on page load, so the athlete
    // only spends Realtime API minutes while an actual call is open. The
    // ephemeral client secret this returns expires in minutes and can only
    // open a Realtime session, so it's safe to hand to the browser (unlike
    // the athlete's real OpenAI key, which never leaves this server).
    if (method === 'POST' && pathname === '/api/professor/realtime-session') {
      if (!user) { res.writeHead(401); return res.end(JSON.stringify({ error: 'auth' })); }
      const key = openaiApiKeyFor(user);
      if (!key) { res.writeHead(412, { 'content-type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'missing_key' })); }
      try {
        const races = db.prepare('SELECT * FROM races WHERE user_id = ? ORDER BY race_date ASC').all(user.id);
        const activities = db.prepare('SELECT * FROM activities WHERE user_id = ? ORDER BY COALESCE(started_at, created_at) DESC').all(user.id);
        const evolution = computeEvolution(activities);
        const instructions = buildVoiceInstructions(user, races, activities, evolution);
        const session = await mintRealtimeSession(key, instructions);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(session));
      } catch (e) {
        console.error('realtime-session error', e);
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'realtime_failed', message: e.message }));
      }
    }

    // The ritual's two spoken lines as ready-made MP3s (see synthesizeSpeech).
    if (method === 'GET' && pathname === '/api/professor/bomdia-voice') {
      if (!user) { res.writeHead(401); return res.end(JSON.stringify({ error: 'auth' })); }
      const line = String((parsed.query && parsed.query.line) || '');
      const text = BOMDIA_LINES[line];
      if (!text) { res.writeHead(400); return res.end(JSON.stringify({ error: 'bad_line' })); }
      let pending = bomdiaVoiceCache.get(line);
      if (!pending) {
        const key = openaiApiKeyFor(user);
        if (!key) { res.writeHead(412, { 'content-type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'missing_key' })); }
        pending = synthesizeSpeech(key, text);
        bomdiaVoiceCache.set(line, pending);
        pending.catch(() => { if (bomdiaVoiceCache.get(line) === pending) bomdiaVoiceCache.delete(line); }); // never cache a failure
      }
      try {
        const buf = await pending;
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': buf.length, 'cache-control': 'private, max-age=86400' });
        return res.end(buf);
      } catch (e) {
        console.error('bomdia-voice error', e.status || '', e.detail || e.message);
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'tts_failed', status: e.status || null }));
      }
    }

    // ---------- admin (Felipe-only — gated by users.is_admin) ----------
    if (method === 'GET' && pathname === '/admin') {
      if (!requireAdmin()) return;
      const users = db.prepare(`
        SELECT u.*, (SELECT COUNT(*) FROM activities a WHERE a.user_id = u.id) AS activity_count
        FROM users u ORDER BY u.id ASC
      `).all();
      const stats = {
        totalUsers: users.length,
        totalActivities: db.prepare('SELECT COUNT(*) AS n FROM activities').get().n,
        stravaConnected: users.filter((u) => u.strava_refresh_token).length,
        withOwnKey: users.filter((u) => u.anthropic_api_key).length,
      };
      return html(res, 200, views.adminPage(user, { users, stats }));
    }
    if (method === 'GET' && (m = /^\/admin\/users\/(\d+)$/.exec(pathname))) {
      if (!requireAdmin()) return;
      const athlete = db.prepare('SELECT * FROM users WHERE id = ?').get(m[1]);
      if (!athlete) return notFound(res);
      const activities = db.prepare('SELECT * FROM activities WHERE user_id = ? ORDER BY COALESCE(started_at, created_at) DESC').all(athlete.id);
      const posts = db.prepare('SELECT id FROM posts WHERE user_id = ?').all(athlete.id);
      return html(res, 200, views.adminUserDetailPage(user, { athlete, activities, posts }));
    }
    if (method === 'POST' && (m = /^\/admin\/users\/(\d+)\/delete$/.exec(pathname))) {
      if (!requireAdmin()) return;
      const targetId = Number(m[1]);
      if (targetId === user.id) return redirect(res, `/admin/users/${targetId}`);
      const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
      if (!target) return notFound(res);
      // Children first, same ordering the earlier auto-post cleanup in
      // db.js uses: comments/reactions/notifications that hang off this
      // athlete's own posts, then the posts themselves, then everything
      // else that points at this user_id directly.
      const postIds = db.prepare('SELECT id FROM posts WHERE user_id = ?').all(targetId).map((p) => p.id);
      if (postIds.length) {
        const ph = postIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM comments WHERE post_id IN (${ph})`).run(...postIds);
        db.prepare(`DELETE FROM reactions WHERE post_id IN (${ph})`).run(...postIds);
        db.prepare(`DELETE FROM notifications WHERE post_id IN (${ph})`).run(...postIds);
      }
      db.prepare('DELETE FROM comments WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM reactions WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM notifications WHERE user_id = ? OR actor_user_id = ?').run(targetId, targetId);
      db.prepare('DELETE FROM posts WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM blocks WHERE activity_id IN (SELECT id FROM activities WHERE user_id = ?)').run(targetId);
      db.prepare('DELETE FROM activities WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM races WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM chat_messages WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM follows WHERE follower_id = ? OR followee_id = ?').run(targetId, targetId);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
      return redirect(res, '/admin');
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
  console.log(`Runiqx app rodando em http://localhost:${PORT}`);
});
