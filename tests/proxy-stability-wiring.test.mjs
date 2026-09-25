import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const readServer = () => fs.readFile(new URL('../server/index.mjs', import.meta.url), 'utf8');

test('server retries only idempotent upstream requests on transient failures', async () => {
  const server = await readServer();
  assert.match(server, /UPSTREAM_RETRY_STATUSES/);
  assert.match(server, /\["GET","HEAD"\]\.includes\(method\)/);
  assert.match(server, /fetchWithRetry/);
});

test('media proxy requests identity encoding and avoids stale compressed content lengths', async () => {
  const server = await readServer();
  assert.match(server, /accept-encoding["']\)\) h\.set\(["']accept-encoding["'],\s*["']identity["']/);
  assert.match(server, /contentEncoding/);
  assert.match(server, /key === ["']content-length["'] && contentEncoding/);
});

test('media proxy preserves the upstream base URL for proxied DASH manifests', async () => {
  const server = await readServer();
  assert.match(server, /function rewriteDashManifest/);
  assert.match(server, /<BaseURL>/);
  assert.match(server, /application\/dash\+xml/);
  assert.match(server, /\.mpd/);
});
