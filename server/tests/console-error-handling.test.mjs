import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(`../../${relative}`, import.meta.url), 'utf8');

const reporter = await read('src/lib/errors/errorReporter.ts').catch(() => '');
assert.match(reporter, /installGlobalErrorHandlers/, 'central error reporter must install global browser handlers');
assert.match(reporter, /unhandledrejection/, 'global handler must catch unhandled promise rejections');
assert.match(reporter, /addEventListener\(["']error["']/, 'global handler must catch window errors');
assert.match(reporter, /recentIssues|dedup/i, 'error reporter must deduplicate repeated diagnostics');
assert.match(reporter, /preventDefault\(\)/, 'known handled promise failures should suppress duplicate browser console noise');

const main = await read('src/main.tsx');
const installIndex = main.indexOf('installGlobalErrorHandlers(');
const renderIndex = main.indexOf('ReactDOM.createRoot');
assert.ok(installIndex >= 0 && installIndex < renderIndex, 'global error handling must install before React mounts');
assert.match(main, /AppErrorBoundary/, 'React tree must have an application error boundary');

const providerManager = await read('src/lib/services/ProviderManager.ts');
assert.ok(!providerManager.includes('console.error("Error in stream function:"'), 'ProviderManager must not double-log stream errors before rethrowing them');

const useStream = await read('src/lib/hooks/useStream.ts');
assert.ok(!useStream.includes('console.error("Stream fetch error:"'), 'useStream must use the centralized reporter instead of raw console.error');
assert.match(useStream, /reportHandledIssue|reportUnexpectedIssue/, 'useStream must report classified failures centrally');

const boundary = await read('src/components/AppErrorBoundary.tsx').catch(() => '');
assert.match(boundary, /componentDidCatch/, 'React error boundary must catch render errors');
assert.match(boundary, /Reload/, 'React error boundary must provide a reload recovery action');
assert.match(boundary, /Go Home/, 'React error boundary must provide a home recovery action');

console.log('console error handling regressions passed');
