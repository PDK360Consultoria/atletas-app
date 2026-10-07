// Telas de moderação: denunciar, usuários bloqueados, termos de uso e fila do admin.
const { esc } = require('./lib/format');
const { REPORT_REASONS } = require('./lib/moderation');

function layoutLazy(args) { return require('./views').layout(args); }

function publicShell(title, body) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0B0D10">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/assets/runiqx-icon-192.png"><title>${esc(title)} · Runiqx</title><link rel="stylesheet" href="/style.css"></head>
<body><div class="wrap" style="max-width:760px; margin:0 auto; padding:24px 16px;"><div class="center-logo"><a href="/" style="color:inherit; text-decoration:none;">Runiqx</a></div>${body}</div></body></html>`;
}

function termsPage(user) {
  const body = `<div class="card legal">
<h1>Termos de uso</h1>
<p class="muted">Última atualização: outubro de 2026</p>

<h2>O que é o Runiqx</h2>
<p>O Runiqx é um app de treino de corrida com feed entre atletas, operado pela 360 Consultoria Empresarial. Ao criar uma conta, você concorda com estes termos e com a <a href="/privacidade">política de privacidade</a>.</p>

<h2>Regras de conduta</h2>
<p>Não toleramos conteúdo ofensivo ou abusivo. É proibido publicar ou enviar: assédio, bullying, ameaças, discurso de ódio ou discriminação, conteúdo sexual ou nudez, violência ou conteúdo perigoso, spam, golpes, perfis falsos e qualquer conteúdo que viole direitos de terceiros ou a lei. Você é responsável pelo que publica (legendas, fotos e comentários).</p>

<h2>Denúncias e bloqueio</h2>
<p>Em cada post, comentário e perfil há a opção <b>Denunciar</b>, e nos perfis há também <b>Bloquear</b>. Quem você bloqueia deixa de ver você e você deixa de ver essa pessoa. Analisamos as denúncias em até 24 horas e removemos o conteúdo que violar estes termos. Quem violar as regras pode ter o conteúdo removido e a conta encerrada, sem aviso prévio.</p>

<h2>Sua conta</h2>
<p>Você pode excluir sua conta a qualquer momento em Configurações > Excluir conta. Os passos completos estão em <a href="/excluir-conta">runiqx.com/excluir-conta</a>.</p>

<h2>Strava</h2>
<p>Os dados que vêm da sua conta Strava são exibidos somente para você. O Runiqx não é afiliado à Strava.</p>

<h2>Contato</h2>
<p>Denúncias, dúvidas e solicitações: <a href="mailto:felipe@360consultoria.com.br">felipe@360consultoria.com.br</a>.</p>
</div>`;
  if (user) return layoutLazy({ title: 'Termos de uso', user, body });
  return publicShell('Termos de uso', body);
}

function reportPage(user, target, opts) {
  opts = opts || {};
  const labels = { post: 'este post', comment: 'este comentário', user: 'este perfil' };
  const body = `<div class="card legal" style="max-width:560px; margin:24px auto;">
<h1>Denunciar ${esc(labels[target.type] || 'conteúdo')}</h1>
${target.preview ? `<p class="muted" style="font-style:italic;">“${esc(target.preview)}”</p>` : ''}
<form method="POST" action="/denunciar">
  <input type="hidden" name="type" value="${esc(target.type)}">
  <input type="hidden" name="id" value="${target.id}">
  <input type="hidden" name="return_to" value="${esc(opts.returnTo || '/feed')}">
  <label>Qual é o problema?</label>
  ${Object.entries(REPORT_REASONS).map(([k, v], i) => `<label style="display:flex; align-items:center; gap:10px; font-weight:500; margin:8px 0;"><input type="radio" name="reason" value="${k}"${i === 0 ? ' required' : ''} style="width:auto; margin:0;"> ${esc(v)}</label>`).join('')}
  <label>Detalhes (opcional)</label>
  <textarea name="details" maxlength="600" placeholder="Conte o que aconteceu, se quiser."></textarea>
  ${target.userId && target.userId !== user.id ? `<label style="display:flex; align-items:center; gap:10px; font-weight:500; margin-top:14px;"><input type="checkbox" name="block" value="1" style="width:auto; margin:0;"> Bloquear também essa pessoa</label>` : ''}
  <div style="margin-top:18px; display:flex; gap:10px;"><button type="submit">Enviar denúncia</button><a class="btn ghost" href="${esc(opts.returnTo || '/feed')}">Cancelar</a></div>
</form>
<p class="muted" style="font-size:12.5px; margin-top:14px;">Analisamos as denúncias em até 24 horas. Veja os <a href="/termos">Termos de uso</a>.</p>
</div>`;
  return layoutLazy({ title: 'Denunciar', user, body });
}

function reportDonePage(user, opts) {
  opts = opts || {};
  const body = `<div class="card" style="max-width:560px; margin:24px auto; text-align:center;">
<h1>Denúncia enviada</h1>
<p>Obrigado por avisar. Vamos analisar em até 24 horas e remover o que violar os <a href="/termos">Termos de uso</a>.${opts.blocked ? ' Você também bloqueou essa pessoa.' : ''}</p>
<p><a class="btn" href="${esc(opts.returnTo || '/feed')}">Voltar</a></p>
</div>`;
  return layoutLazy({ title: 'Denúncia enviada', user, body });
}

function blockedPage(user, rows) {
  const body = `<h1>Usuários bloqueados</h1>
<p class="lede">Quem você bloqueia não vê o seu perfil e os seus posts, e você não vê os dele(a). Você pode desbloquear quando quiser.</p>
${rows.length ? rows.map((u) => `<div class="card discover-row">
  <div class="discover-row-main"><div class="t">${esc(u.name)}</div><div class="d">${u.city ? esc(u.city) : ''}</div></div>
  <form method="POST" action="/u/${esc(u.public_slug)}/unblock" class="follow-form"><input type="hidden" name="return_to" value="/bloqueados"><button class="ghost btn xs" type="submit">Desbloquear</button></form>
</div>`).join('') : `<div class="card"><p class="muted" style="margin:0;">Você não bloqueou ninguém.</p></div>`}
<p class="muted"><a href="/settings">← Voltar para Config</a></p>`;
  return layoutLazy({ title: 'Usuários bloqueados', user, body, active: 'settings' });
}

function adminReportsPage(user, reports) {
  const open = reports.filter((r) => r.status === 'open');
  const done = reports.filter((r) => r.status !== 'open');
  const card = (r) => `<div class="card">
  <div class="row" style="gap:8px; flex-wrap:wrap; align-items:center;">
    <span class="pill">${esc(r.target_type === 'post' ? 'Post' : r.target_type === 'comment' ? 'Comentário' : 'Perfil')}</span>
    <span class="pill">${esc(REPORT_REASONS[r.reason] || r.reason)}</span>
    <span class="muted mono">#${r.id} · ${esc(r.created_at)}</span>
  </div>
  <p style="margin:10px 0 4px;"><b>Denunciado:</b> ${r.target_user_name ? `<a href="/admin/users/${r.target_user_id}">${esc(r.target_user_name)}</a>` : '(conta removida)'} · <b>Por:</b> ${esc(r.reporter_name || '—')}</p>
  ${r.preview ? `<p class="muted" style="margin:0 0 6px; font-style:italic;">“${esc(r.preview)}”</p>` : ''}
  ${r.details ? `<p style="margin:0 0 8px;">${esc(r.details)}</p>` : ''}
  ${r.status === 'open' ? `<div class="row" style="gap:8px; flex-wrap:wrap;">
    ${r.target_type !== 'user' ? `<form method="POST" action="/admin/reports/${r.id}/remove" onsubmit="return confirm('Remover este conteúdo?')"><button class="danger" type="submit">Remover conteúdo</button></form>` : ''}
    <form method="POST" action="/admin/reports/${r.id}/resolve"><button class="ghost" type="submit">Marcar como resolvida</button></form>
  </div>` : `<p class="muted" style="margin:0;">${esc(r.status === 'removed' ? 'Conteúdo removido' : 'Resolvida')} em ${esc(r.resolved_at || '')}</p>`}
</div>`;
  const body = `<a class="link mono" href="/admin" style="display:inline-block; margin-top:20px; text-decoration:none;">← Admin</a>
<h1>Denúncias</h1>
<p class="lede">${open.length} em aberto. Meta: analisar em até 24 horas.</p>
${open.length ? open.map(card).join('') : `<div class="card"><p class="muted" style="margin:0;">Nenhuma denúncia em aberto.</p></div>`}
${done.length ? `<h2 style="margin-top:28px;">Resolvidas</h2>${done.slice(0, 30).map(card).join('')}` : ''}`;
  return layoutLazy({ title: 'Denúncias', user, body, active: 'admin' });
}

module.exports = { termsPage, reportPage, reportDonePage, blockedPage, adminReportsPage };
