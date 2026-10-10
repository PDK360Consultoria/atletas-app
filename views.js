const { secToPace, fmtClock, fmtDate, timeAgo, esc, renderMarkdownLite, icon } = require('./lib/format');

const { ZONE_META, zoneBounds, zoneSeconds } = require('./lib/zones');
const fx = require('./views_feed_extra');
const { tourScript } = require('./views_tour');
const { CATS: NEWS_CATS, CAT_KEYS: NEWS_CAT_KEYS } = require('./lib/news');

// Tempo por zona de FC (Z1–Z5): barra empilhada + legenda. `compact` é a
// versão do feed e da lista (barra fina com Z1..Z4 em texto); a completa
// vai na página do treino.
function zonesHtml(secs, compact) {
  if (!secs) return '';
  const total = secs.reduce((a, b) => a + b, 0);
  if (!total) return '';
  const last = secs[4] > 0 ? 5 : 4; // Z5 só aparece quando houve tempo nela
  const seg = ZONE_META.slice(0, last).map((m, i) => {
    const pct = secs[i] / total * 100;
    return pct > 0 ? `<span class="zone-seg" style="width:${pct.toFixed(2)}%;background:${m.color}" title="${m.z} · ${fmtClock(secs[i])} · ${Math.round(pct)}%"></span>` : '';
  }).join('');
  if (compact) {
    return `<div class="zones zones-compact"><div class="zone-title">Zonas de FC</div><div class="zone-bar">${seg}</div><div class="zone-chips">${ZONE_META.slice(0, last).map((m, i) => `<span class="zone-chip${secs[i] > 0 ? '' : ' off'}"><i style="background:${m.color}"></i>${m.z} <b>${secs[i] > 0 ? fmtClock(secs[i]) : '—'}</b></span>`).join('')}</div></div>`;
  }
  return `<div class="zones"><div class="zone-bar zone-bar-lg">${seg}</div>
    <div class="zone-rows">${ZONE_META.slice(0, last).map((m, i) => `<div class="zone-row"><span class="zone-name"><i style="background:${m.color}"></i><b>${m.z}</b> ${m.name}</span><span class="zone-time">${fmtClock(secs[i])}</span><span class="zone-pct">${Math.round(secs[i] / total * 100)}%</span></div>`).join('')}</div></div>`;
}
function zonesForActivity(a, zonesJson, obsMax) {
  const bounds = zoneBounds(zonesJson, Math.max(obsMax || 0, a.max_hr || 0));
  return zoneSeconds({ laps: a.laps_json, intervals: a.intervals_json, avg_hr: a.avg_hr, duration_sec: a.duration_sec }, bounds);
}
const { summarizeIntervals } = require('./lib/intervals');
const aictx = require('./lib/aicontext');
const { STORYCARD_JS } = require('./lib/storycard_client');
const { estimateVO2max } = require('./lib/stats');
const { decode: decodePolyline } = require('./lib/polyline');
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

function wrapLines(ctx, text, maxWidth, maxLines){
  var words = (text || '').split(' ');
  var lines = [], line = '';
  for (var n = 0; n < words.length; n++) {
    var test = line + words[n] + ' ';
    if (ctx.measureText(test).width > maxWidth && n > 0) { lines.push(line.trim()); line = words[n] + ' '; }
    else line = test;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.slice(0, maxLines);
}
${STORYCARD_JS}
function renderStoryCard(container, card){ RunStory.render(container, card); }
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
      if (m.channel === 'voice') {
        var vt = document.createElement('span');
        vt.textContent = 'por voz';
        vt.style.cssText = 'display:block; font-size:11px; opacity:.6; margin-bottom:3px; letter-spacing:.04em; text-transform:uppercase;';
        b.insertBefore(vt, b.firstChild);
      }
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

// Mobile nav — the shared nav bar in layout() carries ~9 links plus the
// notif bell and Sair, which is fine spread out on desktop but was wrapping
// into a dense multi-line block covering the whole top of the screen on a
// phone (Felipe sent a screenshot of exactly this). On narrow screens
// style.css hides .links by default and this toggles it into a dropdown.
//
// On top of that, the secondary links (Provas, Coach ao vivo, Professor
// Chat, Professor ao vivo, Config, Admin) are now tucked behind a "Mais"
// dropdown — the full flat list made even the desktop bar feel cramped and
// noisy (Felipe flagged this with a screenshot too). This script wires up
// both toggles; the "Mais" panel nests inside the mobile dropdown and floats
// next to the button on desktop (see the .nav-more rules in style.css).
const MOBILE_NAV_SCRIPT = `<script defer>
(function(){
function ready(fn){ if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
ready(function(){
  var toggle = document.getElementById('navToggle');
  var links = document.getElementById('navLinks');
  var moreBtn = document.getElementById('navMoreBtn');
  var morePanel = document.getElementById('navMorePanel');

  function setOpen(open){
    if (!toggle || !links) return;
    links.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function setMoreOpen(open){
    if (!moreBtn || !morePanel) return;
    morePanel.classList.toggle('open', open);
    moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  if (toggle && links) {
    toggle.addEventListener('click', function(){
      setOpen(!links.classList.contains('open'));
    });
    // Tapping a nav link navigates away anyway, but close first so a user
    // who hits back doesn't land on the page with the menu still stuck open.
    links.addEventListener('click', function(e){
      if (e.target.closest && e.target.closest('a.link, a.nav-more-item')) setOpen(false);
    });
  }

  if (moreBtn && morePanel) {
    moreBtn.addEventListener('click', function(e){
      e.stopPropagation();
      setMoreOpen(!morePanel.classList.contains('open'));
    });
  }

  document.addEventListener('click', function(e){
    if (moreBtn && morePanel && !morePanel.contains(e.target) && !moreBtn.contains(e.target)) setMoreOpen(false);
    if (toggle && links && !links.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
  });
  window.addEventListener('resize', function(){
    if (window.innerWidth > 760) setOpen(false);
    setMoreOpen(false);
  });
});
})();
</script>`;

const NATIVE_SCRIPT = `<script defer>
(function(){
  try {
    var C = window.Capacitor;
    if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
    document.documentElement.classList.add('is-native');
    var P = C.Plugins || {};
    // Light vibration on taps (reactions, buttons).
    if (P.Haptics) document.addEventListener('click', function(e){
      if (e.target.closest && e.target.closest('button, .react-btn, .fmt, .nav-toggle')) { try { P.Haptics.impact({ style: 'LIGHT' }); } catch (x) {} }
    }, true);
    // Push: ask permission, register, and send the device token to the server.
    var Push = P.PushNotifications;
    if (Push) {
      var platform = C.getPlatform ? C.getPlatform() : '';
      Push.addListener('registration', function(t){
        var b = new URLSearchParams(); b.set('token', t.value); b.set('platform', platform);
        fetch('/api/push/register', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' }, body: b.toString(), credentials: 'same-origin' }).catch(function(){});
      });
      Push.addListener('pushNotificationActionPerformed', function(a){
        var u = a && a.notification && a.notification.data && a.notification.data.url;
        if (u && u.charAt(0) === '/' && u.charAt(1) !== '/') location.href = u;
      });
      Push.checkPermissions().then(function(s){
        if (s.receive === 'prompt') return Push.requestPermissions();
        return s;
      }).then(function(s){ if (s && s.receive === 'granted') Push.register(); }).catch(function(){});
    }
  } catch (e) {}
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
        <a class="brand" href="/">Runiqx</a>
        <button class="nav-toggle" id="navToggle" type="button" aria-label="Abrir menu" aria-expanded="false" aria-controls="navLinks">
          <span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span>
        </button>
        <div class="links" id="navLinks">
          <a class="link ${active === 'home' ? 'active' : ''}" href="/">Perfil</a>
          <a class="link ${active === 'activities' ? 'active' : ''}" href="/activities">Treinos</a>
          <a class="link ${active === 'feed' ? 'active' : ''}" href="/feed">Feed</a>
          <a class="link ${active === 'discover' ? 'active' : ''}" href="/discover">Buscar</a>
          <a class="link ${active === 'assistant' ? 'active' : ''}" href="/assistant">Professor Chat</a>
          <a class="link ${active === 'professor' ? 'active' : ''}" href="/professor">Professor ao vivo</a>
          <div class="nav-more" id="navMore">
            <button class="nav-more-btn ${['races', 'coach', 'settings', 'admin'].includes(active) ? 'active' : ''}" id="navMoreBtn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="navMorePanel">Mais<span class="nav-more-caret">▾</span></button>
            <div class="nav-more-panel" id="navMorePanel">
              <a class="nav-more-item ${active === 'races' ? 'active' : ''}" href="/races">Provas</a>
              <a class="nav-more-item ${active === 'coach' ? 'active' : ''}" href="/coach">Treino ao Vivo</a>
              <a class="nav-more-item ${active === 'settings' ? 'active' : ''}" href="/settings">Config</a>
              <a class="nav-more-item" href="#tutorial" data-tour-open>Tutorial</a>
              ${user.is_admin ? `<a class="nav-more-item ${active === 'admin' ? 'active' : ''}" href="/admin">Admin</a>` : ''}
            </div>
          </div>
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
        <a class="brand" href="/">Runiqx</a>
        <div class="links">
          <a class="link" href="/login">Entrar</a>
          <a class="btn xs" href="/signup">Cadastre-se</a>
        </div>
      </nav>`
    : `<nav class="nav"><a class="brand" href="/">Runiqx</a></nav>`;

  const showWidget = !!user && !hideCoachWidget;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0B0D10">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/assets/runiqx-icon-192.png">
<title>${esc(title)} · Runiqx</title>
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
${user ? MOBILE_NAV_SCRIPT : ''}
${user ? NOTIF_SCRIPT : ''}
${user ? NATIVE_SCRIPT : ''}
${user ? tourScript(['flame', 'shoe', 'mountain', 'trophy', 'camera', 'pin', 'chat', 'stopwatch', 'calendar'].reduce((o, n) => { o[n] = icon(n, 'tour-' + n); return o; }, {}), !user.tour_seen_at) : ''}
${bodyEnd || ''}
<p class="site-foot"><a href="/privacidade">Privacidade</a> · <a href="/termos">Termos</a> · Compatível com Strava</p>
</body>
</html>`;
}

const STRAVA_NOTE = `<p class="muted" style="font-size:12.5px; margin:10px 0 0;">Seus dados da Strava ficam visíveis só para você. Se você pedir a análise técnica ou conversar com o coach sobre um treino, os dados desse treino são enviados ao provedor de IA. Ao desconectar, eles são apagados. <a href="/privacidade">Saiba mais</a>.</p>`;

function privacyPage(user) {
  const body = `<div class="card legal">
<h1>Política de privacidade</h1>
<p class="muted">Última atualização: outubro de 2026</p>

<h2>Quem somos</h2>
<p>O Runiqx é um app de treino de corrida operado pela 360 Consultoria Empresarial (“nós”), responsável pelo tratamento dos seus dados pessoais, nos termos da Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018) e, quando aplicável, do GDPR.</p>

<h2>Quais dados coletamos</h2>
<p>Dados de cadastro (nome, e-mail, senha protegida por hash, foto e bio), informações que você escolhe informar (nível, metas, provas, observações), treinos que você registra ou envia, e conteúdo que você publica no feed (legendas, fotos, local e comentários).</p>
<p>Se você conectar a Strava, recebemos pela API da Strava, com a sua autorização, o seu perfil básico e as suas atividades (distância, tempo, pace, frequência cardíaca, altimetria, parciais e rota).</p>

<h2>Como usamos</h2>
<p>Usamos os dados para operar o app: mostrar o seu histórico, calcular métricas e recordes, montar o seu feed e enviar notificações dentro do app. Não vendemos dados pessoais.</p>

<h2>Dados da Strava</h2>
<p>Os dados que vêm da sua conta Strava são exibidos somente para você. Outros atletas não veem o mapa, o pace, as zonas nem as métricas dos seus treinos da Strava, mesmo quando você publica no feed: nesse caso aparece apenas o que você escrever e as fotos que adicionar.</p>
<p>Quando você pede a análise técnica de um treino da Strava ou abre a conversa com o treinador virtual sobre ele, os dados desse treino (distância, tempo, pace, frequência cardíaca, parciais) são enviados ao provedor de inteligência artificial para gerar a resposta. Isso só acontece por ação sua, em treinos seus. Não usamos esses dados para treinar modelos.</p>
<p>Você pode desconectar a Strava a qualquer momento em Configurações. Ao desconectar, apagamos de forma permanente os treinos importados da Strava. Você também pode revogar o acesso em strava.com/settings/apps.</p>

<h2>Compartilhamento</h2>
<p>O que você publica no feed é visível para os outros atletas do app. Usamos provedores de infraestrutura para hospedar o serviço. Não compartilhamos seus dados com terceiros para publicidade.</p>

<h2>Seus direitos</h2>
<p>Você pode acessar, corrigir, exportar e excluir seus dados, e revogar consentimentos, escrevendo para o contato abaixo. Atendemos os pedidos em até 30 dias.</p>

<h2>Retenção e segurança</h2>
<p>Mantemos seus dados enquanto a conta existir. Para excluir a conta, vá em Configurações > Excluir conta (senha e a palavra EXCLUIR); os passos completos estão em <a href="/excluir-conta">runiqx.com/excluir-conta</a>. Ao excluir, removemos os dados pessoais, salvo o que a lei exigir guardar. As conexões usam HTTPS e as senhas são armazenadas de forma protegida.</p>

<h2>Contato</h2>
<p>Dúvidas e solicitações: <a href="mailto:felipe@360consultoria.com.br">felipe@360consultoria.com.br</a>.</p>
<p class="muted" style="font-size:12.5px;">Compatível com Strava. Strava é marca de seus titulares e o Runiqx não é afiliado à Strava.</p>
</div>`;
  if (user) return layout({ title: 'Privacidade', user, body });
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0B0D10">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/assets/runiqx-icon-192.png"><title>Privacidade · Runiqx</title><link rel="stylesheet" href="/style.css"></head>
<body><div class="wrap" style="max-width:760px; margin:0 auto; padding:24px 16px;"><div class="center-logo"><a href="/" style="color:inherit; text-decoration:none;">Runiqx</a></div>${body}</div></body></html>`;
}

function deleteAccountPage(user) {
  const body = `<div class="card legal">
<h1>Como excluir sua conta no Runiqx</h1>
<p class="muted">App: Runiqx · Desenvolvedor: 360 Consultoria Empresarial</p>

<h2>Excluir pelo app ou pelo site</h2>
<p>1. Entre na sua conta em <a href="/login">runiqx.com</a> ou no app Runiqx.</p>
<p>2. Abra <b>Configurações</b> e vá até o cartão <b>Excluir conta</b>.</p>
<p>3. Digite a sua senha e a palavra <b>EXCLUIR</b> e confirme.</p>
<p>A exclusão é imediata e não pode ser desfeita.</p>

<h2>Não consegue entrar?</h2>
<p>Envie um e-mail para <a href="mailto:felipe@360consultoria.com.br">felipe@360consultoria.com.br</a> a partir do e-mail cadastrado, com o assunto “Excluir conta Runiqx”. Atendemos em até 30 dias.</p>

<h2>O que é apagado</h2>
<p>Perfil (nome, e-mail, foto e bio), treinos registrados ou importados, dados vindos da Strava, provas e metas, posts, fotos, comentários e reações, mensagens do treinador virtual, quem você segue e quem segue você, notificações, sessões e tokens de notificação push.</p>

<h2>O que pode ser mantido</h2>
<p>Apenas o que a lei exigir guardar, pelo prazo legal. Cópias de segurança da infraestrutura são sobrescritas no ciclo normal de rotação.</p>

<h2>Conexão com a Strava</h2>
<p>Ao excluir a conta, a conexão e os dados da Strava no Runiqx são apagados. Você também pode revogar o acesso em strava.com/settings/apps.</p>
<p class="muted" style="font-size:12.5px;"><a href="/privacidade">Política de privacidade</a></p>
</div>`;
  if (user) return layout({ title: 'Excluir conta', user, body });
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0B0D10">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/assets/runiqx-icon-192.png"><title>Excluir conta · Runiqx</title><link rel="stylesheet" href="/style.css"></head>
<body><div class="wrap" style="max-width:760px; margin:0 auto; padding:24px 16px;"><div class="center-logo"><a href="/" style="color:inherit; text-decoration:none;">Runiqx</a></div>${body}</div></body></html>`;
}

function authLayout(title, body) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0B0D10">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/assets/runiqx-icon-192.png">
<title>${esc(title)} · Runiqx</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="auth-box">
<div class="center-logo">Runiqx</div>
${body}
<p class="site-foot"><a href="/privacidade">Política de privacidade</a> · <a href="/termos">Termos de uso</a></p>
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
  <label>Prova-alvo (se já tiver)</label>
  <input type="text" name="goal_race_name" value="${esc(prev.goal_race_name || '')}" placeholder="ex: Maratona de Curitiba">
  <label>Meta de tempo</label>
  <input type="text" name="goal_time" value="${esc(prev.goal_time || '')}" placeholder="03:30:00">
  <label>Histórico de lesão ou algo que devemos saber</label>
  <textarea name="injury_notes" placeholder="Se não tiver nada, pode deixar em branco.">${esc(prev.injury_notes || '')}</textarea>

  <p class="muted" style="font-size:12.5px; margin:16px 0 0;">Ao criar a conta você concorda com os <a href="/termos" target="_blank" rel="noopener">Termos de uso</a> (sem conteúdo ofensivo ou abusivo) e com a <a href="/privacidade" target="_blank" rel="noopener">Política de privacidade</a>.</p>
  <div style="margin-top:14px"><button type="submit" style="width:100%">Criar conta</button></div>
</form>
<p class="muted" style="text-align:center; margin-top:18px;">Já tem conta? <a href="/login">Entrar</a></p>
`);
}

function welcomePage(user, flags) {
  flags = flags || {};
  const number = memberNumber(user);
  const diagnosis = buildDiagnosis(user);
  const stravaConnected = !!user.strava_refresh_token || !!flags.stravaConnected;
  const body = `
<div class="welcome-number">
  <span class="welcome-number-eyebrow">Você é o atleta</span>
  <span class="welcome-number-big">Nº ${esc(number)}</span>
</div>
<div class="welcome-diagnosis">
  <p>${esc(diagnosis)}</p>
</div>

<div class="card" style="margin-top:18px; text-align:left;">
  <h2 style="display:flex; align-items:center; gap:8px; margin:0 0 10px;"><span class="h-icon">${icon('flame', 'welcomestrava')}</span>Conecte o Strava</h2>
  ${flags.stravaError ? `<div class="err" style="margin-bottom:10px;">Não consegui conectar com o Strava agora. Tente de novo.</div>` : ''}
  ${stravaConnected ? `
    <p class="muted" style="margin:0;">Conectado! Agora é só ir em <a href="/activities">Treinos</a> e clicar em "Sincronizar com Strava" pra importar o seu histórico — e os próximos treinos (inclusive do Garmin, se ele já sincroniza pro Strava) entram automaticamente.</p>
  ` : !flags.stravaConfigured ? `
    <p class="muted" style="margin:0;">Integração com Strava ainda não configurada no servidor. Você pode registrar seus treinos manualmente por enquanto, e conectar depois em Configurações.</p>
  ` : `
    <p class="muted" style="margin:0 0 12px;">É a forma mais rápida de começar: conecte sua conta do Strava e seus treinos entram automaticamente — pace, FC, splits, tudo. Se você usa Garmin, Coros ou outro relógio que já sincroniza com o Strava, funciona do mesmo jeito, sem precisar conectar o relógio direto.</p>
    <a class="btn strava-btn" href="/strava/connect?return_to=welcome" style="width:100%; text-align:center;">Conectar com Strava</a>
    ${STRAVA_NOTE}
  `}
</div>

<a class="btn${stravaConnected ? '' : ' ghost'}" href="/" style="width:100%; text-align:center; margin-top:14px;">${stravaConnected ? 'Começar' : 'Pular por agora'}</a>
`;
  return authLayout('Bem-vindo', body);
}

function landingPage() {
  // Each chapter after the hero scrolls past the fixed 3D stage (see
  // .landing-3d-fixed / LANDING_SCRIPT) — the shoe/camera react to scroll
  // position, not a canned timer, per Felipe's brief ("um objeto 3d móvel
  // que se mexe enquanto o site se move", referencing the cinematic-scroll
  // premium sites the site-medico-premium-360 skill builds). Kept in
  // Runiqx' own gold/blue palette, not that skill's brown/gold medical one.
  const chapters = [
    { icon: 'stopwatch', title: 'Treinos', text: 'Registre manualmente ou sincronize com o Strava — pace, FC, splits km a km e estrutura de tiros, tudo organizado.' },
    { icon: 'chat', title: 'Professor', text: 'O seu treinador com IA — por voz ou por texto, sempre o mesmo, sempre no seu histórico. Monta treinos com embasamento técnico e te manda até uma imagem pra consultar durante a corrida.' },
    { icon: 'flame', title: 'Feed', text: 'Compartilhe treinos, reaja com 👏🔥🏆💪 e acompanhe o que a galera que você segue está treinando.' },
    { icon: 'trophy', title: 'Provas e evolução', text: 'Calendário de provas, medalhas por distância e sua evolução de volume e pace mês a mês.' },
  ];
  const total = chapters.length + 2; // hero + feature chapters + closing CTA
  const pad2 = (n) => String(n).padStart(2, '0');

  const body = `
<div class="landing-3d-fixed"><canvas id="landing-canvas"></canvas></div>

<div class="landing-chapters">
  <section class="landing-chapter landing-chapter-hero" data-chapter="0">
    <div class="chapter-num">${pad2(1)}<span class="total">/ ${pad2(total)}</span></div>
    <h1 class="landing-h1">Corra com a galera.<br>Com professor 24h.</h1>
    <p class="lede landing-lede">O Runiqx é a rede social de quem corre de verdade — com um professor de corrida por IA disponível 24h pra tirar dúvida, montar treino e analisar sua prova a qualquer hora, até de madrugada.</p>
    <div class="landing-cta-row">
      <a class="btn" href="/signup">Criar minha conta</a>
      <a class="btn ghost" href="/login">Já tenho conta</a>
    </div>
  </section>

  ${chapters.map((f, i) => `<section class="landing-chapter" data-chapter="${i + 1}">
    <div class="chapter-card">
      <div class="chapter-num">${pad2(i + 2)}<span class="total">/ ${pad2(total)}</span></div>
      <div class="icon-badge">${icon(f.icon, 'lc' + i)}</div>
      <h2>${esc(f.title)}</h2>
      <p>${esc(f.text)}</p>
    </div>
  </section>`).join('')}

  <section class="landing-chapter landing-chapter-cta" data-chapter="${chapters.length + 1}">
    <div class="chapter-card landing-cta-final">
      <div class="chapter-num" style="justify-content:center;">${pad2(total)}<span class="total">/ ${pad2(total)}</span></div>
      <h2>Cada atleta tem um número.</h2>
      <p class="muted" style="margin:0 0 18px;">No cadastro você passa por um pré-diagnóstico rápido e recebe o seu — simples assim.</p>
      <a class="btn" href="/signup">Criar minha conta</a>
    </div>
  </section>
</div>

<div class="landing-dots" id="landingDots"></div>
`;
  return layout({ title: 'Runiqx', user: null, body, navVariant: 'public', wrapClass: 'landing-wrap', bodyClass: 'landing-dark', extraHead: HERO_EXTRA_HEAD, bodyEnd: LANDING_SCRIPT });
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
      // Phones report a high devicePixelRatio (often 3) on top of a full
      // fixed-viewport canvas — combined with MSAA + shadow maps that's
      // enough framebuffer memory to make mobile Safari/Chrome silently
      // drop (or never finish compositing) the WebGL context, which looks
      // exactly like "the shoe never shows up" while the same scene is
      // fine on desktop at an identical CSS size. Scale quality down on
      // coarse-pointer/narrow devices instead of rendering at full desktop
      // fidelity everywhere.
      var lowPower = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || window.innerWidth < 760;
      var accent = dark ? 0xffc24e : 0xffae5c;
      var accent2 = dark ? 0x4e9bff : 0x6fa8ff;

      var renderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: !lowPower, powerPreference: 'low-power' });
      } catch (e) { return; }
      // If the GPU context is lost (common under memory pressure on phones)
      // the canvas would otherwise just go blank forever with no visible
      // error — at minimum stop the browser from tearing down the whole
      // page over it.
      canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); console.error('[dbg] webgl context lost (hero)'); }, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2));
      if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.shadowMap.enabled = !lowPower;
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
      key.castShadow = !lowPower;
      key.shadow.mapSize.set(lowPower ? 512 : 1024, lowPower ? 512 : 1024);
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

      var SHOE_URL = 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/MaterialsVariantsShoe/glTF-Binary/MaterialsVariantsShoe.glb';
      function onShoeLoaded(gltf) {
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
          renderFrame();
        } catch (e) { console.error('[dbg]', e); }
      }
      // Mobile networks (and the CDN itself) occasionally drop the first
      // request for a ~1-2MB binary — one silent retry costs nothing and
      // fixes the "shoe just never shows up" case that a flaky load can't
      // self-heal from otherwise.
      function loadShoe(attempt) {
        if (typeof THREE.GLTFLoader !== 'function') return;
        try {
          var loader = new THREE.GLTFLoader();
          loader.load(SHOE_URL, onShoeLoaded, undefined, function (err) {
            console.error('[dbg] shoe load failed (hero) attempt ' + attempt, err);
            if (attempt < 3) setTimeout(function () { loadShoe(attempt + 1); }, 1500);
          });
        } catch (e) { console.error('[dbg]', e); }
      }
      loadShoe(1);

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

// Landing-page-only cinematic scroll script. Deliberately a separate
// constant from HERO_SCRIPT (not shared) — the dashboard hero is a small
// confined box driven by mouse parallax, this one is a full-viewport fixed
// WebGL layer driven by scroll position, with its own dot nav. Same shoe
// model + lighting/orb setup as HERO_SCRIPT (copy, not reuse, since the two
// scenes attach to differently-shaped canvases and have no shared state) so
// the product rendering stays visually consistent across the app.
const LANDING_SCRIPT = `<script defer>
(function(){
  function boot(){
    try {
      var canvas = document.getElementById('landing-canvas');
      var chapters = Array.prototype.slice.call(document.querySelectorAll('.landing-chapter'));
      var dotsWrap = document.getElementById('landingDots');
      var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // ---- dot nav: one button per chapter, synced to whichever chapter
      // is in view, independent of whether WebGL loads at all.
      if (dotsWrap && chapters.length) {
        chapters.forEach(function(ch, i){
          var b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('aria-label', 'Ir para a seção ' + (i + 1));
          b.addEventListener('click', function(){
            ch.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
          });
          dotsWrap.appendChild(b);
        });
        var dotEls = Array.prototype.slice.call(dotsWrap.children);
        if ('IntersectionObserver' in window) {
          var io = new IntersectionObserver(function(entries){
            entries.forEach(function(entry){
              if (!entry.isIntersecting) return;
              var idx = chapters.indexOf(entry.target);
              if (idx < 0) return;
              dotEls.forEach(function(d, j){ d.classList.toggle('active', j === idx); });
            });
          }, { threshold: 0.5 });
          chapters.forEach(function(ch){ io.observe(ch); });
        }
      }

      if (!canvas || typeof THREE === 'undefined') return;

      // Always the dark palette here (body.landing-dark forces it in CSS
      // regardless of OS theme — see style.css) — no prefers-color-scheme
      // branch needed, unlike HERO_SCRIPT which lives on pages that still
      // follow the visitor's light/dark setting.
      var accent = 0xffc24e, accent2 = 0x4e9bff;
      // See the matching comment in HERO_SCRIPT: full devicePixelRatio +
      // MSAA + shadow maps on a phone-size GPU is the classic cause of a
      // WebGL canvas that renders fine on desktop but silently stays blank
      // (or loses its context) on a real phone.
      var lowPower = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || window.innerWidth < 760;

      var renderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: !lowPower, powerPreference: 'low-power' });
      } catch (e) { return; }
      canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); console.error('[dbg] webgl context lost (landing)'); }, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2));
      if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.shadowMap.enabled = !lowPower;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      if ('toneMapping' in renderer) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
      }

      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
      camera.position.set(1.7, 1.4, 6.0);

      scene.add(new THREE.HemisphereLight(0x4a5568, 0x0b0906, 0.55));
      var key = new THREE.DirectionalLight(0xfff3e0, 1.9);
      key.position.set(2.4, 3.6, 2.8);
      key.castShadow = !lowPower;
      key.shadow.mapSize.set(lowPower ? 512 : 1024, lowPower ? 512 : 1024);
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
      var dots3d = new THREE.Points(dotGeo, new THREE.PointsMaterial({ color: accent, size: 0.04 }));
      group.add(dots3d);

      var shadowPlane = new THREE.Mesh(
        new THREE.CircleGeometry(1.1, 32),
        new THREE.ShadowMaterial({ opacity: 0.45 })
      );
      shadowPlane.rotation.x = -Math.PI / 2;
      shadowPlane.position.y = 0.001;
      shadowPlane.receiveShadow = true;
      scene.add(shadowPlane);

      var orbGroup = new THREE.Group();
      scene.add(orbGroup);
      var orbBaseY = 1.6;
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

      // ---- scroll + mouse drive the camera/shoe instead of mouse alone:
      // this is the actual answer to "um objeto 3d móvel que se mexe
      // enquanto o site se move" — progress is read fresh every animation
      // frame (not via a throttled scroll listener), so the rotation stays
      // perfectly in lockstep with the scrollbar, trackpad or mouse wheel.
      var mouseX = 0, mouseY = 0;
      window.addEventListener('mousemove', function(e){
        mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
        mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
      });
      function scrollProgress(){
        var max = document.documentElement.scrollHeight - window.innerHeight;
        if (max <= 0) return 0;
        var p = window.scrollY / max;
        return p < 0 ? 0 : (p > 1 ? 1 : p);
      }

      function resize() {
        var w = window.innerWidth, h = window.innerHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      resize();
      window.addEventListener('resize', resize);

      function renderFrame() { renderer.render(scene, camera); }

      var shoe = null;
      var lookTarget = new THREE.Vector3(0, 1.1, 0);
      var hoverBase = 0.16;

      var SHOE_URL = 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/MaterialsVariantsShoe/glTF-Binary/MaterialsVariantsShoe.glb';
      function onShoeLoaded(gltf) {
        try {
          var model = gltf.scene;
          model.traverse(function (o) {
            if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
          });
          var box = new THREE.Box3().setFromObject(model);
          var size = box.getSize(new THREE.Vector3());
          var maxDim = Math.max(size.x, size.y, size.z) || 1;
          var scale = 2.1 / maxDim;
          model.scale.setScalar(scale);
          box.setFromObject(model);
          var center = box.getCenter(new THREE.Vector3());
          model.position.x -= center.x;
          model.position.z -= center.z;
          model.position.y -= box.min.y;
          model.position.y += hoverBase;
          model.rotation.y = Math.PI * 0.15;
          model.rotation.z = -0.12;
          box.setFromObject(model);
          var fitted = box.getSize(new THREE.Vector3());
          var shoeTop = box.min.y + fitted.y;
          lookTarget.set(0.05, shoeTop + 0.2, 0);
          orbBaseY = shoeTop + 0.5;
          orbGroup.position.set(0.1, orbBaseY, 0);
          tetherCurve.v0.set(0, shoeTop - 0.05, 0);
          tetherCurve.v1.set(0.12, shoeTop + 0.28, 0.08);
          tetherCurve.v2.set(0.08, shoeTop + 0.5, 0);
          tetherMesh.geometry.dispose();
          tetherMesh.geometry = new THREE.TubeGeometry(tetherCurve, 24, 0.005, 6, false);
          shoe = model;
          scene.add(model);
          renderFrame();
        } catch (e) { console.error('[dbg]', e); }
      }
      // See the matching comment in HERO_SCRIPT — a flaky mobile-network
      // load of the ~1-2MB model shouldn't mean the shoe is gone for the
      // whole session, so retry a couple of times before giving up.
      function loadShoe(attempt) {
        if (typeof THREE.GLTFLoader !== 'function') return;
        try {
          var loader = new THREE.GLTFLoader();
          loader.load(SHOE_URL, onShoeLoaded, undefined, function (err) {
            console.error('[dbg] shoe load failed (landing) attempt ' + attempt, err);
            if (attempt < 3) setTimeout(function () { loadShoe(attempt + 1); }, 1500);
          });
        } catch (e) { console.error('[dbg]', e); }
      }
      loadShoe(1);

      if (reduced) {
        // Static but still composed — a fixed three-quarter product shot,
        // no idle spin, no scroll-linked motion, no mouse parallax.
        renderFrame();
        var reducedRetry = setInterval(function(){ if (shoe) { renderFrame(); clearInterval(reducedRetry); } }, 300);
        return;
      }

      var clock = new THREE.Clock();
      var t = 0;

      function animate() {
        var dt = Math.min(0.05, clock.getDelta());
        t += dt;
        var p = scrollProgress();

        group.rotation.y += dt * 0.15;
        ring.rotation.z += dt * 0.08;

        if (shoe) {
          // ~1.75 turns across the whole page, plus a slow idle spin so the
          // shoe is never perfectly still even at the top/bottom of a chapter.
          shoe.rotation.y = Math.PI * 0.15 + p * Math.PI * 3.5 + t * 0.06;
          shoe.position.y = hoverBase + Math.sin(t * 1.1) * 0.06;
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

        // Camera orbits the shoe across the page's scroll range — a
        // different "shot" per chapter — with mouse parallax layered on
        // top for extra life while the visitor isn't scrolling.
        var orbitA = p * Math.PI * 1.7;
        var targetX = Math.sin(orbitA) * 2.3 + mouseX * 0.5;
        var targetZ = 4.6 + Math.cos(orbitA) * 1.7;
        var targetY = 1.3 + Math.sin(p * Math.PI) * 0.5 - mouseY * 0.2;
        camera.position.x += (targetX - camera.position.x) * 0.05;
        camera.position.y += (targetY - camera.position.y) * 0.05;
        camera.position.z += (targetZ - camera.position.z) * 0.05;
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

function dashboardPage({ user, nextRace, daysToRace, recentActivities, weekKm, evolution, medals, calendar, weeklyStreak }) {
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
  ${weeklyStreak ? `<div class="card stat streak-stat"><div class="icon-badge streak-icon">${icon('flame', 'streak')}</div><div class="k">Sequência</div><div class="v">${weeklyStreak}<span class="u">${weeklyStreak === 1 ? 'semana' : 'semanas'}</span></div></div>` : ''}
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
  const obsMaxHr = activities.reduce((m, a) => Math.max(m, a.max_hr || 0), 0);
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
        <div><div class="t">${esc(a.title)}${a.source === 'strava' ? ' <span class="muted mono" style="font-size:11px;">· strava</span>' : ''}</div><div class="d">${fmtDate(a.started_at || a.created_at)} · ${a.distance_km ? a.distance_km + 'km' : '—'} ${a.duration_sec ? '· ' + fmtClock(a.duration_sec) : ''} ${a.avg_pace_sec ? '· ' + secToPace(a.avg_pace_sec) + '/km' : ''}</div>${zonesHtml(zonesForActivity(a, user.hr_zones_json, obsMaxHr), true)}</div>
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

// Shared pace-by-km bar chart — the "Splits por km" card on the activity
// detail page, and (condensed, see activityStatBlock) the chart shown on an
// auto-posted feed card, so a workout shared to the feed shows the same
// at-a-glance shape instead of just flat numbers. `limit` caps how many
// bars render (feed cards show only the first few so the card doesn't
// balloon on a long run; the activity page itself passes no limit).
function paceBarsHtml(activity, laps, limit) {
  const list = limit ? laps.slice(0, limit) : laps;
  if (!list.length) return '';
  const maxSplit = Math.max(...list.map(l => l.split_sec));
  const bars = list.map(l => {
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
  return `<div class="bars">${bars}</div>`;
}

function activityDetailPage({ user, activity, laps, intervals, evolution, prInfo, alreadyShared, aiEnabled, missing = [] }) {
  const fromStrava = activity.source === 'strava';
  const tiros = summarizeIntervals(intervals);
  const vo2max = estimateVO2max(activity.distance_km, activity.duration_sec);
  const bars = paceBarsHtml(activity, laps);

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

${(() => { const zs = zonesForActivity(activity, user.hr_zones_json, activity.zones_obs_max); return zs ? `<div class="card"><h2><span class="h-icon">${icon('heart', 'zn')}</span>Zonas de frequência cardíaca</h2>${zonesHtml(zs, false)}<p class="muted" style="margin:10px 0 0;font-size:12px;">Tempo estimado pelas parciais do treino.</p></div>` : ''; })()}

${activity.route_polyline ? `<div class="card route-card">
  <h2><span class="h-icon">${icon('mountain', 'rt')}</span>Rota</h2>
  ${routeTileMap(activity.route_polyline, { width: 900, height: 440 })}
</div>${LIVE_MAP_SCRIPT}` : ''}

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
  ${bars}
</div>` : ''}

${trainingCompareChart(activity, evolution)}

<div class="card" id="analise">
  <h2><span class="h-icon">${icon('heart', 'ai')}</span>Análise com IA</h2>
  ${!aiEnabled
    ? `<p class="muted" style="margin:0;">Cadastre sua chave da API da Anthropic em <a href="/settings">Config</a> para gerar análises técnicas automáticas.</p>`
    : activity.ai_analysis
      ? `${aictx.pillsHtml(aictx.parseStored(activity.ai_context_json))}<div class="ai-analysis">${renderMarkdownLite(activity.ai_analysis)}</div>
        <details style="margin-top:14px;"${missing.length ? ' open' : ''}><summary class="ghost-summary">↻ Gerar nova análise</summary><div style="margin-top:14px;">${aictx.formHtml(activity.id, aictx.parseStored(activity.ai_context_json), { missing, buttonLabel: 'Gerar nova análise' })}</div></details>`
      : aictx.formHtml(activity.id, aictx.parseStored(activity.ai_context_json), { missing })}
${fromStrava ? `<p class="muted" style="font-size:12.5px; margin:12px 0 0;">Este treino veio da Strava e continua visível só para você. Quando você pede a análise ou abre a conversa, os dados dele são enviados ao provedor de IA para gerar a resposta. <a href="/privacidade">Saiba mais</a>.</p>` : ''}
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

// Draws the training's GPS route as a small inline SVG line — no map tiles
// (no paid map API is configured for this app), just the shape of the path
// itself, which is what actually reads at feed-card size anyway. Longitude
// is scaled by cos(latitude) so the shape isn't stretched, and the drawing
// is centered/scaled to fill the given box with a bit of padding. Returns
// '' when there's no polyline (manual entries, GPX files without real GPS,
// or activities synced before this feature existed).
// Mapa interativo (Leaflet + OpenStreetMap): sobe por cima do mapa estático
// quando o card chega perto da tela. Scroll do mouse só dá zoom depois de
// clicar no mapa (pra não travar a rolagem do feed); no celular, 1 dedo
// rola a página e 2 dedos dão zoom/arrastam.
const LIVE_MAP_SCRIPT = `<script>
(function(){
  var els = document.querySelectorAll('.rtm[data-poly]');
  if (!els.length) return;
  function dec(str){var i=0,lat=0,lng=0,pts=[];while(i<str.length){var b,s=0,r=0;do{b=str.charCodeAt(i++)-63;r|=(b&31)<<s;s+=5;}while(b>=32);lat+=(r&1)?~(r>>1):(r>>1);s=0;r=0;do{b=str.charCodeAt(i++)-63;r|=(b&31)<<s;s+=5;}while(b>=32);lng+=(r&1)?~(r>>1):(r>>1);pts.push([lat/1e5,lng/1e5]);}return pts;}
  var waiting = null;
  function loadLeaflet(cb){
    if (window.L) { cb(); return; }
    if (waiting) { waiting.push(cb); return; }
    waiting = [cb];
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(l);
    var s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = function(){ waiting.forEach(function(f){ f(); }); };
    document.head.appendChild(s);
  }
  function init(el){
    if (el.__live) return; el.__live = true;
    var pts = dec(el.getAttribute('data-poly') || '');
    if (pts.length < 2) return;
    loadLeaflet(function(){
      try {
        var host = document.createElement('div'); host.className = 'rtm-live'; el.appendChild(host);
        var touch = L.Browser.mobile;
        var m = L.map(host, { scrollWheelZoom: false, dragging: !touch, tap: false, zoomSnap: 0.5, fadeAnimation: false });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m);
        var casing = L.polyline(pts, { color: '#ffffff', weight: 6.5, opacity: 0.95 }).addTo(m);
        L.polyline(pts, { color: '#FC4C02', weight: 3.6 }).addTo(m);
        L.circleMarker(pts[0], { radius: 6, color: '#ffffff', weight: 2, fillColor: '#34C759', fillOpacity: 1 }).addTo(m);
        L.circleMarker(pts[pts.length - 1], { radius: 6, color: '#ffffff', weight: 2, fillColor: '#FF3B30', fillOpacity: 1 }).addTo(m);
        m.fitBounds(casing.getBounds(), { padding: [30, 30] });
        host.addEventListener('click', function(){ m.scrollWheelZoom.enable(); });
        host.addEventListener('mouseleave', function(){ m.scrollWheelZoom.disable(); });
        if (touch) { m.touchZoom.enable(); }
        el.classList.add('live');
      } catch (e) { console.error('[mapa]', e); }
    });
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function(entries){ entries.forEach(function(en){ if (en.isIntersecting) { io.unobserve(en.target); init(en.target); } }); }, { rootMargin: '300px' });
    Array.prototype.forEach.call(els, function(el){ io.observe(el); });
  } else { Array.prototype.forEach.call(els, init); }
})();
</script>`;

// Mapa de verdade (ruas) como no Strava: tiles do OpenStreetMap (escurecidos por CSS)
// posicionados em volta do traçado, com a rota desenhada por cima em SVG.
// Se os tiles não carregarem, o fundo escuro + a linha continuam legíveis.
function routeTileMap(polylineStr, opts) {
  if (!polylineStr) return '';
  const points = decodePolyline(polylineStr);
  if (points.length < 2) return '';
  opts = opts || {};
  const W = opts.width || 640, H = opts.height || 320;
  const toWorld = (lat, lon, z) => {
    const n = 256 * Math.pow(2, z);
    const s = Math.sin(lat * Math.PI / 180);
    return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
  };
  const bbox = (zz) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [la, lo] of points) { const [x, y] = toWorld(la, lo, zz); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { x0, x1, y0, y1, w: Math.max(x1 - x0, 1), h: Math.max(y1 - y0, 1) };
  };
  // Zoom fracionário: sobe até o primeiro zoom em que a rota passa do alvo
  // (86% da largura / 78% da altura) e encolhe os tiles por um fator < 1 —
  // assim a rota enche o mapa e os tiles continuam nítidos.
  const TW = W * 0.86, TH = H * 0.78;
  let z = 3;
  while (z < 17 && bbox(z + 1).w <= TW && bbox(z + 1).h <= TH) z++;
  let s = 1, bb = bbox(z);
  if (z < 17) { const bb2 = bbox(z + 1); s = Math.min(TW / bb2.w, TH / bb2.h, 1); z = z + 1; bb = bb2; }
  const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
  const maxT = Math.pow(2, z);
  let tiles = '';
  const halfW = W / 2 / s, halfH = H / 2 / s;
  for (let ty = Math.floor((cy - halfH) / 256); ty <= Math.floor((cy + halfH) / 256); ty++) {
    for (let tx = Math.floor((cx - halfW) / 256); tx <= Math.floor((cx + halfW) / 256); tx++) {
      if (ty < 0 || ty >= maxT) continue;
      const wx = ((tx % maxT) + maxT) % maxT;
      const left = (tx * 256 - cx) * s + W / 2, top = (ty * 256 - cy) * s + H / 2;
      tiles += `<img class="rtm-tile" loading="lazy" alt="" src="https://${'abc'[(wx + ty) % 3]}.tile.openstreetmap.org/${z}/${wx}/${ty}.png" style="left:${(left / W * 100).toFixed(3)}%;top:${(top / H * 100).toFixed(3)}%;width:${(256 * s / W * 100).toFixed(3)}%;height:${(256 * s / H * 100).toFixed(3)}%">`;
    }
  }
  const xy = points.map(([la, lo]) => { const [x, y] = toWorld(la, lo, z); return [(x - cx) * s + W / 2, (y - cy) * s + H / 2]; });
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [sx, sy] = xy[0], [ex, ey] = xy[xy.length - 1];
  return `<div class="rtm" data-poly="${esc(polylineStr)}" style="aspect-ratio:${W}/${H}">${tiles}
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Mapa do percurso">
      <path d="${d}" fill="none" stroke="#fff" stroke-opacity=".95" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${d}" fill="none" stroke="#FC4C02" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="5" fill="#34C759" stroke="#fff" stroke-width="1.5"/>
      <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="5" fill="#FF3B30" stroke="#fff" stroke-width="1.5"/>
    </svg>
    <span class="rtm-attr">© OpenStreetMap</span></div>`;
}

function routeMapSvg(polylineStr, opts) {
  if (!polylineStr) return '';
  const points = decodePolyline(polylineStr);
  if (points.length < 2) return '';
  opts = opts || {};
  const w = opts.width || 320;
  const h = opts.height || 180;
  const pad = opts.pad != null ? opts.pad : 14;

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const [lat, lon] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  const midLatRad = ((minLat + maxLat) / 2) * Math.PI / 180;
  const lonScale = Math.cos(midLatRad) || 1;
  const spanX = Math.max((maxLon - minLon) * lonScale, 0.00001);
  const spanY = Math.max(maxLat - minLat, 0.00001);
  const availW = w - pad * 2, availH = h - pad * 2;
  const scale = Math.min(availW / spanX, availH / spanY);
  const drawW = spanX * scale, drawH = spanY * scale;
  const offX = pad + (availW - drawW) / 2;
  const offY = pad + (availH - drawH) / 2;
  const toXY = ([lat, lon]) => [
    offX + (lon - minLon) * lonScale * scale,
    offY + (maxLat - lat) * scale,
  ];

  const d = points.map((pt, i) => {
    const [x, y] = toXY(pt);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const [sx, sy] = toXY(points[0]);
  const [ex, ey] = toXY(points[points.length - 1]);

  return `<svg class="route-map" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Traçado da rota">
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="4" fill="var(--green)"/>
    <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4" fill="var(--red)"/>
  </svg>`;
}

// When a post is linked to an activity the athlete explicitly chose to
// publish (p.is_auto, set only via "Compartilhar no feed"), the card shows
// the run's own stats instead of a typed caption, closer to how Strava's
// activity stream reads than a blank-textarea social post.
function activityStatBlock(p, mediaHtml) {
  mediaHtml = mediaHtml || '';
  const stats = [
    p.activity_distance_km != null ? [`${p.activity_distance_km}`, ' km', 'Distância'] : null,
    p.activity_avg_pace_sec != null ? [secToPace(p.activity_avg_pace_sec), ' /km', 'Ritmo'] : null,
    p.activity_duration_sec != null ? [fmtClock(p.activity_duration_sec), '', 'Tempo'] : null,
    p.activity_elevation_gain_m ? [Math.round(p.activity_elevation_gain_m), ' m', 'Elevação'] : null,
  ].filter(Boolean);
  // texto automático "10.6km em 59:00 (pace 5:34/km)" repete os números — some
  const body = p.body && !/^\s*[\d.,]+\s*km em /i.test(p.body) ? p.body : '';
  return `<a class="strava-title" href="/activities/${p.activity_id}">${esc(p.activity_title)}</a>
  ${body ? `<div class="strava-desc">${esc(body).replace(/\n/g, '<br>')}</div>` : ''}
  ${stats.length ? `<div class="strava-stats">${stats.map(([v, u, k]) => `<div class="strava-stat"><div class="k">${esc(k)}</div><div class="v">${esc(String(v))}${u ? `<span class="u">${esc(u)}</span>` : ''}</div></div>`).join('')}</div>` : ''}
  ${zonesHtml(zonesForActivity({ laps_json: p.activity_laps_json, intervals_json: p.activity_intervals_json, avg_hr: p.activity_avg_hr, max_hr: null, duration_sec: p.activity_duration_sec }, p.author_hr_zones_json, p.author_obs_max_hr), true)}
  ${mediaHtml}`;
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

function workoutLabel(t) {
  t = (t || '').toLowerCase();
  if (t.includes('long')) return 'Longão';
  if (t.includes('interval') || t.includes('tiro')) return 'Intervalado';
  if (t.includes('ritmo') || t.includes('tempo')) return 'Ritmo';
  if (t.includes('prog')) return 'Progressivo';
  return 'Corrida';
}
function fmtStartLine(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${day} às ${hm}`;
}

function postCard(user, p, returnTo, mentionMap) {
  const mine = p.user_id === user.id;
  const comments = p.comments || [];
  returnTo = returnTo || '/feed';
  const photos = p.photos || (p.photo_path ? [p.photo_path] : []);
  const isAct = !!p.activity_id;
  const kind = isAct ? 'treino' : (photos.length ? 'foto' : 'texto');
  let media = '';
  if (isAct) {
    const slides = [];
    if (p.activity_route_polyline) slides.push(routeTileMap(p.activity_route_polyline, { width: 900, height: 506 }));
    photos.forEach((ph) => slides.push(fx.photoSlide(ph)));
    media = slides.length ? fx.carousel(slides, '16/9') : '';
    if (media) media = `<div class="strava-map">${media}</div>`;
    else if (p.activity_laps && p.activity_laps.length > 1) media = `<div class="strava-splits">${paceBarsHtml({ avg_pace_sec: p.activity_avg_pace_sec }, p.activity_laps, 12)}</div>`;
  } else if (photos.length) {
    media = fx.carousel(photos.map(fx.photoSlide), '4/3');
  }
  const stravaNote = p.strava_hidden ? `<p class="muted strava-note" style="font-size:12.5px; margin:8px 0 0;">Treino registrado pelo Strava. Os detalhes (mapa, pace, zonas) ficam visíveis só para o atleta.</p>` : '';
  const caption = p.body && !isAct ? `<div class="post-body${kind === 'texto' ? ' post-body-x' : ''}">${fx.linkify(p.body, mentionMap)}</div>` : '';
  return `<div class="card post-card post-${kind}${isAct ? ' post-card-auto' : ''}${p.is_pr ? ' post-pr' : ''}">
  <div class="post-head">
    ${avatarHtml(p.author_name, p.user_id, p.author_avatar_path)}
    <div class="post-head-meta">
      <div class="post-name">${p.author_slug ? `<a href="/u/${esc(p.author_slug)}">${esc(p.author_name)}</a>` : esc(p.author_name)}${mine ? ' <span class="pill">você</span>' : ''}</div>
      <div class="post-time" title="${esc(fmtDate(p.created_at))}">${isAct ? `${esc(workoutLabel(p.activity_workout_type))} · ` : ''}${p.activity_started_at ? esc(fmtStartLine(p.activity_started_at)) : timeAgo(p.created_at)}${p.location ? ` · <span class="post-loc">${icon('pin', 'loc' + p.id)}${esc(p.location)}</span>` : (p.author_city ? ` · ${esc(p.author_city)}` : '')}</div>
    </div>
    ${p.is_pr ? `<span class="pill pr-badge" title="${p.pr_label ? esc(p.pr_label) : ''}">${icon('trophy', 'pr' + p.id)}Recorde</span>` : ''}
    ${!mine ? `<a class="report-link" href="/denunciar?type=post&id=${p.id}&return_to=${encodeURIComponent(returnTo)}" title="Denunciar post" aria-label="Denunciar post">Denunciar</a>` : ''}
    ${mine ? `<form method="POST" action="/feed/${p.id}/delete" class="post-delete-form" onsubmit="return confirm('Excluir este post? Essa ação não pode ser desfeita.')">
      <input type="hidden" name="return_to" value="${esc(returnTo)}">
      <button class="post-delete-btn" type="submit" title="Excluir post" aria-label="Excluir post">${icon('trash', 'del' + p.id)}</button>
    </form>` : ''}
  </div>
  ${kind === 'foto' ? media : ''}
  ${caption}${stravaNote}
  ${p.is_pr && p.pr_label ? `<p class="pr-label">${icon('trophy', 'prl' + p.id)}${esc(p.pr_label)}</p>` : ''}
  ${isAct ? activityStatBlock(p, media) : ''}
  <div class="post-actions">
    ${reactionPicker(p, returnTo)}
    <span class="post-comment-count">${icon('chat', 'c' + p.id)}<span>${comments.length}</span></span>
  </div>
  ${comments.length ? `<div class="post-comments">
    ${comments.map((c) => `<div class="comment-item">${avatarHtml(c.author_name, c.user_id, c.author_avatar_path, 'comment-avatar')}<span class="comment-main"><span class="comment-author">${esc(c.author_name)}</span> <span class="comment-body">${esc(c.body)}</span><span class="comment-time">${timeAgo(c.created_at)}</span>${c.user_id !== user.id ? ` <a class="report-link xs" href="/denunciar?type=comment&id=${c.id}&return_to=${encodeURIComponent(returnTo)}">Denunciar</a>` : ''}</span></div>`).join('')}
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
  const view = opts.view === 'meu' ? 'meu' : (opts.view === 'noticias' ? 'noticias' : 'pub');
  const scope = opts.scope === 'following' ? 'following' : 'all';
  const returnQs = [view === 'meu' ? 'view=meu' : null, scope === 'following' && view === 'pub' ? 'scope=following' : null, opts.beforeId ? `before_id=${opts.beforeId}` : null].filter(Boolean).join('&');
  const returnTo = '/feed' + (returnQs ? `?${returnQs}` : '');

  const mainTabs = `<div class="feed-main-tabs" role="tablist">
    <a class="fmt${view === 'pub' ? ' active' : ''}" href="/feed" role="tab">Publicações</a>
    <a class="fmt${view === 'meu' ? ' active' : ''}" href="/feed?view=meu" role="tab">Meu feed</a>
    <a class="fmt${view === 'noticias' ? ' active' : ''}" href="/feed?view=noticias" role="tab">Notícias</a>
  </div>`;

  const newsCat = NEWS_CATS[opts.newsCat] ? opts.newsCat : 'todas';
  const newsChips = `<div class="news-chips">
    <a class="news-chip${newsCat === 'todas' ? ' on' : ''}" href="/feed?view=noticias">Tudo</a>
    ${NEWS_CAT_KEYS.map((k) => `<a class="news-chip${newsCat === k ? ' on' : ''}" href="/feed?view=noticias&cat=${k}">${esc(NEWS_CATS[k].label)}</a>`).join('')}
  </div>`;
  const newsItems = (opts.news && opts.news.items) || [];
  const newsHtml = newsItems.length ? `<div class="news-list">${newsItems.map((n) => `<a class="card news-item" href="/feed/noticia?u=${encodeURIComponent(n.link)}&t=${encodeURIComponent(n.title)}&s=${encodeURIComponent(n.source || '')}&c=${esc(n.cat || '')}">
    <span class="news-thumb c-${esc(n.cat || 'noticias')}">${esc((n.source || 'N').trim().charAt(0).toUpperCase())}</span>
    <span class="news-main">
      <span class="news-cat">${esc((NEWS_CATS[n.cat] || NEWS_CATS.noticias).label)}</span>
      <span class="news-title">${esc(n.title)}</span>
      <span class="news-meta">${esc(n.source || 'Fonte')} · ${timeAgo(new Date(n.ts).toISOString())}</span>
    </span>
  </a>`).join('')}</div>
  <p class="muted" style="font-size:12px;margin:10px 2px 0;">Manchetes via Google Notícias. Toque numa manchete para ler aqui dentro, com crédito e link do veículo.</p>` : `<div class="card feed-empty">
  <div class="feed-empty-icon">${icon('flame', 'fe1')}</div>
  <p style="margin:0; font-weight:800;">${opts.news && !opts.news.ok ? 'Não consegui carregar as notícias agora' : 'Nenhuma notícia nessa categoria'}</p>
  <p class="muted" style="margin:4px 0 0;">Tente de novo em instantes.</p>
</div>`;

  const scopeTabs = `<div class="feed-tabs">
    <a class="feed-tab${scope === 'all' ? ' active' : ''}" href="/feed">Todos</a>
    <a class="feed-tab${scope === 'following' ? ' active' : ''}" href="/feed?scope=following">Seguindo</a>
  </div>`;

  const pagination = opts.nextBeforeId ? `<div class="feed-pagination">
    <a class="ghost btn" href="/feed?before_id=${opts.nextBeforeId}${view === 'meu' ? '&view=meu' : (scope === 'following' ? '&scope=following' : '')}">Ver mais posts antigos →</a>
  </div>` : '';

  const pr = opts.profile || { posts: 0, followers: 0, following: 0 };
  const profileHead = `<div class="card ig-head">
  <div class="ig-top">
    ${avatarHtml(user.name, user.id, user.avatar_path, 'ig-avatar')}
    <div class="ig-counts">
      <div><b>${pr.posts}</b><span>publicações</span></div>
      <div><b>${pr.followers}</b><span>seguidores</span></div>
      <div><b>${pr.following}</b><span>seguindo</span></div>
    </div>
  </div>
  <div class="ig-name">${esc(user.name)}${user.public_slug ? ` <a class="ig-slug" href="/u/${esc(user.public_slug)}">@${esc(user.public_slug)}</a>` : ''}</div>
  ${user.city ? `<div class="ig-city muted">${esc(user.city)}</div>` : ''}
  <div class="ig-bio">${user.bio ? esc(user.bio).replace(/\n/g, '<br>') : '<span class="muted">Sem bio ainda. Conte quem você é como corredor(a).</span>'}</div>
  <details class="ig-edit"${opts.editBio ? ' open' : ''}>
    <summary class="ghost btn">Editar bio</summary>
    <form method="POST" action="/feed/bio" class="ig-bio-form">
      <textarea name="bio" rows="4" maxlength="300" placeholder="Escreva sua bio (até 300 caracteres)">${esc(user.bio || '')}</textarea>
      <div class="ig-bio-actions"><span class="muted" style="font-size:12px;">Aparece também no seu perfil público.</span><button type="submit">Salvar</button></div>
    </form>
  </details>
  <div class="ig-links"><a class="ghost btn" href="/feed">+ Novo post</a>${user.public_slug ? `<a class="ghost btn" href="/u/${esc(user.public_slug)}">Ver perfil público</a>` : ''}</div>
</div>`;

  const emptyHtml = (title, sub) => `<div class="card feed-empty">
  <div class="feed-empty-icon">${icon('flame', 'fe1')}</div>
  <p style="margin:0; font-weight:800;">${title}</p>
  <p class="muted" style="margin:4px 0 0;">${sub}</p>
</div>`;
  const list = (empty) => (posts.length ? `<div class="feed-list">${posts.map((p) => postCard(user, p, returnTo, opts.mentionMap)).join('')}</div>` : empty);

  const body = view === 'noticias' ? `
<h1>Feed</h1>
${mainTabs}
${newsChips}
${newsHtml}
` : view === 'meu' ? `
<h1>Feed</h1>
${mainTabs}
${profileHead}
${list(emptyHtml('Você ainda não publicou nada', 'Compartilhe um treino com legenda na aba Publicações e ele aparece aqui.'))}
${pagination}
${LIVE_MAP_SCRIPT}
${fx.FEED_SCRIPT}
` : `
<h1>Feed</h1>
${mainTabs}
${scopeTabs}
${opts.tag ? `<div class="tag-filter"><span class="pill"><span class="dot"></span>#${esc(opts.tag)}</span> <a href="/feed">limpar filtro</a></div>` : ''}
${!opts.tag ? fx.storiesBar(opts.stories, user, avatarHtml) : ''}
${!opts.tag ? fx.weekCard(opts.week, user, avatarHtml) : ''}
${fx.composer(user, opts, avatarHtml)}
${list(emptyHtml(opts.tag ? 'Nenhum post com essa hashtag' : (scope === 'following' ? 'Ninguém que você segue postou ainda' : 'Nenhum post ainda'), scope === 'following' ? 'Siga outros atletas pelo perfil público deles para ver os treinos aqui.' : 'Seja o primeiro a compartilhar com a galera.'))}
${pagination}
${LIVE_MAP_SCRIPT}
${fx.FEED_SCRIPT}
`;
  return layout({ title: 'Feed', user, body, active: 'feed' });
}

function readerPage(user, a, meta) {
  a = a || {};
  meta = meta || {};
  const cat = NEWS_CATS[meta.cat] ? meta.cat : '';
  const back = `/feed?view=noticias${cat ? `&cat=${cat}` : ''}`;
  const title = a.title || meta.title || 'Notícia';
  const source = a.site || meta.source || a.host || 'Fonte';
  const original = a.ok && a.url ? a.url : meta.link;
  const head = `<a class="reader-back" href="${esc(back)}">&larr; Notícias</a>
  ${cat ? `<span class="news-cat">${esc(NEWS_CATS[cat].label)}</span>` : ''}
  <h1 class="reader-title">${esc(title)}</h1>
  <div class="news-meta">${esc(source)}${a.host && a.host !== source ? ` · ${esc(a.host)}` : ''}</div>`;
  const orig = `<a class="btn reader-orig" href="${esc(original)}" target="_blank" rel="noopener noreferrer">Ler no site original &#8599;</a>`;
  const body = a.ok ? `<article class="card reader">
    ${head}
    ${a.image ? `<img class="reader-img" src="${esc(a.image)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">` : ''}
    <div class="reader-body">${a.blocks.map((b) => (b.kind === 'h' ? `<h3>${esc(b.text)}</h3>` : (b.kind === 'q' ? `<blockquote>${esc(b.text)}</blockquote>` : `<p>${esc(b.text)}</p>`))).join('')}</div>
    <div class="reader-foot"><p class="muted">Texto de ${esc(a.host || source)}, exibido aqui em modo leitura. Todos os direitos pertencem ao veículo.</p>${orig}</div>
  </article>` : `<article class="card reader">
    ${head}
    <p class="reader-fail">Esse veículo não permite a leitura aqui dentro. Você pode abrir a matéria no site original.</p>
    <div class="reader-foot">${orig}</div>
  </article>`;
  return layout({ title: 'Notícia', user, body: `<div class="reader-wrap">${body}</div>`, active: 'feed' });
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
    <h1 style="margin:0 0 4px;">${esc(profileUser.name)}${social.weeklyStreak ? ` <span class="pill streak-pill">${icon('flame', 'ppstreak')}${social.weeklyStreak} ${social.weeklyStreak === 1 ? 'semana' : 'semanas'}</span>` : ''}</h1>
    ${profileUser.city ? `<p class="muted" style="margin:0 0 6px;">${esc(profileUser.city)}</p>` : ''}
    ${profileUser.bio ? `<p style="margin:0;">${esc(profileUser.bio)}</p>` : ''}
    ${profileUser.goal_race_name ? `<div class="pill" style="margin-top:10px;"><span class="dot"></span>Meta: ${esc(profileUser.goal_race_name)}${profileUser.goal_time_sec ? ` em ${fmtClock(profileUser.goal_time_sec)}` : ''}</div>` : ''}
    <p class="muted follow-counts" style="margin-top:10px;"><strong>${social.followerCount || 0}</strong> seguidores · <strong>${social.followingCount || 0}</strong> seguindo</p>
  </div>
  ${canFollow ? `<form method="POST" action="/u/${esc(profileUser.public_slug)}/follow" class="follow-form">
    <input type="hidden" name="return_to" value="/u/${esc(profileUser.public_slug)}">
    <button class="${social.isFollowing ? 'ghost' : ''} btn" type="submit">${social.isFollowing ? 'Seguindo ✓' : 'Seguir'}</button>
  </form>` : ''}
  ${canFollow ? `<div class="profile-mod">
    <a class="report-link" href="/denunciar?type=user&id=${profileUser.id}&return_to=${encodeURIComponent('/u/' + profileUser.public_slug)}">Denunciar</a>
    <form method="POST" action="/u/${esc(profileUser.public_slug)}/block" onsubmit="return confirm('Bloquear esta pessoa? Vocês deixam de ver um ao outro.')"><input type="hidden" name="return_to" value="/discover"><button class="report-link" type="submit">Bloquear</button></form>
  </div>` : ''}
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

<p class="muted" style="margin-top:20px;">Perfil público do Runiqx.${!viewer ? ' <a href="/signup">Crie o seu.</a>' : ''}</p>
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
<p class="lede">Encontre outros corredores no Runiqx e siga quem você quiser acompanhar.</p>
<form method="GET" action="/discover" class="discover-search">
  <input type="text" name="q" value="${esc(q || '')}" placeholder="Buscar por nome ou cidade..." autofocus>
  <button class="ghost btn" type="submit">Buscar</button>
</form>
${rows || `<div class="card feed-empty"><div class="feed-empty-icon">${icon('heart', 'disc1')}</div><p style="margin:0; font-weight:800;">${q ? 'Ninguém encontrado' : 'Ainda não há outros atletas'}</p><p class="muted" style="margin:4px 0 0;">${q ? 'Tenta buscar outro nome ou cidade.' : 'Quando outras pessoas se cadastrarem no Runiqx, elas aparecem aqui.'}</p></div>`}
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
    ctx.fillText('RUNIQX', 60, 110);

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
    <p class="muted">Conectado — o Garmin sincroniza com o Strava automaticamente, e o Runiqx importa suas corridas de lá.</p>
    <div class="row" style="gap:10px; display:flex;">
      <a class="ghost btn" href="/activities">Ir para Treinos e sincronizar</a>
      <form method="POST" action="/strava/disconnect" onsubmit="return confirm('Ao desconectar, apagamos de forma permanente os treinos importados da Strava. Continuar?')"><button class="danger" type="submit">Desconectar</button></form>
    </div>
  ` : `
    <p class="muted">Conecte sua conta do Strava para importar seus treinos automaticamente (inclusive os que já sincronizam do Garmin para o Strava).</p>
    <a class="btn strava-btn" href="/strava/connect">Conectar com Strava</a>
    ${STRAVA_NOTE}
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
  <h2><span class="h-icon">${icon('heart', 'ai2')}</span>Chave da API da Anthropic (opcional)</h2>
  <p class="muted">${flags.aiSharedAvailable
    ? 'O Professor, o Coach por chat e as análises técnicas de treino já funcionam por padrão pra todo mundo. Se preferir, você pode colar sua própria chave da Anthropic aqui embaixo pra usar a sua conta em vez da conta compartilhada do app — nesse caso o uso passa a ser cobrado na sua própria conta.'
    : 'Cole sua própria chave da API da Anthropic para habilitar o Professor, o Coach por chat e as análises técnicas automáticas dos seus treinos. A chave fica salva só na sua conta e é usada apenas pra você — o uso é cobrado na sua própria conta Anthropic.'
  } Não tem uma chave ainda? <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Crie uma em console.anthropic.com</a>.</p>
  <form method="POST" action="/settings/api-key">
    <label>Chave da API (sk-ant-...)</label>
    <input name="anthropic_api_key" value="${user.anthropic_api_key ? '••••••••••••' + esc(user.anthropic_api_key.slice(-4)) : ''}" placeholder="sk-ant-...">
    <div style="margin-top:12px;"><button class="ghost" type="submit">Salvar chave</button></div>
  </form>
</div>

<div class="card">
  <h2><span class="h-icon">${icon('flame', 'ai3')}</span>Chave da API da OpenAI (Professor em voz)</h2>
  <p class="muted">${flags.aiVoiceSharedAvailable
    ? 'A conversa de voz do Professor já funciona por padrão pra todo mundo. Se preferir, você pode colar sua própria chave da OpenAI aqui embaixo pra usar a sua conta em vez da conta compartilhada do app.'
    : 'O Professor agora conversa por voz de verdade, em tempo real (não é mais a voz sintética do navegador) — isso usa a API de voz da OpenAI, separada da chave da Anthropic acima. Cole sua própria chave aqui pra habilitar. A chave fica salva só na sua conta e o uso é cobrado na sua própria conta OpenAI (é uma chamada de voz contínua, então custa mais por minuto do que o chat de texto).'
  } Não tem uma chave ainda? <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">Crie uma em platform.openai.com</a>.</p>
  <form method="POST" action="/settings/openai-api-key">
    <label>Chave da API (sk-...)</label>
    <input name="openai_api_key" value="${user.openai_api_key ? '••••••••••••' + esc(user.openai_api_key.slice(-4)) : ''}" placeholder="sk-...">
    <div style="margin-top:12px;"><button class="ghost" type="submit">Salvar chave</button></div>
  </form>
</div>

<div class="card">
  <h2>Usuários bloqueados</h2>
  <p class="muted">Veja e desbloqueie as pessoas que você bloqueou. Para denunciar ou bloquear alguém, use os botões nos posts e nos perfis. <a href="/termos">Termos de uso</a>.</p>
  <a class="btn ghost" href="/bloqueados">Gerenciar bloqueios</a>
</div>

<div class="card" id="excluir-conta">
  <h2>Excluir conta</h2>
  <p class="muted">Apaga de forma permanente a sua conta e tudo o que está ligado a ela: treinos, posts, fotos, comentários e a conexão com a Strava. Essa ação não pode ser desfeita.</p>
  ${flags.deleteError === 'admin' ? `<div class="err">Contas de administrador não podem ser excluídas por aqui.</div>` : flags.deleteError ? `<div class="err">Não consegui excluir. Confira a senha e digite EXCLUIR.</div>` : ''}
  <form method="POST" action="/settings/delete-account" onsubmit="return confirm('Excluir sua conta de forma permanente?')">
    <label>Sua senha</label>
    <input type="password" name="password" required autocomplete="current-password">
    <label>Digite EXCLUIR para confirmar</label>
    <input type="text" name="confirm" required autocomplete="off">
    <div style="margin-top:12px;"><button class="danger" type="submit">Excluir minha conta</button></div>
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

// Admin dashboard — Felipe-only (gated server-side by user.is_admin, see
// requireAdmin in server.js). One screen: aggregate numbers up top, every
// athlete underneath, each row linking into their own detail page.
function adminPage(user, { users, stats }) {
  const body = `
<h1>Admin</h1>
<p class="lede">Todos os atletas cadastrados no Runiqx, num lugar só.</p>

<div class="grid cols-4">
  <div class="card stat"><div class="k">Atletas</div><div class="v">${stats.totalUsers}</div></div>
  <div class="card stat"><div class="k">Treinos registrados</div><div class="v">${stats.totalActivities}</div></div>
  <div class="card stat"><div class="k">Conectados ao Strava</div><div class="v">${stats.stravaConnected}</div></div>
  <div class="card stat"><div class="k">Com chave própria</div><div class="v">${stats.withOwnKey}</div></div>
</div>

<div class="card" style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
  <div><h2 style="margin:0;">Denúncias</h2><p class="muted" style="margin:4px 0 0;">${stats.openReports || 0} em aberto (meta: responder em até 24h)</p></div>
  <a class="btn" href="/admin/reports">Abrir fila</a>
</div>

<div class="card">
  <h2>Todos os atletas <span class="pill">${users.length}</span></h2>
  ${users.map((u) => `
    <a class="list-item" href="/admin/users/${u.id}">
      <div>
        <div class="t">${esc(u.name)}${u.is_admin ? ' <span class="pill">Admin</span>' : ''}</div>
        <div class="muted mono">${esc(u.email)} · Nº ${memberNumber(u)} · desde ${fmtDate(u.created_at)}</div>
      </div>
      <div class="row" style="gap:6px; flex-wrap:nowrap;">
        ${u.strava_refresh_token ? `<span class="pill">Strava</span>` : ''}
        ${u.anthropic_api_key ? `<span class="pill">Chave própria</span>` : ''}
        <span class="muted">${u.activity_count} treino${u.activity_count === 1 ? '' : 's'}</span>
      </div>
    </a>
  `).join('')}
</div>
`;
  return layout({ title: 'Admin', user, body, active: 'admin' });
}

// Single-athlete admin view — their profile fields, a quick look at their
// training, and the one actual "control" this panel offers: delete the
// account. Everything else here is read-only on purpose; there's no edit
// form for someone else's profile, because Felipe asked to *see* and
// *control* accounts, not to ghostwrite them.
function adminUserDetailPage(user, { athlete, activities, posts }) {
  const body = `
<a class="link mono" href="/admin" style="display:inline-block; margin-top:20px; text-decoration:none;">← Todos os atletas</a>
<h1>${esc(athlete.name)}${athlete.is_admin ? ' <span class="pill">Admin</span>' : ''}</h1>
<p class="lede">Nº ${memberNumber(athlete)} · ${esc(athlete.email)} · desde ${fmtDate(athlete.created_at)}</p>

<div class="grid cols-4">
  <div class="card stat"><div class="k">Treinos</div><div class="v">${activities.length}</div></div>
  <div class="card stat"><div class="k">Posts no feed</div><div class="v">${posts.length}</div></div>
  <div class="card stat"><div class="k">Strava</div><div class="v" style="font-size:18px;">${athlete.strava_refresh_token ? 'Conectado' : '—'}</div></div>
  <div class="card stat"><div class="k">Chave Anthropic</div><div class="v" style="font-size:18px;">${athlete.anthropic_api_key ? 'Própria' : 'Compartilhada'}</div></div>
</div>

<div class="card">
  <h2>Perfil</h2>
  <p class="muted" style="margin:0; font-size:14px;">
    ${athlete.city ? `Cidade: ${esc(athlete.city)}<br>` : ''}
    ${athlete.experience_level ? `Nível: ${esc(athlete.experience_level)}<br>` : ''}
    ${athlete.weekly_km ? `Volume semanal: ${athlete.weekly_km}km<br>` : ''}
    ${athlete.goal_race_name ? `Meta: ${esc(athlete.goal_race_name)}${athlete.goal_time_sec ? ` em ${fmtClock(athlete.goal_time_sec)}` : ''}<br>` : ''}
    ${athlete.injury_notes ? `Histórico/lesões: ${esc(athlete.injury_notes)}<br>` : ''}
    ${athlete.bio ? `Bio: ${esc(athlete.bio)}` : ''}
    ${!athlete.city && !athlete.experience_level && !athlete.weekly_km && !athlete.goal_race_name && !athlete.injury_notes && !athlete.bio ? 'Sem dados de pré-diagnóstico ou perfil preenchidos.' : ''}
  </p>
</div>

<div class="card">
  <h2>Últimos treinos</h2>
  ${activities.length ? activities.slice(0, 20).map((a) => `
    <div class="list-item">
      <div>
        <div class="t">${esc(a.title)}</div>
        <div class="muted">${a.distance_km ? `${a.distance_km}km` : ''}${a.started_at ? ` · ${fmtDate(a.started_at)}` : ''}</div>
      </div>
      <span class="pill">${esc(a.workout_type || 'treino')}</span>
    </div>
  `).join('') : `<p class="muted" style="margin:0;">Nenhum treino ainda.</p>`}
</div>

<div class="card">
  <h2>Zona de risco</h2>
  <p class="muted">Excluir a conta remove permanentemente o atleta e todos os dados dele(a) — treinos, posts, reações, conversas com o Coach. Essa ação não pode ser desfeita.</p>
  ${athlete.id === user.id
    ? `<p class="muted" style="margin:0;">Você não pode excluir sua própria conta de admin por aqui.</p>`
    : `<form method="POST" action="/admin/users/${athlete.id}/delete" onsubmit="return confirm('Excluir esse atleta e todos os dados dele(a)? Essa ação não pode ser desfeita.');">
        <button class="danger" type="submit">${icon('trash', 'adel')}Excluir atleta</button>
      </form>`}
</div>
`;
  return layout({ title: `Admin · ${athlete.name}`, user, body, active: 'admin' });
}

module.exports = {
  layout, privacyPage, deleteAccountPage,loginPage, signupPage, dashboardPage, racesPage,
  activitiesPage, activityNewPage, activityDetailPage, feedPage, settingsPage, coachChatPage,
  publicProfilePage, storyPage, landingPage, welcomePage, discoverPage,
  adminPage, adminUserDetailPage, readerPage,
};
