import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const main = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const preferences = fs.readFileSync(path.join(root, 'src/components/settings/PreferencesSettings.tsx'), 'utf8');

function collectSourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(full));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

test('all browser navigation imports use one exact unified Norigin runtime', () => {
  assert.equal(pkg.dependencies['@noriginmedia/norigin-spatial-navigation'], '3.3.0');
  assert.equal(pkg.dependencies['@noriginmedia/norigin-spatial-navigation-core'], undefined);
  assert.equal(pkg.dependencies['@noriginmedia/norigin-spatial-navigation-react'], undefined);
  for (const file of collectSourceFiles(path.join(root, 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /@noriginmedia\/norigin-spatial-navigation-(?:core|react)/, file);
  }
  assert.match(main, /from ["']@noriginmedia\/norigin-spatial-navigation["']/);
  assert.doesNotMatch(main, /BaseWebAdapter|layoutAdapter\s*:|nativeMode\s*:|useGetBoundingClientRect\s*:/);
});

test('changing TV mode reloads so navigation state is rebuilt cleanly', () => {
  assert.match(preferences, /setTvModeEnabled\(nextState\)/);
  assert.match(preferences, /window\.location\.reload\(\)/);
});
