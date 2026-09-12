import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(`../../${relative}`, import.meta.url), 'utf8');

const metaPage = await read('src/pages/MetaPage.tsx');
assert.match(
  metaPage,
  /const showSeasonSelector\s*=\s*filteredLinkList\.length\s*>\s*1/,
  'MetaPage must hide the source/season selector unless at least two choices exist',
);
assert.match(
  metaPage,
  /showSeasonSelector\s*&&[\s\S]*?<SeasonSelector/,
  'SeasonSelector must only mount when showSeasonSelector is true',
);

const selector = await read('src/components/content/SeasonSelector.tsx');
assert.match(
  selector,
  /Source \$\{index \+ 1\}/,
  'blank source titles must receive a visible fallback label',
);
assert.match(
  selector,
  /value=\{String\(index\)\}/,
  'selector items must use stable index-backed values instead of blank/duplicate titles',
);
assert.ok(
  !selector.includes('value={season.title}'),
  'selector values must not depend directly on provider titles',
);

console.log('season selector visibility regressions passed');
