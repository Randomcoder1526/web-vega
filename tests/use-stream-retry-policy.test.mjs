import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/lib/hooks/useStream.ts', import.meta.url), 'utf8');

test('stream extraction uses the shared playback retry policy and exposes normalized failure', () => {
  assert.match(source, /classifyPlaybackError/);
  assert.match(source, /shouldRetryPlaybackFailure/);
  assert.match(source, /retry:\s*\(failureCount,\s*error\)\s*=>\s*shouldRetryPlaybackFailure\(/);
  assert.match(source, /failure:\s*streamFailure/);
  assert.match(source, /retryCurrentExtraction/);
});
