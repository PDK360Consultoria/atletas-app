// JavaScript do NAVEGADOR para o composer do chat do coach: anexar imagens
// (galeria/camera/colar/arrastar) e gravar audio (vira texto via /api/coach/transcribe).
// Injetado dentro de outro template literal: sem crase, sem ${ e sem barra invertida.
const CHATMEDIA_JS = `
var ChatMedia = (function(){
  var MAX_IMAGES = 4, MAX_SIDE = 1600;
  var SVG_CLIP = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true"><path d="M20.5 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SVG_MIC = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var SVG_STOP = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor"/></svg>';

  function mk(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // Reduz a imagem (lado maior 1600px, JPEG) para o envio ficar leve e a IA ler bem.
  function resizeImage(file){
    return new Promise(function(resolve, reject){
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function(){
        var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, MAX_SIDE / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
        var c = document.createElement('canvas'); c.width = cw; c.height = ch;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        var dataUrl = c.toDataURL('image/jpeg', 0.85);
        resolve({ dataUrl: dataUrl, data: dataUrl.split(',')[1] });
      };
      img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error('img')); };
      img.src = url;
    });
  }

  function renderThumbs(bubbleEl, urls){
    if (!urls || !urls.length) return;
    var grid = mk('div', 'chat-imgs');
    urls.forEach(function(u){
      var a = mk('a', 'chat-img'); a.href = u; a.target = '_blank'; a.rel = 'noopener';
      var im = document.createElement('img'); im.src = u; im.alt = 'Imagem enviada'; im.loading = 'lazy';
      a.appendChild(im); grid.appendChild(a);
    });
    bubbleEl.insertBefore(grid, bubbleEl.firstChild);
  }

  function fmt(sec){ var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }

  function attach(formEl, inputEl, msgsEl, opts){
    opts = opts || {};
    var pending = [];
    var strip = mk('div', 'chat-attach-strip');
    strip.hidden = true;
    formEl.parentNode.insertBefore(strip, formEl);

    var file = document.createElement('input');
    file.type = 'file'; file.accept = 'image/*'; file.multiple = true; file.hidden = true;
    var clip = mk('button', 'chat-tool'); clip.type = 'button'; clip.setAttribute('aria-label', 'Anexar imagem'); clip.title = 'Anexar imagem'; clip.innerHTML = SVG_CLIP;
    var mic = mk('button', 'chat-tool'); mic.type = 'button'; mic.setAttribute('aria-label', 'Gravar áudio'); mic.title = 'Gravar áudio'; mic.innerHTML = SVG_MIC;
    formEl.insertBefore(clip, inputEl);
    formEl.insertBefore(file, inputEl);
    var submitBtn = formEl.querySelector('button[type=submit]');
    formEl.insertBefore(mic, submitBtn || null);

    var status = mk('div', 'chat-attach-status'); status.hidden = true;
    strip.parentNode.insertBefore(status, strip);

    function setStatus(text, kind){
      if (!text) { status.hidden = true; status.textContent = ''; return; }
      status.hidden = false; status.textContent = text; status.className = 'chat-attach-status' + (kind ? ' ' + kind : '');
    }
    function renderStrip(){
      strip.innerHTML = '';
      strip.hidden = pending.length === 0;
      pending.forEach(function(p, i){
        var box = mk('div', 'chat-attach-thumb');
        var im = document.createElement('img'); im.src = p.dataUrl; im.alt = 'Prévia';
        var x = mk('button', 'chat-attach-x'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Remover imagem');
        x.addEventListener('click', function(){ pending.splice(i, 1); renderStrip(); });
        box.appendChild(im); box.appendChild(x); strip.appendChild(box);
      });
    }
    function addFiles(list){
      var files = Array.prototype.slice.call(list || []).filter(function(f){ return /^image/.test(f.type); });
      if (!files.length) return;
      var room = MAX_IMAGES - pending.length;
      if (room <= 0) { setStatus('Máximo de ' + MAX_IMAGES + ' imagens por mensagem.', 'warn'); setTimeout(function(){ setStatus(''); }, 3000); return; }
      files.slice(0, room).reduce(function(chain, f){
        return chain.then(function(){ return resizeImage(f).then(function(r){ pending.push(r); renderStrip(); }).catch(function(){ setStatus('Não consegui ler essa imagem.', 'warn'); setTimeout(function(){ setStatus(''); }, 3000); }); });
      }, Promise.resolve());
    }
    clip.addEventListener('click', function(){ file.click(); });
    file.addEventListener('change', function(){ addFiles(file.files); file.value = ''; });
    inputEl.addEventListener('paste', function(e){
      var items = (e.clipboardData && e.clipboardData.files) || [];
      if (items.length) { var imgs = Array.prototype.filter.call(items, function(f){ return /^image/.test(f.type); }); if (imgs.length) { e.preventDefault(); addFiles(imgs); } }
    });
    ['dragover', 'drop'].forEach(function(ev){
      formEl.parentNode.addEventListener(ev, function(e){
        if (!e.dataTransfer || !e.dataTransfer.types || Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') < 0) return;
        e.preventDefault();
        if (ev === 'drop') addFiles(e.dataTransfer.files);
      });
    });

    // ---- audio ----
    var rec = null, recChunks = [], recTimer = null, recSec = 0, recStream = null, recCancelled = false;
    function pickMime(){
      var cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
      for (var i = 0; i < cands.length; i++) { try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(cands[i])) return cands[i]; } catch (e) {} }
      return '';
    }
    function stopTracks(){ if (recStream) { recStream.getTracks().forEach(function(t){ t.stop(); }); recStream = null; } }
    function resetMic(){ mic.classList.remove('is-rec'); mic.innerHTML = SVG_MIC; mic.setAttribute('aria-label', 'Gravar áudio'); clearInterval(recTimer); recTimer = null; }
    function upload(blob, mime){
      setStatus('Transcrevendo o áudio…');
      mic.disabled = true;
      return fetch('/api/coach/transcribe', { method: 'POST', headers: { 'content-type': mime || 'audio/webm' }, body: blob })
        .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(d){ return { ok: r.ok, status: r.status, d: d }; }); })
        .then(function(res){
          mic.disabled = false;
          if (res.ok && res.d && res.d.text) {
            var cur = inputEl.value;
            inputEl.value = (cur && cur.slice(-1) !== ' ' ? cur + ' ' : cur) + res.d.text;
            inputEl.dispatchEvent(new Event('input'));
            inputEl.focus();
            setStatus('');
          } else if (res.status === 412) {
            setStatus('Para usar áudio, cadastre sua chave da OpenAI em Config.', 'warn');
          } else if (res.d && res.d.error === 'empty') {
            setStatus('Não ouvi nada nesse áudio. Tenta de novo?', 'warn');
          } else {
            setStatus('Não consegui transcrever agora. Tenta de novo?', 'warn');
          }
        })
        .catch(function(){ mic.disabled = false; setStatus('Não consegui enviar o áudio. Verifique a conexão.', 'warn'); });
    }
    function startRec(){
      if (!navigator.mediaDevices || !window.MediaRecorder) { setStatus('Este navegador não grava áudio.', 'warn'); return; }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream){
        recStream = stream; recChunks = []; recCancelled = false;
        var mime = pickMime();
        try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); } catch (e) { stopTracks(); setStatus('Não consegui iniciar a gravação.', 'warn'); return; }
        rec.ondataavailable = function(e){ if (e.data && e.data.size) recChunks.push(e.data); };
        rec.onstop = function(){
          var type = rec.mimeType || mime || 'audio/webm';
          stopTracks(); resetMic();
          if (recCancelled) { setStatus(''); return; }
          var blob = new Blob(recChunks, { type: type });
          if (blob.size < 800) { setStatus('Áudio muito curto.', 'warn'); setTimeout(function(){ setStatus(''); }, 2500); return; }
          upload(blob, type.split(';')[0]);
        };
        rec.start();
        recSec = 0;
        mic.classList.add('is-rec'); mic.innerHTML = SVG_STOP; mic.setAttribute('aria-label', 'Parar gravação');
        setStatus('Gravando 0:00. Toque no quadrado para parar.', 'rec');
        recTimer = setInterval(function(){
          recSec++; setStatus('Gravando ' + fmt(recSec) + '. Toque no quadrado para parar.', 'rec');
          if (recSec >= 180) { try { rec.stop(); } catch (e) {} }
        }, 1000);
      }).catch(function(){ setStatus('Permita o uso do microfone para gravar áudio.', 'warn'); });
    }
    mic.addEventListener('click', function(){
      if (rec && rec.state === 'recording') { try { rec.stop(); } catch (e) {} return; }
      startRec();
    });

    return {
      take: function(){ var out = pending.slice(); pending = []; renderStrip(); return out; },
      count: function(){ return pending.length; }
    };
  }
  return { attach: attach, renderThumbs: renderThumbs };
})();
`;
module.exports = { CHATMEDIA_JS };
