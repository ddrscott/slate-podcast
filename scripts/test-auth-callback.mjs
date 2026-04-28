// Generates an auth.ljs.app-format JWT with a test secret, then exercises
// /api/auth/callback to verify the integration. Requires the dev server
// to be running with JWT_SECRET=smoke-test-secret in .dev.vars.

const SECRET = process.env.SECRET ?? 'smoke-test-secret';
const BASE = process.env.BASE ?? 'http://localhost:4321';

async function generateToken({ email, userId, scopes = [] }) {
  const payload = {
    email,
    userId,
    scopes,
    gravatarHash: 'deadbeef',
    exp: Date.now() + 3600 * 1000,
    iat: Date.now(),
    iss: 'auth.ljs.app',
  };
  const data = JSON.stringify(payload);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const sigHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  return btoa(JSON.stringify({ data, sig: sigHex }));
}

const token = await generateToken({
  email: 'jacob+smoke@abolitionistsrising.test',
  userId: 'auth_lj_test_jacob',
});
console.log('token:', token.slice(0, 60) + '…');

const url = `${BASE}/api/auth/callback?next=${encodeURIComponent('/me')}&token=${encodeURIComponent(token)}`;
const res = await fetch(url, { redirect: 'manual' });
console.log('callback status:', res.status, '→', res.headers.get('location'));
console.log('cookie:', res.headers.get('set-cookie')?.slice(0, 80) + '…');

// Verify session works on /me with the cookie
const sessionCookie = res.headers.get('set-cookie')?.split(';')[0];
if (sessionCookie) {
  const me = await fetch(`${BASE}/me`, { headers: { cookie: sessionCookie } });
  const html = await me.text();
  console.log('GET /me with session:', me.status, '— email shown:',
    html.includes('jacob+smoke@abolitionistsrising.test') ? 'yes' : 'no');
}

// Negative: tampered token
const tampered = token.slice(0, -3) + 'AAA';
const bad = await fetch(`${BASE}/api/auth/callback?next=/me&token=${encodeURIComponent(tampered)}`, { redirect: 'manual' });
console.log('tampered token →', bad.status, bad.headers.get('location'));
