const { secToPace, fmtClock, fmtDate, timeAgo, esc, renderMarkdownLite, icon } = require('./lib/format');
const { summarizeIntervals } = require('./lib/intervals');
const { estimateVO2max } = require('./lib/stats');
const { REGION_LABELS, autoRegionLabel } = require('./lib/races');
const { REACTION_TYPES, memberNumber, buildDiagnosis } = require('./lib/social');

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

    // Tiro (pace-por-tiro) tooltips: the chart scrolls horizontally on
    // narrow screens (overflow-x:auto), and that forces the browser to
    // clip overflow-y too — a plain absolutely positioned tooltip inside
    // it gets cut off instead of floating above the bar. So instead this
    // clones each bar's hidden .bar-tip content into one shared element
    // appended to <body> (outside any clipping ancestor) and positions it
    // with the bar's real on-screen coordinates. Mouse hover, keyboard
    // focus and tap all show it; a second tap on the same bar (or a tap
    // elsewhere) closes it.
    var tiroBars = document.querySelectorAll('.tiro-bar');
    if (tiroBars.length) {
      var tiroFloat = document.createElement('div');
      tiroFloat.className = 'tiro-tip-float';
      document.body.appendChild(tiroFloat);
      var tiroActiveBar = null;
      var positionTiroFloat = function(bar){
        var r = bar.getBoundingClientRect();
        tiroFloat.style.left = (r.left + r.width / 2) + 'px';
        tiroFloat.style.top = r.top + 'px';
      };
      var showTiroTip = function(bar){
        var inner = bar.querySelector('.bar-tip');
        if (!inner) return;
        tiroFloat.innerHTML = inner.innerHTML;
        positionTiroFloat(bar);
        tiroFloat.classList.add('show');
        tiroBars.forEach(function(b){ b.classList.toggle('tip-active', b === bar); });
        tiroActiveBar = bar;
      };
      var hideTiroTip = function(){
        tiroFloat.classList.remove('show');
        tiroBars.forEach(function(b){ b.classList.remove('tip-active'); });
        tiroActiveBar = null;
      };
      tiroBars.forEach(function(bar){
        bar.addEventListener('mouseenter', function(){ showTiroTip(bar); });
        bar.addEventListener('mouseleave', function(){ if (tiroActiveBar === bar) hideTiroTip(); });
        bar.addEventListener('focus', function(){ showTiroTip(bar); });
        bar.addEventListener('blur', function(){ if (tiroActiveBar === bar) hideTiroTip(); });
        bar.addEventListener('click', function(e){
          // Always (re-)show rather than toggling closed: on touch this is
          // the only way the tip opens at all, and on desktop it means
          // clicking a bar while it's already hovered is a harmless no-op
          // instead of flickering the tip closed under the cursor.
          e.stopPropagation();
          showTiroTip(bar);
        });
      });
      document.addEventListener('click', hideTiroTip);
      window.addEventListener('scroll', hideTiroTip, true);
      window.addEventListener('resize', function(){ if (tiroActiveBar) positionTiroFloat(tiroActiveBar); });
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

// Splits the server's STORY_CARD sentinel (see the coach reply handler in
// server.js) off the end of a reply — the visible chat text never includes
// it, it's parsed out here and drawn as a canvas card instead.
var STORY_RE = /\\n?\\[\\[STORY_CARD\\]\\]([\\s\\S]*?)\\[\\[\\/STORY_CARD\\]\\]/;
function splitStoryCard(text){
  var m = STORY_RE.exec(text || '');
  if (!m) return { text: text, card: null };
  var card = null;
  try { card = JSON.parse(m[1]); } catch (e) { card = null; }
  return { text: text.slice(0, m.index), card: card };
}

// Draws the same dark/gold "stories" visual language used elsewhere in the
// app (see storyPage) onto a canvas sized for a quick in-chat reference
// during a run — a title, a handful of label/value tiles pulled straight
// from what the coach just said, and an optional closing line.
function drawStoryCard(canvas, card){
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  var grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#1c1006');
  grad.addColorStop(0.55, '#2a1608');
  grad.addColorStop(1, '#150c05');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (var i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(W * 0.2 + i * 90, H * 0.08 + i * 30, 70, 0, Math.PI * 2); ctx.fill(); }

  ctx.fillStyle = '#FFC24E';
  ctx.font = '700 22px Arial, sans-serif';
  ctx.fillText((card.eyebrow || 'TREINO').toUpperCase(), 36, 56);

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 38px Arial, sans-serif';
  var words = (card.title || '').split(' '), line = '', y = 110, lines = [];
  for (var n = 0; n < words.length; n++) {
    var test = line + words[n] + ' ';
    if (ctx.measureText(test).width > W - 72 && n > 0) { lines.push(line); line = words[n] + ' '; }
    else line = test;
  }
  lines.push(line);
  lines.slice(0, 2).forEach(function(l, i){ ctx.fillText(l.trim(), 36, y + i * 46); });
  var blocksTop = y + lines.length * 46 + 30;

  var blocks = (card.blocks || []).slice(0, 6);
  var rowH = (H - blocksTop - 70) / Math.max(1, blocks.length);
  blocks.forEach(function(b, i){
    var by = blocksTop + i * rowH;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(36, by); ctx.lineTo(W - 36, by); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '600 15px Arial, sans-serif';
    ctx.fillText(String(b.label || '').toUpperCase(), 36, by + 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 26px Arial, sans-serif';
    ctx.fillText(String(b.value || ''), 36, by + 56);
  });

  if (card.closer) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '500 16px Arial, sans-serif';
    var cwords = card.closer.split(' '), cline = '', cy = H - 44, clines = [];
    for (var cn = 0; cn < cwords.length; cn++) {
      var ctest = cline + cwords[cn] + ' ';
      if (ctx.measureText(ctest).width > W - 72 && cn > 0) { clines.push(cline); cline = cwords[cn] + ' '; }
      else cline = ctest;
    }
    clines.push(cline);
    clines.slice(0, 2).forEach(function(l, i){ ctx.fillText(l.trim(), 36, cy + i * 20); });
  }
}
function renderStoryCard(container, card){
  var wrap = document.createElement('div');
  wrap.className = 'chat-story-card';
  var canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 420;
  wrap.appendChild(canvas);
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ghost btn xs chat-story-download';
  btn.textContent = 'Baixar imagem';
  btn.addEventListener('click', function(){
    var link = document.createElement('a');
    link.download = 'treino.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
  wrap.appendChild(btn);
  container.appendChild(wrap);
  try { drawStoryCard(canvas, card); } catch (e) { console.error('[dbg]', e); }
}
function mount(opts){
  var msgsEl = document.getElementById(opts.msgsId);
  var formEl = document.getElementById(opts.formId);
  var inputEl = document.getElementById(opts.inputId);
  if (!msgsEl || !formEl || !inputEl) return;
  var aiEnabled = !!opts.aiEnabled;
  var activityId = opts.activityId != null ? opts.activityId : null;
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
      if (opts.suggestions && opts.suggestions.length) {
        var chips = document.createElement('div');
        chips.className = 'chat-suggestions';
        opts.suggestions.forEach(function(s){
          var chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'chat-suggestion-chip';
          chip.textContent = s;
          chip.addEventListener('click', function(){ send(s); });
          chips.appendChild(chip);
        });
        msgsEl.appendChild(chips);
      }
      return;
    }
    messages.forEach(function(m){
      var b = bubble(msgsEl, m.role === 'user' ? 'user' : 'assistant');
      var split = splitStoryCard(m.content);
      b.textContent = split.text;
      if (split.card) renderStoryCard(b, split.card);
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
        body: JSON.stringify({ message: text, activity_id: activityId }),
      });
      if (!res.ok || !res.body) {
        replyB.textContent = res.status === 412
          ? 'Cadastre sua chave da API da Anthropic em Config para conversar com o coach.'
          : 'Não consegui responder agora. Tenta de novo?';
      } else {
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var started = false;
        var raw = '';
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          var piece = decoder.decode(chunk.value, { stream: true });
          if (!piece) continue;
          if (!started) { replyB.textContent = ''; started = true; }
          raw += piece;
          // The STORY_CARD sentinel (when present) always arrives at the
          // very end of the stream — hide it from the live-typing text as
          // it comes in rather than flashing the raw [[STORY_CARD]]... tag
          // for a frame before the final split below removes it.
          replyB.textContent = splitStoryCard(raw).text;
          scrollBottom();
        }
        if (!started) replyB.textContent = '(sem resposta)';
        else {
          var finalSplit = splitStoryCard(raw);
          replyB.textContent = finalSplit.text;
          if (finalSplit.card) renderStoryCard(replyB, finalSplit.card);
        }
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

  // Lets a page swap which conversation this same mounted chat is pointed
  // at (general vs. a specific activity's thread) without re-creating the
  // form/input/listeners above — used by the /assistant sidebar to switch
  // threads in place, ChatGPT-style, instead of a full page reload.
  function switchThread(newActivityId, historyUrl, emptyText, suggestions){
    activityId = newActivityId != null ? newActivityId : null;
    if (emptyText) opts.emptyText = emptyText;
    opts.suggestions = suggestions || null;
    msgsEl.innerHTML = '';
    var loading = document.createElement('p');
    loading.className = 'chat-empty';
    loading.textContent = 'Carregando…';
    msgsEl.appendChild(loading);
    fetch(historyUrl).then(function(r){ return r.ok ? r.json() : { messages: [] }; }).then(function(data){
      aiEnabled = !!data.aiEnabled;
      renderInitial(data.messages || []);
    }).catch(function(){ renderInitial([]); });
  }

  return { switchThread: switchThread };
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
        suggestions: ['Analise meu último treino', 'Como está minha evolução esse mês?', 'O que eu preciso melhorar?', 'Quanto falta pra minha meta na maratona?'],
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
      var text = n.body || (n.type === 'kudos' ? (n.actor_name + ' reagiu ao seu post') : n.type === 'follow' ? (n.actor_name + ' passou a seguir você') : (n.actor_name + ' comentou no seu post'));
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

function layout({ title, user, body, active, extraHead, bodyEnd, hideCoachWidget, bodyClass, wrapClass, navVariant }) {
  const nav = user
    ? `<nav class="nav">
        <a class="brand" href="/">Atletas</a>
        <div class="links">
          <a class="link ${active === 'home' ? 'active' : ''}" href="/">Perfil</a>
          <a class="link ${active === 'races' ? 'active' : ''}" href="/races">Provas</a>
          <a class="link ${active === 'activities' ? 'active' : ''}" href="/activities">Treinos</a>
          <a class="link ${active === 'feed' ? 'active' : ''}" href="/feed">Feed</a>
          <a class="link ${active === 'discover' ? 'active' : ''}" href="/discover">Buscar</a>
          <a class="link ${active === 'assistant' ? 'active' : ''}" href="/assistant">Coach IA</a>
          <a class="link ${active === 'coach' ? 'active' : ''}" href="/coach">Coach ao vivo</a>
          <a class="link ${active === 'professor' ? 'active' : ''}" href="/professor">Professor</a>
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
    : navVariant === 'public'
    ? `<nav class="nav">
        <a class="brand" href="/">Atletas</a>
        <div class="links">
          <a class="link" href="/login">Entrar</a>
          <a class="btn xs" href="/signup">Cadastre-se</a>
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
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
${nav}
<div class="wrap${wrapClass ? ` ${wrapClass}` : ''}">
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

function signupPage(error, prev) {
  prev = prev || {};
  return authLayout('Criar conta', `
${error ? `<div class="err">${esc(error)}</div>` : ''}
<form method="POST" action="/signup" class="signup-form">
  <div class="signup-step-label">01 · Sua conta</div>
  <label>Nome</label>
  <input type="text" name="name" value="${esc(prev.name || '')}" required autofocus>
  <label>E-mail</label>
  <input type="email" name="email" value="${esc(prev.email || '')}" required>
  <label>Senha</label>
  <input type="password" name="password" required minlength="6">

  <div class="signup-step-label signup-step-label-2">02 · Pré-diagnóstico</div>
  <p class="muted" style="margin:0 0 4px;">Algumas perguntas rápidas pra gente te conhecer como atleta — nada aqui é obrigatório.</p>
  <label>Seu nível como corredor(a)</label>
  <select name="experience_level">
    <option value="">Prefiro não dizer</option>
    <option value="iniciante"${prev.experience_level === 'iniciante' ? ' selected' : ''}>Iniciante</option>
    <option value="intermediario"${prev.experience_level === 'intermediario' ? ' selected' : ''}>Intermediário</option>
    <option value="avancado"${prev.experience_level === 'avancado' ? ' selected' : ''}>Avançado</option>
  </select>
  <label>Quantos km você corre por semana hoje?</label>
  <input type="number" step="0.1" min="0" name="weekly_km" value="${esc(prev.weekly_km || '')}" placeholder="ex: 25">
  <div class="grid cols-2">
    <div><label>Prova-alvo (se já tiver)</label><input type="text" name="goal_race_name" value="${esc(prev.goal_race_name || '')}" placeholder="ex: Maratona de Curitiba"></div>
    <div><label>Meta de tempo</label><input type="text" name="goal_time" value="${esc(prev.goal_time || '')}" placeholder="03:30:00"></div>
  </div>
  <label>Histórico de lesão ou algo que devemos saber</label>
  <textarea name="injury_notes" placeholder="Se não tiver nada, pode deixar em branco.">${esc(prev.injury_notes || '')}</textarea>

  <div style="margin-top:20px"><button type="submit" style="width:100%">Criar conta</button></div>
</form>
<p class="muted" style="text-align:center; margin-top:18px;">Já tem conta? <a href="/login">Entrar</a></p>
`);
}

function welcomePage(user) {
  const number = memberNumber(user);
  const diagnosis = buildDiagnosis(user);
  const body = `
<div class="welcome-number">
  <span class="welcome-number-eyebrow">Você é o atleta</span>
  <span class="welcome-number-big">Nº ${esc(number)}</span>
</div>
<div class="welcome-diagnosis">
  <p>${esc(diagnosis)}</p>
</div>
<a class="btn" href="/" style="width:100%; text-align:center; margin-top:8px;">Começar</a>
`;
  return authLayout('Bem-vindo', body);
}

// Static "3D-style" sneaker mark for the public landing page — the same
// shoe silhouette used everywhere else in the app (icon('shoe', ...)),
// scaled way up and dressed with layered radial glows, a halo ring and a
// contact shadow so it reads as a dimensional product shot instead of a
// flat icon, without needing WebGL (that stays reserved for the logged-in
// dashboard hero further down, where a slower first paint doesn't cost a
// visitor who hasn't signed up yet).
function landingHeroIllustration() {
  return `<svg class="landing-shoe" viewBox="0 0 400 400" aria-hidden="true">
<defs>
  <radialGradient id="lh-glow" cx="50%" cy="46%" r="55%">
    <stop offset="0%" stop-color="#FFC24E" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="#FFC24E" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="lh-shoe" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#FFD98A"/>
    <stop offset="55%" stop-color="#FFC24E"/>
    <stop offset="100%" stop-color="#FF8A3D"/>
  </linearGradient>
  <radialGradient id="lh-shadow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#000000" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
  </radialGradient>
</defs>
<circle cx="200" cy="190" r="180" fill="url(#lh-glow)"/>
<ellipse cx="200" cy="330" rx="130" ry="18" fill="url(#lh-shadow)"/>
<circle cx="200" cy="190" r="150" fill="none" stroke="#FFC24E" stroke-opacity="0.22" stroke-width="1.5"/>
<circle cx="78" cy="120" r="3" fill="#FFC24E" opacity="0.5"/>
<circle cx="330" cy="260" r="4" fill="#4E9BFF" opacity="0.5"/>
<circle cx="60" cy="260" r="2.5" fill="#4E9BFF" opacity="0.4"/>
<circle cx="340" cy="110" r="2.5" fill="#FFC24E" opacity="0.4"/>
<g transform="translate(40 60) scale(13.3)">
  <path d="M2.5 16.2c0-1.1.9-1.9 1.9-2 .7-2.9 3.6-6.7 6.8-6.7.9 0 1.7.5 2.5 1.2l4.6 2.1c1.4.6 2.7 1.9 2.7 3.6v1.1c0 1.3-1 2.3-2.3 2.3H4.3c-1 0-1.8-.8-1.8-1.6z" fill="url(#lh-shoe)"/>
  <path d="M8 12.4c1.1-2.1 3.1-3.9 5.3-4.2" stroke="#150c05" stroke-width=".5" fill="none" opacity=".3" stroke-linecap="round"/>
  <path d="M16.5 13.4c1.6.2 3 .9 3.9 1.9" stroke="#150c05" stroke-width=".4" fill="none" opacity=".22" stroke-linecap="round"/>
  <path d="M4.6 14.3c3-3.6 6.6-6 11.4-6.5" stroke="#fff" stroke-width=".35" fill="none" opacity=".4" stroke-linecap="round"/>
</g>
</svg>`;
}

function landingPage() {
  const features = [
    { icon: 'stopwatch', title: 'Treinos', text: 'Registre manualmente ou sincronize com o Strava — pace, FC, splits km a km e estrutura de tiros, tudo organizado.' },
    { icon: 'chat', title: 'Coach de corrida com IA', text: 'Um treinador que conhece seu histórico, monta treinos com embasamento técnico e te manda até uma imagem pra consultar durante a corrida.' },
    { icon: 'flame', title: 'Feed', text: 'Compartilhe treinos, reaja com 👏🔥🏆💪 e acompanhe o que a galera que você segue está treinando.' },
    { icon: 'trophy', title: 'Provas e evolução', text: 'Calendário de provas, medalhas por distância e sua evolução de volume e pace mês a mês.' },
  ];
  const body = `
<section class="landing-hero">
  <div class="landing-hero-copy">
    <div class="hero-eyebrow">Treino, feed e coach de corrida com IA</div>
    <h1 class="landing-h1">Corra com dados.<br>Não com achismo.</h1>
    <p class="lede landing-lede">O Atletas junta seus treinos, sua evolução e um coach de corrida com IA num só lugar — e uma comunidade pra te acompanhar no caminho até a sua próxima prova.</p>
    <div class="landing-cta-row">
      <a class="btn" href="/signup">Criar minha conta</a>
      <a class="btn ghost" href="/login">Já tenho conta</a>
    </div>
  </div>
  <div class="landing-hero-art">${landingHeroIllustration()}</div>
</section>

<section class="landing-features">
  ${features.map((f) => `<div class="card landing-feature">
    <div class="icon-badge">${icon(f.icon)}</div>
    <h2 style="margin-top:10px;">${esc(f.title)}</h2>
    <p class="muted" style="margin:0;">${esc(f.text)}</p>
  </div>`).join('')}
</section>

<section class="landing-cta-final card">
  <h2 style="margin-bottom:6px;">Cada atleta tem um número.</h2>
  <p class="muted" style="margin:0 0 18px;">No cadastro você passa por um pré-diagnóstico rápido e recebe o seu — simples assim.</p>
  <a class="btn" href="/signup">Criar minha conta</a>
</section>
`;
  return layout({ title: 'Atletas', user: null, body, navVariant: 'public', wrapClass: 'landing-wrap' });
}

const HERO_EXTRA_HEAD = `<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js" defer></script>`;

const HERO_SCRIPT = `<script defer>
(function(){
  function boot(){
    try {
      var canvas = document.getElementById('hero-canvas');
      var hero = canvas ? canvas.closest('.hero') : null;
      var badge = document.getElementById('hero-badge');
      var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // Badge parallax is independent of the WebGL scene below, so the shoe
      // token still tilts with the cursor even if Three.js fails to load.
      if (hero && badge && !reduced) {
        hero.addEventListener('mousemove', function(e){
          var r = hero.getBoundingClientRect();
          var px = ((e.clientX - r.left) / r.width - 0.5) * 2;
          var py = ((e.clientY - r.top) / r.height - 0.5) * 2;
          badge.style.transform = 'perspective(600px) rotateX(' + (py * 10) + 'deg) rotateY(' + (px * -10) + 'deg) translate(' + (px * -6) + 'px,' + (py * -6) + 'px)';
        });
        hero.addEventListener('mouseleave', function(){ badge.style.transform = ''; });
      }

      if (!canvas || !hero || typeof THREE === 'undefined') return;

      var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      var accent = dark ? 0xffc24e : 0xffae5c;
      var accent2 = dark ? 0x4e9bff : 0x6fa8ff;

      var renderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
      } catch (e) { return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      if ('toneMapping' in renderer) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
      }

      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
      camera.position.set(1.7, 1.4, 6.0);

      // ---- studio three-point lighting, tuned for a product-shot showcase
      // rather than an outdoor scene: soft ambient fill, a strong key light
      // that casts the contact shadow, a cool fill opposite it, and a warm
      // rim light behind to separate the shoe from the dark background.
      scene.add(new THREE.HemisphereLight(dark ? 0x4a5568 : 0xffffff, 0x0b0906, 0.55));
      var key = new THREE.DirectionalLight(0xfff3e0, 1.9);
      key.position.set(2.4, 3.6, 2.8);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -2; key.shadow.camera.right = 2;
      key.shadow.camera.top = 2; key.shadow.camera.bottom = -2;
      key.shadow.camera.near = 1; key.shadow.camera.far = 10;
      key.shadow.bias = -0.0025;
      scene.add(key);
      var fill = new THREE.DirectionalLight(accent2, 0.5);
      fill.position.set(-3, 1.4, 1.6);
      scene.add(fill);
      var rim = new THREE.PointLight(accent, 1.5, 14);
      rim.position.set(-1.6, 1.8, -3.2);
      scene.add(rim);
      var rim2 = new THREE.PointLight(0xffffff, 0.8, 12);
      rim2.position.set(1.8, 0.6, -2.6);
      scene.add(rim2);

      // A tiny procedural equirectangular gradient, converted to a PMREM env
      // map — gives the shoe's leather/rubber/metal materials real-looking
      // reflections without needing an external HDRI file.
      try {
        var pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
        var envCanvas = document.createElement('canvas');
        envCanvas.width = 4; envCanvas.height = 128;
        var ectx = envCanvas.getContext('2d');
        var grad = ectx.createLinearGradient(0, 0, 0, 128);
        grad.addColorStop(0, '#4a3d2e');
        grad.addColorStop(0.45, '#1c1712');
        grad.addColorStop(1, '#030201');
        ectx.fillStyle = grad;
        ectx.fillRect(0, 0, 4, 128);
        var envTex = new THREE.CanvasTexture(envCanvas);
        envTex.mapping = THREE.EquirectangularReflectionMapping;
        if ('encoding' in envTex) envTex.encoding = THREE.sRGBEncoding;
        scene.environment = pmrem.fromEquirectangular(envTex).texture;
        envTex.dispose();
        pmrem.dispose();
      } catch (e) { /* reflections are a nice-to-have, safe to skip */ }

      // Low halo ring + particle field beneath the shoe — an abstract
      // "data plane" echoing the rest of the dashboard, not the main subject.
      var group = new THREE.Group();
      scene.add(group);

      var ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.3, 0.02, 16, 120),
        new THREE.MeshStandardMaterial({ color: accent, roughness: 0.35, metalness: 0.5 })
      );
      ring.rotation.x = Math.PI / 2.15;
      group.add(ring);

      var dotCount = 50;
      var dotGeo = new THREE.BufferGeometry();
      var positions = new Float32Array(dotCount * 3);
      for (var i = 0; i < dotCount; i++) {
        var angle = (i / dotCount) * Math.PI * 2;
        var radius = 1.3 + (Math.random() - 0.5) * 0.3;
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 0.2;
        positions[i * 3 + 2] = Math.sin(angle) * radius;
      }
      dotGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      var dots = new THREE.Points(dotGeo, new THREE.PointsMaterial({ color: accent, size: 0.04 }));
      group.add(dots);

      // Soft contact shadow beneath the shoe — a ShadowMaterial plane stays
      // fully transparent except where the key light's shadow falls, so it
      // reads as a grounded contact shadow against the transparent canvas.
      var shadowPlane = new THREE.Mesh(
        new THREE.CircleGeometry(1.1, 32),
        new THREE.ShadowMaterial({ opacity: 0.45 })
      );
      shadowPlane.rotation.x = -Math.PI / 2;
      shadowPlane.position.y = 0.001;
      shadowPlane.receiveShadow = true;
      scene.add(shadowPlane);

      // ---- AI core: a small geometric "AI" orb hovering above the shoe —
      // a wireframe icosahedron with a glowing center, orbiting satellites,
      // and a pulsing energy tether running down to the product. Reads as
      // "the AI, powered by the shoe" rather than a literal figure.
      var orbGroup = new THREE.Group();
      scene.add(orbGroup);
      var orbBaseY = 1.6; // replaced once the shoe's real height is known

      var orbCore = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 24, 24),
        new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      orbGroup.add(orbCore);

      var orbWire = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.23, 1),
        new THREE.MeshBasicMaterial({ color: accent2, wireframe: true, transparent: true, opacity: 0.85 })
      );
      orbGroup.add(orbWire);

      var satellites = [];
      for (var si = 0; si < 3; si++) {
        var sat = new THREE.Mesh(
          new THREE.SphereGeometry(0.03, 12, 12),
          new THREE.MeshBasicMaterial({ color: si % 2 ? accent : accent2 })
        );
        satellites.push({ mesh: sat, r: 0.36 + si * 0.08, speed: 0.55 + si * 0.3, offset: si * 2.1, incl: 0.3 + si * 0.22 });
        orbGroup.add(sat);
      }

      function makeGlowSprite(colorHex, size) {
        var c = document.createElement('canvas');
        c.width = c.height = 64;
        var ctx = c.getContext('2d');
        var g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        var col = '#' + colorHex.toString(16).padStart(6, '0');
        g.addColorStop(0, col);
        g.addColorStop(0.4, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        var sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
        sprite.scale.set(size, size, 1);
        return sprite;
      }

      var tetherCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0.7, 0),
        new THREE.Vector3(0.12, 1.05, 0.08),
        new THREE.Vector3(0.08, 1.35, 0)
      );
      var tetherMesh = new THREE.Mesh(
        new THREE.TubeGeometry(tetherCurve, 24, 0.005, 6, false),
        new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.5 })
      );
      scene.add(tetherMesh);
      var tetherPulse = makeGlowSprite(accent, 0.12);
      scene.add(tetherPulse);

      var mouseX = 0, mouseY = 0;
      hero.addEventListener('mousemove', function(e){
        var r = hero.getBoundingClientRect();
        mouseX = ((e.clientX - r.left) / r.width - 0.5) * 2;
        mouseY = ((e.clientY - r.top) / r.height - 0.5) * 2;
      });

      function resize() {
        var w = hero.clientWidth, h = hero.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      resize();
      if ('ResizeObserver' in window) {
        new ResizeObserver(resize).observe(hero);
      } else {
        window.addEventListener('resize', resize);
      }

      function renderFrame() { renderer.render(scene, camera); }

      // ---- product: a real, high-quality PBR sneaker model (leather, mesh
      // and rubber materials, proper UVs) loaded via glTF — floating and
      // slowly rotating like a premium product-showcase render, instead of
      // an isolated running figure.
      var shoe = null;
      var lookTarget = new THREE.Vector3(0, 1.1, 0);
      var hoverBase = 0.16;

      if (typeof THREE.GLTFLoader === 'function') {
        try {
          var loader = new THREE.GLTFLoader();
          loader.load(
            'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/MaterialsVariantsShoe/glTF-Binary/MaterialsVariantsShoe.glb',
            function (gltf) {
              try {
                var model = gltf.scene;
                model.traverse(function (o) {
                  if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
                });

                // Auto-fit: normalize whatever native scale/units the model
                // ships with to a fixed on-screen size, centered on its own
                // footprint, instead of hand-tuned position/scale guesses.
                var box = new THREE.Box3().setFromObject(model);
                var size = box.getSize(new THREE.Vector3());
                var maxDim = Math.max(size.x, size.y, size.z) || 1;
                var targetSize = 2.1;
                var scale = targetSize / maxDim;
                model.scale.setScalar(scale);

                box.setFromObject(model);
                var center = box.getCenter(new THREE.Vector3());
                model.position.x -= center.x;
                model.position.z -= center.z;
                model.position.y -= box.min.y; // rest on the ground plane
                model.position.y += hoverBase; // then lift slightly, floating

                model.rotation.y = Math.PI * 0.15;
                model.rotation.z = -0.12;

                box.setFromObject(model);
                var fitted = box.getSize(new THREE.Vector3());
                var shoeTop = box.min.y + fitted.y;
                lookTarget.set(0.05, shoeTop + 0.2, 0);

                // anchor the AI orb and its tether to the shoe's real
                // (auto-fitted) top, instead of the placeholder guess used
                // before the model's actual size was known.
                orbBaseY = shoeTop + 0.5;
                orbGroup.position.set(0.1, orbBaseY, 0);
                tetherCurve.v0.set(0, shoeTop - 0.05, 0);
                tetherCurve.v1.set(0.12, shoeTop + 0.28, 0.08);
                tetherCurve.v2.set(0.08, shoeTop + 0.5, 0);
                tetherMesh.geometry.dispose();
                tetherMesh.geometry = new THREE.TubeGeometry(tetherCurve, 24, 0.005, 6, false);

                shoe = model;
                scene.add(model);
              } catch (e) { console.error('[dbg]', e); }
            },
            undefined,
            function (err) { console.error('[dbg]', err); }
          );
        } catch (e) { console.error('[dbg]', e); }
      }

      if (reduced) { renderFrame(); return; }

      var clock = new THREE.Clock();
      var t = 0;

      function animate() {
        var dt = Math.min(0.05, clock.getDelta());
        t += dt;

        group.rotation.y += dt * 0.2;
        ring.rotation.z += dt * 0.1;

        if (shoe) {
          shoe.rotation.y += dt * 0.35;
          shoe.position.y = hoverBase + Math.sin(t * 1.1) * 0.07;
        }

        orbWire.rotation.y += dt * 0.6;
        orbWire.rotation.x += dt * 0.2;
        orbGroup.position.y = orbBaseY + Math.sin(t * 1.3) * 0.05;
        for (var si2 = 0; si2 < satellites.length; si2++) {
          var s = satellites[si2];
          var a = t * s.speed + s.offset;
          s.mesh.position.set(Math.cos(a) * s.r, Math.sin(a * 0.7) * s.r * s.incl, Math.sin(a) * s.r);
        }
        var tp = tetherCurve.getPointAt((t * 0.6) % 1);
        tetherPulse.position.copy(tp);

        camera.position.x += (1.7 + mouseX * 1.0 - camera.position.x) * 0.04;
        camera.position.y += (1.4 - mouseY * 0.35 - camera.position.y) * 0.04;
        camera.lookAt(lookTarget);

        renderFrame();
        requestAnimationFrame(animate);
      }
      requestAnimationFrame(animate);
    } catch (e) { console.error('[dbg]', e); }
  }
  if (document.readyState === 'complete') { boot(); }
  else { window.addEventListener('load', boot); }
})();
</script>`;

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

function dashboardPage({ user, nextRace, daysToRace, recentActivities, weekKm, evolution, medals, calendar }) {
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
  <canvas id="hero-canvas"></canvas>
  <div class="hero-overlay"></div>
  <div class="hero-badge" id="hero-badge"><span class="hero-badge-glow"></span>${icon('shoe', 'hero')}</div>
  <div class="hero-content">
    <div class="hero-eyebrow">Rumo à Maratona de Curitiba</div>
    <h1>Olá, ${esc(user.name.split(' ')[0])}</h1>
    <p class="lede">${user.city ? esc(user.city) + ' · ' : ''}${user.goal_race_name ? 'Meta: ' + esc(user.goal_race_name) : 'Defina sua meta em Config'}</p>
    ${user.bio ? `<p class="hero-bio">${esc(user.bio)}</p>` : `<p class="hero-bio hero-bio-empty"><a href="/settings">+ Conte um pouco sobre você como corredor(a) →</a></p>`}
  </div>
</section>

<div class="grid cols-4">
  <div class="card stat"><div class="icon-badge">${icon('calendar')}</div><div class="k">Dias p/ prova</div><div class="v">${daysToRace != null ? daysToRace : '—'}</div></div>
  <div class="card stat"><div class="icon-badge">${icon('stopwatch')}</div><div class="k">Meta de tempo</div><div class="v">${user.goal_time_sec ? fmtClock(user.goal_time_sec) : '—'}</div></div>
  <div class="card stat"><div class="icon-badge">${icon('flame')}</div><div class="k">Km na semana</div><div class="v">${weekKm.toFixed(1)}<span class="u">km</span></div></div>
  <div class="card stat"><div class="icon-badge">${icon('trophy')}</div><div class="k">Treinos registrados</div><div class="v">${recentActivities.length ? recentActivities.length + '+' : '0'}</div></div>
</div>

${medals ? `<div class="card">
  <h2><span class="h-icon">${icon('trophy', 'dashmedals')}</span>Medalhas</h2>
  ${medalRow(medals)}
</div>` : ''}

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
  return layout({ title: 'Perfil', user, body, active: 'home', extraHead: HERO_EXTRA_HEAD, bodyEnd: HERO_SCRIPT });
}

function racesPage(user, races, nearbyRaces, added, region, customQuery) {
  nearbyRaces = nearbyRaces || [];
  region = region || 'auto';
  customQuery = customQuery || '';
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
        <div class="race-ext-buttons">
          <a class="btn ghost xs" href="${r.registrationUrl || `https://www.google.com/search?q=${encodeURIComponent('inscrição ' + r.name)}`}" target="_blank" rel="noopener noreferrer">Inscrição ↗</a>
          ${already ? `<span class="pill">No calendário</span>` : `
          <form method="POST" action="/races/quickadd">
            <input type="hidden" name="name" value="${esc(r.name)}">
            <input type="hidden" name="race_date" value="${esc(isoDate)}">
            <input type="hidden" name="distance_km" value="${longest || ''}">
            <input type="hidden" name="city" value="${esc(r.city || '')}">
            <button class="ghost" type="submit">+ Agenda</button>
          </form>`}
        </div>
      </div>
    </div>`;
  }).join('') : `<p class="muted" style="margin:0;">Nenhuma corrida encontrada${region === 'custom' && !customQuery ? '' : ' nessa região'} no momento.</p>`;

  const regionOptions = [
    { value: 'auto', label: autoRegionLabel(user.city) },
    { value: 'litoral', label: REGION_LABELS.litoral },
    { value: 'pr', label: REGION_LABELS.pr },
    { value: 'custom', label: REGION_LABELS.custom + '...' },
  ].map(o => `<option value="${o.value}"${region === o.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('');

  const regionHeading = region === 'litoral' ? ' no litoral do Paraná'
    : region === 'pr' ? ' no Paraná'
    : region === 'custom' ? (customQuery ? ' em ' + esc(customQuery) : '')
    : ' em ' + esc(autoRegionLabel(user.city));

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
  <div class="race-region-head">
    <h2><span class="h-icon">${icon('pin', 'near')}</span>Provas nos próximos 60 dias${regionHeading}</h2>
    <form method="GET" action="/races" class="race-region-form">
      <select name="region" onchange="this.form.submit()">${regionOptions}</select>
      ${region === 'custom' ? `<input type="text" name="q" placeholder="Cidade, UF" value="${esc(customQuery)}"><button class="ghost xs" type="submit">Buscar</button>` : ''}
    </form>
  </div>
  ${nearbyHtml}
  <p class="race-source">Dados via Corrida Perfeita.${region === 'auto' && !user.city ? ' Defina sua cidade em <a href="/settings">Config</a> para ver corridas perto de você.' : ' "Inscrição" leva à busca pela página oficial da prova; "+ Agenda" inclui no seu calendário aqui no app.'}</p>
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
    <div class="list-item activity-row">
      <a class="activity-row-link" href="/activities/${a.id}">
        <div><div class="t">${esc(a.title)}${a.source === 'strava' ? ' <span class="muted mono" style="font-size:11px;">· strava</span>' : ''}</div><div class="d">${fmtDate(a.started_at || a.created_at)} · ${a.distance_km ? a.distance_km + 'km' : '—'} ${a.duration_sec ? '· ' + fmtClock(a.duration_sec) : ''} ${a.avg_pace_sec ? '· ' + secToPace(a.avg_pace_sec) + '/km' : ''}</div></div>
        <span class="pill"><span class="dot"></span>${esc(a.workout_type || 'treino')}</span>
      </a>
      <a class="btn ghost xs activity-row-publish" href="/feed?share_activity=${a.id}" title="Publicar este treino no feed">${icon('chat', 'pub' + a.id)}Publicar</a>
    </div>`).join('') : `<p class="muted" style="margin:0;">Nenhum treino registrado ainda.</p>`}
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

function activityDetailPage({ user, activity, laps, intervals, evolution, prInfo, alreadyShared, aiEnabled }) {
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
      const rows = [`<div class="bar-tip-row"><span>Pace</span><strong>${secToPace(b.pace_sec)}/km</strong></div>`];
      rows.push(`<div class="bar-tip-row"><span>Distância</span><strong>${esc(b.distanceLabel)}</strong></div>`);
      rows.push(`<div class="bar-tip-row"><span>Tempo</span><strong>${fmtClock(b.moving_time_sec)}</strong></div>`);
      if (b.avg_hr) rows.push(`<div class="bar-tip-row"><span>FC média</span><strong>${b.avg_hr} bpm</strong></div>`);
      if (tiros.avgPaceSec) {
        const diff = Math.round(b.pace_sec - tiros.avgPaceSec);
        if (diff !== 0) rows.push(`<div class="bar-tip-row"><span>${diff < 0 ? 'Mais rápido' : 'Mais lento'}</span><strong>${secToPace(Math.abs(diff))}/km</strong></div>`);
      }
      return `<div class="tiro-bar${b.isFastest ? ' best' : ''}" style="height:${h}%;" tabindex="0"><div class="bar-tip"><div class="bar-tip-title">Tiro ${b.idx}${b.isFastest ? ' · mais rápido' : ''}</div>${rows.join('')}</div>
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

${prInfo && prInfo.isPR ? `<div class="card pr-banner">
  <div class="pr-banner-icon">${icon('trophy', 'prb')}</div>
  <div class="pr-banner-text">
    <div class="pr-banner-title">Recorde pessoal!</div>
    <p class="muted" style="margin:2px 0 0;">${esc(prInfo.label)}</p>
  </div>
  ${alreadyShared ? `<span class="muted mono" style="font-size:12px;">Já compartilhado</span>` : `<a class="btn" href="/feed?share_activity=${activity.id}&pr=1">Compartilhar</a>`}
</div>` : ''}

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
    <a class="${alreadyShared ? 'ghost ' : ''}btn" href="/feed?share_activity=${activity.id}">${alreadyShared ? 'Compartilhar de novo' : 'Compartilhar no feed'}</a>
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
      suggestions: ['Analise esse treino', 'O que eu preciso melhorar nesse treino?', 'Como foi meu ritmo comparado à meta?'],
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

// Cycles avatar background through a few of the app's existing accent
// colors (blue/green/red/amber/purple, on top of the default accent/accent-2
// pair) so the feed reads as a feed of different people at a glance instead
// of a wall of identical orange circles. Purely cosmetic — same user always
// gets the same color since it's derived from their id, never random.
function avatarColorClass(userId) {
  const n = (userId || 0) % 6;
  return n ? ` c${n}` : '';
}

// Renders a real profile photo when the athlete has uploaded one (Settings),
// falling back to the initials-on-gradient circle otherwise — one call site
// so every avatar in the app (feed, comments, composer, public profile)
// switches over the same way once a photo is set.
function avatarHtml(name, userId, avatarPath, extraClass) {
  const cls = `post-avatar${extraClass ? ' ' + extraClass : ''}`;
  if (avatarPath) return `<img class="${cls}" src="/uploads/${esc(avatarPath)}" alt="${esc(name || '')}">`;
  return `<div class="${cls}${avatarColorClass(userId)}">${esc(initials(name))}</div>`;
}

// Small icon per workout type so an auto-post's header reads at a glance —
// falls back to a plain running shoe for anything not specifically mapped
// (manual "outro" entries, unrecognized Strava workout-type labels, etc.).
function workoutTypeIcon(workoutType) {
  const t = (workoutType || '').toLowerCase();
  if (t.includes('interval')) return 'flame';
  if (t.includes('long')) return 'mountain';
  if (t.includes('ritmo') || t.includes('tempo')) return 'stopwatch';
  return 'shoe';
}

// When a post is linked to an activity the athlete explicitly chose to
// publish (p.is_auto, set only via "Compartilhar no feed"), the card shows
// the run's own stats instead of a typed caption, closer to how Strava's
// activity stream reads than a blank-textarea social post.
function activityStatBlock(p) {
  const stats = [
    p.activity_distance_km != null ? [`${p.activity_distance_km}`, 'km', 'Distância'] : null,
    p.activity_duration_sec != null ? [fmtClock(p.activity_duration_sec), '', 'Tempo'] : null,
    p.activity_avg_pace_sec != null ? [secToPace(p.activity_avg_pace_sec), '/km', 'Pace'] : null,
    p.activity_elevation_gain_m ? [Math.round(p.activity_elevation_gain_m), 'm', 'Elevação'] : null,
  ].filter(Boolean);
  return `<a class="post-activity-head" href="/activities/${p.activity_id}">
    <span class="post-activity-icon">${icon(workoutTypeIcon(p.activity_workout_type), 'wt' + p.id)}</span>
    <span class="post-activity-headtext">
      <span class="post-activity-title">${esc(p.activity_title)}</span>
      <span class="post-activity-type">${esc(p.activity_workout_type || 'treino')}${p.activity_source === 'strava' ? ' · Strava' : ''}</span>
    </span>
  </a>
  ${stats.length ? `<div class="post-stats">${stats.map(([v, u, k]) => `<div class="post-stat"><div class="v">${esc(String(v))}${u ? `<span class="u">${esc(u)}</span>` : ''}</div><div class="k">${esc(k)}</div></div>`).join('')}</div>` : ''}`;
}

// Reaction picker: a <details>/<summary> disclosure (same idiom as the
// title-edit toggle above) so tapping the summary reveals the 4 reaction
// types without a page reload feeling necessary — each option is still a
// plain POST form under the hood, so it works with JS fully off too (the
// menu just starts open-by-click instead of hover). return_to carries the
// current feed scope/page back through the redirect (see safePath in
// lib/social.js) so reacting from page 2 of "Seguindo" doesn't bounce you
// back to page 1 of "Todos".
function reactionPicker(p, returnTo) {
  const counts = p.reactionCounts || {};
  const mine = p.myReactions || new Set();
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const summaryContent = total > 0
    ? `${REACTION_TYPES.filter((r) => counts[r.key]).map((r) => r.emoji).join('')} <span>${total}</span>`
    : `${icon('flame', 'k' + p.id)}<span>Reagir</span>`;
  return `<details class="reaction-picker">
    <summary class="reaction-summary${mine.size ? ' active' : ''}">${summaryContent}</summary>
    <div class="reaction-menu">
      ${REACTION_TYPES.map((r) => `<form method="POST" action="/feed/${p.id}/react">
        <input type="hidden" name="type" value="${r.key}">
        <input type="hidden" name="return_to" value="${esc(returnTo)}">
        <button class="reaction-opt${mine.has(r.key) ? ' active' : ''}" type="submit">${r.emoji} <span>${r.label}</span>${counts[r.key] ? ` <span class="reaction-count">${counts[r.key]}</span>` : ''}</button>
      </form>`).join('')}
    </div>
  </details>`;
}

function postCard(user, p, returnTo) {
  const mine = p.user_id === user.id;
  const comments = p.comments || [];
  returnTo = returnTo || '/feed';
  return `<div class="card post-card${p.is_auto ? ' post-card-auto' : ''}">
  <div class="post-head">
    ${avatarHtml(p.author_name, p.user_id, p.author_avatar_path)}
    <div class="post-head-meta">
      <div class="post-name">${p.author_slug ? `<a href="/u/${esc(p.author_slug)}">${esc(p.author_name)}</a>` : esc(p.author_name)}${mine ? ' <span class="pill">você</span>' : ''}<span class="post-verb muted">${p.is_auto ? 'completou um treino' : 'compartilhou'}</span></div>
      <div class="post-time" title="${esc(fmtDate(p.created_at))}">${timeAgo(p.created_at)}</div>
    </div>
    ${p.is_pr ? `<span class="pill pr-badge">${icon('trophy', 'pr' + p.id)}Recorde</span>` : ''}
  </div>
  ${p.is_auto ? activityStatBlock(p) : `
  <div class="post-body">${esc(p.body).replace(/\n/g, '<br>')}</div>
  ${p.photo_path ? `<div class="post-photo"><img src="/uploads/${esc(p.photo_path)}" alt="" loading="lazy"></div>` : ''}
  ${p.activity_title ? `<a class="pill post-activity-pill" href="/activities/${p.activity_id}"><span class="dot"></span>${esc(p.activity_title)}</a>` : ''}
  `}
  <div class="post-actions">
    ${reactionPicker(p, returnTo)}
    <span class="post-comment-count">${icon('chat', 'c' + p.id)}<span>${comments.length}</span></span>
  </div>
  ${comments.length ? `<div class="post-comments">
    ${comments.map((c) => `<div class="comment-item">${avatarHtml(c.author_name, c.user_id, c.author_avatar_path, 'comment-avatar')}<span class="comment-main"><span class="comment-author">${esc(c.author_name)}</span> <span class="comment-body">${esc(c.body)}</span><span class="comment-time">${timeAgo(c.created_at)}</span></span></div>`).join('')}
  </div>` : ''}
  <form method="POST" action="/feed/${p.id}/comment" class="comment-form">
    ${avatarHtml(user.name, user.id, user.avatar_path, 'comment-avatar')}
    <input type="text" name="body" placeholder="Comentar..." required maxlength="500">
    <input type="hidden" name="return_to" value="${esc(returnTo)}">
    <button class="ghost" type="submit">Enviar</button>
  </form>
</div>`;
}

function feedPage(user, posts, opts) {
  opts = opts || {};
  const scope = opts.scope === 'following' ? 'following' : 'all';
  const returnQs = [scope === 'following' ? 'scope=following' : null, opts.beforeId ? `before_id=${opts.beforeId}` : null].filter(Boolean).join('&');
  const returnTo = '/feed' + (returnQs ? `?${returnQs}` : '');
  const isPr = !!opts.isPrShare;

  const scopeTabs = `<div class="feed-tabs">
    <a class="feed-tab${scope === 'all' ? ' active' : ''}" href="/feed">Todos</a>
    <a class="feed-tab${scope === 'following' ? ' active' : ''}" href="/feed?scope=following">Seguindo</a>
  </div>`;

  const recentChips = (opts.recentUnshared && opts.recentUnshared.length) ? `<div class="composer-recent">
    <span class="muted mono" style="font-size:12px;">Compartilhar um treino recente:</span>
    <div class="composer-recent-chips">
      ${opts.recentUnshared.map((a) => `<a class="pill composer-recent-chip" href="/feed?share_activity=${a.id}${scope === 'following' ? '&scope=following' : ''}"><span class="dot"></span>${esc(a.title)}${a.distance_km != null ? ` · ${a.distance_km}km` : ''}</a>`).join('')}
    </div>
  </div>` : '';

  const pagination = opts.nextBeforeId ? `<div class="feed-pagination">
    <a class="ghost btn" href="/feed?before_id=${opts.nextBeforeId}${scope === 'following' ? '&scope=following' : ''}">Ver mais treinos antigos →</a>
  </div>` : '';

  const body = `
<h1>Feed</h1>
<p class="lede">O que a galera está treinando.</p>
${scopeTabs}
<div class="card feed-composer">
  <form method="POST" action="/feed" enctype="multipart/form-data" id="composerForm">
    <div class="composer-row">
      ${avatarHtml(user.name, user.id, user.avatar_path, 'composer-avatar')}
      <div class="composer-main">
        ${opts.shareActivity ? `<div class="pill${isPr ? ' pr-badge' : ''}" style="margin-bottom:10px;"><input type="hidden" name="activity_id" value="${opts.shareActivity.id}">${isPr ? '<input type="hidden" name="is_pr" value="1">' : ''}${isPr ? icon('trophy', 'cpr2') : '<span class="dot"></span>'}${isPr ? 'Recorde pessoal: ' : 'Vinculado a: '}${esc(opts.shareActivity.title)}</div>` : ''}
        ${!opts.shareActivity ? recentChips : ''}
        <textarea name="body" placeholder="Compartilhe algo..." required>${opts.shareDraft ? esc(opts.shareDraft) : ''}</textarea>
        <div id="composerPreviewWrap" class="composer-preview-wrap" hidden>
          <img id="composerPreview" alt="">
          <button type="button" id="composerPreviewRemove" class="composer-preview-remove" aria-label="Remover foto">${icon('close', 'cpr')}</button>
        </div>
        <div class="row" style="margin-top:12px; justify-content:space-between;">
          <label class="photo-input-label">
            <input type="file" name="photo" id="composerPhotoInput" accept="image/*" style="display:none;">
            <span class="ghost btn photo-btn" id="composerPhotoLabel">${icon('camera', 'cpl')}Adicionar foto</span>
          </label>
          <button type="submit">Postar</button>
        </div>
      </div>
    </div>
  </form>
</div>
${posts.length ? `<div class="feed-list">${posts.map((p) => postCard(user, p, returnTo)).join('')}</div>` : `<div class="card feed-empty">
  <div class="feed-empty-icon">${icon('flame', 'fe1')}</div>
  <p style="margin:0; font-weight:800;">${scope === 'following' ? 'Ninguém que você segue postou ainda' : 'Nenhum post ainda'}</p>
  <p class="muted" style="margin:4px 0 0;">${scope === 'following' ? 'Siga outros atletas pelo perfil público deles para ver os treinos aqui.' : 'Seja o primeiro a compartilhar um treino com a galera.'}</p>
</div>`}
${pagination}
<script defer>
(function(){
  try {
    var input = document.getElementById('composerPhotoInput');
    var label = document.getElementById('composerPhotoLabel');
    var wrap = document.getElementById('composerPreviewWrap');
    var img = document.getElementById('composerPreview');
    var removeBtn = document.getElementById('composerPreviewRemove');
    if (!input || !label || !wrap || !img || !removeBtn) return;
    var labelDefault = label.innerHTML;
    input.addEventListener('change', function(){
      var file = input.files && input.files[0];
      if (!file) return;
      img.src = URL.createObjectURL(file);
      wrap.hidden = false;
      label.textContent = file.name;
    });
    removeBtn.addEventListener('click', function(){
      input.value = '';
      wrap.hidden = true;
      img.src = '';
      label.innerHTML = labelDefault;
    });
  } catch (e) { console.error('[dbg]', e); }
})();
</script>
`;
  return layout({ title: 'Feed', user, body, active: 'feed' });
}

// Distance medals (5K/10K/Meia/Maratona) — locked ones render dimmed with a
// lock icon so they read as something to unlock rather than random missing
// icons; an unlocked one is tappable/hoverable (title attr) to say which run
// earned it. See computeMedals in lib/stats.js for how "achieved" works.
const MEDAL_ICON = { '5K': 'shoe', '10K': 'flame', '21K': 'stopwatch', '42K': 'trophy' };
function medalRow(medals) {
  return `<div class="medal-row">
    ${medals.map((m) => `<div class="medal-chip${m.achieved ? ' achieved' : ' locked'}" title="${m.achieved ? esc(`${m.label} — ${m.activity.title}, ${fmtDate(m.activity.started_at || m.activity.created_at)}`) : esc(`${m.label} — ainda não`)}">
      <span class="medal-icon">${icon(MEDAL_ICON[m.short] || 'trophy', 'md' + m.short)}</span>
      <span class="medal-label">${esc(m.short)}</span>
    </div>`).join('')}
  </div>`;
}

function publicProfilePage(viewer, profileUser, evolution, races, medals, social) {
  social = social || {};
  const weekKm = evolution.weeks.length ? evolution.weeks[evolution.weeks.length - 1].km : 0;
  const longestKm = evolution.longest ? evolution.longest.distance_km : null;
  const bestPaceSec = evolution.bestPace ? evolution.bestPace.avg_pace_sec : null;
  const canFollow = !!viewer && viewer.id !== profileUser.id;
  const body = `
<div class="card profile-hero">
  ${avatarHtml(profileUser.name, profileUser.id, profileUser.avatar_path, 'profile-avatar')}
  <div>
    <h1 style="margin:0 0 4px;">${esc(profileUser.name)}</h1>
    ${profileUser.city ? `<p class="muted" style="margin:0 0 6px;">${esc(profileUser.city)}</p>` : ''}
    ${profileUser.bio ? `<p style="margin:0;">${esc(profileUser.bio)}</p>` : ''}
    ${profileUser.goal_race_name ? `<div class="pill" style="margin-top:10px;"><span class="dot"></span>Meta: ${esc(profileUser.goal_race_name)}${profileUser.goal_time_sec ? ` em ${fmtClock(profileUser.goal_time_sec)}` : ''}</div>` : ''}
    <p class="muted follow-counts" style="margin-top:10px;"><strong>${social.followerCount || 0}</strong> seguidores · <strong>${social.followingCount || 0}</strong> seguindo</p>
  </div>
  ${canFollow ? `<form method="POST" action="/u/${esc(profileUser.public_slug)}/follow" class="follow-form">
    <input type="hidden" name="return_to" value="/u/${esc(profileUser.public_slug)}">
    <button class="${social.isFollowing ? 'ghost' : ''} btn" type="submit">${social.isFollowing ? 'Seguindo ✓' : 'Seguir'}</button>
  </form>` : ''}
</div>

${medals ? `<div class="card">
  <h2><span class="h-icon">${icon('trophy', 'ppmedals')}</span>Medalhas</h2>
  ${medalRow(medals)}
</div>` : ''}

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

function discoverPage(viewer, athletes, q) {
  const rows = athletes.map(({ user: u, evolution, followerCount, isFollowing }) => `
    <div class="card discover-row">
      <a href="/u/${esc(u.public_slug)}" class="discover-row-link">
        ${avatarHtml(u.name, u.id, u.avatar_path, 'discover-avatar')}
        <div class="discover-row-main">
          <div class="t">${esc(u.name)}</div>
          <div class="d">${u.city ? esc(u.city) + ' · ' : ''}${followerCount} seguidor${followerCount === 1 ? '' : 'es'}${evolution.totalCount ? ` · ${evolution.totalKm.toFixed(0)}km registrados` : ''}</div>
          ${u.goal_race_name ? `<div class="pill" style="margin-top:6px;"><span class="dot"></span>Meta: ${esc(u.goal_race_name)}</div>` : ''}
        </div>
      </a>
      <form method="POST" action="/u/${esc(u.public_slug)}/follow" class="follow-form">
        <input type="hidden" name="return_to" value="/discover${q ? `?q=${encodeURIComponent(q)}` : ''}">
        <button class="${isFollowing ? 'ghost' : ''} btn xs" type="submit">${isFollowing ? 'Seguindo ✓' : 'Seguir'}</button>
      </form>
    </div>`).join('');

  const body = `
<h1>Buscar atletas</h1>
<p class="lede">Encontre outros corredores no Atletas e siga quem você quiser acompanhar.</p>
<form method="GET" action="/discover" class="discover-search">
  <input type="text" name="q" value="${esc(q || '')}" placeholder="Buscar por nome ou cidade..." autofocus>
  <button class="ghost btn" type="submit">Buscar</button>
</form>
${rows || `<div class="card feed-empty"><div class="feed-empty-icon">${icon('heart', 'disc1')}</div><p style="margin:0; font-weight:800;">${q ? 'Ninguém encontrado' : 'Ainda não há outros atletas'}</p><p class="muted" style="margin:4px 0 0;">${q ? 'Tenta buscar outro nome ou cidade.' : 'Quando outras pessoas se cadastrarem no Atletas, elas aparecem aqui.'}</p></div>`}
`;
  return layout({ title: 'Buscar atletas', user: viewer, body, active: 'discover' });
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
  <form method="POST" action="/settings" enctype="multipart/form-data">
    <div class="settings-avatar-row">
      ${avatarHtml(user.name, user.id, user.avatar_path, 'settings-avatar')}
      <label class="photo-input-label">
        <input type="file" name="avatar" accept="image/*" style="display:none;" onchange="this.nextElementSibling.textContent = this.files[0] ? this.files[0].name : 'Trocar foto';">
        <span class="ghost btn photo-btn">${icon('camera', 'avatarbtn')}${user.avatar_path ? 'Trocar foto' : 'Adicionar foto'}</span>
      </label>
    </div>
    <div class="grid cols-2">
      <div><label>Nome</label><input name="name" value="${esc(user.name)}" required></div>
      <div><label>Cidade</label><input name="city" value="${esc(user.city || '')}"></div>
      <div><label>Prova-alvo</label><input name="goal_race_name" value="${esc(user.goal_race_name || '')}"></div>
      <div><label>Meta de tempo (hh:mm:ss)</label><input name="goal_time" value="${user.goal_time_sec ? fmtClock(user.goal_time_sec) : ''}" placeholder="03:27:58"></div>
    </div>
    <label>Bio</label>
    <textarea name="bio" placeholder="Conte um pouco sobre você como corredor(a)...">${esc(user.bio || '')}</textarea>
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
  const activeActivityId = flags.activeActivityId != null ? Number(flags.activeActivityId) : null;
  const activeTitle = flags.activeTitle || 'Geral';
  const initialJson = JSON.stringify(messages.map(m => ({ role: m.role, content: m.content }))).replace(/</g, '\\u003c');

  const body = `
<div class="card chat-card">
  <div class="chat-topbar">
    <button class="icon-btn chat-menu-btn" id="chatMenuBtn" type="button" aria-label="Abrir lista de conversas">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
    <div class="chat-topbar-title">
      <span class="chat-topbar-avatar">${icon('flame', 'topbar')}</span>
      <div style="min-width:0;">
        <div class="chat-topbar-name" id="chatActiveTitle">${esc(activeTitle)}</div>
        <div class="chat-topbar-sub">seu treinador, sempre no seu histórico</div>
      </div>
    </div>
    ${flags.aiEnabled && messages.length ? `<form method="POST" action="/assistant/clear" onsubmit="return confirm('Limpar essa conversa?')"><input type="hidden" name="activity_id" id="chatClearActivityId" value="${activeActivityId != null ? activeActivityId : ''}"><button class="chat-topbar-clear" type="submit">Limpar</button></form>` : ''}
  </div>
  ${flags.error === 'missing_key' ? `<div class="err" style="margin:12px 16px 0;">Cadastre sua chave da API da Anthropic em <a href="/settings">Config</a> para conversar com o coach.</div>` : ''}
  <div class="chat-msgs" id="chatMsgs"></div>
  ${flags.aiEnabled ? `
  <form class="chat-form" id="chatForm">
    <textarea id="chatInput" placeholder="Fale com o coach..." rows="1" autofocus></textarea>
    <button type="submit" aria-label="Enviar">${icon('flame', 'sendbig')}</button>
  </form>
  ` : `<p class="muted" style="margin:0; padding:14px 16px;">Cadastre sua chave da API da Anthropic em <a href="/settings">Config</a> para habilitar o coach.</p>`}

  <div class="chat-drawer-backdrop" id="chatDrawerBackdrop"></div>
  <div class="chat-drawer" id="chatDrawer" role="dialog" aria-label="Conversas">
    <div class="chat-drawer-head">
      <div class="chat-drawer-title">Conversas</div>
      <button class="icon-btn" id="chatDrawerClose" type="button" aria-label="Fechar lista de conversas">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
    <button type="button" class="chat-drawer-new" id="chatNewBtn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      Nova conversa
    </button>
    <div class="chat-drawer-list" id="chatDrawerList"><p class="muted" style="margin:14px;">Carregando…</p></div>
  </div>
</div>
`;
  const chatInit = `<script defer>
(function(){
  try {
    if (!window.CoachChat) return;
    var ACTIVE_ID = ${activeActivityId != null ? activeActivityId : 'null'};
    var GENERAL_SUGGESTIONS = ['Analise meu último treino', 'Como está minha evolução esse mês?', 'O que eu preciso melhorar?', 'Quanto falta pra minha meta na maratona?'];
    var ACTIVITY_SUGGESTIONS = ['Analise esse treino', 'O que eu preciso melhorar nesse treino?', 'Como foi meu ritmo comparado à meta?'];
    var chat = window.CoachChat.mount({
      msgsId: 'chatMsgs',
      formId: 'chatForm',
      inputId: 'chatInput',
      initialMessages: ${initialJson},
      activityId: ACTIVE_ID,
      aiEnabled: ${flags.aiEnabled ? 'true' : 'false'},
      emptyText: 'Nenhuma mensagem ainda. Pergunte algo como "como está minha evolução esse mês?" ou "quantos km faltam pra bater minha meta na maratona?".',
      suggestions: ACTIVE_ID == null ? GENERAL_SUGGESTIONS : ACTIVITY_SUGGESTIONS,
    });

    var menuBtn = document.getElementById('chatMenuBtn');
    var closeBtn = document.getElementById('chatDrawerClose');
    var backdrop = document.getElementById('chatDrawerBackdrop');
    var drawer = document.getElementById('chatDrawer');
    var listEl = document.getElementById('chatDrawerList');
    var newBtn = document.getElementById('chatNewBtn');
    var titleEl = document.getElementById('chatActiveTitle');
    var clearInput = document.getElementById('chatClearActivityId');
    var mode = 'threads';
    var cache = null;

    function escHtml(s){
      return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }

    function openDrawer(){ backdrop.classList.add('open'); drawer.classList.add('open'); loadThreads(); }
    function closeDrawer(){ backdrop.classList.remove('open'); drawer.classList.remove('open'); }
    if (menuBtn) menuBtn.addEventListener('click', openDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    if (backdrop) backdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeDrawer(); });

    var TRASH_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m3 0-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7h14Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function bindThreadClicks(){
      listEl.querySelectorAll('.convo-item[data-activity-id]').forEach(function(btn){
        btn.addEventListener('click', function(){
          var idAttr = btn.getAttribute('data-activity-id');
          var newId = idAttr ? Number(idAttr) : null;
          var title = btn.getAttribute('data-title') || 'Geral';
          var suggestions = newId == null ? GENERAL_SUGGESTIONS : ACTIVITY_SUGGESTIONS;
          selectThread(newId, title, suggestions);
          mode = 'threads';
          closeDrawer();
        });
      });
      listEl.querySelectorAll('.convo-delete[data-activity-id]').forEach(function(btn){
        btn.addEventListener('click', function(e){
          e.stopPropagation();
          var idAttr = btn.getAttribute('data-activity-id');
          var delId = idAttr ? Number(idAttr) : null;
          var title = btn.getAttribute('data-title') || 'essa conversa';
          if (!window.confirm('Excluir a conversa "' + title + '"? Isso apaga o histórico dela.')) return;
          fetch('/api/coach/threads/delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ activity_id: delId }),
          }).then(function(){
            if (String(delId) === String(ACTIVE_ID)) {
              selectThread(null, 'Geral', GENERAL_SUGGESTIONS);
            }
            loadThreads();
          }).catch(function(){});
        });
      });
    }

    function renderThreads(data){
      var items = data.threads || [];
      listEl.innerHTML = items.length ? items.map(function(t){
        var active = (t.activityId == null ? 'null' : String(t.activityId)) === String(ACTIVE_ID);
        var letter = (t.title || '?').trim().charAt(0).toUpperCase() || '?';
        var idAttr = t.activityId == null ? '' : t.activityId;
        return '<div class="convo-row">' +
          '<button type="button" class="convo-item' + (active ? ' active' : '') + '" data-activity-id="' + idAttr + '" data-title="' + escHtml(t.title) + '">' +
          '<div class="convo-dot">' + escHtml(letter) + '</div>' +
          '<div class="convo-text"><div class="convo-title">' + escHtml(t.title) + '</div>' +
          '<div class="convo-sub">' + escHtml(t.snippet || 'Sem mensagens ainda') + '</div></div></button>' +
          '<button type="button" class="convo-delete" data-activity-id="' + idAttr + '" data-title="' + escHtml(t.title) + '" aria-label="Excluir conversa">' + TRASH_SVG + '</button>' +
          '</div>';
      }).join('') : '<p class="muted" style="margin:14px;">Nenhuma conversa ainda.</p>';
      bindThreadClicks();
    }

    function renderStartable(data){
      var items = data.startable || [];
      var back = '<button type="button" class="convo-back" id="chatBackBtn">&larr; Voltar</button>';
      var listHtml = items.length ? items.map(function(a){
        var letter = (a.title || '?').trim().charAt(0).toUpperCase() || '?';
        return '<button type="button" class="convo-item" data-activity-id="' + a.activityId + '" data-title="' + escHtml(a.title) + '">' +
          '<div class="convo-dot">' + escHtml(letter) + '</div>' +
          '<div class="convo-text"><div class="convo-title">' + escHtml(a.title) + '</div>' +
          '<div class="convo-sub">Começar uma conversa sobre esse treino</div></div></button>';
      }).join('') : '<p class="muted" style="margin:14px;">Nenhum treino sem conversa por enquanto.</p>';
      listEl.innerHTML = back + listHtml;
      var backBtn = document.getElementById('chatBackBtn');
      if (backBtn) backBtn.addEventListener('click', function(){ mode = 'threads'; renderThreads(cache || { threads: [] }); });
      bindThreadClicks();
    }

    function selectThread(newId, title, suggestions){
      ACTIVE_ID = newId;
      if (titleEl) titleEl.textContent = title;
      if (clearInput) clearInput.value = newId == null ? '' : newId;
      var historyUrl = newId == null ? '/api/coach/history' : '/api/coach/activity/' + newId + '/history';
      if (chat && chat.switchThread) chat.switchThread(newId, historyUrl, 'Nenhuma mensagem ainda nessa conversa.', suggestions || (newId == null ? GENERAL_SUGGESTIONS : ACTIVITY_SUGGESTIONS));
      try {
        var url = new URL(window.location.href);
        if (newId == null) url.searchParams.delete('activity'); else url.searchParams.set('activity', newId);
        window.history.replaceState(null, '', url.pathname + url.search);
      } catch (e) {}
    }

    function loadThreads(){
      fetch('/api/coach/threads').then(function(r){ return r.ok ? r.json() : { threads: [], startable: [] }; }).then(function(data){
        cache = data;
        if (mode === 'new') renderStartable(data); else renderThreads(data);
      }).catch(function(){});
    }

    if (newBtn) newBtn.addEventListener('click', function(){
      mode = 'new';
      if (cache) renderStartable(cache); else loadThreads();
    });

    loadThreads();
  } catch (e) { console.error('[dbg]', e); }
})();
</script>`;
  return layout({ title: 'Coach de Corrida', user, body, active: 'assistant', hideCoachWidget: true, bodyEnd: chatInit, bodyClass: 'chat-page', wrapClass: 'wrap-chat' });
}

module.exports = {
  layout, loginPage, signupPage, dashboardPage, racesPage,
  activitiesPage, activityNewPage, activityDetailPage, feedPage, settingsPage, coachChatPage,
  publicProfilePage, storyPage, landingPage, welcomePage, discoverPage,
};
