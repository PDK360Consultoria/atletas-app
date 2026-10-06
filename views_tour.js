// Tutorial do primeiro acesso: passo a passo em cartões, com destaque no menu.
const STEPS = [
  { ic: 'flame', t: 'Bem-vindo ao Runiqx', d: 'Seu app de corrida: treinos do Strava, Professor com inteligência artificial, feed da galera e notícias. Vamos fazer um tour rápido de 1 minuto.' },
  { ic: 'shoe', sel: 'a[href="/activities"]', t: 'Treinos', d: 'Aqui ficam todas as suas corridas. Conecte o Strava e toque em "Sincronizar com Strava" para trazer tudo automaticamente. Cada treino tem mapa interativo, zonas de frequência cardíaca, pace por km e análise do Professor.' },
  { ic: 'mountain', sel: 'a[href="/"].link', t: 'Perfil', d: 'Seu painel: resumo da semana, evolução, medalhas, metas e a prova que você está preparando. Complete seu perfil em Config para as análises ficarem mais certeiras.' },
  { ic: 'trophy', sel: 'a[href="/feed"].link', t: 'Feed: Publicações', d: 'Compartilhe um treino com a galera. Escolha o treino, escreva uma legenda e, se quiser, adicione fotos e local. Mapa, zonas e pace entram automaticamente. Tem também Stories das últimas 24 horas e o ranking da semana de quem você segue.' },
  { ic: 'camera', sel: 'a[href="/feed"].link', t: 'Meu feed e Notícias', d: 'Dentro do Feed, "Meu feed" é seu perfil estilo Instagram, com bio editável e todas as suas publicações. Em "Notícias" você lê matérias de corrida sem sair do app.' },
  { ic: 'pin', sel: 'a[href="/discover"]', t: 'Buscar', d: 'Encontre outros atletas, veja o perfil público deles e toque em Seguir para acompanhar os treinos no feed.' },
  { ic: 'chat', sel: 'a[href="/assistant"]', t: 'Professor Chat', d: 'Converse por texto com o Professor. Ele conhece o seu histórico e responde sobre treino, ritmo, recuperação e prova.' },
  { ic: 'stopwatch', sel: 'a[href="/professor"]', t: 'Professor ao vivo', d: 'Fale por voz com o Professor, como numa ligação. Ótimo para o ritual do bom dia e para tirar dúvidas na hora.' },
  { ic: 'calendar', sel: '#navMoreBtn', t: 'Mais: provas, treino ao vivo e config', d: 'No menu "Mais" você encontra o calendário de provas, o Treino ao Vivo e as Configurações. Para rever este tutorial, é só abrir "Mais" e tocar em Tutorial.' },
];

function tourScript(icons, autoOpen) {
  const steps = STEPS.map((s) => ({ ...s, svg: icons[s.ic] || '' }));
  const json = JSON.stringify(steps).replace(/</g, '\\u003c');
  return `<script>
(function(){
  var STEPS = ${json};
  var AUTO = ${autoOpen ? 'true' : 'false'};
  var root = null, i = 0, hl = null;
  function clearHl(){ if (hl) { hl.classList.remove('tour-hl'); hl = null; } }
  function done(){
    clearHl(); if (root) { root.remove(); root = null; }
    document.body.classList.remove('tour-open');
    try { fetch('/tour/done', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } }); } catch (e) {}
  }
  function render(){
    var s = STEPS[i]; clearHl();
    var last = i === STEPS.length - 1;
    var dots = ''; for (var k = 0; k < STEPS.length; k++) dots += '<i class="' + (k === i ? 'on' : (k < i ? 'past' : '')) + '"></i>';
    root.querySelector('.tour-card').innerHTML =
      '<button type="button" class="tour-skip" data-a="skip">' + (last ? '' : 'Pular') + '</button>' +
      '<div class="tour-ic">' + s.svg + '</div>' +
      '<div class="tour-count">Passo ' + (i + 1) + ' de ' + STEPS.length + '</div>' +
      '<h2 class="tour-title"></h2><p class="tour-text"></p>' +
      '<div class="tour-dots">' + dots + '</div>' +
      '<div class="tour-actions">' + (i > 0 ? '<button type="button" class="ghost" data-a="back">Voltar</button>' : '<span></span>') +
      '<button type="button" data-a="next">' + (last ? 'Começar a usar' : 'Próximo') + '</button></div>';
    root.querySelector('.tour-title').textContent = s.t;
    root.querySelector('.tour-text').textContent = s.d;
    if (s.sel) {
      var el = document.querySelector(s.sel);
      if (el && el.offsetParent !== null) { el.classList.add('tour-hl'); hl = el; }
    }
  }
  function open(){
    if (root) return;
    i = 0;
    root = document.createElement('div'); root.className = 'tour-overlay';
    root.innerHTML = '<div class="tour-card" role="dialog" aria-modal="true" aria-label="Tutorial do Runiqx"></div>';
    root.addEventListener('click', function(ev){
      var a = ev.target.closest && ev.target.closest('[data-a]'); if (!a) return;
      var act = a.getAttribute('data-a');
      if (act === 'skip') done();
      else if (act === 'back') { i = Math.max(0, i - 1); render(); }
      else if (act === 'next') { if (i >= STEPS.length - 1) done(); else { i++; render(); } }
    });
    document.body.appendChild(root); document.body.classList.add('tour-open');
    render();
  }
  document.addEventListener('keydown', function(e){ if (!root) return; if (e.key === 'Escape') done(); if (e.key === 'ArrowRight') { if (i < STEPS.length - 1) { i++; render(); } } if (e.key === 'ArrowLeft') { i = Math.max(0, i - 1); render(); } });
  document.addEventListener('click', function(ev){
    var t = ev.target.closest && ev.target.closest('[data-tour-open]'); if (!t) return;
    ev.preventDefault(); var panel = document.getElementById('navMorePanel'); if (panel) panel.classList.remove('open'); open();
  });
  if (AUTO) setTimeout(open, 600);
})();
</script>`;
}

module.exports = { tourScript };
