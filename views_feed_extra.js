// Peças novas do Feed: composer com abas (Foto | Texto | Treino), carrossel
// de mídia (mapa + fotos), post de texto estilo X, stories, resumo da semana.
const { esc, secToPace, fmtClock } = require('./lib/format');

function linkify(text, mentionMap) {
  let s = esc(text || '');
  s = s.replace(/(^|[\s(])#([\p{L}\p{N}_]{2,40})/gu, (m, pre, tag) => `${pre}<a class="hashtag" href="/feed?tag=${encodeURIComponent(tag.toLowerCase())}">#${tag}</a>`);
  s = s.replace(/(^|[\s(])@([a-zA-Z0-9_-]{2,40})/g, (m, pre, slug) => (mentionMap && mentionMap[slug.toLowerCase()] ? `${pre}<a class="mention" href="/u/${slug}">@${slug}</a>` : m));
  return s.replace(/\n/g, '<br>');
}

function photoSlide(path) {
  const src = `/uploads/${esc(path)}`;
  return `<button type="button" class="photo-slide" data-full="${src}" aria-label="Ampliar foto"><img src="${src}" alt="" loading="lazy"></button>`;
}

// slides: array de HTML; ar: proporção CSS (ex. "16/10")
function carousel(slides, ar) {
  if (!slides.length) return '';
  const style = `--car-ar:${ar || '16/10'}`;
  if (slides.length === 1) return `<div class="media-car single" style="${style}"><div class="car-track"><div class="car-slide">${slides[0]}</div></div></div>`;
  return `<div class="media-car" style="${style}">
    <div class="car-track">${slides.map((s) => `<div class="car-slide">${s}</div>`).join('')}</div>
    <button type="button" class="car-btn prev" aria-label="Anterior">&#8249;</button>
    <button type="button" class="car-btn next" aria-label="Próxima">&#8250;</button>
    <span class="car-count">1/${slides.length}</span>
    <div class="car-dots">${slides.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>
  </div>`;
}

function weekCard(week, user, avatarHtml) {
  if (!week) return '';
  const max = Math.max(...week.ranking.map((r) => r.km), 1);
  const mins = Math.round((week.sec || 0) / 60);
  const time = mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : `${mins}min`;
  return `<div class="card week-card">
  <div class="week-top">
    <div>
      <div class="week-k">Sua semana</div>
      <div class="week-km">${week.km.toString().replace('.', ',')}<span class="u"> km</span></div>
    </div>
    <div class="week-mini">
      <div><b>${week.runs}</b><span>${week.runs === 1 ? 'treino' : 'treinos'}</span></div>
      <div><b>${week.sec ? time : '—'}</b><span>em movimento</span></div>
      <div><b>${week.streakWeeks}</b><span>${week.streakWeeks === 1 ? 'semana seguida' : 'semanas seguidas'}</span></div>
    </div>
  </div>
  ${week.ranking.length > 1 ? `<div class="week-rank">
    <div class="week-k" style="margin-bottom:8px;">Ranking de quem você segue</div>
    ${week.ranking.map((r, i) => `<div class="rank-row${r.me ? ' me' : ''}">
      <span class="rank-pos">${i + 1}</span>
      ${avatarHtml(r.name, r.id, r.avatar_path, 'rank-avatar')}
      <span class="rank-name">${esc(r.me ? 'Você' : r.name)}</span>
      <span class="rank-bar"><i style="width:${Math.max(4, Math.round(r.km / max * 100))}%"></i></span>
      <span class="rank-km">${r.km.toString().replace('.', ',')} km</span>
    </div>`).join('')}
  </div>` : `<p class="muted" style="margin:12px 0 0;font-size:13px;">Siga outros atletas pelo perfil público deles para ver o ranking da semana.</p>`}
</div>`;
}

function storiesBar(stories, user, avatarHtml) {
  if (!stories || !stories.length) return '';
  const data = stories.map((s) => ({
    name: s.name, me: s.me, title: s.title, km: s.km, time: s.sec ? fmtClock(s.sec) : null, pace: s.pace ? secToPace(s.pace) : null,
    type: s.type || 'Corrida', photo: s.photo ? `/uploads/${s.photo}` : null,
  }));
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<div class="stories" id="storiesBar">
  ${stories.map((s, i) => `<button type="button" class="story-item" data-i="${i}" aria-label="Ver treino de ${esc(s.name)}">
    <span class="story-ring">${avatarHtml(s.name, s.userId, s.avatar, 'story-avatar')}</span>
    <span class="story-name">${esc(s.me ? 'Você' : s.name.split(' ')[0])}</span>
  </button>`).join('')}
  <script type="application/json" id="storiesData">${json}</script>
</div>`;
}

function composer(user, opts, avatarHtml) {
  const isPr = !!opts.isPrShare;
  const list = opts.recentUnshared || [];
  const sel = opts.shareActivity || null;
  const fmtPace = (a) => (a.avg_pace_sec ? ` · ${secToPace(a.avg_pace_sec)}/km` : '');
  if (!list.length && !sel) {
    return `<div class="card feed-composer" id="composer"><div class="composer-title">Compartilhar treino</div>
    <p class="muted" style="margin:0;font-size:14px;">Todo post do feed leva um treino com mapa, zonas e pace. Você não tem treino novo para compartilhar: sincronize com o Strava na página de Treinos.</p></div>`;
  }
  const chips = list.map((a) => `<button type="button" class="pill composer-recent-chip${sel && a.id === sel.id ? ' on' : ''}" data-id="${a.id}"><span class="dot"></span>${esc(a.title)}${a.distance_km != null ? ` · ${a.distance_km}km` : ''}${fmtPace(a)}</button>`).join('');
  return `<div class="card feed-composer" id="composer">
  <div class="composer-title">Compartilhar treino</div>
  <form method="POST" action="/feed" enctype="multipart/form-data" id="composerForm">
    <div class="composer-row">
      ${avatarHtml(user.name, user.id, user.avatar_path, 'composer-avatar')}
      <div class="composer-main">
        <div class="composer-recent">
          <span class="muted mono" style="font-size:12px;">Escolha o treino (mapa, zonas e pace entram automaticamente):</span>
          <div class="composer-recent-chips" id="composerChips">${chips}</div>
        </div>
        <input type="hidden" name="activity_id" id="composerActivity" value="${sel ? sel.id : ''}">
        ${isPr && sel ? `<input type="hidden" name="is_pr" id="composerPr" value="1" data-for="${sel.id}">` : ''}
        <textarea name="body" id="composerBody" rows="3" maxlength="2200" placeholder="Escreva uma legenda... (use #hashtags e @menções)">${opts.shareDraft ? esc(opts.shareDraft) : ''}</textarea>
        <div class="composer-photos">
          <div id="composerPreviews" class="composer-previews"></div>
          <label class="ghost btn photo-btn" id="composerPhotoLabel">
            <input type="file" id="composerPhotoInput" accept="image/*" multiple style="display:none;">
            <span id="composerPhotoText">Adicionar fotos</span>
          </label>
          <span class="muted" style="font-size:12px;">opcional · até 6 fotos entram depois do mapa</span>
        </div>
        <input type="text" name="location" id="composerLocation" class="composer-location" maxlength="80" placeholder="Adicionar local (opcional)">
        <div class="composer-actions">
          <span id="composerError" class="composer-error" hidden></span>
          <button type="submit" id="composerSubmit">Postar</button>
        </div>
      </div>
    </div>
  </form>
</div>`;
}

// Script do Feed: composer, carrossel, ampliar foto, stories.
const FEED_SCRIPT = `<script>
(function(){
  var box = document.getElementById('composer');
  var form = document.getElementById('composerForm');
  var photos = [];
  var MAXP = 6;

  function renderPreviews(){
    var wrap = document.getElementById('composerPreviews'); if (!wrap) return;
    wrap.innerHTML = '';
    photos.forEach(function(f, i){
      var d = document.createElement('div'); d.className = 'prev';
      var im = document.createElement('img'); im.src = URL.createObjectURL(f); d.appendChild(im);
      var b = document.createElement('button'); b.type = 'button'; b.className = 'prev-x'; b.textContent = '\\u00d7'; b.setAttribute('aria-label', 'Remover foto');
      b.addEventListener('click', function(){ photos.splice(i, 1); renderPreviews(); });
      d.appendChild(b); wrap.appendChild(d);
    });
    var t = document.getElementById('composerPhotoText'); if (t) t.textContent = photos.length ? 'Adicionar mais' : 'Adicionar fotos';
  }
  function resizeImage(file, max){
    return new Promise(function(res){
      if (!/^image\\/(jpeg|png|webp)/.test(file.type)) { res(file); return; }
      var url = URL.createObjectURL(file); var img = new Image();
      img.onload = function(){
        var r = Math.min(1, max / Math.max(img.width, img.height));
        var w = Math.round(img.width * r), h = Math.round(img.height * r);
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        c.toBlob(function(b){ URL.revokeObjectURL(url); res(b ? new File([b], (file.name || 'foto').replace(/\\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.85);
      };
      img.onerror = function(){ res(file); };
      img.src = url;
    });
  }
  function showError(msg){ var e = document.getElementById('composerError'); if (!e) return; e.textContent = msg; e.hidden = !msg; }

  if (box && form) {
    var chips = box.querySelectorAll('#composerChips .composer-recent-chip');
    var actInp = document.getElementById('composerActivity');
    Array.prototype.forEach.call(chips, function(c){
      c.addEventListener('click', function(){
        Array.prototype.forEach.call(chips, function(x){ x.classList.toggle('on', x === c); });
        actInp.value = c.getAttribute('data-id');
        var pr = document.getElementById('composerPr'); if (pr) pr.disabled = pr.getAttribute('data-for') !== actInp.value;
      });
    });
    var inp = document.getElementById('composerPhotoInput');
    if (inp) inp.addEventListener('change', function(){
      Array.prototype.forEach.call(inp.files, function(f){ if (photos.length < MAXP) photos.push(f); });
      inp.value = ''; renderPreviews();
    });
    var ta = document.getElementById('composerBody');
    form.addEventListener('submit', function(ev){
      ev.preventDefault(); showError('');
      var text = (ta.value || '').trim();
      if (!actInp.value) { showError('Escolha o treino que vai compartilhar.'); return; }
      if (!text) { showError('Escreva uma legenda para o post.'); ta.focus(); return; }
      var btn = document.getElementById('composerSubmit'); btn.disabled = true; btn.textContent = 'Publicando...';
      var fd = new FormData();
      fd.append('body', text);
      fd.append('activity_id', actInp.value);
      var loc = document.getElementById('composerLocation'); if (loc && loc.value) fd.append('location', loc.value);
      var pr = document.getElementById('composerPr'); if (pr && !pr.disabled) fd.append('is_pr', pr.value);
      Promise.all(photos.map(function(f){ return resizeImage(f, 1600); })).then(function(list){
        list.forEach(function(f){ fd.append('photo', f, f.name || 'foto.jpg'); });
        return fetch('/feed', { method: 'POST', body: fd, headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' });
      }).then(function(r){ return r.json(); }).then(function(j){
        if (j && j.ok === false) { btn.disabled = false; btn.textContent = 'Postar'; showError(j.error || 'Não consegui publicar.'); return; }
        window.location.href = (j && j.redirect) || '/feed';
      }).catch(function(){ btn.disabled = false; btn.textContent = 'Postar'; showError('Não consegui publicar agora. Tente de novo.'); });
    });
  }

  // carrossel
  Array.prototype.forEach.call(document.querySelectorAll('.media-car:not(.single)'), function(car){
    var track = car.querySelector('.car-track'); var dots = car.querySelectorAll('.car-dots i'); var cnt = car.querySelector('.car-count');
    function upd(){ var i = Math.round(track.scrollLeft / track.clientWidth); Array.prototype.forEach.call(dots, function(d, k){ d.classList.toggle('on', k === i); }); if (cnt) cnt.textContent = (i + 1) + '/' + dots.length; car.setAttribute('data-i', i); }
    track.addEventListener('scroll', function(){ window.requestAnimationFrame(upd); });
    car.querySelector('.car-btn.prev').addEventListener('click', function(){ track.scrollBy({ left: -track.clientWidth, behavior: 'smooth' }); });
    car.querySelector('.car-btn.next').addEventListener('click', function(){ track.scrollBy({ left: track.clientWidth, behavior: 'smooth' }); });
  });

  // ampliar foto
  document.addEventListener('click', function(ev){
    var b = ev.target.closest && ev.target.closest('.photo-slide'); if (!b) return;
    var o = document.createElement('div'); o.className = 'lightbox';
    var im = document.createElement('img'); im.src = b.getAttribute('data-full'); o.appendChild(im);
    o.addEventListener('click', function(){ o.remove(); });
    document.addEventListener('keydown', function esc(e){ if (e.key === 'Escape') { o.remove(); document.removeEventListener('keydown', esc); } });
    document.body.appendChild(o);
  });

  // stories
  var bar = document.getElementById('storiesBar');
  if (bar) {
    var data = []; try { data = JSON.parse(document.getElementById('storiesData').textContent); } catch (e) {}
    var timer = null;
    function close(){ var o = document.querySelector('.story-view'); if (o) o.remove(); if (timer) clearTimeout(timer); }
    function open(i){
      close(); if (i < 0 || i >= data.length) return;
      var s = data[i];
      var o = document.createElement('div'); o.className = 'story-view';
      var bars = ''; for (var k = 0; k < data.length; k++) bars += '<i class="' + (k < i ? 'done' : (k === i ? 'run' : '')) + '"></i>';
      var stats = '';
      if (s.km != null) stats += '<div><b>' + s.km + '</b><span>km</span></div>';
      if (s.time) stats += '<div><b>' + s.time + '</b><span>tempo</span></div>';
      if (s.pace) stats += '<div><b>' + s.pace + '</b><span>/km</span></div>';
      o.innerHTML = '<div class="story-bg"' + (s.photo ? ' style="background-image:url(' + s.photo + ')"' : '') + '></div>' +
        '<div class="story-bars">' + bars + '</div>' +
        '<div class="story-head"><b></b><button type="button" class="story-close" aria-label="Fechar">\\u00d7</button></div>' +
        '<div class="story-body"><div class="story-type"></div><div class="story-title"></div><div class="story-stats">' + stats + '</div></div>' +
        '<button type="button" class="story-nav prev" aria-label="Anterior"></button><button type="button" class="story-nav next" aria-label="Próximo"></button>';
      o.querySelector('.story-head b').textContent = s.me ? 'Você' : s.name;
      o.querySelector('.story-type').textContent = s.type;
      o.querySelector('.story-title').textContent = s.title;
      o.querySelector('.story-close').addEventListener('click', close);
      o.querySelector('.story-nav.prev').addEventListener('click', function(){ open(i - 1); });
      o.querySelector('.story-nav.next').addEventListener('click', function(){ if (i + 1 < data.length) open(i + 1); else close(); });
      document.body.appendChild(o);
      timer = setTimeout(function(){ if (i + 1 < data.length) open(i + 1); else close(); }, 6000);
    }
    Array.prototype.forEach.call(bar.querySelectorAll('.story-item'), function(b){ b.addEventListener('click', function(){ open(parseInt(b.getAttribute('data-i'), 10)); }); });
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') close(); });
  }
})();
</script>`;

module.exports = { linkify, photoSlide, carousel, weekCard, storiesBar, composer, FEED_SCRIPT };
