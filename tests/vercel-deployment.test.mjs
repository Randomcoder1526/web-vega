import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('vercel config builds Vite output, routes API through one function, and falls back SPA routes', async () => {
  const raw = await fs.readFile(path.join(ROOT, 'vercel.json'), 'utf8');
  const config = JSON.parse(raw);

  assert.equal(config.framework, 'vite');
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.functions?.['api/index.mjs']?.maxDuration, 300);

  assert.ok(Array.isArray(config.routes), 'vercel.json should define routes');
  assert.deepEqual(config.routes[0], { src: '^/api/(.*)$', dest: '/api?path=$1' });
  assert.deepEqual(config.routes[1], { handle: 'filesystem' });
  assert.deepEqual(config.routes.at(-1), { src: '^/.*$', dest: '/index.html' });
});

test('Vercel API entry maps rewritten health requests to the shared API handler', async () => {
  const apiModule = await import(pathToFileURL(path.join(ROOT, 'api/index.mjs')).href);
  assert.equal(typeof apiModule.default, 'function');

  const req = {
    method: 'GET',
    url: '/api?path=health',
    headers: { host: 'example.vercel.app', 'x-forwarded-proto': 'https' },
    async *[Symbol.asyncIterator]() {},
  };

  const headers = new Map();
  let statusCode = 200;
  let body = Buffer.alloc(0);
  const res = {
    get statusCode() { return statusCode; },
    set statusCode(value) { statusCode = value; },
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    writeHead(status, values = {}) {
      statusCode = status;
      for (const [key, value] of Object.entries(values)) this.setHeader(key, value);
      return this;
    },
    end(value) {
      if (value != null) body = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
      return this;
    },
  };

  await apiModule.default(req, res);

  assert.equal(statusCode, 200);
  assert.deepEqual(JSON.parse(body.toString('utf8')), { ok: true, runtime: 'vega-web' });
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
});

test('Vercel API proxy accepts Vercel parsed request.body objects', async () => {
  const apiModule = await import(pathToFileURL(path.join(ROOT, 'api/index.mjs')).href);
  const req = {
    method: 'POST',
    url: '/api?path=proxy',
    headers: { host: 'example.vercel.app', 'content-type': 'application/json' },
    body: { url: 'not-a-valid-url', method: 'GET' },
    async *[Symbol.asyncIterator]() {},
  };

  const headers = new Map();
  let statusCode = 200;
  let body = Buffer.alloc(0);
  const res = {
    get statusCode() { return statusCode; },
    set statusCode(value) { statusCode = value; },
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    writeHead(status, values = {}) {
      statusCode = status;
      for (const [key, value] of Object.entries(values)) this.setHeader(key, value);
      return this;
    },
    end(value) {
      if (value != null) body = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
      return this;
    },
  };

  await apiModule.default(req, res);
  const payload = JSON.parse(body.toString('utf8'));

  assert.equal(statusCode, 502);
  assert.match(payload.error, /Invalid URL/);
});
