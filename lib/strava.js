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

// Strava's numeric `workout_type` on a Run activity: 0/undefined = default,
// 1 = race, 2 = long run, 3 = workout (intervals/tempo/tiros). We only map
// the ones worth surfacing as a distinct pill — a plain default run keeps
// falling back to the generic "treino" pill in the UI.
const WORKOUT_TYPE_RUN_PT = { 1: 'Prova', 2: 'Longão', 3: 'Intervalado' };
function stravaWorkoutTypeLabel(n) {
  if (n == null) return null;
  return WORKOUT_TYPE_RUN_PT[n] || null;
}

// Fetches per-lap data for one activity ("Get Lap Data for an Activity").
// Manual laps (pressed by the athlete mid-run, e.g. for interval reps) and
// Strava's automatic ~1km laps come back in the same shape — distinguishing
// them is done by looksLikeIntervals() below. Best-effort: returns [] on any
// failure so a lap-fetch problem never breaks the rest of the sync.
async function fetchLaps(accessToken, activityId) {
  const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}/laps`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Heuristic to tell manually-pressed interval/tiro laps apart from Strava's
// automatic per-km (or per-mile) laps: auto-laps are near-uniform ~1000m or
// ~1609m splits, while real interval reps either vary in distance (a ladder
// like 200/800/200) or sit at a distance that isn't a round km/mile (400m
// repeats, 200m tiros). An activity the athlete explicitly tagged as
// "Workout" on Strava (workoutTypeNum === 3) is always treated as intervals.
//
// A real-world wrinkle: a long run broken up by a GPS pause (stopped at a
// light, tied a shoelace) often logs one or two short "remainder" laps
// alongside its otherwise-uniform ~1km auto-laps. Judging uniformity from
// every lap — including those few outliers — inflates the relative std-dev
// past the threshold and wrongly classifies an ordinary long run as
// intervals. So uniformity is judged from the *main cluster* of laps (those
// within 20% of the median distance) instead; only when that cluster fails
// to cover most of the laps (i.e. distances genuinely vary throughout, like
// a real 200/800/200 ladder) does the check fall back to using every lap.
function looksLikeIntervals(lapsRaw, workoutTypeNum) {
  if (!lapsRaw || lapsRaw.length < 2) return false;
  const dists = lapsRaw.map((l) => l.distance).filter((d) => d > 0);
  if (dists.length < 2) return false;

  const sortedDists = [...dists].sort((a, b) => a - b);
  const median = sortedDists[Math.floor(sortedDists.length / 2)];
  const mainCluster = median > 0 ? dists.filter((d) => Math.abs(d - median) / median <= 0.2) : dists;
  const clusterCoverage = mainCluster.length / dists.length;
  const sample = clusterCoverage >= 0.6 ? mainCluster : dists;

  const mean = sample.reduce((a, b) => a + b, 0) / sample.length;
  if (!mean) return false;
  const variance = sample.reduce((a, b) => a + (b - mean) * (b - mean), 0) / sample.length;
  const relStd = Math.sqrt(variance) / mean;
  const nearRoundKm = Math.abs(mean - 1000) / 1000 < 0.1 || Math.abs(mean - 1609) / 1609 < 0.1;
  if (relStd < 0.08 && nearRoundKm && workoutTypeNum !== 3) return false;
  return true;
}

// Normalizes Strava's raw lap objects into the compact shape stored in
// `intervals_json` and used by the "tiros" UI and the AI analysis prompt.
function normalizeIntervalLaps(lapsRaw) {
  return lapsRaw
    .map((l, i) => ({
      idx: l.lap_index || i + 1,
      distance_m: Math.round(l.distance || 0),
      moving_time_sec: Math.round(l.moving_time || l.elapsed_time || 0),
      avg_hr: l.average_heartrate ? Math.round(l.average_heartrate) : null,
      max_hr: l.max_heartrate ? Math.round(l.max_heartrate) : null,
    }))
    .filter((l) => l.distance_m > 0 && l.moving_time_sec > 0);
}

// Normalizes Strava's raw (non-interval) laps — Strava auto-splits a run
// into ~1km laps by default — into the same `{km, split_sec, cum_sec,
// avg_hr}` shape produced by the GPX/TCX parser's own km-bucketing, so the
// "Splits por km" chart on the activity page works identically whether the
// run was uploaded as a file or synced from Strava. Without this, every
// plain (non-interval) Strava-synced run had no chart at all, since
// `laps_json` was never populated for anything but a manual GPX/TCX upload.
function normalizeSplitLaps(lapsRaw) {
  let cumSec = 0;
  return lapsRaw
    .filter((l) => (l.moving_time || l.elapsed_time || 0) > 0)
    .map((l, i) => {
      const splitSec = Math.round(l.moving_time || l.elapsed_time || 0);
      cumSec += splitSec;
      return {
        km: l.lap_index || i + 1,
        split_sec: splitSec,
        cum_sec: cumSec,
        avg_hr: l.average_heartrate ? Math.round(l.average_heartrate) : null,
      };
    });
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

// True when `name` is one of Strava's own auto-generated names (in English
// or already translated to Portuguese by translateDefaultName above), or the
// app's own last-resort fallback — i.e. a name the athlete never actually
// typed themselves. Used to gate the smart-title logic below: it's safe to
// replace "Corrida da tarde" with something more useful, but a title Felipe
// (or anyone) customized on Strava — "Treino de tiros que rasgou", say — is
// their own words and is never overwritten.
function isGenericAutoName(name) {
  if (!name) return true;
  if (name === 'Corrida') return true;
  if (Object.values(DEFAULT_NAME_PT).some((pt) => name === pt || name.startsWith(`${pt} em `))) return true;
  if (/^(Early Morning|Morning|Lunch|Afternoon|Evening|Night)\s+Run(?:\s+in\s+.+)?$/i.test(name)) return true;
  return false;
}

// Common short-interval / track distances, used to round a rep's raw GPS
// distance (e.g. Strava reporting 203m or 787m for a lap the athlete ran as
// "200" or "800") to the number a runner would actually call it by.
const COMMON_REP_DISTANCES_M = [100, 150, 200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 1600, 2000, 3000, 5000];
function roundToCommonRepDistance(m) {
  let best = COMMON_REP_DISTANCES_M[0];
  let bestDiff = Infinity;
  for (const d of COMMON_REP_DISTANCES_M) {
    const diff = Math.abs(m - d);
    if (diff < bestDiff) { bestDiff = diff; best = d; }
  }
  // Only snap to a "named" distance when it's a close match (within 20%);
  // an odd rep length is rounded to the nearest 50m instead of forced into
  // a track distance it isn't.
  if (bestDiff / best <= 0.2) return best;
  return Math.round(m / 50) * 50;
}

// Formats a total distance for a title: whole km when it's close to one
// ("29.97" -> "30km", matching how a runner would say it out loud), one
// decimal place with a Portuguese comma otherwise ("8.4km" -> "8,4km").
function fmtTitleDistanceKm(km) {
  const r1 = Math.round(km * 10) / 10;
  if (Math.abs(r1 - Math.round(r1)) < 0.05) return `${Math.round(r1)}km`;
  return `${r1.toFixed(1).replace('.', ',')}km`;
}

// Minimum total distance for a continuous (non-interval) run to be called a
// "longão" rather than a shorter progressive/easy run — matches how the
// coach chat and the treino-stories template already talk about Felipe's
// weekend long runs.
const LONGAO_KM_THRESHOLD = 16;

// Names a workout from its actual structure instead of "what time of day it
// was" — the same read Felipe does by eye on real splits: a session made of
// short, repeated efforts is a "Tiro <distância>"; a long continuous run is
// a "Longão"; a continuous run that gets meaningfully and consistently
// faster over its course (not just a fast final push) is a "Progressivo".
// Returns null when none of these confidently apply (a plain easy run, or
// not enough data to tell) — the caller keeps whatever name it already had.
function deriveWorkoutTitle({ distanceKm, workoutTypeLabel, intervals, laps }) {
  if (!distanceKm) return null;
  const distLabel = fmtTitleDistanceKm(distanceKm);

  if (intervals && intervals.length >= 2) {
    const reps = intervals.map((i) => roundToCommonRepDistance(i.distance_m)).filter((d) => d > 0);
    if (reps.length >= 2) {
      const counts = new Map();
      for (const d of reps) counts.set(d, (counts.get(d) || 0) + 1);
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      const [topDist, topCount] = sorted[0];
      if (topCount / reps.length >= 0.6) return `Tiro ${topDist} ${distLabel}`;
      if (sorted.length >= 2) {
        const pair = [topDist, sorted[1][0]].sort((a, b) => a - b);
        return `Tiro ${pair.join('/')} ${distLabel}`;
      }
      return `Tiro ${distLabel}`;
    }
  }

  if (workoutTypeLabel === 'Longão' || distanceKm >= LONGAO_KM_THRESHOLD) {
    return `Longão ${distLabel}`;
  }

  if (laps && laps.length >= 6) {
    const withPace = laps.filter((l) => l.split_sec);
    const third = Math.floor(withPace.length / 3);
    if (third >= 2) {
      const avg = (arr) => arr.reduce((s, l) => s + l.split_sec, 0) / arr.length;
      const g1 = avg(withPace.slice(0, third));
      const g2 = avg(withPace.slice(third, third * 2));
      const g3 = avg(withPace.slice(-third));
      const dropPct = (g1 - g3) / g1;
      // Strictly decreasing block-by-block (getting faster each third) and
      // a total drop big enough to be a deliberate progression, not normal
      // pace noise inside an otherwise steady run.
      if (g1 > g2 && g2 > g3 && dropPct >= 0.08) return `Progressivo ${distLabel}`;
    }
  }

  return null;
}

// How close two activities have to be (same day, distance, duration) to be
// treated as the same real run rather than two different ones. This is what
// stops a run logged by hand from getting a second, duplicate row once it
// also comes in from Strava. The tolerance scales with the run's size — a
// fixed ~150m/90s gap is fine for a short run, but manual entry and
// Strava's GPS-derived totals for a long run can easily differ by close to
// a kilometer / several minutes.
const DUP_DISTANCE_KM_MIN = 0.15;
const DUP_DISTANCE_PCT = 0.04;
const DUP_DURATION_SEC_MIN = 90;
const DUP_DURATION_PCT = 0.06;
function dupDistanceTolerance(km) {
  return Math.max(DUP_DISTANCE_KM_MIN, km * DUP_DISTANCE_PCT);
}
function dupDurationTolerance(sec) {
  return Math.max(DUP_DURATION_SEC_MIN, sec * DUP_DURATION_PCT);
}

// Pulls new activities from Strava for this user and stores them, matching
// against any activity the user already logged by hand for the same day
// instead of inserting a second row for it — attaches the Strava data
// (external id, HR, elevation) to that existing row instead. Safe to call
// repeatedly (e.g. on every dashboard load): incremental via
// strava_last_synced_at, and true Strava-to-Strava repeats are still caught
// by the unique (user_id, external_id) index.
async function syncUserActivities(db, user, opts) {
  const token = await ensureValidToken(db, user);
  if (!token) return { count: 0, error: 'not_connected' };

  // Small backward buffer so we don't miss an activity that landed right at
  // the edge of the last sync window. `opts.full` ignores the cursor
  // entirely and re-walks all history — used to backfill workout_type /
  // intervals_json onto activities synced before that data was captured,
  // since Strava's `after` filter means a normal incremental sync will
  // never look at an activity from before the last sync again.
  const afterEpoch = (!opts || !opts.full) && user.strava_last_synced_at ? user.strava_last_synced_at - 300 : null;
  const items = await fetchActivities(token, afterEpoch);

  const insert = db.prepare(`INSERT OR IGNORE INTO activities
    (user_id, title, workout_type, source, external_id, distance_km, duration_sec, avg_pace_sec, avg_hr, max_hr, elevation_gain_m, cadence_spm, started_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const findMatch = db.prepare(`SELECT * FROM activities
    WHERE user_id = ? AND external_id IS NULL
    AND date(COALESCE(started_at, created_at)) = date(?)
    AND distance_km IS NOT NULL AND ABS(distance_km - ?) <= ?`);
  const attach = db.prepare(`UPDATE activities SET
    external_id = ?,
    workout_type = COALESCE(workout_type, ?),
    avg_hr = COALESCE(avg_hr, ?),
    max_hr = COALESCE(max_hr, ?),
    elevation_gain_m = COALESCE(elevation_gain_m, ?),
    cadence_spm = COALESCE(cadence_spm, ?)
    WHERE id = ?`);
  const findByExternal = db.prepare('SELECT id, title, workout_type, intervals_json, laps_json FROM activities WHERE user_id = ? AND external_id = ?');
  const updateRow = db.prepare('UPDATE activities SET title = ?, workout_type = COALESCE(workout_type, ?), intervals_json = COALESCE(?, intervals_json), laps_json = COALESCE(?, laps_json) WHERE id = ?');

  // Fetching laps is a second API call per activity, so it's capped per sync
  // run — plenty for the incremental syncs this runs on normally (a handful
  // of new/changed activities), and still enough to backfill recent history
  // on a first sync without risking Strava's rate limit.
  const LAP_FETCH_CAP = 30;
  let lapFetches = 0;
  let count = 0;

  for (const act of items) {
    if (act.sport_type !== 'Run' && act.type !== 'Run') continue;
    const distanceKm = act.distance ? Math.round((act.distance / 1000) * 100) / 100 : null;
    const durationSec = act.moving_time || null;
    const avgPace = durationSec && distanceKm ? Math.round(durationSec / distanceKm) : null;
    const avgHr = act.average_heartrate ? Math.round(act.average_heartrate) : null;
    const maxHr = act.max_heartrate ? Math.round(act.max_heartrate) : null;
    const elevation = act.total_elevation_gain || null;
    // Strava reports running cadence as steps per leg per minute; double it
    // for the usual "total steps per minute" figure runners expect.
    const cadence = act.average_cadence ? Math.round(act.average_cadence * 2) : null;
    const startedAt = act.start_date_local || null;
    const workoutTypeLabel = stravaWorkoutTypeLabel(act.workout_type);

    let matched = null;
    if (distanceKm != null && startedAt) {
      const candidates = findMatch.all(user.id, startedAt, distanceKm, dupDistanceTolerance(distanceKm));
      matched = candidates.find((c) => durationSec == null || c.duration_sec == null || Math.abs(c.duration_sec - durationSec) <= dupDurationTolerance(durationSec)) || null;
    }

    if (matched) {
      attach.run(String(act.id), workoutTypeLabel, avgHr, maxHr, elevation, cadence, matched.id);
      count += 1;
      continue;
    }

    const existing = findByExternal.get(user.id, String(act.id));
    let targetId = existing ? existing.id : null;

    if (!existing) {
      const info = insert.run(
        user.id,
        translateDefaultName(act.name) || 'Corrida',
        workoutTypeLabel,
        'strava',
        String(act.id),
        distanceKm,
        durationSec,
        avgPace,
        avgHr,
        maxHr,
        elevation,
        cadence,
        startedAt
      );
      if (info.changes > 0) { count += 1; targetId = info.lastInsertRowid; }
    }
    if (!targetId) continue;

    // Backfill workout type / interval laps / km-splits for rows that don't
    // have them yet — covers both a freshly-inserted row and one synced
    // before this feature existed (a plain run never gets intervals_json,
    // so this stays true for every non-interval run until laps_json is
    // filled in too, which is exactly what we want to backfill).
    const missingData = !existing || existing.workout_type == null || existing.intervals_json == null || existing.laps_json == null;
    let intervalsJson = existing ? existing.intervals_json : null;
    let lapsJson = existing ? existing.laps_json : null;
    let finalLabel = (existing && existing.workout_type) || workoutTypeLabel;
    if (missingData && lapFetches < LAP_FETCH_CAP) {
      lapFetches += 1;
      try {
        const rawLaps = await fetchLaps(token, act.id);
        if (looksLikeIntervals(rawLaps, act.workout_type)) {
          const normalized = normalizeIntervalLaps(rawLaps);
          if (normalized.length >= 2) {
            intervalsJson = JSON.stringify(normalized);
            finalLabel = finalLabel || 'Intervalado';
          }
        } else if (rawLaps.length >= 2) {
          // Not an interval session — these are Strava's ordinary ~1km
          // auto-laps, so store them as the same km-split chart a manual
          // GPX/TCX upload would produce.
          const splitLaps = normalizeSplitLaps(rawLaps);
          if (splitLaps.length >= 2) lapsJson = JSON.stringify(splitLaps);
        }
      } catch (e) { /* lap data is best-effort — never fail the sync over it */ }
    }

    // Name the workout from its real structure (tiro/longão/progressivo +
    // distância) instead of Strava's generic "Corrida da tarde" — only when
    // the title is still one of those generic auto-names; anything Felipe
    // (or anyone) typed themselves, on Strava or here, is never overwritten.
    const currentTitle = existing ? existing.title : (translateDefaultName(act.name) || 'Corrida');
    let finalTitle = currentTitle;
    if (isGenericAutoName(currentTitle) || (act.name && isGenericAutoName(act.name))) {
      try {
        const intervalsForTitle = intervalsJson ? JSON.parse(intervalsJson) : null;
        const lapsForTitle = lapsJson ? JSON.parse(lapsJson) : null;
        const smartTitle = deriveWorkoutTitle({ distanceKm, workoutTypeLabel: finalLabel, intervals: intervalsForTitle, laps: lapsForTitle });
        if (smartTitle) finalTitle = smartTitle;
      } catch (e) { /* title upgrade is best-effort — never fail the sync over it */ }
    }

    updateRow.run(finalTitle, finalLabel, intervalsJson, lapsJson, targetId);
  }

  db.prepare('UPDATE users SET strava_last_synced_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), user.id);
  return { count, error: null };
}

module.exports = {
  isConfigured, getAuthorizeUrl, exchangeCodeForToken, refreshAccessToken, ensureValidToken,
  fetchActivities, fetchLaps, translateDefaultName, DEFAULT_NAME_PT, stravaWorkoutTypeLabel,
  looksLikeIntervals, normalizeIntervalLaps, normalizeSplitLaps, syncUserActivities,
  isGenericAutoName, deriveWorkoutTitle,
};
