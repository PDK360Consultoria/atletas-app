// Perguntas obrigatórias (de clicar) antes da Análise com IA de um treino.
// O atleta diz o que o treino ERA; a IA avalia a execução contra isso.
const { esc } = require('./format');

const QUESTIONS = [
  { key: 'tipo', label: 'Que tipo de treino foi?', required: true, options: [
    ['regenerativo', 'Regenerativo'], ['rodagem_leve', 'Rodagem leve'], ['rodagem_moderada', 'Rodagem moderada'],
    ['longao', 'Longão'], ['tiros', 'Tiros (intervalado)'], ['fartlek', 'Fartlek'], ['progressivo', 'Progressivo'],
    ['tempo_run', 'Tempo run / limiar'], ['prova', 'Prova'], ['teste', 'Teste / contra-relógio'],
  ] },
  { key: 'objetivo', label: 'Qual era o objetivo do treino?', required: true, options: [
    ['recuperar', 'Recuperar'], ['base', 'Construir base aeróbica'], ['ritmo_prova', 'Treinar ritmo de prova'],
    ['limiar', 'Subir o limiar'], ['velocidade', 'Velocidade / VO2máx'], ['resistencia', 'Resistência / volume'],
    ['manter', 'Manter a rotina'], ['livre', 'Sem objetivo definido'],
  ] },
  { key: 'plano', label: 'Como foi em relação ao plano?', required: true, options: [
    ['cumpri', 'Cumpri o treino do plano'], ['parcial', 'Cumpri em parte'], ['diferente', 'Fiz diferente do plano'], ['livre', 'Treino livre, sem plano'],
  ] },
  { key: 'esforco', label: 'Qual foi o esforço percebido?', required: true, options: [
    ['muito_leve', 'Muito leve'], ['leve', 'Leve'], ['moderado', 'Moderado'], ['forte', 'Forte'], ['muito_forte', 'Muito forte'], ['maximo', 'Máximo'],
  ] },
  { key: 'corpo', label: 'Como estava o corpo?', required: true, options: [
    ['solto', 'Leve e solto'], ['normal', 'Normal'], ['pesado', 'Pesado / cansado'], ['dor', 'Com dor ou desconforto'],
  ] },
];

const CONDITIONS = [
  ['calor', 'Calor forte'], ['frio', 'Frio'], ['chuva', 'Chuva'], ['vento', 'Vento'], ['subidas', 'Muitas subidas'],
  ['esteira', 'Esteira'], ['pista', 'Pista'], ['jejum', 'Em jejum'], ['carbo', 'Usei gel / carboidrato'],
];

function labelOf(q, v) { const o = q.options.find((x) => x[0] === v); return o ? o[1] : null; }

// Lê e valida os campos do formulário. Retorna { ok, ctx, missing }.
function parseFields(fields) {
  const ctx = {};
  const missing = [];
  for (const q of QUESTIONS) {
    const v = String(fields['q_' + q.key] || '');
    if (labelOf(q, v)) ctx[q.key] = v; else missing.push(q.key);
  }
  ctx.condicoes = CONDITIONS.filter(([k]) => fields['c_' + k]).map(([k]) => k);
  const note = String(fields.nota || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (note) ctx.nota = note;
  return { ok: missing.length === 0, ctx, missing };
}

function parseStored(json) { try { return json ? JSON.parse(json) : null; } catch (e) { return null; } }

// Texto para o prompt da IA.
function toPromptText(ctx) {
  if (!ctx) return '';
  const lines = [];
  for (const q of QUESTIONS) { const l = ctx[q.key] && labelOf(q, ctx[q.key]); if (l) lines.push(`- ${q.label} ${l}`); }
  const conds = (ctx.condicoes || []).map((k) => (CONDITIONS.find((c) => c[0] === k) || [])[1]).filter(Boolean);
  if (conds.length) lines.push(`- Condições: ${conds.join(', ')}`);
  if (ctx.nota) lines.push(`- Observação do atleta: ${ctx.nota}`);
  return lines.join('\n');
}

// Resumo curto em pílulas para exibir na tela.
function pillsHtml(ctx) {
  if (!ctx) return '';
  const items = [];
  for (const q of QUESTIONS) { const l = ctx[q.key] && labelOf(q, ctx[q.key]); if (l) items.push(l); }
  return `<div class="row" style="gap:6px; margin:0 0 12px;">${items.map((t) => `<span class="pill">${esc(t)}</span>`).join('')}</div>`;
}

// Formulário com chips de clicar. `ctx` pré-seleciona respostas anteriores.
function formHtml(activityId, ctx, { missing = [], buttonLabel = 'Gerar análise técnica' } = {}) {
  ctx = ctx || {};
  const qs = QUESTIONS.map((q) => `
    <fieldset class="aiq${missing.includes(q.key) ? ' aiq-missing' : ''}">
      <legend>${esc(q.label)}</legend>
      <div class="chips">${q.options.map(([v, l]) => `<label class="chip"><input type="radio" name="q_${q.key}" value="${v}"${ctx[q.key] === v ? ' checked' : ''} required><span>${esc(l)}</span></label>`).join('')}</div>
    </fieldset>`).join('');
  const conds = `
    <fieldset class="aiq">
      <legend>Condições do dia <span class="muted">(opcional, pode marcar mais de uma)</span></legend>
      <div class="chips">${CONDITIONS.map(([k, l]) => `<label class="chip"><input type="checkbox" name="c_${k}" value="1"${(ctx.condicoes || []).includes(k) ? ' checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>
    </fieldset>`;
  return `<form method="POST" action="/activities/${activityId}/analyze" class="aiform" onsubmit="var b=this.querySelector('button[type=submit]'); if(this.checkValidity()){b.disabled=true; b.textContent='Gerando análise… (pode levar até 30s)';}">
    <p class="muted" style="margin:0 0 14px;">Responda rapidinho antes da análise: a IA vai avaliar o treino de acordo com o que ele era, não só pelos números.</p>
    ${missing.length ? '<p style="color:var(--red); margin:0 0 12px;">Faltou responder alguma pergunta marcada em vermelho.</p>' : ''}
    ${qs}${conds}
    <fieldset class="aiq"><legend>Algo mais que a IA deva saber? <span class="muted">(opcional)</span></legend>
      <input type="text" name="nota" maxlength="300" value="${esc(ctx.nota || '')}" placeholder="Ex.: acordei mal, dor na panturrilha, 1º treino depois da prova"></fieldset>
    <button type="submit">${esc(buttonLabel)}</button>
  </form>`;
}

module.exports = { QUESTIONS, CONDITIONS, parseFields, parseStored, toPromptText, pillsHtml, formHtml };
