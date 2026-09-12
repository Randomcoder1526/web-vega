import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const hook = fs.readFileSync(new URL('../src/lib/hooks/useMpvPlayer.ts', import.meta.url), 'utf8');
const player = fs.readFileSync(new URL('../src/pages/PlayerPage.tsx', import.meta.url), 'utf8');
const shim = fs.readFileSync(new URL('../src/web-shims/mpv.ts', import.meta.url), 'utf8');

test('mpv hook exposes fatal playback callback and clears old errors for new loads', () => {
  assert.match(hook, /onPlaybackFailure\?:/);
  assert.match(hook, /optsRef\.current\?\.onPlaybackFailure/);
  assert.match(hook, /setInitializationError\(null\)/);
});

test('browser mpv bounds HLS recovery and detects long stalls before escalating', () => {
  assert.match(shim, /hlsNetworkRecoveryCount/);
  assert.match(shim, /hlsMediaRecoveryCount/);
  assert.match(shim, /stallTimer/);
  assert.match(shim, /web-playback-error/);
  assert.match(shim, /category:/);
});

test('desktop player tracks attempted candidates and automatically falls back without advancing series episodes', () => {
  assert.match(player, /findNextUntriedStream/);
  assert.match(player, /findNextMovieMirror/);
  assert.match(player, /attemptedStreamKeysRef/);
  assert.match(player, /attemptedMirrorLinksRef/);
  assert.match(player, /onPlaybackFailure:/);
  assert.match(player, /tryNextSource/);
  assert.match(player, /state\.type\s*===\s*["']movie["']/);
});

test('browser player wires a lower-quality source into the mpv web shim as fallback audio', () => {
  assert.match(player, /findFallbackAudioStream/);
  assert.match(player, /fallbackAudioStream/);
  assert.match(player, /fallbackAudio/);
});

test('browser mpv shim uses a hidden video element for lower-quality fallback media', () => {
  assert.match(shim, /backupAudio/);
  const ensureStart = shim.indexOf('function ensureBackupAudio');
  const ensureEnd = shim.indexOf('function pauseBackupAudio');
  const ensureBlock = shim.slice(ensureStart, ensureEnd);
  assert.match(ensureBlock, /document\.createElement\("video"\)/);
  assert.match(shim, /syncBackupAudio/);
  assert.match(shim, /vega-backup-audio-url/);
  assert.match(shim, /waiting[\s\S]*pauseBackupAudio/);
  assert.match(shim, /playing[\s\S]*resumeBackupAudio/);
  assert.match(shim, /resumeBackupAudio\(true\)/);
  assert.match(shim, /pointerdown/);
});
