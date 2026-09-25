import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = new URL('../', import.meta.url);

async function loadCompatibilityModule() {
  const source = await readFile(new URL('src/lib/providers/providerCompatibility.ts', root), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vega-provider-compat-'));
  const modulePath = path.join(dir, 'providerCompatibility.mjs');
  await writeFile(modulePath, output);
  const mod = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
  return { mod, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('provider compatibility normalizes common stream variants without losing upstream metadata', async () => {
  const { mod, cleanup } = await loadCompatibilityModule();
  try {
    const input = {
      streams: [
        {
          name: ' Mirror A ',
          url: ' https://cdn.example/video/master.m3u8 ',
          quality: '1080p',
          tag: 'HDR',
          tags: ['DV'],
          headers: new Headers({ Referer: 'https://source.example/' }),
          subtitles: [{ label: 'English', language: 'en', url: 'https://cdn.example/sub.vtt' }],
        },
        {
          server: 'Duplicate',
          link: 'https://cdn.example/video/master.m3u8',
          type: 'm3u8',
          quality: '1080',
        },
        {
          server: 'Auto HLS',
          link: 'https://cdn.example/auto.m3u8',
          quality: 'auto',
        },
      ],
    };

    const streams = mod.normalizeStreamResult(input);
    assert.equal(streams.length, 2, 'duplicate URLs should collapse');
    assert.deepEqual(streams[0], {
      server: 'Mirror A',
      link: 'https://cdn.example/video/master.m3u8',
      type: 'm3u8',
      quality: '1080',
      tag: 'HDR',
      tags: ['DV'],
      headers: { referer: 'https://source.example/' },
      subtitles: [{ title: 'English', language: 'en', type: 'text/vtt', uri: 'https://cdn.example/sub.vtt' }],
    });
    assert.equal(streams[1].quality, 'auto');
    assert.equal(streams[1].type, 'm3u8');

    const dash = mod.normalizeStreamResult([{ server: 'DASH', link: 'https://cdn.example/manifest.mpd', type: 'DASH' }]);
    assert.equal(dash[0].type, 'mpd');
  } finally {
    await cleanup();
  }
});

test('provider compatibility accepts common post, catalog, episode and metadata aliases', async () => {
  const { mod, cleanup } = await loadCompatibilityModule();
  try {
    assert.deepEqual(mod.normalizePostResult([{ name: 'Movie', url: '/movie', poster: '/poster.jpg', tag: 'NEW' }]), [
      { title: 'Movie', link: '/movie', image: '/poster.jpg', tag: 'NEW' },
    ]);
    assert.deepEqual(mod.normalizeCatalogResult([{ name: 'Popular', value: '/popular' }]), [
      { title: 'Popular', filter: '/popular' },
    ]);
    assert.deepEqual(mod.normalizeEpisodeResult([{ name: 'Episode 1', url: '/ep-1' }]), [
      { title: 'Episode 1', link: '/ep-1' },
    ]);

    const info = mod.normalizeInfoResult({
      name: 'Movie',
      poster: '/poster.jpg',
      description: 'Plot',
      contentType: 'movie',
      imdb: 'tt123',
      links: [{ name: '1080p', quality: '1080p', directLinks: [{ name: 'Play', url: '/play' }] }],
    });
    assert.equal(info.title, 'Movie');
    assert.equal(info.image, '/poster.jpg');
    assert.equal(info.synopsis, 'Plot');
    assert.equal(info.type, 'movie');
    assert.equal(info.imdbId, 'tt123');
    assert.equal(info.linkList[0].quality, '1080');
    assert.equal(info.linkList[0].directLinks[0].link, '/play');
  } finally {
    await cleanup();
  }
});

test('web playback ordering prefers browser-native streaming formats over mkv and torrent', async () => {
  const { mod, cleanup } = await loadCompatibilityModule();
  try {
    const ordered = mod.sortStreamsForWebPlayback([
      { server: 'Torrent', link: 'magnet:?xt=urn:btih:abc', type: 'torrent' },
      { server: 'MKV', link: 'https://cdn.example/movie.mkv', type: 'mkv' },
      { server: 'MP4', link: 'https://cdn.example/movie.mp4', type: 'mp4' },
      { server: 'DASH', link: 'https://cdn.example/movie.mpd', type: 'mpd' },
      { server: 'HLS', link: 'https://cdn.example/movie.m3u8', type: 'm3u8' },
      { server: 'WebM', link: 'https://cdn.example/movie.webm', type: 'webm' },
    ]);
    assert.deepEqual(ordered.map((stream) => stream.server), [
      'HLS',
      'DASH',
      'MP4',
      'WebM',
      'MKV',
      'Torrent',
    ]);
  } finally {
    await cleanup();
  }
});
