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
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-movie-extraction-'));
  execFileSync('tsc', [source, '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'bundler', '--outDir', out, '--skipLibCheck'], { stdio: 'pipe' });
  return import(`${pathToFileURL(path.join(out, 'sourceFallback.js')).href}?t=${Date.now()}`);
}

test('movie extraction queue starts with the selected link then includes every unique direct-link mirror', async () => {
  const { buildMovieExtractionQueue } = await loadModule();
  const selected = { title: 'Movie', link: 'https://nexdrive/selected', type: 'movie' };
  const groups = [
    {
      title: '1080p',
      directLinks: [
        { title: 'Movie', link: 'https://nexdrive/selected', type: 'movie' },
        { title: 'Mirror B', link: 'https://hub/b', type: 'movie' },
      ],
    },
    {
      title: '720p',
      directLinks: [
        { title: 'Mirror B duplicate', link: 'https://hub/b', type: 'movie' },
        { title: 'Mirror C', link: 'https://hub/c', type: 'movie' },
      ],
    },
  ];

  const queue = buildMovieExtractionQueue(groups, selected);
  assert.deepEqual(queue.map((item) => item.link), [
    'https://nexdrive/selected',
    'https://hub/b',
    'https://hub/c',
  ]);
});

test('MetaPage expands movie playback candidates from all filtered direct-link groups before navigation', () => {
  const meta = fs.readFileSync(new URL('../src/pages/MetaPage.tsx', import.meta.url), 'utf8');
  assert.match(meta, /buildMovieExtractionQueue/);
  assert.match(meta, /type\s*===\s*["']movie["']/);
  assert.match(meta, /episodeList:\s*playbackItems/);
});
