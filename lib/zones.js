// Zonas de frequência cardíaca (Z1–Z5): tempo em cada zona por treino.
// Limites: os do próprio Strava do atleta (users.hr_zones_json, gravado na
// sincronização) ou, na falta deles, percentuais da FC máxima conhecida
// (60 / 75 / 82,5 / 90 %) — a mesma regra que o Strava usa por padrão.
// O tempo em zona é estimado pelas parciais (FC média x duração de cada
// parcial) — vale para treino do Strava, GPX/TCX e tiros, sem chamada extra.

const ZONE_META = [
  { z: 'Z1', name: 'Recuperação', color: '#6AA8FF' },
  { z: 'Z2', name: 'Aeróbico', color: '#5DD39E' },
  { z: 'Z3', name: 'Ritmo', color: '#FFD166' },
  { z: 'Z4', name: 'Limiar', color: '#FF9F43' },
  { z: 'Z5', name: 'Máximo', color: '#FF5D5D' },
];

function parseJson(s) {
  if (!s) return null;
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch (e) { return null; }
}

// Retorna [topoZ1, topoZ2, topoZ3, topoZ4] em bpm.
function zoneBounds(zonesJson, maxHr) {
  const z = parseJson(zonesJson);
  if (Array.isArray(z) && z.length >= 4 && z.slice(0, 4).every((x) => x && Number.isFinite(x.max))) {
    return z.slice(0, 4).map((x) => x.max);
  }
  const m = maxHr && maxHr > 140 ? maxHr : 190;
  return [0.6, 0.75, 0.825, 0.9].map((f) => Math.round(m * f));
}

function zoneIndex(hr, bounds) {
  for (let i = 0; i < bounds.length; i++) if (hr <= bounds[i]) return i;
  return 4;
}

// activity: { laps, intervals, avg_hr, duration_sec }  → [s1..s5] ou null
function zoneSeconds(activity, bounds) {
  const secs = [0, 0, 0, 0, 0];
  const laps = parseJson(activity.laps) || [];
  const intervals = parseJson(activity.intervals) || [];
  let used = 0;
  for (const l of laps) {
    const t = l.split_sec || 0;
    if (l.avg_hr && t > 0) { secs[zoneIndex(l.avg_hr, bounds)] += t; used += t; }
  }
  if (used < 60) {
    for (const l of intervals) {
      const t = l.moving_time_sec || 0;
      if (l.avg_hr && t > 0) { secs[zoneIndex(l.avg_hr, bounds)] += t; used += t; }
    }
  }
  if (used < 60 && activity.avg_hr && activity.duration_sec) {
    secs[zoneIndex(activity.avg_hr, bounds)] += activity.duration_sec; used = activity.duration_sec;
  }
  return used >= 60 ? secs : null;
}

module.exports = { ZONE_META, zoneBounds, zoneSeconds };
