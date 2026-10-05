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
function professorPage(user, opts) {
  opts = opts || {};
  const voiceEnabled = opts.voiceEnabled !== false; // default true so an unexpected missing flag never blocks the page
  const firstName = (user.name || '').split(' ')[0] || 'atleta';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Professor · Runiqx</title>
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

  /* Quick-start chips — pre-written questions an athlete can tap instead of
     thinking of what to ask or waiting to say "Hey Professor". Shown
     whenever there's no live call (standby, or ambient between calls);
     hidden once connecting/listening/speaking so they don't clutter the
     screen mid-conversation. Tapping one starts a call with that text as
     the first turn — the exact same prefill path "Hey Professor, <question>"
     already uses, see startLiveCall(prefill). */
  .quickchips{
    position:relative; z-index:2; display:flex; flex-wrap:wrap; align-items:center; justify-content:center;
    gap:8px; max-width:640px; margin:0 auto 16px; padding:0 20px;
  }
  .quickchips button{
    font-family:'IBM Plex Mono',monospace; font-weight:600; font-size:11.5px; letter-spacing:0.05em;
    color:var(--ink-dim); background:rgba(255,255,255,0.04); border:1px solid var(--line);
    border-radius:999px; padding:9px 16px; cursor:pointer; white-space:nowrap;
    transition:background .15s ease, color .15s ease, border-color .15s ease, transform .1s ease;
  }
  .quickchips button:hover{background:rgba(255,194,78,0.1); border-color:rgba(255,194,78,0.4); color:var(--ink);}
  .quickchips button:active{transform:scale(.96);}

  @media (max-width:640px){
    .quickchips{gap:7px;}
    .quickchips button{font-size:11px; padding:8px 13px;}
  }

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
    <button id="activateBtn" type="button">Falar com o Professor</button>
    <p>Toque pra começar a conversa na hora — pede acesso ao microfone e já liga a chamada. Depois, é só continuar falando, ou diga <strong>"Hey Professor"</strong> a qualquer momento pra começar de novo sem tocar na tela.${voiceEnabled ? '' : ' Cadastre sua chave da API da OpenAI em <a href="/settings" style="color:var(--gold);">Configurações</a> antes de ativar.'}</p>
  </div>
</div>

<p class="caption muted" id="caption">Toque no orbe pra falar com o Professor.</p>
<p class="permerr" id="permErr" hidden></p>

<div class="quickchips" id="quickChips">
  <button type="button" data-q="Qual é meu treino de hoje?">Treino de hoje</button>
  <button type="button" data-q="Analise meu último treino.">Analisar último treino</button>
  <button type="button" data-q="Estou com dores. Pode me ajudar?">Estou com dores</button>
  <button type="button" data-q="Como estou evoluindo nos últimos treinos?">Como estou evoluindo</button>
  <button type="button" data-q="Me dá uma dica pra minha próxima prova.">Dica pra prova</button>
</div>

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
  TOQUE NO ORBE PRA FALAR<span class="sep">·</span>DIGA <kbd>"HEY PROFESSOR"</kbd> TAMBÉM FUNCIONA<span class="sep">·</span><kbd>ESC</kbd> ENCERRA
</div>

<script>
(function(){
  'use strict';

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var canListen = !!SR;
  var canCall = !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  var VOICE_ENABLED = ${voiceEnabled ? 'true' : 'false'};

  var canvas = document.getElementById('orbCanvas');
  var ctx = canvas.getContext('2d');
  var activateBlock = document.getElementById('activateBlock');
  var activateBtn = document.getElementById('activateBtn');
  var quickChips = document.getElementById('quickChips');
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
  // standby -> ambient (free, local wake-word listening for "hey professor",
  // via the Web Speech API) -> connecting (minting an OpenAI Realtime
  // session + opening the WebRTC call) -> listening/speaking (the live
  // call itself — OpenAI's own server-side turn detection flips between
  // these two, no wake word needed once the call is open) -> back to
  // ambient when the call ends. "Hey Professor" (or Space) is only needed
  // to START a call from idle, per Felipe's original spec — once live, the
  // conversation flows like a real phone call, including real barge-in.
  var STATE = 'standby';
  var recognition = null;
  var recognitionPhase = null; // 'ambient' — what the current recognition instance is for (only ambient uses it now)

  var history = []; // {role:'user'|'professor', text} — just for the on-screen log, last few only

  // ---------- the live call (OpenAI Realtime API over WebRTC) ----------
  // Bumped on every teardown/start so a stray async step from a call the
  // athlete already hung up (or that got superseded by a new one) can't
  // resurrect state or speak over whatever's happening now.
  var liveGeneration = 0;
  var pc = null;              // RTCPeerConnection to OpenAI
  var micStream = null;       // local mic MediaStream, torn down when the call ends
  var dataChannel = null;     // 'oai-events' — session/transcript events, text in
  var remoteAudioEl = null;   // plays the Professor's actual voice (the WebRTC audio track)
  // Feeds the orb's "listening" animation with the athlete's REAL mic
  // volume (via Web Audio's AnalyserNode) instead of a canned loop, so the
  // blue state actually moves with his voice — Felipe asked for it to look
  // "mais tecnológica, mexe-se mais... como se fosse um robô".
  var micAudioCtx = null;
  var micAnalyser = null;
  var micAnalyserBuf = null;
  var micLevel = 0;           // smoothed 0..1, updated once per animation frame
  var assistantTranscriptBuf = ''; // the CURRENT reply's transcript, as it streams in
  var inactivityTimer = null; // auto-hangs-up a call nobody's talking in
  var hardCapTimer = null;    // absolute ceiling on one call's length

  // ---------- screen wake lock ----------
  // Chrome suspends speechSynthesis (and recognition) on a tab that's gone
  // hidden — screen locked, phone put in a pocket/armband, another app
  // brought to front. That shows up as exactly what Felipe described:
  // replies that are slow to start or never produce any audio at all.
  // Holding a screen wake lock while the Professor is active keeps the
  // screen (and tab) from sleeping mid-run. Re-acquire on visibilitychange
  // since the OS releases the lock whenever the tab does go hidden, and on
  // a phone the person may unlock the screen again and expect it back.
  var wakeLock = null;
  function requestWakeLock(){
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function(lock){
      wakeLock = lock;
    }).catch(function(){ /* not fatal — e.g. low battery mode can refuse this */ });
  }
  function releaseWakeLock(){
    if (wakeLock) { wakeLock.release().catch(function(){}); wakeLock = null; }
  }
  document.addEventListener('visibilitychange', function(){
    if (document.visibilityState === 'visible' && STATE !== 'standby') requestWakeLock();
  });

  // Strips the server's STORY_CARD sentinel the same way the text chat does
  // (views.js splitStoryCard): everything from the FIRST "[[STORY_CARD]]"
  // onward is dropped, not just the first replace()'d occurrence — a single
  // reply can end up carrying the sentinel twice back-to-back (seen live:
  // asking the Professor to resend a workout image produced one assistant
  // row with two "[[STORY_CARD]]...[[/STORY_CARD]]" blocks concatenated),
  // and a plain non-global .replace() only ate the first one, leaving raw
  // JSON visible in the on-screen log and read out loud by speechSynthesis.
  // There's no canvas here to draw the card on anyway, so slicing to the
  // first sentinel and discarding the rest is exactly right.
  var STORY_RE = /\\n?\\[\\[STORY_CARD\\]\\]/;
  function stripStoryCard(text){
    var s = String(text || '');
    var m = STORY_RE.exec(s);
    return (m ? s.slice(0, m.index) : s).trim();
  }

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
        var clean = stripStoryCard(m.content);
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
    var active = (STATE === 'listening' || STATE === 'speaking');
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
      case 'listening':  return { amp: 17, speed: 3.8, glow: 40, col1: '#BFE3FF', col2: '#4E9BFF', ringAlpha: 0.92 };
      case 'connecting': return { amp: 6,  speed: 1.6, glow: 26, col1: '#FFD98A', col2: '#FFC24E', ringAlpha: 0.75, sweep: true };
      case 'speaking':   return { amp: 13, speed: 3.4, glow: 38, col1: '#FFE3A8', col2: '#FFC24E', ringAlpha: 0.95 };
      case 'ambient':    return { amp: 4,  speed: 0.7, glow: 20, col1: '#FFD98A', col2: '#FFC24E', ringAlpha: 0.55 };
      default:           return { amp: 2,  speed: 0.35,glow: 12, col1: '#6A7078', col2: '#9BA1A8', ringAlpha: 0.3 };
    }
  }

  // Reads the athlete's actual mic volume off the live AnalyserNode (RMS of
  // the raw waveform) and smooths it into micLevel (0..1). No analyser yet
  // (not in a call, or browser without AudioContext) just relaxes micLevel
  // back to 0 instead of leaving it stuck.
  function sampleMicLevel(){
    if (!micAnalyser || !micAnalyserBuf) { micLevel += (0 - micLevel) * 0.2; return; }
    micAnalyser.getByteTimeDomainData(micAnalyserBuf);
    var sum = 0;
    for (var i = 0; i < micAnalyserBuf.length; i++) {
      var v = (micAnalyserBuf[i] - 128) / 128;
      sum += v * v;
    }
    var rms = Math.sqrt(sum / micAnalyserBuf.length);
    var target = Math.min(1, rms * 5.5);
    micLevel += (target - micLevel) * 0.35;
  }

  function draw(now){
    var t = (now - t0) / 1000;
    var size = cssSize;
    var cx = size / 2, cy = size / 2;
    var base = size * 0.30;

    ctx.clearRect(0, 0, size, size);

    sampleMicLevel();

    // soft background glow
    var tune = stateTuning();
    if (STATE === 'listening') {
      // real voice, not a canned loop: louder into the mic = the SAME
      // circle gets bigger, wobblier and faster, right as it happens —
      // nothing new drawn, just more movement on the one ring
      tune.amp += micLevel * 34;
      tune.speed += micLevel * 2.6;
      tune.glow += micLevel * 20;
      tune.ringAlpha = Math.min(1, tune.ringAlpha + micLevel * 0.08);
    }
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

  // ---------- the live call itself (OpenAI Realtime API, WebRTC) ----------
  // No more Anthropic text stream + browser TTS pipeline for the live
  // conversation — this opens a direct audio connection to OpenAI, so the
  // Professor's voice and ears are the SAME connection: what Felipe hears
  // is the model's own real-time voice, not a transcript read aloud by the
  // browser a beat later. Our server's only part in a live call is minting
  // the short-lived session token (/api/professor/realtime-session); the
  // actual audio never touches our server.

  function clearLiveTimers(){
    clearTimeout(inactivityTimer);
    clearTimeout(hardCapTimer);
    inactivityTimer = null;
    hardCapTimer = null;
  }
  // If nobody's said anything (either direction) for a while, hang up
  // rather than silently holding a live, billed call open — easy to forget
  // the Professor is still "on the line" mid-run.
  function armInactivityTimer(){
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(function(){
      endLiveCall('Chamada encerrada por inatividade. Diga "Hey Professor" pra continuar.');
    }, 55000);
  }
  // A hard ceiling so a stuck connection (or a genuinely very long
  // conversation) can't run away indefinitely.
  function armHardCap(){
    clearTimeout(hardCapTimer);
    hardCapTimer = setTimeout(function(){
      endLiveCall('Já faz um tempo — vou encerrar por aqui. Diga "Hey Professor" pra continuar.');
    }, 15 * 60 * 1000);
  }

  function teardownConnection(){
    if (dataChannel) { try { dataChannel.close(); } catch (e) {} dataChannel = null; }
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    if (micStream) { micStream.getTracks().forEach(function(t){ try { t.stop(); } catch (e) {} }); micStream = null; }
    if (remoteAudioEl) { try { remoteAudioEl.pause(); } catch (e) {} if (remoteAudioEl.parentNode) remoteAudioEl.parentNode.removeChild(remoteAudioEl); remoteAudioEl = null; }
    if (micAudioCtx) { try { micAudioCtx.close(); } catch (e) {} micAudioCtx = null; }
    micAnalyser = null; micAnalyserBuf = null; micLevel = 0;
    clearLiveTimers();
  }

  // Ends whatever's happening (connecting OR a live call) and drops back to
  // free wake-word listening — never all the way to standby, so saying "Hey
  // Professor" again immediately works, the same as it would mid-run.
  function endLiveCall(message){
    liveGeneration++; // invalidate any in-flight connect/event handling
    teardownConnection();
    if (message) { pushLog('professor', message); setCaption(message, true); }
    startAmbient();
  }

  // Sends whatever the athlete said in the same breath as the wake word
  // ("Hey Professor, qual é meu treino de hoje") as the call's first turn,
  // instead of silently discarding it and making them repeat themselves.
  function sendUserTextTurn(text){
    if (!dataChannel || dataChannel.readyState !== 'open') return;
    pushLog('user', text);
    dataChannel.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: text }] },
    }));
    dataChannel.send(JSON.stringify({ type: 'response.create' }));
  }

  // Server-side events arriving on the data channel — this is what drives
  // the orb between "listening" and "speaking" and fills in the on-screen
  // caption/log, now that OpenAI (not our own silence-timer heuristics)
  // owns turn-taking.
  function handleRealtimeEvent(myGen, raw){
    if (myGen !== liveGeneration) return; // a superseded call's events — ignore
    var evt;
    try { evt = JSON.parse(raw); } catch (e) { return; }
    switch (evt.type) {
      case 'input_audio_buffer.speech_started':
        clearTimeout(inactivityTimer);
        setState('listening');
        setCaption('Ouvindo…', true);
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (evt.transcript && evt.transcript.trim()) pushLog('user', evt.transcript.trim());
        break;
      case 'response.created':
        assistantTranscriptBuf = '';
        setState('speaking');
        break;
      case 'response.output_audio_transcript.delta':
        if (evt.delta) { assistantTranscriptBuf += evt.delta; setCaption(assistantTranscriptBuf, false); }
        break;
      case 'response.output_audio_transcript.done':
        if (evt.transcript && evt.transcript.trim()) pushLog('professor', evt.transcript.trim());
        break;
      case 'response.done':
        setState('listening');
        setCaption('Pode continuar falando…', true);
        armInactivityTimer();
        break;
      case 'error':
        console.error('Professor (realtime):', evt);
        break;
      default:
        break; // lots of other housekeeping events we don't need for the UI
    }
  }

  // Starts a live call: mint a session token from our own server, grab the
  // mic, open a WebRTC connection straight to OpenAI (offer/answer, same
  // five-step dance from their own docs — no SDK, this codebase avoids npm
  // dependencies entirely and WebRTC is a browser built-in), and (if the
  // athlete said something right after the wake word) feed that in as the
  // call's first turn.
  //
  // Every resource this creates (mic stream, RTCPeerConnection, data
  // channel, audio element) lives in a LOCAL variable until the call is
  // fully connected — only then does it get published to the module-level
  // pc/micStream/dataChannel/remoteAudioEl that teardownConnection() and the
  // rest of the UI use. That's deliberate: if the athlete hits Escape (or a
  // newer call supersedes this one) WHILE this is still connecting, cleaning
  // up must only ever touch THIS attempt's own resources — touching the
  // shared globals here could otherwise tear down (or orphan) a different,
  // newer call that's already live.
  function startLiveCall(prefill){
    // Known upfront (server-rendered flag) — skip the round trip and the
    // mic prompt entirely rather than connecting just to fail on the key
    // check a moment later.
    if (!VOICE_ENABLED) {
      var msg = 'Cadastre sua chave da API da OpenAI em Configurações pra eu poder conversar por voz.';
      pushLog('professor', msg);
      setCaption(msg, true);
      return;
    }
    stopRecognition(function(){
      var myGen = ++liveGeneration;
      setState('connecting');
      setCaption('Conectando…', true);
      permErrEl.hidden = true;

      var localMicStream = null, localPc = null, localDataChannel = null, localAudioEl = null;
      var localMicAudioCtx = null, localMicAnalyser = null, localMicAnalyserBuf = null;
      function cleanupLocal(){
        if (localDataChannel) { try { localDataChannel.close(); } catch (e) {} }
        if (localPc) { try { localPc.close(); } catch (e) {} }
        if (localMicStream) { localMicStream.getTracks().forEach(function(t){ try { t.stop(); } catch (e) {} }); }
        if (localAudioEl) { try { localAudioEl.pause(); } catch (e) {} if (localAudioEl.parentNode) localAudioEl.parentNode.removeChild(localAudioEl); }
        if (localMicAudioCtx) { try { localMicAudioCtx.close(); } catch (e) {} }
      }

      fetch('/api/professor/realtime-session', { method: 'POST' }).then(function(res){
        if (myGen !== liveGeneration) throw { kind: 'stale' };
        if (res.status === 412) throw { kind: 'no_key' };
        if (!res.ok) throw { kind: 'generic' };
        return res.json();
      }).then(function(session){
        if (myGen !== liveGeneration) throw { kind: 'stale' };
        var ephemeralKey = session && session.value;
        if (!ephemeralKey) throw { kind: 'generic' };
        return navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream){
          if (myGen !== liveGeneration) { stream.getTracks().forEach(function(t){ t.stop(); }); throw { kind: 'stale' }; }
          localMicStream = stream;

          // Taps the raw mic signal with a Web Audio AnalyserNode so the
          // orb can react to the athlete's ACTUAL voice level while he's
          // talking, instead of a canned animation. Purely local/visual —
          // never sent anywhere; if AudioContext isn't available the orb
          // just falls back to its normal animation (sampleMicLevel()
          // relaxes micLevel to 0 when there's no analyser).
          try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (AC) {
              localMicAudioCtx = new AC();
              var micSrc = localMicAudioCtx.createMediaStreamSource(localMicStream);
              localMicAnalyser = localMicAudioCtx.createAnalyser();
              localMicAnalyser.fftSize = 256;
              localMicAnalyser.smoothingTimeConstant = 0.55;
              micSrc.connect(localMicAnalyser);
              localMicAnalyserBuf = new Uint8Array(localMicAnalyser.frequencyBinCount);
            }
          } catch (e) { localMicAudioCtx = null; localMicAnalyser = null; localMicAnalyserBuf = null; }

          localPc = new RTCPeerConnection();
          localAudioEl = document.createElement('audio');
          localAudioEl.autoplay = true;
          localAudioEl.style.display = 'none';
          document.body.appendChild(localAudioEl);
          localPc.ontrack = function(e){ localAudioEl.srcObject = e.streams[0]; localAudioEl.play().catch(function(){}); };
          localMicStream.getTracks().forEach(function(track){ localPc.addTrack(track, localMicStream); });
          localDataChannel = localPc.createDataChannel('oai-events');
          localDataChannel.addEventListener('message', function(e){ handleRealtimeEvent(myGen, e.data); });

          return localPc.createOffer().then(function(offer){
            return localPc.setLocalDescription(offer);
          }).then(function(){
            return fetch('https://api.openai.com/v1/realtime/calls', {
              method: 'POST',
              body: localPc.localDescription.sdp,
              headers: { authorization: 'Bearer ' + ephemeralKey, 'content-type': 'application/sdp' },
            });
          }).then(function(res){
            if (!res.ok) throw { kind: 'generic' };
            return res.text();
          }).then(function(answerSdp){
            if (myGen !== liveGeneration) throw { kind: 'stale' };
            return localPc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
          });
        });
      }).then(function(){
        if (myGen !== liveGeneration) { cleanupLocal(); return; }
        // Connected — this attempt is now THE live call; publish its
        // resources to the shared globals so teardownConnection()/
        // endLiveCall() know what to close later.
        pc = localPc; micStream = localMicStream; dataChannel = localDataChannel; remoteAudioEl = localAudioEl;
        micAudioCtx = localMicAudioCtx; micAnalyser = localMicAnalyser; micAnalyserBuf = localMicAnalyserBuf;
        setState('listening');
        setCaption(prefill ? prefill : 'Pode falar, estou ouvindo.', !prefill);
        requestWakeLock();
        armInactivityTimer();
        armHardCap();
        if (prefill) sendUserTextTurn(prefill);
      }).catch(function(err){
        cleanupLocal(); // always ours to clean up, whatever went wrong or whoever's current now
        if (myGen !== liveGeneration) return; // superseded — nothing to show, the newer call owns the UI now
        if (err && err.kind === 'stale') return;
        var msg;
        if (err && err.kind === 'no_key') {
          msg = 'Cadastre sua chave da API da OpenAI em Configurações pra eu poder conversar por voz.';
        } else if (err && err.name === 'NotAllowedError') {
          showPermError();
          return;
        } else {
          msg = 'Não consegui conectar agora. Tenta de novo?';
        }
        pushLog('professor', msg);
        setCaption(msg, true);
        startAmbient();
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
  // This is the "ready, tap the orb or say the wake word" resting state
  // between calls. It always sets STATE to 'ambient' — even when canListen
  // is false — so the orb stays tappable to start the next call; only the
  // actual background SpeechRecognition (the hands-free part) is skipped
  // when unsupported. Without this, a browser lacking SpeechRecognition
  // would leave STATE stuck on whatever the live call left it at
  // ('listening'/'speaking') after endLiveCall(), and tapping the orb would
  // just keep trying to hang up a call that's already over instead of
  // starting a new one.
  function startAmbient(){
    stopRecognition(function(){
      setState('ambient');
      setCaption(canListen ? 'Diga "Hey Professor" quando quiser perguntar algo — ou toque no orbe.' : 'Toque no orbe quando quiser falar com o Professor.', true);
      if (!canListen) return;

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
            startLiveCall(after);
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

  function setState(next){
    STATE = next;
    if (next === 'ambient') setStatus(canListen ? 'Ouvindo em segundo plano' : 'Pronto', 'on');
    else if (next === 'connecting') setStatus('Conectando', 'on');
    else if (next === 'listening') setStatus('Ouvindo você', 'listening');
    else if (next === 'speaking') setStatus('Falando', 'speaking');
    else setStatus('Parado', '');
    // Quick-start chips only make sense when there's no call in progress —
    // standby (before the first call) and ambient (between calls, waiting
    // for the next one) are both "ready" moments; hide them the instant a
    // call starts connecting so they don't sit uselessly under the orb
    // while the athlete is actually talking.
    quickChips.style.display = (next === 'standby' || next === 'ambient') ? 'flex' : 'none';
  }

  function showPermError(){
    stopAll();
    permErrEl.hidden = false;
    permErrEl.textContent = 'Preciso de acesso ao microfone pra te ouvir. Libere o microfone pra este site nas permissões do navegador e toque em "Falar com o Professor" de novo.';
    activateBlock.style.display = 'flex';
    setCaption('Microfone bloqueado.', true);
  }

  function stopAll(){
    stopRecognition();
    liveGeneration++;
    teardownConnection();
    setState('standby');
    setCaption('Toque no orbe pra falar com o Professor.', true);
    activateBlock.style.display = 'flex';
    releaseWakeLock();
  }

  // ---------- activation ----------
  // One tap = talking, immediately — the old flow needed a tap to arm
  // background wake-word listening, then EITHER a second tap on the orb or
  // saying "Hey Professor" to actually open a call. Felipe flagged that as
  // not practical for an athlete who just wants to ask something: now the
  // button itself opens the call directly (same mic-permission prompt,
  // same startLiveCall() used everywhere else). "Hey Professor" still works
  // as a hands-free way to start the NEXT call once this one ends (see
  // startAmbient below) — it's just no longer the only way in.
  //
  // canListen (SpeechRecognition, for the wake word) is NOT required here —
  // only canCall (WebRTC + mic) is a hard requirement for the live call
  // itself. A browser without SpeechRecognition (e.g. some Safari builds)
  // can still have a full voice conversation by tapping; it only loses the
  // hands-free "Hey Professor" shortcut between calls, not the feature.
  function beginCall(prefill){
    permErrEl.hidden = true;
    if (!canCall) {
      setCaption('Esse navegador não suporta chamada de voz (funciona no Chrome ou Safari recentes). Você ainda pode falar com o Professor por texto em /assistant.', true);
      return;
    }
    activateBlock.style.display = 'none';
    requestWakeLock();
    startLiveCall(prefill || '');
  }
  activateBtn.addEventListener('click', function(){ beginCall(''); });

  // Quick-start chips (Treino de hoje / Estou com dores / etc.) — tapping
  // one is just beginCall() with that question as the prefill, the same
  // path "Hey Professor, <pergunta>" already sends as the call's first
  // turn (see sendUserTextTurn/startLiveCall). Works identically whether
  // this is the very first call (STATE standby) or a follow-up between
  // calls (STATE ambient).
  quickChips.querySelectorAll('button[data-q]').forEach(function(btn){
    btn.addEventListener('click', function(){ beginCall(btn.getAttribute('data-q')); });
  });

  // ---------- manual start (space) + hang up / stop (esc) ----------
  // Space is a manual alternative to saying "Hey Professor" (useful if the
  // wake word isn't being heard well, e.g. headphones), not a push-to-talk
  // button anymore — once a call is live, OpenAI's own turn detection
  // handles the back-and-forth (including real barge-in) on its own.
  window.addEventListener('keydown', function(e){
    if (e.code === 'Space' && !e.repeat && (STATE === 'ambient' || STATE === 'standby')) {
      e.preventDefault();
      if (STATE === 'standby') { activateBtn.click(); return; }
      startLiveCall('');
    } else if (e.code === 'Escape') {
      if (STATE === 'listening' || STATE === 'speaking' || STATE === 'connecting') {
        endLiveCall('Chamada encerrada.');
      } else {
        stopAll();
      }
    }
  });

  // Clicking the orb starts a call from ambient (same as Space), or hangs
  // up a live one — the one gesture that works on touch devices either way.
  canvas.addEventListener('click', function(){
    if (STATE === 'standby') { activateBtn.click(); return; }
    if (STATE === 'ambient') startLiveCall('');
    else if (STATE === 'listening' || STATE === 'speaking' || STATE === 'connecting') endLiveCall('Chamada encerrada.');
  });

  window.addEventListener('beforeunload', function(){ stopAll(); });
})();
</script>
</body>
</html>`;
}

module.exports = { professorPage };
