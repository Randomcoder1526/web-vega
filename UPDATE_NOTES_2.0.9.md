# Vega Web 2.0.9 - Provider Web Compatibility Update

## Changed

- Added provider compatibility inspection and badges: Web compatible, Limited on web, Desktop only, Not checked.
- Added explicit `WEB_WAF_UNSUPPORTED` handling for providers that require cross-origin browser verification/WebView cookies.
- Provider errors now identify the provider and provider operation when worker execution fails or times out.
- Web playback source priority is now HLS -> DASH -> MP4 -> WebM -> generic HTTP -> MOV -> MKV -> torrent/magnet.
- Updated the legacy `getBaseUrl()` helper to use the current Zenda-Cross `urls.json`, with aliases, stale-cache recovery, and legacy endpoint fallback.
- Added regression tests for browser-friendly source ordering and provider compatibility wiring.

## Important limitation

A deployed web app cannot read Cloudflare/WAF cookies or rendered challenge HTML from a different website origin. Providers that require those native WebView capabilities can be detected and reported clearly, but cannot be made equivalent to the desktop runtime purely from browser JavaScript.

## Validation

- `npm test`: 80/80 tests passed.
- Parsed all 128 TypeScript/TSX source files with the TypeScript parser: no syntax errors.
- A full dependency-backed build could not be completed in the sandbox because `npm ci` stalled while fetching packages. The project ZIP intentionally does not include `node_modules`; run `npm ci` followed by `npm run build` in your normal development/deployment environment.
