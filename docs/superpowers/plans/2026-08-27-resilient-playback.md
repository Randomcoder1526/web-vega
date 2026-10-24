# Resilient Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded extraction/playback retries, automatic source fallback, structured errors, and consistent spatial navigation to Vega Web.

**Architecture:** Centralize failure classification and source-candidate logic, then connect it to provider extraction, player runtime errors, and the server proxy. Keep automatic recovery bounded and never attempt DRM/WAF bypasses.

**Tech Stack:** React 19, TypeScript 6, TanStack Query, hls.js, Node 22, Vite 8.

**Spec:** `docs/superpowers/specs/2026-08-27-resilient-playback-design.md`

## Global Constraints
- No DRM, CAPTCHA, login/paywall, or interactive WAF bypass.
- 401/403/WAF and 404/410 are not blindly retried.
- Series playback never auto-advances to another episode because of an error.
- Retries and fallback attempts are bounded.
- Existing provider headers and proxy cookies remain intact.

---

### Task 1: Normalize playback failures
**Files:**
- Create: `src/lib/playback/playbackErrors.ts`
- Test: `tests/playback-error-policy.test.mjs`

**Interfaces:**
- Produces: `classifyPlaybackError(error)`, `shouldRetryPlaybackFailure(error, failureCount)`, `PlaybackFailure`.

- [x] Write a failing regression test for 403/WAF, 404, 429, 5xx, timeout, offline, HLS media/network, decode and unknown errors.
- [x] Run the test and confirm it fails because the module does not exist.
- [x] Implement the classifier and bounded retry policy.
- [x] Run the test and confirm it passes.

### Task 2: Centralize source fallback decisions
**Files:**
- Create: `src/lib/playback/sourceFallback.ts`
- Test: `tests/source-fallback.test.mjs`

**Interfaces:**
- Produces: `streamCandidateKey(stream)`, `findNextUntriedStream(streams, current, attempted)`, `findNextMovieMirror(episodeList, activeIndex, attemptedLinks, type)`.

- [x] Write failing tests proving stream fallback skips attempted duplicates and movie mirror fallback never advances a series.
- [x] Run and verify red.
- [x] Implement deterministic source selection.
- [x] Run and verify green.

### Task 3: Use typed extraction retry policy
**Files:**
- Modify: `src/lib/hooks/useStream.ts`

**Interfaces:**
- Consumes: Task 1 classifier/retry policy.
- Produces: normalized `failure`, `retryCurrentExtraction()` in hook result.

- [x] Add a regression check that extraction retry delegates to the shared retry policy.
- [x] Replace unconditional two-retry logic with shared policy.
- [x] Expose normalized failure data without changing existing stream data semantics.
- [x] Run playback policy tests.

### Task 4: Add automatic playback fallback
**Files:**
- Modify: `src/lib/hooks/useMpvPlayer.ts`
- Modify: `src/pages/PlayerPage.tsx`
- Modify: `src/web-shims/mpv.ts`

**Interfaces:**
- Consumes: Task 1/2 helpers.
- Produces: structured fatal playback event details, automatic next-stream selection, bounded movie-mirror fallback.

- [x] Add a static regression test for fatal playback callback/fallback wiring.
- [x] Make HLS internal recovery bounded and emit structured fatal details only after recovery fails.
- [x] Add `onPlaybackFailure` option to `useMpvPlayer` and clear the player error when a new source loads.
- [x] Track attempted streams per active episode and automatically select the next untried stream on fatal playback error.
- [x] When a movie has exhausted streams, try the next untried movie mirror from the existing `episodeList`; do not do this for series.
- [x] Add Retry/Try next source controls and normalized error copy.
- [x] Run regressions.

### Task 5: Harden server network failures
**Files:**
- Modify: `server/index.mjs`
- Test: `server/tests/provider-proxy-session.test.mjs`

**Interfaces:**
- Produces: bounded provider/media upstream timeout and response metadata while retaining per-browser cookie sessions.

- [x] Extend the existing server regression to cover an upstream timeout and status propagation.
- [x] Add AbortSignal-based upstream timeout to `safeFetch` callers without changing private-IP protections.
- [x] Preserve upstream status/statusText/final URL for provider responses and useful media errors.
- [x] Run server regression suite.

### Task 6: Unify spatial navigation runtime
**Files:**
- Modify: `package.json`
- Modify: all `src/**` imports currently using `@noriginmedia/norigin-spatial-navigation-core` or `-react`.
- Modify: `src/main.tsx`
- Test: `tests/spatial-navigation-browser-mode.test.mjs`

**Interfaces:**
- Produces: one pinned `@noriginmedia/norigin-spatial-navigation@3.3.0` dependency/runtime instance.

- [x] Extend the regression test to fail if split package imports remain.
- [x] Replace dependencies with exact `@noriginmedia/norigin-spatial-navigation: 3.3.0`.
- [x] Rewrite static and dynamic imports to the unified package.
- [x] Initialize before React render with the unified package API.
- [x] Run spatial-navigation regressions.

### Task 7: Full verification and packaging
**Files:**
- Modify: `README.md`
- Create artifact: `/mnt/data/vega-web-browser-v4.zip`

- [x] Run all `.mjs` regression tests.
- [x] Run `node --check` on server scripts.
- [x] Run TypeScript/Vite build if dependency installation is available; otherwise explicitly report that limitation. (npm registry timed out in this sandbox; dependency-resolved build remains for Render/local verification.)
- [x] Update README with recovery behavior and non-bypass limitations.
- [x] Package a clean ZIP and run `unzip -t`.
