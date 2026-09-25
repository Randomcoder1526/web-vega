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
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function loadSourceFallback() {
  const source = path.join(root, 'src/lib/playback/sourceFallback.ts');
  const output = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-source-labels-'));
  const modulePath = path.join(out, 'sourceFallback.mjs');
  fs.writeFileSync(modulePath, output);
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

test('movie extraction queue keeps the info-page source name for player source switching', async () => {
  const { buildMovieExtractionQueue } = await loadSourceFallback();
  const selected = { title: 'Movie', link: 'https://cdn.example/1080' };
  const groups = [
    { title: '1080p • HubCloud', quality: '1080p', directLinks: [selected] },
    { title: '480p • GDrive', quality: '480p', directLinks: [{ title: '', link: 'https://cdn.example/480' }] },
  ];
  const queue = buildMovieExtractionQueue(groups, selected);
  assert.equal(queue[0]?.sourceName, '1080p • HubCloud');
  assert.equal(queue[1]?.sourceName, '480p • GDrive');
});

test('source labels never render blank when provider titles are empty', async () => {
  const { getSourceDisplayName } = await loadSourceFallback();
  assert.equal(getSourceDisplayName({ title: '  ', quality: '1080p' }, 0), '1080p');
  assert.equal(
    getSourceDisplayName({ title: '', directLinks: [{ link: 'https://hub.example/file' }] }, 1),
    'hub.example',
  );
  assert.equal(getSourceDisplayName({}, 2), 'Source 3');
});

test('info page source selector renders the active label explicitly while closed', () => {
  const selector = read('src/components/content/SeasonSelector.tsx');
  assert.match(selector, /getSourceDisplayName/);
  assert.match(selector, /<Select\.Value[^>]*>\s*\{activeIndex[\s\S]*getSourceDisplayName/);
});

test('player exposes a separate source menu in addition to extracted server selection', () => {
  const controls = read('src/pages/PlayerControls.tsx');
  const player = read('src/pages/PlayerPage.tsx');
  assert.match(controls, /SourceIcon/);
  assert.match(controls, /openMenu === ["']source["']/);
  const toggleMenuSignature = controls.match(/const toggleMenu = \([\s\S]*?\) =>/);
  assert.ok(toggleMenuSignature, 'toggleMenu signature should exist');
  assert.match(toggleMenuSignature[0], /["']source["']/);
  assert.match(controls, /sourceData\?/);
  assert.match(controls, /onSelectSource\?/);
  assert.match(player, /switchPlaybackSource/);
  assert.match(player, /providerManager\.getEpisodes/);
  assert.match(player, /sourceGroups/);
});

test('removed desktop update download cache and VLC settings stay out of settings UI', () => {
  const settings = [
    read('src/pages/SettingsPage.tsx'),
    read('src/components/settings/PreferencesSettings.tsx'),
    read('src/components/settings/PlayerSettings.tsx'),
    read('src/pages/PlayerPage.tsx'),
    read('src/pages/PlayerControls.tsx'),
    read('src/pages/PlayerInitError.tsx'),
  ].join('\n');
  for (const removed of [
    'Check for Updates',
    'Clear App Cache',
    'Auto Install App Updates',
    'Auto Check for Updates',
    'Download Directory',
    'Concurrent Downloads',
    'Hardware Acceleration',
    'VLC Player',
    'Open in VLC',
    'Opening VLC',
  ]) {
    assert.doesNotMatch(settings, new RegExp(removed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('downloads/offline library is removed from navigation and diagnostic logs remain available', () => {
  const sidebar = read('src/components/layout/Sidebar.tsx');
  const responsive = read('src/styles/responsive.css');
  const app = read('src/App.tsx');
  assert.doesNotMatch(sidebar, /to:\s*["']\/downloads["']/);
  assert.match(responsive, /grid-template-columns:\s*repeat\(5/);
  assert.doesNotMatch(app, /console\.clear\(\)/); // Keep provider diagnostics visible.
  assert.doesNotMatch(app, /useAppUpdater\(\)/);
});
