import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (relative) => fs.readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

test('browser build includes dash.js because upstream providers return MPD/DASH sources', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.dependencies.dashjs, '^5.2.1');

  const mpv = await read('src/web-shims/mpv.ts');
  assert.match(mpv, /from ["']dashjs["']/);
  assert.match(mpv, /MediaPlayer\(\)\.create\(\)/);
  assert.match(mpv, /\.mpd/);
  assert.match(mpv, /currentStreamType === ["']mpd["']/);
  assert.match(mpv, /dashPlayer\?\.reset/);
  assert.match(mpv, /addRequestInterceptor/);
  assert.match(mpv, /mediaProxyUrl\(requestUrl, headers\)/);
});
