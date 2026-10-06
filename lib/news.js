// Notícias de corrida: agrega manchetes do Google Notícias (RSS público) por
// categoria. Mostramos só título, fonte, data e o link para a matéria original.
const CATS = {
  noticias: { label: 'Notícias', q: 'corrida de rua OR maratona OR "meia maratona" when:7d' },
  treino: { label: 'Treino', q: '"treino de corrida" OR "dicas de corrida" OR "plano de treino" corrida when:30d' },
  tenis: { label: 'Tênis', q: '"tênis de corrida" OR "tênis para corrida" when:30d' },
  saude: { label: 'Saúde', q: 'corredor saúde OR "nutrição para corrida" OR "lesão na corrida" when:30d' },
  provas: { label: 'Provas', q: '"corrida de rua" inscrições OR "calendário de corridas" OR "maratona de" when:30d' },
};
const CAT_KEYS = Object.keys(CATS);

const cache = new Map(); // cat -> { at, items }
const TTL_MS = 20 * 60 * 1000;

function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&amp;/g, '&');
}
function tag(block, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? decodeEntities(m[1]).trim() : '';
}

function parseRss(xml) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    let title = tag(block, 'title');
    const link = tag(block, 'link');
    const date = new Date(tag(block, 'pubDate'));
    let source = tag(block, 'source');
    if (!source) { const i = title.lastIndexOf(' - '); if (i > 0) source = title.slice(i + 3); }
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    if (!title || !/^https?:\/\//i.test(link) || Number.isNaN(date.getTime())) continue;
    out.push({ title: title.replace(/<[^>]+>/g, '').trim(), link, source: source.replace(/<[^>]+>/g, '').trim(), ts: date.getTime() });
  }
  return out;
}

async function fetchCat(cat) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(CATS[cat].q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(url, { headers: { accept: 'application/rss+xml, application/xml, text/xml', 'user-agent': 'Mozilla/5.0 (compatible; Runiqx/1.0)' }, signal: controller.signal });
    if (!res.ok) return null;
    return parseRss(await res.text());
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').slice(0, 70);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

async function getCat(cat) {
  const hit = cache.get(cat);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items;
  const items = await fetchCat(cat);
  if (items) {
    const list = dedupe(items.sort((a, b) => b.ts - a.ts)).slice(0, 30).map((i) => ({ ...i, cat }));
    cache.set(cat, { at: Date.now(), items: list });
    return list;
  }
  return hit ? hit.items : null; // falha: usa o cache antigo, se houver
}

// cat: 'todas' ou uma das chaves. Retorna { items, ok }.
async function getNews(cat) {
  if (CATS[cat]) {
    const items = await getCat(cat);
    return { items: items || [], ok: !!items };
  }
  const lists = await Promise.all(CAT_KEYS.map((k) => getCat(k)));
  const ok = lists.some(Boolean);
  const merged = dedupe([].concat(...lists.filter(Boolean)).sort((a, b) => b.ts - a.ts)).slice(0, 36);
  return { items: merged, ok };
}

module.exports = { getNews, parseRss, CATS, CAT_KEYS };
