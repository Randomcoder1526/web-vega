import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const source = path.join(root, 'src/lib/playback/playbackErrors.ts');

function loadPolicy() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-playback-errors-'));
  execFileSync('tsc', [source, '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'bundler', '--outDir', out, '--skipLibCheck'], { stdio: 'pipe' });
  const built = path.join(out, 'playbackErrors.js');
  return import(`${pathToFileURL(built).href}?t=${Date.now()}`);
}

test('classifies provider/http/player failures and assigns bounded retry policy', async () => {
  const { classifyPlaybackError, shouldRetryPlaybackFailure } = await loadPolicy();

  const cases = [
    ['HTTP 403 Forbidden WAF detected', 'forbidden', false],
    ['Request failed with status code 404', 'not_found', false],
    ['HTTP 410 Gone', 'not_found', false],
    ['HTTP 429 Too Many Requests', 'rate_limited', true],
    ['HTTP 503 Service Unavailable', 'server', true],
    ['ETIMEDOUT upstream request timeout', 'timeout', true],
    ['hls networkError: fragLoadError', 'hls_network', true],
    ['hls mediaError: fragParsingError', 'hls_media', false],
    ['MEDIA_ERR_DECODE decode failed', 'decode', false],
    ['MEDIA_ERR_SRC_NOT_SUPPORTED', 'unsupported', false],
    ['Failed to fetch network error', 'network', true],
  ];

  for (const [message, category, firstRetry] of cases) {
    const failure = classifyPlaybackError(new Error(message));
    assert.equal(failure.category, category, message);
    assert.equal(shouldRetryPlaybackFailure(failure, 0), firstRetry, `retry policy for ${message}`);
  }

  const structuredDecode = classifyPlaybackError({ message: 'browser rejected media', category: 'decode' });
  assert.equal(structuredDecode.category, 'decode');
  assert.equal(structuredDecode.retryable, false);

  const forbidden = classifyPlaybackError(new Error('403 Cloudflare challenge'));
  assert.equal(forbidden.hostBlocked, true);
  assert.equal(forbidden.retryable, false);
  assert.match(forbidden.userMessage, /blocked|rejected/i);

  const transient = classifyPlaybackError(new Error('HTTP 503'));
  assert.equal(shouldRetryPlaybackFailure(transient, 1), false, 'transient errors get at most one automatic retry');

  const aborted = classifyPlaybackError(new DOMException('aborted', 'AbortError'));
  assert.equal(aborted.category, 'aborted');
  assert.equal(shouldRetryPlaybackFailure(aborted, 0), false);
});
