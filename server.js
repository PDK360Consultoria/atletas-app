const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const db = require('./db');
const { hashPassword, verifyPassword, createSession, getUserFromToken, destroySession, parseCookies } = require('./lib/auth');
const { readBody, parseUrlEncoded, parseMultipart, serializeCookie } = require('./lib/http');
const { parseClock, secToPace } = require('./lib/format');
const { parseActivityFile } = require('./lib/gpx');
const { analyzeActivity } = require('./lib/anthropic');
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
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const weekRow = db.prepare('SELECT COALESCE(SUM(distance_km),0) as km FROM activities WHERE user_id = ? AND COALESCE(started_at, created_at) >= ?').get(user.id, weekAgo);
      return html(res, 200, views.dashboardPage({ user, nextRace, daysToRace, recentActivities, weekKm: weekRow.km || 0 }));
    }

    // ---------- races ----------
    if (method === 'GET' && pathname === '/races') {
      if (!requireAuth()) return;
      const races = db.prepare('SELECT * FROM races WHERE user_id = ? ORDER BY race_date ASC').all(user.id);
      return html(res, 200, views.racesPage(user, races));
    }
    if (method === 'POST' && pathname === '/races') {
      if (!requireAuth()) return;
      const goalSec = parseClock(fields.goal_time);
      db.prepare('INSERT INTO races (user_id, name, race_date, distance_km, city, goal_time_sec) VALUES (?,?,?,?,?,?)')
        .run(user.id, fields.name, fields.race_date || null, fields.distance_km ? parseFloat(fields.distance_km) : null, fields.city || null, goalSec);
      return redirect(res, '/races');
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
      return html(res, 200, views.activitiesPage(user, activities));
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
      return html(res, 200, views.settingsPage(user, parsed.query.saved));
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
