// Assinatura Premium do Runiqx (R$ 19,90/mes) via Apple (StoreKit 2) e Google Play.
//
// IMPORTANTE: tudo aqui fica DORMENTE ate a variavel de ambiente
// BILLING_ENFORCE=1 ser ligada no Render. Enquanto estiver desligada, hasPremium()
// devolve true para todo mundo e nada muda para o usuario (nem para o revisor
// da Apple/Google). So ligue depois que o app 1.1 estiver aprovado nas duas lojas.
//
// Sem dependencias npm: a verificacao do JWS da Apple e o OAuth do Google usam node:crypto.
const crypto = require('node:crypto');
const https = require('node:https');
const db = require('../db');

const IOS_BUNDLE_ID = process.env.IOS_BUNDLE_ID || 'br.com.runiqx.app';
const ANDROID_PACKAGE = process.env.ANDROID_PACKAGE || 'br.com.runiqx.app';
const PRODUCT_IDS = (process.env.BILLING_PRODUCT_IDS || 'br.com.runiqx.app.premium.mensal').split(',').map((s) => s.trim()).filter(Boolean);

// Impressao digital SHA-256 do "Apple Root CA - G3" (a raiz da cadeia de assinatura do StoreKit 2).
// Pode ser trocada por APPLE_ROOT_FPR; a raiz em si vem de APPLE_ROOT_CA_PEM ou e baixada da Apple
// na primeira verificacao (e so e aceita se a impressao digital bater).
const APPLE_ROOT_FPR = (process.env.APPLE_ROOT_FPR
  || '63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79').toUpperCase();
const APPLE_ROOT_URL = 'https://www.apple.com/certificateauthority/AppleRootCA-G3.cer';

db.exec(`
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  product_id TEXT NOT NULL,
  original_id TEXT NOT NULL,
  expires_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  environment TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (platform, original_id)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
`);

function enforcing() { return process.env.BILLING_ENFORCE === '1'; }

function premiumEmails() {
  return String(process.env.PREMIUM_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function activeSubscription(userId) {
  return db.prepare(
    "SELECT * FROM subscriptions WHERE user_id = ? AND revoked = 0 AND expires_at IS NOT NULL AND expires_at > ? ORDER BY expires_at DESC LIMIT 1"
  ).get(userId, new Date().toISOString());
}

// true = pode usar os recursos de IA (Professor, Coach, Analise com IA).
function hasPremium(user) {
  if (!user) return false;
  if (!enforcing()) return true;
  if (user.is_admin) return true;
  if (premiumEmails().includes(String(user.email || '').toLowerCase())) return true;
  return !!activeSubscription(user.id);
}

function statusFor(user) {
  const sub = user ? activeSubscription(user.id) : null;
  return {
    enforcing: enforcing(),
    premium: hasPremium(user),
    expires_at: sub ? sub.expires_at : null,
    platform: sub ? sub.platform : null,
    product_ids: PRODUCT_IDS,
  };
}

function upsertSubscription(userId, s) {
  // Uma assinatura (original_id) pertence a um usuario so: se outra conta tentar
  // reaproveitar a mesma compra, a posse passa para quem restaurou por ultimo
  // (comportamento padrao de "Restaurar compras").
  db.prepare(`
    INSERT INTO subscriptions (user_id, platform, product_id, original_id, expires_at, revoked, environment, updated_at)
    VALUES (?,?,?,?,?,?,?, datetime('now'))
    ON CONFLICT (platform, original_id) DO UPDATE SET
      user_id = excluded.user_id, product_id = excluded.product_id, expires_at = excluded.expires_at,
      revoked = excluded.revoked, environment = excluded.environment, updated_at = datetime('now')
  `).run(userId, s.platform, s.productId, s.originalId, s.expiresAt, s.revoked ? 1 : 0, s.environment || null);
}

// ---------------------------------------------------------------- Apple (StoreKit 2)

let appleRoot = null;

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('http_' + r.statusCode)); }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject).setTimeout(15000, function () { this.destroy(new Error('timeout')); });
  });
}

async function getAppleRoot() {
  if (appleRoot) return appleRoot;
  let cert = null;
  if (process.env.APPLE_ROOT_CA_PEM) {
    cert = new crypto.X509Certificate(process.env.APPLE_ROOT_CA_PEM.replace(/\\n/g, '\n'));
  } else {
    cert = new crypto.X509Certificate(await fetchBuffer(APPLE_ROOT_URL));
  }
  if (cert.fingerprint256.toUpperCase() !== APPLE_ROOT_FPR) {
    console.error('billing: impressao digital da raiz da Apple nao confere:', cert.fingerprint256);
    throw new Error('apple_root_mismatch');
  }
  appleRoot = cert;
  return cert;
}

const OID_LEAF = Buffer.from('2a864886f76364060b01', 'hex');
const OID_INTERMEDIATE = Buffer.from('2a864886f76364060201', 'hex');
const b64u = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// Verifica um JWS assinado da Apple (transacao do StoreKit 2) e devolve o payload.
async function verifyAppleJws(jws) {
  const parts = String(jws || '').split('.');
  if (parts.length !== 3) throw new Error('bad_jws');
  const header = JSON.parse(b64u(parts[0]).toString('utf8'));
  if (header.alg !== 'ES256' || !Array.isArray(header.x5c) || header.x5c.length < 2) throw new Error('bad_header');
  const chain = header.x5c.map((c) => new crypto.X509Certificate(Buffer.from(c, 'base64')));
  const root = await getAppleRoot();
  const now = new Date();
  // chain[0]=folha, chain[1]=intermediaria, (chain[2]=raiz, se vier, e ignorada: usamos a nossa)
  for (const c of chain.slice(0, 2)) {
    if (now < new Date(c.validFrom) || now > new Date(c.validTo)) throw new Error('cert_expired');
  }
  // Alem da cadeia, a Apple exige que a folha tenha o OID de "recibo da App Store"
  // (1.2.840.113635.100.6.11.1) e a intermediaria o do WWDR (1.2.840.113635.100.6.2.1);
  // sem isso, qualquer certificado de desenvolvedor da Apple passaria.
  if (!chain[0].raw.includes(OID_LEAF) && !process.env.BILLING_SKIP_OID_CHECK) throw new Error('leaf_missing_receipt_oid');
  if (!chain[1].raw.includes(OID_INTERMEDIATE) && !process.env.BILLING_SKIP_OID_CHECK) throw new Error('intermediate_missing_wwdr_oid');
  if (!chain[0].verify(chain[1].publicKey)) throw new Error('leaf_not_signed_by_intermediate');
  if (!chain[1].verify(root.publicKey)) throw new Error('intermediate_not_signed_by_root');
  const ok = crypto.verify(
    'sha256',
    Buffer.from(parts[0] + '.' + parts[1]),
    { key: chain[0].publicKey, dsaEncoding: 'ieee-p1363' },
    b64u(parts[2])
  );
  if (!ok) throw new Error('bad_signature');
  return JSON.parse(b64u(parts[1]).toString('utf8'));
}

async function verifyAppleTransaction(userId, signedTransaction) {
  const tx = await verifyAppleJws(signedTransaction);
  if (tx.bundleId !== IOS_BUNDLE_ID) throw new Error('wrong_bundle');
  if (!PRODUCT_IDS.includes(tx.productId)) throw new Error('wrong_product');
  const originalId = String(tx.originalTransactionId || tx.transactionId || '');
  if (!originalId) throw new Error('no_transaction');
  const sub = {
    platform: 'ios',
    productId: tx.productId,
    originalId,
    expiresAt: tx.expiresDate ? new Date(Number(tx.expiresDate)).toISOString() : null,
    revoked: !!tx.revocationDate,
    environment: tx.environment || null,
  };
  upsertSubscription(userId, sub);
  return sub;
}

// ---------------------------------------------------------------- Google Play

let googleToken = { value: null, exp: 0 };

function httpsJson(method, host, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ method, host, path, headers }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch (e) { /* ignore */ }
        resolve({ status: r.statusCode, json, text });
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

function googleConfigured() { return !!process.env.GOOGLE_PLAY_SA_JSON; }

async function googleAccessToken() {
  if (googleToken.value && googleToken.exp > Date.now() + 60000) return googleToken.value;
  const sa = JSON.parse(process.env.GOOGLE_PLAY_SA_JSON);
  const nowS = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowS, exp: nowS + 3600,
  });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  const form = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + unsigned + '.' + sig;
  const r = await httpsJson('POST', 'oauth2.googleapis.com', '/token',
    { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(form) }, form);
  if (r.status !== 200 || !r.json || !r.json.access_token) throw new Error('google_oauth_failed');
  googleToken = { value: r.json.access_token, exp: Date.now() + (r.json.expires_in || 3600) * 1000 };
  return googleToken.value;
}

async function verifyGooglePurchase(userId, purchaseToken) {
  if (!googleConfigured()) throw new Error('google_not_configured');
  const token = await googleAccessToken();
  const r = await httpsJson('GET', 'androidpublisher.googleapis.com',
    `/androidpublisher/v3/applications/${encodeURIComponent(ANDROID_PACKAGE)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
    { authorization: 'Bearer ' + token });
  if (r.status !== 200 || !r.json) throw new Error('google_lookup_failed_' + r.status);
  const line = (r.json.lineItems || [])[0];
  if (!line || !PRODUCT_IDS.includes(line.productId)) throw new Error('wrong_product');
  const state = String(r.json.subscriptionState || '');
  // ACTIVE, IN_GRACE_PERIOD e CANCELED (cancelada mas paga ate o fim do periodo) dao acesso ate expirar.
  const alive = ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED'].includes(state);
  const sub = {
    platform: 'android',
    productId: line.productId,
    originalId: crypto.createHash('sha256').update(purchaseToken).digest('hex').slice(0, 40),
    expiresAt: line.expiryTime || null,
    revoked: !alive,
    environment: r.json.testPurchase ? 'Sandbox' : 'Production',
  };
  upsertSubscription(userId, sub);
  return sub;
}

module.exports = {
  enforcing, hasPremium, statusFor, upsertSubscription, activeSubscription,
  verifyAppleJws, verifyAppleTransaction, verifyGooglePurchase, googleConfigured,
  PRODUCT_IDS,
};
