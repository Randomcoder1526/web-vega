import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('provider health is opt-in and reports stages honestly, without fetching streams', () => {
  const diagnostics = read('src/lib/providers/providerDiagnostics.ts');
  const page = read('src/pages/ExtensionsPage.tsx');
  assert.match(diagnostics, /testProviderCatalogAndPosts/);
  assert.match(diagnostics, /metadata: "unchecked"/);
  assert.match(diagnostics, /module\.version !== provider\.version/);
  assert.match(diagnostics, /streams: "unchecked"/);
  assert.match(diagnostics, /"Only catalog and posts are tested./);
  assert.doesNotMatch(diagnostics, /providerManager\.getStream\(/);
  assert.match(page, /onClick=\{\(\) => void runHealthCheck\(provider\)\}/);
  assert.match(page, /Export report/);
});

test('PWA install/update UI is manual and worker cannot intercept media/proxy/foreign requests', () => {
  const callbacks = new Map();
  const writes = [];
  const store = {
    open: async () => ({ addAll: async (urls) => { writes.push(...urls); }, match: async () => undefined, put: async () => {} }),
    keys: async () => [], match: async () => undefined, delete: async () => true,
  };
  const sandbox = {
    self: { location:{origin:'https://vega.local'}, addEventListener: (name, fn) => callbacks.set(name,fn), clients:{claim:async()=>{}},skipWaiting(){} },
    caches:store, fetch:async () => ({ok:true,type:'basic',text:async()=>'<script src="/assets/app.123.js"></script><link href="/assets/app.123.css">'}),
    URL, Set, Promise, Response,
  };
  vm.runInNewContext(read('public/sw.js'), sandbox);
  assert.deepEqual([...callbacks.keys()].sort(),['activate','fetch','install','message']);
  let installPromise;
  callbacks.get('install')({waitUntil(p){installPromise=p;}});
  return installPromise.then(() => {
    assert.ok(writes.includes('/assets/app.123.js'));
    assert.ok(writes.includes('/assets/app.123.css'));
    const blocked = ['/api/media?x=abc','/api/proxy','/dist/provider/posts.js','/x.m3u8','/x.mp4'];
    for (const pathname of blocked) {
      let responded=false;
      callbacks.get('fetch')({request:{method:'GET',url:`https://vega.local${pathname}`,mode:'cors',headers:{has:()=>false}},respondWith(){responded=true;}});
      assert.equal(responded,false,`${pathname} should never be cached`);
    }
    let responded=false;
    callbacks.get('fetch')({request:{method:'GET',url:'https://third-party.example/video.mp4',mode:'cors',headers:{has:()=>false}},respondWith(){responded=true;}});
    assert.equal(responded,false);
    const ui=read('src/components/PwaStatus.tsx');
    assert.match(ui,/sessionStorage\.setItem\('vega-sw-user-approved'/);
    assert.match(ui,/onClick=\{\(\) => \{/);
  });
});

test('player backup resynchronization keeps playback safe during buffering and cleans listeners', () => {
  const shim=read('src/web-shims/mpv.ts');
  assert.match(shim,/planBackupAudioSync/);
  assert.match(shim,/primaryBuffering = true/);
  assert.match(shim,/primaryBuffering = false/);
  assert.match(shim,/video\.seeking \|\| primaryBuffering/);
  assert.match(shim,/document\.removeEventListener\("visibilitychange", onVisibilityChange\)/);
  const page=read('src/pages/PlayerPage.tsx');
  assert.match(page,/describeWebStream\(stream, browserCapabilities\)\.playable/);
});
