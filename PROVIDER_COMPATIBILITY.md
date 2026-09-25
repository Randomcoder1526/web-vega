# Provider Compatibility / Stable Web Build

This web build is hardened against the current Zenda-Cross `vega-providers` extension contract.

## Compatibility improvements

- Accepts current and legacy provider export names.
- Supports static and dynamic `catalog` / `genres` exports.
- Normalizes common post, metadata, episode and stream response wrappers/aliases.
- Preserves arbitrary quality labels such as `auto` while normalizing common 4K/2160p/1080p labels.
- Preserves provider stream headers, subtitles, tags and skip metadata.
- Handles URLSearchParams, FormData, Blob, ArrayBuffer and typed-array provider request bodies.
- Preserves final redirect URLs in the provider Axios/fetch shim.
- Retries transient idempotent upstream GET/HEAD requests while avoiding unsafe POST retries.
- Keeps provider cookies isolated per browser session across provider and media requests.
- Provider updates are transactional: a failed update keeps the previous working cached version.
- Provider module downloads retry transient failures and reject HTML/error pages masquerading as JavaScript.
- Supports direct browser media, HLS (`.m3u8`) and MPEG-DASH (`.mpd`) playback.
- DASH manifests preserve their upstream base URL through the same-origin media proxy so relative segments resolve correctly.
- Web playback now prioritizes HLS -> DASH -> MP4 -> WebM, while keeping MKV and torrent sources as lower-priority fallbacks.
- Provider worker errors now include provider + operation names to make `posts`, `meta`, `episodes`, and `stream` failures distinguishable.
- The Providers page classifies installed modules as **Web compatible**, **Limited on web**, or **Desktop only** based on detected runtime requirements.
- The legacy `getBaseUrl` helper now reads the current Zenda-Cross `urls.json`, with alias matching and a legacy fallback.

## WAF / Cloudflare behavior

A normal deployed website cannot read another origin's Cloudflare challenge cookies or rendered page HTML. The old web fallback opened a new tab and returned an empty result, which caused confusing parser failures later.

The web runtime now fails early with `WEB_WAF_UNSUPPORTED` when a provider needs a native WebView challenge flow and no reusable Vega cookie is available. The player turns this into a clear non-retryable compatibility message instead of repeatedly retrying a request the browser cannot complete.

This does **not** bypass Cloudflare or other access controls. Providers that require browser verification should use an authorized API or the desktop/native Vega runtime.

## Web limitations

No web build can guarantee every upstream source works indefinitely. A provider can still fail when its remote site is offline, changes markup/API behavior, requires unsupported DRM, requires native TLS/browser verification, blocks the deployment IP, or returns a codec/container the user's browser cannot decode.

Raw magnet/torrent playback requires a separate torrent-capable backend or native runtime; a normal browser video element cannot play a magnet URI directly. MKV support also varies by browser and codec, so browser-native HLS/DASH/MP4/WebM sources are preferred automatically.

When deploying to Vercel, `npm install` must run so dependencies such as `hls.js` and `dashjs` are installed before `npm run build`.
