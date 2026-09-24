// Minimal Strava OAuth + API client using native fetch — no npm dependency.

const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

function isConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

function getAuthorizeUrl(redirectUri, state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state,
  });
  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code, redirectUri) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`Strava token exchange falhou (${res.status}): ${await res.text()}`);
  return res.json(); // { access_token, refresh_token, expires_at, athlete: {...} }
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Strava refresh falhou (${res.status}): ${await res.text()}`);
  return res.json(); // { access_token, refresh_token, expires_at }
}

// Ensures the user row has a valid (non-expired) access token, refreshing and
// persisting to the DB when needed. Returns the access token string, or null
// if the user isn't connected.
async function ensureValidToken(db, user) {
  if (!user.strava_refresh_token) return null;
  const now = Math.floor(Date.now() / 1000);
  if (user.strava_access_token && user.strava_token_expires_at && user.strava_token_expires_at > now + 60) {
    return user.strava_access_token;
  }
  const tok = await refreshAccessToken(user.strava_refresh_token);
  db.prepare('UPDATE users SET strava_access_token=?, strava_refresh_token=?, strava_token_expires_at=? WHERE id=?')
    .run(tok.access_token, tok.refresh_token, tok.expires_at, user.id);
  return tok.access_token;
}

// Fetches activities newer than `afterEpoch` (unix seconds), paginating as needed.
async function fetchActivities(accessToken, afterEpoch) {
  const all = [];
  let page = 1;
  for (;;) {
    const params = new URLSearchParams({ per_page: '100', page: String(page) });
    if (afterEpoch) params.set('after', String(afterEpoch));
    const res = await fetch(`https://www.strava.com/api/v3/athlete/activities?${params.toString()}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Strava activities falhou (${res.status}): ${await res.text()}`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
    page += 1;
    if (page > 20) break; // safety cap
  }
  return all;
}

// Strava auto-names an activity when the athlete doesn't set a custom title
// (e.g. "Morning Run", "Afternoon Run in Curitiba"). Those default titles come
// back in English regardless of the athlete's app language, so we translate
// the known patterns to Portuguese before storing them.
const DEFAULT_NAME_PT = {
  'early morning run': 'Corrida de madrugada',
  'morning run': 'Corrida matinal',
  'lunch run': 'Corrida do almoço',
  'afternoon run': 'Corrida da tarde',
  'evening run': 'Corrida da noite',
  'night run': 'Corrida noturna',
};

function translateDefaultName(name) {
  if (!name) return name;
  const m = name.match(/^(Early Morning|Morning|Lunch|Afternoon|Evening|Night)\s+Run(?:\s+in\s+(.+))?$/i);
  if (!m) return name;
  const pt = DEFAULT_NAME_PT[`${m[1].toLowerCase()} run`];
  if (!pt) return name;
  return m[2] ? `${pt} em ${m[2]}` : pt;
}

// How close two activities have to be (same day, distance, duration) to be
// treated as the same real run rather than two different ones. This is what
// stops a run logged by hand from getting a second, duplicate row once it
// also comes in from Strava.
const DUP_DISTANCE_KM = 0.15;
const DUP_DURATION_SEC = 90;

// Pulls new activities from Strava for this user and stores them, matching
// against any activity the user already logged by hand for the same day
// instead of inserting a second row for it — attaches the Strava data
// (external id, HR, elevation) to that existing row instead. Safe to call
// repeatedly (e.g. on every dashboard load): incremental via
// strava_last_synced_at, and true Strava-to-Strava repeats are still caught
// by the unique (user_id, external_id) index.
async function syncUserActivities(db, user) {
  const token = await ensureValidToken(db, user);
  if (!token) return { count: 0, error: 'not_connected' };

  // Small backward buffer so we don't miss an activity that landed right at
  // the edge of the last sync window.
  const afterEpoch = user.strava_last_synced_at ? user.strava_last_synced_at - 300 : null;
  const items = await fetchActivities(token, afterEpoch);

  const insert = db.prepare(`INSERT OR IGNORE INTO activities
    (user_id, title, workout_type, source, external_id, distance_km, duration_sec, avg_pace_sec, avg_hr, max_hr, elevation_gain_m, started_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const findMatch = db.prepare(`SELECT * FROM activities
    WHERE user_id = ? AND external_id IS NULL
    AND date(COALESCE(started_at, created_at)) = date(?)
    AND distance_km IS NOT NULL AND ABS(distance_km - ?) <= ${DUP_DISTANCE_KM}`);
  const attach = db.prepare(`UPDATE activities SET
    external_id = ?,
    avg_hr = COALESCE(avg_hr, ?),
    max_hr = COALESCE(max_hr, ?),
    elevation_gain_m = COALESCE(elevation_gain_m, ?)
    WHERE id = ?`);

  let count = 0;
  for (const act of items) {
    if (act.sport_type !== 'Run' && act.type !== 'Run') continue;
    const distanceKm = act.distance ? Math.round((act.distance / 1000) * 100) / 100 : null;
    const durationSec = act.moving_time || null;
    const avgPace = durationSec && distanceKm ? Math.round(durationSec / distanceKm) : null;
    const avgHr = act.average_heartrate ? Math.round(act.average_heartrate) : null;
    const maxHr = act.max_heartrate ? Math.round(act.max_heartrate) : null;
    const elevation = act.total_elevation_gain || null;
    const startedAt = act.start_date_local || null;

    let matched = null;
    if (distanceKm != null && startedAt) {
      const candidates = findMatch.all(user.id, startedAt, distanceKm);
      matched = candidates.find((c) => durationSec == null || c.duration_sec == null || Math.abs(c.duration_sec - durationSec) <= DUP_DURATION_SEC) || null;
    }

    if (matched) {
      attach.run(String(act.id), avgHr, maxHr, elevation, matched.id);
      count += 1;
      continue;
    }

    const info = insert.run(
      user.id,
      translateDefaultName(act.name) || 'Corrida',
      null,
      'strava',
      String(act.id),
      distanceKm,
      durationSec,
      avgPace,
      avgHr,
      maxHr,
      elevation,
      startedAt
    );
    if (info.changes > 0) count += 1;
  }

  db.prepare('UPDATE users SET strava_last_synced_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), user.id);
  return { count, error: null };
}

module.exports = { isConfigured, getAuthorizeUrl, exchangeCodeForToken, refreshAccessToken, ensureValidToken, fetchActivities, translateDefaultName, DEFAULT_NAME_PT, syncUserActivities };
