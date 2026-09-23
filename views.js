const { secToPace, fmtClock, fmtDate, esc, renderMarkdownLite, icon } = require('./lib/format');

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
} catch (e) {}
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
body: JSON.stringify({ message: text }),
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

const HERO_EXTRA_HEAD = `<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js" defer></script>`;

const HERO_SCRIPT = `<script defer>
(function(){
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

var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0.4, 9);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
var dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(4, 6, 6);
scene.add(dir);
var rim = new THREE.PointLight(accent2, 1.1, 14);
rim.position.set(-3, 2, 3);
scene.add(rim);

// Ambient rotating "ground" ring + particle field — kept low, beneath
// the runner's feet, so it reads as an abstract data-plane the figure
// is running across rather than the main subject.
var group = new THREE.Group();
group.position.y = -1.55;
scene.add(group);

var ring = new THREE.Mesh(
new THREE.TorusGeometry(3.1, 0.04, 16, 120),
new THREE.MeshStandardMaterial({ color: accent, roughness: 0.35, metalness: 0.5 })
);
ring.rotation.x = Math.PI / 2.15;
group.add(ring);

var dotCount = 60;
var dotGeo = new THREE.BufferGeometry();
var positions = new Float32Array(dotCount * 3);
for (var i = 0; i < dotCount; i++) {
var angle = (i / dotCount) * Math.PI * 2;
var radius = 3.1 + (Math.random() - 0.5) * 0.5;
positions[i * 3] = Math.cos(angle) * radius;
positions[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
positions[i * 3 + 2] = Math.sin(angle) * radius;
}
dotGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
var dots = new THREE.Points(dotGeo, new THREE.PointsMaterial({ color: accent, size: 0.06 }));
group.add(dots);

// ---- procedural runner: a stylized glowing humanoid built from simple
// primitives (cylinders + spheres), animated with basic forward
// kinematics — hip/knee/shoulder pivot groups driven by phase-offset
// sine waves — rather than a loaded rigged model, since no external 3D
// assets can be hosted in this environment.
var runner = new THREE.Group();
runner.position.set(0, -0.35, 0.8);
scene.add(runner);

var bodyMat = new THREE.MeshStandardMaterial({ color: accent2, emissive: accent2, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.5 });
var limbMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.4, roughness: 0.35, metalness: 0.4 });

var hipY = 1.15, upperLen = 0.62, lowerLen = 0.6, shoulderY = 2.05, upperArmLen = 0.46, lowerArmLen = 0.42;

var torsoGroup = new THREE.Group();
torsoGroup.position.set(0, hipY, 0);
torsoGroup.rotation.x = -0.14;
runner.add(torsoGroup);

var torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.21, shoulderY - hipY, 12), bodyMat);
torso.position.y = (shoulderY - hipY) / 2;
torsoGroup.add(torso);

var head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 16), bodyMat);
head.position.y = (shoulderY - hipY) + 0.26;
torsoGroup.add(head);

function makeLimb(parent, side, atY, upLen, lowLen, mat, thick) {
var pivot = new THREE.Group();
pivot.position.set(side * 0.19, atY, 0);
parent.add(pivot);

var upper = new THREE.Mesh(new THREE.CylinderGeometry(thick, thick * 0.82, upLen, 10), mat);
upper.position.y = -upLen / 2;
pivot.add(upper);

var knee = new THREE.Group();
knee.position.y = -upLen;
pivot.add(knee);

var lower = new THREE.Mesh(new THREE.CylinderGeometry(thick * 0.78, thick * 0.55, lowLen, 10), mat);
lower.position.y = -lowLen / 2;
knee.add(lower);

var tip = new THREE.Mesh(new THREE.SphereGeometry(thick * 0.7, 8, 8), mat);
tip.position.y = -lowLen;
knee.add(tip);

return { pivot: pivot, joint: knee };
}

var legR = makeLimb(runner, 1, hipY, upperLen, lowerLen, limbMat, 0.095);
var legL = makeLimb(runner, -1, hipY, upperLen, lowerLen, limbMat, 0.095);
var armR = makeLimb(torsoGroup, 1, shoulderY - hipY - 0.06, upperArmLen, lowerArmLen, limbMat, 0.065);
var armL = makeLimb(torsoGroup, -1, shoulderY - hipY - 0.06, upperArmLen, lowerArmLen, limbMat, 0.065);

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

if (reduced) { renderFrame(); return; }

var gaitPhase = 0;
var lastT = null;

function swing(limb, offset, hipAmp, kneeBase, kneeAmp, leadIn) {
limb.pivot.rotation.x = hipAmp * Math.sin(gaitPhase + offset);
limb.joint.rotation.x = kneeBase + kneeAmp * Math.max(0, Math.sin(gaitPhase + offset + leadIn));
}

function animate(t) {
var dt = lastT == null ? 0.016 : Math.min(0.05, (t - lastT) / 1000);
lastT = t;

group.rotation.y += dt * 0.25;
ring.rotation.z += dt * 0.12;

gaitPhase += dt * 6.4;
swing(legR, 0, 0.85, 0.5, 0.75, 0.9);
swing(legL, Math.PI, 0.85, 0.5, 0.75, 0.9);
swing(armR, Math.PI, 0.6, 0.45, 0.55, 0.9);
swing(armL, 0, 0.6, 0.45, 0.55, 0.9);

runner.position.y = -0.35 + Math.abs(Math.sin(gaitPhase)) * 0.07;
runner.rotation.y = Math.sin(gaitPhase * 0.15) * 0.08;

camera.position.x += (mouseX * 1.3 - camera.position.x) * 0.04;
camera.position.y += (0.4 - mouseY * 0.6 - camera.position.y) * 0.04;
camera.lookAt(0, 0.9, 0);

renderFrame();
requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
} catch (e) {}
})();
</script>`;

function calendarHtml(calendar) {
  if (!calendar) return '';
  const rows = calendar.weeks.map(week => `
  <div class="cal-row">
  ${week.map(cell => {
    if (!cell) return `<div class="cal-cell empty"></div>`;
    const dots = [
      cell.trainings.length ? `<span class="cal-dot dot-training" title="${cell.trainings.length} treino(s)"></span>` : '',
      cell.races.length ? `<span class="cal-dot dot-race" title="${esc(cell.races.map(r => r.name).join(', '))}"></span>` : '',
      ].join('');
    const href = cell.trainings.length === 1 ? ` data-href="/activities/${cell.trainings[0].id}"` : '';
    return `<div class="cal-cell${cell.isToday ? ' today' : ''}"${href}><span class="cal-daynum">${cell.day}</span><span class="cal-dots">${dots}</span></div>`;
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
<script>
(function(){
try {
document.querySelectorAll('.cal-cell[data-href]').forEach(function(el){
el.style.cursor = 'pointer';
el.addEventListener('click', function(){ window.location.href = el.getAttribute('data-href'); });
});
} catch (e) {}
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
<canvas id="hero-canvas"></canvas>
<div class="hero-overlay"></div>
<div class="hero-badge" id="hero-badge"><span class="hero-badge-glow"></span>${icon('shoe', 'hero')}</div>
<div class="hero-content">
<div class="hero-eyebrow">Rumo à Maratona de Curitiba</div>
<h1>Olá, ${esc(user.name.split(' ')[0])}</h1>
<p class="lede">${user.city ? esc(user.city) + ' · ' : ''}${user.goal_race_name ? 'Meta: ' + esc(user.goal_race_name) : 'Defina sua meta em Config'}</p>
</div>
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
  return layout({ title: 'Perfil', user, body, active: 'home', extraHead: HERO_EXTRA_HEAD, bodyEnd: HERO_SCRIPT });
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

function activityDetailPage({ user, activity, laps, blocks, aiEnabled }) {
  const maxSplit = laps.length ? Math.max(...laps.map(l => l.split_sec)) : 1;
  const bars = laps.map(l => {
    const h = Math.max(8, Math.round((l.split_sec / maxSplit) * 100));
    return `<div class="bar" style="height:${h}%;"><div class="lbl">${l.km}</div></div>`;
  }).join('');

const blocksHtml = blocks.length ? blocks.map(b => `
<div class="list-item">
<div>
<div class="t">${esc(b.label)} <span class="muted">(km ${b.start_km}–${b.end_km})</span></div>
<div class="d">alvo ${b.pace_target_sec ? secToPace(b.pace_target_sec) + '/km' : '—'}${b.hr_ceiling ? ' · FC até ' + b.hr_ceiling : ''} &nbsp;→&nbsp; real ${b.pace_actual_sec ? secToPace(b.pace_actual_sec) + '/km' : '—'}${b.hr_actual_avg ? ' · FC ' + b.hr_actual_avg : ''}</div>
</div>
</div>`).join('') : `<p class="muted" style="margin:0 0 12px;">Nenhum bloco definido para este treino.</p>`;

const body = `
<a href="/activities" class="muted mono" style="font-size:12px;">← Treinos</a>
<h1>${esc(activity.title)}</h1>
<p class="lede">${fmtDate(activity.started_at || activity.created_at)} · <span class="pill">${esc(activity.workout_type || 'treino')}</span></p>

<div class="grid cols-4">
<div class="card stat"><div class="icon-badge">${icon('mountain', 'd1')}</div><div class="k">Distância</div><div class="v">${activity.distance_km ?? '—'}<span class="u">km</span></div></div>
<div class="card stat"><div class="icon-badge">${icon('stopwatch', 'd2')}</div><div class="k">Tempo</div><div class="v">${fmtClock(activity.duration_sec)}</div></div>
<div class="card stat"><div class="icon-badge">${icon('flame', 'd3')}</div><div class="k">Pace médio</div><div class="v">${secToPace(activity.avg_pace_sec)}<span class="u">/km</span></div></div>
<div class="card stat"><div class="icon-badge">${icon('heart', 'd4')}</div><div class="k">FC média</div><div class="v">${activity.avg_hr ?? '—'}${activity.avg_hr ? '<span class="u">bpm</span>' : ''}</div></div>
</div>

${laps.length ? `<div class="card">
<h2><span class="h-icon">${icon('mountain', 'sp')}</span>Splits por km</h2>
<div class="bars">${bars}</div>
</div>` : ''}

<div class="card">
<h2><span class="h-icon">${icon('trophy', 'bl')}</span>Blocos (previsto × realizado)</h2>
${blocksHtml}
<form method="POST" action="/activities/${activity.id}/blocks" style="margin-top:8px;">
<div class="grid cols-2">
<div><label>Nome do bloco</label><input name="label" required placeholder="Aquecimento"></div>
<div></div>
<div><label>Km inicial</label><input name="start_km" type="number" step="0.1" required></div>
<div><label>Km final</label><input name="end_km" type="number" step="0.1" required></div>
<div><label>Pace alvo (m:ss)</label><input name="pace_target" placeholder="5:20"></div>
<div><label>Teto de FC</label><input name="hr_ceiling" type="number"></div>
</div>
<div style="margin-top:12px;"><button class="ghost" type="submit">+ Adicionar bloco</button></div>
</form>
</div>

<div class="card">
<h2><span class="h-icon">${icon('heart', 'ai')}</span>Análise com IA</h2>
${activity.ai_analysis ? `<div class="ai-analysis">${renderMarkdownLite(activity.ai_analysis)}</div>
${aiEnabled ? `<form method="POST" action="/activities/${activity.id}/analyze" style="margin-top:14px;"><button class="ghost" type="submit">↻ Gerar nova análise</button></form>` : ''}` : `
${aiEnabled
  ? `<form method="POST" action="/activities/${activity.id}/analyze"><button type="submit">Gerar análise técnica</button></form>`
  : `<p class="muted" style="margin:0;">Cadastre sua chave da API da Anthropic em <a href="/settings">Config</a> para gerar análises técnicas automáticas.</p>`}
  `}
  </div>

  <div class="card">
  <h2>Compartilhar no feed</h2>
  <form method="POST" action="/feed">
  <input type="hidden" name="activity_id" value="${activity.id}">
  <textarea name="body" placeholder="Como foi o treino?">${activity.ai_analysis ? '' : ''}</textarea>
  <div style="margin-top:12px;"><button class="ghost" type="submit">Postar</button></div>
  </form>
  </div>

  <form method="POST" action="/activities/${activity.id}/delete" onsubmit="return confirm('Remover este treino?')">
  <button class="danger" type="submit">Remover treino</button>
  </form>
  `;
  return layout({ title: activity.title, user, body, active: 'activities' });
}

function feedPage(user, posts) {
  const body = `
  <h1>Feed</h1>
  <p class="lede">Seu histórico de treinos e conquistas.</p>
  <div class="card">
  <form method="POST" action="/feed">
  <textarea name="body" placeholder="Compartilhe algo..." required></textarea>
  <div style="margin-top:12px;"><button type="submit">Postar</button></div>
  </form>
  </div>
  <div class="card">
  ${posts.length ? posts.map(p => `
  <div class="post">
  <div class="who">${esc(user.name)}</div>
  <div class="when">${fmtDate(p.created_at)}</div>
  <div class="body">${esc(p.body)}</div>
  ${p.activity_title ? `<div style="margin-top:8px;"><a class="pill" href="/activities/${p.activity_id}"><span class="dot"></span>${esc(p.activity_title)}</a></div>` : ''}
  </div>`).join('') : `<p class="muted" style="margin:0;">Nenhum post ainda.</p>`}
  </div>
  `;
  return layout({ title: 'Feed', user, body, active: 'feed' });
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
  } catch (e) {}
  })();
  </script>`;
  return layout({ title: 'Coach de Corrida', user, body, active: 'assistant', hideCoachWidget: true, bodyEnd: chatInit });
}

module.exports = {
  layout, loginPage, signupPage, dashboardPage, racesPage,
  activitiesPage, activityNewPage, activityDetailPage, feedPage, settingsPage, coachChatPage,
};
