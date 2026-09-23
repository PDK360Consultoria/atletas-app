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
const { computeEvolution } = require('./lib/stats');
const { buildContext, streamChatWithAssistant } = require('./lib/assistant');
const { fetchNearbyRaces } = require('./lib/races');
const { buildMonthCalendar } = require('./lib/calendar');
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

function calcBlockActuals(laps, startKm, endKm) {
  if (!laps || !laps.length) return { pace_actual_sec: null, hr_actual_avg: null };
  let timeSum = 0, kmSum = 0, hrWeighted = 0, hrKm = 0;
  for (const lap of laps) {
    const lapStart = lap.km - 1;
    const lapEnd = lap.partial_km ? lapStart + lap.partial_km : lap.km;
    const lapKm = lapEnd - lapStart;
    const overlapStart = Math.max(lapStart, startKm);
    const overlapEnd = Math.min(lapEnd, endKm);
    const overlap = overlapEnd - overlapStart;
    if (overlap > 0 && lapKm > 0) {
      const frac = overlap / lapKm;
      timeSum += lap.split_sec * frac;
      kmSum += overlap;
      if (lap.avg_hr) { hrWeighted += lap.avg_hr * overlap; hrKm += overlap; }
    }
  }
  return {
    pace_actual_sec: kmSum > 0 ? Math.round(timeSum / kmSum) : null,
    hr_actual_avg: hrKm > 0 ? Math.round(hrWeighted / hrKm) : null,
  };
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

  let calYear = today.getFullYear(), calMonth = today.getMonth() + 1;
    if (parsed.query.month && /^\d{4}-\d{2}$/.test(parsed.query.month)) {
      const [y, mo] = parsed.query.month.split('-').map((n) => parseInt(n, 10));
      if (y >= 2000 && mo >= 1 && mo <= 12) { calYear = y; calMonth = mo; }
    }
    const calendar = buildMonthCalendar(calYear, calMonth, allActivities, races);

  return html(res, 200, views.dashboardPage({ user, nextRace, daysToRace, recentActivities, weekKm, evolution, calendar }));
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
    const blocks = db.prepare('SELECT * FROM blocks WHERE activity_id = ? ORDER BY start_km ASC').all(activity.id);
    return html(res, 200, views.activityDetailPage({ user, activity, laps, blocks, aiEnabled: !!user.anthropic_api_key }));
  }
  if (method === 'POST' && (m = /^\/activities\/(\d+)\/blocks$/.exec(pathname))) {
    if (!requireAuth()) return;
    const activity = db.prepare('SELECT * FROM activities WHERE id = ? AND user_id = ?').get(m[1], user.id);
    if (!activity) return notFound(res);
    const laps = activity.laps_json ? JSON.parse(activity.laps_json) : [];
    const startKm = parseFloat(fields.start_km), endKm = parseFloat(fields.end_km);
    const paceTarget = parseClock(fields.pace_target);
    const { pace_actual_sec, hr_actual_avg } = calcBlockActuals(laps, startKm, endKm);
    db.prepare(`INSERT INTO blocks (activity_id, label, start_km, end_km, pace_target_sec, hr_ceiling, pace_actual_sec, hr_actual_avg)
    VALUES (?,?,?,?,?,?,?,?)`).run(
      activity.id, fields.label, startKm, endKm, paceTarget,
      fields.hr_ceiling ? parseInt(fields.hr_ceiling, 10) : null,
      pace_actual_sec, hr_actual_avg
      );
    return redirect(res, `/activities/${activity.id}`);
  }
  if (method === 'POST' && (m = /^\/activities\/(\d+)\/analyze$/.exec(pathname))) {
    if (!requireAuth()) return;
    const activity = db.prepare('SELECT * FROM activities WHERE id = ? AND user_id = ?').get(m[1], user.id);
    if (!activity) return notFound(res);
    const laps = activity.laps_json ? JSON.parse(activity.laps_json) : [];
    try {
      const text = await analyzeActivity(user.anthropic_api_key, activity, laps);
      db.prepare('UPDATE activities SET ai_analysis = ? WHERE id = ?').run(text, activity.id);
    } catch (e) {
      db.prepare('UPDATE activities SET ai_analysis = ? WHERE id = ?').run(`Não foi possível gerar a análise agora (${e.message}).`, activity.id);
    }
    return redirect(res, `/activities/${activity.id}`);
  }
  if (method === 'POST' && (m = /^\/activities\/(\d+)\/delete$/.exec(pathname))) {
    if (!requireAuth()) return;
    db.prepare('DELETE FROM blocks WHERE activity_id = ?').run(m[1]);
    db.prepare('DELETE FROM posts WHERE activity_id = ?').run(m[1]);
    db.prepare('DELETE FROM activities WHERE id = ? AND user_id = ?').run(m[1], user.id);
    return redirect(res, '/activities');
  }

  // ---------- feed ----------
  if (method === 'GET' && pathname === '/feed') {
    if (!requireAuth()) return;
    const posts = db.prepare(`SELECT p.*, a.title as activity_title FROM posts p
    LEFT JOIN activities a ON a.id = p.activity_id
    WHERE p.user_id = ? ORDER BY p.created_at DESC`).all(user.id);
    return html(res, 200, views.feedPage(user, posts));
  }
  if (method === 'POST' && pathname === '/feed') {
    if (!requireAuth()) return;
    if (fields.body && fields.body.trim()) {
      db.prepare('INSERT INTO posts (user_id, activity_id, body) VALUES (?,?,?)')
      .run(user.id, fields.activity_id ? parseInt(fields.activity_id, 10) : null, fields.body.trim());
    }
    return redirect(res, fields.activity_id ? `/activities/${fields.activity_id}` : '/feed');
  }

  // ---------- settings ----------
  if (method === 'GET' && pathname === '/settings') {
    if (!requireAuth()) return;
    return html(res, 200, views.settingsPage(user, {
      saved: parsed.query.saved,
      stravaConnected: parsed.query.strava_connected,
      stravaError: parsed.query.strava_error,
      stravaDisconnected: parsed.query.strava_disconnected,
      stravaConfigured: strava.isConfigured(),
    }));
  }
  if (method === 'POST' && pathname === '/settings') {
    if (!requireAuth()) return;
    const goalSec = parseClock(fields.goal_time);
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
    try {
      const token = await strava.ensureValidToken(db, user);
      if (!token) return redirect(res, '/settings?strava_error=1');
      const items = await strava.fetchActivities(token);
      const insert = db.prepare(`INSERT OR IGNORE INTO activities
      (user_id, title, workout_type, source, external_id, distance_km, duration_sec, avg_pace_sec, avg_hr, max_hr, elevation_gain_m, started_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      let count = 0;
      for (const act of items) {
        if (act.sport_type !== 'Run' && act.type !== 'Run') continue;
        const distanceKm = act.distance ? Math.round((act.distance / 1000) * 100) / 100 : null;
        const durationSec = act.moving_time || null;
        const avgPace = durationSec && distanceKm ? Math.round(durationSec / distanceKm) : null;
        const info = insert.run(
          user.id,
          act.name || 'Corrida',
          null,
          'strava',
          String(act.id),
          distanceKm,
          durationSec,
          avgPace,
          act.average_heartrate ? Math.round(act.average_heartrate) : null,
          act.max_heartrate ? Math.round(act.max_heartrate) : null,
          act.total_elevation_gain || null,
          act.start_date_local || null
          );
        if (info.changes > 0) count += 1;
      }
      return redirect(res, `/activities?synced=${count}`);
    } catch (e) {
      console.error(e);
      return redirect(res, '/settings?strava_error=1');
    }
  }

  // ---------- coach chat ----------
  if (method === 'GET' && pathname === '/assistant') {
    if (!requireAuth()) return;
    const messages = db.prepare('SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC, id ASC').all(user.id);
    return html(res, 200, views.coachChatPage(user, messages, { aiEnabled: !!user.anthropic_api_key, error: parsed.query.error }));
  }
  if (method === 'POST' && pathname === '/assistant/clear') {
    if (!requireAuth()) return;
    db.prepare('DELETE FROM chat_messages WHERE user_id = ?').run(user.id);
    return redirect(res, '/assistant');
  }

  // JSON history for the floating coach widget (lazy-loaded so it doesn't
  // slow down every page load).
  if (method === 'GET' && pathname === '/api/coach/history') {
    if (!user) { res.writeHead(401); return res.end('{"error":"auth"}'); }
    const messages = db.prepare('SELECT role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC, id ASC').all(user.id);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ messages, aiEnabled: !!user.anthropic_api_key }));
  }

  // Streams the coach's reply as plain chunked text so the client can type
  // it out live, word by word — used by both the full chat page and the
  // floating widget. The body is raw JSON ({message}); the response body
  // is the raw streamed answer text (no SSE framing needed client-side).
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

  db.prepare('INSERT INTO chat_messages (user_id, role, content) VALUES (?,?,?)').run(user.id, 'user', text);

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
      const context = buildContext(user, races, activities, evolution);
      const priorRows = db.prepare('SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC, id ASC').all(user.id);
      const history = priorRows.slice(0, -1).slice(-20).map((m) => ({ role: m.role, content: m.content }));
      full = await streamChatWithAssistant(user.anthropic_api_key, context, history, text, (delta) => {
        res.write(delta);
      });
    } catch (e) {
      const msg = `Não consegui responder agora (${e.message}).`;
      if (!full) res.write(msg);
      full = full || msg;
    }
    db.prepare('INSERT INTO chat_messages (user_id, role, content) VALUES (?,?,?)').run(user.id, 'assistant', full);
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
