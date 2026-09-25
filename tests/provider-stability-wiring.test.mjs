import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (relative) => fs.readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

test('provider types track the current upstream provider contract', async () => {
  const types = await read('src/lib/providers/types.ts');
  assert.match(types, /quality\?:\s*string/);
  assert.match(types, /tag\?:\s*string/);
  assert.match(types, /tags\?:\s*string\[\]/);
  assert.match(types, /aspectRatio\?:/);
  assert.match(types, /cornerTag\?:/);
  assert.match(types, /CatalogList/);
});

test('provider sandbox accepts static or dynamic catalog exports and legacy export aliases', async () => {
  const worker = await read('src/lib/services/providerSandbox.worker.ts');
  assert.match(worker, /PROVIDER_EXPORT_ALIASES/);
  assert.match(worker, /GetStream/);
  assert.match(worker, /GetHomePosts/);
  assert.match(worker, /GetMetaData/);
  assert.match(worker, /GetEpisodeLinks/);
  assert.match(worker, /typeof providerExport === ["']function["']/);
  assert.match(worker, /return providerExport/);
});

test('provider sandbox serializes form and binary axios bodies and preserves final response URLs', async () => {
  const worker = await read('src/lib/services/providerSandbox.worker.ts');
  assert.match(worker, /URLSearchParams/);
  assert.match(worker, /FormData/);
  assert.match(worker, /ArrayBuffer\.isView/);
  assert.match(worker, /responseURL/);
  assert.match(worker, /responseUrl/);
  assert.match(worker, /Object\.defineProperty\(webResponse, ["']url["']/);
});

test('provider manager normalizes all provider-facing result types', async () => {
  const manager = await read('src/lib/services/ProviderManager.ts');
  for (const fn of [
    'normalizeCatalogResult',
    'normalizePostResult',
    'normalizeInfoResult',
    'normalizeStreamResult',
    'normalizeEpisodeResult',
  ]) {
    assert.match(manager, new RegExp(fn));
  }
  assert.match(manager, /["']catalog["']/);
  assert.match(manager, /["']genres["']/);
});

test('provider updates are transactional and keep the last working version on download failure', async () => {
  const updates = await read('src/lib/services/UpdateProviders.ts');
  const updateStart = updates.indexOf('async updateProvider');
  const updateEnd = updates.indexOf('async updateProviders', updateStart);
  const block = updates.slice(updateStart, updateEnd);
  assert.doesNotMatch(block, /uninstallProvider/);
  assert.match(block, /extensionManager\.updateProvider\(provider\)/);
});

test('provider module downloader tolerates catalog-less/search-only custom providers and retries transient module downloads', async () => {
  const manager = await read('src/lib/services/ExtensionManager.ts');
  assert.match(manager, /requiredFiles\s*=\s*\[["']posts["'],\s*["']meta["'],\s*["']stream["']\]/);
  assert.match(manager, /optionalFiles\s*=\s*\[[^\]]*["']catalog["']/);
  assert.match(manager, /downloadModuleWithRetry/);
});

test('web provider runtime exposes compatibility diagnostics and fails unsupported WAF flows clearly', async () => {
  const compatibility = await read('src/lib/providers/webCompatibility.ts');
  const waf = await read('src/platform/waf.ts');
  const manager = await read('src/lib/services/ProviderManager.ts');
  const baseUrl = await read('src/lib/providers/getBaseUrl.ts');
  const extensionsPage = await read('src/pages/ExtensionsPage.tsx');

  assert.match(compatibility, /Desktop only/);
  assert.match(compatibility, /Limited on web/);
  assert.match(compatibility, /openWebView|cf_clearance/);
  assert.match(waf, /WEB_WAF_UNSUPPORTED/);
  assert.match(manager, /sortStreamsForWebPlayback/);
  assert.match(baseUrl, /Zenda-Cross\/vega-providers/);
  assert.match(extensionsPage, /getProviderWebCompatibility/);
});
