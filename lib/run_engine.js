// Motor de regras do Professor ao vivo na corrida. Roda no navegador do app e em Node (testes).
// Entrada: posições GPS, batimentos e relógio. Saída: eventos de fala com prioridade.
// Nada aqui fala sozinho: o app entrega cada evento ao Professor (voz), que só narra o fato.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function rad(x) { return x * Math.PI / 180; }
  function haversineM(a, b) {
    const R = 6371000;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function flatM(lat1, lon1, lat2, lon2) {
    const dy = (lat2 - lat1) * 110540;
    const dx = (lon2 - lon1) * 111320 * Math.cos(rad(lat1));
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ---- texto falável ----
  function paceSpoken(sec) {
    sec = Math.round(sec);
    const m = Math.floor(sec / 60), s = sec % 60;
    return s === 0 ? m + ' em ponto' : m + ' e ' + s;
  }
  function timeSpoken(sec) {
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const out = [];
    if (h) out.push(h + (h === 1 ? ' hora' : ' horas'));
    if (m) out.push(m + (m === 1 ? ' minuto' : ' minutos'));
    if (s && !h) out.push(s + (s === 1 ? ' segundo' : ' segundos'));
    return out.join(' e ') || '0 segundos';
  }
  function distSpoken(m) {
    const km = Math.floor(m / 1000), rest = Math.round((m % 1000) / 50) * 50;
    if (km === 0) return Math.round(m / 50) * 50 + ' metros';
    if (rest === 0 || rest === 1000) return (rest === 1000 ? km + 1 : km) + (km === 1 && rest !== 1000 ? ' quilômetro' : ' quilômetros');
    return km + ' quilômetros e ' + rest + ' metros';
  }
  function pctSpoken(g) { return String(g).replace('.', ',') + ' por cento'; }

  function create(cfg) {
    cfg = cfg || {};
    const emitFn = cfg.emit || function () {};
    const goal = cfg.goalPaceSec || null;
    const hrCeiling = cfg.hrCeiling || null;
    const maxHr = cfg.maxHr || null;
    const bounds = cfg.zoneBounds || null; // [topoZ1..topoZ4]
    const type = cfg.workoutType || 'livre';
    const course = cfg.course && cfg.course.points && cfg.course.points.length > 10 ? cfg.course : null;
    const raceDistM = cfg.raceDistKm ? cfg.raceDistKm * 1000 : (course ? course.distance_km * 1000 : null);
    const quietPace = type === 'tiros'; // tiros: sem aviso de pace nem de zona
    const E = {};

    const st = {
      started: null, pausedTotal: 0, pausedAt: null,
      dist: 0, last: null, samples: [], // {vt, dist, alt}
      hrBuf: [], hrLast: null, hrLostFlag: false, hadHr: false,
      nextKm: 1, kmStartVt: 0, kmStartDist: 0, kmHrSum: 0, kmHrN: 0,
      courseM: 0, onCourse: false, offCount: 0, lastSnapT: -1e9,
      fired: {}, cool: {}, overSince: null, paceOffSince: null, safetySince: null, inClimb: null,
      quiet: false, hrAlerts: 0, underSince: null,
    };

    function vt(t) { return t - (st.started || t) - st.pausedTotal - (st.pausedAt != null ? (t - st.pausedAt) : 0); }
    function emit(type_, prio, text, key, ttl) {
      if (key) { if (st.fired[key]) return; st.fired[key] = true; }
      emitFn({ type: type_, prio, text, ttl: ttl || 30000 });
    }
    function cooled(name, t, gapMs) {
      if (st.cool[name] != null && t - st.cool[name] < gapMs) return false;
      st.cool[name] = t; return true;
    }

    // ---- HR ----
    E.hr = function (bpm, t) {
      if (!bpm || bpm < 30 || bpm > 230) return;
      st.hrLast = { t, v: bpm };
      st.hadHr = true;
      if (st.hrLostFlag) st.hrLostFlag = false;
      st.hrBuf.push({ t, v: bpm });
      while (st.hrBuf.length && t - st.hrBuf[0].t > 15000) st.hrBuf.shift();
      if (st.started != null && st.pausedAt == null) { st.kmHrSum += bpm; st.kmHrN++; }
    };
    function hrSmooth(t) {
      const arr = st.hrBuf.filter((x) => t - x.t <= 15000);
      if (!arr.length) return null;
      return Math.round(arr.reduce((a, x) => a + x.v, 0) / arr.length);
    }
    function zoneOf(h) {
      if (!bounds) return null;
      for (let i = 0; i < bounds.length; i++) if (h <= bounds[i]) return i + 1;
      return 5;
    }

    // ---- percurso ----
    function snap(lat, lon, centerM, halfWin) {
      const P = course.points;
      const step = P.length > 1 ? P[1][0] - P[0][0] : 25;
      let i0 = 0, i1 = P.length - 1;
      if (centerM != null) { i0 = Math.max(0, Math.floor((centerM - halfWin) / step)); i1 = Math.min(P.length - 1, Math.ceil((centerM + halfWin) / step)); }
      let best = Infinity, bi = -1;
      for (let i = i0; i <= i1; i++) {
        const dd = flatM(lat, lon, P[i][2], P[i][3]);
        if (dd < best) { best = dd; bi = i; }
      }
      return bi < 0 ? null : { d: P[bi][0], off: best };
    }
    function updateCourse(f, t, delta) {
      if (!course) return;
      if (st.onCourse) st.courseM += delta;
      if (t - st.lastSnapT < 3000) return;
      st.lastSnapT = t;
      const r = st.onCourse ? snap(f.lat, f.lon, st.courseM, 250) : snap(f.lat, f.lon, null, 0);
      if (r && r.off <= (st.onCourse ? 60 : 45)) {
        // reencontrou/ajustou a posição no percurso
        st.courseM = st.onCourse ? 0.5 * st.courseM + 0.5 * r.d : r.d;
        st.onCourse = true; st.offCount = 0;
      } else if (st.onCourse) {
        st.offCount++;
        if (st.offCount >= 6) st.onCourse = false;
      }
    }
    function checkCourseAlerts(t) {
      if (!course || !st.onCourse) return;
      const cm = st.courseM;
      (course.climbs || []).forEach((c, i) => {
        const len = c.endM - c.startM;
        const toStart = c.startM - cm;
        const up = c.type === 'up';
        const kind = up ? 'subida' : 'descida';
        if (up) {
          if (toStart <= 1000 && toStart > 250 && !st.fired['c' + i + 's1']) {
            const R = Math.round(toStart / 50) * 50;
            emit('subida', 3, `[EVENTO subida] Daqui a aproximadamente ${R} metros começa uma subida de ${len} metros de extensão, ganhando ${c.gain} metros de altitude, inclinação média de ${pctSpoken(c.grade)}. Oriente a poupar esforço e olhar a respiração, não o pace.`, 'c' + i + 's1', 25000);
          } else if (toStart <= 250 && toStart > -40 && !st.fired['c' + i + 's2']) {
            st.fired['c' + i + 's1'] = true;
            emit('subida', 3, `[EVENTO subida] A subida começa agora: ${len} metros, ${c.gain} metros de ganho. Oriente passada curta, ombros soltos e esforço constante.`, 'c' + i + 's2', 15000);
          }
          if (cm >= c.endM - 60 && cm <= c.endM + 150 && st.fired['c' + i + 's2'] && !st.fired['c' + i + 's3']) {
            emit('subida', 2, '[EVENTO subida] Topo da subida. Oriente recuperar a respiração e retomar o pace aos poucos.', 'c' + i + 's3', 15000);
          }
        } else if (toStart <= 400 && toStart > -40 && !st.fired['c' + i + 'd1']) {
          const R = Math.max(50, Math.round(toStart / 50) * 50);
          emit('descida', 2, `[EVENTO descida] Daqui a ${R} metros começa uma descida de ${len} metros, perdendo ${c.gain} metros. Oriente soltar sem frear e sem forçar o impacto nas pernas.`, 'c' + i + 'd1', 20000);
        }
      });
    }

    // subida percebida pelo altímetro do celular (quando não há percurso carregado)
    function checkLiveGrade(t) {
      if (course) return;
      const s = st.samples;
      if (s.length < 10) return;
      const cur = s[s.length - 1];
      let j = s.length - 1;
      while (j > 0 && cur.dist - s[j].dist < 200) j--;
      const span = cur.dist - s[j].dist;
      if (span < 180 || s[j].alt == null || cur.alt == null) return;
      const g = (cur.alt - s[j].alt) / span * 100;
      if (g >= 4 && cooled('grade', t, 240000)) {
        emit('subida', 2, `[EVENTO subida] O atleta está numa subida, inclinação em torno de ${pctSpoken(Math.round(g * 10) / 10)}. Oriente poupar esforço.`, null, 15000);
      }
    }

    // ---- marcos ----
    function checkMilestones(t) {
      if (!raceDistM || raceDistM < 3000) return;
      const pos = (course && st.onCourse) ? st.courseM : st.dist;
      const left = raceDistM - pos;
      if (pos >= raceDistM / 2 && !st.fired.half) emit('marco', 2, `[EVENTO marco] Metade da prova: ${distSpoken(pos)} completos, tempo ${timeSpoken(vt(t) / 1000)}. Oriente administrar a segunda metade.`, 'half', 30000);
      if (raceDistM >= 15000 && left <= 5000 && left > 4600 && pos > raceDistM / 2) emit('marco', 2, '[EVENTO marco] Faltam cinco quilômetros. Oriente manter o ritmo e se alimentar das últimas forças.', 'l5', 25000);
      if (raceDistM >= 5000 && left <= 2000 && left > 1700) emit('marco', 2, '[EVENTO marco] Faltam dois quilômetros. Oriente começar a empurrar se o corpo deixar.', 'l2', 25000);
      if (left <= 1000 && left > 800) emit('marco', 2, '[EVENTO marco] Falta um quilômetro. Oriente dar tudo que tem de forma controlada.', 'l1', 20000);
      if (left <= 400 && left > 250) emit('marco', 3, '[EVENTO marco] Reta final, faltam quatrocentos metros. Oriente acelerar.', 'l04', 15000);
    }

    // ---- GPS ----
    E.start = function (t) {
      st.started = t; st.kmStartVt = 0;
      emit('inicio', 3, '[EVENTO início] A corrida começou agora. Diga em uma frase curta que vai acompanhar e o primeiro alvo (pace ou batimentos), sem pergunta.', null, 20000);
    };
    E.pause = function (t) { if (st.pausedAt == null) st.pausedAt = t; };
    E.resume = function (t) { if (st.pausedAt != null) { st.pausedTotal += t - st.pausedAt; st.pausedAt = null; st.last = null; } };
    E.setQuiet = function (q) { st.quiet = !!q; };

    E.fix = function (f) {
      if (st.started == null || st.pausedAt != null) return null;
      const t = f.t;
      if (f.acc != null && f.acc > 40) return null;
      let delta = 0;
      if (st.last) {
        const dt = (t - st.last.t) / 1000;
        if (dt <= 0) return null;
        const d = haversineM(st.last, f);
        if (d / dt > 9) return null;          // salto de GPS
        if (d < 1.2) { return null; }         // parado / ruído
        delta = d;
      }
      st.dist += delta;
      st.last = { lat: f.lat, lon: f.lon, t };
      const v = vt(t);
      st.samples.push({ vt: v, dist: st.dist, alt: f.alt != null ? f.alt : null });
      if (st.samples.length > 4000) st.samples.splice(0, 1000);
      updateCourse(f, t, delta);
      return { lat: f.lat, lon: f.lon, alt: f.alt, vt: v, hr: st.hrLast && t - st.hrLast.t < 10000 ? st.hrLast.v : null };
    };

    function paceOver(meters, vtNow) {
      const s = st.samples;
      if (s.length < 2) return null;
      const cur = s[s.length - 1];
      let j = s.length - 1;
      while (j > 0 && cur.dist - s[j].dist < meters) j--;
      const span = cur.dist - s[j].dist;
      if (span < meters * 0.8) return null;
      return (cur.vt - s[j].vt) / 1000 / (span / 1000);
    }

    // ---- regras periódicas ----
    E.tick = function (t) {
      if (st.started == null || st.pausedAt != null) return;
      const v = vt(t);

      // parcial por km
      if (st.dist >= st.nextKm * 1000) {
        const n = st.nextKm;
        const splitSec = (v - st.kmStartVt) / 1000;
        const hrAvg = st.kmHrN ? Math.round(st.kmHrSum / st.kmHrN) : null;
        let vs = '';
        if (goal && type !== 'tiros') {
          const diff = Math.round(splitSec - goal);
          vs = Math.abs(diff) <= 3 ? ' Está no alvo.' : (diff < 0 ? ` ${Math.abs(diff)} segundos por quilômetro mais rápido que o alvo de ${paceSpoken(goal)}.` : ` ${diff} segundos por quilômetro mais lento que o alvo de ${paceSpoken(goal)}.`);
        }
        const z = hrAvg ? zoneOf(hrAvg) : null;
        emit('parcial', 1, `[EVENTO parcial] Quilômetro ${n} concluído. Tempo da parcial ${timeSpoken(splitSec)}, pace ${paceSpoken(splitSec)} por quilômetro${hrAvg ? `, batimentos médios ${hrAvg}${z ? ` (zona ${z})` : ''}` : ''}.${vs} Total: ${distSpoken(st.dist)} em ${timeSpoken(v / 1000)}.`, null, 45000);
        st.nextKm++; st.kmStartVt = v; st.kmHrSum = 0; st.kmHrN = 0;
      }

      const hs = hrSmooth(t);

      // batimentos
      if (hs && !quietPace) {
        const over = hrCeiling ? hs > hrCeiling : (bounds ? zoneOf(hs) >= 5 && type !== 'ritmo' : false);
        if (over) {
          if (st.overSince == null) st.overSince = t;
          const gapMs = Math.min(120000 * Math.pow(2, st.hrAlerts), 600000);
          if (t - st.overSince >= 20000 && cooled('hr', t, gapMs)) {
            st.hrAlerts++;
            emit('batimentos', 3, `[EVENTO batimentos] Batimentos em ${hs}, ${hrCeiling ? 'acima do teto de ' + hrCeiling : 'na zona máxima'}. Peça para aliviar o ritmo até voltar.`, null, 20000);
          }
        } else {
          st.overSince = null;
          if (st.underSince == null) st.underSince = t;
          if (t - st.underSince >= 60000) st.hrAlerts = 0;
        }
        if (over) st.underSince = null;
      }
      // segurança
      if (hs && maxHr && hs >= maxHr * 0.97) {
        if (st.safetySince == null) st.safetySince = t;
        if (t - st.safetySince >= 10000 && cooled('safe', t, 60000)) {
          emit('seguranca', 5, `[EVENTO seguranca] Batimentos em ${hs}, no limite máximo. Mande reduzir agora, caminhar e respirar; se houver dor no peito, tontura ou falta de ar, parar e pedir ajuda.`, null, 15000);
        }
      } else st.safetySince = null;
      // sensor perdido
      if (st.hadHr && st.hrLast && t - st.hrLast.t > 25000 && !st.hrLostFlag) {
        st.hrLostFlag = true;
        emit('sensor', 2, '[EVENTO sensor] O sensor de batimentos parou de enviar sinal. Avise em uma frase e peça para conferir a cinta ou o relógio.', null, 20000);
      }

      // pace vs alvo
      if (goal && !quietPace && st.dist > 600) {
        const p = paceOver(type === 'ritmo' ? 300 : 400, v);
        if (p) {
          const tol = Math.max(type === 'ritmo' ? 6 : 12, goal * (type === 'ritmo' ? 0.03 : 0.06));
          const off = p - goal;
          if (Math.abs(off) > tol) {
            if (st.paceOffSince == null) st.paceOffSince = t;
            if (t - st.paceOffSince >= 15000 && cooled('pace', t, 180000)) {
              emit('pace', 2, `[EVENTO pace] Pace dos últimos 400 metros: ${paceSpoken(p)}. Alvo: ${paceSpoken(goal)}. Está ${Math.round(Math.abs(off))} segundos por quilômetro ${off < 0 ? 'mais rápido' : 'mais lento'} que o alvo. Oriente o ajuste.`, null, 20000);
            }
          } else st.paceOffSince = null;
        }
      }

      checkCourseAlerts(t);
      checkLiveGrade(t);
      checkMilestones(t);
    };

    E.state = function (t) {
      const v = st.started != null ? vt(t) : 0;
      const s = st.samples;
      const pn = s.length > 3 ? paceOver(150, v) : null;
      let next = null;
      if (course && st.onCourse) {
        const cl = (course.climbs || []).filter((c) => c.endM > st.courseM).sort((a, b) => a.startM - b.startM)[0];
        if (cl) next = { type: cl.type, inM: Math.max(0, cl.startM - st.courseM), gain: cl.gain, lenM: cl.endM - cl.startM, inside: st.courseM >= cl.startM };
      }
      return { dist: st.dist, elapsedSec: v / 1000, paceNow: pn, paceAvg: st.dist > 50 ? (v / 1000) / (st.dist / 1000) : null, hr: hrSmooth(t), zone: hrSmooth(t) ? zoneOf(hrSmooth(t)) : null, courseM: st.courseM, onCourse: st.onCourse, next, paused: st.pausedAt != null, started: st.started != null };
    };

    return E;
  }

  function buildGpx(points, startMs, name) {
    const esc = (s) => String(s).replace(/[<>&"]/g, '');
    let out = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Runiqx" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><name>' + esc(name || 'Corrida') + '</name><trkseg>\n';
    points.forEach(function (p) {
      out += '<trkpt lat="' + p.lat.toFixed(6) + '" lon="' + p.lon.toFixed(6) + '">' + (p.alt != null ? '<ele>' + p.alt.toFixed(1) + '</ele>' : '') + '<time>' + new Date(startMs + p.vt).toISOString() + '</time>' + (p.hr ? '<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>' + Math.round(p.hr) + '</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>' : '') + '</trkpt>\n';
    });
    return out + '</trkseg></trk></gpx>';
  }

  return { create, buildGpx, haversineM, paceSpoken, timeSpoken, distSpoken };
});
