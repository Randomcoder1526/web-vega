import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

test('download listeners initialize from an effect instead of during App render', () => {
  const app = read('src/App.tsx');
  const componentStart = app.indexOf('export default function App()');
  const firstEffect = app.indexOf('useEffect(', componentStart);
  const renderPrelude = app.slice(componentStart, firstEffect);
  assert.doesNotMatch(renderPrelude, /initDownloadListeners\(\)/);
  assert.match(app, /useEffect\(\(\)\s*=>\s*\{[\s\S]*?initDownloadListeners\(\)/);
});

test('provider stream extraction has a bounded timeout for primary and fallback requests', () => {
  const source = read('src/lib/hooks/useStream.ts');
  assert.match(source, /PROVIDER_STREAM_TIMEOUT_MS\s*=\s*30_?000/);
  assert.match(source, /withProviderStreamTimeout/);
  const uses = source.match(/withProviderStreamTimeout\(/g) || [];
  assert.ok(uses.length >= 2, 'both stream queries should use the timeout helper');
});

test('stream failover does not report a successful mirror switch as a network outage', () => {
  const source = read('src/lib/hooks/useStream.ts');
  assert.doesNotMatch(source, /Network error: No network connection available/);
});

test('useStream options use explicit episode and route types instead of any', () => {
  const source = read('src/lib/hooks/useStream.ts');
  const match = source.match(/interface UseStreamOptions\s*\{[\s\S]*?\n\}/);
  assert.ok(match, 'UseStreamOptions should exist');
  assert.doesNotMatch(match[0], /activeEpisode:\s*any/);
  assert.doesNotMatch(match[0], /routeParams:\s*any/);
  assert.match(source, /interface StreamEpisode/);
  assert.match(source, /interface StreamRouteParams/);
});

test('fallback audio selection accepts missing stream arrays safely', () => {
  const source = read('src/lib/playback/sourceFallback.ts');
  assert.match(source, /findFallbackAudioStream[\s\S]*streams:\s*T\[\]\s*\|\s*null\s*\|\s*undefined/);
  assert.match(source, /if\s*\(!streams\?\.length\)\s*return null/);
});

test('verbose stream diagnostics are development-only', () => {
  const source = read('src/lib/hooks/useStream.ts');
  assert.doesNotMatch(source, /^\s*console\.log\("Fetching stream for:/m);
  assert.doesNotMatch(source, /^\s*console\.log\("Processing video tracks:/m);
  assert.match(source, /import\.meta\.env\.DEV/);
});

test('download start refreshes item state after changing queued to downloading', () => {
  const source = read('src/lib/zustand/downloadStore.ts');
  const fnStart = source.indexOf('const startDownloadItem = async');
  const fnEnd = source.indexOf('const scheduleDownloads', fnStart);
  const fn = source.slice(fnStart, fnEnd);
  assert.match(fn, /let item = get\(\)\.downloads\[id\]/);
  assert.match(fn, /item = get\(\)\.downloads\[id\]/);
});

test('prefixed storage clearing snapshots keys before removing them', () => {
  const source = read('src/platform/storage.ts');
  const start = source.indexOf('clearAll(): void');
  const end = source.indexOf('// Create and export default instances', start);
  const fn = source.slice(start, end);
  assert.match(fn, /Object\.keys\(localStorage\)|Array\.from\(/);
  assert.match(fn, /keysToRemove/);
});

test('provider timeout is classified separately from user/query cancellation', () => {
  const source = read('src/lib/hooks/useStream.ts');
  assert.match(source, /let timedOut = false/);
  assert.match(source, /timedOut = true/);
  assert.match(source, /timeoutError\.category\s*=\s*["']timeout["']/);
});

test('provider stream calls always pass a concrete media type to ProviderManager', () => {
  const source = read('src/lib/hooks/useStream.ts');
  assert.match(source, /const getProviderContentType\s*=|function getProviderContentType/);
  assert.match(source, /return routeParams\?\.type\?\.trim\(\) \|\| ["']movie["']/);
  const unsafeCalls = source.match(/type:\s*routeParams\?\.type/g) || [];
  assert.equal(unsafeCalls.length, 0, 'optional route type must be normalized before provider calls');
  const normalizedCalls = source.match(/type:\s*providerContentType/g) || [];
  assert.ok(normalizedCalls.length >= 2, 'primary and fallback extraction should use normalized media type');
});
