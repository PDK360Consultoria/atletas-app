// Minimal, dependency-free GPX/TCX parser using regex extraction.
// GPX and TCX are simple, predictable XML — a full DOM parser is unnecessary
// (and unavailable without npm), so we extract point-by-point with regex.

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function num(str) {
  if (str == null) return null;
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : null;
}

function parseGPX(xml) {
  const points = [];
  const trkptRe = /<trkpt\b[^>]*\blat="([^"]+)"[^>]*\blon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
  let m;
  while ((m = trkptRe.exec(xml))) {
    const lat = num(m[1]);
    const lon = num(m[2]);
    const body = m[3];
    const eleM = /<ele>([^<]+)<\/ele>/.exec(body);
    const timeM = /<time>([^<]+)<\/time>/.exec(body);
    const hrM = /(?:hr|HeartRateBpm)>(\d+)</.exec(body);
    points.push({
      lat, lon,
      ele: eleM ? num(eleM[1]) : null,
      time: timeM ? timeM[1] : null,
      hr: hrM ? num(hrM[1]) : null,
    });
  }
  return points;
}

function parseTCX(xml) {
  const points = [];
  const tpRe = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/g;
  let m;
  while ((m = tpRe.exec(xml))) {
    const body = m[1];
    const timeM = /<Time>([^<]+)<\/Time>/.exec(body);
    const latM = /<LatitudeDegrees>([^<]+)<\/LatitudeDegrees>/.exec(body);
    const lonM = /<LongitudeDegrees>([^<]+)<\/LongitudeDegrees>/.exec(body);
    const eleM = /<AltitudeMeters>([^<]+)<\/AltitudeMeters>/.exec(body);
    const hrM = /<HeartRateBpm>[\s\S]*?<Value>(\d+)<\/Value>/.exec(body);
    points.push({
      lat: latM ? num(latM[1]) : null,
      lon: lonM ? num(lonM[1]) : null,
      ele: eleM ? num(eleM[1]) : null,
      time: timeM ? timeM[1] : null,
      hr: hrM ? num(hrM[1]) : null,
    });
  }
  return points;
}

// Turn a raw point stream into summary stats + 1km-bucket splits.
function summarize(points) {
  const valid = points.filter((p) => p.lat != null && p.lon != null && p.time);
  if (valid.length < 2) return null;

  let cumKm = 0;
  let elevGain = 0;
  const laps = []; // {km, split_sec, cum_sec, avg_hr}
  let lapStartSec = 0;
  let lapHrSum = 0;
  let lapHrCount = 0;
  let lapStartCum = 0;

  const t0 = new Date(valid[0].time).getTime();
  let hrSum = 0, hrCount = 0, hrMax = 0;

  for (let i = 1; i < valid.length; i++) {
    const prev = valid[i - 1];
    const cur = valid[i];
    const d = haversineKm(prev, cur);
    // ignore GPS noise: implausible jumps
    if (d > 0 && d < 0.3) cumKm += d;
    if (prev.ele != null && cur.ele != null && cur.ele > prev.ele) {
      elevGain += cur.ele - prev.ele;
    }
    if (cur.hr != null) {
      hrSum += cur.hr; hrCount++;
      if (cur.hr > hrMax) hrMax = cur.hr;
      lapHrSum += cur.hr; lapHrCount++;
    }
    const curSec = (new Date(cur.time).getTime() - t0) / 1000;

    if (cumKm - lapStartCum >= 1) {
      laps.push({
        km: laps.length + 1,
        split_sec: Math.round(curSec - lapStartSec),
        cum_sec: Math.round(curSec),
        avg_hr: lapHrCount ? Math.round(lapHrSum / lapHrCount) : null,
      });
      lapStartSec = curSec;
      lapStartCum = cumKm;
      lapHrSum = 0; lapHrCount = 0;
    }
  }

  const last = valid[valid.length - 1];
  const totalSec = (new Date(last.time).getTime() - t0) / 1000;
  // final partial km, if meaningful
  if (cumKm - lapStartCum > 0.05) {
    laps.push({
      km: laps.length + 1,
      partial_km: Math.round((cumKm - lapStartCum) * 100) / 100,
      split_sec: Math.round(totalSec - lapStartSec),
      cum_sec: Math.round(totalSec),
      avg_hr: lapHrCount ? Math.round(lapHrSum / lapHrCount) : null,
    });
  }

  return {
    distance_km: Math.round(cumKm * 100) / 100,
    duration_sec: Math.round(totalSec),
    avg_pace_sec: cumKm > 0 ? Math.round(totalSec / cumKm) : null,
    avg_hr: hrCount ? Math.round(hrSum / hrCount) : null,
    max_hr: hrMax || null,
    elevation_gain_m: Math.round(elevGain),
    started_at: valid[0].time,
    laps,
  };
}

function parseActivityFile(xml, filename) {
  const isTCX = /<TrainingCenterDatabase|<Trackpoint>/.test(xml) && !/<trkpt\b/.test(xml);
  const points = isTCX ? parseTCX(xml) : parseGPX(xml);
  const summary = summarize(points);
  if (!summary) return null;
  summary.source = isTCX ? 'tcx' : 'gpx';
  summary.point_count = points.length;
  return summary;
}

module.exports = { parseActivityFile, haversineKm };
