import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const source = await readFile(new URL('../../src/lib/errors/errorReporter.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;

const dir = await mkdtemp(path.join(os.tmpdir(), 'vega-error-reporter-'));
try {
  const modulePath = path.join(dir, 'errorReporter.mjs');
  await writeFile(modulePath, output);
  const reporter = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);

  const issue = { scope: 'stream', category: 'forbidden', status: 403, message: 'HTTP 403 Forbidden' };
  assert.equal(reporter.shouldEmitIssue(issue, 1_000, 8_000), true, 'first diagnostic should be emitted');
  assert.equal(reporter.shouldEmitIssue(issue, 1_100, 8_000), false, 'duplicate diagnostic inside window should be suppressed');
  assert.equal(reporter.shouldEmitIssue(issue, 10_000, 8_000), true, 'same diagnostic should be allowed after dedupe window');

  const blockedHostIssue = { scope: 'stream', category: 'forbidden', status: 403, message: 'https://vcloud.fit/one 403', dedupeKey: 'vega:vcloud.fit' };
  assert.equal(reporter.shouldEmitIssue(blockedHostIssue, 20_000, 60_000), true, 'first host-grouped diagnostic should emit');
  assert.equal(reporter.shouldEmitIssue({ scope: 'other', category: 'network', message: 'temporary failure' }, 30_000, 8_000), true, 'unrelated diagnostic should emit');
  assert.equal(reporter.shouldEmitIssue({ ...blockedHostIssue, message: 'https://vcloud.fit/two 403' }, 31_000, 60_000), false, 'short-window diagnostics must not evict a longer host-level dedupe entry');

  const sanitized = reporter.sanitizeDiagnosticMessage('https://example.test/video?token=secret123&quality=1080p');
  assert.match(sanitized, /token=<redacted>/, 'sensitive token must be redacted');
  assert.doesNotMatch(sanitized, /secret123/, 'sensitive token value must not leak');

  let warningCount = 0;
  const originalWarn = console.warn;
  console.warn = () => { warningCount += 1; };
  try {
    reporter.reportHandledIssue({ scope: 'stream-test', category: 'forbidden', userMessage: 'Host rejected request', error: new Error('HTTP 403') });
    reporter.reportHandledIssue({ scope: 'stream-test', category: 'forbidden', userMessage: 'Host rejected request', error: new Error('HTTP 403') });
    assert.equal(warningCount, 1, 'handled failures should only log once inside the dedupe window');

    reporter.reportHandledIssue({ scope: 'host-test', category: 'forbidden', userMessage: 'Host rejected request', error: new Error('https://vcloud.fit/one 403'), dedupeKey: 'vega:vcloud.fit', dedupeWindowMs: 60_000 });
    reporter.reportHandledIssue({ scope: 'host-test', category: 'forbidden', userMessage: 'Host rejected request', error: new Error('https://vcloud.fit/two 403'), dedupeKey: 'vega:vcloud.fit', dedupeWindowMs: 60_000 });
    assert.equal(warningCount, 2, 'different blocked URLs on the same host should collapse to one host diagnostic');
  } finally {
    console.warn = originalWarn;
  }

  console.log('error reporter behavior tests passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}
