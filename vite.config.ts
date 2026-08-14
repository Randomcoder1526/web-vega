import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'node:fs';
import https from 'https';
import http from 'http';
import { createGunzip, createInflate, createBrotliDecompress } from 'zlib';
import type { Plugin, Connect } from 'vite';

const PROVIDER_DATA_DIR = path.join(process.cwd(), 'server-providers');
const PROVIDER_FILES = ['posts', 'meta', 'stream', 'catalog', 'episodes'] as const;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function sanitizeName(input: string): string | null {
  if (!input) return null;
  const cleaned = input.replace(/[^A-Za-z0-9._-]/g, '_');
  if (cleaned.includes('..')) return null;
  return cleaned;
}

function collectJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function providerStoragePlugin(): Plugin {
  const register = (server: any) => {
    server.middlewares.use('/vega-server', async (req: http.IncomingMessage, res: http.ServerResponse) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url!, `http://${req.headers.host}`);
      const parts = url.pathname.split('/').filter(Boolean);

      if (parts[0] === 'installed' || parts[0] === 'sources') {
        const file = parts[0] === 'installed' ? 'installed.json' : 'sources.json';
        const filePath = path.join(PROVIDER_DATA_DIR, file);

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
          const body = await collectJsonBody(req);
          const payload = parts[0] === 'installed' ? body.installed : body.sources;
          if (!Array.isArray(payload)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Expected an array' }));
            return;
          }
          await fs.promises.mkdir(PROVIDER_DATA_DIR, { recursive: true });
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
          const body = await collectJsonBody(req);
          const author = sanitizeName(body.sourceAuthor || 'default');
          const value = sanitizeName(body.value);
          if (!value || !author) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid provider identifier' }));
            return;
          }
          const dir = path.join(PROVIDER_DATA_DIR, author, value);
          await fs.promises.mkdir(dir, { recursive: true });
          const modules = body.modules || {};
          for (const name of PROVIDER_FILES) {
            if (typeof modules[name] === 'string') {
              await fs.promises.writeFile(path.join(dir, `${name}.js`), modules[name], 'utf8');
            }
          }
          await fs.promises.writeFile(
            path.join(dir, 'meta.json'),
            JSON.stringify({
              value,
              sourceAuthor: author,
              version: body.version || '',
              cachedAt: Date.now(),
            }),
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
          const dir = path.join(PROVIDER_DATA_DIR, author, value);
          let metaRaw: string;
          try {
            metaRaw = await fs.promises.readFile(path.join(dir, 'meta.json'), 'utf8');
          } catch {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Provider not found on server' }));
            return;
          }
          const meta = JSON.parse(metaRaw);
          const modules: Record<string, string> = {};
          for (const name of PROVIDER_FILES) {
            try {
              modules[name] = await fs.promises.readFile(path.join(dir, `${name}.js`), 'utf8');
            } catch {
              /* optional file missing */
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            value: meta.value,
            sourceAuthor: meta.sourceAuthor,
            version: meta.version,
            cachedAt: meta.cachedAt,
            modules,
          }));
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
          const dir = path.join(PROVIDER_DATA_DIR, author, value);
          await fs.promises.rm(dir, { recursive: true, force: true });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
      } catch (error: any) {
        console.error('[vega-server] Error:', error?.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error?.message || 'Internal error' }));
      }
    });
  };

  return {
    name: 'provider-storage',
    configureServer(server) {
      register(server);
    },
    configurePreviewServer(server) {
      register(server);
    },
  };
}

const PROXY_SKIP_HEADERS = new Set([
  'host',
  'connection',
  'origin',
  'referer',
  'accept-encoding',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'sec-fetch-user',
  'cookie',
]);

const COOKIE_JAR_TTL = 30 * 60 * 1000;
const cookieJar: Map<string, { cookies: Record<string, string>; expiry: number }> = new Map();

function parseCookiesFromSetCookie(setCookieHeaders: string | string[] | undefined, domain: string): Record<string, string> {
  const result: Record<string, string> = {};
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

function getStoredCookies(targetUrl: string): string {
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

function storeCookies(targetUrl: string, setCookieHeaders: string | string[] | undefined): void {
  if (!setCookieHeaders) return;
  try {
    const parsed = new URL(targetUrl);
    const key = parsed.hostname;
    const existing = cookieJar.get(key);
    const existingCookies = existing && Date.now() <= existing.expiry ? existing.cookies : {};
    const newCookies = parseCookiesFromSetCookie(setCookieHeaders, key);
    const merged = { ...existingCookies, ...newCookies };
    cookieJar.set(key, { cookies: merged, expiry: Date.now() + COOKIE_JAR_TTL });
  } catch { /* ignore */ }
}

function cleanExpiredCookies(): void {
  const now = Date.now();
  for (const [key, entry] of cookieJar.entries()) {
    if (now > entry.expiry) cookieJar.delete(key);
  }
}

function gunzipBuffer(buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const streams = [createGunzip(), createInflate(), createBrotliDecompress()];
    let tried = 0;
    const tryNext = () => {
      if (tried >= streams.length) return resolve(buffer);
      const stream = streams[tried++];
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', tryNext);
      stream.end(buffer);
    };
    tryNext();
  });
}

function collectBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function singleRequest(targetUrl: string, method: string, headers: Record<string, string>, body?: Buffer): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const transport = parsed.protocol === 'https:' ? https : http;
    const reqHeaders: Record<string, string> = { ...headers };
    delete reqHeaders['accept-encoding'];

    const storedCookies = getStoredCookies(targetUrl);
    if (storedCookies) {
      reqHeaders['Cookie'] = storedCookies;
    }

    if (body && body.length > 0) {
      reqHeaders['content-length'] = body.length.toString();
    }

    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
        timeout: 30000,
      },
      (res) => {
        storeCookies(targetUrl, res.headers['set-cookie']);
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode || 500, headers: res.headers, body: Buffer.concat(chunks) }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body && body.length > 0) {
      req.write(body);
    }
    req.end();
  });
}

async function proxyRequest(targetUrl: string, method: string, headers: Record<string, string>, maxRedirects = 5, body?: Buffer): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  let currentUrl = targetUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    const result = await singleRequest(currentUrl, method, headers, i === 0 ? body : undefined);
    if ([301, 302, 303, 307, 308].includes(result.status) && result.headers.location) {
      const loc = result.headers.location;
      currentUrl = loc.startsWith('http') ? loc : new URL(loc, currentUrl).href;
      continue;
    }
    return result;
  }
  return { status: 310, headers: { 'content-type': 'text/plain' }, body: Buffer.from('Too many redirects') };
}

function corsProxyPlugin(): Plugin {
  return {
    name: 'cors-proxy',
    configureServer(server) {
      const handler: Connect.NextHandleFunction = async (req, res) => {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        const target = url.searchParams.get('url');

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Max-Age', '86400');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        if (!target) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing url parameter' }));
          return;
        }

        try {
          const reqBody = ['POST', 'PUT', 'PATCH'].includes(req.method || 'GET')
            ? await collectBody(req)
            : undefined;

          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            if (value && !PROXY_SKIP_HEADERS.has(key.toLowerCase())) {
              headers[key] = Array.isArray(value) ? value.join(', ') : value;
            }
          }

          const clientCookieHeader = req.headers['cookie'];
          if (clientCookieHeader) {
            try {
              const targetParsed = new URL(target);
              const clientCookies = parseCookiesFromSetCookie(
                [`dummy=${clientCookieHeader}`],
                '',
              );
              const stored = getStoredCookies(target);
              const storedObj: Record<string, string> = {};
              if (stored) {
                stored.split(';').forEach(pair => {
                  const [k, ...v] = pair.trim().split('=');
                  if (k) storedObj[k.trim()] = v.join('=').trim();
                });
              }
              const merged = { ...storedObj, ...clientCookies };
              const jarKey = targetParsed.hostname;
              cookieJar.set(jarKey, {
                cookies: merged,
                expiry: Date.now() + COOKIE_JAR_TTL,
              });
            } catch { /* ignore */ }
          }
          if (!headers['user-agent']) {
            headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
          }
          if (!headers['accept']) {
            headers['Accept'] = 'application/json, text/plain, */*';
          }
          if (!headers['accept-language']) {
            headers['Accept-Language'] = 'en-US,en;q=0.9';
          }
          headers['sec-ch-ua'] = '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"';
          headers['sec-ch-ua-mobile'] = '?0';
          headers['sec-ch-ua-platform'] = '"Windows"';
          headers['sec-fetch-dest'] = 'empty';
          headers['sec-fetch-mode'] = 'cors';
          headers['sec-fetch-site'] = 'cross-site';

          try {
            const targetParsed = new URL(target);
            headers['Origin'] = targetParsed.origin;
            headers['Referer'] = targetParsed.origin + '/';
          } catch { /* ignore */ }

          const { status, headers: upstreamHeaders, body: rawBody } = await proxyRequest(target, req.method || 'GET', headers, 5, reqBody);

          const upstreamSetCookie = upstreamHeaders['set-cookie'];
          if (upstreamSetCookie) {
            storeCookies(target, upstreamSetCookie);
          }

          let decoded = rawBody;
          const ce = upstreamHeaders['content-encoding'];
          if (ce === 'gzip' || ce === 'br' || ce === 'deflate') {
            try { decoded = await gunzipBuffer(rawBody); } catch { decoded = rawBody; }
          }

          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(upstreamHeaders)) {
            const lower = key.toLowerCase();
            if (lower === 'transfer-encoding' || lower === 'connection' || lower === 'content-encoding') continue;
            if (typeof value === 'string') responseHeaders[key] = value;
          }
          responseHeaders['Access-Control-Allow-Origin'] = '*';

          res.writeHead(status, responseHeaders);
          res.end(decoded);
        } catch (error: any) {
          console.error('[cors-proxy] Error:', error.message);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      };

      server.middlewares.use('/vega-proxy', handler);
    },
  };
}

export default defineConfig({
  plugins: [react(), corsProxyPlugin(), providerStoragePlugin()],
  resolve: {
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react-router-dom': path.resolve(__dirname, 'node_modules/react-router-dom'),
    },
  },
  server: {
    port: 3000,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
