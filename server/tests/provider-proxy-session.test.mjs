import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const upstreamPort = 4291;
const proxyPort = 4292;

const upstream = http.createServer((req, res) => {
  if (req.url === '/slow') {
    return setTimeout(() => { res.statusCode = 200; res.end('slow-ok'); }, 600);
  }
  if (req.url === '/redirect-start') {
    res.statusCode = 302;
    res.setHeader('Set-Cookie', 'redirect_token=ok; Path=/; HttpOnly');
    res.setHeader('Location', '/redirect-protected');
    return res.end();
  }
  if (req.url === '/redirect-protected') {
    const hasCookie = /(?:^|;\s*)redirect_token=ok(?:;|$)/.test(req.headers.cookie || '');
    const browserUa = /^Mozilla\//.test(req.headers['user-agent'] || '');
    res.statusCode = hasCookie && browserUa ? 200 : 403;
    return res.end(hasCookie && browserUa ? 'redirect-ok' : `cookie=${hasCookie};ua=${browserUa};rawua=${req.headers['user-agent'] || ''}`);
  }
  if (req.url === '/seed') {
    res.statusCode = 200;
    res.setHeader('Set-Cookie', 'session_token=abc; Path=/; HttpOnly');
    return res.end('seeded');
  }
  if (req.url === '/session-protected' || req.url === '/media-protected') {
    const hasCookie = /(?:^|;\s*)session_token=abc(?:;|$)/.test(req.headers.cookie || '');
    res.statusCode = hasCookie ? 200 : 403;
    res.setHeader('Content-Type', req.url === '/media-protected' ? 'video/mp4' : 'text/plain');
    return res.end(hasCookie ? (req.url === '/media-protected' ? 'media-ok' : 'session-ok') : 'missing-session');
  }
  res.statusCode = 404;
  res.end('not found');
});
upstream.listen(upstreamPort, '127.0.0.1');
await once(upstream, 'listening');

const child = spawn(process.execPath, ['server/index.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: String(proxyPort), ALLOW_PRIVATE_PROXY: 'true', UPSTREAM_HEADER_TIMEOUT_MS: '120' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('proxy server startup timeout')), 5000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('Vega Web listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('exit', (code) => reject(new Error(`proxy server exited early: ${code}`)));
  });

  const callProxy = async (target, cookie = '') => fetch(`http://127.0.0.1:${proxyPort}/api/proxy`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 TestBrowser',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ url: target, method: 'GET', headers: {}, redirect: 'follow' }),
  });

  const redirectResponse = await callProxy(`http://127.0.0.1:${upstreamPort}/redirect-start`);
  const redirectPayload = await redirectResponse.json();
  assert.equal(redirectPayload.status, 200, `redirect cookie + browser UA must survive: ${Buffer.from(redirectPayload.dataBase64 || '', 'base64').toString('utf8')}`);

  const seedResponse = await callProxy(`http://127.0.0.1:${upstreamPort}/seed`);
  const setCookie = seedResponse.headers.get('set-cookie') || '';
  const sessionMatch = /vega_proxy_session=([^;]+)/.exec(setCookie);
  assert.ok(sessionMatch, 'proxy must set an isolated browser-session cookie');
  const browserSessionCookie = `vega_proxy_session=${sessionMatch[1]}`;

  const protectedResponse = await callProxy(`http://127.0.0.1:${upstreamPort}/session-protected`, browserSessionCookie);
  const protectedPayload = await protectedResponse.json();
  assert.equal(protectedPayload.status, 200, 'upstream cookies must persist across provider requests for the same browser session');

  const mediaResponse = await fetch(`http://127.0.0.1:${proxyPort}/api/media?url=${encodeURIComponent(`http://127.0.0.1:${upstreamPort}/media-protected`)}`, {
    headers: { cookie: browserSessionCookie, 'user-agent': 'Mozilla/5.0 TestBrowser' },
  });
  assert.equal(mediaResponse.status, 200, 'media proxy must reuse the same isolated upstream cookie jar');
  assert.equal(await mediaResponse.text(), 'media-ok');

  const otherBrowserResponse = await callProxy(`http://127.0.0.1:${upstreamPort}/session-protected`);
  const otherBrowserPayload = await otherBrowserResponse.json();
  assert.equal(otherBrowserPayload.status, 403, 'upstream cookies must not leak to a different browser session');

  const slowResponse = await callProxy(`http://127.0.0.1:${upstreamPort}/slow`, browserSessionCookie);
  assert.equal(slowResponse.status, 502, 'provider proxy must bound the upstream header wait');
  const slowPayload = await slowResponse.json();
  assert.match(String(slowPayload.error || ''), /timeout/i);

  console.log('provider proxy session tests passed');
} finally {
  child.kill('SIGTERM');
  upstream.close();
}
