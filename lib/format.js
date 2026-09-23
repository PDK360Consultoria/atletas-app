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

module.exports = { secToPace, fmtClock, fmtDate, esc, parseClock, renderMarkdownLite };
