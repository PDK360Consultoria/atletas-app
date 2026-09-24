const { secToPace, fmtClock } = require('./format');

// Formats an interval rep's distance the way a coach would say it out loud:
// clean km for round-thousand distances, meters for everything else (a 200m
// or 800m tiro should never be shown as "0.2km").
function fmtIntervalDistance(m) {
  if (!m) return '—';
  if (m >= 1000 && m % 1000 === 0) return `${m / 1000}km`;
  if (m >= 1000) return `${(m / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}km`;
  return `${Math.round(m)}m`;
}

function ordinalTiroLabel(position, total) {
  if (total === 1) return 'único tiro';
  if (position === 1) return 'primeiro tiro';
  if (position === total) return 'último tiro';
  return `tiro ${position}`;
}

// Turns the raw per-rep laps (as stored in `intervals_json`) into everything
// the "PACE POR TIRO" card and the AI analysis prompt need: per-rep pace
// bars with the fastest rep flagged, roll-up stats, and a one-line
// plain-language description of the workout's structure (e.g.
// "3×200 + 3×800 + 3×200. O último tiro foi o mais rápido: 3:25/km.").
function summarizeIntervals(intervals) {
  if (!intervals || !intervals.length) return null;
  const laps = intervals.filter((l) => l.distance_m > 0 && l.moving_time_sec > 0);
  if (laps.length < 2) return null;

  const bars = laps.map((l, i) => ({
    idx: i + 1,
    distance_m: l.distance_m,
    distanceLabel: fmtIntervalDistance(l.distance_m),
    moving_time_sec: l.moving_time_sec,
    pace_sec: l.moving_time_sec / (l.distance_m / 1000),
    avg_hr: l.avg_hr || null,
    max_hr: l.max_hr || null,
  }));

  let fastest = bars[0];
  for (const b of bars) if (b.pace_sec < fastest.pace_sec) fastest = b;
  bars.forEach((b) => { b.isFastest = b === fastest; });

  const totalTimeSec = laps.reduce((sum, l) => sum + l.moving_time_sec, 0);
  const totalDistanceKm = laps.reduce((sum, l) => sum + l.distance_m, 0) / 1000;
  const avgPaceSec = totalDistanceKm > 0 ? totalTimeSec / totalDistanceKm : null;

  const hrLaps = laps.filter((l) => l.avg_hr);
  const avgHr = hrLaps.length
    ? Math.round(hrLaps.reduce((sum, l) => sum + l.avg_hr * l.moving_time_sec, 0) / hrLaps.reduce((sum, l) => sum + l.moving_time_sec, 0))
    : null;
  const maxHr = laps.reduce((max, l) => (l.max_hr && l.max_hr > max ? l.max_hr : max), 0) || null;

  // Group consecutive reps of (roughly) the same distance into "N×Dm" chunks,
  // rounding to the nearest 50m so GPS noise (198m vs 202m) doesn't split a
  // group that's really the same rep distance repeated.
  const groups = [];
  for (const l of laps) {
    const rounded = Math.round(l.distance_m / 50) * 50;
    const last = groups[groups.length - 1];
    if (last && last.rounded === rounded) last.count += 1;
    else groups.push({ rounded, count: 1 });
  }
  const structureParts = groups.map((g) => `${g.count}×${fmtIntervalDistance(g.rounded)}`);
  const fastestLabel = ordinalTiroLabel(fastest.idx, bars.length);
  const structureText = `${structureParts.join(' + ')}. O ${fastestLabel} foi o mais rápido: ${secToPace(fastest.pace_sec)}/km.`;

  return {
    bars,
    count: bars.length,
    totalTimeSec,
    totalTimeLabel: fmtClock(totalTimeSec),
    avgPaceSec,
    avgHr,
    maxHr,
    structureText,
    fastest,
  };
}

module.exports = { summarizeIntervals, fmtIntervalDistance, ordinalTiroLabel };
