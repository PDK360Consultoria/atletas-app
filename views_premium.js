// Tela Premium: assinatura mensal do Runiqx pela App Store / Google Play.
// A compra em si acontece no app nativo (plugin de compras do Capacitor, na versao 1.1+).
// No navegador comum ou em versoes antigas do app, a tela mostra o aviso para atualizar.
const { esc } = require('./lib/format');

function layoutLazy(args) { return require('./views').layout(args); }

function premiumPage(user, status) {
  status = status || {};
  const ids = JSON.stringify(status.product_ids || []);
  const active = status.premium && status.enforcing;
  const until = status.expires_at ? new Date(status.expires_at).toLocaleDateString('pt-BR') : '';
  const body = `<div class="card legal" style="max-width:560px; margin:24px auto;">
<h1>Runiqx Premium</h1>
<p class="muted">Treino de corrida com Professor IA, sem limites.</p>

<ul>
  <li><b>Professor ao vivo</b>: conversa por voz durante o treino.</li>
  <li><b>Professor Chat</b>: perguntas sobre seus treinos, com texto, foto e áudio.</li>
  <li><b>Análise com IA</b> dos seus treinos e planos de treino.</li>
</ul>

<p style="font-size:1.35rem; margin:18px 0 4px;"><b>R$ 19,90</b> por mês</p>
<p class="muted" style="margin-top:0;">Assinatura mensal com renovação automática. Cancele quando quiser.</p>

${active ? `<div class="card" style="padding:12px 14px; margin:14px 0;"><b>Você é Premium.</b>${until ? ` Renova ou expira em ${esc(until)}.` : ''}</div>` : ''}

<div id="buyBox">
  <button class="btn" id="buyBtn" type="button" style="width:100%;">Assinar por R$ 19,90/mês</button>
  <button class="btn ghost" id="restoreBtn" type="button" style="width:100%; margin-top:10px;">Restaurar compras</button>
  <p id="msg" class="muted" style="min-height:1.4em; margin-top:12px;"></p>
</div>

<p class="muted" style="font-size:.82rem; line-height:1.5;">
O pagamento é cobrado na sua conta da App Store ou do Google Play na confirmação da compra. A assinatura renova automaticamente a cada mês, a menos que seja cancelada pelo menos 24 horas antes do fim do período atual. Você gerencia e cancela em Ajustes &gt; seu nome &gt; Assinaturas (iPhone) ou Google Play &gt; Pagamentos e assinaturas (Android).
</p>
<p class="muted" style="font-size:.82rem;"><a href="/termos">Termos de uso</a> · <a href="/privacidade">Política de privacidade</a></p>
</div>
<script>
(function () {
  var IDS = ${ids};
  var PRODUCT = IDS[0];
  var msg = document.getElementById('msg');
  var buy = document.getElementById('buyBtn');
  var restore = document.getElementById('restoreBtn');
  function say(t) { msg.textContent = t || ''; }
  function plugin() {
    var C = window.Capacitor;
    return C && C.Plugins && C.Plugins.NativePurchases ? C.Plugins.NativePurchases : null;
  }
  var platform = (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform()) || 'web';
  var P = plugin();
  if (!P || platform === 'web') {
    buy.disabled = true; restore.style.display = 'none';
    say('Para assinar, abra o Runiqx no app da App Store ou do Google Play (e mantenha o app atualizado).');
    return;
  }
  function post(url, data) {
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); });
  }
  function sendTransactions(list) {
    var ios = [], token = null;
    list.forEach(function (t) {
      if (!t) return;
      if (t.jwsRepresentation) ios.push(t.jwsRepresentation);
      if (t.signedTransaction) ios.push(t.signedTransaction);
      if (t.purchaseToken) token = t.purchaseToken;
    });
    if (platform === 'ios') return ios.length ? post('/api/billing/ios/verify', { signedTransactions: ios }) : Promise.resolve({ ok: false, body: { error: 'no_jws' } });
    return token ? post('/api/billing/android/verify', { purchaseToken: token }) : Promise.resolve({ ok: false, body: { error: 'no_token' } });
  }
  function done(res) {
    if (res.ok && res.body && res.body.premium) { say('Assinatura ativa. Obrigado!'); setTimeout(function () { location.href = '/professor'; }, 900); }
    else { say('Não consegui confirmar a assinatura agora. Tente "Restaurar compras" em instantes.'); }
  }
  buy.addEventListener('click', function () {
    buy.disabled = true; say('Abrindo a compra...');
    var type = (P.PURCHASE_TYPE && P.PURCHASE_TYPE.SUBS) || 'subs';
    P.purchaseProduct({ productIdentifier: PRODUCT, productType: type, planIdentifier: 'mensal', quantity: 1 })
      .then(function (tx) { say('Confirmando...'); return sendTransactions([tx]); })
      .then(done)
      .catch(function (e) { say(e && /cancel/i.test(String(e.message || e)) ? '' : 'A compra não foi concluída.'); })
      .then(function () { buy.disabled = false; });
  });
  restore.addEventListener('click', function () {
    restore.disabled = true; say('Procurando compras...');
    var get = P.getPurchases ? P.getPurchases({ productType: (P.PURCHASE_TYPE && P.PURCHASE_TYPE.SUBS) || 'subs' }) : Promise.reject(new Error('sem getPurchases'));
    get.then(function (r) { return sendTransactions((r && r.purchases) || []); })
      .then(done)
      .catch(function () { say('Nenhuma assinatura encontrada nesta conta.'); })
      .then(function () { restore.disabled = false; });
  });
})();
</script>`;
  return layoutLazy({ title: 'Runiqx Premium', user, body });
}

module.exports = { premiumPage };
