import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const source = path.join(root, 'src/lib/playback/sourceFallback.ts');

function loadModule() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-source-fallback-'));
  execFileSync('tsc', [source, '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'bundler', '--outDir', out, '--skipLibCheck'], { stdio: 'pipe' });
  return import(`${pathToFileURL(path.join(out, 'sourceFallback.js')).href}?t=${Date.now()}`);
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
