import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = ts.transpileModule(fs.readFileSync(path.join(root,'src/lib/playback/webMediaSupport.ts'),'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
}).outputText;
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'vega-web-media-'));
const file = path.join(dir, 'webMediaSupport.mjs');
fs.writeFileSync(file, output);
const { describeWebStream, filterBrowserPlayableStreams } = await import(pathToFileURL(file).href);
const caps = { canPlayType: mime => mime.startsWith('video/mp4') ? 'maybe' : '', mediaSource: true, nativeHls: false };

test('browser capability filter excludes torrents and unsupported containers', () => {
  const checked = filterBrowserPlayableStreams([
    { type:'torrent', link:'magnet:?xt=test' }, { type:'mkv', link:'https://x/video.mkv' },
    { type:'m3u8', link:'https://x/main.m3u8' }, { type:'mp4', link:'https://x/main.mp4' },
  ], caps);
  assert.deepEqual(checked.playable.map(x => x.type), ['m3u8','mp4']);
  assert.equal(checked.rejected.length, 2);
});
test('browser capability probe respects codec hints and native HLS', () => {
  assert.equal(describeWebStream({type:'webm', link:'https://x/v.webm'}, caps).playable,false);
  assert.equal(describeWebStream({type:'m3u8'}, {...caps,mediaSource:false,nativeHls:true}).playable,true);
  assert.equal(describeWebStream({type:'mp4',codec:'avc1.42E01E'}, caps).playable,true);
});
