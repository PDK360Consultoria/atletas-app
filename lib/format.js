function secToPace(sec) {
  if (sec == null || !Number.isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtClock(totalSec) {
  if (totalSec == null || !Number.isFinite(totalSec)) return '--:--';
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Parses "mm:ss" or "hh:mm:ss" into total seconds.
function parseClock(str) {
  if (!str) return null;
  const parts = String(str).trim().split(':').map((p) => parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Renders a small, safe subset of markdown (## headings, -/1. lists, **bold**)
// coming from AI-generated text into HTML. Escapes first, so the markdown
// syntax characters survive but any stray HTML in the model output cannot.
function renderMarkdownLite(raw) {
  if (!raw) return '';
  const escaped = esc(raw);
  const lines = escaped.split(/\r?\n/);
  let out = '';
  let inList = false;
  let paraBuf = [];

  const inlineFmt = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const flushPara = () => {
    if (paraBuf.length) { out += `<p>${paraBuf.join(' ')}</p>`; paraBuf = []; }
  };
  const closeList = () => { if (inList) { out += '</ul>'; inList = false; } };

  for (let line of lines) {
    line = line.trim();
    if (!line) { flushPara(); closeList(); continue; }

    const h = /^##\s+(.*)$/.exec(line);
    if (h) { flushPara(); closeList(); out += `<h3>${inlineFmt(h[1])}</h3>`; continue; }

    const li = /^[-*]\s+(.*)$/.exec(line) || /^\d+\.\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      if (!inList) { out += '<ul>'; inList = true; }
      out += `<li>${inlineFmt(li[1])}</li>`;
      continue;
    }

    closeList();
    paraBuf.push(inlineFmt(line));
  }
  flushPara();
  closeList();
  return out;
}

// Small "glossy 3D" icon set used for stat cards, section headers and the
// hero badge. Each icon is a tiny inline SVG with a gradient fill plus a
// baked-in shadow/highlight path to fake depth without any external asset —
// pure Node/browser, no icon library dependency. `uid` only needs to be
// unique when the same icon name is rendered more than once on a page
// (gradient ids are per-<svg>, but duplicate ids across sibling inline SVGs
// can misbehave in some browsers).
function icon(name, uid) {
  const g = `ic-${name}-${uid || '0'}`;
  const defs = `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="var(--accent)"/><stop offset="100%" stop-color="var(--accent-2)"/></linearGradient></defs>`;
  const paths = {
    shoe: `<path d="M2.5 16.2c0-1.1.9-1.9 1.9-2 .7-2.9 3.6-6.7 6.8-6.7.9 0 1.7.5 2.5 1.2l4.6 2.1c1.4.6 2.7 1.9 2.7 3.6v1.1c0 1.3-1 2.3-2.3 2.3H4.3c-1 0-1.8-.8-1.8-1.6z" fill="url(#${g})"/><path d="M8 12.4c1.1-2.1 3.1-3.9 5.3-4.2" stroke="#15171A" stroke-width=".7" fill="none" opacity=".3" stroke-linecap="round"/><path d="M16.5 13.4c1.6.2 3 .9 3.9 1.9" stroke="#15171A" stroke-width=".6" fill="none" opacity=".22" stroke-linecap="round"/>`,
    stopwatch: `<circle cx="12" cy="13.5" r="7.2" fill="url(#${g})"/><circle cx="12" cy="13.5" r="7.2" fill="none" stroke="#15171A" stroke-opacity=".12" stroke-width="1"/><path d="M12 9.3v4.2l3 1.9" stroke="#15171A" stroke-width="1.3" fill="none" opacity=".38" stroke-linecap="round" stroke-linejoin="round"/><rect x="9.7" y="1.8" width="4.6" height="2.1" rx="1" fill="url(#${g})"/><rect x="16.3" y="3.4" width="2.6" height="1.7" rx=".8" fill="url(#${g})" transform="rotate(38 17.6 4.2)"/>`,
    flame: `<path d="M12.4 2.2c1 2.9-2.7 4.3-2.7 7.7a2.9 2.9 0 0 0 5.8.2c0-.9-.6-1.7-.6-2.6 2 1.3 3.8 4 3.8 6.8a6.2 6.2 0 0 1-12.4 0c0-5.1 3.4-7.6 6.1-12.1z" fill="url(#${g})"/><path d="M11 16.3a2.2 2.2 0 0 0 2.6-1.6" stroke="#15171A" stroke-width=".7" fill="none" opacity=".3" stroke-linecap="round"/>`,
    trophy: `<path d="M6.7 3.6h10.6v4.3a5.3 5.3 0 0 1-10.6 0V3.6z" fill="url(#${g})"/><path d="M6.7 4.8H4a3.1 3.1 0 0 0 3.1 5.2M17.3 4.8H20a3.1 3.1 0 0 1-3.2 5.2" stroke="url(#${g})" stroke-width="1.5" fill="none" stroke-linecap="round"/><rect x="10" y="13.2" width="4" height="3.2" fill="url(#${g})"/><rect x="6.6" y="17.6" width="10.8" height="2.6" rx="1.1" fill="url(#${g})"/><path d="M9.5 7.4c.4 1.2 1.3 2 2.5 2.2" stroke="#15171A" stroke-width=".6" fill="none" opacity=".28" stroke-linecap="round"/>`,
    calendar: `<rect x="3" y="4.6" width="18" height="16.4" rx="3.2" fill="url(#${g})"/><path d="M3 4.6h18v4.2H3z" fill="#15171A" opacity=".16"/><rect x="6.7" y="1.6" width="2.1" height="5.2" rx="1" fill="url(#${g})"/><rect x="15.2" y="1.6" width="2.1" height="5.2" rx="1" fill="url(#${g})"/><rect x="6.5" y="12" width="3.4" height="3.2" rx=".8" fill="#15171A" opacity=".2"/>`,
    mountain: `<path d="M2.6 19.4 9.4 7.6l3.6 5.7 2-2.8 6.4 8.9H2.6z" fill="url(#${g})"/><path d="M9.4 7.6 13 13.3l-2.1 3.1-3.7-5z" fill="#15171A" opacity=".18"/><circle cx="17.4" cy="6.4" r="1.9" fill="url(#${g})"/>`,
    pin: `<path d="M12 22s7.2-7.4 7.2-13.2a7.2 7.2 0 1 0-14.4 0C4.8 14.6 12 22 12 22z" fill="url(#${g})"/><circle cx="12" cy="8.7" r="2.7" fill="#15171A" opacity=".32"/>`,
    heart: `<path d="M12 20.1s-7.3-4.5-9.7-9.2C.7 7.7 1.8 3.5 6 3.5c2.4 0 3.8 1.5 6 4.1 2.2-2.6 3.6-4.1 6-4.1 4.2 0 5.3 4.2 3.7 7.4-2.4 4.7-9.7 9.2-9.7 9.2z" fill="url(#${g})"/><path d="M7 6.6c1.4.2 2.5 1 3.4 2.3" stroke="#15171A" stroke-width=".6" fill="none" opacity=".24" stroke-linecap="round"/>`,
    bell: `<path d="M12 2.5a1.6 1.6 0 0 1 1.6 1.6v.6c2.8.7 4.9 3.2 4.9 6.4v3.1l1.7 2.5c.4.5 0 1.3-.6 1.3H4.4c-.6 0-1-.8-.6-1.3l1.7-2.5V11c0-3.1 2.1-5.7 4.9-6.4v-.6A1.6 1.6 0 0 1 12 2.5z" fill="url(#${g})"/><path d="M9.3 19.4a2.7 2.7 0 0 0 5.4 0z" fill="url(#${g})"/><path d="M8.6 6.7c-.9.9-1.5 2.1-1.6 3.4" stroke="#15171A" stroke-width=".6" fill="none" opacity=".26" stroke-linecap="round"/>`,
    chat: `<path d="M12 3.2c5 0 9 3.2 9 7.1 0 3.9-4 7.1-9 7.1-1 0-2-.1-2.9-.4L4.5 19l1.1-3.6C4.2 13.9 3 12.2 3 10.3c0-3.9 4-7.1 9-7.1z" fill="url(#${g})"/><circle cx="8.3" cy="10.3" r="1" fill="#15171A" opacity=".35"/><circle cx="12" cy="10.3" r="1" fill="#15171A" opacity=".35"/><circle cx="15.7" cy="10.3" r="1" fill="#15171A" opacity=".35"/>`,
  };
  return `<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">${defs}${paths[name] || ''}</svg>`;
}

module.exports = { secToPace, fmtClock, fmtDate, esc, parseClock, renderMarkdownLite, icon };
