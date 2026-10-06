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

  /* Felipe: this part was ugly because the button and its paragraph sat
     position:absolute with NO offsets, which falls back to dead center on
     top of the orb canvas — the ring's curve and its center dot cut
     straight through the text. Two things had to be true at once to fix it
     for good: the text can never sit on top of the ring (so it has to live
     below the canvas, in normal flow, not centered over it), and the orb
     can never be so tall that stacking it with the text, the caption, the
     quick-start chips and the log overflows a short screen (that overflow
     was the regression from the first attempt at this fix). The second
     part is why #orbCanvas's size is capped by vh here, not just vmin —
     vmin alone only reacts to the viewport's SHORTER side, so on a wide
     short window (or just a browser with a shrunk window) it stayed large
     enough to push everything below it off-screen regardless. Capping it
     against the vertical space actually left in .stage (roughly: viewport
     height minus topbar, caption, chips, log and footer) means the orb
     itself shrinks first, before anything below it ever has to overlap. */
  .stage{
    position:relative; z-index:1; flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:12px; min-height:0; padding:12px;
  }
  #orbCanvas{display:block; width:min(78vmin, 560px, 32vh); height:min(78vmin, 560px, 32vh); max-width:88vw; max-height:88vw;}

  .activate{
    position:relative; z-index:3; display:flex; flex-direction:column; align-items:center; gap:10px; flex:none;
  }
  .activate button{
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
  /* A phone turned sideways (or any window under ~480px tall) is the one
     case the vh-capped orb above can't fully solve on its own — there just
     isn't 480px+ of room for topbar + orb + button + this paragraph +
     caption + quick-start chips + footer at once. Rather than let any of
     that wrap into its neighbor again, free up room in two ways: drop the
     paragraph (the button label and the short caption line below it
     already say the same thing) and hide the quick-start chips (a
     convenience — tapping a pre-written question — not the only way in;
     the button and "Hey Professor" both still work). The #orbCanvas.js
     sizing logic (search fitCanvas) backstops whatever's still too tight
     after this by measuring the real leftover space and shrinking the
     orb itself, down to a floor that keeps it recognizable as a ring. */
  @media (max-height:480px){
    .activate p{display:none;}
    #orbCanvas{width:min(78vmin, 560px, 22vh); height:min(78vmin, 560px, 22vh);}
    .stage{gap:6px;}
    .caption{min-height:0; margin:4px auto;}
    .quickchips{display:none !important;}
    .footer{padding:0 20px 8px;}
    .bottom{padding:0 26px 8px;}
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
    gap:8px; max-width:640px; margin:0 auto 16px; padding:0 20px; order:1;
  }
  .quickchips button{
    font-family:'IBM Plex Mono',monospace; font-weight:600; font-size:11.5px; letter-spacing:0.05em;
    color:var(--ink-dim); background:rgba(255,255,255,0.04); border:1px solid var(--line);
    border-radius:999px; padding:9px 16px; cursor:pointer; white-space:nowrap;
    transition:background .15s ease, color .15s ease, border-color .15s ease, transform .1s ease;
  }
  .quickchips button:hover{background:rgba(255,194,78,0.1); border-color:rgba(255,194,78,0.4); color:var(--ink);}
  .quickchips button:active{transform:scale(.96);}
  .quickchips button.feat{color:var(--gold); border-color:rgba(255,194,78,0.45); background:rgba(255,194,78,0.08);}

  @media (max-width:640px){
    .quickchips{gap:7px;}
    .quickchips button{font-size:11px; padding:8px 13px;}
  }

  /* Explicit "Encerrar" button — the orb itself always hangs up a live call
     on tap (see canvas click handler), but that's the same gesture as
     STARTING one and easy to miss, especially mid-run on a phone where
     there's no Esc key. This is a second, unambiguous way to hang up,
     shown only while there's actually a call to end. */
  .hangupWrap{
    position:relative; z-index:2; display:none; justify-content:center;
    margin:0 auto 16px; padding:0 20px; order:1;
  }
  .hangupWrap button{
    font-family:'IBM Plex Mono',monospace; font-weight:700; font-size:12.5px; letter-spacing:0.12em;
    text-transform:uppercase; color:var(--red); background:rgba(255,107,107,0.08);
    border:1px solid rgba(255,107,107,0.4); border-radius:999px; padding:11px 28px; cursor:pointer;
    transition:background .15s ease, transform .1s ease;
  }
  .hangupWrap button:hover{background:rgba(255,107,107,0.18);}
  .hangupWrap button:active{transform:scale(.96);}

  /* Back-to-menu button — a plain text link in the topnav (Perfil) already
     gets there, but Felipe asked for an explicit, unambiguous way back, so
     this sits up front at top-left where a "back" control is expected. */
  .topleft{display:flex; align-items:center; gap:14px;}
  .backbtn{
    display:flex; align-items:center; justify-content:center; width:34px; height:34px;
    border:1px solid var(--line); border-radius:999px; color:var(--ink-dim); text-decoration:none;
    font-size:17px; line-height:1; flex:none; transition:background .15s ease, color .15s ease;
  }
  .backbtn:hover{background:rgba(255,255,255,0.06); color:var(--ink);}

  /* Felipe didn't want the conversation text to "live" in two different
     places on screen (the caption flashes it as it's said, then the
     finished line would separately show up down here) — now this IS the
     one place it lives, so it needs to sit right under the caption, always
     in view, not wherever it happened to fall in document order. body is a
     column flexbox, so the order property moves it there without touching
     the HTML: by default every section below is order 0 (kept in document
     order relative to each other) — bumping the sections that come BETWEEN
     caption and here up to order 1 (and the footer to order 2) is what
     pulls .bottom forward to right after .caption. */
  .bottom{
    position:relative; z-index:2; display:flex; align-items:flex-end; justify-content:space-between;
    gap:16px; padding:0 26px 18px; order:0;
  }
  /* Felipe: the corner log was not good — the athlete's lines and the
     Professor's lines were not clearly his vs. the coach's (and, before the
     ordering fix in the script below, were even swapped). Each speaker now
     gets his own color on both the label and a thin bar down the left edge
     (blue = you, gold = Professor, the same two colors as the status dot and
     the orb), older lines fold to two lines instead of one ellipsized line,
     the newest line always shows in full, and the whole stack is bottom-
     anchored with a soft fade at the top so the newest line never gets
     pushed out of view as the conversation grows. */
  .log{
    display:flex; flex-direction:column; justify-content:flex-end; gap:10px;
    width:min(92vw, 520px); max-height:34vh; overflow:hidden; min-width:0;
    -webkit-mask-image:linear-gradient(to bottom, transparent 0, #000 24%);
            mask-image:linear-gradient(to bottom, transparent 0, #000 24%);
  }
  .log .row{
    display:grid; grid-template-columns:78px 1fr; column-gap:12px; align-items:baseline;
    padding:3px 0 3px 12px; border-left:2px solid var(--blue);
    font-family:'IBM Plex Mono',monospace; font-size:12.5px; line-height:1.5;
  }
  .log .row.prof{border-left-color:var(--gold);}
  .log .who{color:var(--blue); letter-spacing:0.1em; font-size:10.5px; font-weight:600;}
  .log .who.prof{color:var(--gold);}
  .log .txt{
    color:var(--ink-dim); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
  }
  .log .row.active .txt{display:block; color:var(--ink); overflow:visible;}
  .log .row.pending .txt{opacity:0.55; font-style:italic;}

  .meter{display:flex; flex-direction:column; align-items:flex-end; gap:8px; flex:none;}
  .meter .lbl{font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:0.12em; color:var(--ink-faint); text-transform:uppercase;}
  .meter .bars{display:flex; align-items:flex-end; gap:3px; height:26px;}
  .meter .bars span{width:4px; border-radius:2px; background:var(--gold); opacity:0.35; height:4px; transition:height .09s ease, opacity .09s ease;}

  .footer{
    position:relative; z-index:2; text-align:center; padding:0 20px 20px;
    font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:0.05em; color:var(--ink-faint);
    order:2;
  }
  .footer kbd{
    display:inline-block; border:1px solid var(--line); border-radius:5px; padding:1.5px 6px;
    font-family:'IBM Plex Mono',monospace; font-size:10.5px; color:var(--ink-dim); margin:0 2px;
  }
  .footer .sep{margin:0 10px; opacity:0.4;}

  .permerr{
    position:relative; z-index:2; max-width:460px; margin:0 auto 18px; text-align:center;
    font-family:'Archivo',sans-serif; font-size:13.5px; color:var(--red); padding:0 20px; line-height:1.5;
    order:1;
  }
  .permerr a{color:var(--gold);}

  @media (max-width:640px){
    .bottom{flex-direction:column; align-items:stretch;}
    .log{width:100%;}
    .meter{flex-direction:row; align-items:center; justify-content:flex-end;}
  }
</style>
</head>
<body>
<div class="bgwash"></div>
<div class="scan"></div>

<div class="topbar">
  <div class="topleft">
    <a class="backbtn" href="/" title="Voltar ao menu" aria-label="Voltar ao menu">←</a>
    <div class="brandblock">
      <div class="brand">PROFESSOR</div>
      <div class="tag">coach de corrida com IA · ${esc(firstName)}</div>
    </div>
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

<div class="stage" id="stage">
  <canvas id="orbCanvas" width="560" height="560"></canvas>
  <div class="activate" id="activateBlock">
    <button id="activateBtn" type="button">Falar com o Professor</button>
    <p>Toque pra começar a conversa na hora — pede acesso ao microfone e já liga a chamada. Depois, é só continuar falando, ou diga <strong>"Hey Professor"</strong> a qualquer momento pra começar de novo sem tocar na tela.${voiceEnabled ? '' : ' Cadastre sua chave da API da OpenAI em <a href="/settings" style="color:var(--gold);">Configurações</a> antes de ativar.'}</p>
  </div>
</div>

<p class="caption muted" id="caption">Toque no orbe pra falar com o Professor.</p>
<p class="permerr" id="permErr" hidden></p>

<div class="hangupWrap" id="hangupWrap">
  <button type="button" id="hangupBtn">Encerrar</button>
</div>

<div class="quickchips" id="quickChips">
  <button type="button" class="feat" data-q="Quero meu bom dia, Professor!">Quero meu bom dia</button>
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
  TOQUE NO ORBE PRA FALAR<span class="sep">·</span>DIGA <kbd>"HEY PROFESSOR"</kbd> TAMBÉM FUNCIONA<span class="sep">·</span><kbd>ESC</kbd> ENCERRA<span class="sep">·</span>VERSÃO 7
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
  var stageEl = document.getElementById('stage');
  var activateBlock = document.getElementById('activateBlock');
  var activateBtn = document.getElementById('activateBtn');
  var quickChips = document.getElementById('quickChips');
  var hangupWrap = document.getElementById('hangupWrap');
  var hangupBtn = document.getElementById('hangupBtn');
  var captionEl = document.getElementById('caption');
  var permErrEl = document.getElementById('permErr');
  var statusPill = document.getElementById('statusPill');
  var statusText = document.getElementById('statusText');
  var logEl = document.getElementById('log');
  var meterBars = document.getElementById('meterBars').querySelectorAll('span');

  // ---------- canvas sizing (devicePixelRatio aware) ----------
  var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  var cssSize = 560;
  // The CSS min(78vmin, 560px, ...vh) rule on #orbCanvas is a coarse,
  // viewport-only guess at how tall the orb can be — it has no idea how
  // much vertical room the "Falar com o Professor" button+text below it
  // actually need, so on a short-but-not-extreme window (a phone turned
  // sideways, a half-height browser window) it could still guess too big
  // and leave the activate block's text touching the caption underneath.
  // This measures the REAL remaining space in .stage once the activate
  // block's own height is known, and only then, if the CSS size would
  // still be too tall for that, shrinks the canvas with an inline style.
  // activateBlock's height is cached on first read (while it's visible,
  // which it always is on first load) so the reservation stays the same
  // size even while it's later hidden mid-call — the orb shouldn't jump
  // to a different size as the call connects.
  var activateReserveH = null;
  function getActivateReserveH(){
    if (activateReserveH != null) return activateReserveH;
    var wasHidden = activateBlock.style.display === 'none';
    if (wasHidden) activateBlock.style.display = 'flex';
    activateReserveH = activateBlock.getBoundingClientRect().height;
    if (wasHidden) activateBlock.style.display = 'none';
    return activateReserveH;
  }
  function fitCanvas(){
    canvas.style.width = '';
    canvas.style.height = '';
    var rect = canvas.getBoundingClientRect();
    var natural = rect.width || 560;
    var stageCs = window.getComputedStyle(stageEl);
    var padV = parseFloat(stageCs.paddingTop) + parseFloat(stageCs.paddingBottom);
    var gapV = parseFloat(stageCs.rowGap || stageCs.gap) || 0;
    var innerH = stageEl.getBoundingClientRect().height - padV;
    var availForCanvas = innerH - gapV - getActivateReserveH();
    var finalSize = Math.max(96, Math.min(natural, availForCanvas));
    if (finalSize < natural - 1) {
      canvas.style.width = finalSize + 'px';
      canvas.style.height = finalSize + 'px';
      rect = canvas.getBoundingClientRect();
    }
    cssSize = rect.width || natural;
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
  // Feeds the orb's bars with the athlete's REAL mic signal (via Web
  // Audio's AnalyserNode) instead of a canned loop — Felipe asked for it to
  // look "mais tecnológica, mexe-se mais... como se fosse um robô", and
  // later, for the bars specifically, "conforme ele fala as linhas se
  // mexem, na mesma velocidade da fala e não aleatorio". Two buffers off
  // the same analyser: micAnalyserBuf (time-domain) for an overall loudness
  // scalar, micFreqBuf (frequency-domain) for the 64 individual bar
  // heights — a real per-frequency-bin spectrum, not noise.
  var micAudioCtx = null;
  var micAnalyser = null;
  var micAnalyserBuf = null;
  var micFreqBuf = null;
  var micLevel = 0;           // smoothed 0..1, updated once per animation frame
  // Same idea, mirrored onto the PROFESSOR's own voice (the remote WebRTC
  // audio track) — this is what drives the bars while he's the one
  // talking, so "speaking" is synced to his actual speech the same way
  // "listening" is synced to the athlete's.
  var voiceAudioCtx = null;
  var voiceAnalyser = null;
  var voiceAnalyserBuf = null;
  var voiceFreqBuf = null;
  var voiceLevel = 0;
  var assistantTranscriptBuf = ''; // the CURRENT reply's transcript, as it streams in
  var currentResponseId = null;    // id of the response whose events we are currently showing
  // Voice pace. NORMAL_SPEED must match the speed lib/openai.js mints the
  // session with; SLOW_SPEED is what the opening line and the "bom dia" line
  // switch to (session.update, then switched back when that line is done)
  // because Felipe could not understand the first greeting at normal pace.
  var NORMAL_SPEED = 1.08;
  var SLOW_SPEED = 0.95;
  var RITUAL_SPEED = 1.2; // the bom-dia lines: brisk conversational pace (0.85 and even 1.0 sounded far too slow)
  var greetingSlow = false;
  // The "quero meu bom dia, Professor" ritual: the Professor says "Bom dia,
  // meu atleta!" over loud rock, then asks how he is and how training went. State lives
  // here; the logic is in runBomDiaRitual() and friends further down.
  var BOMDIA_RE = /(quero|manda|solta|me\\s+d[aá])\\s+(o\\s+)?(meu\\s+)?bom[\\s-]+dia/i;
  var ritual = { active: false };
  var musicActive = false;     // true while the rock stinger is playing (the orb dances to it)
  var musicCtx = null;
  var musicAnalyser = null, musicAnalyserBuf = null, musicFreqBuf = null;
  var musicLevel = 0;
  // The caption used to just dump every response.output_audio_transcript.delta
  // onto the screen the instant it arrived — Felipe's "aparece digitando e
  // depois fala" complaint is exactly the documented behavior of OpenAI's
  // Realtime API: transcript text and audio are two independent, untimed
  // streams, and the text deltas land far faster than the audio actually
  // plays (confirmed on OpenAI's own community forum — there's no timestamp
  // tying a delta to a moment in the audio, so the only fix anyone's found is
  // to trickle the text out client-side at roughly speaking pace instead of
  // showing it all at once). revealBuffer holds text received but not yet
  // shown; revealShown is what's currently on screen; revealTimer ticks it
  // out a couple characters at a time.
  var revealBuffer = '';
  var revealShown = '';
  var revealTimer = null;
  var REVEAL_MS_PER_CHAR = 57; // ~17.5 chars/sec — matches the voice's speed:1.08 (lib/openai.js)
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
  // Stops the trickle-out reveal and clears it — called whenever whatever's
  // being revealed is no longer relevant (a new reply starts, the athlete
  // interrupts, the call ends) so stale text can never flash back over a
  // log row that's since moved on to something else.
  function stopReveal(){
    if (revealTimer) { clearInterval(revealTimer); revealTimer = null; }
    revealBuffer = '';
    revealShown = '';
  }
  // Felipe: the reply used to type itself out in the caption under the orb,
  // then the FINISHED transcript would separately land down in the log —
  // on his phone those are two different screens (the log sits below the
  // fold), so it looked like the text "cut" and jumped screens mid-sentence.
  // Fix: the trickle-out reveal writes straight into the log's own last row
  // (see beginLiveReply/setLiveReplyText below) — one on-screen place for a
  // reply, from its first word to its last. The caption goes back to just
  // short transient status ("Ouvindo…", "Pode continuar falando…").
  function queueReveal(deltaText){
    revealBuffer += deltaText;
    if (revealTimer) return;
    revealTimer = setInterval(function(){
      if (!revealBuffer) { clearInterval(revealTimer); revealTimer = null; return; }
      revealShown += revealBuffer.slice(0, 2);
      revealBuffer = revealBuffer.slice(2);
      setLiveReplyText(revealShown);
    }, REVEAL_MS_PER_CHAR * 2);
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

  // The log used to treat "the last row" as "the row the Professor's reply
  // is being written into". That broke the moment the athlete's own
  // transcript (which OpenAI sends a beat AFTER the Professor has already
  // started answering) got appended after the empty Professor row — the
  // reply text then landed in the athlete's row (labelled VOCÊ) while the
  // Professor's row stayed empty. Felipe saw exactly that: "minha fala vs
  // fala do professor não está legal". Two fixes, both below:
  //   1. the athlete's row is opened the instant he STARTS talking
  //      (input_audio_buffer.speech_started), as a pending "…" placeholder, so
  //      it always sits before the reply in the log whenever its transcript
  //      finally arrives — and is simply filled in later, by item id;
  //   2. the Professor's reply is tracked by an explicit reference
  //      (liveReplyRow), never by position.
  var liveReplyRow = null;
  function capHistory(){ while (history.length > 6) history.shift(); }
  function pushLog(role, text){
    var row = { role: role, text: text };
    history.push(row);
    capHistory();
    renderLog();
    return row;
  }
  function dropRow(row){
    var i = history.indexOf(row);
    if (i >= 0) { history.splice(i, 1); renderLog(); }
  }
  // Opens a new (empty) row for the Professor's reply the moment OpenAI
  // starts generating one (response.created) — queueReveal then fills it in
  // live, a couple characters at a time, straight in place, and
  // output_audio_transcript.done overwrites it with the authoritative final
  // text. Same row the whole time, never a second one appended after.
  function beginLiveReply(){
    liveReplyRow = { role: 'professor', text: '' };
    history.push(liveReplyRow);
    capHistory();
    renderLog();
  }
  function setLiveReplyText(text){
    if (!liveReplyRow) return;
    liveReplyRow.text = text;
    renderLog();
  }
  function beginUserRow(itemId){
    var row = { role: 'user', text: '', pending: true, itemId: itemId || null };
    history.push(row);
    capHistory();
    renderLog();
    return row;
  }
  function findPendingUserRow(itemId){
    var i, h;
    if (itemId) {
      for (i = history.length - 1; i >= 0; i--) {
        h = history[i];
        if (h.role === 'user' && h.pending && h.itemId === itemId) return h;
      }
    }
    for (i = history.length - 1; i >= 0; i--) {
      h = history[i];
      if (h.role === 'user' && h.pending) return h;
    }
    return null;
  }
  function renderLog(){
    logEl.innerHTML = '';
    history.forEach(function(h, i){
      var isProf = h.role === 'professor';
      var row = document.createElement('div');
      row.className = 'row ' + (isProf ? 'prof' : 'user') + (i === history.length - 1 ? ' active' : '') + (h.pending && !h.text ? ' pending' : '');
      var who = document.createElement('span');
      who.className = 'who' + (isProf ? ' prof' : '');
      who.textContent = isProf ? 'PROFESSOR' : 'VOCÊ';
      var txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = h.text || (h.pending ? '…' : '');
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
  // Felipe picked this over 4 other concepts (sent as PNGs for him to
  // choose from) and asked for it blue-only: a radial equalizer — a ring
  // of bars around a core dot, each bar's length read straight off a real
  // Web Audio spectrum (see micFreqBuf/voiceFreqBuf above), never off a
  // random generator. "Conforme ele fala as linhas se mexem, na mesma
  // velocidade da fala e não aleatorio" — while the Professor is talking,
  // the bars are driven frame-by-frame by voiceAnalyser (HIS actual voice,
  // the remote WebRTC track); while the athlete is talking, by micAnalyser
  // (his mic) — same mechanism, just pointed at whichever side is making
  // the sound right now. Nothing else (connecting/ambient/standby, where
  // there's no live audio to read) uses a synthetic idle pattern instead —
  // that's the only place anything here is "made up".
  var t0 = performance.now();
  var N_BARS = 64; // matches fftSize:128 -> frequencyBinCount:64, one bin per bar, no resampling
  var BLUE_DIM = '#4E9BFF', BLUE_BRIGHT = '#BFE3FF';

  function stateTuning(){
    switch (STATE) {
      case 'listening':  return { glow: 34, idle: 0.16 };
      case 'connecting': return { glow: 24, idle: 0.12 };
      case 'speaking':   return { glow: 36, idle: 0.16 };
      case 'ambient':    return { glow: 18, idle: 0.10 };
      default:           return { glow: 10, idle: 0.055 };
    }
  }

  // RMS of an analyser's time-domain buffer, smoothed into a level value
  // (0..1) — a coarse "how loud right now" scalar used for the background
  // glow and the bars' overall size. Falls back to relaxing toward 0 with
  // no analyser (not in a call, or no AudioContext support) instead of
  // leaving it stuck wherever it last was.
  function sampleLevel(analyser, buf, level){
    if (!analyser || !buf) return level + (0 - level) * 0.2;
    analyser.getByteTimeDomainData(buf);
    var sum = 0;
    for (var i = 0; i < buf.length; i++) {
      var v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    var rms = Math.sqrt(sum / buf.length);
    var target = Math.min(1, rms * 5.5);
    return level + (target - level) * 0.18;
  }

  // The real per-bar spectrum: one FFT bin per bar, folded left/right off
  // the top so the pattern is symmetric (bin 0 at top, bin 32 at bottom,
  // the two sides mirrors of each other) rather than all the energy
  // bunched on one side — voice/speech energy concentrates in the lower
  // bins, so an unfolded mapping would leave half the ring looking dead.
  function freqBars(analyser, buf){
    if (!analyser || !buf) return null;
    analyser.getByteFrequencyData(buf);
    var half = N_BARS / 2;
    var out = new Array(N_BARS);
    for (var i = 0; i < N_BARS; i++) {
      var folded = i <= half ? i : N_BARS - i;
      out[i] = buf[Math.min(buf.length - 1, folded)] / 255;
    }
    return out;
  }

  // Synthetic patterns — ONLY for states with no real audio to read yet.
  function idleBars(t, amount){
    var out = new Array(N_BARS);
    for (var i = 0; i < N_BARS; i++) out[i] = amount * (0.4 + 0.6 * Math.abs(Math.sin(t * 0.6 + i * 0.35)));
    return out;
  }
  function connectingBars(t){
    var out = new Array(N_BARS);
    var head = (t * 0.35) % 1;
    for (var i = 0; i < N_BARS; i++) {
      var pos = i / N_BARS;
      var d = Math.abs(pos - head); d = Math.min(d, 1 - d);
      out[i] = 0.12 + Math.max(0, 1 - d * 7) * 0.75;
    }
    return out;
  }

  function draw(now){
    var t = (now - t0) / 1000;
    var size = cssSize;
    var cx = size / 2, cy = size / 2;
    var base = size * 0.30;

    ctx.clearRect(0, 0, size, size);

    var tune = stateTuning();
    var amps, level;
    if (musicActive && musicAnalyser) {
      // the rock stinger of the "bom dia" ritual: the bars follow the music
      musicLevel = sampleLevel(musicAnalyser, musicAnalyserBuf, musicLevel);
      amps = freqBars(musicAnalyser, musicFreqBuf) || idleBars(t, tune.idle);
      level = musicLevel;
    } else if (STATE === 'listening') {
      micLevel = sampleLevel(micAnalyser, micAnalyserBuf, micLevel);
      amps = freqBars(micAnalyser, micFreqBuf) || idleBars(t, tune.idle);
      level = micLevel;
    } else if (STATE === 'speaking') {
      voiceLevel = sampleLevel(voiceAnalyser, voiceAnalyserBuf, voiceLevel);
      amps = freqBars(voiceAnalyser, voiceFreqBuf) || idleBars(t, tune.idle);
      level = voiceLevel;
    } else if (STATE === 'connecting') {
      amps = connectingBars(t);
      level = 0.3;
    } else {
      amps = idleBars(t, tune.idle);
      level = 0;
    }

    // soft background glow — brighter/bigger the louder it currently is
    var glow = tune.glow + level * 18;
    var bgGrad = ctx.createRadialGradient(cx, cy, base * 0.2, cx, cy, size * 0.62);
    bgGrad.addColorStop(0, BLUE_DIM + '22');
    bgGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, size, size);

    // faint reference ring the bars sit on
    ctx.beginPath();
    ctx.arc(cx, cy, base, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // faint tick marks just outside the bars — instrument-panel detail,
    // not reactive to anything
    for (var i = 0; i < 48; i++) {
      var tk = (i / 48) * Math.PI * 2;
      var r1 = base * 1.62, r2 = (i % 4 === 0) ? base * 1.72 : base * 1.68;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(tk) * r1, cy + Math.sin(tk) * r1);
      ctx.lineTo(cx + Math.cos(tk) * r2, cy + Math.sin(tk) * r2);
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // the bars themselves
    var maxExtra = base * 0.62;
    for (var b = 0; b < N_BARS; b++) {
      var ang = (b / N_BARS) * Math.PI * 2 - Math.PI / 2; // 0 at the top, clockwise
      var a = Math.min(1, amps[b] + level * 0.12);
      var len = base * 0.1 + a * maxExtra;
      var x1 = cx + Math.cos(ang) * base, y1 = cy + Math.sin(ang) * base;
      var x2 = cx + Math.cos(ang) * (base + len), y2 = cy + Math.sin(ang) * (base + len);
      var col = a > 0.55 ? BLUE_BRIGHT : BLUE_DIM;
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.55 + a * 0.45;
      ctx.lineWidth = Math.max(2, size * 0.009);
      ctx.lineCap = 'round';
      ctx.shadowColor = col;
      ctx.shadowBlur = 6 + a * glow * 0.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // inner core dot
    ctx.beginPath();
    ctx.arc(cx, cy, base * 0.12 * (1 + level * 0.3), 0, Math.PI * 2);
    ctx.fillStyle = BLUE_BRIGHT;
    ctx.globalAlpha = 0.85;
    ctx.shadowColor = BLUE_BRIGHT;
    ctx.shadowBlur = glow * 0.6;
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
    abortRitual(); // stops any music, un-mutes the mic track before it is stopped below
    endRitual2();
    liveReplyRow = null;
    currentResponseId = null;
    greetingSlow = false;
    if (dataChannel) { try { dataChannel.close(); } catch (e) {} dataChannel = null; }
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    if (micStream) { micStream.getTracks().forEach(function(t){ try { t.stop(); } catch (e) {} }); micStream = null; }
    if (remoteAudioEl) { try { remoteAudioEl.pause(); } catch (e) {} if (remoteAudioEl.parentNode) remoteAudioEl.parentNode.removeChild(remoteAudioEl); remoteAudioEl = null; }
    if (micAudioCtx) { try { micAudioCtx.close(); } catch (e) {} micAudioCtx = null; }
    micAnalyser = null; micAnalyserBuf = null; micFreqBuf = null; micLevel = 0;
    if (voiceAudioCtx) { try { voiceAudioCtx.close(); } catch (e) {} voiceAudioCtx = null; }
    voiceAnalyser = null; voiceAnalyserBuf = null; voiceFreqBuf = null; voiceLevel = 0;
    stopReveal();
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

  // A cold start (tapped the orb or said "Hey Professor" with no question
  // riding along) used to just sit there listening — Felipe wants the
  // Professor to open instead. response.create's per-response instructions
  // override is what keeps the opening line itself ("E aí, atleta!")
  // exact every time rather than leaving it to whatever the model would
  // improvise from the session's general instructions.
  function sendEvent(obj){
    if (!dataChannel || dataChannel.readyState !== 'open') return false;
    try { dataChannel.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
  }
  // session.update is how the voice pace is changed mid-call. Best effort:
  // if the API refuses it the error is only logged, and the slow-pace
  // instructions in the per-response prompt still apply.
  function setSessionSpeed(v){
    sendEvent({ type: 'session.update', session: { type: 'realtime', audio: { output: { speed: v } } } });
  }
  function setMicEnabled(on){
    if (micStream) micStream.getAudioTracks().forEach(function(t){ t.enabled = on; });
  }

  // Opening line of every plain call: said verbatim at the normal pace.
  function sendGreeting(){
    if (!dataChannel || dataChannel.readyState !== 'open') return;
    var line = 'Fala, atleta! O que você precisa agora?';
    // Read verbatim (out-of-band, no persona/history) at the normal pace: the
    // earlier prompt asked for a "pausa" and the model SAID the word "pausa",
    // and the slow pace plus "E aí" sounded wrong in Portuguese.
    sendEvent({ type: 'conversation.item.create', item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: line }] } });
    sendEvent({
      type: 'response.create',
      response: {
        conversation: 'none',
        output_modalities: ['audio'],
        instructions: 'Você é o Professor, treinador de corrida, recebendo um atleta. Diga EXATAMENTE e SOMENTE o texto que o usuário enviar, sem acrescentar, trocar ou comentar nenhuma palavra. Fale como numa conversa de verdade: voz natural, enérgica e calorosa, ritmo ágil e fluido, sem arrastar as palavras. Não responda ao texto, apenas diga-o.',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: line }] }],
      },
    });
  }

  // ---------- bom dia, version 2: everything pre-recorded, on ONE clock ----------
  // The live model could not be trusted with the timing (it improvised, spoke
  // late, and the system ducked the music while the call audio played). So the
  // two spoken lines are ready-made MP3s (server: /api/professor/bomdia-voice,
  // synthesized once) and they play together with the music in a single Web
  // Audio context, with every volume change scheduled up front:
  //   0.0s   music alone, loud, for MUSIC_ALONE s
  //   then   music ducks a little (never silent) and "Bom dia, meu atleta!" plays
  //   then   music back to loud for LOUD1 s
  //   then   music ducks again and "Como você está hoje? Como foram os treinos?" plays
  //   then   music back to loud for TAIL s, fades out and ends.
  // The realtime call (if there is none yet) connects in the background so the
  // athlete can answer right after; the model is told what was said.
  var MUSIC_ALONE = 3.5, LOUD1 = 2.2, TAIL = 2.8, LOW = 0.55, FADE = 1.5;
  var ritual2 = { active: false };
  var ritualSkipGreeting = false; // set when the pre-recorded bom dia opened the call: no "Fala, atleta!" afterwards
  var voiceLineBytes = {};
  function fetchVoiceLine(n){
    if (voiceLineBytes[n]) return voiceLineBytes[n];
    voiceLineBytes[n] = fetch('/api/professor/bomdia-voice?line=' + n, { credentials: 'include' })
      .then(function(r){ if (!r.ok) throw new Error('http ' + r.status); return r.arrayBuffer(); })
      .catch(function(){ voiceLineBytes[n] = null; return null; });
    return voiceLineBytes[n];
  }
  function preloadBomDiaVoices(){ fetchVoiceLine(1); fetchVoiceLine(2); }
  function voiceLinesReady(){
    return Promise.race([
      Promise.all([fetchVoiceLine(1), fetchVoiceLine(2)]).then(function(a){ return !!(a[0] && a[1]); }),
      new Promise(function(res){ setTimeout(function(){ res(false); }, 6000); }),
    ]);
  }
  // Entry point for every trigger (chip, claps, ambient voice, in-call voice).
  function startBomDia(live){
    if (ritual.active || ritual2.active) return;
    voiceLinesReady().then(function(ok){
      if (ritual.active || ritual2.active) return;
      if (ok) { runBomDiaV2(); return; }
      // lines not available (no key / no credits / offline): the old live-model version
      rlog('v2-unavailable');
      if (live && dataChannel && dataChannel.readyState === 'open') runBomDiaRitual(true);
      else { permErrEl.hidden = true; activateBlock.style.display = 'none'; startLiveCall('Quero meu bom dia, Professor!'); }
    });
  }
  function decodeBuf(ac, bytes){
    return new Promise(function(resolve){
      if (!bytes) { resolve(null); return; }
      try { ac.decodeAudioData(bytes.slice(0), function(b){ resolve(b); }, function(){ resolve(null); }); }
      catch (e) { resolve(null); }
    });
  }
  function runBomDiaV2(){
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { rlog('v2-noaudio'); return; }
    var live = !!(dataChannel && dataChannel.readyState === 'open');
    var mine = { active: true, ac: null, timers: [], ended: false, needCall: false };
    ritual2 = mine;
    clearTimeout(inactivityTimer);
    stopReveal();
    if (live) {
      sendEvent({ type: 'response.cancel' });
      sendEvent({ type: 'output_audio_buffer.clear' });
      if (liveReplyRow) { dropRow(liveReplyRow); liveReplyRow = null; }
      setVoiceMuted(true);
      setMicEnabled(false);
    } else {
      mine.needCall = true;
      ritualSkipGreeting = true;
      permErrEl.hidden = true;
      activateBlock.style.display = 'none';
      startLiveCall(''); // connects in the background; its greeting is suppressed while ritual2 is active
    }
    setState('speaking');
    setStatus('Tocando', 'speaking');
    setCaption('Rock pra acordar o corpo!', true);
    var ac;
    try { ac = new AC(); } catch (e) { endRitual2(); return; }
    mine.ac = ac;
    if (ac.state === 'suspended') { try { ac.resume(); } catch (e2) {} }
    Promise.all([musicBytesWithin(2500), fetchVoiceLine(1), fetchVoiceLine(2)]).then(function(r){
      return Promise.all([decodeBuf(ac, r[0]), decodeBuf(ac, r[1]), decodeBuf(ac, r[2])]);
    }).then(function(b){
      if (ritual2 !== mine || mine.ended) return;
      var music = b[0], v1 = b[1], v2 = b[2];
      if (!v1 || !v2) { rlog('v2-decode-failed'); endRitual2(); return; }
      var bus = ac.createGain();
      var comp = ac.createDynamicsCompressor();
      var an = ac.createAnalyser();
      an.fftSize = 128; an.smoothingTimeConstant = 0.55;
      bus.connect(comp); comp.connect(an); an.connect(ac.destination);
      var mg = ac.createGain();   // music level (the ducking)
      var vg = ac.createGain();   // voice level
      vg.gain.value = 1.5;
      mg.connect(bus); vg.connect(bus);
      var T0 = ac.currentTime + 0.2;
      var t = T0, lowT, upT;
      mg.gain.setValueAtTime(1, T0);
      // phase 1: music alone, loud
      t = T0 + MUSIC_ALONE;
      // phase 2: duck (a little), line 1
      mg.gain.setValueAtTime(1, t); mg.gain.linearRampToValueAtTime(LOW, t + 0.35);
      var a1 = t + 0.5;
      play(v1, a1);
      var a1End = a1 + v1.duration;
      // phase 3: music loud again
      t = a1End + 0.2;
      mg.gain.setValueAtTime(LOW, t); mg.gain.linearRampToValueAtTime(1, t + 0.3);
      t = t + 0.3 + LOUD1;
      // phase 4: duck again, line 2
      mg.gain.setValueAtTime(1, t); mg.gain.linearRampToValueAtTime(LOW, t + 0.35);
      var a2 = t + 0.5;
      play(v2, a2);
      var a2End = a2 + v2.duration;
      // phase 5: loud again, tail, fade out
      t = a2End + 0.2;
      mg.gain.setValueAtTime(LOW, t); mg.gain.linearRampToValueAtTime(1, t + 0.3);
      t = t + 0.3 + TAIL;
      mg.gain.setValueAtTime(1, t); mg.gain.linearRampToValueAtTime(0.0001, t + FADE);
      var END = t + FADE + 0.15;
      if (music) {
        var ms = ac.createBufferSource(); ms.buffer = music; ms.connect(mg); ms.start(T0); ms.stop(END);
      } else {
        // no music file: the synthesized riff stands in (it feeds the same music gain)
        try { playRockRiff(ac, mg, T0 - ac.currentTime - 0.1); } catch (e3) {}
      }
      function play(buf, when){
        var s = ac.createBufferSource(); s.buffer = buf; s.connect(vg); s.start(when);
      }
      // orb + log follow the same clock
      musicCtx = ac; musicAnalyser = an;
      musicAnalyserBuf = new Uint8Array(an.frequencyBinCount);
      musicFreqBuf = new Uint8Array(an.frequencyBinCount);
      musicActive = true;
      rlog('v2-play', 'music=' + (music ? music.duration.toFixed(1) + 's' : 'synth') + ' v1=' + v1.duration.toFixed(2) + ' v2=' + v2.duration.toFixed(2) + ' total=' + (END - T0).toFixed(1));
      function at(sec, fn){ mine.timers.push(setTimeout(function(){ if (ritual2 === mine && !mine.ended) fn(); }, Math.max(0, (sec - ac.currentTime) * 1000))); }
      at(a1, function(){ pushLog('professor', 'Bom dia, meu atleta!'); setCaption('Bom dia, meu atleta!', true); });
      at(a2, function(){ pushLog('professor', 'Como você está hoje? Como foram os treinos?'); setCaption('Como você está hoje?', true); });
      at(END, endRitual2);
      mine.timers.push(setTimeout(function(){ if (ritual2 === mine) endRitual2(); }, (END - ac.currentTime) * 1000 + 4000));
    });
  }
  function endRitual2(){
    var r = ritual2;
    if (!r.active || r.ended) return;
    r.ended = true;
    r.timers.forEach(function(t){ clearTimeout(t); });
    ritual2 = { active: false };
    clap.lock = performance.now() + 10000; // the speakers' own music/voice must never re-trigger it
    clap.last = 0;
    try { if (r.ac) r.ac.close(); } catch (e) {}
    if (musicCtx === r.ac) musicCtx = null;
    musicActive = false; musicAnalyser = null; musicAnalyserBuf = null; musicFreqBuf = null; musicLevel = 0;
    rlog('v2-end');
    setVoiceMuted(false);
    if (dataChannel && dataChannel.readyState === 'open') {
      setMicEnabled(true);
      sendEvent({ type: 'conversation.item.create', item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Bom dia, meu atleta! Como você está hoje? Como foram os treinos?' }] } });
      setSessionSpeed(NORMAL_SPEED);
      setState('listening');
      setCaption('Pode responder…', true);
      armInactivityTimer();
    } else if (STATE === 'speaking') {
      // the call never connected (or is still connecting): leave the state as the connect flow sets it
      if (r.needCall) { setCaption('Conectando o Professor…', true); }
    }
  }

  // ---------- "quero meu bom dia, Professor" ----------
  // Felipe's script for the ritual (all client-side, deterministic):
  //   1. the music starts LOUD (about INTRO_MS),
  //   2. it ducks to a low bed WITHOUT stopping and the Professor says
  //      "Bom dia, meu atleta!",
  //   3. when that voice has really gone quiet the music comes back LOUD for
  //      about BUMP_MS,
  //   4. it ducks again and the Professor asks "Como voce esta hoje? Como
  //      foram os treinos?",
  //   5. the music swells a touch and fades out, the mic comes back.
  // The mic track is muted for the whole ritual so the speakers can not
  // trigger the turn detection. The end of each spoken line is detected by
  // watching the voice analyser for silence, because response.done fires
  // well before the audio has finished playing.
  // The music is /assets/bomdia.mp3 when that file exists (a clip Felipe
  // supplies, royalty-free); otherwise an ORIGINAL rock riff synthesized
  // right here with Web Audio, so the ritual always works.
  var INTRO_MS = 3500, BUMP_MS = 2200, TAIL_MS = 3000, DUCK_LEVEL = 0.55;
  var MUSIC_URL = '/assets/bomdia.mp3';
  var musicBytesPromise = null;
  function preloadMusic(){
    if (musicBytesPromise) return musicBytesPromise;
    try {
      musicBytesPromise = fetch(MUSIC_URL).then(function(r){ return r.ok ? r.arrayBuffer() : null; }).catch(function(){ return null; });
    } catch (e) { musicBytesPromise = Promise.resolve(null); }
    return musicBytesPromise;
  }
  function musicBytesWithin(ms){
    return Promise.race([preloadMusic(), new Promise(function(res){ setTimeout(function(){ res(null); }, ms); })]);
  }

  function runBomDiaRitual(cancelInflight){
    if (ritual.active || !dataChannel || dataChannel.readyState !== 'open') return;
    var mine = { active: true, gen: liveGeneration, line: 0, awaiting: false, respId: null, retries: 0, timer: null, poll: null, ctrl: null };
    ritual = mine;
    clearTimeout(inactivityTimer);
    stopReveal();
    if (cancelInflight) {
      // The athlete said it mid-call, so the model has already started its
      // own (generic) answer to that sentence — stop it and drop its row.
      sendEvent({ type: 'response.cancel' });
      sendEvent({ type: 'output_audio_buffer.clear' });
      if (liveReplyRow) { dropRow(liveReplyRow); liveReplyRow = null; }
    }
    setMicEnabled(false);
    // A generic answer to the spoken command may already be playing — silence
    // the speaker until our own line is requested (restored in sendRitualCreate/endRitual).
    if (cancelInflight) setVoiceMuted(true);
    rlog('start', cancelInflight ? 'mid-call' : 'fresh');
    setState('speaking');
    setCaption('Rock pra acordar o corpo!', true);
    setStatus('Tocando', 'speaking');
    setSessionSpeed(RITUAL_SPEED);
    mine.timer = setTimeout(function(){ if (ritual === mine) abortRitual(); }, 45000);
    musicBytesWithin(1500).then(function(bytes){
      if (ritual !== mine) return null;
      return startMusicBed(bytes).then(function(ctrl){
        if (ritual !== mine) { if (ctrl) ctrl.stop(); return; }
        mine.ctrl = ctrl;
        musicActive = !!ctrl;
        setTimeout(function(){ if (ritual === mine) ritualSay(1); }, ctrl ? INTRO_MS : 0);
      });
    });
  }
  // Duck the music, then ask the model for exactly one of the two lines.
  function ritualSay(n){
    var r = ritual;
    if (!r.active || r.gen !== liveGeneration) return;
    r.line = n; r.awaiting = true; r.respId = null; r.retries = 0; r.acc = ''; r.bad = 0;
    musicActive = false; // the orb follows the Professor's voice while he talks
    if (r.ctrl) r.ctrl.duck(DUCK_LEVEL, 0.35);
    rlog('say', n);
    setState('speaking');
    setStatus('Professor falando', 'speaking');
    setTimeout(sendRitualCreate, r.ctrl ? 380 : 0); // let the music dip first
    clearTimeout(r.lineTimer);
    r.lineTimer = setTimeout(function(){ if (ritual === r && r.awaiting && r.line === n) { rlog('watchdog', n); ritualLineDone(); } }, 11000);
  }
  var RITUAL_LINES = { 1: 'Bom dia, meu atleta!', 2: 'Como você está hoje? Como foram os treinos?' };
  function ritualNorm(t){
    return (t || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\\s+/g, ' ').replace(/^ /, '');
  }
  // The line goes out as an OUT-OF-BAND response (conversation:'none') with its
  // own tiny input, so the coach persona and the chat history can not make the
  // model improvise ("Bom dia! Que o seu dia seja leve...") — it only repeats.
  function sendRitualCreate(){
    var r = ritual;
    if (!r.active || r.gen !== liveGeneration || !r.awaiting) return;
    setVoiceMuted(false);
    var line = RITUAL_LINES[r.line];
    var strict = r.bad > 0 ? ' Atenção: na tentativa anterior você acrescentou palavras. Diga SOMENTE o texto, nada além dele.' : '';
    var ev;
    if (r.inband) {
      ev = { type: 'response.create', response: { metadata: { ritual: String(r.line) }, instructions: 'Fale SOMENTE esta frase, exatamente assim, sem acrescentar nada: "' + line + '"' + strict } };
    } else {
      ev = { type: 'response.create', response: {
        conversation: 'none',
        output_modalities: ['audio'],
        metadata: { ritual: String(r.line) },
        instructions: 'Você é o Professor, treinador de corrida, cumprimentando um atleta de manhã. Diga EXATAMENTE e SOMENTE o texto que o usuário enviar, sem acrescentar, trocar ou comentar nenhuma palavra. Fale como numa conversa de verdade: voz natural, enérgica e calorosa, ritmo ágil e fluido, sem arrastar as palavras e sem soar como leitura de texto. Não responda ao texto, apenas diga-o.' + strict,
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: line }] }],
      } };
    }
    rlog('create', r.line + (r.inband ? ' inband' : ' oob'));
    sendEvent(ev);
  }
  function ritualLineDelta(delta){
    var r = ritual;
    if (!r.active || !r.awaiting || !r.respId) return;
    r.acc = (r.acc || '') + (delta || '');
    var got = ritualNorm(r.acc), want = ritualNorm(RITUAL_LINES[r.line]);
    var gotT = got.replace(/ $/, '');
    var off = !want.startsWith(gotT) || got.length > want.length + 1;
    if (off && r.bad < 2) {
      r.bad++;
      rlog('off-script', r.acc);
      sendEvent({ type: 'response.cancel' });
      sendEvent({ type: 'output_audio_buffer.clear' });
      var dead = r.respId;
      r.respId = null; r.acc = ''; r.ignoreId = dead;
      if (liveReplyRow) { dropRow(liveReplyRow); liveReplyRow = null; }
      setTimeout(sendRitualCreate, 650); // one more try, with the stricter wording
    }
  }
  // Voice playback mute (the speaker element only — the analyser keeps working).
  function setVoiceMuted(on){
    if (remoteAudioEl) { try { remoteAudioEl.muted = !!on; } catch (e) {} }
  }
  // Tiny trace of what the ritual did, readable from the console (ritualTrace()).
  var ritualTraceBuf = [];
  function rlog(ev, info){
    try {
      ritualTraceBuf.push(Math.round(performance.now()) + ' ' + ev + (info !== undefined ? ' ' + info : ''));
      if (ritualTraceBuf.length > 80) ritualTraceBuf.shift();
      window.ritualTrace = function(){ return ritualTraceBuf.slice(); };
    } catch (e) {}
  }
  function rawLevel(analyser, buf){
    if (!analyser || !buf) return 0;
    analyser.getByteTimeDomainData(buf);
    var sum = 0;
    for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; sum += v * v; }
    return Math.min(1, Math.sqrt(sum / buf.length) * 5.5);
  }
  // The reply is generated faster than it is played, so response.done is
  // NOT the end of the speech. Poll the voice analyser until the Professor
  // has really gone quiet (about 0.7s of silence) before the next music cue.
  function waitVoiceQuiet(mine, cb){
    var quiet = 0, started = Date.now();
    mine.poll = setInterval(function(){
      if (ritual !== mine) { clearInterval(mine.poll); return; }
      var elapsed = Date.now() - started;
      var lvl = voiceAnalyser ? rawLevel(voiceAnalyser, voiceAnalyserBuf) : 1;
      quiet = lvl < 0.03 ? quiet + 1 : 0;
      var silentEnough = voiceAnalyser ? (quiet >= 9 && elapsed >= 800) : elapsed >= 3200;
      if (silentEnough || elapsed >= 9000) {
        clearInterval(mine.poll); mine.poll = null;
        if (ritual === mine && mine.gen === liveGeneration) cb();
      }
    }, 80);
  }
  function ritualLineDone(){
    var mine = ritual, line = mine.line;
    if (!mine.awaiting) return;
    clearTimeout(mine.lineTimer);
    rlog('line-done', line);
    mine.awaiting = false;
    waitVoiceQuiet(mine, function(){ if (line === 1) ritualBump(mine); else ritualOutro(mine); });
  }
  function ritualBump(mine){
    if (mine.ctrl) { musicActive = true; mine.ctrl.duck(1, 0.3); }
    setCaption('Rock pra acordar o corpo!', true);
    setStatus('Tocando', 'speaking');
    setTimeout(function(){ if (ritual === mine) ritualSay(2); }, mine.ctrl ? BUMP_MS : 0);
  }
  function ritualOutro(mine){
    if (mine.ctrl) {
      musicActive = true; mine.ctrl.duck(1, 0.3); // music back up and plays for a bit before the end
      setTimeout(function(){ if (ritual === mine && mine.ctrl) mine.ctrl.fadeOut(1.4); }, TAIL_MS);
    }
    setTimeout(function(){ if (ritual === mine) endRitual(); }, mine.ctrl ? TAIL_MS + 1500 : 0);
  }
  function stopMusicNow(){
    if (musicCtx) { try { musicCtx.close(); } catch (e) {} musicCtx = null; }
  }
  function endRitual(){
    var r = ritual;
    if (!r.active) return;
    clearTimeout(r.timer);
    if (r.poll) clearInterval(r.poll);
    clearTimeout(r.lineTimer);
    clap.lock = performance.now() + 10000; clap.last = 0;
    ritual = { active: false };
    setVoiceMuted(false);
    rlog('end');
    stopMusicNow();
    musicActive = false; musicAnalyser = null; musicAnalyserBuf = null; musicFreqBuf = null; musicLevel = 0;
    setMicEnabled(true);
    if (r.gen === liveGeneration && dataChannel) {
      // out-of-band lines are not part of the conversation — tell the model what was said
      sendEvent({ type: 'conversation.item.create', item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: RITUAL_LINES[1] + ' ' + RITUAL_LINES[2] }] } });
      setSessionSpeed(NORMAL_SPEED);
      setState('listening');
      setCaption('Pode continuar falando…', true);
      armInactivityTimer();
    }
  }
  function abortRitual(){
    if (ritual.active) endRitual();
  }

  // The music bed: a file when we have one, the synthesized riff otherwise.
  // Resolves with a small controller {duck(level, sec), fadeOut(sec), stop()}
  // (or null when Web Audio is not available). The analyser sits AFTER the
  // duck gain so the orb follows what is really audible.
  function startMusicBed(bytes){
    return new Promise(function(resolve){
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { resolve(null); return; }
      var ac;
      try { ac = new AC(); } catch (e) { resolve(null); return; }
      musicCtx = ac;
      if (ac.state === 'suspended') { try { ac.resume(); } catch (e2) {} }
      var fade = ac.createGain(); fade.gain.value = 1;   // end-of-ritual fade
      var duck = ac.createGain(); duck.gain.value = 1;   // under-the-voice ducking
      var an = ac.createAnalyser();
      an.fftSize = 128; an.smoothingTimeConstant = 0.55;
      fade.connect(duck); duck.connect(an); an.connect(ac.destination);
      musicAnalyser = an;
      musicAnalyserBuf = new Uint8Array(an.frequencyBinCount);
      musicFreqBuf = new Uint8Array(an.frequencyBinCount);
      function ramp(node, level, sec){
        var t = ac.currentTime;
        try {
          node.gain.cancelScheduledValues(t);
          node.gain.setValueAtTime(node.gain.value, t);
          node.gain.linearRampToValueAtTime(Math.max(0.0001, level), t + Math.max(0.02, sec));
        } catch (e4) {}
      }
      var ctrl = {
        duck: function(level, sec){ ramp(duck, level, sec); },
        fadeOut: function(sec){ ramp(fade, 0.0001, sec); },
        stop: function(){ if (musicCtx === ac) musicCtx = null; try { ac.close(); } catch (e5) {} },
      };
      function go(buffer){
        try {
          if (buffer) playMusicFile(ac, buffer, fade, 0); else playRockRiff(ac, fade, 0);
        } catch (e6) {}
        resolve(ctrl);
      }
      if (bytes) {
        try { ac.decodeAudioData(bytes.slice(0), function(b){ go(b); }, function(){ go(null); }); }
        catch (e7) { go(null); }
      } else go(null);
    });
  }
  function playMusicFile(ac, buffer, dest, delay){
    var src = ac.createBufferSource();
    src.buffer = buffer;
    var g = ac.createGain();
    var t0 = ac.currentTime + 0.05 + (delay || 0), dur = buffer.duration;
    g.gain.setValueAtTime(1, t0);
    if (dur > 1.5) { g.gain.setValueAtTime(1, t0 + dur - 0.6); g.gain.linearRampToValueAtTime(0.0001, t0 + dur); }
    src.connect(g); g.connect(dest);
    src.start(t0);
  }

  // Original hard-rock riff (no real recording): distorted power chords on a
  // stomping riff in E minor, bass, kick/snare/hats, a crash on each repeat.
  // About 12 seconds so it can sit under the whole ritual.
  function playRockRiff(ac, dest, delay){
    var BEAT = 0.5; // 120 bpm
    var REPS = 3;
    var t0 = ac.currentTime + 0.1 + (delay || 0);
    var master = ac.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.8, t0 + 0.02);
    var comp = ac.createDynamicsCompressor();
    master.connect(comp); comp.connect(dest);

    var pre = ac.createBiquadFilter(); pre.type = 'lowpass'; pre.frequency.value = 2600;
    var dist = ac.createWaveShaper();
    var curve = new Float32Array(2048);
    for (var ci = 0; ci < 2048; ci++) { var cxv = (ci / 1024) - 1; curve[ci] = Math.tanh(cxv * 14); }
    dist.curve = curve; dist.oversample = '4x';
    var post = ac.createBiquadFilter(); post.type = 'lowpass'; post.frequency.value = 4200;
    var guitarBus = ac.createGain(); guitarBus.gain.value = 0.32;
    pre.connect(dist); dist.connect(post); post.connect(guitarBus); guitarBus.connect(master);

    var noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    var nd = noiseBuf.getChannelData(0);
    for (var ni = 0; ni < nd.length; ni++) nd[ni] = Math.random() * 2 - 1;
    function noiseSrc(when, len){
      var s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      s.start(when); s.stop(when + len);
      return s;
    }
    function chord(freq, when, len, vel){
      var env = ac.createGain();
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(vel, when + 0.006);
      env.gain.exponentialRampToValueAtTime(vel * 0.5, when + Math.min(len * 0.7, 0.5));
      env.gain.exponentialRampToValueAtTime(0.0001, when + len);
      env.connect(pre);
      [[1, -7], [1, 7], [1.5, 0], [2, 0]].forEach(function(p){
        var o = ac.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = freq * p[0]; o.detune.value = p[1];
        o.connect(env); o.start(when); o.stop(when + len + 0.05);
      });
    }
    function bass(freq, when, len){
      var o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
      var g = ac.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.7, when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, when + len);
      o.connect(g); g.connect(master); o.start(when); o.stop(when + len + 0.05);
    }
    function kick(when){
      var o = ac.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(150, when);
      o.frequency.exponentialRampToValueAtTime(45, when + 0.12);
      var g = ac.createGain();
      g.gain.setValueAtTime(1.0, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.3);
      o.connect(g); g.connect(master); o.start(when); o.stop(when + 0.32);
    }
    function snare(when){
      var n = noiseSrc(when, 0.22);
      var bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.7;
      var g = ac.createGain();
      g.gain.setValueAtTime(0.7, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.2);
      n.connect(bp); bp.connect(g); g.connect(master);
      var o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = 190;
      var g2 = ac.createGain();
      g2.gain.setValueAtTime(0.5, when);
      g2.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
      o.connect(g2); g2.connect(master); o.start(when); o.stop(when + 0.14);
    }
    function hat(when){
      var n = noiseSrc(when, 0.06);
      var hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
      var g = ac.createGain();
      g.gain.setValueAtTime(0.22, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
      n.connect(hp); hp.connect(g); g.connect(master);
    }
    function crash(when){
      var n = noiseSrc(when, 1.7);
      var hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4200;
      var g = ac.createGain();
      g.gain.setValueAtTime(0.55, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 1.6);
      n.connect(hp); hp.connect(g); g.connect(master);
    }

    var E3 = 164.81, E2 = 82.41;
    var riff = [[0, 0, 3, 0, 5, 0, 3, null], [0, 0, 3, 0, 7, 5, 3, 0]]; // semitones above E, 8th notes
    for (var rep = 0; rep < REPS; rep++) {
      crash(t0 + rep * 8 * BEAT);
      for (var bar = 0; bar < 2; bar++) {
        var base = t0 + (rep * 2 + bar) * 4 * BEAT;
        for (var s = 0; s < 8; s++) {
          var n8 = riff[bar][s];
          var when = base + s * BEAT / 2;
          if (n8 !== null) {
            chord(E3 * Math.pow(2, n8 / 12), when, 0.2, 0.9);
            bass(E2 * Math.pow(2, n8 / 12), when, 0.22);
          }
          hat(when);
        }
        kick(base); kick(base + 2 * BEAT);
        if (bar === 1) kick(base + 2.5 * BEAT);
        snare(base + BEAT); snare(base + 3 * BEAT);
      }
    }
    var fin = t0 + REPS * 8 * BEAT;
    chord(E3, fin, 0.95, 1.0); bass(E2, fin, 0.95); kick(fin); crash(fin);
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
        if (ritual.active) break; // the mic is muted during the bom-dia ritual; anything heard now is echo
        clearTimeout(inactivityTimer);
        stopReveal(); // real barge-in: whatever was still trickling out is now stale
        // If the athlete interrupted before a single character of the reply
        // had actually appeared, its row is still empty — drop it rather than
        // leave a blank "PROFESSOR" line in the log. Either way that reply is
        // over: later events for it must not touch any row.
        if (liveReplyRow) {
          if (!liveReplyRow.text) dropRow(liveReplyRow);
          liveReplyRow = null;
        }
        beginUserRow(evt.item_id); // the athlete's own line, opened now so it always sits BEFORE the reply
        setState('listening');
        setCaption('Ouvindo…', true);
        break;
      case 'conversation.item.input_audio_transcription.completed': {
        var said = (evt.transcript || '').trim();
        var urow = findPendingUserRow(evt.item_id);
        if (urow) {
          if (said) { urow.text = said; urow.pending = false; renderLog(); }
          else dropRow(urow); // noise / silence: nothing was actually said
        } else if (said) {
          // No placeholder (should be rare): put it just before the reply it triggered.
          var late = { role: 'user', text: said };
          var at = liveReplyRow ? history.indexOf(liveReplyRow) : -1;
          if (at >= 0) history.splice(at, 0, late); else history.push(late);
          capHistory();
          renderLog();
        }
        if (said && BOMDIA_RE.test(said)) startBomDia(true);
        break;
      }
      case 'response.created':
        if (ritual.active) {
          var cid = (evt.response && evt.response.id) || null;
          var meta = (evt.response && evt.response.metadata) || null;
          var isMine = ritual.awaiting && !ritual.respId && cid !== ritual.ignoreId && (meta ? String(meta.ritual) === String(ritual.line) : true);
          rlog('created', (cid || '?') + (isMine ? ' mine' : ' stray'));
          if (isMine) ritual.respId = cid; // the line we asked for
          else { sendEvent({ type: 'response.cancel' }); sendEvent({ type: 'output_audio_buffer.clear' }); break; } // a stray generic answer — not now
          currentResponseId = cid;
          assistantTranscriptBuf = '';
          stopReveal();
          beginLiveReply();
          break;
        }
        currentResponseId = (evt.response && evt.response.id) || null;
        assistantTranscriptBuf = '';
        stopReveal();
        setState('speaking');
        beginLiveReply(); // opens the one row this reply will live in, start to finish
        break;
      case 'response.output_audio_transcript.delta':
        if (ritual.active && ritual.respId && evt.response_id && evt.response_id !== ritual.respId) break; // text of a response we threw away
        if (evt.delta) { assistantTranscriptBuf += evt.delta; queueReveal(evt.delta); }
        if (ritual.active && evt.delta) ritualLineDelta(evt.delta);
        break;
      case 'response.output_audio_transcript.done':
        // Overwrites the same row queueReveal has been filling in — the
        // authoritative final text, not a second entry appended after it.
        if (evt.transcript && evt.transcript.trim()) setLiveReplyText(evt.transcript.trim());
        break;
      case 'response.done': {
        var doneId = evt.response && evt.response.id;
        // A response that was cancelled or superseded can finish AFTER the
        // next one has already started — it must not reset the UI of the
        // reply that is actually playing.
        if (doneId && currentResponseId && doneId !== currentResponseId) break;
        var wasCancelled = !!(evt.response && evt.response.status === 'cancelled');
        stopReveal();
        liveReplyRow = null;
        if (greetingSlow) { greetingSlow = false; setSessionSpeed(NORMAL_SPEED); }
        if (ritual.active) {
          // our own line finished generating -> wait for the voice to go quiet, then the next music cue
          rlog('done', (doneId || '?') + ' ' + (wasCancelled ? 'cancelled' : 'ok') + ' "' + assistantTranscriptBuf + '"');
          if (ritual.awaiting && ritual.respId && ritual.respId === doneId && !wasCancelled) ritualLineDone();
          break; // never drop to "listening" in the middle of the ritual
        }
        setState('listening');
        setCaption('Pode continuar falando…', true);
        armInactivityTimer();
        break;
      }
      case 'error': {
        var emsg = (evt.error && evt.error.message) || '';
        if (/no active response|not active/i.test(emsg)) break; // response.cancel with nothing to cancel — harmless
        if (ritual.active) rlog('error', emsg);
        if (ritual.active && ritual.awaiting && !ritual.respId && !ritual.inband && /unknown|invalid|unsupported|parameter|conversation|output_modalities|input/i.test(emsg) && !/active response/i.test(emsg)) {
          ritual.inband = true; // this API version refused the out-of-band form: say the line the plain way
          setTimeout(sendRitualCreate, 200);
          break;
        }
        if (ritual.active && ritual.awaiting && !ritual.respId && /active response/i.test(emsg) && ritual.retries < 2) {
          ritual.retries++;
          setTimeout(sendRitualCreate, 700); // the cancelled answer was still winding down — try again
          break;
        }
        console.error('Professor (realtime):', evt);
        break;
      }
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
    preloadMusic(); // warm the bom-dia music file (if any) so the ritual starts on time
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
      var localMicAudioCtx = null, localMicAnalyser = null, localMicAnalyserBuf = null, localMicFreqBuf = null;
      var localVoiceAudioCtx = null, localVoiceAnalyser = null, localVoiceAnalyserBuf = null, localVoiceFreqBuf = null;
      function cleanupLocal(){
        if (localDataChannel) { try { localDataChannel.close(); } catch (e) {} }
        if (localPc) { try { localPc.close(); } catch (e) {} }
        if (localMicStream) { localMicStream.getTracks().forEach(function(t){ try { t.stop(); } catch (e) {} }); }
        if (localAudioEl) { try { localAudioEl.pause(); } catch (e) {} if (localAudioEl.parentNode) localAudioEl.parentNode.removeChild(localAudioEl); }
        if (localMicAudioCtx) { try { localMicAudioCtx.close(); } catch (e) {} }
        if (localVoiceAudioCtx) { try { localVoiceAudioCtx.close(); } catch (e) {} }
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
          // orb's bars react to the athlete's ACTUAL voice — both an overall
          // loudness scalar (time-domain, localMicAnalyserBuf) and a real
          // 64-bin spectrum (frequency-domain, localMicFreqBuf) for the bars
          // themselves. fftSize:128 -> frequencyBinCount:64, one bin per
          // bar, no resampling needed. Purely local/visual — never sent
          // anywhere; if AudioContext isn't available the orb just falls
          // back to its idle animation (freqBars() returns null with no
          // analyser, draw() picks idleBars() instead).
          try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (AC) {
              localMicAudioCtx = new AC();
              var micSrc = localMicAudioCtx.createMediaStreamSource(localMicStream);
              localMicAnalyser = localMicAudioCtx.createAnalyser();
              localMicAnalyser.fftSize = 128;
              localMicAnalyser.smoothingTimeConstant = 0.55;
              micSrc.connect(localMicAnalyser);
              localMicAnalyserBuf = new Uint8Array(localMicAnalyser.frequencyBinCount);
              localMicFreqBuf = new Uint8Array(localMicAnalyser.frequencyBinCount);
            }
          } catch (e) { localMicAudioCtx = null; localMicAnalyser = null; localMicAnalyserBuf = null; localMicFreqBuf = null; }

          localPc = new RTCPeerConnection();
          localAudioEl = document.createElement('audio');
          localAudioEl.autoplay = true;
          localAudioEl.style.display = 'none';
          document.body.appendChild(localAudioEl);
          localPc.ontrack = function(e){
            localAudioEl.srcObject = e.streams[0];
            localAudioEl.play().catch(function(){});
            // Mirrors the mic analyser above, but on the PROFESSOR's own
            // voice track (the remote stream) — this is what lets the bars
            // move with his ACTUAL speech while he's talking, same way they
            // move with the athlete's mic while listening. Tapping the
            // stream with Web Audio here is analysis-only and doesn't
            // affect playback — localAudioEl keeps playing it normally
            // either way, independent of this.
            try {
              var AC2 = window.AudioContext || window.webkitAudioContext;
              if (AC2 && !localVoiceAudioCtx) {
                localVoiceAudioCtx = new AC2();
                var voiceSrc = localVoiceAudioCtx.createMediaStreamSource(e.streams[0]);
                localVoiceAnalyser = localVoiceAudioCtx.createAnalyser();
                localVoiceAnalyser.fftSize = 128;
                localVoiceAnalyser.smoothingTimeConstant = 0.55;
                voiceSrc.connect(localVoiceAnalyser);
                localVoiceAnalyserBuf = new Uint8Array(localVoiceAnalyser.frequencyBinCount);
                localVoiceFreqBuf = new Uint8Array(localVoiceAnalyser.frequencyBinCount);
              }
            } catch (err) { localVoiceAudioCtx = null; localVoiceAnalyser = null; localVoiceAnalyserBuf = null; localVoiceFreqBuf = null; }
            // ontrack can fire before OR after the publish step below runs
            // (it depends on exactly when the remote media starts flowing
            // relative to the data-channel-open wait) — publish here too,
            // guarded by myGen, so the orb picks up the voice analyser
            // whichever order they land in, instead of only when ontrack
            // happens to win the race.
            if (myGen === liveGeneration) {
              voiceAudioCtx = localVoiceAudioCtx; voiceAnalyser = localVoiceAnalyser;
              voiceAnalyserBuf = localVoiceAnalyserBuf; voiceFreqBuf = localVoiceFreqBuf;
            }
          };
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
          }).then(function(){
            // setRemoteDescription resolving only means signaling finished —
            // the data channel itself (oai-events) opens a beat later, once
            // ICE/DTLS actually settles. sendUserTextTurn() below silently
            // no-ops on a channel that isn't open yet, which is exactly what
            // Felipe hit: he tapped a quick-chip, the prefilled question
            // never made it to OpenAI, and the call just sat there
            // "listening" for him to speak instead of asking it. Waiting
            // for the real 'open' event (not just assuming it's ready)
            // closes that race for every call, prefilled or not.
            if (localDataChannel.readyState === 'open') return;
            return new Promise(function(resolve, reject){
              var openTimeout = setTimeout(function(){
                localDataChannel.removeEventListener('open', onOpen);
                reject({ kind: 'generic' });
              }, 8000);
              function onOpen(){
                clearTimeout(openTimeout);
                localDataChannel.removeEventListener('open', onOpen);
                resolve();
              }
              localDataChannel.addEventListener('open', onOpen);
            });
          });
        });
      }).then(function(){
        if (myGen !== liveGeneration) { cleanupLocal(); return; }
        // Connected — this attempt is now THE live call; publish its
        // resources to the shared globals so teardownConnection()/
        // endLiveCall() know what to close later.
        pc = localPc; micStream = localMicStream; dataChannel = localDataChannel; remoteAudioEl = localAudioEl;
        micAudioCtx = localMicAudioCtx; micAnalyser = localMicAnalyser; micAnalyserBuf = localMicAnalyserBuf; micFreqBuf = localMicFreqBuf;
        // Voice analyser is also published from inside ontrack (see above) in
        // case that fires later than this block — redundant, not conflicting.
        voiceAudioCtx = localVoiceAudioCtx; voiceAnalyser = localVoiceAnalyser;
        voiceAnalyserBuf = localVoiceAnalyserBuf; voiceFreqBuf = localVoiceFreqBuf;
        startClapListener();
        if (ritual2.active) {
          // the pre-recorded bom dia is playing: keep the mic muted and the greeting out of its way
          setState('speaking'); setMicEnabled(false);
          ritualSkipGreeting = false;
          requestWakeLock(); armHardCap();
          return;
        }
        setState('listening');
        setCaption(prefill ? prefill : 'Chamando o professor…', true);
        requestWakeLock();
        armInactivityTimer();
        armHardCap();
        if (prefill && BOMDIA_RE.test(prefill)) { pushLog('user', prefill); runBomDiaRitual(false); }
        else if (prefill) sendUserTextTurn(prefill);
        else if (ritualSkipGreeting) {
          // the bom dia already played while this call was connecting
          ritualSkipGreeting = false;
          sendEvent({ type: 'conversation.item.create', item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Bom dia, meu atleta! Como você está hoje? Como foram os treinos?' }] } });
          setCaption('Pode responder…', true);
        }
        else sendGreeting();
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

  // ---------- two hand claps start the bom dia ----------
  // The athlete claps TWICE ("palma, palma") and the Professor does the bom-dia
  // ritual. A dedicated mic stream with the browser's voice processing OFF
  // (noise suppression would eat a clap) feeds a small onset detector:
  //   - a clap is a sharp rise (>= 6x the background level, and >= CLAP_MIN_RMS)
  //     of broadband noise (zero-crossing rate) that dies away within ~110 ms
  //     (speech and music sustain, so they are rejected),
  //   - two claps 150-800 ms apart = the trigger; 2.5 s lock-out afterwards.
  // It runs wherever the mic permission is already granted (so it never pops
  // up a permission prompt by itself) and is paused while the ritual runs.
  var CLAP_MIN_RMS = 0.045, CLAP_RATIO = 6;
  var clap = { stream: null, ctx: null, an: null, buf: null, timer: null, starting: false,
    baseline: 0.004, prev: 0, ev: null, last: 0, lock: 0 };
  function startClapListener(){
    if (clap.stream || clap.starting) return;
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return;
    clap.starting = true;
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(function(stream){
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { stream.getTracks().forEach(function(t){ t.stop(); }); clap.starting = false; return; }
      clap.stream = stream; clap.starting = false;
      clap.ctx = new AC();
      var src = clap.ctx.createMediaStreamSource(stream);
      clap.an = clap.ctx.createAnalyser();
      clap.an.fftSize = 1024; clap.an.smoothingTimeConstant = 0;
      src.connect(clap.an);
      clap.buf = new Float32Array(clap.an.fftSize);
      clap.timer = setInterval(clapTick, 12);
    }).catch(function(){ clap.starting = false; });
  }
  function clapTick(){
    if (!clap.an) return;
    if (clap.ctx && clap.ctx.state === 'suspended') { try { clap.ctx.resume(); } catch (e) {} }
    clap.an.getFloatTimeDomainData(clap.buf);
    var n = 512, off = clap.buf.length - n, sum = 0, zc = 0, pk = 0;
    for (var i = 0; i < n; i++) {
      var v = clap.buf[off + i];
      sum += v * v;
      if (v > pk) pk = v; else if (-v > pk) pk = -v;
      if (i > 0 && ((clap.buf[off + i - 1] < 0) !== (v < 0))) zc++;
    }
    clapFeed(Math.sqrt(sum / n), zc / n, performance.now());
  }
  function clapFeed(rms, zcr, now){
    if (ritual.active || ritual2.active || STATE === 'speaking' || STATE === 'connecting' || now < clap.lock) { clap.ev = null; clap.last = 0; clap.prev = rms; return; }
    if (!clap.ev) clap.baseline = Math.max(0.002, clap.baseline * 0.985 + rms * 0.015);
    if (!clap.ev) {
      if (rms >= Math.max(CLAP_MIN_RMS, clap.baseline * CLAP_RATIO) && rms >= clap.prev * 1.8 && zcr > 0.05 && now - clap.evEnd > 110) {
        clap.ev = { t: now, peak: rms };
      }
    } else {
      var age = now - clap.ev.t;
      if (age < 60 && rms > clap.ev.peak) clap.ev.peak = rms;
      if (age >= 110) {
        var ok = rms < clap.ev.peak * 0.4; // impulsive: died away
        var t0 = clap.ev.t;
        clap.evEnd = now;
        clap.ev = null;
        if (ok) {
          var gap = t0 - clap.last;
          if (clap.last && gap >= 150 && gap <= 800) { clap.last = 0; clap.lock = now + 2500; onDoubleClap(); }
          else clap.last = t0;
        }
      }
    }
    clap.prev = rms;
  }
  clap.evEnd = 0;
  function onDoubleClap(){
    rlog('double-clap', STATE);
    if (ritual.active) return;
    var CMD = 'Quero meu bom dia, Professor!';
    if (ritual2.active) return;
    if (STATE === 'listening' || STATE === 'speaking') startBomDia(true);
    else if (STATE === 'standby' || STATE === 'ambient') { stopRecognition(function(){ startBomDia(false); }); }
  }
  setTimeout(preloadBomDiaVoices, 2500); // warm the server-side cache of the two spoken lines
  // Start it right away when the browser already holds the mic permission.
  try {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' }).then(function(st){
        if (st.state === 'granted') startClapListener();
        st.onchange = function(){ if (st.state === 'granted') startClapListener(); };
      }).catch(function(){});
    }
  } catch (e) {}

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
      setCaption(canListen ? 'Diga "Hey Professor" quando quiser perguntar algo — ou bata duas palmas pro seu bom dia.' : 'Toque no orbe quando quiser falar com o Professor.', true);
      if (!canListen) return;

      recognition = new SR();
      recognition.lang = 'pt-BR';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognitionPhase = 'ambient';

      recognition.onresult = function(event){
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var transcript = normalize(event.results[i][0].transcript);
          if (BOMDIA_RE.test(transcript)) {
            stopRecognition(function(){ startBomDia(false); });
            return;
          }
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
    // The explicit hang-up button is the mirror image of the chips: only
    // useful once there's actually a call (or a call being set up) to end.
    hangupWrap.style.display = (next === 'connecting' || next === 'listening' || next === 'speaking') ? 'flex' : 'none';
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
    if (prefill && BOMDIA_RE.test(prefill)) { startBomDia(false); return; }
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

  // Explicit "Encerrar" — same hang-up path as tapping the orb or pressing
  // Esc, just a second, unmistakable way to do it.
  hangupBtn.addEventListener('click', function(){
    if (STATE === 'listening' || STATE === 'speaking' || STATE === 'connecting') endLiveCall('Chamada encerrada.');
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
