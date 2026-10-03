const { esc } = require('./lib/format');

// "Professor" — the JARVIS-style voice interface for the coach, requested by
// Felipe as an alternative way into the same persona/backend that powers the
// text chat at /assistant (same /api/coach/send + /api/coach/history, same
// system-prompt persona in lib/assistant.js — this page is a different
// FRONT END onto it, not a different brain). Kept as its own standalone
// document (own theme, own fullscreen layout) rather than inside the shared
// app chrome, the same way coachPage() is — this one needs the Web Speech
// APIs (SpeechRecognition for "Hey Professor" + push-to-talk,
// SpeechSynthesis for the spoken reply) and a full-bleed HUD canvas that
// would fight the shared .wrap layout.
//
// Visual language is deliberately the app's own (see the --gold/--blue
// tokens used across the landing hero and the Stories workout cards), not
// the cyan/teal of the reference screenshot Felipe sent — same "glowing
// ring HUD" structure, reskinned to the brand.
function professorPage(user) {
  const firstName = (user.name || '').split(' ')[0] || 'atleta';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Professor · Atletas</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=Archivo+Black&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap">
<style>
  :root{
    --bg:#0B0D10; --bg-1:#1c1006; --bg-2:#2a1608; --bg-3:#150c05;
    --line:rgba(255,255,255,0.11);
    --ink:#F6F7F5; --ink-dim:#9BA1A8; --ink-faint:#6A7078;
    --gold:#FFC24E; --blue:#4E9BFF; --green:#6FD46A; --red:#FF6B6B; --amber:#FFB454;
  }
  *{box-sizing:border-box; margin:0; padding:0;}
  html,body{height:100%; background:var(--bg); overscroll-behavior:none;}
  body{
    font-family:'Archivo',-apple-system,sans-serif; color:var(--ink);
    position:relative; min-height:100vh; min-height:100dvh;
    display:flex; flex-direction:column; overflow:hidden;
    -webkit-font-smoothing:antialiased;
  }
  .bgwash{
    position:fixed; inset:0; z-index:0; pointer-events:none;
    background:
      radial-gradient(1100px 760px at 18% -8%, rgba(255,194,78,0.14), transparent 60%),
      radial-gradient(1000px 860px at 86% 106%, rgba(78,155,255,0.12), transparent 60%),
      linear-gradient(160deg, var(--bg-1) 0%, var(--bg-2) 55%, var(--bg-3) 100%);
  }
  .scan{position:fixed; inset:0; z-index:0; pointer-events:none; opacity:0.035;
    background-image:repeating-linear-gradient(0deg, #fff 0px, #fff 1px, transparent 1px, transparent 3px);
  }

  .topbar{
    position:relative; z-index:2; display:flex; align-items:flex-start; justify-content:space-between;
    padding:22px 26px 0; gap:16px;
  }
  .brandblock .brand{
    font-family:'IBM Plex Mono',monospace; font-weight:700; font-size:22px; letter-spacing:0.22em;
    color:var(--ink);
  }
  .brandblock .tag{
    font-family:'IBM Plex Mono',monospace; font-size:10.5px; letter-spacing:0.14em; color:var(--ink-faint);
    text-transform:uppercase; margin-top:4px;
  }
  .topright{display:flex; flex-direction:column; align-items:flex-end; gap:12px;}
  .topnav{display:flex; align-items:center; gap:18px;}
  .topnav a{
    font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:0.08em; text-transform:uppercase;
    color:var(--ink-faint); text-decoration:none;
  }
  .topnav a:hover{color:var(--ink);}
  .statusblock{text-align:right;}
  .statuspill{
    display:inline-flex; align-items:center; gap:8px;
    font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:0.08em; text-transform:uppercase;
    color:var(--ink-dim);
  }
  .statuspill .dot{width:7px; height:7px; border-radius:50%; background:var(--ink-faint);}
  .statuspill.on .dot{background:var(--gold); box-shadow:0 0 8px var(--gold); animation:dotpulse 1.4s ease-in-out infinite;}
  .statuspill.listening .dot{background:var(--blue); box-shadow:0 0 8px var(--blue);}
  .statuspill.speaking .dot{background:var(--green); box-shadow:0 0 8px var(--green);}
  @keyframes dotpulse{0%,100%{opacity:1} 50%{opacity:.35}}
  @media (prefers-reduced-motion:reduce){.statuspill .dot{animation:none !important;}}

  .stage{
    position:relative; z-index:1; flex:1; display:flex; align-items:center; justify-content:center;
    min-height:0; padding:20px;
  }
  #orbCanvas{display:block; width:min(78vmin, 560px); height:min(78vmin, 560px); max-width:92vw; max-height:92vw;}

  .activate{
    position:absolute; z-index:3; display:flex; flex-direction:column; align-items:center; gap:14px;
    pointer-events:none;
  }
  .activate button{
    pointer-events:auto;
    font-family:'IBM Plex Mono',monospace; font-weight:700; font-size:13px; letter-spacing:0.14em;
    text-transform:uppercase; color:var(--ink); background:rgba(255,194,78,0.1);
    border:1px solid rgba(255,194,78,0.45); border-radius:999px; padding:16px 30px; cursor:pointer;
    transition:background .15s ease, transform .1s ease;
  }
  .activate button:hover{background:rgba(255,194,78,0.2);}
  .activate button:active{transform:scale(.97);}
  .activate p{
    font-family:'Archivo',sans-serif; font-size:13px; color:var(--ink-faint); max-width:280px; text-align:center;
    line-height:1.5;
  }

  .caption{
    position:relative; z-index:2; min-height:34px; text-align:center; padding:0 20px;
    font-family:'Archivo',sans-serif; font-size:17px; color:var(--ink); line-height:1.45;
    max-width:620px; margin:0 auto 6px;
  }
  .caption.muted{color:var(--ink-faint); font-size:14px;}

  .bottom{
    position:relative; z-index:2; display:flex; align-items:flex-end; justify-content:space-between;
    gap:16px; padding:0 26px 18px;
  }
  .log{
    display:flex; flex-direction:column; gap:7px; max-width:min(46vw, 420px); min-width:0;
  }
  .log .row{
    display:flex; gap:10px; font-family:'IBM Plex Mono',monospace; font-size:12.5px; line-height:1.4;
  }
  .log .who{color:var(--ink-faint); flex:none; letter-spacing:0.08em;}
  .log .who.prof{color:var(--gold);}
  .log .txt{color:var(--ink-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .log .row.active .txt{color:var(--ink); white-space:normal; text-overflow:clip;}

  .meter{display:flex; flex-direction:column; align-items:flex-end; gap:8px; flex:none;}
  .meter .lbl{font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:0.12em; color:var(--ink-faint); text-transform:uppercase;}
  .meter .bars{display:flex; align-items:flex-end; gap:3px; height:26px;}
  .meter .bars span{width:4px; border-radius:2px; background:var(--gold); opacity:0.35; height:4px; transition:height .09s ease, opacity .09s ease;}

  .footer{
    position:relative; z-index:2; text-align:center; padding:0 20px 20px;
    font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:0.05em; color:var(--ink-faint);
  }
  .footer kbd{
    display:inline-block; border:1px solid var(--line); border-radius:5px; padding:1.5px 6px;
    font-family:'IBM Plex Mono',monospace; font-size:10.5px; color:var(--ink-dim); margin:0 2px;
  }
  .footer .sep{margin:0 10px; opacity:0.4;}

  .permerr{
    position:relative; z-index:2; max-width:460px; margin:0 auto 18px; text-align:center;
    font-family:'Archivo',sans-serif; font-size:13.5px; color:var(--red); padding:0 20px; line-height:1.5;
  }
  .permerr a{color:var(--gold);}

  @media (max-width:640px){
    .bottom{flex-direction:column; align-items:stretch;}
    .log{max-width:100%;}
    .meter{flex-direction:row; align-items:center; justify-content:flex-end;}
  }
</style>
</head>
<body>
<div class="bgwash"></div>
<div class="scan"></div>

<div class="topbar">
  <div class="brandblock">
    <div class="brand">PROFESSOR</div>
    <div class="tag">coach de corrida com IA · ${esc(firstName)}</div>
  </div>
  <div class="topright">
    <div class="topnav">
      <a href="/assistant">Chat</a>
      <a href="/">Perfil</a>
      <a href="/logout">Sair</a>
    </div>
    <div class="statusblock">
      <span class="statuspill" id="statusPill"><span class="dot"></span><span id="statusText">Parado</span></span>
    </div>
  </div>
</div>

<div class="stage">
  <canvas id="orbCanvas" width="560" height="560"></canvas>
  <div class="activate" id="activateBlock">
    <button id="activateBtn" type="button">Ativar o Professor</button>
    <p>Pede acesso ao microfone e começa a ouvir em segundo plano. Depois é só dizer <strong>"Hey Professor"</strong> e perguntar.</p>
  </div>
</div>

<p class="caption muted" id="caption">Toque em "Ativar o Professor" pra começar.</p>
<p class="permerr" id="permErr" hidden></p>

<div class="bottom">
  <div class="log" id="log"></div>
  <div class="meter">
    <span class="lbl" id="meterLbl">áudio</span>
    <div class="bars" id="meterBars">
      <span></span><span></span><span></span><span></span><span></span>
    </div>
  </div>
</div>

<div class="footer">
  DIGA <kbd>"HEY PROFESSOR"</kbd><span class="sep">·</span><kbd>ESPAÇO</kbd> PRA FALAR AGORA<span class="sep">·</span><kbd>ESC</kbd> PARAR
</div>

<script>
(function(){
  'use strict';

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var synth = window.speechSynthesis;
  var canSpeak = !!synth;
  var canListen = !!SR;

  var canvas = document.getElementById('orbCanvas');
  var ctx = canvas.getContext('2d');
  var activateBlock = document.getElementById('activateBlock');
  var activateBtn = document.getElementById('activateBtn');
  var captionEl = document.getElementById('caption');
  var permErrEl = document.getElementById('permErr');
  var statusPill = document.getElementById('statusPill');
  var statusText = document.getElementById('statusText');
  var logEl = document.getElementById('log');
  var meterBars = document.getElementById('meterBars').querySelectorAll('span');

  // ---------- canvas sizing (devicePixelRatio aware) ----------
  var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  var cssSize = 560;
  function fitCanvas(){
    var rect = canvas.getBoundingClientRect();
    cssSize = rect.width || 560;
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  fitCanvas();
  window.addEventListener('resize', fitCanvas);

  // ---------- state machine ----------
  // standby -> ambient (listening for "hey professor") -> capturing (taking
  // the question) -> thinking (waiting on the coach's reply) -> speaking
  // (reading the reply aloud) -> back to ambient. "capturing" can also be
  // entered directly from ambient via push-to-talk (holding space), skipping
  // the wake word.
  var STATE = 'standby';
  var recognition = null;
  var recognitionPhase = null; // 'ambient' | 'capturing' — what the current recognition instance is for
  var captureText = '';
  var captureSilenceTimer = null;
  var captureHardStopTimer = null;
  var pttActive = false;
  var activeXhr = null;

  var history = []; // {role:'user'|'professor', text} — just for the on-screen log, last few only

  function normalize(s){
    return (s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').trim();
  }
  var WAKE_RE = /\\b(hey|ei|e ai|oi)?\\s*professor\\b/;

  function setStatus(label, cls){
    statusText.textContent = label;
    statusPill.className = 'statuspill' + (cls ? ' ' + cls : '');
  }
  function setCaption(text, muted){
    captionEl.textContent = text;
    captionEl.className = 'caption' + (muted ? ' muted' : '');
  }
  // ---------- shared history (same chat_messages rows as /assistant) ----------
  // The backend already treats /professor and /assistant as one conversation
  // (both hit /api/coach/send with activity_id:null, same chat_messages
  // table) — this just surfaces that on screen too, pulling the tail of the
  // existing thread into the log on load so it's visibly the same coach,
  // not a second one that forgot everything.
  function loadHistory(){
    fetch('/api/coach/history').then(function(res){
      return res.ok ? res.json() : null;
    }).then(function(data){
      var rows = (data && data.messages) || [];
      rows.slice(-6).forEach(function(m){
        if (m.role !== 'user' && m.role !== 'assistant') return;
        var clean = String(m.content || '').replace(/\\n?\\[\\[STORY_CARD\\]\\][\\s\\S]*?\\[\\[\\/STORY_CARD\\]\\]/, '').trim();
        if (clean) history.push({ role: m.role === 'assistant' ? 'professor' : 'user', text: clean });
      });
      if (history.length) {
        history = history.slice(-6);
        renderLog();
        setCaption('Continuando sua conversa com o coach — é o mesmo de sempre, só em voz.', true);
      }
    }).catch(function(){});
  }
  loadHistory();

  function pushLog(role, text){
    history.push({ role: role, text: text });
    if (history.length > 6) history.shift();
    renderLog();
  }
  function renderLog(){
    logEl.innerHTML = '';
    history.forEach(function(h, i){
      var row = document.createElement('div');
      row.className = 'row' + (i === history.length - 1 ? ' active' : '');
      var who = document.createElement('span');
      who.className = 'who' + (h.role === 'professor' ? ' prof' : '');
      who.textContent = h.role === 'professor' ? 'PROFESSOR' : 'VOCÊ';
      var txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = h.text;
      row.appendChild(who); row.appendChild(txt);
      logEl.appendChild(row);
    });
  }

  // ---------- audio-level-ish meter (no real mic amplitude from the Web
  // Speech API, so this is a believable animated approximation driven by
  // state — calmer when idle, busier while listening/speaking) ----------
  var meterPhase = 0;
  function tickMeter(){
    meterPhase += 0.18;
    var active = (STATE === 'capturing' || STATE === 'speaking');
    meterBars.forEach(function(bar, i){
      var base = active ? (0.35 + 0.55 * Math.abs(Math.sin(meterPhase * (1.3 + i * 0.37) + i))) : (0.08 + 0.05 * Math.abs(Math.sin(meterPhase * 0.4 + i)));
      bar.style.height = Math.round(4 + base * 22) + 'px';
      bar.style.opacity = active ? (0.55 + base * 0.45) : 0.3;
    });
  }

  // ---------- the orb ----------
  var t0 = performance.now();
  function noiseAt(angle, t, seed){
    return Math.sin(angle * 7 + t * 1.0 + seed) * 0.5
         + Math.sin(angle * 13 - t * 1.6 + seed * 1.7) * 0.28
         + Math.sin(angle * 3 + t * 0.6) * 0.22;
  }
  function stateTuning(){
    switch (STATE) {
      case 'capturing': return { amp: 10, speed: 2.6, glow: 34, col1: '#BFE3FF', col2: '#4E9BFF', ringAlpha: 0.9 };
      case 'thinking':  return { amp: 6,  speed: 1.6, glow: 26, col1: '#FFD98A', col2: '#FFC24E', ringAlpha: 0.75, sweep: true };
      case 'speaking':  return { amp: 13, speed: 3.4, glow: 38, col1: '#FFE3A8', col2: '#FFC24E', ringAlpha: 0.95 };
      case 'ambient':   return { amp: 4,  speed: 0.7, glow: 20, col1: '#FFD98A', col2: '#FFC24E', ringAlpha: 0.55 };
      default:          return { amp: 2,  speed: 0.35,glow: 12, col1: '#6A7078', col2: '#9BA1A8', ringAlpha: 0.3 };
    }
  }

  function draw(now){
    var t = (now - t0) / 1000;
    var size = cssSize;
    var cx = size / 2, cy = size / 2;
    var base = size * 0.30;

    ctx.clearRect(0, 0, size, size);

    // soft background glow
    var tune = stateTuning();
    var bgGrad = ctx.createRadialGradient(cx, cy, base * 0.2, cx, cy, size * 0.62);
    bgGrad.addColorStop(0, tune.col2 + '22');
    bgGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, size, size);

    // faint concentric rings (static-ish, slow rotation)
    for (var r = 1; r <= 4; r++) {
      ctx.beginPath();
      ctx.arc(cx, cy, base * (0.5 + r * 0.17), t * 0.04 * r, t * 0.04 * r + Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.05 + 0.015 * r) + ')';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // thinking sweep — a brighter arc chasing around the ring
    if (tune.sweep) {
      ctx.beginPath();
      var sweepA = t * 2.2;
      ctx.arc(cx, cy, base, sweepA, sweepA + 0.9);
      ctx.strokeStyle = tune.col1;
      ctx.lineWidth = 3;
      ctx.shadowColor = tune.col1;
      ctx.shadowBlur = tune.glow;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // main irregular glowing ring
    var pulse = 1 + 0.025 * Math.sin(t * (tune.speed * 0.8));
    var pts = 72;
    ctx.beginPath();
    for (var i = 0; i <= pts; i++) {
      var ang = (i / pts) * Math.PI * 2;
      var n = noiseAt(ang, t * tune.speed, 0);
      var rad = (base + n * tune.amp) * pulse;
      var x = cx + Math.cos(ang) * rad;
      var y = cy + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    var strokeGrad = ctx.createLinearGradient(cx - base, cy - base, cx + base, cy + base);
    strokeGrad.addColorStop(0, tune.col2);
    strokeGrad.addColorStop(0.55, tune.col1);
    strokeGrad.addColorStop(1, tune.col2);
    ctx.strokeStyle = strokeGrad;
    ctx.globalAlpha = tune.ringAlpha;
    ctx.lineWidth = 3.5;
    ctx.shadowColor = tune.col2;
    ctx.shadowBlur = tune.glow;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // inner core dot
    ctx.beginPath();
    ctx.arc(cx, cy, base * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = tune.col1;
    ctx.globalAlpha = 0.85;
    ctx.shadowColor = tune.col1;
    ctx.shadowBlur = tune.glow * 0.6;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    tickMeter();
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  // ---------- speech synthesis ----------
  var ptBrVoice = null;
  function pickVoice(){
    if (!canSpeak) return;
    var voices = synth.getVoices() || [];
    // Prefer a Google/Microsoft pt-BR voice when available — noticeably
    // less synthetic than the platform-default pt-BR voice on most setups.
    ptBrVoice =
      voices.find(function(v){ return v.lang === 'pt-BR' && /google/i.test(v.name); }) ||
      voices.find(function(v){ return v.lang === 'pt-BR' && /microsoft/i.test(v.name); }) ||
      voices.find(function(v){ return v.lang === 'pt-BR'; }) ||
      voices.find(function(v){ return /^pt/i.test(v.lang); }) ||
      null;
  }
  if (canSpeak) {
    pickVoice();
    synth.addEventListener('voiceschanged', pickVoice);
  }

  function speak(text, onDone){
    if (!canSpeak || !text) { if (onDone) onDone(); return; }
    synth.cancel();
    var utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'pt-BR';
    if (ptBrVoice) utter.voice = ptBrVoice;
    // Neither rushed nor sluggish — a flat 1.0 default reads noticeably
    // machine-like for pt-BR voices; 0.96/1.0 lands closer to a person
    // actually talking, per Felipe's brief.
    utter.rate = 0.96;
    utter.pitch = 1.0;
    utter.onend = function(){ if (onDone) onDone(); };
    utter.onerror = function(){ if (onDone) onDone(); };
    synth.speak(utter);
  }

  // ---------- backend call (same endpoint the text chat uses) ----------
  function askProfessor(question){
    setState('thinking');
    setCaption('Pensando…', true);
    pushLog('user', question);

    var full = '';
    fetch('/api/coach/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: question, activity_id: null }),
    }).then(function(res){
      if (res.status === 412) {
        throw { kind: 'no_key' };
      }
      if (!res.ok || !res.body) {
        throw { kind: 'generic' };
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      function pump(){
        return reader.read().then(function(chunk){
          if (chunk.done) return;
          full += decoder.decode(chunk.value, { stream: true });
          return pump();
        });
      }
      return pump();
    }).then(function(){
      // Strip the STORY_CARD sentinel (see server.js) — nothing to draw a
      // card on here, so just speak the human text that precedes it.
      var clean = full.replace(/\\n?\\[\\[STORY_CARD\\]\\][\\s\\S]*?\\[\\[\\/STORY_CARD\\]\\]/, '').trim();
      if (!clean) clean = 'Não consegui responder agora.';
      pushLog('professor', clean);
      setState('speaking');
      setCaption(clean, false);
      speak(clean, function(){
        if (STATE === 'speaking') startAmbient();
      });
    }).catch(function(err){
      var msg = (err && err.kind === 'no_key')
        ? 'Cadastre sua chave da API da Anthropic em Configurações pra eu poder responder.'
        : 'Não consegui responder agora. Tenta de novo?';
      pushLog('professor', msg);
      setState('speaking');
      setCaption(msg, false);
      speak(msg, function(){
        if (STATE === 'speaking') startAmbient();
      });
    });
  }

  // ---------- recognition lifecycle ----------
  // Chrome allows only ONE active SpeechRecognition session per tab —
  // calling .start() on a new instance before the previous one has actually
  // finished shutting down throws (silently, into the catch below) and
  // leaves the mic dead with no further error, which was the root cause of
  // "não consegui conversar com o professor": every ambient→capturing and
  // capturing→ambient transition used to stop() the old instance and
  // start() a new one in the same tick, racing the async shutdown. Every
  // transition now waits for the outgoing instance's real 'end' event (with
  // a short timeout as a safety net for the rare case it never fires)
  // before starting the next one.
  function stopRecognition(done){
    clearTimeout(captureSilenceTimer);
    clearTimeout(captureHardStopTimer);
    if (!recognition) { if (done) done(); return; }
    var r = recognition;
    recognition = null;
    recognitionPhase = null;
    var called = false;
    var finish = function(){
      if (called) return;
      called = true;
      if (done) done();
    };
    r.onresult = null;
    r.onerror = null;
    r.onend = finish;
    try { r.stop(); } catch (e) { finish(); }
    setTimeout(finish, 250);
  }

  // ---------- recognition: ambient (wake word) ----------
  function startAmbient(){
    if (!canListen) return;
    stopRecognition(function(){
      setState('ambient');
      setCaption('Diga "Hey Professor" quando quiser perguntar algo.', true);

      recognition = new SR();
      recognition.lang = 'pt-BR';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognitionPhase = 'ambient';

      recognition.onresult = function(event){
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var transcript = normalize(event.results[i][0].transcript);
          if (WAKE_RE.test(transcript)) {
            var after = transcript.replace(WAKE_RE, '').trim();
            beginCapture(after);
            return;
          }
        }
      };
      recognition.onerror = function(event){
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          showPermError();
        }
        // 'no-speech' and transient network blips are routine for a
        // continuously-listening recognizer — just let onend restart it.
      };
      recognition.onend = function(){
        if (recognitionPhase === 'ambient' && STATE === 'ambient') {
          // Chrome stops continuous recognition on its own after a while —
          // restart it transparently so "always listening" actually holds.
          // This instance has genuinely already ended, so going straight to
          // startAmbient() here (not through stopRecognition) is safe.
          recognition = null;
          recognitionPhase = null;
          startAmbient();
        }
      };
      try { recognition.start(); } catch (e) { showPermError(); }
    });
  }

  // ---------- recognition: capturing the actual question ----------
  function beginCapture(prefill){
    stopRecognition(function(){
      setState('capturing');
      captureText = prefill || '';
      setCaption(captureText ? captureText : 'Pode falar…', !captureText);

      recognition = new SR();
      recognition.lang = 'pt-BR';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognitionPhase = 'capturing';

      recognition.onresult = function(event){
        var interim = '', finals = '';
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var piece = event.results[i][0].transcript;
          if (event.results[i].isFinal) finals += piece + ' '; else interim += piece;
        }
        if (finals) captureText = (captureText + ' ' + finals).trim();
        setCaption((captureText + ' ' + interim).trim() || 'Pode falar…', !(captureText || interim));
        armSilenceTimer();
      };
      recognition.onerror = function(event){
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          showPermError();
        }
      };
      recognition.onend = function(){
        if (recognitionPhase === 'capturing' && STATE === 'capturing') {
          recognitionPhase = null;
          finishCapture();
        }
      };
      try { recognition.start(); } catch (e) { showPermError(); }

      armSilenceTimer();
      clearTimeout(captureHardStopTimer);
      captureHardStopTimer = setTimeout(finishCapture, 20000); // hard cap so a stuck mic never listens forever
    });
  }

  function armSilenceTimer(){
    clearTimeout(captureSilenceTimer);
    captureSilenceTimer = setTimeout(finishCapture, 1500);
  }

  function finishCapture(){
    if (STATE !== 'capturing') return;
    clearTimeout(captureSilenceTimer);
    clearTimeout(captureHardStopTimer);
    var q = captureText.trim();
    captureText = '';
    stopRecognition(function(){
      if (!q) { startAmbient(); return; }
      askProfessor(q);
    });
  }

  function setState(next){
    STATE = next;
    if (next === 'ambient') setStatus('Ouvindo em segundo plano', 'on');
    else if (next === 'capturing') setStatus('Ouvindo você', 'listening');
    else if (next === 'thinking') setStatus('Pensando', 'on');
    else if (next === 'speaking') setStatus('Falando', 'speaking');
    else setStatus('Parado', '');
  }

  function showPermError(){
    stopAll();
    permErrEl.hidden = false;
    permErrEl.textContent = 'Preciso de acesso ao microfone pra te ouvir. Libere o microfone pra este site nas permissões do navegador e toque em "Ativar o Professor" de novo.';
    activateBlock.style.display = 'flex';
    setCaption('Microfone bloqueado.', true);
  }

  function stopAll(){
    stopRecognition();
    if (canSpeak) synth.cancel();
    setState('standby');
    setCaption('Toque em "Ativar o Professor" pra começar.', true);
    activateBlock.style.display = 'flex';
  }

  // ---------- activation ----------
  activateBtn.addEventListener('click', function(){
    permErrEl.hidden = true;
    if (!canListen) {
      setCaption('Esse navegador não tem reconhecimento de voz (funciona no Chrome). Você ainda pode acompanhar o Coach IA por texto em /assistant.', true);
      return;
    }
    activateBlock.style.display = 'none';
    // speechSynthesis.getVoices() can come back empty until this event —
    // a quick re-pick right as the person interacts keeps the voice choice
    // fresh for the very first reply instead of falling back silently.
    pickVoice();
    startAmbient();
  });

  // ---------- push-to-talk fallback (space) + stop (esc) ----------
  window.addEventListener('keydown', function(e){
    if (e.code === 'Space' && !e.repeat && (STATE === 'ambient' || STATE === 'standby')) {
      e.preventDefault();
      if (STATE === 'standby') { activateBtn.click(); return; }
      pttActive = true;
      beginCapture('');
    } else if (e.code === 'Escape') {
      stopAll();
    }
  });
  window.addEventListener('keyup', function(e){
    if (e.code === 'Space' && pttActive) {
      pttActive = false;
      if (STATE === 'capturing') finishCapture();
    }
  });

  // Clicking the orb itself is the same push-to-talk trigger, for touch
  // devices without a spacebar.
  canvas.addEventListener('click', function(){
    if (STATE === 'standby') { activateBtn.click(); return; }
    if (STATE === 'ambient') beginCapture('');
    else if (STATE === 'capturing') finishCapture();
  });

  window.addEventListener('beforeunload', function(){ stopAll(); });
})();
</script>
</body>
</html>`;
}

module.exports = { professorPage };
