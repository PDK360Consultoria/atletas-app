const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  city TEXT,
  bio TEXT,
  goal_race_name TEXT,
  goal_time_sec INTEGER,
  anthropic_api_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS races (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  race_date TEXT,
  distance_km REAL,
  city TEXT,
  goal_time_sec INTEGER,
  status TEXT NOT NULL DEFAULT 'upcoming',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  race_id INTEGER,
  title TEXT NOT NULL,
  workout_type TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  raw_filename TEXT,
  distance_km REAL,
  duration_sec INTEGER,
  avg_pace_sec REAL,
  avg_hr REAL,
  max_hr REAL,
  elevation_gain_m REAL,
  started_at TEXT,
  laps_json TEXT,
  notes TEXT,
  ai_analysis TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(race_id) REFERENCES races(id)
);

CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  start_km REAL NOT NULL,
  end_km REAL NOT NULL,
  pace_target_sec REAL,
  hr_ceiling REAL,
  pace_actual_sec REAL,
  hr_actual_avg REAL,
  FOREIGN KEY(activity_id) REFERENCES activities(id)
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  activity_id INTEGER,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(activity_id) REFERENCES activities(id)
);
`);

// --- migrations: add columns that may not exist on a DB created before this feature ---
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn('users', 'strava_athlete_id', 'strava_athlete_id TEXT');
ensureColumn('users', 'hr_zones_json', 'hr_zones_json TEXT');
ensureColumn('users', 'strava_access_token', 'strava_access_token TEXT');
ensureColumn('users', 'strava_refresh_token', 'strava_refresh_token TEXT');
ensureColumn('users', 'strava_token_expires_at', 'strava_token_expires_at INTEGER');
ensureColumn('users', 'strava_connected_at', 'strava_connected_at TEXT');
ensureColumn('users', 'strava_last_synced_at', 'strava_last_synced_at INTEGER');
// Admin flag — gates the /admin dashboard (see server.js). Nothing in the
// signup flow ever sets this; it's granted once below, to the very first
// account (Felipe's — see memberNumber's comment above), and from then on
// only by directly editing the database.
ensureColumn('users', 'is_admin', 'is_admin INTEGER NOT NULL DEFAULT 0');
ensureColumn('activities', 'external_id', 'external_id TEXT');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_external ON activities(user_id, external_id) WHERE external_id IS NOT NULL`);
ensureColumn('activities', 'intervals_json', 'intervals_json TEXT');
ensureColumn('activities', 'ai_context_json', 'ai_context_json TEXT');
// Running cadence (steps/min) — captured from Strava's average_cadence when
// available (see lib/strava.js); null for manual/GPX entries, which is fine,
// the UI just shows '—'.
ensureColumn('activities', 'cadence_spm', 'cadence_spm REAL');

// Social feed: photo attachment on a post, and a stable public-profile slug
// per user (used by the no-login /u/:slug page — generated on first access,
// see ensurePublicSlug in server.js).
ensureColumn('posts', 'photo_path', 'photo_path TEXT');
ensureColumn('posts', 'photos_json', 'photos_json TEXT');
ensureColumn('posts', 'location', 'location TEXT');
ensureColumn('users', 'public_slug', 'public_slug TEXT');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_slug ON users(public_slug) WHERE public_slug IS NOT NULL`);

// Marks a post whose card renders the linked activity's own stats instead of
// a typed caption (see activityStatBlock in views.js). Nothing creates these
// automatically — the athlete opts a specific training into the feed via
// "Compartilhar no feed" on that activity's page, same as any other post.
ensureColumn('posts', 'is_auto', 'is_auto INTEGER NOT NULL DEFAULT 0');

// Profile photo (Settings) — shown instead of the initials circle wherever
// an avatar renders (feed, comments, public profile) once set.
ensureColumn('users', 'avatar_path', 'avatar_path TEXT');

// Pre-diagnóstico do cadastro: perfil de corredor coletado no signup, usado
// para gerar a leitura personalizada mostrada em /welcome logo após criar a
// conta (ver buildDiagnosis em lib/social.js). Nenhum desses campos é
// obrigatório pra continuar usando o app — se vier vazio (conta criada antes
// dessa feature), a leitura é só mais genérica.
ensureColumn('users', 'experience_level', 'experience_level TEXT');
ensureColumn('users', 'weekly_km', 'weekly_km REAL');
ensureColumn('users', 'injury_notes', 'injury_notes TEXT');

// Marks a post that was shared via the "🏆 Recorde pessoal" prompt on an
// activity page (see detectPersonalRecord in lib/stats.js) so the feed card
// can show a trophy badge instead of the athlete having to say it themselves.
ensureColumn('posts', 'is_pr', 'is_pr INTEGER NOT NULL DEFAULT 0');

db.exec(`
CREATE TABLE IF NOT EXISTS reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(post_id) REFERENCES posts(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_unique ON reactions(post_id, user_id);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(post_id) REFERENCES posts(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  actor_user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  post_id INTEGER,
  body TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(actor_user_id) REFERENCES users(id),
  FOREIGN KEY(post_id) REFERENCES posts(id)
);

-- Social graph: who follows whom. Lets the feed be filtered to "quem eu
-- sigo" instead of only the firehose of every athlete on the app (see the
-- scope param on GET /feed). Following someone is not required to see them
-- in the default "Todos" feed — it's a curation layer on top of the shared
-- feed, not a visibility gate.
CREATE TABLE IF NOT EXISTS follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  follower_id INTEGER NOT NULL,
  followee_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(follower_id) REFERENCES users(id),
  FOREIGN KEY(followee_id) REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_follows_unique ON follows(follower_id, followee_id);
`);

// Multiple reaction types (👏 🔥 🏆 💪) instead of a single kudos. A row's
// meaning used to be "user X reacted to post Y"; now it's "user X reacted
// with type Z to post Y", so the same user can leave more than one reaction
// kind on the same post. The old unique index only allowed one row per
// (post_id, user_id) — drop it before adding the column, then recreate it
// scoped to also include type, so existing rows (all implicitly kudos) keep
// working and newly-expressed reaction types don't collide with them. Runs
// after the table-creation block above so this also works on a brand-new
// database, where `reactions` doesn't exist until that block runs.
db.exec('DROP INDEX IF EXISTS idx_reactions_unique');
ensureColumn('reactions', 'type', "type TEXT NOT NULL DEFAULT 'kudos'");
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_unique ON reactions(post_id, user_id, type)');

// One-time cleanup: merge duplicate activities that exist as both a
// manually-logged row and a separately Strava-synced row for the same real
// run — this happened because Strava sync used to only check its own
// external id, never whether the athlete had already logged that run by
// hand. Matches by same user, same day, and distance/duration within a
// tolerance that scales with the run's size — a fixed 150m/90s gap works
// for a short run but is much too tight for a long one, where manual entry
// and Strava's GPS-derived totals can easily differ by close to a
// kilometer. Keeps the Strava-linked row (so it can't be duplicated again),
// but prefers the manual row's own title/workout_type when the athlete set
// one — that's the athlete's own classification of the run, and should win
// over whatever Strava's lap heuristic guessed. If that resolves the
// workout to something other than "Intervalado", any intervals_json on the
// survivor is dropped too, since it can only be real for an actual
// interval session. Safe to run on every boot: once a pair is merged
// there's nothing left for it to match.
{
  const DIST_TOL_MIN_KM = 0.15;
  const DIST_TOL_PCT = 0.04;
  const DUR_TOL_MIN_SEC = 90;
  const DUR_TOL_PCT = 0.06;
  const distTolerance = (km) => Math.max(DIST_TOL_MIN_KM, km * DIST_TOL_PCT);
  const durTolerance = (sec) => Math.max(DUR_TOL_MIN_SEC, sec * DUR_TOL_PCT);

  const rows = db.prepare(`SELECT * FROM activities ORDER BY user_id, COALESCE(started_at, created_at)`).all();
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r);
  }
  const moveBlocks = db.prepare('UPDATE blocks SET activity_id = ? WHERE activity_id = ?');
  const movePosts = db.prepare('UPDATE posts SET activity_id = ? WHERE activity_id = ?');
  // dup is always the manual row here (survivor is picked as the one WITH an
  // external_id), so its title/workout_type are what the athlete actually
  // typed — prefer those over Strava's generic/translated default name and
  // its (possibly wrong) heuristic workout-type guess.
  const updateSurvivor = db.prepare(`UPDATE activities SET
    title = COALESCE(?, title),
    workout_type = COALESCE(?, workout_type),
    notes = COALESCE(notes, ?),
    ai_analysis = COALESCE(ai_analysis, ?),
    avg_hr = COALESCE(avg_hr, ?),
    max_hr = COALESCE(max_hr, ?),
    elevation_gain_m = COALESCE(elevation_gain_m, ?),
    external_id = COALESCE(external_id, ?),
    intervals_json = CASE WHEN COALESCE(?, workout_type) = 'Intervalado' THEN intervals_json ELSE NULL END
    WHERE id = ?`);
  const deleteActivity = db.prepare('DELETE FROM activities WHERE id = ?');
  const dayOf = (v) => (v ? String(v).slice(0, 10) : null);

  for (const [, list] of byUser) {
    const removed = new Set();
    for (let i = 0; i < list.length; i++) {
      if (removed.has(list[i].id)) continue;
      for (let j = i + 1; j < list.length; j++) {
        if (removed.has(list[j].id)) continue;
        const a = list[i], b = list[j];
        const dayA = dayOf(a.started_at || a.created_at);
        const dayB = dayOf(b.started_at || b.created_at);
        if (!dayA || dayA !== dayB) continue;
        if (a.distance_km == null || b.distance_km == null) continue;
        const maxDist = Math.max(a.distance_km, b.distance_km);
        if (Math.abs(a.distance_km - b.distance_km) > distTolerance(maxDist)) continue;
        if (a.duration_sec != null && b.duration_sec != null) {
          const maxDur = Math.max(a.duration_sec, b.duration_sec);
          if (Math.abs(a.duration_sec - b.duration_sec) > durTolerance(maxDur)) continue;
        }
        if (!!a.external_id === !!b.external_id) continue; // only merge a manual+strava pair for the same run
        const survivor = a.external_id ? a : b;
        const dup = survivor === a ? b : a;
        updateSurvivor.run(
          dup.title, dup.workout_type, dup.notes, dup.ai_analysis,
          dup.avg_hr, dup.max_hr, dup.elevation_gain_m, dup.external_id,
          dup.workout_type,
          survivor.id
        );
        moveBlocks.run(survivor.id, dup.id);
        movePosts.run(survivor.id, dup.id);
        deleteActivity.run(dup.id);
        removed.add(dup.id);
        if (removed.has(list[i].id)) break;
      }
    }
  }
}

// One-time fix for activities synced before Strava's default English titles
// ("Morning Run", "Afternoon Run in <city>", ...) were translated to Portuguese.
{
  const DEFAULT_NAME_PT = {
    'early morning run': 'Corrida de madrugada',
    'morning run': 'Corrida matinal',
    'lunch run': 'Corrida do almoço',
    'afternoon run': 'Corrida da tarde',
    'evening run': 'Corrida da noite',
    'night run': 'Corrida noturna',
  };
  const rows = db.prepare(`SELECT id, title FROM activities WHERE source = 'strava'`).all();
  const update = db.prepare('UPDATE activities SET title = ? WHERE id = ?');
  for (const row of rows) {
    const m = row.title && row.title.match(/^(Early Morning|Morning|Lunch|Afternoon|Evening|Night)\s+Run(?:\s+in\s+(.+))?$/i);
    if (!m) continue;
    const pt = DEFAULT_NAME_PT[`${m[1].toLowerCase()} run`];
    if (!pt) continue;
    const newTitle = m[2] ? `${pt} em ${m[2]}` : pt;
    if (newTitle !== row.title) update.run(newTitle, row.id);
  }
}

// Upgrade: replace a still-generic Strava auto-name ("Corrida da tarde",
// "Corrida matinal"...) with a name that reflects the workout's actual
// structure — "Tiro 200 8km", "Longão 30km", "Progressivo 12km" — using
// classification data (intervals_json/laps_json) already synced onto the
// row, no new Strava API call needed. Only ever touches a title that's
// still one of Strava's own auto-names (isGenericAutoName); a title the
// athlete customized, on Strava or here, is never overwritten. Naturally
// idempotent and safe to run on every boot: once a row is renamed to e.g.
// "Longão 30km" it no longer matches isGenericAutoName, so it's left alone
// from then on (including if the athlete edits it further by hand).
{
  const { isGenericAutoName, deriveWorkoutTitle } = require('./lib/strava');
  const rows = db.prepare(`SELECT id, title, workout_type, distance_km, intervals_json, laps_json
    FROM activities WHERE source = 'strava' AND distance_km IS NOT NULL`).all();
  const update = db.prepare('UPDATE activities SET title = ? WHERE id = ?');
  for (const row of rows) {
    if (!isGenericAutoName(row.title)) continue;
    let intervals = null;
    let laps = null;
    try { intervals = row.intervals_json ? JSON.parse(row.intervals_json) : null; } catch (e) {}
    try { laps = row.laps_json ? JSON.parse(row.laps_json) : null; } catch (e) {}
    const smartTitle = deriveWorkoutTitle({ distanceKm: row.distance_km, workoutTypeLabel: row.workout_type, intervals, laps });
    if (smartTitle && smartTitle !== row.title) update.run(smartTitle, row.id);
  }
}

// One-time cleanup: an earlier version of this app auto-posted every logged
// training to the feed without asking. The athlete asked for curation
// control instead — he picks which run becomes a post (via "Compartilhar no
// feed" on that activity), so this removes the posts that were created for
// him rather than by him, plus anything hanging off them. Guarded by
// _migrations so it runs exactly once and never touches a post created any
// other way (including a future is_auto post from an explicit share).
db.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
{
  const MIGRATION = 'remove_unrequested_auto_posts_v1';
  const applied = db.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(MIGRATION);
  if (!applied) {
    const ids = db.prepare('SELECT id FROM posts WHERE is_auto = 1').all().map((r) => r.id);
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM comments WHERE post_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM reactions WHERE post_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM notifications WHERE post_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM posts WHERE id IN (${ph})`).run(...ids);
    }
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(MIGRATION);
  }
}

// One-time: grant the admin flag to the very first account (id 1 — Felipe's,
// per memberNumber's comment above) so the /admin dashboard has someone who
// can reach it without a manual DB edit. Guarded by _migrations so it never
// re-runs and never re-grants admin to id 1 after someone deliberately
// revokes it by hand.
{
  const MIGRATION = 'grant_first_user_admin_v1';
  const applied = db.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(MIGRATION);
  if (!applied) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = 1').run();
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(MIGRATION);
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);
ensureColumn('chat_messages', 'activity_id', 'activity_id INTEGER');
ensureColumn('chat_messages', 'channel', 'channel TEXT');

// Device tokens for push notifications (iOS/Android app shell).
db.exec(`
CREATE TABLE IF NOT EXISTS push_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  platform TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

// Rota do treino: polyline codificada (formato padrão do Google Encoded
// Polyline Algorithm — ver lib/polyline.js) com os pontos lat/lon do
// percurso. Vem de duas fontes: upload de GPX/TCX (lib/gpx.js downsample +
// encode) ou do próprio Strava, que já devolve map.summary_polyline na
// listagem de atividades (lib/strava.js) — sem chamada extra de API por
// atividade. Usada só para desenhar o traçado (SVG) no feed/detalhe do
// treino; nunca para recalcular distância/pace.
ensureColumn('activities', 'route_polyline', 'route_polyline TEXT');

// Chave própria da API Realtime da OpenAI — separada da chave da Anthropic
// (anthropic_api_key, usada pelo Coach por texto/análise). O Professor em
// voz agora fala de verdade (voz-pra-voz em tempo real via WebRTC, ver
// lib/openai.js), e isso exige um provedor diferente da Anthropic; mesmo
// modelo bring-your-own-key, cadastrada em Configurações.
ensureColumn('users', 'openai_api_key', 'openai_api_key TEXT');

// Número de atleta sequencial (Nº 001, 002...), independente do id interno —
// ids pulados por contas removidas não deixam buracos na numeração.
ensureColumn('users', 'member_number', 'member_number INTEGER');
{
  const pend = db.prepare('SELECT id FROM users WHERE member_number IS NULL ORDER BY id ASC').all();
  for (const r of pend) {
    db.prepare('UPDATE users SET member_number = (SELECT COALESCE(MAX(member_number), 0) + 1 FROM users) WHERE id = ?').run(r.id);
  }
}

// Tutorial do primeiro acesso: quem já existia antes deste recurso não recebe o
// tour automático (continua podendo abrir em Mais > Tutorial).
{
  const had = db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'tour_seen_at');
  ensureColumn('users', 'tour_seen_at', 'tour_seen_at TEXT');
  if (!had) db.exec("UPDATE users SET tour_seen_at = datetime('now') WHERE tour_seen_at IS NULL");
}

// Moderação: bloqueio entre usuários e denúncias (ver lib/moderation.js).
db.exec(`
CREATE TABLE IF NOT EXISTS user_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  target_user_id INTEGER,
  reason TEXT NOT NULL,
  details TEXT,
  preview TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
`);

module.exports = db;
