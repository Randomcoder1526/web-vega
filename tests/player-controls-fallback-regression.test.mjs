import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const player = read('../src/pages/PlayerPage.tsx');
const controls = read('../src/pages/PlayerControls.tsx');
const shim = read('../src/web-shims/mpv.ts');

test('player uses a stable controls interaction callback so current-time rerenders cannot reset auto-hide forever', () => {
  assert.match(player, /const handleControlsInteraction = useCallback\(/);
  assert.match(player, /onScrubbingChange=\{handleControlsInteraction\}/);
  assert.doesNotMatch(player, /onScrubbingChange=\{\(scrubbing\) =>/);
});

test('player controls still support background click/tap toggling and inactivity auto-hide', () => {
  assert.match(player, /window\.setTimeout\(hideControls,\s*3500\)/);
  assert.match(player, /handleBackgroundClick/);
  assert.match(controls, /onClick=\{onClickBackground\}/);
});

test('HLS audio detection recognizes muxed audio codecs, not only alternate audioTracks', () => {
  assert.match(shim, /function hlsInstanceHasAudio/);
  assert.match(shim, /audioCodec/);
  assert.match(shim, /BUFFER_CODECS/);
  assert.match(shim, /primaryHlsAudioDetected/);
  assert.match(shim, /backupHlsAudioDetected/);
});

test('fallback audio has a browser-compatible activation path when track inspection APIs are unavailable', () => {
  assert.match(shim, /backupAudioInspectionAvailable/);
  assert.match(shim, /BACKUP_AUDIO_TRUST_GRACE_MS/);
  assert.match(shim, /activateBackupAudio/);
  assert.match(shim, /restorePrimaryAudio/);
});
