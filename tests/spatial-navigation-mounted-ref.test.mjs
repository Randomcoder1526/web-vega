import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const topbar = read('../src/components/layout/Topbar.tsx');
const downloadDialog = read('../src/components/DownloadServerDialog.tsx');
const episodeDialog = read('../src/components/content/EpisodeDetailsDialog.tsx');
const contentSlider = read('../src/components/home/ContentSlider.tsx');
const hero = read('../src/components/home/Hero.tsx');
const customSelect = read('../src/components/CustomSelect.tsx');
const seasonSelector = read('../src/components/content/SeasonSelector.tsx');
const postCard = read('../src/components/home/PostCardItem.tsx');
const player = read('../src/pages/PlayerPage.tsx');

test('route/visibility guards mount focusable inner components only when a DOM ref exists', () => {
  assert.match(topbar, /function HomeTopbar|const HomeTopbar/);
  assert.match(topbar, /location\.pathname\s*!==\s*["']\/["'][\s\S]*return null[\s\S]*<HomeTopbar/);

  assert.match(downloadDialog, /function OpenDownloadServerDialog|const OpenDownloadServerDialog/);
  assert.match(downloadDialog, /if \(!props\.isOpen\) return null;[\s\S]*<OpenDownloadServerDialog/);

  assert.match(episodeDialog, /function OpenEpisodeDetailsDialog|const OpenEpisodeDetailsDialog/);
  assert.match(episodeDialog, /if \(!props\.details\) return null;[\s\S]*<OpenEpisodeDetailsDialog/);
});

test('loading/empty branches do not mount focus hooks whose refs are absent', () => {
  assert.match(contentSlider, /function ReadyContentSlider|const ReadyContentSlider/);
  assert.match(contentSlider, /if \(isLoading\)[\s\S]*if \(!posts \|\| posts\.length === 0\)[\s\S]*<ReadyContentSlider/);

  assert.match(hero, /function HeroPlayButton|const HeroPlayButton/);
  assert.match(hero, /if \(!post \|\| metaLoading\)[\s\S]*<HeroPlayButton/);
});

test('conditionally mounted popups own their own focus hooks', () => {
  assert.match(customSelect, /function OpenSelectList|const OpenSelectList/);
  assert.match(customSelect, /isOpen\s*&&\s*\([\s\S]*<OpenSelectList/);

  assert.match(seasonSelector, /function OpenSeasonContent|const OpenSeasonContent/);
  assert.match(seasonSelector, /open\s*&&\s*\([\s\S]*<OpenSeasonContent/);
});


test('optional child controls only register focus hooks when the child is rendered', () => {
  assert.match(postCard, /const PostRemoveButton/);
  assert.match(postCard, /onRemove\s*&&\s*\([\s\S]*<PostRemoveButton/);
  const parentSection = postCard.slice(0, postCard.indexOf('const PostRemoveButton'));
  assert.doesNotMatch(parentSection, /ref:\s*removeRef/);
});

test('every TvPlayer render branch keeps its focus boundary ref attached', () => {
  const errorStart = player.indexOf('if (streamError)');
  const errorEnd = player.indexOf('return (', errorStart + 20);
  assert.ok(errorStart >= 0);
  assert.match(player.slice(errorStart, errorEnd + 1500), /ref=\{focusRef\}/);
});
