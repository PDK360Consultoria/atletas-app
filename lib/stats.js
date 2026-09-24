function startOfWeek(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  const day = (dt.getDay() + 6) % 7; // Monday = 0
  dt.setDate(dt.getDate() - day);
  return dt;
}

// Computes aggregate progress stats from a user's full activity list.
function computeEvolution(activities) {
  const totalKm = activities.reduce((s, a) => s + (a.distance_km || 0), 0);
  const totalCount = activities.length;
  const totalDurSec = activities.reduce((s, a) => s + (a.duration_sec || 0), 0);
  const avgPaceSec = totalKm > 0 ? totalDurSec / totalKm : null;
  const hrValues = activities.map((a) => a.avg_hr).filter((h) => h != null);
  const avgHr = hrValues.length ? Math.round(hrValues.reduce((s, h) => s + h, 0) / hrValues.length) : null;
  const avgDistanceKm = totalCount > 0 ? totalKm / totalCount : null;

  const now = new Date();
  const thisY = now.getFullYear();
  const thisM = now.getMonth();
  const lastMonthRef = new Date(thisY, thisM - 1, 1);
  let kmThisMonth = 0;
  let kmLastMonth = 0;
  let longest = null;
  let bestPace = null;

  for (const a of activities) {
    const d = new Date(a.started_at || a.created_at);
    if (!Number.isNaN(d.getTime())) {
      if (d.getFullYear() === thisY && d.getMonth() === thisM) {
        kmThisMonth += a.distance_km || 0;
      } else if (d.getFullYear() === lastMonthRef.getFullYear() && d.getMonth() === lastMonthRef.getMonth()) {
        kmLastMonth += a.distance_km || 0;
      }
    }
    if (a.distance_km && (!longest || a.distance_km > longest.distance_km)) longest = a;
    if (a.avg_pace_sec && a.distance_km >= 3 && (!bestPace || a.avg_pace_sec < bestPace.avg_pace_sec)) bestPace = a;
  }

  const curWeekStart = startOfWeek(now);
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const ws = new Date(curWeekStart);
    ws.setDate(ws.getDate() - i * 7);
    const we = new Date(ws);
    we.setDate(we.getDate() + 7);
    weeks.push({ start: ws, end: we, km: 0 });
  }
  for (const a of activities) {
    const d = new Date(a.started_at || a.created_at);
    if (Number.isNaN(d.getTime())) continue;
    for (const w of weeks) {
      if (d >= w.start && d < w.end) { w.km += a.distance_km || 0; break; }
    }
  }
  const maxWeekKm = Math.max(1, ...weeks.map((w) => w.km));

  return { totalKm, totalCount, avgPaceSec, avgHr, avgDistanceKm, kmThisMonth, kmLastMonth, longest, bestPace, weeks, maxWeekKm };
}

// Estimates VO2max (as "VDOT") from a single run's distance + time using the
// Daniels & Gilbert formula (the same one behind most public VDOT/race-time
// calculators) — no lab test needed, just pace sustained over a duration.
// It's most meaningful for a hard, sustained effort (a race or a tempo/long
// run close to race effort); for a very easy jog it will under-read your
// true fitness, so it's always labeled "estimado" in the UI. Returns null
// for anything too short to produce a stable estimate.
function estimateVO2max(distanceKm, durationSec) {
  if (!distanceKm || !durationSec || distanceKm < 1.5 || durationSec < 300) return null;
  const t = durationSec / 60; // minutes
  const v = (distanceKm * 1000) / t; // meters per minute
  const vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v;
  const pctMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
  if (!pctMax || vo2 <= 0) return null;
  const vdot = vo2 / pctMax;
  return vdot > 0 && Number.isFinite(vdot) ? Math.round(vdot * 10) / 10 : null;
}

module.exports = { computeEvolution, estimateVO2max };
