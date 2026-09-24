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

async function fetchNearbyRaces(city, days = 60) {
  if (!city || !city.trim()) return [];

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const end = new Date(now.getTime() + days * 86400000);
  const endDate = end.toISOString().slice(0, 10);
  const cityOnly = city.split(',')[0].split('-')[0].trim();
  const stateOnly = (city.split(',')[1] || city.split('-')[1] || '').trim();

  const broadenToMetroRegion = isRMC(cityOnly);
  const cityParam = broadenToMetroRegion ? '' : cityOnly;
  const stateParam = broadenToMetroRegion ? 'PR' : stateOnly;
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
      .map((r) => ({
        id: r._id,
        name: r.name,
        date: r.date,
        distances: Array.isArray(r.distance) ? r.distance.filter((d) => typeof d === 'number').sort((a, b) => a - b) : [],
        city: r.city || cityOnly,
        state: r.state || '',
        hasCoupon: !!r.coupons && r.coupons.length > 0,
      }));

    if (broadenToMetroRegion) {
      races = races.filter((r) => isRMC(r.city));
    }

    return races
      .filter((r) => new Date(r.date) <= end)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 12);
  } catch (err) {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { fetchNearbyRaces };
