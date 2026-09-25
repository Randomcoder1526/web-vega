import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Portable module compilation: uses the locally installed TypeScript instead
// of a machine-specific global install, and builds the repo root with a
// Windows-safe path (new URL('..', ...).pathname mangles drive letters).
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src/lib/playback/sourceFallback.ts');

function loadModule() {
  const output = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-movie-extraction-'));
  const modulePath = path.join(out, 'sourceFallback.mjs');
  fs.writeFileSync(modulePath, output);
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
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
