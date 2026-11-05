/* Tela de corrida do Runiqx: Professor ao vivo antes, durante e depois do treino.
   Usa lib/run_engine.js (regras), sensores do app (GPS em segundo plano, cinta Bluetooth, Saúde) e voz via OpenAI Realtime. */
(function () {
  'use strict';
  var CFG = window.__RUN_CFG__ || {};
  var RE = window.RunEngine;
  var Cap = window.Capacitor;
  var PL = (Cap && Cap.Plugins) || {};
  var isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  var SIM = /[?&]sim=1/.test(location.search);
  var SIMX = 12; // velocidade do simulador
  var $ = function (id) { return document.getElementById(id); };
  var ls = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del: function (k) { try { localStorage.removeItem(k); } catch (e) {} } };

  // ---------- estado ----------
  var S = { phase: 'setup', type: 'leve', engine: null, startMs: 0, points: [], params: null, course: null, timer: null, quiet: false, simBase: 0, finishing: false, confirmT: null, actId: null, lastSaved: 0 };
  var V = { pc: null, dc: null, el: null, stream: null, on: false, busy: false, audioPlaying: false, userSpeaking: false, lastDone: 0, swapping: false, muted: false, connecting: false, retry: 0, wanted: false, transcript: '' };
  var Q = [];
  var HR = { src: null, value: null, at: 0, devices: [], poll: null, ble: null };

  function clock() { return SIM && S.simBase ? S.simBase + (Date.now() - S.simBase0) * SIMX : Date.now(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtT(sec) { sec = Math.max(0, Math.round(sec)); var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' + pad(m) : m) + ':' + pad(s); }
  function fmtP(sec) { if (!sec || !isFinite(sec) || sec > 1200) return '--:--'; var m = Math.floor(sec / 60), s = Math.round(sec % 60); if (s === 60) { m++; s = 0; } return m + ':' + pad(s); }
  function parsePace(str) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim()); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function show(id) { ['setup', 'live', 'done'].forEach(function (x) { $(x).hidden = x !== id; }); S.phase = id; window.scrollTo(0, 0); }
  function logDebug(m) { var d = $('dbg'); if (!d || !SIM) return; d.hidden = false; d.textContent = (new Date().toLocaleTimeString() + ' ' + m + '\n' + d.textContent).slice(0, 4000); }

  // ---------- configuração do treino ----------
  var TYPE_DEFAULT_ZONE = { leve: 1, longao: 2, ritmo: 3 };
  function setType(t) {
    S.type = t;
    Array.prototype.forEach.call(document.querySelectorAll('[data-type]'), function (b) { b.classList.toggle('on', b.getAttribute('data-type') === t); });
    var z = TYPE_DEFAULT_ZONE[t];
    if (z != null && CFG.zoneBounds && !$('hrc').dataset.touched) $('hrc').value = CFG.zoneBounds[z];
    if (z == null && !$('hrc').dataset.touched) $('hrc').value = '';
  }
  function raceById(id) { id = +id; for (var i = 0; i < (CFG.races || []).length; i++) if (CFG.races[i].id === id) return CFG.races[i]; return null; }
  function onRaceChange() {
    var r = raceById($('race').value);
    $('coursehint').textContent = r ? (r.has_course ? 'Percurso carregado: o Professor avisa as subidas.' : 'Sem percurso. Envie o GPX da prova em Provas para ter avisos de subida.') : '';
    if (r && r.goal_time_sec && r.distance_km && !$('pace').dataset.touched) $('pace').value = fmtP(r.goal_time_sec / r.distance_km);
    S.course = null;
    if (r && r.has_course) {
      fetch('/api/races/' + r.id + '/course').then(function (x) { return x.ok ? x.json() : null; }).then(function (c) { S.course = c; drawProfile(); }).catch(function () {});
    } else drawProfile();
  }
  function runParams() {
    var r = raceById($('race').value);
    return { workoutType: S.type, raceId: r ? r.id : null, goalPaceSec: parsePace($('pace').value), hrCeiling: parseInt($('hrc').value, 10) || null };
  }

  // ---------- perfil de altimetria ----------
  function drawProfile() {
    var box = $('profile'), c = S.course;
    if (!c || !c.points || c.points.length < 5) { box.hidden = true; return; }
    box.hidden = false;
    var P = c.points, n = P.length, step = Math.max(1, Math.floor(n / 220)), lo = 1e9, hi = -1e9, i;
    for (i = 0; i < n; i++) { if (P[i][1] < lo) lo = P[i][1]; if (P[i][1] > hi) hi = P[i][1]; }
    var span = Math.max(20, hi - lo), total = P[n - 1][0], d = 'M0,60';
    for (i = 0; i < n; i += step) d += ' L' + (P[i][0] / total * 300).toFixed(1) + ',' + (56 - (P[i][1] - lo) / span * 48).toFixed(1);
    d += ' L300,60 Z';
    var bands = '';
    (c.climbs || []).forEach(function (k) { bands += '<rect x="' + (k.startM / total * 300).toFixed(1) + '" y="0" width="' + Math.max(1.5, (k.endM - k.startM) / total * 300).toFixed(1) + '" height="60" fill="' + (k.type === 'up' ? 'rgba(255,107,107,.22)' : 'rgba(78,155,255,.2)') + '"/>'; });
    $('profsvg').innerHTML = bands + '<path d="' + d + '" fill="rgba(255,194,78,.25)" stroke="#FFC24E" stroke-width="1.4"/>';
    $('proftxt').textContent = c.distance_km + ' km' + (c.gain_m != null ? ' · +' + c.gain_m + ' m' : '');
  }
  function moveMarker(courseM) {
    var c = S.course; if (!c) return;
    var total = c.points[c.points.length - 1][0];
    $('pmark').style.left = Math.min(100, Math.max(0, courseM / total * 100)) + '%';
  }

  // ---------- fila de falas ----------
  function enqueue(ev) {
    ev.at = Date.now();
    Q.push(ev);
    logDebug('[' + ev.type + '] ' + ev.text.slice(0, 110));
    flash(ev);
  }
  var FLASH = { subida: 'Subida à frente', descida: 'Descida à frente', batimentos: 'Batimentos altos: alivie', pace: 'Ajuste o pace', seguranca: 'Alerta de segurança', marco: 'Marco da prova', sensor: 'Sensor sem sinal' };
  function flash(ev) {
    var t = FLASH[ev.type]; if (!t) return;
    var b = $('flash'); b.textContent = t; b.hidden = false; b.dataset.k = ev.type;
    clearTimeout(flash.t); flash.t = setTimeout(function () { b.hidden = true; }, 7000);
  }
  function voiceReady() { return V.on && V.dc && V.dc.readyState === 'open' && !V.swapping; }
  function send(o) { try { V.dc.send(JSON.stringify(o)); return true; } catch (e) { return false; } }
  function speakUserText(text) {
    if (!send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: text }] } })) return false;
    send({ type: 'response.create' });
    V.busy = true; V.busyAt = Date.now(); // até o primeiro response.created confirmar
    return true;
  }
  function pump() {
    var now = Date.now(), i;
    for (i = Q.length - 1; i >= 0; i--) if (now - Q[i].at > (Q[i].ttl || 30000)) Q.splice(i, 1);
    if (S.quiet) for (i = Q.length - 1; i >= 0; i--) if (Q[i].type !== 'parcial' && Q[i].type !== 'seguranca') Q.splice(i, 1);
    if (V.busy && now - (V.busyAt || 0) > 25000) V.busy = false;
    if (V.audioPlaying && now - V.lastDone > 60000) V.audioPlaying = false;
    if (!Q.length || !voiceReady()) return;
    if (V.busy || V.audioPlaying || V.userSpeaking || now - V.lastDone < 700) return;
    Q.sort(function (a, b) { return (b.prio - a.prio) || (a.at - b.at); });
    var text;
    if (Q.length >= 3) {
      text = '[EVENTO acumulado] Resuma em UMA frase curta estes fatos, do mais importante ao menos: ' + Q.map(function (x) { return x.text.replace(/^\[EVENTO [^\]]+\]\s*/, ''); }).join(' | ');
      Q.length = 0;
    } else { text = Q.shift().text; }
    speakUserText(text);
  }

  // ---------- voz (OpenAI Realtime) ----------
  function setVoiceUi(state, msg) {
    var pill = $('vpill'), st = $('vstate');
    pill.className = 'pill ' + state; st.textContent = msg;
    ['vpill2', 'vpill3'].forEach(function (id) { var e = $(id); if (e) { e.className = 'pill ' + state; e.textContent = msg; } });
    $('vbtn').textContent = V.on ? 'Desligar Professor' : 'Chamar o Professor';
    $('vmute').hidden = !V.on; $('vmute2').hidden = !V.on;
  }
  function handleEvent(raw) {
    var ev; try { ev = JSON.parse(raw); } catch (e) { return; }
    switch (ev.type) {
      case 'response.created': V.busy = true; V.busyAt = Date.now(); break;
      case 'response.done': V.busy = false; V.lastDone = Date.now(); break;
      case 'input_audio_buffer.speech_started': V.userSpeaking = true; setVoiceUi('listening', 'Ouvindo você'); break;
      case 'input_audio_buffer.speech_stopped': V.userSpeaking = false; break;
      case 'output_audio_buffer.started': V.audioPlaying = true; setVoiceUi('speaking', 'Professor falando'); break;
      case 'output_audio_buffer.stopped': case 'output_audio_buffer.cleared': V.audioPlaying = false; V.lastDone = Date.now(); setVoiceUi('on', 'Professor na linha'); break;
      case 'response.output_audio_transcript.done': if (ev.transcript) { V.transcript = ev.transcript; $('said').textContent = ev.transcript; $('said2').textContent = ev.transcript; $('said3').textContent = ev.transcript; } break;
      case 'error': logDebug('erro voz: ' + JSON.stringify(ev.error || ev).slice(0, 160)); V.busy = false; break;
    }
  }
  function voiceCleanup() {
    V.on = false; V.busy = false; V.audioPlaying = false; V.userSpeaking = false;
    try { if (V.dc) V.dc.close(); } catch (e) {}
    try { if (V.pc) V.pc.close(); } catch (e) {}
    try { if (V.stream) V.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    if (V.el && V.el.parentNode) V.el.parentNode.removeChild(V.el);
    V.pc = V.dc = V.stream = V.el = null;
  }
  function voiceConnect(phase) {
    if (V.connecting || V.on) return Promise.resolve(V.on);
    V.connecting = true; V.wanted = true;
    setVoiceUi('connecting', 'Conectando…');
    var body = runParams(); body.phase = phase;
    return fetch('/api/run/realtime-session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) {
      if (r.status === 402) throw { k: 'premium' };
      if (r.status === 412) throw { k: 'key' };
      if (!r.ok) throw { k: 'generic' };
      return r.json();
    }).then(function (sess) {
      var key = sess && sess.value; if (!key) throw { k: 'generic' };
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (stream) {
        V.stream = stream;
        V.pc = new RTCPeerConnection();
        V.el = document.createElement('audio'); V.el.autoplay = true; V.el.setAttribute('playsinline', ''); V.el.style.display = 'none'; document.body.appendChild(V.el);
        V.pc.ontrack = function (e) { V.el.srcObject = e.streams[0]; V.el.play().catch(function () {}); };
        stream.getTracks().forEach(function (t) { t.enabled = !V.muted; V.pc.addTrack(t, stream); });
        V.dc = V.pc.createDataChannel('oai-events');
        V.dc.addEventListener('message', function (e) { handleEvent(e.data); });
        V.dc.addEventListener('close', onVoiceDrop);
        V.pc.addEventListener('connectionstatechange', function () { if (V.pc && (V.pc.connectionState === 'failed' || V.pc.connectionState === 'closed')) onVoiceDrop(); });
        return V.pc.createOffer().then(function (o) { return V.pc.setLocalDescription(o); }).then(function () {
          return fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', body: V.pc.localDescription.sdp, headers: { authorization: 'Bearer ' + key, 'content-type': 'application/sdp' } });
        }).then(function (r) { if (!r.ok) throw { k: 'generic' }; return r.text(); })
          .then(function (sdp) { return V.pc.setRemoteDescription({ type: 'answer', sdp: sdp }); })
          .then(function () {
            if (V.dc.readyState === 'open') return;
            return new Promise(function (res, rej) { var to = setTimeout(function () { rej({ k: 'generic' }); }, 9000); V.dc.addEventListener('open', function () { clearTimeout(to); res(); }); });
          });
      });
    }).then(function () {
      V.connecting = false; V.on = true; V.retry = 0; V.lastDone = Date.now();
      setVoiceUi('on', 'Professor na linha');
      return true;
    }).catch(function (e) {
      V.connecting = false; voiceCleanup();
      var k = e && e.k;
      if (k === 'premium') setVoiceUi('off', 'Voz exige o Premium'), $('vnote').innerHTML = 'O Professor ao vivo faz parte do <a href="/premium">Runiqx Premium</a> (7 dias grátis).';
      else if (k === 'key') setVoiceUi('off', 'Falta a chave de voz'), $('vnote').innerHTML = 'Cadastre sua chave OpenAI em <a href="/settings">Configurações</a> para usar a voz.';
      else if (e && e.name === 'NotAllowedError') setVoiceUi('off', 'Microfone bloqueado'), $('vnote').textContent = 'Libere o microfone para conversar com o Professor.';
      else setVoiceUi('off', 'Sem conexão com o Professor');
      V.wanted = k !== 'premium' && k !== 'key' && V.wanted;
      if (V.wanted) scheduleReconnect();
      return false;
    });
  }
  function phaseNow() { return S.phase === 'done' ? 'after' : 'during'; }
  function scheduleReconnect() {
    if (!V.wanted || V.reconnecting || S.phase === 'setup') return;
    V.reconnecting = true;
    var wait = Math.min(30000, 4000 * Math.pow(2, V.retry++));
    setTimeout(function () {
      V.reconnecting = false;
      if (!V.wanted || V.on || V.connecting) return;
      voiceConnect('before').then(function (ok) {
        if (ok) swapInstructions(phaseNow(), S.afterIns && phaseNow() === 'after' ? { instructions: S.afterIns } : null);
        else scheduleReconnect();
      });
    }, wait);
  }
  function onVoiceDrop() {
    if (!V.on) return;
    voiceCleanup();
    setVoiceUi('off', 'Reconectando…');
    scheduleReconnect();
  }
  function voiceOff() {
    V.wanted = false; V.userOff = true; voiceCleanup(); setVoiceUi('off', 'Professor desligado');
  }
  function swapInstructions(phase, extra) {
    V.swapping = true;
    var body = runParams(); body.phase = phase;
    return fetch('/api/run/instructions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var ins = (extra && extra.instructions) || (j && j.instructions);
        if (ins && V.dc && V.dc.readyState === 'open') send({ type: 'session.update', session: { type: 'realtime', instructions: ins } });
      }).catch(function () {}).then(function () { setTimeout(function () { V.swapping = false; }, 400); });
  }
  function toggleMute() {
    V.muted = !V.muted;
    if (V.stream) V.stream.getTracks().forEach(function (t) { t.enabled = !V.muted; });
    $('vmute').textContent = V.muted ? 'Ativar microfone' : 'Silenciar microfone';
    $('vmute2').textContent = V.muted ? 'Microfone desligado' : 'Microfone ligado';
  }

  // ---------- batimentos ----------
  function setHr(bpm, src) {
    HR.value = bpm; HR.at = Date.now(); HR.src = src;
    if (S.engine) S.engine.hr(bpm, clock());
  }
  function hrUi(msg) { $('hrstate').textContent = msg; }
  function bleListeners() {
    var p = PL.RunniqxHeartRate; if (!p || HR.bound) return; HR.bound = true;
    p.addListener('device', function (d) { if (!d || !d.id) return; for (var i = 0; i < HR.devices.length; i++) if (HR.devices[i].id === d.id) return; HR.devices.push(d); renderDevices(); });
    p.addListener('heartRate', function (d) { if (d && d.bpm) setHr(d.bpm, 'cinta'); });
    p.addListener('disconnected', function () { hrUi('Sensor desconectado'); });
    p.addListener('state', function (d) { if (d && d.state === 'poweredOff') hrUi('Bluetooth desligado'); });
  }
  function renderDevices() {
    var box = $('devices'); box.innerHTML = '';
    HR.devices.forEach(function (d) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'dev'; b.textContent = d.name || 'Sensor de batimentos';
      b.onclick = function () { connectBle(d.id, d.name); }; box.appendChild(b);
    });
  }
  function scanBle() {
    if (PL.RunniqxHeartRate) {
      bleListeners(); HR.devices = []; renderDevices(); hrUi('Procurando sensores…');
      PL.RunniqxHeartRate.scan().catch(function () { hrUi('Não consegui usar o Bluetooth'); });
      setTimeout(function () { try { PL.RunniqxHeartRate.stopScan(); } catch (e) {} if (!HR.devices.length) hrUi('Nenhum sensor encontrado. Ligue a cinta (molhe os eletrodos) e tente de novo.'); }, 12000);
    } else if (navigator.bluetooth) {
      navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] }).then(function (dev) {
        return dev.gatt.connect().then(function (srv) { return srv.getPrimaryService('heart_rate'); }).then(function (svc) { return svc.getCharacteristic('heart_rate_measurement'); }).then(function (ch) {
          return ch.startNotifications().then(function () {
            ch.addEventListener('characteristicvaluechanged', function (e) { var v = e.target.value, f = v.getUint8(0); setHr((f & 1) ? v.getUint16(1, true) : v.getUint8(1), 'cinta'); });
            hrUi('Conectado: ' + (dev.name || 'sensor'));
          });
        });
      }).catch(function () { hrUi('Não consegui conectar'); });
    } else hrUi('Bluetooth não disponível aqui');
  }
  function connectBle(id, name) {
    var p = PL.RunniqxHeartRate; if (!p) return;
    try { p.stopScan(); } catch (e) {}
    hrUi('Conectando…');
    p.connect({ id: id }).then(function () { hrUi('Conectado: ' + (name || 'sensor') + '. Aguardando batimentos…'); ls.set('rq-hr-ble', id); }).catch(function () { hrUi('Falhou. Aproxime a cinta e tente de novo.'); });
  }
  function startHealth() {
    var H = PL.Health;
    if (!H) { hrUi('O Apple Watch só funciona no app do iPhone.'); return; }
    hrUi('Pedindo permissão da Saúde…');
    H.requestAuthorization({ read: ['heartRate'], write: [] }).then(function () {
      hrUi('Apple Watch: inicie um treino de corrida no relógio para os batimentos chegarem a cada poucos segundos.');
      if (HR.poll) clearInterval(HR.poll);
      var once = function () {
        var now = new Date();
        H.readSamples({ dataType: 'heartRate', startDate: new Date(now.getTime() - 150000).toISOString(), endDate: now.toISOString(), limit: 20 }).then(function (r) {
          var arr = (r && r.samples) || []; if (!arr.length) return;
          arr.sort(function (a, b) { return new Date(b.endDate || b.startDate) - new Date(a.endDate || a.startDate); });
          var s = arr[0], when = new Date(s.endDate || s.startDate).getTime();
          if (Date.now() - when <= 120000 && s.value) { setHr(Math.round(s.value), 'watch'); HR.lag = Math.round((Date.now() - when) / 1000); hrUi('Apple Watch: ' + Math.round(s.value) + ' (atraso ' + HR.lag + ' s)'); }
        }).catch(function () {});
      };
      once(); HR.poll = setInterval(once, 5000);
    }).catch(function () { hrUi('Permissão da Saúde negada'); });
  }

  // ---------- localização ----------
  var LOC = { watchId: null, native: false };
  function onLoc(f) {
    if (!S.engine || S.phase !== 'live') return;
    var t = clock();
    var pt = S.engine.fix({ lat: f.latitude, lon: f.longitude, alt: f.altitude, acc: f.accuracy, t: t });
    if (pt) S.points.push(pt);
    $('gps').textContent = f.accuracy && f.accuracy <= 20 ? 'GPS ok' : 'GPS fraco';
  }
  function startLoc() {
    var BG = PL.BackgroundGeolocation;
    if (SIM) return startSim();
    if (BG) {
      LOC.native = true;
      BG.start({ backgroundMessage: 'Runiqx acompanhando sua corrida', backgroundTitle: 'Corrida em andamento', requestPermissions: true, stale: false, distanceFilter: 2 }, function (loc, err) {
        if (err) { $('gps').textContent = 'Sem permissão de localização'; return; }
        if (loc) onLoc(loc);
      }).catch(function () { $('gps').textContent = 'Sem permissão de localização'; });
    } else if (navigator.geolocation) {
      LOC.watchId = navigator.geolocation.watchPosition(function (p) { onLoc({ latitude: p.coords.latitude, longitude: p.coords.longitude, altitude: p.coords.altitude, accuracy: p.coords.accuracy }); }, function () { $('gps').textContent = 'Sem permissão de localização'; }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
    } else $('gps').textContent = 'Sem GPS neste aparelho';
  }
  function stopLoc() {
    if (SIM && S.simTimer) { clearInterval(S.simTimer); S.simTimer = null; }
    if (LOC.native && PL.BackgroundGeolocation) { try { PL.BackgroundGeolocation.stop(); } catch (e) {} LOC.native = false; }
    if (LOC.watchId != null) { navigator.geolocation.clearWatch(LOC.watchId); LOC.watchId = null; }
  }
  // simulador (apenas com ?sim=1): corre ao longo do percurso (ou de uma reta) a ~5:30/km
  function startSim() {
    var c = S.course, dist = 0, pace = 330, base = { lat: -25.4284, lon: -49.2733 };
    S.simTimer = setInterval(function () {
      var dt = SIMX; // 1 s real = SIMX s simulados; fix a cada 1 s real
      if (S.paused) return;
      var km = dist / 1000;
      var fast = km > 1.5 && km < 2.1; // trecho rápido para disparar o aviso de pace
      dist += dt * (1000 / (fast ? 285 : pace));
      var lat, lon, alt = 900;
      if (c) {
        var P = c.points, i = Math.min(P.length - 1, Math.floor(dist / 25)); lat = P[i][2]; lon = P[i][3]; alt = P[i][1];
      } else { lat = base.lat + dist / 110540; lon = base.lon; }
      setHr(Math.round(128 + Math.min(45, dist / 130) + (fast ? 10 : 0)), 'sim');
      onLoc({ latitude: lat, longitude: lon, altitude: alt, accuracy: 6 });
    }, 1000);
  }

  // ---------- corrida ----------
  function wakeLock() { try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { S.wl = l; }).catch(function () {}); } catch (e) {} }
  function startRun() {
    S.params = runParams();
    S.points = []; S.quiet = false; S.paused = false; S.finishing = false;
    var r = raceById(S.params.raceId);
    S.engine = RE.create({
      goalPaceSec: S.params.goalPaceSec, hrCeiling: S.params.hrCeiling, maxHr: CFG.maxHr, zoneBounds: CFG.zoneBounds, workoutType: S.type,
      raceDistKm: r && r.distance_km ? r.distance_km : null, course: S.course, emit: enqueue,
    });
    if (SIM) { S.simBase = Date.now(); S.simBase0 = Date.now(); }
    S.startMs = clock();
    show('live');
    $('l-type').textContent = ({ leve: 'Rodagem leve', longao: 'Longão', ritmo: 'Ritmo de prova', tiros: 'Tiros', livre: 'Treino livre' })[S.type];
    $('l-goal').textContent = (S.params.goalPaceSec ? 'Alvo ' + fmtP(S.params.goalPaceSec) + '/km' : 'Sem alvo de pace') + (S.params.hrCeiling ? ' · FC até ' + S.params.hrCeiling : '');
    $('prof2').hidden = !S.course; drawProfile2();
    S.engine.start(clock());
    if (V.on) swapInstructions('during');
    else if (CFG.voiceEnabled && !V.userOff) { V.wanted = true; V.swapping = true; voiceConnect('during').then(function () { V.swapping = false; }); }
    startLoc(); wakeLock();
    S.timer = setInterval(tick, 1000);
    persist(true);
  }
  function drawProfile2() { var s = $('profsvg').innerHTML; $('profsvg2').innerHTML = s; $('proftxt2').textContent = $('proftxt').textContent; }
  function tick() {
    if (!S.engine || S.phase !== 'live') return;
    var t = clock();
    S.engine.tick(t);
    var st = S.engine.state(t);
    $('m-time').textContent = fmtT(st.elapsedSec);
    $('m-dist').textContent = (st.dist / 1000).toFixed(2).replace('.', ',');
    $('m-pace').textContent = fmtP(st.paceNow);
    $('m-avg').textContent = fmtP(st.paceAvg);
    var hrv = st.hr || (HR.value && Date.now() - HR.at < 20000 ? HR.value : null);
    $('m-hr').textContent = hrv || '--';
    var hrbox = $('hrbox'); hrbox.dataset.z = st.zone || '';
    $('m-zone').textContent = st.zone ? 'Zona ' + st.zone : (hrv ? '' : 'sem sensor');
    var nx = $('next');
    if (st.next && (st.next.inside || st.next.inM < 2500)) {
      nx.hidden = false; nx.dataset.k = st.next.type;
      nx.textContent = st.next.inside ? ((st.next.type === 'up' ? 'Na subida' : 'Na descida') + ' · ' + st.next.gain + ' m') : ((st.next.type === 'up' ? 'Subida' : 'Descida') + ' em ' + (Math.round(st.next.inM / 50) * 50) + ' m · ' + st.next.gain + ' m');
    } else nx.hidden = true;
    if (S.course) moveMarker2(st.courseM, st.onCourse);
    if (Date.now() - S.lastSaved > 20000) persist(false);
  }
  function moveMarker2(cm, on) {
    var c = S.course, total = c.points[c.points.length - 1][0];
    var m = $('pmark2'); m.style.left = Math.min(100, Math.max(0, cm / total * 100)) + '%'; m.style.opacity = on ? 1 : 0.3;
  }
  function pauseToggle() {
    if (!S.engine) return;
    S.paused = !S.paused;
    if (S.paused) S.engine.pause(clock()); else S.engine.resume(clock());
    $('bpause').textContent = S.paused ? 'Retomar' : 'Pausar';
  }
  function quietToggle() {
    S.quiet = !S.quiet; S.engine && S.engine.setQuiet(S.quiet);
    $('bquiet').textContent = S.quiet ? 'Voltar a falar tudo' : 'Só parciais';
  }
  function finishAsk() {
    var b = $('bfinish');
    if (!S.confirmT) { b.textContent = 'Toque de novo para finalizar'; b.classList.add('warn'); S.confirmT = setTimeout(function () { S.confirmT = null; b.textContent = 'Finalizar'; b.classList.remove('warn'); }, 4000); return; }
    clearTimeout(S.confirmT); S.confirmT = null; finish();
  }

  // ---------- persistência (recuperação se o app fechar) ----------
  function persist(force) {
    S.lastSaved = Date.now();
    if (!S.engine || SIM) return;
    var pts = S.points.length > 12000 ? S.points.slice(S.points.length - 12000) : S.points;
    ls.set('rq-run-live', JSON.stringify({ startMs: S.startMs, params: S.params, points: pts, savedAt: Date.now(), type: S.type }));
  }
  function buildGpxNow() { return RE.buildGpx(S.points, S.startMs, S.params && S.params.workoutType || 'Corrida'); }

  function finish() {
    if (S.finishing) return; S.finishing = true;
    clearInterval(S.timer); stopLoc();
    if (HR.poll) { clearInterval(HR.poll); HR.poll = null; }
    try { if (S.wl) S.wl.release(); } catch (e) {}
    var st = S.engine.state(clock());
    if (S.points.length < 5 || st.dist < 100) { ls.del('rq-run-live'); $('doneBody').innerHTML = '<p>Corrida curta demais para salvar (menos de 100 m).</p>'; show('done'); return; }
    var gpx = buildGpxNow();
    ls.set('rq-run-pending', JSON.stringify({ gpx: gpx, params: S.params }));
    show('done');
    $('doneBody').innerHTML = '<p class="muted">Salvando seu treino…</p>';
    uploadRun(gpx, S.params, true);
  }
  function uploadRun(gpx, params, talk) {
    var body = { gpx: gpx, workoutType: params.workoutType, raceId: params.raceId, goalPaceSec: params.goalPaceSec, hrCeiling: params.hrCeiling };
    return fetch('/api/run/finish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) {
      if (!r.ok) throw new Error('http' + r.status);
      return r.json();
    }).then(function (j) {
      ls.del('rq-run-pending'); ls.del('rq-run-live');
      S.actId = j.activity_id;
      $('doneBody').innerHTML = '<p>Treino salvo. <a class="btn small" href="/activities/' + j.activity_id + '">Ver treino</a></p>';
      if (talk && j.instructions && CFG.voiceEnabled) afterTalk(j);
    }).catch(function () {
      $('doneBody').innerHTML = '<p>Sem internet agora. Seu treino está guardado no aparelho e será enviado assim que a conexão voltar.</p>';
      window.addEventListener('online', retryPending, { once: true });
    });
  }
  function afterTalk(j) {
    V.wanted = true; V.userOff = false; S.afterIns = j.instructions;
    var go = function () { swapInstructions('after', { instructions: j.instructions }).then(function () { setTimeout(function () { speakUserText('[EVENTO fim] O treino terminou e já foi salvo. Faça o fechamento agora, falando primeiro.'); }, 600); }); };
    if (V.on) go(); else voiceConnect('before').then(function (ok) { if (ok) go(); });
  }
  function retryPending() {
    var raw = ls.get('rq-run-pending'); if (!raw) return;
    try { var p = JSON.parse(raw); uploadRun(p.gpx, p.params, false); } catch (e) {}
  }

  function checkRecovery() {
    var raw = ls.get('rq-run-live'); if (!raw) return;
    try {
      var d = JSON.parse(raw);
      if (!d.points || d.points.length < 20 || Date.now() - d.savedAt > 8 * 3600 * 1000) { ls.del('rq-run-live'); return; }
      var dm = 0; for (var i = 1; i < d.points.length; i++) dm += RE.haversineM(d.points[i - 1], d.points[i]);
      $('recover').hidden = false;
      $('recinfo').textContent = 'Encontrei uma corrida que não foi finalizada: ' + (dm / 1000).toFixed(2).replace('.', ',') + ' km.';
      $('recsave').onclick = function () {
        S.startMs = d.startMs; S.points = d.points; S.params = d.params;
        $('recover').hidden = true; show('done'); $('doneBody').innerHTML = '<p class="muted">Salvando…</p>';
        var gpx = RE.buildGpx(d.points, d.startMs, 'Corrida'); uploadRun(gpx, d.params, false);
      };
      $('recdrop').onclick = function () { ls.del('rq-run-live'); $('recover').hidden = true; };
    } catch (e) { ls.del('rq-run-live'); }
  }

  // ---------- ligações ----------
  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-type]'), function (b) { b.onclick = function () { setType(b.getAttribute('data-type')); }; });
    $('race').onchange = onRaceChange;
    $('pace').oninput = function () { this.dataset.touched = 1; };
    $('hrc').oninput = function () { this.dataset.touched = 1; };
    $('bble').onclick = scanBle;
    $('bhealth').onclick = startHealth;
    $('vbtn').onclick = function () { if (V.on || V.wanted) voiceOff(); else { V.userOff = false; voiceConnect('before').then(function (ok) { if (ok) setTimeout(function () { speakUserText('[EVENTO antes] O atleta abriu a tela de corrida e ainda não começou. Fale primeiro: cumprimente, pergunte como ele está e apresente o treino de hoje.'); }, 500); }); } };
    $('vmute').onclick = toggleMute; $('vmute2').onclick = toggleMute;
    $('bstart').onclick = startRun;
    $('bpause').onclick = pauseToggle; $('bquiet').onclick = quietToggle; $('bfinish').onclick = finishAsk;
    $('bend').onclick = function () { voiceOff(); location.href = S.actId ? '/activities/' + S.actId : '/activities'; };
    if (!CFG.voiceEnabled) { $('vnote').innerHTML = 'Para ouvir o Professor, cadastre sua chave OpenAI em <a href="/settings">Configurações</a>.'; }
    setInterval(pump, 400);
    setType('leve');
    if (CFG.preRace) { $('race').value = String(CFG.preRace); }
    onRaceChange();
    setVoiceUi('off', 'Professor desligado');
    if (!isNative && !navigator.bluetooth) $('bble').title = 'Use o app para conectar a cinta';
    if (!isNative) $('bhealth').hidden = true;
    checkRecovery(); retryPending();
    window.addEventListener('online', retryPending);
    window.__RUN__ = { S: S, V: V, Q: Q, pump: pump, tick: tick };
  }
  init();
})();
