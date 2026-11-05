// Tela "Correr com o Professor": antes, durante e depois do treino, por voz.
// Documento próprio (tela cheia, escuro), como o Professor ao vivo. As regras ficam em
// lib/run_engine.js e a ligação com sensores/voz em lib/run_client.js (inlinados aqui).
const fs = require('node:fs');
const path = require('node:path');
const { esc, fmtDate } = require('./lib/format');

const ENGINE_JS = fs.readFileSync(path.join(__dirname, 'lib', 'run_engine.js'), 'utf8');
const CLIENT_JS = fs.readFileSync(path.join(__dirname, 'lib', 'run_client.js'), 'utf8');

function runPage(user, opts) {
  opts = opts || {};
  const races = (opts.races || []).map((r) => ({
    id: r.id, name: r.name, date: r.race_date || null, distance_km: r.distance_km || null,
    goal_time_sec: r.goal_time_sec || null, has_course: !!r.has_course,
  }));
  const pre = parseInt((opts.query || {}).race, 10) || null;
  const cfg = {
    voiceEnabled: !!opts.voiceEnabled, zoneBounds: opts.zoneBounds || null, maxHr: opts.maxHr || null, races,
    preRace: pre && races.some((r) => r.id === pre) ? pre : null,
  };
  const cfgJson = JSON.stringify(cfg).replace(/</g, '\\u003c');
  const raceOptions = '<option value="">Sem prova (treino do dia)</option>' + races.map((r) =>
    `<option value="${r.id}">${esc(r.name)}${r.date ? ' · ' + esc(fmtDate(r.date)) : ''}${r.has_course ? ' · com percurso' : ''}</option>`).join('');
  const firstName = esc((user.name || '').split(' ')[0] || 'atleta');
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Correr · Runiqx</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0B0D10">
<style>
  :root{ --bg:#0B0D10; --card:#15181D; --line:rgba(255,255,255,.11); --ink:#F6F7F5; --dim:#9BA1A8; --faint:#6A7078; --gold:#FFC24E; --blue:#4E9BFF; --green:#6FD46A; --red:#FF6B6B; --amber:#FFB454; }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:var(--bg);color:var(--ink);font-family:-apple-system,'Archivo','Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}
  body{min-height:100dvh;padding:max(16px,env(safe-area-inset-top)) 16px max(20px,env(safe-area-inset-bottom));background:radial-gradient(900px 600px at 15% -10%,rgba(255,194,78,.14),transparent 60%),radial-gradient(800px 700px at 90% 110%,rgba(78,155,255,.12),transparent 60%),var(--bg)}
  main{max-width:520px;margin:0 auto}
  [hidden]{display:none !important}
  .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
  .brand{font:700 15px/1 ui-monospace,'IBM Plex Mono',monospace;letter-spacing:.2em}
  .top a{color:var(--faint);font:600 12px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;text-decoration:none}
  h1{font-size:26px;line-height:1.1;margin:6px 0 4px;font-weight:800}
  .muted{color:var(--dim);font-size:14px;line-height:1.45}
  .card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;margin-top:14px}
  .lbl{font:600 11px ui-monospace,monospace;letter-spacing:.1em;color:var(--faint);text-transform:uppercase;margin-bottom:8px;display:block}
  .chips{display:flex;flex-wrap:wrap;gap:8px}
  .chips button{background:transparent;border:1px solid var(--line);color:var(--dim);border-radius:999px;padding:10px 14px;font:600 14px inherit;cursor:pointer}
  .chips button.on{background:rgba(255,194,78,.14);border-color:rgba(255,194,78,.6);color:var(--gold)}
  select,input[type=text]{width:100%;background:#0f1215;border:1px solid var(--line);color:var(--ink);border-radius:12px;padding:12px;font-size:16px}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .btn{display:block;width:100%;background:var(--gold);color:#1a1205;border:0;border-radius:14px;padding:16px;font:800 16px inherit;letter-spacing:.02em;cursor:pointer;text-align:center;text-decoration:none}
  .btn.small{display:inline-block;width:auto;padding:10px 16px;font-size:14px}
  .btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
  .btn.warn{background:var(--red);color:#fff}
  .btn.big{padding:20px;font-size:19px}
  .pill{display:inline-flex;align-items:center;gap:8px;font:600 12px ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}
  .pill:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--faint)}
  .pill.on:before,.pill.speaking:before{background:var(--green);box-shadow:0 0 8px var(--green)}
  .pill.listening:before{background:var(--blue);box-shadow:0 0 8px var(--blue)}
  .pill.connecting:before{background:var(--gold)}
  .dev{display:block;width:100%;text-align:left;margin-top:8px;background:#0f1215;border:1px solid var(--line);color:var(--ink);padding:12px;border-radius:12px;font-size:15px}
  .said{font-size:15px;line-height:1.45;color:var(--ink);min-height:44px;margin-top:10px}
  .said:empty:before{content:"O Professor aparece aqui quando falar.";color:var(--faint)}
  #profile svg,#profile2 svg{width:100%;height:60px;display:block}
  .pwrap{position:relative}
  .pmark{position:absolute;top:0;bottom:0;width:2px;background:var(--ink);box-shadow:0 0 8px #fff;left:0;transition:left .8s linear}
  .big4{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-top:12px}
  .metric{min-width:0;overflow:hidden;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px 16px}
  .metric .k{font:600 11px ui-monospace,monospace;letter-spacing:.1em;color:var(--faint);text-transform:uppercase}
  .metric .v{font:900 44px/1.05 'Archivo Black',-apple-system,sans-serif;margin-top:4px;font-variant-numeric:tabular-nums}
  .metric .u{font:600 16px inherit;color:var(--dim);margin-left:3px}
  .metric.hero .v{font-size:40px}
  #hrbox[data-z="1"] .v{color:#6AA8FF}#hrbox[data-z="2"] .v{color:#5DD39E}#hrbox[data-z="3"] .v{color:#FFD166}#hrbox[data-z="4"] .v{color:#FF9F43}#hrbox[data-z="5"] .v{color:#FF5D5D}
  .banner{border-radius:14px;padding:12px 14px;font-weight:700;font-size:15px;margin-top:12px}
  #next{background:rgba(255,107,107,.14);border:1px solid rgba(255,107,107,.5);color:#ffb4b4}
  #next[data-k="down"]{background:rgba(78,155,255,.14);border-color:rgba(78,155,255,.5);color:#b6d3ff}
  #flash{background:rgba(255,194,78,.16);border:1px solid rgba(255,194,78,.6);color:var(--gold)}
  #flash[data-k="seguranca"],#flash[data-k="batimentos"]{background:rgba(255,107,107,.18);border-color:rgba(255,107,107,.6);color:#ffb4b4}
  .ctl{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
  .ctl .full{grid-column:1/-1}
  #dbg{white-space:pre-wrap;font:11px/1.4 ui-monospace,monospace;color:var(--dim);background:#0f1215;border:1px solid var(--line);border-radius:10px;padding:8px;margin-top:12px;max-height:220px;overflow:auto}
  a{color:var(--gold)}
  .hint{font-size:12.5px;color:var(--faint);margin-top:8px;line-height:1.4}
</style>
</head>
<body>
<main>
  <div class="top"><span class="brand">RUNIQX</span><a href="/">Sair</a></div>

  <!-- ANTES -->
  <section id="setup">
    <h1>Correr com o Professor</h1>
    <p class="muted">${firstName}, ele conversa com você antes, durante e depois do treino: batimentos, pace e altimetria.</p>

    <div id="recover" class="card" hidden>
      <b id="recinfo"></b>
      <div class="row" style="margin-top:10px"><button class="btn small" id="recsave" type="button">Salvar esse treino</button><button class="btn small ghost" id="recdrop" type="button">Descartar</button></div>
    </div>

    <div class="card">
      <span class="lbl">Treino de hoje</span>
      <div class="chips">
        <button type="button" data-type="leve">Rodagem leve</button>
        <button type="button" data-type="longao">Longão</button>
        <button type="button" data-type="ritmo">Ritmo de prova</button>
        <button type="button" data-type="tiros">Tiros</button>
        <button type="button" data-type="livre">Livre</button>
      </div>
      <span class="lbl" style="margin-top:14px">Prova</span>
      <select id="race">${raceOptions}</select>
      <p class="hint" id="coursehint"></p>
      <div id="profile" hidden style="margin-top:10px"><div class="pwrap"><svg id="profsvg" viewBox="0 0 300 60" preserveAspectRatio="none"></svg><span class="pmark" id="pmark"></span></div><p class="hint" id="proftxt"></p></div>
      <div class="row" style="margin-top:14px">
        <div><span class="lbl">Pace alvo (min/km)</span><input id="pace" type="text" inputmode="numeric" placeholder="5:30"></div>
        <div><span class="lbl">Batimentos até</span><input id="hrc" type="text" inputmode="numeric" placeholder="150"></div>
      </div>
    </div>

    <div class="card">
      <span class="lbl">Batimentos</span>
      <div class="row">
        <button class="btn ghost small" id="bble" type="button">Cinta / sensor Bluetooth</button>
        <button class="btn ghost small" id="bhealth" type="button">Apple Watch</button>
      </div>
      <div id="devices"></div>
      <p class="hint" id="hrstate">Garmin, Polar, Coros, Wahoo e outras cintas e braçadeiras com Bluetooth padrão funcionam direto. No Apple Watch, comece um treino de corrida no relógio.</p>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center"><span class="pill off" id="vpill"><span id="vstate">Professor desligado</span></span><button class="btn small ghost" id="vmute" type="button" hidden>Silenciar microfone</button></div>
      <p class="said" id="said"></p>
      <button class="btn" id="vbtn" type="button" style="margin-top:12px">Chamar o Professor</button>
      <p class="hint" id="vnote">Fone de ouvido recomendado. Ele fala primeiro e você responde normalmente.</p>
    </div>

    <button class="btn big" id="bstart" type="button" style="margin-top:16px">COMEÇAR CORRIDA</button>
    <p class="hint" style="text-align:center">Mantenha o app aberto e o GPS ligado. Sem internet o treino continua gravando e o Professor volta quando o sinal voltar.</p>
  </section>

  <!-- DURANTE -->
  <section id="live" hidden>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div><b id="l-type"></b><div class="muted" id="l-goal" style="font-size:13px"></div></div>
      <div style="text-align:right"><span class="pill off" id="vpill2"></span><div class="hint" id="gps" style="margin:0">GPS…</div></div>
    </div>
    <div class="big4">
      <div class="metric hero"><div class="k">Tempo</div><div class="v" id="m-time">0:00</div></div>
      <div class="metric hero"><div class="k">Distância</div><div class="v"><span id="m-dist">0,00</span><span class="u">km</span></div></div>
      <div class="metric"><div class="k">Pace atual</div><div class="v" id="m-pace">--:--</div></div>
      <div class="metric" id="hrbox"><div class="k">Batimentos <span id="m-zone" style="text-transform:none;letter-spacing:0"></span></div><div class="v" id="m-hr">--</div></div>
    </div>
    <div class="metric" style="margin-top:10px"><div class="k">Pace médio</div><div class="v" id="m-avg" style="font-size:36px">--:--</div></div>
    <div id="flash" class="banner" hidden></div>
    <div id="next" class="banner" hidden></div>
    <div id="prof2" class="card" hidden><div class="pwrap"><svg id="profsvg2" viewBox="0 0 300 60" preserveAspectRatio="none"></svg><span class="pmark" id="pmark2"></span></div><p class="hint" id="proftxt2"></p></div>
    <p class="said" id="said2"></p>
    <div class="ctl">
      <button class="btn ghost" id="bpause" type="button">Pausar</button>
      <button class="btn ghost" id="bquiet" type="button">Só parciais</button>
      <button class="btn ghost full" id="vmute2" type="button" hidden>Microfone ligado</button>
      <button class="btn full" id="bfinish" type="button">Finalizar</button>
    </div>
    <pre id="dbg" hidden></pre>
  </section>

  <!-- DEPOIS -->
  <section id="done" hidden>
    <h1>Treino concluído</h1>
    <div class="card" id="doneBody"></div>
    <div class="card">
      <span class="pill off" id="vpill3"></span>
      <p class="said" id="said3"></p>
      <p class="hint">O Professor comenta o treino e você pode conversar. Quando terminar, toque em Encerrar.</p>
    </div>
    <button class="btn" id="bend" type="button" style="margin-top:14px">Encerrar</button>
  </section>
</main>
<script>window.__RUN_CFG__=${cfgJson};</script>
<script>${ENGINE_JS}</script>
<script>${CLIENT_JS}</script>
</body>
</html>`;
}

module.exports = { runPage };
