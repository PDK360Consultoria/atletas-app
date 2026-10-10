// JavaScript que roda no NAVEGADOR (injetado nas paginas do chat e do
// Professor) e desenha os cards no padrao do skill treino-stories-post:
//  - Stories 1080x1920, fundo escuro, dourado/azul
//  - resumo pequeno com fundo transparente
// Nao usa crase nem barra invertida: e inserido dentro de outros template
// literals, entao so concatenacao de strings.
const STORYCARD_JS = `
var RunStory = (function(){
  var W = 1080, H = 1920;
  var C = { bg: '#0B0D10', bg2: '#15181D', line: 'rgba(255,255,255,0.11)', ink: '#F6F7F5', dim: '#9BA1A8', faint: '#6A7078', gold: '#FFC24E', blue: '#4E9BFF' };
  var F_BLACK = '"Archivo Black", Impact, "Arial Black", sans-serif';
  var F_MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
  var F_TEXT = 'Archivo, Arial, Helvetica, sans-serif';

  function ensureFonts(){
    try {
      if (!document.getElementById('runstory-fonts')) {
        var l = document.createElement('link');
        l.id = 'runstory-fonts'; l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800;900&family=Archivo+Black&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap';
        document.head.appendChild(l);
      }
      var loads = [
        document.fonts.load('400 100px "Archivo Black"'),
        document.fonts.load('600 20px "IBM Plex Mono"'),
        document.fonts.load('500 20px Archivo'),
        document.fonts.load('800 20px Archivo')
      ];
      return Promise.race([Promise.all(loads), new Promise(function(r){ setTimeout(r, 3000); })]);
    } catch (e) { return Promise.resolve(); }
  }

  // Aceita tambem o formato antigo (title + blocks).
  function normalize(card){
    card = card || {};
    if (card.headline || card.hero) return card;
    var b = card.blocks || [];
    function pair(x){ return x ? { k: x.label || '', v: x.value || '', u: '' } : null; }
    return {
      kind: 'planejado', eyebrow: card.eyebrow || 'TREINO', headline: card.title || 'Treino', unit: '',
      hero: [pair(b[0]), pair(b[1])].filter(Boolean), sub: card.closer || '',
      stats: [pair(b[2]), pair(b[3])].filter(Boolean), chart: null, closer: '', closerBold: '',
      credit: 'Runiqx · runiqx.com', overlayTitle: card.title || 'TREINO',
      overlay: b.slice(0, 3).map(pair)
    };
  }

  function rr(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function wrap(ctx, text, maxW, maxLines){
    var words = String(text || '').split(' '), lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var t = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = words[i]; } else line = t;
    }
    if (line) lines.push(line);
    return lines.slice(0, maxLines);
  }
  function spaced(ctx, text, x, y, spacing){
    var cx = x;
    for (var i = 0; i < text.length; i++) { ctx.fillText(text[i], cx, y); cx += ctx.measureText(text[i]).width + spacing; }
    return cx - x;
  }
  function spacedWidth(ctx, text, spacing){
    var w = 0;
    for (var i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width + spacing;
    return w;
  }

  // ---------- card completo 1080x1920 ----------
  function drawFull(canvas, card){
    card = normalize(card);
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    var g1 = ctx.createRadialGradient(W * 0.9, -H * 0.006, 0, W * 0.9, -H * 0.006, 760);
    g1.addColorStop(0, 'rgba(255,194,78,0.15)'); g1.addColorStop(1, 'rgba(255,194,78,0)');
    ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);
    var g2 = ctx.createRadialGradient(-W * 0.08, H * 1.08, 0, -W * 0.08, H * 1.08, 820);
    g2.addColorStop(0, 'rgba(78,155,255,0.13)'); g2.addColorStop(1, 'rgba(78,155,255,0)');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);

    var padX = 64, innerW = W - padX * 2;
    var hero = (card.hero || []).slice(0, 2), stats = (card.stats || []).slice(0, 2);
    var chart = card.chart && card.chart.bars && card.chart.bars.length >= 2 ? card.chart : null;

    // alturas dos blocos fixos
    var yTop = 96;
    var eyebrowH = 28, headH = 200, heroH = hero.length ? 150 : 0, subH = card.sub ? 84 : 0, statsH = stats.length ? 112 : 0;
    var closerH = card.closer ? 44 : 0, creditH = 30;
    var fixed = eyebrowH + 22 + headH + (heroH ? 44 + heroH : 0) + (subH ? 40 + subH : 0) + (statsH ? 32 + statsH : 0) + (closerH ? 52 + closerH : 0) + 14 + creditH;
    var avail = H - yTop - 100;
    var free = avail - fixed;
    var chartH = 0, extra = 0;
    if (chart) { chartH = Math.max(0, free - 56); if (chartH > 760) { extra = chartH - 760; chartH = 760; } }
    else { extra = free; }
    var gap = extra > 0 ? Math.min(90, extra / 5) : 0;

    var y = yTop;
    // eyebrow
    ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(padX + 6, y + 10, 6, 0, Math.PI * 2); ctx.fill();
    ctx.font = '600 28px ' + F_MONO; ctx.fillStyle = C.gold;
    var eb = String(card.eyebrow || 'TREINO').toUpperCase();
    while (spacedWidth(ctx, eb, 4.2) > innerW - 30 && eb.length > 4) eb = eb.slice(0, -2);
    spaced(ctx, eb, padX + 26, y + 20, 4.2);
    y += eyebrowH + 22 + gap;

    // headline (encolhe pra caber)
    var hl = String(card.headline || ''), unit = String(card.unit || '');
    var size = 220;
    function hw(sz){ ctx.font = '400 ' + sz + 'px ' + F_BLACK; var w = ctx.measureText(hl).width; if (unit) { ctx.font = '700 ' + Math.round(sz * 0.36) + 'px ' + F_TEXT; w += 10 + ctx.measureText(unit).width; } return w; }
    while (size > 60 && hw(size) > innerW) size -= 6;
    ctx.font = '400 ' + size + 'px ' + F_BLACK; ctx.fillStyle = C.ink;
    var base = y + headH - 14 - (220 - size) * 0.2;
    ctx.fillText(hl, padX, base);
    if (unit) {
      var hwid = ctx.measureText(hl).width;
      ctx.font = '700 ' + Math.round(size * 0.36) + 'px ' + F_TEXT; ctx.fillStyle = C.dim;
      ctx.fillText(unit, padX + hwid + 10, base);
    }
    y += headH + gap;

    // hero tiles
    if (hero.length) {
      y += 44;
      var tw = (innerW - 20 * (hero.length - 1)) / hero.length;
      hero.forEach(function(t, i){
        var x = padX + i * (tw + 20);
        ctx.fillStyle = C.bg2; rr(ctx, x, y, tw, heroH, 26); ctx.fill();
        ctx.strokeStyle = C.line; ctx.lineWidth = 2; rr(ctx, x, y, tw, heroH, 26); ctx.stroke();
        ctx.font = '500 19px ' + F_MONO; ctx.fillStyle = C.faint;
        spaced(ctx, String(t.k || '').toUpperCase(), x + 28, y + 52, 1.1);
        var vs = 58; ctx.font = '400 ' + vs + 'px ' + F_BLACK;
        while (vs > 28 && ctx.measureText(String(t.v)).width + (t.u ? 30 : 0) > tw - 56) { vs -= 3; ctx.font = '400 ' + vs + 'px ' + F_BLACK; }
        ctx.fillStyle = C.ink; ctx.fillText(String(t.v || ''), x + 28, y + 118);
        if (t.u) { var vw = ctx.measureText(String(t.v)).width; ctx.font = '600 22px ' + F_TEXT; ctx.fillStyle = C.dim; ctx.fillText(String(t.u), x + 28 + vw + 4, y + 118); }
      });
      y += heroH + gap;
    }
    // sub
    if (card.sub) {
      y += 40;
      ctx.font = '500 30px ' + F_TEXT; ctx.fillStyle = C.dim;
      wrap(ctx, card.sub, innerW, 2).forEach(function(l, i){ ctx.fillText(l, padX, y + 30 + i * 40); });
      y += subH;
    }
    // stats
    if (stats.length) {
      y += 32;
      var sw = (innerW - 20 * (stats.length - 1)) / stats.length;
      stats.forEach(function(t, i){
        var x = padX + i * (sw + 20);
        ctx.fillStyle = C.bg2; rr(ctx, x, y, sw, statsH, 24); ctx.fill();
        ctx.strokeStyle = C.line; ctx.lineWidth = 2; rr(ctx, x, y, sw, statsH, 24); ctx.stroke();
        ctx.font = '500 18px ' + F_MONO; ctx.fillStyle = C.faint;
        spaced(ctx, String(t.k || '').toUpperCase(), x + 22, y + 44, 1.1);
        var vs2 = 38; ctx.font = '400 ' + vs2 + 'px ' + F_BLACK;
        while (vs2 > 22 && ctx.measureText(String(t.v)).width + (t.u ? 26 : 0) > sw - 44) { vs2 -= 2; ctx.font = '400 ' + vs2 + 'px ' + F_BLACK; }
        ctx.fillStyle = C.ink; ctx.fillText(String(t.v || ''), x + 22, y + 90);
        if (t.u) { var w2 = ctx.measureText(String(t.v)).width; ctx.font = '600 19px ' + F_TEXT; ctx.fillStyle = C.dim; ctx.fillText(String(t.u), x + 22 + w2 + 4, y + 90); }
      });
      y += statsH;
    }
    // grafico de barras
    if (chart && chartH > 220) {
      y += 56;
      ctx.fillStyle = C.bg2; rr(ctx, padX, y, innerW, chartH, 28); ctx.fill();
      ctx.strokeStyle = C.line; ctx.lineWidth = 2; rr(ctx, padX, y, innerW, chartH, 28); ctx.stroke();
      ctx.font = '500 20px ' + F_MONO; ctx.fillStyle = C.faint;
      spaced(ctx, String(chart.title || 'Pace').toUpperCase(), padX + 40, y + 60, 1.2);
      var bars = chart.bars, n = bars.length;
      var vals = bars.map(function(b){ return Number(b.value) || 0; });
      var mx = Math.max.apply(null, vals), mn = Math.min.apply(null, vals);
      var areaX = padX + 40, areaW = innerW - 80, areaTop = y + 120, areaBottom = y + chartH - 70;
      var gapB = n > 16 ? 8 : 16, bw = (areaW - gapB * (n - 1)) / n;
      var maxBarH = areaBottom - areaTop - 34;
      bars.forEach(function(b, i){
        var frac;
        if (chart.mode === 'pace') frac = mx === mn ? 0.6 : 0.25 + 0.75 * (mx - vals[i]) / (mx - mn);
        else frac = Math.max(0.1, Math.min(1, vals[i] / 100));
        var bh = Math.max(14, maxBarH * frac), bx = areaX + i * (bw + gapB), by = areaBottom - bh;
        var last = i === n - 1;
        var gr = ctx.createLinearGradient(0, by, 0, areaBottom);
        if (last) { gr.addColorStop(0, C.gold); gr.addColorStop(1, '#FF9E4E'); } else { gr.addColorStop(0, C.blue); gr.addColorStop(1, C.gold); }
        ctx.fillStyle = gr; rr(ctx, bx, by, bw, bh, Math.min(10, bw / 2)); ctx.fill();
        var fs = n > 16 ? 14 : 19;
        ctx.font = '600 ' + fs + 'px ' + F_MONO; ctx.textAlign = 'center';
        ctx.fillStyle = last ? C.gold : C.ink;
        if (bw > 26 || fs === 14) ctx.fillText(String(b.text || ''), bx + bw / 2, by - 10);
        ctx.font = '500 ' + (n > 16 ? 14 : 18) + 'px ' + F_MONO; ctx.fillStyle = C.faint;
        ctx.fillText(String(b.label || ''), bx + bw / 2, areaBottom + 34);
        ctx.textAlign = 'left';
      });
      y += chartH;
    }
    // closer + credit (ancorados embaixo)
    var by2 = H - 100;
    ctx.font = '500 19px ' + F_MONO; ctx.fillStyle = C.faint;
    ctx.fillText(String(card.credit || 'Runiqx · runiqx.com'), padX, by2);
    if (card.closer) {
      var cy = by2 - 14 - 30 - 12;
      var full = String(card.closer), bold = String(card.closerBold || '');
      ctx.font = '500 28px ' + F_TEXT;
      if (bold && full.indexOf(bold) === 0) {
        ctx.font = '800 28px ' + F_TEXT; ctx.fillStyle = C.ink; ctx.fillText(bold, padX, cy);
        var bwid = ctx.measureText(bold).width;
        ctx.font = '500 28px ' + F_TEXT; ctx.fillStyle = C.dim; ctx.fillText(full.slice(bold.length), padX + bwid, cy);
      } else { ctx.fillStyle = C.dim; ctx.fillText(full, padX, cy); }
    }
  }

  // ---------- resumo transparente ----------
  function drawOverlay(canvas, card){
    card = normalize(card);
    var items = (card.overlay || []).slice(0, 3);
    var padX = 24, gap = 18, titleH = 62, statH = 128;
    var Hh = padX + titleH + 14 + statH + padX;
    canvas.width = W; canvas.height = Hh;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, Hh);
    var fill = 'rgba(21,24,29,0.72)', line = 'rgba(255,255,255,0.14)';
    var title = String(card.overlayTitle || card.eyebrow || 'TREINO').toUpperCase();
    ctx.font = '700 22px ' + F_MONO;
    var tw = spacedWidth(ctx, title, 0.9) + 52;
    ctx.fillStyle = fill; rr(ctx, padX, padX, tw, titleH - 8, 16); ctx.fill();
    ctx.strokeStyle = line; ctx.lineWidth = 2; rr(ctx, padX, padX, tw, titleH - 8, 16); ctx.stroke();
    ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(padX + 24, padX + (titleH - 8) / 2, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.ink; ctx.font = '700 22px ' + F_MONO;
    spaced(ctx, title, padX + 40, padX + (titleH - 8) / 2 + 8, 0.9);
    var sy = padX + titleH + 14, n = items.length || 1;
    var sw = (W - padX * 2 - gap * (n - 1)) / n;
    items.forEach(function(t, i){
      var x = padX + i * (sw + gap);
      ctx.fillStyle = fill; rr(ctx, x, sy, sw, statH, 22); ctx.fill();
      ctx.strokeStyle = line; ctx.lineWidth = 2; rr(ctx, x, sy, sw, statH, 22); ctx.stroke();
      ctx.font = '500 18px ' + F_MONO; ctx.fillStyle = C.faint;
      spaced(ctx, String(t.k || '').toUpperCase(), x + 22, sy + 42, 1.2);
      var vs = 40; ctx.font = '900 ' + vs + 'px ' + F_TEXT;
      while (vs > 22 && ctx.measureText(String(t.v)).width + 40 > sw - 44) { vs -= 2; ctx.font = '900 ' + vs + 'px ' + F_TEXT; }
      ctx.fillStyle = C.ink; ctx.fillText(String(t.v || ''), x + 22, sy + 94);
      if (t.u) { var w2 = ctx.measureText(String(t.v)).width; ctx.font = '600 19px ' + F_TEXT; ctx.fillStyle = C.dim; ctx.fillText(String(t.u), x + 22 + w2 + 3, sy + 94); }
    });
  }

  function download(canvas, name){
    var a = document.createElement('a');
    a.download = name; a.href = canvas.toDataURL('image/png');
    document.body.appendChild(a); a.click(); a.remove();
  }

  // Monta preview + botoes dentro de "container".
  function render(container, card){
    var wrap = document.createElement('div');
    wrap.className = 'chat-story-card runstory';
    var full = document.createElement('canvas');
    full.className = 'runstory-full';
    var over = document.createElement('canvas');
    over.className = 'runstory-over';
    var row = document.createElement('div');
    row.className = 'runstory-actions';
    var b1 = document.createElement('button');
    b1.type = 'button'; b1.className = 'ghost btn xs chat-story-download'; b1.textContent = 'Baixar Stories (1080×1920)';
    var b2 = document.createElement('button');
    b2.type = 'button'; b2.className = 'ghost btn xs chat-story-download'; b2.textContent = 'Baixar resumo transparente';
    b1.addEventListener('click', function(){ download(full, 'treino-stories.png'); });
    b2.addEventListener('click', function(){ download(over, 'treino-resumo.png'); });
    row.appendChild(b1); row.appendChild(b2);
    wrap.appendChild(full);
    wrap.appendChild(row);
    container.appendChild(wrap);
    ensureFonts().then(function(){
      try { drawFull(full, card); drawOverlay(over, card); } catch (e) { console.error('[runstory]', e); }
    });
    return wrap;
  }
  return { render: render, drawFull: drawFull, drawOverlay: drawOverlay, normalize: normalize };
})();
`;
module.exports = { STORYCARD_JS };
