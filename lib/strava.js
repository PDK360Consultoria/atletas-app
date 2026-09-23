// Minimal Strava OAuth + API client using native fetch — no npm dependency.

const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

function isConfigured() {
    return !!(CLIENT_ID && CLIENT_SECRET);
}

function getAuthorizeUrl(redirectUri, state) {
    const params = new URLSearchParams({
          client_id: CLIENT_ID,
          redirect_uri: redirectUri,
          response_type: 'code',
          approval_prompt: 'auto',
          scope: 'read,activity:read_all',
          state,
    });
    return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code, redirectUri) {
    const res = await fetch('https://www.strava.com/oauth/token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
                  client_id: CLIENT_ID,
                  client_secret: CLIENT_SECRET,
                  code,
                  grant_type: 'authorization_code',
                  redirect_uri: redirectUri,
          }),
    });
    if (!res.ok) throw new Error(`Strava token exchange falhou (${res.status}): ${await res.text()}`);
    return res.json(); // { access_token, refresh_token, expires_at, athlete: {...} }
}

async function refreshAccessToken(refreshToken) {
    const res = await fetch('https://www.strava.com/oauth/token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
                  client_id: CLIENT_ID,
                  client_secret: CLIENT_SECRET,
                  refresh_token: refreshToken,
                  grant_type: 'refresh_token',
          }),
    });
    if (!res.ok) throw new Error(`Strava refresh falhou (${res.status}): ${await res.text()}`);
    return res.json(); // { access_token, refresh_token, expires_at }
}

// Ensures the user row has a valid (non-expired) access token, refreshing and
// persisting to the DB when needed. Returns the access token string, or null
// if the user isn't connected.
async function ensureValidToken(db, user) {
    if (!user.strava_refresh_token) return null;
    const now = Math.floor(Date.now() / 1000);
    if (user.strava_access_token && user.strava_token_expires_at && user.strava_token_expires_at > now + 60) {
          return user.strava_access_token;
    }
    const tok = await refreshAccessToken(user.strava_refresh_token);
    db.prepare('UPDATE users SET strava_access_token=?, strava_refresh_token=?, strava_token_expires_at=? WHERE id=?')
      .run(tok.access_token, tok.refresh_token, tok.expires_at, user.id);
    return tok.access_token;
}

// Fetches activities newer than `afterEpoch` (unix seconds), paginating as needed.
async function fetchActivities(accessToken, afterEpoch) {
    const all = [];
    let page = 1;
    for (;;) {
          const params = new URLSearchParams({ per_page: '100', page: String(page) });
          if (afterEpoch) params.set('after', String(afterEpoch));
          const res = await fetch(`https://www.strava.com/api/v3/athlete/activities?${params.toString()}`, {
                  headers: { authorization: `Bearer ${accessToken}` },
          });
          if (!res.ok) throw new Error(`Strava activities falhou (${res.status}): ${await res.text()}`);
          const batch = await res.json();
          all.push(...batch);
          if (batch.length < 100) break;
          page += 1;
          if (page > 20) break; // safety cap
    }
    return all;
}

module.exports = { isConfigured, getAuthorizeUrl, exchangeCodeForToken, refreshAccessToken, ensureValidToken, fetchActivities };
