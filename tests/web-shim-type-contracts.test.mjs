import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const windowShim = read('../src/web-shims/window.ts');
const webviewShim = read('../src/web-shims/webviewWindow.ts');
const dialogShim = read('../src/web-shims/dialog.ts');
const updaterShim = read('../src/web-shims/updater.ts');
const mpvShim = read('../src/web-shims/mpv.ts');
const httpShim = read('../src/web-shims/http.ts');

test('window shim accepts the arguments used by the desktop-compatible UI', () => {
  assert.match(windowShim, /setAlwaysOnTop\([^)]*boolean/);
  assert.match(windowShim, /setPosition\([^)]*Position/);
  assert.match(windowShim, /setSize\([^)]*Size/);
  assert.match(windowShim, /setDecorations\([^)]*boolean/);
  assert.match(windowShim, /setProgressBar\([^)]*ProgressBarOptions/);
  assert.match(windowShim, /onResized\([^)]*callback/);
  assert.match(windowShim, /export type ProgressBarStatus\s*=/);
});

test('webview shim has typed lookup, destroyable instances, and close callback support', () => {
  assert.match(webviewShim, /getByLabel\([^)]*label:\s*string[^)]*\).*Promise<WebviewWindow\s*\|\s*null>/s);
  assert.match(webviewShim, /onCloseRequested\([^)]*callback/);
  assert.match(webviewShim, /async destroy\(\)/);
});

test('dialog/updater/mpv shims expose the call shapes used by native-oriented hooks', () => {
  assert.match(dialogShim, /ask\([^,]+,\s*_?options\?/s);
  assert.match(dialogShim, /message\([^,]+,\s*_?options\?/s);
  assert.match(updaterShim, /export interface WebUpdate/);
  assert.match(updaterShim, /Promise<WebUpdate\s*\|\s*null>/);
  assert.match(mpvShim, /export async function init\([^)]*options\?/s);
});

test('http shim constructs Response from an ArrayBuffer-compatible body', () => {
  assert.match(httpShim, /new ArrayBuffer\(/);
  assert.doesNotMatch(httpShim, /new Response\(bytesFromBase64\(/);
});
