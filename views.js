const { secToPace, fmtClock, fmtDate, esc, renderMarkdownLite, icon } = require('./lib/format');
const { summarizeIntervals } = require('./lib/intervals');
const { estimateVO2max } = require('./lib/stats');

// Runs site-wide: fades cards in as they scroll into view and adds a subtle
// pointer-tilt to cards on hover. Pure progressive enhancement — cards are
// visible by default in the CSS, this only adds motion when JS/IO is
// available, and it no-ops entirely under prefers-reduced-motion.
const MICRO_INTERACTIONS_SCRIPT = `<script defer>
(function(){
  try {
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var items = document.querySelectorAll('.card, .reveal');
    if (!reduced && 'IntersectionObserver' in window && items.length) {
      items.forEach(function(el){
        var r = el.getBoundingClientRect();
        if (r.top > window.innerHeight * 0.85) {
          el.style.opacity = '0';
          el.style.transform = 'translateY(16px)';
        }
      });
      var io = new IntersectionObserver(function(entries){
        entries.forEach(function(e){
          if (e.isIntersecting) {
            e.target.style.opacity = '';
            e.target.style.transform = '';
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.1 });
      items.forEach(function(el){ io.observe(el); });
    }
    if (!reduced && window.matchMedia && window.matchMedia('(hover: hover)').matches) {
      // Only tilt cards that are purely decorative (stat tiles). A card
      // holding links/forms/buttons/<details> must never get a 3D transform
      // on mousemove: shifting the whole box under the cursor makes its
      // contents effectively unclickable (the target keeps moving away from
      // the pointer), which is exactly the "não deixa eu clicar" bug.
      document.querySelectorAll('.card').forEach(function(card){
        if (card.querySelector('a, button, form, details, input, select, textarea')) return;
        card.addEventListener('mousemove', function(e){
          var r = card.getBoundingClientRect();
          var x = (e.clientX - r.left) / r.width - 0.5;
          var y = (e.clientY - r.top) / r.height - 0.5;
          card.style.transform = 'perspective(700px) rotateX(' + (y * -3) + 'deg) rotateY(' + (x * 3) + 'deg) translateY(-2px)';
        });
        card.addEventListener('mouseleave', function(){ card.style.transform = ''; });
      });
    }
    // Km-split tooltips: CSS :hover already shows them with a mouse, but a
    // touch tap never triggers :hover reliably, so give each bar a tap
    // toggle too — one bar's card open at a time, closed by tapping
    // elsewhere. Works alongside hover rather than replacing it.
    var splitBars = document.querySelectorAll('.bar-km');
    if (splitBars.length) {
      splitBars.forEach(function(bar){
        bar.addEventListener('click', function(e){
          e.stopPropagation();
          var wasOpen = bar.classList.contains('show-tip');
          splitBars.forEach(function(b){ b.classList.remove('show-tip'); });
          if (!wasOpen) bar.classList.add('show-tip');
        });
      });
      document.addEventListener('click', function(){
        splitBars.forEach(function(b){ b.classList.remove('show-tip'); });
      });
    }
  } catch (e) { console.error('[dbg]', e); }
})();
</script>`;

// ---------- Coach de Corrida — shared chat client ----------
// One mount() function used by both the full chat page (/assistant) and the
// floating widget present on every other screen, so the streaming/typing
// logic only lives in one place. Plain text streaming (no SSE parsing
// needed client-side): the server relays chunked plain text and this just
// appends each piece as it arrives, giving the "digitando" effect.
const COACH_CHAT_SCRIPT = `<script defer>
(function(){
function bubble(container, role){
  var el = document.createElement('div');
  el.className = 'chat-msg ' + role;
  container.appendChild(el);
  return el;
}
function typingDots(){
  var t = document.createElement('span');
  t.className = 'chat-typing';
  t.innerHTML = '<span></span><span></span><span></span>';
  return t;
}
function mount(opts){
  var msgsEl = document.getElementById(opts.msgsId);
  var formEl = document.getElementById(opts.formId);
  var inputEl = document.getElementById(opts.inputId);
  if (!msgsEl || !formEl || !inputEl) return;
  var aiEnabled = !!opts.aiEnabled;
  var sending = false;

  function scrollBottom(){ msgsEl.scrollTop = msgsEl.scrollHeight; }

  function clearEmpty(){
    var e = msgsEl.querySelector('.chat-empty');
    if (e) e.remove();
  }

  function renderInitial(messages){
    msgsEl.innerHTML = '';
    if (!messages || !messages.length) {
      var empty = document.createElement('p');
      empty.className = 'chat-empty';
      empty.textContent = opts.emptyText || 'Nenhuma mensagem ainda. Pergunte algo sobre seus treinos.';
      msgsEl.appendChild(empty);
      return;
    }
    messages.forEach(function(m){
      var b = bubble(msgsEl, m.role === 'user' ? 'user' : 'assistant');
      b.textContent = m.content;
    });
    scrollBottom();
  }

  async function send(text){
    if (sending || !text.trim()) return;
    if (!aiEnabled) {
      clearEmpty();
      var warn = bubble(msgsEl, 'assistant');
      warn.textContent = 'Cadastre sua chave da API da Anthropic em Config para conversar com o coach.';
      scrollBottom();
      return;
    }
    sending = true;
    clearEmpty();
    var userB = bubble(msgsEl, 'user');
    userB.textContent = text;
    var replyB = bubble(msgsEl, 'assistant');
    replyB.appendChild(typingDots());
    scrollBottom();

    var submitBtn = formEl.querySelector('button[type=submit]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      var res = await fetch('/api/coach/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, activity_id: opts.activityId || null }),
      });
      if (!res.ok || !res.body) {
        replyB.textContent = res.status === 412
          ? 'Cadastre sua chave da API da Anthropic em Config para conversar com o coach.'
          : 'Não consegui responder agora. Tenta de novo?';
      } else {
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var started = false;
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          var piece = decoder.decode(chunk.value, { stream: true });
          if (!piece) continue;
          if (!started) { replyB.textContent = ''; started = true; }
          replyB.textContent += piece;
          scrollBottom();
        }
        if (!started) replyB.textContent = '(sem resposta)';
      }
    } catch (e) {
      replyB.textContent = 'Não consegui responder agora. Verifique sua conexão.';
    } finally {
      sending = false;
      if (submitBtn) submitBtn.disabled = false;
      scrollBottom();
    }
  }

  formEl.addEventListener('submit', function(e){
    e.preventDefault();
    var text = inputEl.value;
    if (!text.trim()) return;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    send(text);
  });
  inputEl.addEventListener('keydown', function(e){
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (formEl.requestSubmit) formEl.requestSubmit();
      else formEl.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
  inputEl.addEventListener('input', function(){
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
  });

  if (opts.initialMessages) {
    renderInitial(opts.initialMessages);
  } else if (opts.historyUrl) {
    fetch(opts.historyUrl).then(function(r){ return r.ok ? r.json() : { messages: [] }; }).then(function(data){
      aiEnabled = !!data.aiEnabled;
      renderInitial(data.messages || []);
    }).catch(function(){ renderInitial([]); });
  } else {
    renderInitial([]);
  }
}
window.CoachChat = { mount: mount };
})();
</script>`;

function coachWidgetHtml(user) {
  return `<div class="coach-widget" id="coachWidget">
<button class="coach-launcher" id="coachLauncher" type="button" aria-label="Abrir Coach de Corrida">
<span class="coach-launcher-glow"></span>
${icon('shoe', 'launcher')}
</button>
<div class="coach-panel" id="coachPanel">
<div class="coach-panel-head">
<div class="coach-panel-title"><span class="h-icon">${icon('heart', 'cw')}</span>Coach de Corrida</div>
<button class="coach-panel-close" id="coachPanelClose" type="button" aria-label="Fechar">&times;</button>
</div>
<div class="coach-panel-body" id="coachWidgetMsgs"></div>
<form class="coach-panel-form" id="coachWidgetForm">
<textarea id="coachWidgetInput" placeholder="Fale com o coach..." rows="1"></textarea>
<button type="submit" aria-label="Enviar">${icon('flame', 'send')}</button>
</form>
</div>
</div>`;
}

const COACH_WIDGET_SCRIPT = `<script defer>
(function(){
function ready(fn){ if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
ready(function(){
  var widget = document.getElementById('coachWidget');
  if (!widget) return;
  var launcher = document.getElementById('coachLauncher');
  var panel = document.getElementById('coachPanel');
  var closeBtn = document.getElementById('coachPanelClose');
  var mounted = false;

  function open(){
    panel.classList.add('open');
    launcher.classList.add('active');
    if (!mounted && window.CoachChat) {
      mounted = true;
      window.CoachChat.mount({
        msgsId: 'coachWidgetMsgs',
        formId: 'coachWidgetForm',
        inputId: 'coachWidgetInput',
        historyUrl: '/api/coach/history',
        emptyText: 'Fala comigo! Pergunte sobre seus treinos, sua evolução ou sua próxima prova.',
      });
    }
  }
  function close(){
    panel.classList.remove('open');
    launcher.classList.remove('active');
  }
  launcher.addEventListener('click', function(){
    if (panel.classList.contains('open')) close(); else open();
  });
  closeBtn.addEventListener('click', close);
});
})();
</script>`;

const NOTIF_SCRIPT = `<script defer>
(function(){
function ready(fn){ if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
ready(function(){
  var bell = document.getElementById('notifBell');
  var panel = document.getElementById('notifPanel');
  var badge = document.getElementById('notifBadge');
  var list = document.getElementById('notifList');
  if (!bell || !panel || !list) return;
  var loaded = false;

  function timeAgo(iso){
    var d = new Date(iso.replace(' ', 'T') + 'Z');
    var diff = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (diff < 60) return 'agora';
    if (diff < 3600) return Math.floor(diff/60) + 'min';
    if (diff < 86400) return Math.floor(diff/3600) + 'h';
    return Math.floor(diff/86400) + 'd';
  }

  function render(data){
    if (!data.notifications || !data.notifications.length) {
      list.innerHTML = '<p class="muted" style="margin:10px 14px;">Nenhuma notificação ainda.</p>';
      return;
    }
    list.innerHTML = data.notifications.map(function(n){
      var text = n.type === 'kudos' ? (n.actor_name + ' curtiu seu post') : (n.actor_name + ' comentou no seu post');
      return '<a class="notif-item' + (n.read_at ? '' : ' unread') + '" href="/feed">' +
        '<span class="notif-text">' + text + '</span>' +
        '<span class="notif-time">' + timeAgo(n.created_at) + '</span></a>';
    }).join('');
  }

  function refresh(){
    fetch('/api/notifications').then(function(r){ return r.ok ? r.json() : null; }).then(function(data){
      if (!data) return;
      if (data.unread > 0) { badge.hidden = false; badge.textContent = data.unread > 9 ? '9+' : String(data.unread); }
      else { badge.hidden = true; }
      if (loaded) render(data);
      else window._notifData = data;
    }).catch(function(){});
  }

  bell.addEventListener('click', function(){
    var open = panel.classList.toggle('open');
    if (open) {
      if (window._notifData) { render(window._notifData); loaded = true; }
      if (!badge.hidden) {
        badge.hidden = true;
        fetch('/api/notifications/read', { method: 'POST' }).catch(function(){});
      }
    }
  });
  document.addEventListener('click', function(e){
    if (!panel.contains(e.target) && !bell.contains(e.target)) panel.classList.remove('open');
  });

  refresh();
  setInterval(refresh, 60000);
});
})();
</script>`;

function layout({ title, user, body, active, extraHead, bodyEnd, hideCoachWidget }) {
  const nav = user
    ? `<nav class="nav">
        <a class="brand" href="/">Atletas</a>
        <div class="links">
          <a class="link ${active === 'home' ? 'active' : ''}" href="/">Perfil</a>
          <a class="link ${active === 'races' ? 'active' : ''}" href="/races">Provas</a>
          <a class="link ${active === 'activities' ? 'active' : ''}" href="/activities">Treinos</a>
          <a class="link ${active === 'feed' ? 'active' : ''}" href="/feed">Feed</a>
          <a class="link ${active === 'assistant' ? 'active' : ''}" href="/assistant">Coach IA</a>
          <a class="link ${active === 'coach' ? 'active' : ''}" href="/coach">Coach ao vivo</a>
          <a class="link ${active === 'settings' ? 'active' : ''}" href="/settings">Config</a>
          <div class="notif-wrap" id="notifWrap">
            <button class="notif-bell" id="notifBell" type="button" aria-label="Notificações">
              ${icon('bell', 'nb')}
              <span class="notif-badge" id="notifBadge" hidden>0</span>
            </button>
            <div class="notif-panel" id="notifPanel">
              <div class="notif-panel-head">Notificações</div>
              <div class="notif-list" id="notifList"><p class="muted" style="margin:10px 14px;">Carregando…</p></div>
            </div>
          </div>
          <a class="link" href="/logout">Sair</a>
        </div>
      </nav>`
    : `<nav class="nav"><a class="brand" href="/">Atletas</a></nav>`;

  const showWidget = !!user && !hideCoachWidget;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Atletas</title>
<link rel="stylesheet" href="/style.css">
${extraHead || ''}
</head>
<body>
${nav}
<div class="wrap">
${body}
</div>
${showWidget ? coachWidgetHtml(user) : ''}
${MICRO_INTERACTIONS_SCRIPT}
${COACH_CHAT_SCRIPT}
${showWidget ? COACH_WIDGET_SCRIPT : ''}
${user ? NOTIF_SCRIPT : ''}
${bodyEnd || ''}
</body>
</html>`;
}

function authLayout(title, body) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Atletas</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="auth-box">
<div class="center-logo">Atletas</div>
${body}
</div>
</body>
</html>`;
}

function loginPage(error) {
  return authLayout('Entrar', `
${error ? `<div class="err">${esc(error)}</div>` : ''}
<form method="POST" action="/login">
  <label>E-mail</label>
  <input type="email" name="email" required autofocus>
  <label>Senha</label>
  <input type="password" name="password" required>
  <div style="margin-top:20px"><button type="submit" style="width:100%">Entrar</button></div>
</form>
<p class="muted" style="text-align:center; margin-top:18px;">Não tem conta? <a href="/signup">Criar conta</a></p>
`);
}

function signupPage(error) {
  return authLayout('Criar conta', `
${error ? `<div class="err">${esc(error)}</div>` : ''}
<form method="POST" action="/signup">
  <label>Nome</label>
  <input type="text" name="name" required autofocus>
  <label>E-mail</label>
  <input type="email" name="email" required>
  <label>Senha</label>
  <input type="password" name="password" required minlength="6">
  <div style="margin-top:20px"><button type="submit" style="width:100%">Criar conta</button></div>
</form>
<p class="muted" style="text-align:center; margin-top:18px;">Já tem conta? <a href="/login">Entrar</a></p>
`);
}

// Stylized "runner" hero animation — a procedural stick-figure rig built
// from nested SVG <g> groups, each limb segment animated with SMIL
// <animateTransform> rotations (no JS/canvas/WebGL needed, works even with
// scripts disabled). `variant` picks one of three stacked copies: the bright
// foreground runner plus two faded, blurred, offset "echoes" behind it,
// which — combined with the CSS translateX loop on their shared wrapper —
// read as a stroboscopic motion trail, like a sports-poster speed shot.
function heroRunnerRig(variant) {
  const stagger = { main: 0, echo1: 0.09, echo2: 0.18 }[variant];
  const a = `-${(0.4 + stagger).toFixed(2)}s`; // back leg / front arm phase
  const b = stagger ? `-${stagger.toFixed(2)}s` : '0s'; // back arm / front leg / bob phase
  return `<svg class="hero-rig ${variant}" viewBox="0 0 220 260" width="190" height="224" aria-hidden="true">
  <g transform="translate(110,190)">
    <g>
      <animateTransform attributeName="transform" type="translate" values="0 0;0 -7;0 0" keyTimes="0;0.5;1" dur="0.4s" begin="${b}" repeatCount="indefinite"/>
      <g>
        <animateTransform attributeName="transform" type="rotate" values="35 0 0;-5 0 0;-35 0 0;20 0 0;35 0 0" keyTimes="0;0.25;0.5;0.75;1" dur="0.8s" begin="${a}" repeatCount="indefinite"/>
        <line x1="0" y1="0" x2="0" y2="34" stroke-width="6" class="limbline"></line>
        <g transform="translate(0,34)"><g>
          <animateTransform attributeName="transform" type="rotate" values="-10 0 0;5 0 0;0 0 0;-75 0 0;-10 0 0" keyTimes="0;0.25;0.5;0.75;1" dur="0.8s" begin="${a}" repeatCount="indefinite"/>
          <line x1="0" y1="0" x2="0" y2="32" stroke-width="5" class="limbline"></line>
        </g></g>
      </g>
      <g transform="translate(3,-55)"><g>
        <animateTransform attributeName="transform" type="rotate" values="30 0 0;0 0 0;-30 0 0;5 0 0;30 0 0" keyTimes="0;0.25;0.5;0.75;1" dur="0.8s" begin="${b}" repeatCount="indefinite"/>
        <line x1="0" y1="0" x2="0" y2="26" stroke-width="4" class="limbline"></line>
        <g transform="translate(0,26)"><g>
          <animateTransform attributeName="transform" type="rotate" values="70 0 0;60 0 0;70 0 0;85 0 0;70 0 0" keyTimes="0;0.25;0.5;0.75;1" dur="0.8s" begin="${b}" repeatCount="indefinite"/>
          <line x1="0" y1="0" x2="0" y2="22" stroke-width="4" class="limbline"></line>
        </g></g>
      </g></g>
      <line x1="0" y1="0" x2="6" y2="-58" stroke-width="6" class="limbline"></line>
      <circle class="head" cx="9" cy="-73" r="10"></circle>
      <g transform="translate(3,-55)"><g>
        <animateTransform attributeName="transform" type="rotate" values="30 0 0;0 0 0;-30 0 0;5 0 0;30 0 0" keyTimes="0;0.25;0.5;0.75;1" dur="0.8s" begin="${a}" repeatCount="indefinite"/>
        <line x1="0" y1="0" x2="0" y2="26" stroke-width="4" class="limbline"></line>
        <g transform="translate(0,26)"><g>
          <animateTransform attributeName="transform" type="rotate" values="70 0 0;60 0 0;70 0 0;85 0 0;70 0 0" keyTimes="0;0.25;0.5;0.75;1" dur="0.8s" begin="${a}" repeatCount="indefinite"/>
          <line x1="0" y1="0" x2="0" y2="22" stroke-width="4" class="limbline"></line>
        </g></g>
      </g></g>
      <g>
        <animateTransform attributeName="transform" type="rotate" values="35 0 0;-5 0 0;-35 0 0;20 0 0;35 0 0" keyTimes="0;0.25;0.5;0.75;1" dur="0.8s" begin="${b}" repeatCount="indefinite"/>
        <line x1="0" y1="0" x2="0" y2="34" stroke-width="6" class="limbline"></line>
        <g transform="translate(0,34)"><g>
          <animateTransform attributeName="transform" type="rotate" values="-10 0 0;5 0 0;0 0 0;-75 0 0;-10 0 0" keyTimes="0;0.25;0.5;0.75;1" dur="0.8s" begin="${b}" repeatCount="indefinite"/>
          <line x1="0" y1="0" x2="0" y2="32" stroke-width="5" class="limbline"></line>
        </g></g>
      </g>
    </g>
  </g>
</svg>`;
}

const HERO_RUNNER_HTML = `<div class="hero-runner" aria-hidden="true">
  <div class="hero-runner-clip">
    <div class="hero-runner-floor"></div>
    <span class="hero-speed-line sl1"></span>
    <span class="hero-speed-line sl2"></span>
    <span class="hero-speed-line sl3"></span>
    <div class="hero-runner-track">
      ${heroRunnerRig('echo2')}
      ${heroRunnerRig('echo1')}
      ${heroRunnerRig('main')}
    </div>
  </div>
</div>`;

function calendarHtml(calendar) {
  if (!calendar) return '';

  // Per-day detail data for the click-to-open modal — built here (server
  // side, with the real activity rows) so the client only needs to look
  // up an already-formatted day, never re-fetch or reformat anything.
  const dayData = {};
  for (const week of calendar.weeks) {
    for (const cell of week) {
      if (!cell || (!cell.trainings.length && !cell.races.length)) continue;
      dayData[cell.key] = {
        label: fmtDate(cell.key),
        trainings: cell.trainings.map(a => ({
          id: a.id,
          title: a.title,
          type: a.workout_type || 'treino',
          distance: a.distance_km != null ? `${a.distance_km}km` : null,
          pace: a.avg_pace_sec ? `${secToPace(a.avg_pace_sec)}/km` : null,
          time: a.duration_sec != null ? fmtClock(a.duration_sec) : null,
        })),
        races: cell.races.map(r => ({
          name: r.name,
          distance: r.distance_km ? `${r.distance_km}km` : null,
          city: r.city || null,
        })),
      };
    }
  }

  const rows = calendar.weeks.map(week => `
    <div class="cal-row">
      ${week.map(cell => {
        if (!cell) return `<div class="cal-cell empty"></div>`;
        const hasData = cell.trainings.length || cell.races.length;
        const dots = [
          cell.trainings.length ? `<span class="cal-dot dot-training" title="${cell.trainings.length} treino(s)"></span>` : '',
          cell.races.length ? `<span class="cal-dot dot-race" title="${esc(cell.races.map(r => r.name).join(', '))}"></span>` : '',
        ].join('');
        const attr = hasData ? ` data-key="${cell.key}"` : '';
        return `<div class="cal-cell${cell.isToday ? ' today' : ''}${hasData ? ' has-data' : ''}"${attr}><span class="cal-daynum">${cell.day}</span><span class="cal-dots">${dots}</span></div>`;
      }).join('')}
    </div>`).join('');

  return `
<div class="card cal-card">
  <div class="cal-head">
    <h2 style="margin:0;"><span class="h-icon">${icon('calendar', 'cal')}</span>${esc(calendar.monthLabel)}</h2>
    <div class="cal-nav">
      <a class="btn ghost" href="/?month=${calendar.prev}">←</a>
      <a class="btn ghost" href="/?month=${calendar.next}">→</a>
    </div>
  </div>
  <div class="cal-grid">
    <div class="cal-row dow">
      ${calendar.weekdayNames.map(d => `<div class="cal-cell dow">${d}</div>`).join('')}
    </div>
    ${rows}
  </div>
  <div class="cal-legend">
    <span><span class="cal-dot dot-training"></span>Treino</span>
    <span><span class="cal-dot dot-race"></span>Prova</span>
  </div>
</div>

<div class="cal-modal-backdrop" id="cal-modal-backdrop">
  <div class="cal-modal" role="dialog" aria-modal="true">
    <div class="cal-modal-head">
      <h3 id="cal-modal-title">—</h3>
      <button type="button" class="cal-modal-close" id="cal-modal-close" aria-label="Fechar">×</button>
    </div>
    <div id="cal-modal-body"></div>
  </div>
</div>

<script type="application/json" id="cal-days-data">${JSON.stringify(dayData).replace(/</g, '\\u003c')}</script>
<script>
(function(){
  try {
    var DAYS = JSON.parse(document.getElementById('cal-days-data').textContent || '{}');
    var backdrop = document.getElementById('cal-modal-backdrop');
    var titleEl = document.getElementById('cal-modal-title');
    var bodyEl = document.getElementById('cal-modal-body');

    function escHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }

    function openDay(key) {
      var d = DAYS[key];
      if (!d) return;
      titleEl.textContent = d.label || key;
      var parts = [];
      d.trainings.forEach(function(t){
        var meta = [t.distance, t.pace, t.time].filter(Boolean).join(' · ');
        parts.push('<a class="cal-modal-item cal-modal-training" href="/activities/' + t.id + '">' +
          '<div class="t">' + escHtml(t.title) + '</div>' +
          '<div class="d">' + escHtml(t.type) + (meta ? ' · ' + escHtml(meta) : '') + '</div>' +
          '</a>');
      });
      d.races.forEach(function(r){
        var meta = [r.distance, r.city].filter(Boolean).join(' · ');
        parts.push('<a class="cal-modal-item cal-modal-race" href="/races">' +
          '<div class="t">' + escHtml(r.name) + '</div>' +
          '<div class="d">Prova' + (meta ? ' · ' + escHtml(meta) : '') + '</div>' +
          '</a>');
      });
      bodyEl.innerHTML = parts.join('') || '<p class="cal-modal-empty">Nada registrado nesse dia.</p>';
      backdrop.classList.add('open');
    }

    function closeModal() { backdrop.classList.remove('open'); }

    document.querySelectorAll('.cal-cell[data-key]').forEach(function(el){
      el.addEventListener('click', function(){ openDay(el.getAttribute('data-key')); });
    });
    document.getElementById('cal-modal-close').addEventListener('click', closeModal);
    backdrop.addEventListener('click', function(e){ if (e.target === backdrop) closeModal(); });
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeModal(); });
  } catch (e) { console.error('[dbg]', e); }
})();
</script>`;
}

function dashboardPage({ user, nextRace, daysToRace, recentActivities, weekKm, evolution, calendar }) {
  const evoHtml = evolution && evolution.totalCount ? `
<div class="card">
  <h2><span class="h-icon">${icon('mountain', 'evo')}</span>Evolução</h2>
  <div class="grid cols-4">
    <div class="card stat" style="margin-bottom:0;"><div class="k">Total percorrido</div><div class="v">${evolution.totalKm.toFixed(0)}<span class="u">km</span></div></div>
    <div class="card stat" style="margin-bottom:0;"><div class="k">Este mês</div><div class="v">${evolution.kmThisMonth.toFixed(1)}<span class="u">km</span></div></div>
    <div class="card stat" style="margin-bottom:0;"><div class="k">Ritmo médio geral</div><div class="v">${secToPace(evolution.avgPaceSec)}<span class="u">/km</span></div></div>
    <div class="card stat" style="margin-bottom:0;"><div class="k">Maior distância</div><div class="v">${evolution.longest ? evolution.longest.distance_km : '—'}<span class="u">km</span></div></div>
  </div>
  <div class="k" style="margin-top:22px;">Volume semanal (últimas 8 semanas)</div>
  <div class="bars">${evolution.weeks.map(w => {
    const h = Math.max(w.km > 0 ? 8 : 2, Math.round((w.km / evolution.maxWeekKm) * 100));
    return `<div class="bar" style="height:${h}%;"><div class="lbl">${w.km > 0 ? w.km.toFixed(0) : '0'}</div></div>`;
  }).join('')}</div>
  ${evolution.kmLastMonth ? `<p class="muted" style="margin:26px 0 0;">${evolution.kmThisMonth >= evolution.kmLastMonth ? '↑' : '↓'} ${Math.abs(evolution.kmThisMonth - evolution.kmLastMonth).toFixed(1)}km vs mês passado (${evolution.kmLastMonth.toFixed(1)}km)</p>` : ''}
  ${evolution.bestPace ? `<p class="muted" style="margin:8px 0 0;">Melhor ritmo: ${secToPace(evolution.bestPace.avg_pace_sec)}/km em "${esc(evolution.bestPace.title)}" (${fmtDate(evolution.bestPace.started_at || evolution.bestPace.created_at)})</p>` : ''}
</div>` : '';

  const body = `
<section class="hero">
  <div class="hero-overlay"></div>
  <div class="hero-content">
    <div class="hero-eyebrow">Rumo à Maratona de Curitiba</div>
    <h1>Olá, ${esc(user.name.split(' ')[0])}</h1>
    <p class="lede">${user.city ? esc(user.city) + ' · ' : ''}${user.goal_race_name ? 'Meta: ' + esc(user.goal_race_name) : 'Defina sua meta em Config'}</p>
  </div>
  ${HERO_RUNNER_HTML}
</section>

<div class="grid cols-4">
  <div class="card stat"><div class="icon-badge">${icon('calendar')}</div><div class="k">Dias p/ prova</div><div class="v">${daysToRace != null ? daysToRace : '—'}</div></div>
  <div class="card stat"><div class="icon-badge">${icon('stopwatch')}</div><div class="k">Meta de tempo</div><div class="v">${user.goal_time_sec ? fmtClock(user.goal_time_sec) : '—'}</div></div>
  <div class="card stat"><div class="icon-badge">${icon('flame')}</div><div class="k">Km na semana</div><div class="v">${weekKm.toFixed(1)}<span class="u">km</span></div></div>
  <div class="card stat"><div class="icon-badge">${icon('trophy')}</div><div class="k">Treinos registrados</div><div class="v">${recentActivities.length ? recentActivities.length + '+' : '0'}</div></div>
</div>

${nextRace ? `<div class="card">
  <h2><span class="h-icon">${icon('pin', 'next')}</span>Próxima prova</h2>
  <div class="list-item" style="border:none; padding:0;">
    <div><div class="t">${esc(nextRace.name)}</div><div class="d">${fmtDate(nextRace.race_date)} · ${nextRace.distance_km ? nextRace.distance_km + 'km' : ''} ${nextRace.city ? '· ' + esc(nextRace.city) : ''}</div></div>
    <a class="btn ghost" href="/races">Ver provas</a>
  </div>
</div>` : `<div class="card"><p class="muted" style="margin:0;">Nenhuma prova cadastrada ainda. <a href="/races">Adicionar prova →</a></p></div>`}

${calendarHtml(calendar)}

${evoHtml}

<div class="card">
  <h2><span class="h-icon">${icon('stopwatch', 'trn')}</span>Treinos recentes</h2>
  ${recentActivities.length ? recentActivities.map(a => `
    <details class="trn">
      <summary>
        <span class="trn-main">
          <span class="t">${esc(a.title)}</span>
          <span class="d">${fmtDate(a.started_at || a.created_at)}</span>
        </span>
        <span class="pill">${esc(a.workout_type || 'treino')}</span>
      </summary>
      <div class="trn-body">
        <div class="trn-stats">
          ${a.distance_km ? `<span><strong>${a.distance_km}</strong>km</span>` : ''}
          ${a.avg_pace_sec ? `<span><strong>${secToPace(a.avg_pace_sec)}</strong>/km</span>` : ''}
          ${a.avg_hr ? `<span><strong>${a.avg_hr}</strong>bpm</span>` : ''}
        </div>
        <a class="btn ghost" href="/activities/${a.id}">Ver detalhes →</a>
      </div>
    </details>`).join('') : `<p class="muted" style="margin:0;">Nenhum treino ainda. <a href="/activities/new">Registrar treino →</a></p>`}
</div>
`;
  return layout({ title: 'Perfil', user, body, active: 'home' });
}

function racesPage(user, races, nearbyRaces, added) {
  nearbyRaces = nearbyRaces || [];
  const existingKeys = new Set(races.map(r => `${r.name}|${r.race_date}`));
  const nearbyHtml = nearbyRaces.length ? nearbyRaces.map((r, i) => {
    const longest = r.distances && r.distances.length ? r.distances[r.distances.length - 1] : '';
    const isoDate = r.date ? String(r.date).slice(0, 10) : '';
    const already = existingKeys.has(`${r.name}|${isoDate}`);
    return `
    <div class="race-ext">
      <div class="race-ext-main">
        <span class="h-icon race-ext-icon">${icon('pin', 'nr' + i)}</span>
        <div>
          <div class="t">${esc(r.name)}</div>
          <div class="d">${fmtDate(r.date)}${r.city ? ' · ' + esc(r.city) : ''}</div>
        </div>
      </div>
      <div class="race-ext-actions">
        <div class="race-dists">
          ${r.distances && r.distances.length ? r.distances.map(d => `<span class="race-dist">${Number.isInteger(d) ? d : d.toFixed(1)}km</span>`).join('') : ''}
        </div>
        ${already ? `<span class="pill">No calendário</span>` : `
        <form method="POST" action="/races/quickadd">
          <input type="hidden" name="name" value="${esc(r.name)}">
          <input type="hidden" name="race_date" value="${esc(isoDate)}">
          <input type="hidden" name="distance_km" value="${longest || ''}">
          <input type="hidden" name="city" value="${esc(r.city || '')}">
          <button class="ghost" type="submit">+ Agenda</button>
        </form>`}
      </div>
    </div>`;
  }).join('') : `<p class="muted" style="margin:0;">Nenhuma corrida encontrada perto de ${user.city ? esc(user.city) : 'você'} no momento.</p>`;

  const body = `
<h1>Provas</h1>
<p class="lede">Suas provas passadas e futuras.</p>
${added ? `<div class="ok">Prova adicionada ao seu calendário.</div>` : ''}
<div class="card">
  <h2><span class="h-icon">${icon('calendar', 'nova')}</span>Nova prova</h2>
  <form method="POST" action="/races">
    <div class="grid cols-2">
      <div><label>Nome</label><input name="name" required></div>
      <div><label>Data</label><input name="race_date" type="date"></div>
      <div><label>Distância (km)</label><input name="distance_km" type="number" step="0.1"></div>
      <div><label>Cidade</label><input name="city"></div>
      <div><label>Meta de tempo (hh:mm:ss)</label><input name="goal_time" placeholder="03:27:58"></div>
    </div>
    <div style="margin-top:16px;"><button type="submit">Adicionar prova</button></div>
  </form>
</div>

<div class="card">
  <h2><span class="h-icon">${icon('trophy', 'todas')}</span>Todas as provas</h2>
  ${races.length ? races.map(r => `
    <div class="list-item">
      <div><div class="t">${esc(r.name)}</div><div class="d">${fmtDate(r.race_date)} ${r.distance_km ? '· ' + r.distance_km + 'km' : ''} ${r.city ? '· ' + esc(r.city) : ''} ${r.goal_time_sec ? '· meta ' + fmtClock(r.goal_time_sec) : ''}</div></div>
      <form method="POST" action="/races/${r.id}/delete" onsubmit="return confirm('Remover esta prova?')">
        <button class="ghost danger" type="submit">Remover</button>
      </form>
    </div>`).join('') : `<p class="muted" style="margin:0;">Nenhuma prova cadastrada.</p>`}
</div>

<div class="card">
  <h2><span class="h-icon">${icon('pin', 'near')}</span>Provas nos próximos 60 dias${user.city ? ' em ' + esc(user.city) : ' perto de você'}</h2>
  ${nearbyHtml}
  <p class="race-source">Dados via Corrida Perfeita.${!user.city ? ' Defina sua cidade em <a href="/settings">Config</a> para ver corridas perto de você.' : ' Clique em "+ Agenda" para incluir uma prova no seu calendário pessoal.'}</p>
</div>
`;
  return layout({ title: 'Provas', user, body, active: 'races' });
}

function activitiesPage(user, activities, synced) {
  const body = `
<h1>Treinos</h1>
<p class="lede">Histórico de treinos, com splits e análise.</p>
${synced !== undefined ? `<div class="ok">${synced == 0 ? 'Tudo já estava sincronizado — nenhum treino novo.' : `${synced} treino(s) novo(s) importado(s) do Strava.`}</div>` : ''}
<div class="row" style="margin-bottom:18px; gap:10px; display:flex; flex-wrap:wrap;">
  <a class="btn" href="/activities/new">+ Registrar treino</a>
  ${user.strava_refresh_token ? `<form method="POST" action="/strava/sync"><button class="ghost" type="submit">↻ Sincronizar com Strava</button></form>` : ''}
</div>
<div class="card">
  ${activities.length ? activities.map(a => `
    <a class="list-item" href="/activities/${a.id}">
      <div><div class="t">${esc(a.title)}${a.source === 'strava' ? ' <span class="muted mono" style="font-size:11px;">· strava</span>' : ''}</div><div class="d">${fmtDate(a.started_at || a.created_at)} · ${a.distance_km ? a.distance_km + 'km' : '—'} ${a.duration_sec ? '· ' + fmtClock(a.duration_sec) : ''} ${a.avg_pace_sec ? '· ' + secToPace(a.avg_pace_sec) + '/km' : ''}</div></div>
      <span class="pill"><span class="dot"></span>${esc(a.workout_type || 'treino')}</span>
    </a>`).join('') : `<p class="muted" style="margin:0;">Nenhum treino registrado ainda.</p>`}
</div>
`;
  return layout({ title: 'Treinos', user, body, active: 'activities' });
}

function activityNewPage(user, races, error) {
  const raceOptions = races.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  const body = `
<h1>Registrar treino</h1>
<p class="lede">Envie um arquivo GPX ou TCX do relógio/app, ou registre manualmente.</p>
${error ? `<div class="err">${esc(error)}</div>` : ''}

<div class="card">
  <h2>Importar arquivo (GPX/TCX)</h2>
  <form method="POST" action="/activities/upload" enctype="multipart/form-data">
    <label>Nome do treino</label>
    <input name="title" required placeholder="Ex: Longão 28km">
    <label>Tipo</label>
    <select name="workout_type">
      <option value="facil">Fácil</option>
      <option value="longao">Longão</option>
      <option value="progressivo">Progressivo</option>
      <option value="intervalado">Intervalado</option>
      <option value="ritmo">Ritmo de prova</option>
      <option value="regenerativo">Regenerativo</option>
    </select>
    ${races.length ? `<label>Prova relacionada (opcional)</label><select name="race_id"><option value="">—</option>${raceOptions}</select>` : ''}
    <label>Arquivo (.gpx ou .tcx)</label>
    <input type="file" name="file" accept=".gpx,.tcx" required>
    <div style="margin-top:16px;"><button type="submit">Importar e analisar</button></div>
  </form>
</div>

<div class="card">
  <h2>Registrar manualmente</h2>
  <form method="POST" action="/activities/manual">
    <div class="grid cols-2">
      <div><label>Nome do treino</label><input name="title" required></div>
      <div><label>Tipo</label>
        <select name="workout_type">
          <option value="facil">Fácil</option>
          <option value="longao">Longão</option>
          <option value="progressivo">Progressivo</option>
          <option value="intervalado">Intervalado</option>
          <option value="ritmo">Ritmo de prova</option>
        </select>
      </div>
      <div><label>Distância (km)</label><input name="distance_km" type="number" step="0.01" required></div>
      <div><label>Duração (mm:ss ou hh:mm:ss)</label><input name="duration" placeholder="51:22" required></div>
      <div><label>FC média (opcional)</label><input name="avg_hr" type="number"></div>
      <div><label>FC máxima (opcional)</label><input name="max_hr" type="number"></div>
      <div><label>Data</label><input name="started_at" type="date"></div>
    </div>
    <label>Notas</label>
    <textarea name="notes"></textarea>
    <div style="margin-top:16px;"><button type="submit">Registrar</button></div>
  </form>
</div>
`;
  return layout({ title: 'Registrar treino', user, body, active: 'activities' });
}

// Horizontal "this training vs. your average" comparison bars — always
// rendered on the activity page (regardless of whether a km-split or tiros
// chart is also available), so every single training has at least one
// indicator chart even when there's no lap-level GPS data at all (a manual
// entry, or a Strava activity whose laps couldn't be fetched).
function compareBar(label, mineLabel, mineVal, avgVal, maxVal) {
  if (mineVal == null) return '';
  const minePct = maxVal > 0 ? Math.max(4, Math.min(100, Math.round((mineVal / maxVal) * 100))) : 0;
  const avgPct = avgVal != null && maxVal > 0 ? Math.max(4, Math.min(100, Math.round((avgVal / maxVal) * 100))) : null;
  return `<div class="cmp-row">
    <div class="cmp-label">${esc(label)}</div>
    <div class="cmp-track"><div class="cmp-fill mine" style="width:${minePct}%;"></div></div>
    <div class="cmp-val">${esc(mineLabel)}</div>
  </div>${avgPct != null ? `<div class="cmp-row cmp-row-avg">
    <div class="cmp-label muted">média</div>
    <div class="cmp-track"><div class="cmp-fill avg" style="width:${avgPct}%;"></div></div>
    <div class="cmp-val muted"></div>
  </div>` : ''}`;
}

function trainingCompareChart(activity, evolution) {
  if (!evolution) return '';
  const rows = [];
  if (activity.distance_km != null) {
    const max = Math.max(activity.distance_km, evolution.avgDistanceKm || 0) * 1.15 || 1;
    rows.push(compareBar('Distância', `${activity.distance_km}km`, activity.distance_km, evolution.avgDistanceKm, max));
  }
  if (activity.avg_pace_sec != null) {
    // Pace: "faster" means a smaller number, so invert to speed (km/h) for
    // the bar's proportional width — otherwise a quicker run would draw a
    // shorter bar, which reads backwards.
    const mineSpeed = 3600 / activity.avg_pace_sec;
    const avgSpeed = evolution.avgPaceSec ? 3600 / evolution.avgPaceSec : null;
    const max = Math.max(mineSpeed, avgSpeed || 0) * 1.15 || 1;
    rows.push(compareBar('Pace', `${secToPace(activity.avg_pace_sec)}/km`, mineSpeed, avgSpeed, max));
  }
  if (activity.avg_hr != null) {
    const max = Math.max(activity.avg_hr, evolution.avgHr || 0) * 1.15 || 1;
    rows.push(compareBar('FC média', `${activity.avg_hr}bpm`, activity.avg_hr, evolution.avgHr, max));
  }
  if (!rows.length) return '';
  return `<div class="card cmp-card">
  <h2><span class="h-icon">${icon('trophy', 'cmp')}</span>Este treino vs. sua média</h2>
  ${rows.join('')}
</div>`;
}

function activityDetailPage({ user, activity, laps, intervals, evolution, aiEnabled }) {
  const tiros = summarizeIntervals(intervals);
  const vo2max = estimateVO2max(activity.distance_km, activity.duration_sec);

  const maxSplit = laps.length ? Math.max(...laps.map(l => l.split_sec)) : 1;
  const bars = laps.map(l => {
    const h = Math.max(8, Math.round((l.split_sec / maxSplit) * 100));
    const rows = [`<div class="bar-tip-row"><span>Pace</span><strong>${secToPace(l.split_sec)}/km</strong></div>`];
    if (l.cum_sec != null) rows.push(`<div class="bar-tip-row"><span>Acumulado</span><strong>${fmtClock(l.cum_sec)}</strong></div>`);
    if (l.avg_hr) rows.push(`<div class="bar-tip-row"><span>FC média</span><strong>${l.avg_hr} bpm</strong></div>`);
    if (activity.avg_pace_sec) {
      const diff = Math.round(l.split_sec - activity.avg_pace_sec);
      if (diff !== 0) rows.push(`<div class="bar-tip-row"><span>${diff < 0 ? 'Mais rápido' : 'Mais lento'}</span><strong>${secToPace(Math.abs(diff))}/km</strong></div>`);
    }
    return `<div class="bar bar-km" style="height:${h}%;" tabindex="0"><div class="bar-tip"><div class="bar-tip-title">Km ${l.km}</div>${rows.join('')}</div><div class="lbl">${l.km}</div></div>`;
  }).join('');

  let bestKm = null, worstKm = null;
  const timedLaps = laps.filter(l => l.split_sec);
  if (timedLaps.length) {
    bestKm = timedLaps.reduce((a, b) => (b.split_sec < a.split_sec ? b : a));
    worstKm = timedLaps.reduce((a, b) => (b.split_sec > a.split_sec ? b : a));
  }

  let tirosHtml = '';
  if (tiros) {
    const speeds = tiros.bars.map(b => 1 / b.pace_sec);
    const maxSpeed = Math.max(...speeds), minSpeed = Math.min(...speeds);
    const range = maxSpeed - minSpeed;
    const tiroBars = tiros.bars.map(b => {
      const speed = 1 / b.pace_sec;
      const h = range > 0.0001 ? Math.round(40 + ((speed - minSpeed) / range) * 60) : 78;
      return `<div class="tiro-bar${b.isFastest ? ' best' : ''}" style="height:${h}%;" title="Tiro ${b.idx}: ${secToPace(b.pace_sec)}/km">
        <div class="pace-lbl">${secToPace(b.pace_sec)}</div>
        <div class="dist-lbl">${esc(b.distanceLabel)}</div>
      </div>`;
    }).join('');

    tirosHtml = `<div class="card tiros-card">
  <h2><span class="h-icon">${icon('flame', 'tr')}</span>Pace por tiro</h2>
  <div class="grid cols-5" style="margin-bottom:8px;">
    <div class="card stat"><div class="k">Tiros</div><div class="v">${tiros.count}</div></div>
    <div class="card stat"><div class="k">Tempo</div><div class="v">${fmtClock(activity.duration_sec)}</div></div>
    <div class="card stat"><div class="k">Pace nos tiros</div><div class="v">${secToPace(tiros.avgPaceSec)}<span class="u">/km</span></div></div>
    <div class="card stat"><div class="k">FC média</div><div class="v">${tiros.avgHr ?? '—'}${tiros.avgHr ? '<span class="u">bpm</span>' : ''}</div></div>
    <div class="card stat"><div class="k">FC máxima</div><div class="v">${tiros.maxHr ?? '—'}${tiros.maxHr ? '<span class="u">bpm</span>' : ''}</div></div>
  </div>
  <div class="tiros-bars">${tiroBars}</div>
  <p class="muted" style="margin:0;">${esc(tiros.structureText)}</p>
</div>`;
  }

  const body = `
<a href="/activities" class="muted mono" style="font-size:12px;">← Treinos</a>

<details class="title-edit-toggle">
  <summary>
    <h1>${esc(activity.title)}</h1>
    <span class="title-edit-icon" aria-hidden="true"><svg class="icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></span>
  </summary>
  <form method="POST" action="/activities/${activity.id}/rename" class="title-edit-form">
    <input type="text" name="title" value="${esc(activity.title)}" required>
    <button type="submit">Salvar</button>
  </form>
</details>
<p class="lede">${fmtDate(activity.started_at || activity.created_at)} · <span class="pill">${esc(activity.workout_type || 'treino')}</span>${activity.source === 'strava' ? ` · <span class="pill"><span class="dot" style="background:var(--blue);"></span>Strava</span>` : ''}</p>

<div class="grid cols-4">
  <div class="card stat"><div class="icon-badge">${icon('mountain', 'ad1')}</div><div class="k">Distância</div><div class="v">${activity.distance_km ?? '—'}${activity.distance_km != null ? '<span class="u">km</span>' : ''}</div></div>
  <div class="card stat"><div class="icon-badge">${icon('stopwatch', 'ad2')}</div><div class="k">Tempo</div><div class="v">${fmtClock(activity.duration_sec)}</div></div>
  <div class="card stat"><div class="icon-badge">${icon('flame', 'ad3')}</div><div class="k">Pace médio</div><div class="v">${secToPace(activity.avg_pace_sec)}${activity.avg_pace_sec ? '<span class="u">/km</span>' : ''}</div></div>
  <div class="card stat"><div class="icon-badge">${icon('heart', 'ad4')}</div><div class="k">FC média</div><div class="v">${activity.avg_hr ?? '—'}${activity.avg_hr ? '<span class="u">bpm</span>' : ''}</div></div>
  <div class="card stat"><div class="icon-badge">${icon('heart', 'ad5')}</div><div class="k">FC máxima</div><div class="v">${activity.max_hr ?? '—'}${activity.max_hr ? '<span class="u">bpm</span>' : ''}</div></div>
  <div class="card stat"><div class="icon-badge">${icon('mountain', 'ad6')}</div><div class="k">Elevação</div><div class="v">${activity.elevation_gain_m ?? '—'}${activity.elevation_gain_m != null ? '<span class="u">m</span>' : ''}</div></div>
  <div class="card stat"><div class="icon-badge">${icon('flame', 'ad7')}</div><div class="k">Cadência</div><div class="v">${activity.cadence_spm ?? '—'}${activity.cadence_spm != null ? '<span class="u">spm</span>' : ''}</div></div>
  <div class="card stat"><div class="icon-badge">${icon('trophy', 'ad8')}</div><div class="k">VO2 máx (estimado)</div><div class="v">${vo2max ?? '—'}${vo2max != null ? '<span class="u">ml/kg/min</span>' : ''}</div></div>
</div>

${tirosHtml}

${(!tiros && laps.length) ? `<div class="card">
  <h2><span class="h-icon">${icon('mountain', 'sp')}</span>Splits por km</h2>
  ${bestKm && worstKm ? `<p class="muted" style="margin:-4px 0 14px;">Melhor km: <strong>Km ${bestKm.km} · ${secToPace(bestKm.split_sec)}/km</strong> &nbsp;·&nbsp; Mais lento: <strong>Km ${worstKm.km} · ${secToPace(worstKm.split_sec)}/km</strong></p>` : ''}
  <div class="bars">${bars}</div>
</div>` : ''}

${trainingCompareChart(activity, evolution)}

<div class="card">
  <h2><span class="h-icon">${icon('heart', 'ai')}</span>Análise com IA</h2>
  ${activity.ai_analysis ? `<div class="ai-analysis">${renderMarkdownLite(activity.ai_analysis)}</div>
    ${aiEnabled ? `<form method="POST" action="/activities/${activity.id}/analyze" style="margin-top:14px;" onsubmit="var b=this.querySelector('button'); b.disabled=true; b.textContent='Gerando análise…';"><button class="ghost" type="submit">↻ Gerar nova análise</button></form>` : ''}` : `
    ${aiEnabled
      ? `<form method="POST" action="/activities/${activity.id}/analyze" onsubmit="var b=this.querySelector('button'); b.disabled=true; b.textContent='Gerando análise… (pode levar até 30s)';"><button type="submit">Gerar análise técnica</button></form>`
      : `<p class="muted" style="margin:0;">Cadastre sua chave da API da Anthropic em <a href="/settings">Config</a> para gerar análises técnicas automáticas.</p>`}
  `}
</div>

${aiEnabled ? `<div class="card">
  <h2><span class="h-icon">${icon('heart', 'ca')}</span>Conversar com o coach sobre este treino</h2>
  <div class="chat-msgs" id="activityCoachMsgs"></div>
  <form class="coach-inline-form" id="activityCoachForm">
    <textarea id="activityCoachInput" placeholder="Pergunte algo sobre este treino..." rows="1"></textarea>
    <button type="submit" aria-label="Enviar">${icon('flame', 'casend')}</button>
  </form>
</div>` : ''}

<div class="card">
  <h2><span class="h-icon">${icon('chat', 'sh')}</span>Compartilhar</h2>
  <p class="muted" style="margin:0 0 14px;">Poste esse treino no feed com uma legenda pronta a partir da sua análise, ou gere uma imagem para os stories.</p>
  <div class="row">
    <a class="btn" href="/feed?share_activity=${activity.id}">Compartilhar no feed</a>
    <a class="ghost btn" href="/activities/${activity.id}/story">Gerar imagem para Stories</a>
  </div>
</div>

<form method="POST" action="/activities/${activity.id}/delete" onsubmit="return confirm('Remover este treino?')">
  <button class="danger" type="submit">Remover treino</button>
</form>
`;
  const bodyEnd = aiEnabled ? `<script defer>
(function(){
function ready(fn){ if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
ready(function(){
  if (window.CoachChat) {
    window.CoachChat.mount({
      msgsId: 'activityCoachMsgs',
      formId: 'activityCoachForm',
      inputId: 'activityCoachInput',
      historyUrl: '/api/coach/activity/${activity.id}/history',
      activityId: ${activity.id},
      emptyText: 'Pergunte ao coach sobre este treino específico — pace, tiros, FC, o que quiser.',
    });
  }
});
})();
</script>` : '';
  return layout({ title: activity.title, user, body, active: 'activities', bodyEnd });
}

function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function postCard(user, p) {
  const mine = p.user_id === user.id;
  const comments = p.comments || [];
  return `<div class="card post-card">
  <div class="post-head">
    <div class="post-avatar">${esc(initials(p.author_name))}</div>
    <div class="post-head-meta">
      <div class="post-name">${p.author_slug ? `<a href="/u/${esc(p.author_slug)}">${esc(p.author_name)}</a>` : esc(p.author_name)}${mine ? ' <span class="pill">você</span>' : ''}</div>
      <div class="post-time">${fmtDate(p.created_at)}</div>
    </div>
  </div>
  <div class="post-body">${esc(p.body).replace(/\n/g, '<br>')}</div>
  ${p.photo_path ? `<div class="post-photo"><img src="/uploads/${esc(p.photo_path)}" alt="" loading="lazy"></div>` : ''}
  ${p.activity_title ? `<a class="pill post-activity-pill" href="/activities/${p.activity_id}"><span class="dot"></span>${esc(p.activity_title)}</a>` : ''}
  <div class="post-actions">
    <form method="POST" action="/feed/${p.id}/react">
      <button class="kudos-btn${p.reacted ? ' active' : ''}" type="submit">${icon('flame', 'k' + p.id)}<span>${p.kudos_count || 0}</span></button>
    </form>
    <span class="post-comment-count">${icon('chat', 'c' + p.id)}<span>${p.comment_count || 0}</span></span>
  </div>
  ${comments.length ? `<div class="post-comments">
    ${comments.map((c) => `<div class="comment-item"><span class="comment-author">${esc(c.author_name)}</span> <span class="comment-body">${esc(c.body)}</span></div>`).join('')}
  </div>` : ''}
  <form method="POST" action="/feed/${p.id}/comment" class="comment-form">
    <input type="text" name="body" placeholder="Comentar..." required maxlength="500">
    <button class="ghost" type="submit">Enviar</button>
  </form>
</div>`;
}

function feedPage(user, posts, opts) {
  opts = opts || {};
  const body = `
<h1>Feed</h1>
<p class="lede">O que a galera está treinando.</p>
<div class="card feed-composer">
  <form method="POST" action="/feed" enctype="multipart/form-data">
    ${opts.shareActivity ? `<div class="pill" style="margin-bottom:10px;"><input type="hidden" name="activity_id" value="${opts.shareActivity.id}"><span class="dot"></span>Vinculado a: ${esc(opts.shareActivity.title)}</div>` : ''}
    <textarea name="body" placeholder="Compartilhe algo..." required>${opts.shareDraft ? esc(opts.shareDraft) : ''}</textarea>
    <div class="row" style="margin-top:12px; justify-content:space-between;">
      <label class="photo-input-label">
        <input type="file" name="photo" accept="image/*" style="display:none;" onchange="this.nextElementSibling.textContent = this.files[0] ? this.files[0].name : 'Adicionar foto';">
        <span class="ghost btn photo-btn">Adicionar foto</span>
      </label>
      <button type="submit">Postar</button>
    </div>
  </form>
</div>
${posts.length ? posts.map((p) => postCard(user, p)).join('') : `<div class="card"><p class="muted" style="margin:0;">Nenhum post ainda. Seja o primeiro a compartilhar um treino!</p></div>`}
`;
  return layout({ title: 'Feed', user, body, active: 'feed' });
}

function publicProfilePage(viewer, profileUser, evolution, races) {
  const weekKm = evolution.weeks.length ? evolution.weeks[evolution.weeks.length - 1].km : 0;
  const longestKm = evolution.longest ? evolution.longest.distance_km : null;
  const bestPaceSec = evolution.bestPace ? evolution.bestPace.avg_pace_sec : null;
  const body = `
<div class="card profile-hero">
  <div class="post-avatar profile-avatar">${esc(initials(profileUser.name))}</div>
  <div>
    <h1 style="margin:0 0 4px;">${esc(profileUser.name)}</h1>
    ${profileUser.city ? `<p class="muted" style="margin:0 0 6px;">${esc(profileUser.city)}</p>` : ''}
    ${profileUser.bio ? `<p style="margin:0;">${esc(profileUser.bio)}</p>` : ''}
    ${profileUser.goal_race_name ? `<div class="pill" style="margin-top:10px;"><span class="dot"></span>Meta: ${esc(profileUser.goal_race_name)}${profileUser.goal_time_sec ? ` em ${fmtClock(profileUser.goal_time_sec)}` : ''}</div>` : ''}
  </div>
</div>

<div class="grid cols-4">
  <div class="card stat"><div class="icon-badge">${icon('mountain', 'pp1')}</div><div class="k">Total</div><div class="v">${evolution.totalKm.toFixed(0)}<span class="u">km</span></div></div>
  <div class="card stat"><div class="icon-badge">${icon('flame', 'pp2')}</div><div class="k">Esta semana</div><div class="v">${weekKm.toFixed(1)}<span class="u">km</span></div></div>
  <div class="card stat"><div class="icon-badge">${icon('stopwatch', 'pp3')}</div><div class="k">Melhor pace</div><div class="v">${secToPace(bestPaceSec)}${bestPaceSec ? '<span class="u">/km</span>' : ''}</div></div>
  <div class="card stat"><div class="icon-badge">${icon('trophy', 'pp4')}</div><div class="k">Maior treino</div><div class="v">${longestKm != null ? longestKm.toFixed(1) : '—'}${longestKm != null ? '<span class="u">km</span>' : ''}</div></div>
</div>

${races.length ? `<div class="card">
  <h2><span class="h-icon">${icon('calendar', 'pp5')}</span>Próximas provas</h2>
  ${races.map((r) => `<div class="list-item"><div><div class="t">${esc(r.name)}</div><div class="d">${r.race_date ? fmtDate(r.race_date) : 'Data a definir'}${r.city ? ' · ' + esc(r.city) : ''}</div></div>${r.distance_km ? `<span class="pill">${r.distance_km}km</span>` : ''}</div>`).join('')}
</div>` : ''}

<p class="muted" style="margin-top:20px;">Perfil público do Atletas.${!viewer ? ' <a href="/signup">Crie o seu.</a>' : ''}</p>
`;
  return layout({ title: `${profileUser.name} · Perfil`, user: viewer, body, hideCoachWidget: true });
}

function storyPage(user, activity) {
  const data = {
    title: activity.title,
    distance: activity.distance_km,
    duration: fmtClock(activity.duration_sec),
    pace: secToPace(activity.avg_pace_sec),
    date: fmtDate(activity.started_at || activity.created_at),
    athlete: user.name,
  };
  const dataJson = JSON.stringify(data).replace(/</g, '\\u003c');
  const body = `
<a href="/activities/${activity.id}" class="muted mono" style="font-size:12px;">← Treino</a>
<h1>Imagem para Stories</h1>
<p class="lede">Gerada no seu navegador — nada é enviado para o servidor.</p>
<div class="card story-card">
  <canvas id="storyCanvas" width="1080" height="1350"></canvas>
  <div class="row" style="margin-top:16px;">
    <button id="storyDownload" type="button">Baixar imagem</button>
    <a class="ghost btn" href="/activities/${activity.id}">Voltar</a>
  </div>
</div>
<script defer>
(function(){
  var DATA = ${dataJson};
  function wrapText(ctx, text, x, y, maxWidth, lineHeight){
    var words = (text || '').split(' ');
    var line = '', lines = [];
    for (var n = 0; n < words.length; n++) {
      var test = line + words[n] + ' ';
      if (ctx.measureText(test).width > maxWidth && n > 0) { lines.push(line); line = words[n] + ' '; }
      else line = test;
    }
    lines.push(line);
    lines.slice(0, 3).forEach(function(l, i){ ctx.fillText(l.trim(), x, y + i * lineHeight); });
  }
  function draw(){
    var c = document.getElementById('storyCanvas');
    var ctx = c.getContext('2d');
    var W = c.width, H = c.height;
    var grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#1c1006');
    grad.addColorStop(0.55, '#2a1608');
    grad.addColorStop(1, '#150c05');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (var i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(W * 0.18 + i * 160, H * 0.1 + i * 50, 110, 0, Math.PI * 2); ctx.fill(); }

    ctx.fillStyle = '#FFC24E';
    ctx.font = '700 34px Arial, sans-serif';
    ctx.fillText('ATLETAS', 60, 110);

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 56px Arial, sans-serif';
    wrapText(ctx, DATA.title, 60, 220, W - 120, 66);

    var stats = [
      [DATA.distance != null ? DATA.distance + ' km' : '—', 'DISTÂNCIA'],
      [DATA.duration, 'TEMPO'],
      [DATA.pace + '/km', 'PACE MÉDIO'],
    ];
    var y = 560;
    stats.forEach(function(s){
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 84px Arial, sans-serif';
      ctx.fillText(s[0], 60, y);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '600 26px Arial, sans-serif';
      ctx.fillText(s[1], 60, y + 40);
      y += 170;
    });

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '500 28px Arial, sans-serif';
    ctx.fillText(DATA.athlete + ' · ' + DATA.date, 60, H - 70);
  }
  draw();
  var btn = document.getElementById('storyDownload');
  if (btn) btn.addEventListener('click', function(){
    var c = document.getElementById('storyCanvas');
    var link = document.createElement('a');
    link.download = 'treino.png';
    link.href = c.toDataURL('image/png');
    link.click();
  });
})();
</script>
`;
  return layout({ title: 'Imagem para Stories', user, body, active: 'activities', hideCoachWidget: true });
}

function settingsPage(user, flags) {
  flags = flags || {};
  const stravaConnected = !!user.strava_refresh_token;
  const body = `
<h1>Configurações</h1>
${flags.saved ? `<div class="ok">Salvo com sucesso.</div>` : ''}
${flags.stravaConnected ? `<div class="ok">Strava conectado! Vá em <a href="/activities">Treinos</a> e clique em "Sincronizar com Strava" para importar seu histórico.</div>` : ''}
${flags.stravaDisconnected ? `<div class="ok">Strava desconectado.</div>` : ''}
${flags.stravaError ? `<div class="err">Não consegui conectar com o Strava agora. Tente de novo.</div>` : ''}

<div class="card">
  <h2><span class="h-icon">${icon('flame', 'strava')}</span>Strava</h2>
  ${!flags.stravaConfigured && !stravaConnected ? `
    <p class="muted" style="margin:0;">Integração com Strava ainda não configurada no servidor (faltam as credenciais do app Strava).</p>
  ` : stravaConnected ? `
    <p class="muted">Conectado — o Garmin sincroniza com o Strava automaticamente, e o Atletas importa suas corridas de lá.</p>
    <div class="row" style="gap:10px; display:flex;">
      <a class="ghost btn" href="/activities">Ir para Treinos e sincronizar</a>
      <form method="POST" action="/strava/disconnect"><button class="danger" type="submit">Desconectar</button></form>
    </div>
  ` : `
    <p class="muted">Conecte sua conta do Strava para importar seus treinos automaticamente (inclusive os que já sincronizam do Garmin para o Strava).</p>
    <a class="btn" href="/strava/connect">Conectar com Strava</a>
  `}
</div>

<div class="card">
  <h2><span class="h-icon">${icon('pin', 'perfil')}</span>Perfil</h2>
  <form method="POST" action="/settings">
    <div class="grid cols-2">
      <div><label>Nome</label><input name="name" value="${esc(user.name)}" required></div>
      <div><label>Cidade</label><input name="city" value="${esc(user.city || '')}"></div>
      <div><label>Prova-alvo</label><input name="goal_race_name" value="${esc(user.goal_race_name || '')}"></div>
      <div><label>Meta de tempo (hh:mm:ss)</label><input name="goal_time" value="${user.goal_time_sec ? fmtClock(user.goal_time_sec) : ''}" placeholder="03:27:58"></div>
    </div>
    <label>Bio</label>
    <textarea name="bio">${esc(user.bio || '')}</textarea>
    <div style="margin-top:16px;"><button type="submit">Salvar</button></div>
  </form>
</div>

${flags.publicUrl ? `<div class="card">
  <h2><span class="h-icon">${icon('trophy', 'pubprof')}</span>Perfil público</h2>
  <p class="muted">Qualquer pessoa com este link vê suas estatísticas e próximas provas, sem precisar entrar no app.</p>
  <div class="row" style="gap:10px;">
    <input class="mono" readonly value="${esc(flags.publicUrl)}" style="flex:1; min-width:220px;">
    <a class="ghost btn" href="${esc(flags.publicUrl)}" target="_blank" rel="noopener">Abrir</a>
  </div>
</div>` : ''}

<div class="card">
  <h2><span class="h-icon">${icon('heart', 'ai2')}</span>Análise com IA (opcional)</h2>
  <p class="muted">Cole sua própria chave da API da Anthropic para habilitar análises técnicas automáticas dos seus treinos. A chave fica salva só na sua conta e é usada apenas para gerar suas análises — o uso é cobrado na sua própria conta Anthropic.</p>
  <form method="POST" action="/settings/api-key">
    <label>Chave da API (sk-ant-...)</label>
    <input name="anthropic_api_key" value="${user.anthropic_api_key ? '••••••••••••' + esc(user.anthropic_api_key.slice(-4)) : ''}" placeholder="sk-ant-...">
    <div style="margin-top:12px;"><button class="ghost" type="submit">Salvar chave</button></div>
  </form>
</div>
`;
  return layout({ title: 'Config', user, body, active: 'settings' });
}

function coachChatPage(user, messages, flags) {
  flags = flags || {};
  const initialJson = JSON.stringify(messages.map(m => ({ role: m.role, content: m.content }))).replace(/</g, '\\u003c');

  const body = `
<h1>Coach de Corrida</h1>
<p class="lede">Converse com o seu treinador pessoal — ele responde com base nos seus treinos, sua evolução e sua prova, em tempo real.</p>
${flags.error === 'missing_key' ? `<div class="err">Cadastre sua chave da API da Anthropic em <a href="/settings">Config</a> para conversar com o coach.</div>` : ''}

<div class="card chat-card">
  <div class="chat-msgs" id="chatMsgs"></div>
  ${flags.aiEnabled ? `
  <form class="chat-form" id="chatForm">
    <textarea id="chatInput" placeholder="Fale com o coach..." rows="1" autofocus></textarea>
    <button type="submit" aria-label="Enviar">${icon('flame', 'sendbig')}</button>
  </form>
  ${messages.length ? `<form method="POST" action="/assistant/clear" style="margin-top:10px;" onsubmit="return confirm('Limpar toda a conversa?')"><button class="ghost danger" type="submit">Limpar conversa</button></form>` : ''}
  ` : `<p class="muted" style="margin:14px 0 0;">Cadastre sua chave da API da Anthropic em <a href="/settings">Config</a> para habilitar o coach.</p>`}
</div>
`;
  const chatInit = `<script defer>
(function(){
  try {
    if (window.CoachChat) {
      window.CoachChat.mount({
        msgsId: 'chatMsgs',
        formId: 'chatForm',
        inputId: 'chatInput',
        initialMessages: ${initialJson},
        aiEnabled: ${flags.aiEnabled ? 'true' : 'false'},
        emptyText: 'Nenhuma mensagem ainda. Pergunte algo como "como está minha evolução esse mês?" ou "quantos km faltam pra bater minha meta na maratona?".',
      });
    }
  } catch (e) { console.error('[dbg]', e); }
})();
</script>`;
  return layout({ title: 'Coach de Corrida', user, body, active: 'assistant', hideCoachWidget: true, bodyEnd: chatInit });
}

module.exports = {
  layout, loginPage, signupPage, dashboardPage, racesPage,
  activitiesPage, activityNewPage, activityDetailPage, feedPage, settingsPage, coachChatPage,
  publicProfilePage, storyPage,
};
