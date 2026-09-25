import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/lib/playback/audioSync.ts'), 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-audio-sync-'));
const modulePath = path.join(dir, 'audioSync.mjs');
fs.writeFileSync(modulePath, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
const { planBackupAudioSync } = await import(pathToFileURL(modulePath).href);

test('audio sync leaves small differences untouched', () => {
  assert.deepEqual(planBackupAudioSync({ primaryTime: 21, backupTime: 20.95, primaryRate: 1 }), { seekTo: null, playbackRate: 1 });
});
test('audio sync nudges rate toward the primary timeline without audible jumps', () => {
  assert.deepEqual(planBackupAudioSync({ primaryTime: 21, backupTime: 20.8, primaryRate: 1.5 }), { seekTo: null, playbackRate: 1.56 });
  assert.deepEqual(planBackupAudioSync({ primaryTime: 21, backupTime: 21.4, primaryRate: 1 }), { seekTo: null, playbackRate: 0.96 });
});
test('audio sync seeks after a skip, clips to backup duration and restores configured rate', () => {
  assert.deepEqual(planBackupAudioSync({ primaryTime: 350, backupTime: 20, primaryRate: 1, backupDuration: 300 }), { seekTo: 299.95, playbackRate: 1 });
  assert.deepEqual(planBackupAudioSync({ primaryTime: 80, backupTime: 80, primaryRate: 2, force: true }), { seekTo: 80, playbackRate: 2 });
});
