'use strict';
// Push notifications for the iOS/Android shell, sent through Firebase Cloud
// Messaging (HTTP v1). FCM delivers to Android directly and to iOS through the
// APNs key that is uploaded to the Firebase project. Everything here is a
// no-op until FCM_SERVICE_ACCOUNT (the service-account JSON, as one env var)
// is configured, so the web app keeps working without it.
const crypto = require('node:crypto');
const https = require('node:https');

let cfg = null;
try { cfg = process.env.FCM_SERVICE_ACCOUNT ? JSON.parse(process.env.FCM_SERVICE_ACCOUNT) : null; } catch (e) { cfg = null; }

let cached = { token: null, exp: 0 };

function b64(o) { return Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url'); }

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('error', reject);
    r.setTimeout(10000, () => r.destroy(new Error('timeout')));
    if (body) r.write(body);
    r.end();
  });
}

async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const claim = b64({ iss: cfg.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(cfg.private_key).toString('base64url');
  const form = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${head}.${claim}.${sig}`;
  const r = await request({ method: 'POST', hostname: 'oauth2.googleapis.com', path: '/token', headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(form) } }, form);
  const j = JSON.parse(r.body);
  if (!j.access_token) throw new Error('fcm_auth_failed');
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

function isConfigured() { return !!(cfg && cfg.client_email && cfg.private_key && cfg.project_id); }

// Sends one notification to every device the athlete registered. Never throws.
async function sendToUser(db, userId, { title, body, url }) {
  if (!isConfigured() || !userId) return;
  try {
    const rows = db.prepare('SELECT id, token FROM push_tokens WHERE user_id = ?').all(userId);
    if (!rows.length) return;
    const at = await accessToken();
    for (const row of rows) {
      const payload = JSON.stringify({ message: { token: row.token, notification: { title: title || 'Runiqx', body: body || '' }, data: { url: url || '/' } } });
      const r = await request({ method: 'POST', hostname: 'fcm.googleapis.com', path: `/v1/projects/${cfg.project_id}/messages:send`,
        headers: { authorization: `Bearer ${at}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, payload);
      // Dead token (app uninstalled): drop it.
      if (r.status === 404 || r.status === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(r.body)) {
        db.prepare('DELETE FROM push_tokens WHERE id = ?').run(row.id);
      }
    }
  } catch (e) { console.error('push error', e.message); }
}

module.exports = { isConfigured, sendToUser };
