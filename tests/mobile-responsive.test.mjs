import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const exists = (path) => fs.existsSync(new URL(path, import.meta.url));

const main = read('../src/main.tsx');
const index = read('../index.html');

test('loads a final mobile override stylesheet and enables safe-area viewport support', () => {
  assert.match(main, /styles\/responsive\.css/);
  assert.match(index, /viewport-fit=cover/);
});

test('mobile layout replaces the desktop sidebar with a bottom navigation bar', () => {
  assert.ok(exists('../src/styles/responsive.css'));
  const css = read('../src/styles/responsive.css');
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /\.sidebar[\s\S]*position:\s*fixed[\s\S]*bottom:\s*0/);
  assert.match(css, /\.sidebar-nav[\s\S]*grid-template-columns:\s*repeat\(6/);
  assert.match(css, /\.layout-content[\s\S]*safe-area-inset-bottom/);
});

test('mobile rules cover every primary application screen', () => {
  const css = read('../src/styles/responsive.css');
  for (const selector of [
    '.hero-container',
    '.search-page',
    '.catalog-grid',
    '.library-grid',
    '.downloads-page',
    '.extensions-page',
    '.settings-page',
    '.content-detail-page',
    '.player-page',
  ]) {
    assert.match(css, new RegExp(selector.replace('.', '\\.'), 'm'), `missing ${selector}`);
  }
});

test('dialogs and dense controls collapse to mobile-safe widths', () => {
  const css = read('../src/styles/responsive.css');
  for (const selector of [
    '.download-dialog-content',
    '.search-subtitles-modal',
    '.extensions-dialog-content',
    '.episode-details-dialog',
    '.info-story-dialog',
    '.provider-dropdown',
  ]) {
    assert.match(css, new RegExp(selector.replace('.', '\\.'), 'm'), `missing ${selector}`);
  }
  assert.match(css, /max-width:\s*calc\(100vw\s*-\s*24px\)/);
});

test('small phones and landscape phones receive dedicated overrides', () => {
  const css = read('../src/styles/responsive.css');
  assert.match(css, /@media\s*\(max-width:\s*520px\)/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)\s*and\s*\(max-height:\s*520px\)/);
});
