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
ensureColumn('activities', 'external_id', 'external_id TEXT');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_external ON activities(user_id, external_id) WHERE external_id IS NOT NULL`);

module.exports = db;
