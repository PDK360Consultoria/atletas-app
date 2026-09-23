const { esc } = require('./lib/format');

// Standalone page (own theme, not the shared app CSS) — ported from the
// previously validated coach.html live GPS + voice coaching app. Kept as its
// own document because it needs Geolocation/SpeechSynthesis/Bluetooth APIs
// and a layout tuned specifically for a running phone screen.
function coachPage(user) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Coach de Ritmo · Atletas</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap">
<style>
:root{
  --ground:#EEF1F0; --surface:#FFFFFF; --surface-2:#F5F7F6;
  --ink:#101613; --ink-2:#455049; --muted:#6E7A72;
  --line:#DAE2DD; --line-soft:#E7EDE9;
  --accent:#1F7A5C; --accent-ink:#FFFFFF;
  --good:#2E8B57; --good-t:rgba(46,139,87,.12);
  --warn:#B8860B; --warn-t:rgba(184,134,11,.14);
  --bad:#C1432E; --bad-t:rgba(193,67,46,.12);
  --shadow:0 1px 2px rgba(16,22,19,.05), 0 10px 28px -16px rgba(16,22,19,.28);
  color-scheme: light;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ground:#0B1210; --surface:#131C18; --surface-2:#17211C;
    --ink:#EAF1EC; --ink-2:#B7C6BD; --muted:#84948B;
    --line:#26362E; --line-soft:#1C2A23;
    --accent:#3FBF8F; --accent-ink:#08130F;
    --good:#3FBF8F; --good-t:rgba(63,191,143,.16);
    --warn:#E0AF3C; --warn-t:rgba(224,175,60,.16);
    --bad:#E8654F; --bad-t:rgba(232,101,79,.16);
    --shadow:0 1px 2px rgba(0,0,0,.35), 0 12px 30px -16px rgba(0,0,0,.7);
    color-scheme: dark;
  }
}
:root[data-theme="dark"]{
  --ground:#0B1210; --surface:#131C18; --surface-2:#17211C;
  --ink:#EAF1EC; --ink-2:#B7C6BD; --muted:#84948B;
  --line:#26362E; --line-soft:#1C2A23;
  --accent:#3FBF8F; --accent-ink:#08130F;
  --good:#3FBF8F; --good-t:rgba(63,191,143,.16);
  --warn:#E0AF3C; --warn-t:rgba(224,175,60,.16);
  --bad:#E8654F; --bad-t:rgba(232,101,79,.16);
  --shadow:0 1px 2px rgba(0,0,0,.35), 0 12px 30px -16px rgba(0,0,0,.7);
  color-scheme: dark;
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  background:var(--ground); color:var(--ink);
  font-family:'Archivo',-apple-system,sans-serif;
  margin:0; padding-inline:16px; padding-block:0 40px;
  -webkit-font-smoothing:antialiased;
}
.topbar{max-width:480px; margin:0 auto; display:flex; gap:14px; align-items:center; padding:16px 0 4px; font-family:'IBM Plex Mono',monospace; font-size:12px; text-transform:uppercase; letter-spacing:.05em;}
.topbar a{color:var(--muted); text-decoration:none;}
.topbar a.brand{color:var(--ink); font-family:'Archivo',sans-serif; font-weight:800; text-transform:none; letter-spacing:-0.01em; font-size:16px; margin-right:auto;}
.wrap{max-width:480px;margin:0 auto;display:flex;flex-direction:column;gap:18px; margin-top:16px;}
h1,h2,.eyebrow,.mono,.big{font-family:'Archivo',sans-serif}
.mono{font-family:'IBM Plex Mono',monospace}

.eyebrow{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0}
h1{font-size:26px;font-weight:800;letter-spacing:-.02em;margin:6px 0 0;text-wrap:balance}
.sub{color:var(--ink-2);font-size:14.5px;margin:8px 0 0;line-height:1.5}

.livecard{
  background:var(--surface); border:1px solid var(--line-soft); border-radius:22px;
  padding:22px 20px; box-shadow:var(--shadow); display:flex; flex-direction:column; gap:14px;
}
.livecard.running{border-color:var(--accent)}
.status-row{display:flex; align-items:center; justify-content:space-between; gap:10px}
.status-pill{
  display:inline-flex; align-items:center; gap:7px; font-size:11.5px; font-weight:700;
  letter-spacing:.08em; text-transform:uppercase; padding:5px 11px; border-radius:20px;
  background:var(--surface-2); color:var(--muted);
}
.status-pill.on{background:var(--good-t); color:var(--good)}
.status-pill .dot{width:7px;height:7px;border-radius:50%;background:currentColor}
.status-pill .dot.pulse{animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.status-pill .dot.pulse{animation:none}}

.stats-grid{display:grid; grid-template-columns:1fr 1fr; gap:1px; background:var(--line-soft); border:1px solid var(--line-soft); border-radius:16px; overflow:hidden}
.stats-grid div{background:var(--surface); padding:14px 16px; display:flex; flex-direction:column; gap:2px}
.stats-grid .k{font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); font-weight:700}
.stats-grid .v{font-size:26px; font-weight:800; letter-spacing:-.02em; font-variant-numeric:tabular-nums}
.stats-grid .v small{font-size:13px; font-weight:600; color:var(--ink-2); margin-left:2px}
.stats-grid .v.hero{grid-column:1 / -1; font-size:44px}

.block-now{
  border-radius:14px; padding:12px 16px; display:flex; flex-direction:column; gap:4px;
  background:var(--surface-2); border:1px solid var(--line-soft);
}
.block-now .lbl{font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); font-weight:700}
.block-now .name{font-size:16.5px; font-weight:700}
.block-now .targets{font-family:'IBM Plex Mono',monospace; font-size:13.5px; color:var(--ink-2)}
.block-now.good{border-color:var(--good); background:var(--good-t)}
.block-now.warn{border-color:var(--warn); background:var(--warn-t)}
.block-now.bad{border-color:var(--bad); background:var(--bad-t)}

.controls{display:flex; gap:10px}
button{
  font-family:'Archivo',sans-serif; font-weight:700; font-size:15px; border-radius:14px;
  border:1px solid var(--line); padding:14px 16px; cursor:pointer; background:var(--surface);
  color:var(--ink); flex:1; transition:opacity .12s ease;
}
button:active{opacity:.7}
button.primary{background:var(--accent); color:var(--accent-ink); border-color:var(--accent)}
button.danger{background:var(--bad); color:#fff; border-color:var(--bad)}
button:disabled{opacity:.4; cursor:default}
button.small{flex:none; padding:10px 14px; font-size:13.5px}

.msg{font-size:13px; color:var(--muted); line-height:1.5}
.msg.err{color:var(--bad)}

.section{display:flex; flex-direction:column; gap:10px}
.section h2{font-size:12px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--ink); margin:0}
.blocks-list{display:flex; flex-direction:column; gap:10px}
.block-row{
  background:var(--surface); border:1px solid var(--line-soft); border-radius:14px;
  padding:14px 16px; display:flex; flex-direction:column; gap:8px; box-shadow:var(--shadow);
  position:relative; overflow:hidden;
}
.block-row .progress{position:absolute; left:0; top:0; bottom:0; width:0%; background:var(--good-t); transition:width .3s ease; z-index:0}
.block-row.current{border-color:var(--accent)}
.block-row > *{position:relative; z-index:1}
.field-row{display:flex; gap:8px; flex-wrap:wrap}
.field{display:flex; flex-direction:column; gap:3px; flex:1; min-width:74px}
.field label{font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); font-weight:700}
.field input{
  font-family:'IBM Plex Mono',monospace; font-size:14.5px; border:1px solid var(--line); border-radius:9px;
  padding:8px 9px; background:var(--surface-2); color:var(--ink); width:100%;
}
.field input.name{font-family:'Archivo',sans-serif; font-weight:600}
.rm-btn{align-self:flex-end; background:none; border:none; color:var(--bad); font-size:12.5px; font-weight:700; flex:none; padding:2px 6px; width:auto}

.settings-row{display:flex; gap:10px; align-items:center; flex-wrap:wrap}
.settings-row label{font-size:13.5px; color:var(--ink-2); font-weight:600}
select{
  font-family:'IBM Plex Mono',monospace; font-size:14px; border:1px solid var(--line); border-radius:10px;
  padding:8px 10px; background:var(--surface); color:var(--ink);
}

.hr-card{display:flex; align-items:center; justify-content:space-between; gap:10px; background:var(--surface); border:1px solid var(--line-soft); border-radius:14px; padding:14px 16px; box-shadow:var(--shadow)}
.hr-card .l{font-size:14px; color:var(--ink-2)}
.hr-card .v{font-family:'IBM Plex Mono',monospace; font-weight:700; font-size:20px}

footer{color:var(--muted); font-size:12.5px; border-top:1px solid var(--line); padding-top:14px; line-height:1.5}
</style>
</head>
<body>

<div class="topbar">
  <a class="brand" href="/">Atletas</a>
  <a href="/activities">Treinos</a>
  <a href="/races">Provas</a>
  <a href="/logout">Sair</a>
</div>

<div class="wrap">

  <header>
    <p class="eyebrow">Coach de ritmo · fala no fone durante a corrida</p>
    <h1>Ele corre com você e avisa se o ritmo ou a FC fogem do alvo</h1>
    <p class="sub">Monte os blocos do treino de hoje, aperte iniciar e deixe o celular no bolso. A cada trecho ele fala em voz alta o pace, o bloco atual e se você precisa ajustar.</p>
  </header>

  <section class="livecard" id="livecard">
    <div class="status-row">
      <span class="status-pill" id="statusPill"><span class="dot"></span><span id="statusText">Parado</span></span>
      <span class="msg mono" id="clock">00:00</span>
    </div>

    <div class="stats-grid">
      <div class="v hero" style="grid-column:1/-1">
        <span class="k">Distância</span>
        <div><span id="distVal">0.00</span><small>km</small></div>
      </div>
      <div>
        <span class="k">Pace atual</span>
        <div class="v"><span id="paceVal">—</span><small>/km</small></div>
      </div>
      <div>
        <span class="k">Frequência cardíaca</span>
        <div class="v"><span id="hrVal">—</span><small>bpm</small></div>
      </div>
    </div>

    <div class="block-now" id="blockNow">
      <span class="lbl">Bloco atual</span>
      <span class="name" id="blockName">Nenhum treino iniciado</span>
      <span class="targets mono" id="blockTargets">—</span>
    </div>

    <div class="controls">
      <button class="primary" id="startBtn">Iniciar treino</button>
      <button id="pauseBtn" disabled>Pausar</button>
      <button class="danger" id="stopBtn" disabled>Encerrar</button>
    </div>
    <p class="msg" id="statusMsg">Toque em "Iniciar treino" pra pedir acesso ao GPS e travar a tela ligada.</p>
  </section>

  <section class="hr-card">
    <span class="l" id="hrLabel">Frequência cardíaca via Bluetooth: não conectada</span>
    <button class="small" id="hrBtn">Conectar</button>
  </section>

  <section class="section">
    <h2>Blocos do treino</h2>
    <p class="msg">Distância acumulada (km), pace-alvo (min:seg/km) e teto de FC opcional. Edite antes de iniciar — durante a corrida os campos ficam travados.</p>
    <div class="blocks-list" id="blocksList"></div>
    <div class="controls">
      <button class="small" id="addBlockBtn" style="flex:1">+ adicionar bloco</button>
      <button class="small" id="saveBlocksBtn" style="flex:1">Salvar como padrão</button>
    </div>
  </section>

  <section class="section">
    <h2>Configurações de voz</h2>
    <div class="settings-row">
      <label for="intervalSel">Avisar a cada</label>
      <select id="intervalSel">
        <option value="300">300 m</option>
        <option value="500" selected>500 m</option>
        <option value="1000">1 km</option>
      </select>
    </div>
    <div class="settings-row">
      <button class="small" id="testVoiceBtn">Testar voz</button>
    </div>
  </section>

  <footer>
    Usa o GPS e o sintetizador de voz do próprio navegador — nada sai do seu celular. Em iPhone (Safari), a leitura de frequência cardíaca por Bluetooth não é suportada pelo navegador; o pace por bloco funciona normalmente. Mantenha a aba aberta e a tela ligada durante a corrida — navegadores móveis suspendem GPS e áudio com a tela apagada ou o app em segundo plano.
  </footer>

</div>

<script>
(function(){
  'use strict';

  function paceToSec(str){
    var m = /^(\\d{1,2}):([0-5]\\d)$/.exec((str||'').trim());
    if(!m) return null;
    return parseInt(m[1],10)*60 + parseInt(m[2],10);
  }
  function secToPace(s){
    if(s==null || !isFinite(s) || s<=0) return '—';
    s = Math.round(s);
    var m = Math.floor(s/60), sec = s%60;
    return m + ':' + (sec<10?'0':'') + sec;
  }
  function fmtClock(totalSec){
    totalSec = Math.floor(totalSec);
    var h = Math.floor(totalSec/3600), m = Math.floor((totalSec%3600)/60), s = totalSec%60;
    var pad = function(n){ return (n<10?'0':'')+n; };
    return h>0 ? (h+':'+pad(m)+':'+pad(s)) : (pad(m)+':'+pad(s));
  }
  function haversine(a,b){
    var R = 6371000;
    var dLat = (b.lat-a.lat) * Math.PI/180;
    var dLon = (b.lon-a.lon) * Math.PI/180;
    var la1 = a.lat * Math.PI/180, la2 = b.lat * Math.PI/180;
    var h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  var DEFAULT_BLOCKS = [
    {label:'Aquecimento',  startKm:0,  endKm:6,  paceTarget:'5:35', hrCeil:150},
    {label:'Transição',    startKm:6,  endKm:12, paceTarget:'5:20', hrCeil:158},
    {label:'Bloco alvo',   startKm:12, endKm:24, paceTarget:'5:05', hrCeil:165},
    {label:'Final',        startKm:24, endKm:28, paceTarget:'4:55', hrCeil:null}
  ];

  var blocks = [];
  try {
    var saved = localStorage.getItem('coach_blocks_v1');
    blocks = saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(DEFAULT_BLOCKS));
  } catch(e) { blocks = JSON.parse(JSON.stringify(DEFAULT_BLOCKS)); }

  var blocksListEl = document.getElementById('blocksList');

  function renderBlocks(currentKm, locked){
    blocksListEl.innerHTML = '';
    blocks.forEach(function(b, i){
      var row = document.createElement('div');
      row.className = 'block-row';
      var isCurrent = (currentKm != null && currentKm >= b.startKm && currentKm < b.endKm);
      if(isCurrent) row.className += ' current';

      if(currentKm != null){
        var span = Math.max(0.0001, b.endKm - b.startKm);
        var pct = 0;
        if(currentKm >= b.endKm) pct = 100;
        else if(currentKm > b.startKm) pct = ((currentKm - b.startKm)/span)*100;
        var bar = document.createElement('div');
        bar.className = 'progress';
        bar.style.width = Math.min(100,Math.max(0,pct)) + '%';
        row.appendChild(bar);
      }

      var fr1 = document.createElement('div'); fr1.className = 'field-row';

      function field(labelTxt, val, cls, onInput){
        var f = document.createElement('div'); f.className = 'field';
        var l = document.createElement('label'); l.textContent = labelTxt; f.appendChild(l);
        var inp = document.createElement('input');
        inp.value = val; if(cls) inp.className = cls;
        inp.disabled = !!locked;
        inp.addEventListener('input', function(){ onInput(inp.value); persistBlocks(); });
        f.appendChild(inp);
        return f;
      }

      fr1.appendChild(field('Nome', b.label, 'name', function(v){ b.label = v; }));
      row.appendChild(fr1);

      var fr2 = document.createElement('div'); fr2.className = 'field-row';
      fr2.appendChild(field('Início km', b.startKm, null, function(v){ b.startKm = parseFloat(v)||0; }));
      fr2.appendChild(field('Fim km', b.endKm, null, function(v){ b.endKm = parseFloat(v)||0; }));
      fr2.appendChild(field('Pace alvo', b.paceTarget, null, function(v){ b.paceTarget = v; }));
      fr2.appendChild(field('Teto FC', b.hrCeil==null?'':b.hrCeil, null, function(v){ b.hrCeil = v===''?null:(parseInt(v,10)||null); }));
      row.appendChild(fr2);

      if(!locked){
        var rm = document.createElement('button');
        rm.className = 'rm-btn'; rm.textContent = 'remover bloco';
        rm.addEventListener('click', function(){ blocks.splice(i,1); persistBlocks(); renderBlocks(currentKm, locked); });
        row.appendChild(rm);
      }

      blocksListEl.appendChild(row);
    });
  }
  function persistBlocks(){
    try{ localStorage.setItem('coach_blocks_v1', JSON.stringify(blocks)); }catch(e){}
  }
  renderBlocks(null, false);

  document.getElementById('addBlockBtn').addEventListener('click', function(){
    var last = blocks[blocks.length-1];
    var start = last ? last.endKm : 0;
    blocks.push({label:'Novo bloco', startKm:start, endKm:start+5, paceTarget:'5:20', hrCeil:null});
    persistBlocks();
    renderBlocks(null, running);
  });
  document.getElementById('saveBlocksBtn').addEventListener('click', function(){
    persistBlocks();
    statusMsg('Blocos salvos como padrão neste navegador.');
  });

  var voiceReady = false;
  function speak(text){
    try{
      if(!('speechSynthesis' in window)) return;
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR';
      u.rate = 1.0;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }catch(e){}
  }
  document.getElementById('testVoiceBtn').addEventListener('click', function(){
    speak('Teste de voz. Pace atual, cinco vinte por quilômetro.');
  });

  var hrValue = null;
  var hrLabelEl = document.getElementById('hrLabel');
  var hrBtn = document.getElementById('hrBtn');
  if(!('bluetooth' in navigator)){
    hrLabelEl.textContent = 'Frequência cardíaca por Bluetooth não é suportada neste navegador (comum em iPhone/Safari).';
    hrBtn.disabled = true;
  }
  hrBtn.addEventListener('click', function(){
    if(!('bluetooth' in navigator)) return;
    navigator.bluetooth.requestDevice({ filters:[{services:['heart_rate']}] })
      .then(function(device){
        hrLabelEl.textContent = 'Conectando a ' + (device.name || 'monitor') + '…';
        return device.gatt.connect();
      })
      .then(function(server){ return server.getPrimaryService('heart_rate'); })
      .then(function(service){ return service.getCharacteristic('heart_rate_measurement'); })
      .then(function(ch){
        return ch.startNotifications().then(function(){
          ch.addEventListener('characteristicvaluechanged', function(ev){
            var v = ev.target.value;
            var flags = v.getUint8(0);
            var hr = (flags & 0x1) ? v.getUint16(1, true) : v.getUint8(1);
            hrValue = hr;
            document.getElementById('hrVal').textContent = hr;
          });
          hrLabelEl.textContent = 'Frequência cardíaca conectada.';
        });
      })
      .catch(function(err){
        hrLabelEl.textContent = 'Não conectou (' + (err && err.message ? err.message : 'erro') + ').';
      });
  });

  var running = false, paused = false;
  var watchId = null, wakeLock = null;
  var startTime = null, pausedAccum = 0, pauseStarted = null;
  var totalDistanceM = 0;
  var recentFixes = [];
  var lastGoodFix = null;
  var lastAnnouncedM = 0;
  var lastHrAlertAt = 0;
  var clockTimer = null;

  var startBtn = document.getElementById('startBtn');
  var pauseBtn = document.getElementById('pauseBtn');
  var stopBtn = document.getElementById('stopBtn');
  var statusPill = document.getElementById('statusPill');
  var statusText = document.getElementById('statusText');
  var livecard = document.getElementById('livecard');

  function statusMsg(t, isErr){
    var el = document.getElementById('statusMsg');
    el.textContent = t;
    el.className = 'msg' + (isErr ? ' err' : '');
  }

  function currentBlock(km){
    for(var i=0;i<blocks.length;i++){
      if(km >= blocks[i].startKm && km < blocks[i].endKm) return blocks[i];
    }
    if(blocks.length && km >= blocks[blocks.length-1].endKm) return blocks[blocks.length-1];
    return blocks[0] || null;
  }

  function updateBlockPanel(km, paceSec){
    var b = currentBlock(km);
    var panel = document.getElementById('blockNow');
    var nameEl = document.getElementById('blockName');
    var targetsEl = document.getElementById('blockTargets');
    if(!b){
      nameEl.textContent = 'Nenhum treino iniciado';
      targetsEl.textContent = '—';
      panel.className = 'block-now';
      return;
    }
    nameEl.textContent = b.label + '  ·  km ' + b.startKm + '–' + b.endKm;
    var tgtSec = paceToSec(b.paceTarget);
    targetsEl.textContent = 'alvo ' + (b.paceTarget||'—') + '/km' + (b.hrCeil ? '  ·  teto FC ' + b.hrCeil : '');

    var cls = '';
    if(paceSec != null && tgtSec != null){
      if(paceSec <= tgtSec + 5) cls = 'good'; else if(paceSec <= tgtSec + 15) cls = 'warn'; else cls = 'bad';
    }
    if(b.hrCeil && hrValue != null && hrValue > b.hrCeil) cls = 'bad';
    panel.className = 'block-now' + (cls ? ' '+cls : '');
    return b;
  }

  function computeCurrentPace(){
    if(recentFixes.length < 2) return null;
    var now = recentFixes[recentFixes.length-1];
    var windowStart = null;
    for(var i=recentFixes.length-1;i>=0;i--){
      if(now.t - recentFixes[i].t > 40000){ windowStart = recentFixes[i+1] || recentFixes[i]; break; }
      windowStart = recentFixes[i];
    }
    if(!windowStart || windowStart===now) return null;
    var d = haversine(windowStart, now);
    var dt = (now.t - windowStart.t)/1000;
    if(d < 15 || dt < 5) return null;
    return dt / (d/1000);
  }

  function onPosition(pos){
    var c = pos.coords;
    var fix = { lat:c.latitude, lon:c.longitude, t:pos.timestamp || Date.now(), acc:c.accuracy };
    if(c.accuracy != null && c.accuracy > 30) return;

    if(lastGoodFix){
      var d = haversine(lastGoodFix, fix);
      var dt = (fix.t - lastGoodFix.t)/1000;
      var impliedPace = dt>0 ? dt/(d/1000) : 9999;
      if(d > 2 && impliedPace > 140){
        totalDistanceM += d;
        lastGoodFix = fix;
        recentFixes.push(fix);
        if(recentFixes.length > 60) recentFixes.shift();
      }
    } else {
      lastGoodFix = fix;
      recentFixes.push(fix);
    }

    var km = totalDistanceM/1000;
    document.getElementById('distVal').textContent = km.toFixed(2);
    var paceSec = computeCurrentPace();
    document.getElementById('paceVal').textContent = paceSec ? secToPace(paceSec) : '—';
    var b = updateBlockPanel(km, paceSec);
    renderBlocks(km, true);

    maybeAnnounce(km, paceSec, b);
    maybeHrAlert(b);
  }

  function maybeAnnounce(km, paceSec, b){
    var interval = parseInt(document.getElementById('intervalSel').value, 10);
    var meters = km*1000;
    if(meters - lastAnnouncedM < interval) return;
    lastAnnouncedM = meters;
    if(!b) return;
    var tgtSec = paceToSec(b.paceTarget);
    var parts = [];
    parts.push(km.toFixed(1).replace('.', ',') + ' quilômetros.');
    parts.push('Bloco ' + b.label + '.');
    if(paceSec){
      parts.push('Pace ' + secToPace(paceSec).replace(':',' e ') + ' por quilômetro.');
      if(tgtSec){
        var diff = Math.round(paceSec - tgtSec);
        if(diff > 8) parts.push('Acima do alvo por ' + diff + ' segundos. Acelera um pouco.');
        else if(diff < -8) parts.push('Abaixo do alvo. Segura, ainda falta treino.');
        else parts.push('Dentro do alvo.');
      }
    }
    if(b.hrCeil && hrValue != null){
      parts.push('Frequência cardíaca ' + hrValue + '.');
      if(hrValue > b.hrCeil) parts.push('Acima do teto de ' + b.hrCeil + '. Desacelere.');
    }
    speak(parts.join(' '));
  }

  function maybeHrAlert(b){
    if(!b || !b.hrCeil || hrValue==null) return;
    var now = Date.now();
    if(hrValue > b.hrCeil + 5 && now - lastHrAlertAt > 45000){
      lastHrAlertAt = now;
      speak('Atenção. Frequência cardíaca ' + hrValue + ', acima do teto. Desacelere agora.');
    }
  }

  function tickClock(){
    if(!startTime) return;
    var elapsed = (Date.now() - startTime - pausedAccum)/1000;
    document.getElementById('clock').textContent = fmtClock(elapsed);
  }

  function setStatus(text, on){
    statusText.textContent = text;
    statusPill.className = 'status-pill' + (on ? ' on' : '');
    statusPill.querySelector('.dot').className = 'dot' + (on ? ' pulse' : '');
    livecard.className = 'livecard' + (on ? ' running' : '');
  }

  async function start(){
    if(!('geolocation' in navigator)){
      statusMsg('Este navegador não tem GPS disponível.', true);
      return;
    }
    speak('Treino iniciado.');
    try{
      if('wakeLock' in navigator){
        wakeLock = await navigator.wakeLock.request('screen');
      }
    }catch(e){}

    running = true; paused = false;
    startTime = Date.now(); pausedAccum = 0;
    totalDistanceM = 0; recentFixes = []; lastGoodFix = null; lastAnnouncedM = 0;
    setStatus('Correndo', true);
    statusMsg('GPS ativo. Mantenha a aba aberta e a tela ligada.');
    startBtn.disabled = true; pauseBtn.disabled = false; stopBtn.disabled = false;
    renderBlocks(0, true);

    watchId = navigator.geolocation.watchPosition(onPosition, function(err){
      statusMsg('Erro de GPS: ' + err.message, true);
    }, { enableHighAccuracy:true, maximumAge:1000, timeout:15000 });

    clockTimer = setInterval(tickClock, 1000);
  }

  function pause(){
    if(!running) return;
    if(!paused){
      paused = true; pauseStarted = Date.now();
      if(watchId!=null) navigator.geolocation.clearWatch(watchId);
      pauseBtn.textContent = 'Retomar';
      setStatus('Pausado', false);
      speak('Pausado.');
    } else {
      paused = false;
      pausedAccum += Date.now() - pauseStarted;
      watchId = navigator.geolocation.watchPosition(onPosition, function(err){
        statusMsg('Erro de GPS: ' + err.message, true);
      }, { enableHighAccuracy:true, maximumAge:1000, timeout:15000 });
      pauseBtn.textContent = 'Pausar';
      setStatus('Correndo', true);
      speak('Retomado.');
    }
  }

  function stop(){
    running = false; paused = false;
    if(watchId!=null){ navigator.geolocation.clearWatch(watchId); watchId=null; }
    if(clockTimer){ clearInterval(clockTimer); clockTimer=null; }
    if(wakeLock){ try{ wakeLock.release(); }catch(e){} wakeLock=null; }
    setStatus('Parado', false);
    var km = totalDistanceM/1000;
    var elapsed = startTime ? (Date.now()-startTime-pausedAccum)/1000 : 0;
    statusMsg('Treino encerrado: ' + km.toFixed(2) + ' km em ' + fmtClock(elapsed) + '.');
    speak('Treino encerrado. ' + km.toFixed(1).replace('.',',') + ' quilômetros.');
    startBtn.disabled = false; pauseBtn.disabled = true; stopBtn.disabled = true;
    pauseBtn.textContent = 'Pausar';
    renderBlocks(null, false);
  }

  startBtn.addEventListener('click', start);
  pauseBtn.addEventListener('click', pause);
  stopBtn.addEventListener('click', stop);

  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'visible' && running && !paused && 'wakeLock' in navigator && !wakeLock){
      navigator.wakeLock.request('screen').then(function(wl){ wakeLock = wl; }).catch(function(){});
    }
  });
})();
</script>
</body>
</html>`;
}

module.exports = { coachPage };
