// Professor ao vivo na corrida: instruções por fase (antes, durante, depois).
// Base = o mesmo cérebro/voz do Professor (buildVoiceInstructions); aqui entram
// as regras do momento. Todo número falado vem do app (sensores), nunca inventado.
const { fmtClock, secToPace } = require('./format');
const { courseBriefing } = require('./course');

const TYPES = {
  leve: 'rodagem leve (conversável, zona 2)',
  longao: 'longão',
  ritmo: 'ritmo de prova',
  tiros: 'tiros / intervalado',
  livre: 'treino livre',
};

function typeLabel(t) { return TYPES[t] || TYPES.livre; }

function targetsLine(ctx) {
  const out = [];
  if (ctx.goalPaceSec) out.push(`pace alvo ${secToPace(ctx.goalPaceSec)}/km`);
  if (ctx.hrCeiling) out.push(`FC até ${ctx.hrCeiling} bpm`);
  return out.length ? out.join(', ') : 'sem alvo definido (pergunte se ele quer um)';
}

const SPEECH = 'FALA DE NÚMEROS: diga pace como "cinco e trinta por quilômetro", tempo como "vinte e cinco minutos e dez segundos", batimentos como "cento e cinquenta e dois batimentos", distância como "cinco quilômetros e meio". Nunca leia símbolos nem siglas soletradas; diga "batimentos" e "pace", nunca "bpm" nem "FC".';

function beforeBlock(ctx) {
  const l = [];
  l.push('MODO ANTES DO TREINO (prioridade máxima): o atleta abriu a tela de corrida e ainda NÃO começou. Você fala primeiro, sem esperar. Em no máximo três frases curtas por vez: cumprimente pelo horário, pergunte como ele está chegando (pernas, sono, algum desconforto) e já diga o que está planejado para hoje.');
  l.push(`Treino de hoje: ${typeLabel(ctx.workoutType)}. Alvos: ${targetsLine(ctx)}.`);
  if (ctx.raceName) l.push(`Prova ligada a este treino: ${ctx.raceName}${ctx.raceDate ? ' em ' + ctx.raceDate : ''}.`);
  if (ctx.courseText) l.push(ctx.courseText + ' Se o treino de hoje for no percurso (ou parecido), comente as subidas e como administrar o esforço; se não for, comente só a estratégia geral da prova.');
  l.push('Se ele disser como está e houver algo preocupante (dor, febre, tontura, sono péssimo), sugira ajustar ou trocar o treino por algo leve. Quando ele disser que está pronto, deseje bom treino em uma frase e diga que vai avisar km a km, batimentos e o que vem pela frente. Não comece a corrida por ele: quem aperta o botão é o atleta.');
  l.push(SPEECH);
  return l.join('\n');
}

function duringBlock(ctx) {
  const l = [];
  l.push('MODO CORRIDA (prioridade máxima, substitui qualquer regra de estilo anterior que conflite): o atleta está CORRENDO agora, com fone de ouvido. O aplicativo te envia mensagens que começam com [EVENTO]. Para cada uma, fale UMA vez, com no máximo duas frases curtas (menos de 15 palavras cada), com a voz firme e calma de um treinador na lateral. Use SOMENTE os números que vieram no evento; nunca invente pace, distância, batimentos, tempo ou trecho do percurso.');
  l.push(`Treino: ${typeLabel(ctx.workoutType)}. Alvos: ${targetsLine(ctx)}.`);
  l.push('Eventos: "parcial" = fale o quilômetro, o tempo da parcial, o pace e os batimentos, e uma frase de ajuste se fizer sentido; "batimentos" = avise que subiu de zona ou passou do teto e peça para aliviar; "pace" = avise que está rápido ou lento demais para o alvo e diga o ajuste; "subida" e "descida" = avise o que vem pela frente com a distância e o ganho, e oriente poupar esforço (olhe o esforço, não o pace); "marco" = metade, últimos quilômetros, reta final; "seguranca" = fale com urgência: pare de correr, caminhe, respire; se houver dor no peito, tontura ou falta de ar, oriente parar e procurar ajuda. Se vier "[EVENTO acumulado]", resuma tudo em UMA frase.');
  l.push('Se o atleta falar com você, responda em uma ou duas frases e volte ao silêncio. Se ele pedir silêncio, passe a falar só parciais e segurança até ele liberar. Se ele perguntar números (pace, batimentos, distância, o que vem), use os do último evento ou peça o dado com "um segundo" e aguarde o próximo evento. Nunca faça perguntas longas durante a corrida.');
  l.push(SPEECH);
  return l.join('\n');
}

function afterBlock(ctx, s) {
  const l = [];
  l.push('MODO DEPOIS DO TREINO (prioridade máxima): o atleta acabou de terminar. Você fala primeiro. Primeiro, diga em duas frases o resumo: distância, tempo e pace médio, batimentos médios e o que mais se destacou. Depois dê UMA leitura de treinador (o que foi bom e um ponto de atenção, ligando à meta/prova), uma orientação de recuperação (hidratar, comer, alongar) e pergunte como ele se sentiu. Depois converse normalmente: sem listas, sem markdown, frases curtas.');
  if (s) {
    l.push('DADOS DO TREINO QUE ACABOU (reais, medidos pelo aplicativo):');
    l.push(`Distância ${s.distance_km} km, tempo ${fmtClock(s.duration_sec)}, pace médio ${secToPace(s.avg_pace_sec)}/km${s.avg_hr ? `, batimentos médios ${Math.round(s.avg_hr)}` : ''}${s.max_hr ? `, máximo ${Math.round(s.max_hr)}` : ''}${s.elevation_gain_m ? `, subida acumulada ${Math.round(s.elevation_gain_m)} m` : ''}.`);
    if (s.laps && s.laps.length) l.push('Parciais por km: ' + s.laps.map((x, i) => `km${i + 1} ${secToPace(Math.round((x.split_sec || 0) / (x.partial_km || 1)))}${x.avg_hr ? ` (${Math.round(x.avg_hr)})` : ''}`).join(' · ') + '.');
  }
  l.push(`Treino planejado era: ${typeLabel(ctx.workoutType)}. Alvos: ${targetsLine(ctx)}.`);
  l.push(SPEECH);
  return l.join('\n');
}

function phaseInstructions(baseInstructions, phase, ctx, summary) {
  const block = phase === 'during' ? duringBlock(ctx) : (phase === 'after' ? afterBlock(ctx, summary) : beforeBlock(ctx));
  return baseInstructions + '\n\n' + block;
}

function courseTextFor(courseRow, raceName) {
  if (!courseRow) return '';
  let climbs = [];
  try { climbs = JSON.parse(courseRow.climbs_json || '[]'); } catch (e) { climbs = []; }
  return courseBriefing({ distance_km: courseRow.distance_km, gain_m: courseRow.gain_m, loss_m: courseRow.loss_m, climbs }, raceName);
}

module.exports = { phaseInstructions, courseTextFor, TYPES };
