function readBody(req, limitBytes) {
  const limit = limitBytes || 25 * 1024 * 1024; // 25MB default (GPX/TCX files)
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseUrlEncoded(buf) {
  const out = {};
  const str = buf.toString('utf8');
  for (const pair of str.split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    const k = decodeURIComponent((idx === -1 ? pair : pair.slice(0, idx)).replace(/\+/g, ' '));
    const v = idx === -1 ? '' : decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
    out[k] = v;
  }
  return out;
}

// Minimal multipart/form-data parser — good enough for our simple upload
// forms (a handful of text fields + one file). No npm dependency available.
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType || '');
  const boundary = m ? (m[1] || m[2]) : null;
  const fields = {};
  const files = {};
  if (!boundary) return { fields, files };

  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buf.indexOf(boundaryBuf);
  while (start !== -1) {
    const next = buf.indexOf(boundaryBuf, start + boundaryBuf.length);
    if (next === -1) break;
    parts.push(buf.slice(start + boundaryBuf.length, next));
    start = next;
  }

  for (let part of parts) {
    if (part.slice(0, 2).toString() === '--') continue;
    if (part.slice(0, 2).toString('utf8') === '\r\n') part = part.slice(2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerText = part.slice(0, headerEnd).toString('utf8');
    let body = part.slice(headerEnd + 4);
    if (body.slice(-2).toString() === '\r\n') body = body.slice(0, -2);

    const nameM = /name="([^"]+)"/.exec(headerText);
    if (!nameM) continue;
    const name = nameM[1];
    const filenameM = /filename="([^"]*)"/.exec(headerText);

    if (filenameM) {
      if (!filenameM[1]) continue; // empty file input
      const ctM = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
      files[name] = { filename: filenameM[1], contentType: ctM ? ctM[1] : 'application/octet-stream', data: body };
    } else {
      fields[name] = body.toString('utf8');
    }
  }
  return { fields, files };
}

function serializeCookie(name, value, opts) {
  opts = opts || {};
  let str = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
  if (opts.maxAge != null) str += `; Max-Age=${opts.maxAge}`;
  if (opts.expire) str += `; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  return str;
}

module.exports = { readBody, parseUrlEncoded, parseMultipart, serializeCookie };
