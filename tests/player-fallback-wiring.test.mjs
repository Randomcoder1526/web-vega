import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const hook = fs.readFileSync(new URL('../src/lib/hooks/useMpvPlayer.ts', import.meta.url), 'utf8');
const streamHook = fs.readFileSync(new URL('../src/lib/hooks/useStream.ts', import.meta.url), 'utf8');
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

test('browser fallback audio is independently extracted from a lower-quality movie link', () => {
  assert.match(player, /fallbackAudioCandidate/);
  assert.match(player, /useFallbackAudioStream/);
  assert.match(streamHook, /providerManager\.getStream/);
  assert.match(streamHook, /fallbackCandidate\?\.link/);
});

test('late fallback extraction can be applied without reloading the primary video', () => {
  assert.match(player, /vega-backup-audio-apply/);
  assert.match(shim, /vega-backup-audio-apply/);
  assert.match(shim, /loadBackupAudioSource\(\)/);
});


test('fallback only mutes primary after confirming decoded audio and re-syncs after seeks', () => {
  assert.match(shim, /confirmBackupAudioReady/);
  assert.match(shim, /webkitAudioDecodedByteCount|mozHasAudio|captureStream/);
  const ensureStart = shim.indexOf('function ensureBackupAudio');
  const ensureEnd = shim.indexOf('function pauseBackupAudio');
  const ensureBlock = shim.slice(ensureStart, ensureEnd);
  const playingHandler = ensureBlock.match(/backupAudio\.addEventListener\(["']playing["'][\s\S]*?\n\s*}\);/);
  assert.ok(playingHandler, 'fallback playing handler should exist');
  assert.doesNotMatch(playingHandler[0], /video\.muted\s*=\s*true/);
  assert.match(shim, /video\.addEventListener\(["']seeked["'][\s\S]*syncBackupAudio\(true\)/);
  assert.match(shim, /backupAudio\.addEventListener\(["']seeked["']/);
});

test('timeline seeking supports pointer input so touch/mobile scrubbing uses the same seek path', () => {
  const controls = fs.readFileSync(new URL('../src/pages/PlayerControls.tsx', import.meta.url), 'utf8');
  assert.match(controls, /handleTrackPointerDown/);
  assert.match(controls, /onPointerDown=\{handleTrackPointerDown\}/);
  assert.match(controls, /setPointerCapture/);
});


test('fallback audio can advance across extracted mirrors when one has no usable audio', () => {
  assert.match(shim, /web-backup-audio-failure/);
  assert.match(hook, /onFallbackAudioFailure\?:/);
  assert.match(hook, /onFallbackAudioFailure/);
  assert.match(player, /fallbackAudioStreams/);
  assert.match(player, /fallbackAudioIndex/);
  assert.match(player, /setFallbackAudioIndex/);
});
