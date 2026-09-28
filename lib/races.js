// Busca próximas corridas de rua perto da cidade do atleta usando a API
// pública da Corrida Perfeita (não requer autenticação). Chamada direta via
// fetch nativo — sem SDK/pacote, seguindo o mesmo padrão já usado para o
// Strava e a Anthropic.

// Município da Região Metropolitana de Curitiba (RMC). O calendário de
// corridas marca cada prova com a cidade-sede real (São José dos Pinhais,
// Pinhais, Araucária, Colombo...), não "Curitiba" — então um atleta de
// Curitiba filtrando só por "city=Curitiba" perde quase todas as provas da
// região. Quando o usuário é de Curitiba/RMC, ampliamos a busca para o
// estado inteiro e filtramos aqui pelos municípios da região.
const RMC_MUNICIPALITIES = [
  'curitiba', 'adrianopolis', 'agudos do sul', 'almirante tamandare', 'araucaria',
  'balsa nova', 'bocaiuva do sul', 'campina grande do sul', 'campo largo',
  'campo magro', 'cerro azul', 'colombo', 'contenda', 'doutor ulysses',
  'fazenda rio grande', 'itaperucu', 'lapa', 'mandirituba', 'pien', 'pinhais',
  'piraquara', 'quatro barras', 'quitandinha', 'rio branco do sul', 'rio negro',
  'sao jose dos pinhais', 'tijucas do sul', 'tunas do parana',
];

// Litoral do Paraná — a outra região que o atleta costuma correr (ele já
// registrou uma prova em Guaratuba), então ganha seu próprio filtro em vez
// de ficar escondida dentro da busca do estado inteiro.
const LITORAL_MUNICIPALITIES = [
  'guaratuba', 'matinhos', 'pontal do parana', 'paranagua', 'antonina',
  'morretes', 'guaraquecaba',
];

// Rótulos exibidos no seletor de região da página de provas.
const REGION_LABELS = {
  litoral: 'Litoral do Paraná',
  pr: 'Paraná (todo o estado)',
  custom: 'Outra cidade',
};

function normalize(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function isRMC(cityName) {
  const n = normalize(cityName);
  if (!n) return false;
  return RMC_MUNICIPALITIES.some((m) => n === m || n.includes(m));
}

function isLitoral(cityName) {
  const n = normalize(cityName);
  if (!n) return false;
  return LITORAL_MUNICIPALITIES.some((m) => n === m || n.includes(m));
}

// Rótulo dinâmico pro card/seletor quando a região é "auto" (baseada na
// cidade cadastrada do atleta): usa "Curitiba e Região" quando ele é da RMC
// (caso do Felipe), senão cai pro nome da cidade dele, ou um texto genérico
// se ele ainda não preencheu a cidade em Config.
function autoRegionLabel(userCity) {
  const cityOnly = (userCity || '').split(',')[0].split('-')[0].trim();
  if (!cityOnly) return 'perto de você';
  return isRMC(cityOnly) ? 'Curitiba e Região' : cityOnly;
}

// Link de busca pra inscrição — a API da Corrida Perfeita não devolve a URL
// oficial da prova (sem campo "url"/"slug"), então em vez de arriscar um
// link direto quebrado, abrimos uma busca do Google já com os termos certos
// pra achar a página de inscrição real (organizador, Ticket Sports, Sympla
// etc.) em um clique.
function registrationSearchUrl(name, city) {
  const q = `inscrição ${name}${city ? ' ' + city : ''} corrida`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// opts:
//  - city: cidade cadastrada do atleta (usada só quando region === 'auto')
//  - days: janela em dias a partir de hoje (default 60)
//  - region: 'auto' (padrão, baseado em city) | 'litoral' | 'pr' | 'custom'
//  - customQuery: "Cidade, UF" digitada pelo atleta, só usada quando region === 'custom'
//  - limit: máximo de provas retornadas (default 60 — bem acima do que essa
//    base de dados costuma ter num período de 60 dias, então na prática
//    mostra tudo que existir)
async function fetchNearbyRaces(opts = {}) {
  const { city, days = 60, region = 'auto', customQuery = '', limit = 60 } = opts;

  let cityParam = '';
  let stateParam = '';
  let postFilter = null;

  if (region === 'litoral') {
    stateParam = 'PR';
    postFilter = (c) => isLitoral(c);
  } else if (region === 'pr') {
    stateParam = 'PR';
  } else if (region === 'custom') {
    if (!customQuery || !customQuery.trim()) return [];
    cityParam = customQuery.split(',')[0].split('-')[0].trim();
    stateParam = (customQuery.split(',')[1] || customQuery.split('-')[1] || '').trim();
  } else {
    // 'auto': baseado na cidade cadastrada do atleta, igual ao comportamento original.
    if (!city || !city.trim()) return [];
    const cityOnly = city.split(',')[0].split('-')[0].trim();
    const stateOnly = (city.split(',')[1] || city.split('-')[1] || '').trim();
    if (isRMC(cityOnly)) {
      stateParam = 'PR';
      postFilter = (c) => isRMC(c);
    } else {
      cityParam = cityOnly;
      stateParam = stateOnly;
    }
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const end = new Date(now.getTime() + days * 86400000);
  const endDate = end.toISOString().slice(0, 10);
  const url = `https://v2.api.corridaperfeita.com/race_calendar/all?name=&city=${encodeURIComponent(cityParam)}&state=${encodeURIComponent(stateParam)}&start_date=${today}&end_date=${endDate}&has_coupon=false&has_structure=false&skip=0`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data && data.data) ? data.data : [];
    let races = list
      .filter((r) => r && r.name && r.date)
      .map((r) => {
        const cityName = r.city || cityParam;
        return {
          id: r._id,
          name: r.name,
          date: r.date,
          distances: Array.isArray(r.distance) ? r.distance.filter((d) => typeof d === 'number').sort((a, b) => a - b) : [],
          city: cityName,
          state: r.state || stateParam || '',
          hasCoupon: !!r.coupons && r.coupons.length > 0,
          registrationUrl: registrationSearchUrl(r.name, cityName),
        };
      });

    if (postFilter) races = races.filter((r) => postFilter(r.city));

    return races
      .filter((r) => new Date(r.date) <= end)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, limit);
  } catch (err) {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { fetchNearbyRaces, REGION_LABELS, autoRegionLabel, isRMC, isLitoral };
