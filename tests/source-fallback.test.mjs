import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src/lib/playback/sourceFallback.ts');

function loadModule() {
  const output = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-source-fallback-'));
  const modulePath = path.join(out, 'sourceFallback.mjs');
  fs.writeFileSync(modulePath, output);
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

test('stream fallback skips current, duplicate, empty and already attempted candidates', async () => {
  const { streamCandidateKey, findNextUntriedStream } = await loadModule();
  const streams = [
    { server: 'A', link: 'https://cdn/a.m3u8', type: 'm3u8', quality: '1080' },
    { server: 'A duplicate', link: 'https://cdn/a.m3u8', type: 'm3u8', quality: '720' },
    { server: 'B', link: '', type: 'mp4' },
    { server: 'C', link: 'https://cdn/c.mp4', type: 'mp4', quality: '720' },
    { server: 'D', link: 'https://cdn/d.mp4', type: 'mp4', quality: '480' },
  ];
  const attempted = new Set([streamCandidateKey(streams[0]), streamCandidateKey(streams[3])]);
  const next = findNextUntriedStream(streams, streams[0], attempted);
  assert.equal(next?.link, 'https://cdn/d.mp4');
});

test('movie mirror fallback uses a different untried link but never advances series episodes', async () => {
  const { findNextMovieMirror } = await loadModule();
  const episodes = [
    { title: 'Movie Mirror 1', link: 'https://mirror/one' },
    { title: 'Movie Mirror 2', link: 'https://mirror/two' },
    { title: 'Movie Mirror 3', link: 'https://mirror/three' },
  ];
  const attempted = new Set(['https://mirror/one', 'https://mirror/two']);
  const movie = findNextMovieMirror(episodes, 0, attempted, 'movie');
  assert.equal(movie?.index, 2);
  assert.equal(movie?.episode.link, 'https://mirror/three');
  assert.equal(findNextMovieMirror(episodes, 0, new Set(), 'series'), null);
});

test('audio fallback prefers a 480p browser-playable stream below the selected high quality source', async () => {
  const { findFallbackAudioStream } = await loadModule();
  const streams = [
    { server: '4K', link: 'https://cdn/2160.mp4', type: 'mp4', quality: '2160' },
    { server: '1080', link: 'https://cdn/1080.mp4', type: 'mp4', quality: '1080' },
    { server: '720', link: 'https://cdn/720.mp4', type: 'mp4', quality: '720' },
    { server: '480', link: 'https://cdn/480.mp4', type: 'mp4', quality: '480' },
  ];
  const fallback = findFallbackAudioStream(streams, streams[0]);
  assert.equal(fallback?.link, 'https://cdn/480.mp4');
});

test('audio fallback is disabled for low quality selections and ignores non-http candidates', async () => {
  const { findFallbackAudioStream } = await loadModule();
  const streams = [
    { server: '1080', link: 'https://cdn/1080.mp4', type: 'mp4', quality: '1080' },
    { server: 'torrent', link: 'magnet:?xt=urn:btih:abc', type: 'torrent', quality: '480' },
    { server: '480', link: 'https://cdn/480.mp4', type: 'mp4', quality: '480' },
  ];
  assert.equal(findFallbackAudioStream(streams, streams[2]), null);
  assert.equal(findFallbackAudioStream(streams.slice(0, 2), streams[0]), null);
});

test('movie extraction queue preserves quality group metadata for fallback-audio resolution', async () => {
  const { buildMovieExtractionQueue } = await loadModule();
  const selected = { title: 'Movie', link: 'https://provider/4k' };
  const groups = [
    { title: '4K MULTI', quality: '4K', directLinks: [selected] },
    { title: '1080p MULTI', quality: '1080p', directLinks: [{ title: 'Movie', link: 'https://provider/1080' }] },
    { title: '480p MULTI', quality: '480p', directLinks: [{ title: 'Movie', link: 'https://provider/480' }] },
  ];

  const queue = buildMovieExtractionQueue(groups, selected);
  assert.equal(queue[0]?.link, 'https://provider/4k');
  assert.equal(queue[0]?.quality, '2160');
  assert.equal(queue.find((item) => item.link === 'https://provider/1080')?.quality, '1080');
  assert.equal(queue.find((item) => item.link === 'https://provider/480')?.quality, '480');
});

test('quality parser accepts provider labels such as 4K, 1080p and mixed titles', async () => {
  const { parseQualityHeight } = await loadModule();
  assert.equal(parseQualityHeight('4K'), 2160);
  assert.equal(parseQualityHeight('2160p HEVC'), 2160);
  assert.equal(parseQualityHeight('1080p MULTI'), 1080);
  assert.equal(parseQualityHeight('480p'), 480);
  assert.equal(parseQualityHeight(undefined), null);
});
