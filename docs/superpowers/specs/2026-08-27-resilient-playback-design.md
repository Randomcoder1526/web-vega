# Resilient Playback and Source Fallback Design

## Goal
Make Vega Web robust when provider extraction or browser playback fails: classify failures, retry only transient cases, automatically move to another viable stream or movie mirror, and surface useful recovery controls without infinite loops.

## Scope
- Provider extraction errors from extension modules.
- HTTP/proxy/media errors including 401/403/404/410/429/5xx and timeouts.
- HLS fatal network/media errors and browser media decode/unsupported errors.
- Multiple streams returned by a provider.
- Alternate movie links already present in the current metadata/episode list.
- Responsive error UI and manual retry/source selection.
- Spatial-navigation package consistency to remove the recurring `measureLayout` crash.

## Constraints
- Do not bypass DRM, login/paywalls, CAPTCHAs, or interactive WAF/anti-bot challenges.
- A 401/403/WAF host-block is terminal for that candidate; Vega may try another candidate but must not loop on the blocked host.
- Never auto-advance to the next episode of a series as an error fallback.
- Preserve provider-supplied headers/cookies and the existing per-browser proxy cookie jar.
- Keep local/downloaded playback first when available.
- Limit retries and candidate attempts to prevent request storms.

## Architecture
1. `playbackErrors.ts` normalizes arbitrary provider/player errors into a typed `PlaybackFailure` with category, retryability, and user-facing text.
2. `sourceFallback.ts` owns deterministic candidate ordering, candidate keys, attempted-source tracking, and whether an alternate movie link is eligible.
3. `useStream.ts` applies typed retry policy to extraction and exposes `refetch`, extraction failure details, and candidate state.
4. `PlayerPage.tsx` automatically advances among returned streams on fatal playback errors; when all returned streams fail for a movie, it may try another movie mirror from `episodeList`. It never does this for series.
5. `mpv.ts` emits structured `web-playback-error` payloads and handles recoverable HLS errors internally before escalating.
6. `server/index.mjs` returns useful upstream status metadata and uses bounded upstream timeouts for provider/media requests.
7. Spatial navigation imports are migrated to the single pinned `@noriginmedia/norigin-spatial-navigation` package so core and React hooks share one runtime instance.

## Error policy
- Offline/Abort: no blind retry; wait for user/network or candidate fallback.
- Timeout/408/425/429/5xx: transient; retry with short bounded backoff, then fallback.
- 401/403/WAF: host blocked; no same-candidate retry, fallback immediately.
- 404/410: source dead; no retry, fallback immediately.
- HLS network fatal: one internal reload; then fallback.
- HLS media fatal: one `recoverMediaError`; then fallback.
- Browser decode/not-supported: no same-candidate retry; fallback.
- Unknown: one retry at most, then fallback.

## UI behavior
The player error state shows the normalized reason, current source/server, how many alternatives were attempted, and buttons for Retry, Try next source (when available), and Back. Automatic fallback shows a short non-blocking status instead of immediately replacing the player with an error page.

## Verification
- Unit/static regression tests for error classification, retry policy, source ordering, series-vs-movie fallback, and unified spatial-navigation imports.
- Existing server proxy session, responsive layout, shim contract, and spatial-navigation ref tests remain green.
- TypeScript/Vite production build when dependencies are available.
