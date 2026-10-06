// Leitor dentro do app: resolve o link do Google Notícias, baixa a matéria e
// extrai o texto principal (modo leitura), sempre com crédito e link original.
const dns = require('node:dns').promises;
const net = require('node:net');

const UA = 'Mozilla/5.0 (compatible; Runiqx-Reader/1.0)';
const cache = new Map(); // url -> { at, data }
const TTL_MS = 60 * 60 * 1000;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:');
}

async function assertPublic(urlStr) {
  const u = new URL(urlStr);
  if (!/^https?:$/.test(u.protocol)) throw new Error('protocolo');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('porta');
  const host = u.hostname;
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error('ip privado'); return u; }
  if (host === 'localhost' || !host.includes('.')) throw new Error('host');
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('ip privado');
  return u;
}

async function fetchSafe(urlStr, opts = {}) {
  let url = urlStr;
  for (let hop = 0; hop < 6; hop++) {
    await assertPublic(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeout || 8000);
    try {
      const res = await fetch(url, {
        method: opts.method || 'GET', body: opts.body,
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'pt-BR,pt;q=0.9', ...(opts.headers || {}) },
        redirect: 'manual', signal: controller.signal,
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location'), url).toString();
        continue;
      }
      return { res, url };
    } finally { clearTimeout(timeout); }
  }
  throw new Error('redirects');
}

async function readText(res, limit = 2.5 * 1024 * 1024) {
  const buf = Buffer.from(await res.arrayBuffer()).subarray(0, limit);
  let charset = ((res.headers.get('content-type') || '').match(/charset=([\w-]+)/i) || [])[1];
  if (!charset) charset = (buf.subarray(0, 4096).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  try { return new TextDecoder((charset || 'utf-8').toLowerCase()).decode(buf); } catch (e) { return buf.toString('utf8'); }
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&hellip;/g, '…').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&ldquo;|&rdquo;/g, '"').replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&amp;/g, '&');
}

// Google Notícias (2024+): o link do RSS não redireciona mais, é preciso pedir a URL real.
async function resolveGoogleNews(link) {
  const id = (new URL(link).pathname.match(/\/articles\/([^/?]+)/) || [])[1];
  if (!id) throw new Error('id');
  const first = await fetchSafe(`https://news.google.com/rss/articles/${id}?hl=pt-BR&gl=BR&ceid=BR:pt-419`);
  if (!/(^|\.)google\.com$/.test(new URL(first.url).hostname)) return first.url; // já redirecionou
  const html = await readText(first.res, 600 * 1024);
  const sg = (html.match(/data-n-a-sg="([^"]+)"/) || [])[1];
  const ts = (html.match(/data-n-a-ts="([^"]+)"/) || [])[1];
  if (!sg || !ts) throw new Error('sem assinatura');
  const inner = `["garturlreq",[["pt-419","BR",["FINANCE_TOP_INDICES","WEB_TEST_1_0_0"],null,null,1,1,"BR:pt-419",null,180,null,null,null,null,null,0,1],"pt-419","BR",1,[2,4,8],1,1,null,0,0,null,0],"${id}",${ts},"${sg}"]`;
  const freq = JSON.stringify([[['Fbv4je', inner, null, 'generic']]]);
  const r = await fetchSafe('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST', body: 'f.req=' + encodeURIComponent(freq),
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
  });
  const txt = await readText(r.res, 400 * 1024);
  const m = txt.match(/garturlres\\",\\"(https?:.*?)\\"/);
  if (!m) throw new Error('não decodificou');
  return m[1].replace(/\\+u0026/g, '&').replace(/\\+\//g, '/');
}

function meta(html, key) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
  const tag = re.exec(html);
  if (!tag) return '';
  const c = /content=["']([^"']*)["']/i.exec(tag[0]);
  return c ? decodeEntities(c[1]).trim() : '';
}

const JUNK = /^(leia (também|mais)|veja (também|mais)|compartilhe|publicidade|anúncio|continua após|siga-nos|inscreva-se|receba as notícias|todos os direitos|copyright|fonte:|assine|newsletter|clique aqui|ouça|assista)/i;

function extract(html) {
  let h = html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|iframe|form|nav|footer|header|aside|button|select|template)\b[\s\S]*?<\/\1>/gi, ' ');
  const arts = [...h.matchAll(/<article\b[\s\S]*?<\/article>/gi)].map((m) => m[0]);
  const scope = arts.length ? arts.sort((a, b) => b.length - a.length)[0] : ((h.match(/<body\b[\s\S]*<\/body>/i) || [h])[0]);
  const blocks = [];
  const re = /<(p|h2|h3|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(scope))) {
    const text = decodeEntities(m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!text || JUNK.test(text)) continue;
    const kind = m[1].toLowerCase();
    if (kind === 'p' || kind === 'blockquote') { if (text.length < 45) continue; }
    else if (text.length < 4 || text.length > 140) continue;
    if (blocks.length && blocks[blocks.length - 1].text === text) continue;
    blocks.push({ kind: kind === 'blockquote' ? 'q' : (kind === 'p' ? 'p' : 'h'), text });
  }
  const chars = blocks.filter((b) => b.kind === 'p').reduce((s, b) => s + b.text.length, 0);
  return { blocks, chars };
}

async function readArticle(googleLink) {
  const hit = cache.get(googleLink);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  let data;
  try {
    const u = new URL(googleLink);
    if (u.hostname !== 'news.google.com' || !u.pathname.startsWith('/rss/articles/')) throw new Error('link inválido');
    const realUrl = await resolveGoogleNews(googleLink);
    const page = await fetchSafe(realUrl);
    if (!page.res.ok) throw new Error('http ' + page.res.status);
    if (!/html/i.test(page.res.headers.get('content-type') || 'html')) throw new Error('não é html');
    const html = await readText(page.res);
    const { blocks, chars } = extract(html);
    const img = meta(html, 'og:image');
    data = {
      ok: chars >= 350,
      url: page.url,
      host: new URL(page.url).hostname.replace(/^www\./, ''),
      title: meta(html, 'og:title') || decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim(),
      site: meta(html, 'og:site_name'),
      image: /^https:\/\//i.test(img) ? img : '',
      blocks: blocks.slice(0, 60),
    };
  } catch (e) {
    data = { ok: false, error: String(e.message || e) };
  }
  cache.set(googleLink, { at: Date.now(), data });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return data;
}

module.exports = { readArticle, extract, isPrivateIp };
