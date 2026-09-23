const { secToPace, fmtClock, fmtDate, esc } = require('./lib/format');

function layout({ title, user, body, active }) {
  const nav = user
    ? `<nav class="nav">
        <a class="brand" href="/">Atletas</a>
        <div class="links">
          <a class="link ${active === 'home' ? 'active' : ''}" href="/">Perfil</a>
          <a class="link ${active === 'races' ? 'active' : ''}" href="/races">Provas</a>
          <a class="link ${active === 'activities' ? 'active' : ''}" href="/activities">Treinos</a>
          <a class="link ${active === 'feed' ? 'active' : ''}" href="/feed">Feed</a>
          <a class="link ${active === 'coach' ? 'active' : ''}" href="/coach">Coach ao vivo</a>
          <a class="link ${active === 'settings' ? 'active' : ''}" href="/settings">Config</a>
          <a class="link" href="/logout">Sair</a>
        </div>
      </nav>`
    : `<nav class="nav"><a class="brand" href="/">Atletas</a></nav>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Atletas</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
${nav}
<div class="wrap">
${body}
</div>
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

function dashboardPage({ user, nextRace, daysToRace, recentActivities, weekKm }) {
  const body = `
<h1>Olá, ${esc(user.name.split(' ')[0])}</h1>
<p class="lede">${user.city ? esc(user.city) + ' · ' : ''}${user.goal_race_name ? 'Meta: ' + esc(user.goal_race_name) : 'Defina sua meta em Config'}</p>

<div class="grid cols-4">
  <div class="card stat"><div class="k">Dias p/ prova</div><div class="v">${daysToRace != null ? daysToRace : '—'}</div></div>
  <div class="card stat"><div class="k">Meta de tempo</div><div class="v">${user.goal_time_sec ? fmtClock(user.goal_time_sec) : '—'}</div></div>
  <div class="card stat"><div class="k">Km na semana</div><div class="v">${weekKm.toFixed(1)}<span class="u">km</span></div></div>
  <div class="card stat"><div class="k">Treinos registrados</div><div class="v">${recentActivities.length ? recentActivities.length + '+' : '0'}</div></div>
</div>

${nextRace ? `<div class="card">
  <h2>Próxima prova</h2>
  <div class="list-item" style="border:none; padding:0;">
    <div><div class="t">${esc(nextRace.name)}</div><div class="d">${fmtDate(nextRace.race_date)} · ${nextRace.distance_km ? nextRace.distance_km + 'km' : ''} ${nextRace.city ? '· ' + esc(nextRace.city) : ''}</div></div>
    <a class="btn ghost" href="/races">Ver provas</a>
  </div>
</div>` : `<div class="card"><p class="muted" style="margin:0;">Nenhuma prova cadastrada ainda. <a href="/races">Adicionar prova →</a></p></div>`}

<div class="card">
  <h2>Treinos recentes</h2>
  ${recentActivities.length ? recentActivities.map(a => `
    <a class="list-item" href="/activities/${a.id}">
      <div><div class="t">${esc(a.title)}</div><div class="d">${fmtDate(a.started_at || a.created_at)} · ${a.distance_km ? a.distance_km + 'km' : ''} ${a.avg_pace_sec ? '· ' + secToPace(a.avg_pace_sec) + '/km' : ''}</div></div>
      <span class="pill">${esc(a.workout_type || 'treino')}</span>
    </a>`).join('') : `<p class="muted" style="margin:0;">Nenhum treino ainda. <a href="/activities/new">Registrar treino →</a></p>`}
</div>
`;
  return layout({ title: 'Perfil', user, body, active: 'home' });
}

function racesPage(user, races) {
  const body = `
<h1>Provas</h1>
<p class="lede">Suas provas passadas e futuras.</p>

<div class="card">
  <h2>Nova prova</h2>
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
  <h2>Todas as provas</h2>
  ${races.length ? races.map(r => `
    <div class="list-item">
      <div><div class="t">${esc(r.name)}</div><div class="d">${fmtDate(r.race_date)} ${r.distance_km ? '· ' + r.distance_km + 'km' : ''} ${r.city ? '· ' + esc(r.city) : ''} ${r.goal_time_sec ? '· meta ' + fmtClock(r.goal_time_sec) : ''}</div></div>
      <form method="POST" action="/races/${r.id}/delete" onsubmit="return confirm('Remover esta prova?')">
        <button class="ghost danger" type="submit">Remover</button>
      </form>
    </div>`).join('') : `<p class="muted" style="margin:0;">Nenhuma prova cadastrada.</p>`}
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
  <div class="card stat"><div class="k">Distância</div><div class="v">${activity.distance_km ?? '—'}<span class="u">km</span></div></div>
  <div class="card stat"><div class="k">Tempo</div><div class="v">${fmtClock(activity.duration_sec)}</div></div>
  <div class="card stat"><div class="k">Pace médio</div><div class="v">${secToPace(activity.avg_pace_sec)}<span class="u">/km</span></div></div>
  <div class="card stat"><div class="k">FC média</div><div class="v">${activity.avg_hr ?? '—'}${activity.avg_hr ? '<span class="u">bpm</span>' : ''}</div></div>
</div>

${laps.length ? `<div class="card">
  <h2>Splits por km</h2>
  <div class="bars">${bars}</div>
</div>` : ''}

<div class="card">
  <h2>Blocos (previsto × realizado)</h2>
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
  <h2>Análise com IA</h2>
  ${activity.ai_analysis ? `<div class="ai-box">${esc(activity.ai_analysis)}</div>` : `
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
  <h2>Strava</h2>
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
  <h2>Perfil</h2>
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
  <h2>Análise com IA (opcional)</h2>
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

module.exports = {
  layout, loginPage, signupPage, dashboardPage, racesPage,
  activitiesPage, activityNewPage, activityDetailPage, feedPage, settingsPage,
};
