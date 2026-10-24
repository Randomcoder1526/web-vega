import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

const read = (relative) => readFile(path.join(root, relative), 'utf8');

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const main = await read('src/main.tsx');
const initIndex = main.indexOf('initNavigation({');
const renderIndex = main.indexOf('ReactDOM.createRoot');
assert.ok(initIndex >= 0, 'Spatial navigation must be initialized in src/main.tsx');
assert.ok(renderIndex >= 0 && initIndex < renderIndex, 'Spatial navigation must initialize before React renders');

const app = await read('src/App.tsx');
assert.ok(!app.includes('init as initNavigation'), 'App.tsx must not delay spatial-navigation initialization to an effect');

const srcFiles = await walk(path.join(root, 'src'));
const directUuidCalls = [];
for (const file of srcFiles) {
  const content = await readFile(file, 'utf8');
  if (content.includes('crypto.randomUUID()') && !file.endsWith(path.join('platform', 'uuid.ts'))) {
    directUuidCalls.push(path.relative(root, file));
  }
}
assert.deepEqual(directUuidCalls, [], `Direct crypto.randomUUID() calls are unsafe on insecure browser origins: ${directUuidCalls.join(', ')}`);

const downloadStore = await read('src/lib/zustand/downloadStore.ts');
assert.ok(downloadStore.includes('isTauriRuntime()'), 'Download startup must detect whether the native Tauri runtime exists');
assert.ok(!/startTorrentPolling\(\);\s*\n}/.test(downloadStore), 'Torrent polling must not start unconditionally in browser mode');

console.log('web runtime regression checks passed');
