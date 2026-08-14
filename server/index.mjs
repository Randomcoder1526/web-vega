import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const DATA_DIR = path.join(ROOT, 'server-providers');
const PORT = process.env.PORT || 3000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_PROXY_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 30000;

const PROXY_SKIP_HEADERS = new Set([
  'host', 'connection', 'origin', 'referer', 'accept-encoding',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user',
  'cookie',
]);

const COOKIE_JAR_TTL = 30 * 60 * 1000;
const cookieJar = new Map();

function parseCookiesFromSetCookie(setCookieHeaders) {
  const result = {};
  if (!setCookieHeaders) return result;
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const header of headers) {
    const parts = header.split(';')[0]?.trim();
    if (!parts) continue;
    const eqIdx = parts.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = parts.substring(0, eqIdx).trim();
    const value = parts.substring(eqIdx + 1).trim();
    if (name) result[name] = value;
  }
  return result;
}

function getStoredCookies(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const key = parsed.hostname;
    const entry = cookieJar.get(key);
    if (!entry || Date.now() > entry.expiry) {
      if (entry) cookieJar.delete(key);
      return '';
    }
    return Object.entries(entry.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  } catch {
    return '';
  }
}

function storeCookies(targetUrl, setCookieHeaders) {
  if (!setCookieHeaders) return;
  try {
    const parsed = new URL(targetUrl);
    const key = parsed.hostname;
    const existing = cookieJar.get(key);
    const existingCookies = existing && Date.now() <= existing.expiry ? existing.cookies : {};
    const newCookies = parseCookiesFromSetCookie(setCookieHeaders);
    const merged = { ...existingCookies, ...newCookies };
    cookieJar.set(key, { cookies: merged, expiry: Date.now() + COOKIE_JAR_TTL });
  } catch { /* ignore */ }
}

function cleanExpiredCookies() {
  const now = Date.now();
  for (const [key, entry] of cookieJar.entries()) {
    if (now > entry.expiry) cookieJar.delete(key);
  }
}

setInterval(cleanExpiredCookies, 5 * 60 * 1000);

const PROVIDER_FILES = ['posts', 'meta', 'stream', 'catalog', 'episodes'];



function isPrivateIPv4(address) {
  const parts = String(address).split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function assertSafeTarget(targetUrl) {
  let parsed;
  try { parsed = new URL(targetUrl); } catch { throw new Error('Invalid target URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP(S) targets are allowed');
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1' || hostname.endsWith('.local')) {
    throw new Error('Target host is not allowed');
  }
  if (isPrivateIPv4(hostname)) throw new Error('Private network targets are not allowed');
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (records.some((r) => r.family === 4 && isPrivateIPv4(r.address))) {
      throw new Error('Target resolves to a private network address');
    }
    if (records.some((r) => r.family === 6 && (r.address === '::1' || r.address.toLowerCase().startsWith('fc') || r.address.toLowerCase().startsWith('fd')))) {
      throw new Error('Target resolves to a private network address');
    }
  } catch (error) {
    if (error?.message?.includes('private network') || error?.message?.includes('not allowed')) throw error;
    // DNS errors are handled by the upstream request so providers can report a useful failure.
  }
  return parsed;
}

function sanitizeName(input) {
  if (!input) return null;
  const cleaned = input.replace(/[^A-Za-z0-9._-]/g, '_');
  if (cleaned.includes('..')) return null;
  return cleaned;
}

/* ----------------------------- CORS proxy ----------------------------- */
function gunzipBuffer(buffer) {
  return new Promise((resolve) => {
    const streams = [createGunzip(), createInflate(), createBrotliDecompress()];
    let tried = 0;
    const tryNext = () => {
      if (tried >= streams.length) return resolve(buffer);
      const stream = streams[tried++];
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', tryNext);
      stream.end(buffer);
    };
    tryNext();
  });
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}


function singleRequest(targetUrl, method, headers, body, { stream = false, range = null } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const transport = parsed.protocol === 'https:' ? https : http;
    const reqHeaders = { ...headers };
    delete reqHeaders['accept-encoding'];
    if (range) reqHeaders.Range = range;

    const storedCookies = getStoredCookies(targetUrl);
    if (storedCookies && !reqHeaders.Cookie) reqHeaders.Cookie = storedCookies;
    if (body && body.length > 0) reqHeaders['content-length'] = body.length.toString();

    const req = transport.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: reqHeaders,
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      storeCookies(targetUrl, res.headers['set-cookie']);
      if (stream) return resolve({ status: res.statusCode || 500, headers: res.headers, stream: res });
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_PROXY_RESPONSE_BYTES) {
          res.destroy(new Error('Upstream response exceeded proxy limit'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode || 500, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Upstream request timed out')); });
    if (body && body.length > 0) req.write(body);
    req.end();
  });
}

async function proxyRequest(targetUrl, method, headers, maxRedirects = MAX_REDIRECTS, body, options = {}) {
  let currentUrl = targetUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertSafeTarget(currentUrl);
    const result = await singleRequest(currentUrl, method, headers, i === 0 ? body : undefined, options);
    if ([301, 302, 303, 307, 308].includes(result.status) && result.headers.location) {
      currentUrl = new URL(result.headers.location, currentUrl).href;
      continue;
    }
    return { ...result, finalUrl: currentUrl };
  }
  return { status: 310, headers: { 'content-type': 'text/plain' }, body: Buffer.from('Too many redirects') };
}

function applyCors(res, methods = 'GET, POST, PUT, DELETE, OPTIONS, PATCH') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified, Location');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function copySafeResponseHeaders(upstreamHeaders, res, { streaming = false } = {}) {
  const skip = new Set(['connection', 'transfer-encoding', 'content-encoding', 'set-cookie']);
  for (const [key, value] of Object.entries(upstreamHeaders || {})) {
    if (skip.has(key.toLowerCase()) || value == null) continue;
    try { res.setHeader(key, value); } catch { /* ignore invalid upstream header */ }
  }
  if (streaming) res.setHeader('Cache-Control', 'no-store');
}

async function buildTargetHeaders(req, target, { stream = false } = {}) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (value && !PROXY_SKIP_HEADERS.has(lower) && lower !== 'range') {
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  if (!headers['user-agent']) headers['User-Agent'] = 'Mozilla/5.0';
  if (!headers['accept']) headers.Accept = stream ? '*/*' : 'application/json, text/plain, */*';
  if (!headers['accept-language']) headers['Accept-Language'] = 'en-US,en;q=0.9';
  if (!stream) {
    const parsed = new URL(target);
    headers.Origin = parsed.origin;
    headers.Referer = `${parsed.origin}/`;
  }
  return headers;
}

async function handleProxy(req, res, url) {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const target = url.searchParams.get('url');
  if (!target) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing url parameter', code: 'INVALID_REQUEST' }));
    return;
  }

  try {
    await assertSafeTarget(target);
    const reqBody = ['POST', 'PUT', 'PATCH'].includes(req.method || 'GET') ? await collectBody(req) : undefined;
    const headers = await buildTargetHeaders(req, target);
    const result = await proxyRequest(target, req.method || 'GET', headers, MAX_REDIRECTS, reqBody);

    let decoded = result.body || Buffer.alloc(0);
    const ce = result.headers?.['content-encoding'];
    if (ce === 'gzip' || ce === 'br' || ce === 'deflate') {
      try { decoded = await gunzipBuffer(decoded); } catch { /* preserve raw response */ }
    }
    const responseHeaders = {};
    copySafeResponseHeaders(result.headers, { setHeader: (k, v) => { responseHeaders[k] = v; } });
    responseHeaders['Access-Control-Allow-Origin'] = '*';
    responseHeaders['Content-Length'] = String(decoded.length);
    res.writeHead(result.status, responseHeaders);
    res.end(decoded);
  } catch (error) {
    console.error('[vega-proxy] error:', error?.message || error);
    const status = error?.message === 'Invalid target URL' || error?.message?.includes('not allowed') ? 400 : 502;
    if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error?.message || 'Proxy request failed', code: 'PROXY_ERROR' }));
  }
}

async function handleStreamProxy(req, res, url) {
  applyCors(res, 'GET, HEAD, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  const target = url.searchParams.get('url');
  if (!target) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing url parameter', code: 'INVALID_REQUEST' }));
    return;
  }

  try {
    await assertSafeTarget(target);
    const headers = await buildTargetHeaders(req, target, { stream: true });
    const requestedReferer = url.searchParams.get('referer');
    if (requestedReferer) {
      try {
        const refererUrl = new URL(requestedReferer);
        if (['http:', 'https:'].includes(refererUrl.protocol)) {
          headers.Referer = refererUrl.href;
          headers.Origin = refererUrl.origin;
        }
      } catch { /* ignore invalid referer */ }
    }
    const range = req.headers.range;
    const result = await proxyRequest(target, req.method, headers, MAX_REDIRECTS, undefined, { stream: true, range });
    copySafeResponseHeaders(result.headers, res, { streaming: true });
    if (result.headers?.['accept-ranges']) res.setHeader('Accept-Ranges', result.headers['accept-ranges']);
    if (result.headers?.['content-range']) res.setHeader('Content-Range', result.headers['content-range']);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(result.status);
    if (req.method === 'HEAD') { result.stream.resume(); res.end(); return; }
    result.stream.on('error', (error) => {
      console.error('[vega-stream] upstream stream error:', error?.message || error);
      if (!res.headersSent) res.writeHead(502);
      else res.destroy(error);
    });
    result.stream.pipe(res);
  } catch (error) {
    console.error('[vega-stream] error:', error?.message || error);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error?.message || 'Stream proxy failed', code: 'STREAM_PROXY_ERROR' }));
  }
}

async function handleHealth(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ ok: true, service: 'vega-server', time: new Date().toISOString() }));
}

/* --------------------------- Provider storage --------------------------- */
function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { req.destroy(); resolve({}); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

async function handleStorage(req, res, url) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parts = url.pathname.replace('/vega-server', '').split('/').filter(Boolean); // ['installed'|'provider', ...]

  if (parts[0] === 'installed' || parts[0] === 'sources') {
    const file = parts[0] === 'installed' ? 'installed.json' : 'sources.json';
    const filePath = path.join(DATA_DIR, file);

    if (req.method === 'GET') {
      try {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(raw);
      } catch {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
      return;
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const payload = parts[0] === 'installed' ? body.installed : body.sources;
      if (!Array.isArray(payload)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Expected an array' }));
        return;
      }
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      await fs.promises.writeFile(filePath, JSON.stringify(payload), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  if (parts[0] !== 'provider') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  try {
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const author = sanitizeName(body.sourceAuthor || 'default');
      const value = sanitizeName(body.value);
      if (!value || !author) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid provider identifier' }));
        return;
      }
      const dir = path.join(DATA_DIR, author, value);
      await fs.promises.mkdir(dir, { recursive: true });
      const modules = body.modules || {};
      for (const name of PROVIDER_FILES) {
        if (typeof modules[name] === 'string') {
          await fs.promises.writeFile(path.join(dir, `${name}.js`), modules[name], 'utf8');
        }
      }
      await fs.promises.writeFile(
        path.join(dir, 'meta.json'),
        JSON.stringify({ value, sourceAuthor: author, version: body.version || '', cachedAt: Date.now() }),
        'utf8',
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'GET') {
      const author = sanitizeName(parts[1] || 'default');
      const value = sanitizeName(parts[2]);
      if (!value || !author) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid provider identifier' }));
        return;
      }
      const dir = path.join(DATA_DIR, author, value);
      let metaRaw;
      try {
        metaRaw = await fs.promises.readFile(path.join(dir, 'meta.json'), 'utf8');
      } catch {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Provider not found on server' }));
        return;
      }
      const meta = JSON.parse(metaRaw);
      const modules = {};
      for (const name of PROVIDER_FILES) {
        try { modules[name] = await fs.promises.readFile(path.join(dir, `${name}.js`), 'utf8'); }
        catch { /* optional file missing */ }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ value: meta.value, sourceAuthor: meta.sourceAuthor, version: meta.version, cachedAt: meta.cachedAt, modules }));
      return;
    }

    if (req.method === 'DELETE') {
      const author = sanitizeName(parts[1] || 'default');
      const value = sanitizeName(parts[2]);
      if (!value || !author) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid provider identifier' }));
        return;
      }
      await fs.promises.rm(path.join(DATA_DIR, author, value), { recursive: true, force: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
  } catch (error) {
    console.error('[vega-storage] error:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: error.message || 'Internal error' }));
  }
}

/* ----------------------------- Static host ----------------------------- */
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.map': 'application/json', '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, urlPath) {
  let filePath = decodeURIComponent(urlPath);
  if (filePath === '/' || filePath === '') filePath = '/index.html';
  const resolved = path.join(DIST_DIR, path.normalize(filePath));
  if (!resolved.startsWith(DIST_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback
      const fallback = path.join(DIST_DIR, 'index.html');
      fs.readFile(fallback, (e2, data) => {
        if (e2) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
      });
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(resolved).pipe(res);
  });
}

/* ------------------------------- Server -------------------------------- */
process.on('uncaughtException', (err) => {
  console.error('[vega-server] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[vega-server] unhandledRejection:', reason);
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/vega-health') return await handleHealth(req, res);
    if (url.pathname.startsWith('/vega-stream')) return await handleStreamProxy(req, res, url);
    if (url.pathname.startsWith('/vega-proxy')) return await handleProxy(req, res, url);
    if (url.pathname.startsWith('/vega-server')) return await handleStorage(req, res, url);
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error('[vega-server] request error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[vega-server] listening on http://localhost:${PORT} (network: http://0.0.0.0:${PORT})`);
  console.log(`[vega-server] provider data dir: ${DATA_DIR}`);
});
