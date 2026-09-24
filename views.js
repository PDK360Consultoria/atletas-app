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
  } catch (e) { console.error('[dbg]', e); }
})();
</script>`;
  return layout({ title: 'Coach de Corrida', user, body, active: 'assistant', hideCoachWidget: true, bodyEnd: chatInit });
}

module.exports = {
  layout, loginPage, signupPage, dashboardPage, racesPage,
  activitiesPage, activityNewPage, activityDetailPage, feedPage, settingsPage, coachChatPage,
};
