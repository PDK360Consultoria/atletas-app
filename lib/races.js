// Busca próximas corridas de rua perto da cidade do atleta usando a API
// pública da Corrida Perfeita (não requer autenticação). Chamada direta via
// fetch nativo — sem SDK/pacote, seguindo o mesmo padrão já usado para o
// Strava e a Anthropic.
async function fetchNearbyRaces(city, days = 60) {
  if (!city || !city.trim()) return [];

const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const end = new Date(now.getTime() + days * 86400000);
  const endDate = end.toISOString().slice(0, 10);
  const cityOnly = city.split(',')[0].split('-')[0].trim();
  const url = `https://v2.api.corridaperfeita.com/race_calendar/all?name=&city=${encodeURIComponent(cityOnly)}&state=&start_date=${today}&end_date=${endDate}&has_coupon=false&has_structure=false&skip=0`;

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
  return list
  .filter((r) => r && r.name && r.date)
  .map((r) => ({
    id: r._id,
    name: r.name,
    date: r.date,
    distances: Array.isArray(r.distance) ? r.distance.filter((d) => typeof d === 'number').sort((a, b) => a - b) : [],
    city: r.city || cityOnly,
    state: r.state || '',
    hasCoupon: !!r.coupons && r.coupons.length > 0,
  }))
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
