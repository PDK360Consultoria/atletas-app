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
ensureColumn('users', 'strava_access_token', 'strava_access_token TEXT');
ensureColumn('users', 'strava_refresh_token', 'strava_refresh_token TEXT');
ensureColumn('users', 'strava_token_expires_at', 'strava_token_expires_at INTEGER');
ensureColumn('users', 'strava_connected_at', 'strava_connected_at TEXT');
ensureColumn('users', 'strava_last_synced_at', 'strava_last_synced_at INTEGER');
ensureColumn('activities', 'external_id', 'external_id TEXT');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_external ON activities(user_id, external_id) WHERE external_id IS NOT NULL`);
ensureColumn('activities', 'intervals_json', 'intervals_json TEXT');

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

module.exports = db;
