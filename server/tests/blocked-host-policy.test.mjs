import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root = new URL('../../', import.meta.url);

const transpile = async (relative) => {
  const source = await readFile(new URL(relative, root), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
};

const dir = await mkdtemp(path.join(os.tmpdir(), 'vega-host-policy-'));
try {
  const circuitPath = path.join(dir, 'hostBlockCircuit.mjs');
  await writeFile(circuitPath, await transpile('src/lib/playback/hostBlockCircuit.ts'));
  const circuit = await import(`${pathToFileURL(circuitPath).href}?t=${Date.now()}`);

  assert.equal(
    circuit.extractBlockedHost(new Error('HubCloud extract https://vcloud.fit/abc failed: HTTP 403 Forbidden')),
    'vcloud.fit',
    'blocked upstream host must be extracted from provider errors',
  );

  const registry = circuit.createHostBlockRegistry({ threshold: 2, ttlMs: 60_000 });
  const first = registry.record('vega', 'vcloud.fit', 1_000);
  assert.equal(first.tripped, false, 'first host rejection may still try one alternate mirror');
  const second = registry.record('vega', 'vcloud.fit', 2_000);
  assert.equal(second.tripped, true, 'second same-host rejection must trip the circuit');
  assert.equal(registry.isBlocked('vega', 'vcloud.fit', 2_100), true, 'tripped host stays blocked during TTL');
  assert.equal(registry.isBlocked('vega', 'vcloud.fit', 70_000), false, 'host circuit expires after TTL');

  const reporterSource = await readFile(new URL('src/lib/errors/errorReporter.ts', root), 'utf8');
  assert.match(reporterSource, /dedupeKey\??:/, 'handled diagnostics must support a stable dedupe key');
  assert.match(reporterSource, /dedupeWindowMs\??:/, 'handled diagnostics must support a custom dedupe window');

  const useStream = await readFile(new URL('src/lib/hooks/useStream.ts', root), 'utf8');
  assert.match(useStream, /extractBlockedHost/, 'stream reporter must group forbidden errors by upstream host');
  assert.match(useStream, /dedupeWindowMs:\s*blockedHost\s*\?\s*60_000/, 'forbidden host diagnostics must be collapsed for a minute');

  const player = await readFile(new URL('src/pages/PlayerPage.tsx', root), 'utf8');
  assert.match(player, /createHostBlockRegistry/, 'player must maintain a blocked-host circuit breaker');
  assert.match(player, /hostBlockRegistryRef/, 'player must keep circuit state across mirror changes');
  assert.match(player, /Search other providers/, 'terminal blocked-host UI must offer another-provider discovery');
  assert.match(player, /Install another provider/, 'single-provider setups must offer the extensions page instead of dead-ending');

  console.log('blocked-host policy regressions passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}
