// Percurso de uma prova a partir do GPX/TCX divulgado pela organização.
// Gera pontos reamostrados (a cada ~25 m, elevação suavizada) e detecta
// subidas e descidas relevantes, para o Professor avisar antes de cada trecho.
const { haversineKm } = require('./gpx');

function num(s) { const n = parseFloat(s); return Number.isFinite(n) ? n : null; }

function rawPoints(xml) {
  const pts = [];
  const trk = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g;
  let m;
  while ((m = trk.exec(xml))) {
    const lat = /\blat="([^"]+)"/.exec(m[1]);
    const lon = /\blon="([^"]+)"/.exec(m[1]);
    const ele = /<ele>([^<]+)<\/ele>/.exec(m[2]);
    if (lat && lon) pts.push({ lat: num(lat[1]), lon: num(lon[1]), ele: ele ? num(ele[1]) : null });
  }
  if (pts.length < 2) {
    const rte = /<rtept\b([^>]*)>([\s\S]*?)<\/rtept>/g;
    while ((m = rte.exec(xml))) {
      const lat = /\blat="([^"]+)"/.exec(m[1]);
      const lon = /\blon="([^"]+)"/.exec(m[1]);
      const ele = /<ele>([^<]+)<\/ele>/.exec(m[2]);
      if (lat && lon) pts.push({ lat: num(lat[1]), lon: num(lon[1]), ele: ele ? num(ele[1]) : null });
    }
  }
  if (pts.length < 2) {
    const tp = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/g;
    while ((m = tp.exec(xml))) {
      const lat = /<LatitudeDegrees>([^<]+)</.exec(m[1]);
      const lon = /<LongitudeDegrees>([^<]+)</.exec(m[1]);
      const ele = /<AltitudeMeters>([^<]+)</.exec(m[1]);
      if (lat && lon) pts.push({ lat: num(lat[1]), lon: num(lon[1]), ele: ele ? num(ele[1]) : null });
    }
  }
  return pts.filter((p) => p.lat != null && p.lon != null);
}

// Média móvel simples (janela em número de pontos, centrada).
function smooth(arr, w) {
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(arr.length - 1, i + w); j++) { s += arr[j]; c++; }
    out[i] = s / c;
  }
  return out;
}

// Subidas/descidas: segmentos contínuos com ganho mínimo e inclinação média mínima,
// tolerando pequenos trechos contrários (até 8 m).
function detectClimbs(P, sign, minGain, minGrade) {
  const E = P.map((p) => p.e * sign);
  const out = [];
  const close = (lo, hi) => {
    if (hi <= lo) return;
    let foot = lo;
    for (let k = lo; k <= hi; k++) if (E[k] <= E[lo] + 1.5) foot = k;
    let top = hi;
    for (let k = foot; k <= hi; k++) if (E[k] >= E[hi] - 1.5) { top = k; break; }
    const gain = E[top] - E[foot];
    const len = P[top].d - P[foot].d;
    if (gain >= minGain && len > 0 && (gain / len) * 100 >= minGrade) {
      out.push({ startM: Math.round(P[foot].d), endM: Math.round(P[top].d), gain: Math.round(gain), grade: Math.round((gain / len) * 1000) / 10 });
    }
  };
  let lo = 0, hi = 0;
  for (let j = 1; j < P.length; j++) {
    if (E[j] > E[hi]) hi = j;
    else if (E[hi] - E[j] > 8) { close(lo, hi); lo = j; hi = j; }
    else if (E[j] < E[lo] && E[hi] - E[lo] < 3) { lo = j; hi = j; }
  }
  close(lo, hi);
  return out;
}

function parseCourse(xml) {
  const raw = rawPoints(xml);
  if (raw.length < 10) throw new Error('poucos_pontos');
  // distância acumulada
  let d = 0;
  const cum = [0];
  for (let i = 1; i < raw.length; i++) {
    d += haversineKm(raw[i - 1], raw[i]) * 1000;
    cum.push(d);
  }
  if (d < 500) throw new Error('curto');
  // fallback de elevação ausente: interpola
  let lastE = raw.find((p) => p.ele != null);
  const hasEle = !!lastE;
  let cur = hasEle ? lastE.ele : 0;
  const eles = raw.map((p) => { if (p.ele != null) cur = p.ele; return cur; });
  // reamostra a cada 25 m
  const step = 25;
  const P = [];
  let k = 0;
  for (let t = 0; t <= d; t += step) {
    while (k < cum.length - 2 && cum[k + 1] < t) k++;
    const span = cum[k + 1] - cum[k] || 1;
    const f = Math.min(1, Math.max(0, (t - cum[k]) / span));
    P.push({
      d: t,
      lat: raw[k].lat + (raw[k + 1].lat - raw[k].lat) * f,
      lon: raw[k].lon + (raw[k + 1].lon - raw[k].lon) * f,
      e: eles[k] + (eles[k + 1] - eles[k]) * f,
    });
  }
  const sm = smooth(P.map((p) => p.e), 3); // ~175 m
  P.forEach((p, i) => { p.e = sm[i]; });
  let gain = 0, loss = 0;
  for (let i = 1; i < P.length; i++) { const dv = P[i].e - P[i - 1].e; if (dv > 0) gain += dv; else loss -= dv; }
  const climbs = hasEle ? detectClimbs(P, 1, 12, 2).map((c) => ({ ...c, type: 'up' })) : [];
  const downs = hasEle ? detectClimbs(P, -1, 15, 2.5).map((c) => ({ ...c, type: 'down' })) : [];
  const all = climbs.concat(downs).sort((a, b) => a.startM - b.startM);
  return {
    distance_km: Math.round(d / 10) / 100,
    gain_m: hasEle ? Math.round(gain) : null,
    loss_m: hasEle ? Math.round(loss) : null,
    has_elevation: hasEle,
    // compacto: [distância_m, elevação_m, lat, lon]
    points: P.map((p) => [Math.round(p.d), Math.round(p.e * 10) / 10, Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5]),
    climbs: all,
  };
}

function fmtKm(m) { return (Math.round(m / 100) / 10).toString().replace('.', ',') + ' km'; }

// Resumo falado/escrito do percurso para as instruções do Professor.
function courseBriefing(course, raceName) {
  if (!course) return '';
  const lines = [];
  lines.push(`PERCURSO OFICIAL DA PROVA${raceName ? ' ' + raceName : ''}: ${String(course.distance_km).replace('.', ',')} km${course.gain_m != null ? `, ${course.gain_m} m de subida acumulada e ${course.loss_m} m de descida` : ''}.`);
  const ups = (course.climbs || []).filter((c) => c.type === 'up');
  const downs = (course.climbs || []).filter((c) => c.type === 'down');
  if (ups.length) lines.push('Subidas relevantes: ' + ups.map((c) => `do km ${fmtKm(c.startM).replace(' km', '')} ao ${fmtKm(c.endM).replace(' km', '')} (+${c.gain} m, ${String(c.grade).replace('.', ',')}%)`).join('; ') + '.');
  if (downs.length) lines.push('Descidas relevantes: ' + downs.map((c) => `do km ${fmtKm(c.startM).replace(' km', '')} ao ${fmtKm(c.endM).replace(' km', '')} (-${c.gain} m)`).join('; ') + '.');
  if (!ups.length && !downs.length) lines.push('Percurso praticamente plano.');
  return lines.join(' ');
}

module.exports = { parseCourse, courseBriefing };
