# Vega Web

This folder is the browser/web conversion of the Vega Desktop source. The React UI, provider extension system, watchlist/history, search/catalog/content pages, settings, responsive layouts, and most player controls are preserved, while native Tauri/MPV functions are replaced with browser-safe implementations.

## What changed

- **Tauri/Rust removed from the web deliverable.** Native calls are mapped to `src/web-shims/*`.
- **Provider requests go through the same-origin Node proxy** at `/api/proxy`, so provider code can make server-side HTTP requests without browser CORS blocking it.
- **Media uses `/api/media`**, with support for request headers, byte ranges, redirects, and HLS manifest rewriting.
- **MPV is replaced by HTML5 video + hls.js** while keeping the existing Vega player UI and controls.
- **Browser fullscreen and Picture-in-Picture** are used on the website.
- **Local subtitle selection** uses the browser file picker. Local/remote SRT is converted to WebVTT for browser playback.
- **Direct-file downloads** are handed to the browser download manager.
- **Shared-folder desktop sync becomes a safe no-op** in the web runtime because websites cannot read arbitrary folders.
- **Native updater/window controls are disabled** in the website.
- **Resilient playback fallback** classifies extraction/player failures, retries transient failures once, automatically tries another returned stream, and can move to another movie mirror without ever auto-advancing a series episode.
- **Spatial navigation uses one pinned Norigin runtime** (`@noriginmedia/norigin-spatial-navigation@3.3.0`) to keep the navigation service and React hooks on the same dependency graph.

## Requirements

- Node.js 22.x recommended and pinned for hosted builds
- npm

## Run locally

```bash
cp .env.example .env
npm install --ignore-scripts
npm run dev
```

Open `http://localhost:1420`.

`npm run dev` starts both the browser UI and the local API/media proxy. The Vite dev server forwards `/api/*` requests to the Node proxy automatically.

## Production

```bash
npm install --ignore-scripts
npm run build
npm start
```

The production server uses `PORT` when provided by the host and otherwise runs on port `4173`.

Health check:

```text
/api/health
```

## Vercel deployment

This ZIP is ready to import into Vercel as a Vite project. The included `vercel.json` builds the SPA to `dist`, routes `/api/health`, `/api/proxy`, and `/api/media` through one Node.js Function, and falls back non-file browser routes to `index.html` for React Router refreshes.

Recommended setup:

```text
Framework Preset: Vite
Build Command: npm run vercel-build
Output Directory: dist
Node.js: 22.x (pinned by package.json)
Health: /api/health
```

Add the same environment variables you use locally (`TMDB_API_KEY`, `PROXY_API_URL`, and any optional timeout settings) in Vercel Project Settings. Keep `ALLOW_PRIVATE_PROXY=false` on public deployments.

Vercel-specific notes:

- Provider metadata responses are capped below Vercel's buffered Function-response ceiling; large video payloads stay on `/api/media` instead of being base64-buffered by `/api/proxy`.
- HLS playlists and segments are proxied as separate streamed requests. Very long single direct-file responses can still be constrained by Vercel Function execution limits, so HLS/range-capable sources are the best fit for this deployment target.
- The proxy cookie/session jar is in process memory, as it is on the existing Node server. Vercel can recycle or scale Function instances, so provider sessions that require long-lived server-side cookies may occasionally need to be re-established.

## Render deployment

A `render.yaml` is included. Create a new Render Blueprint from the repository/ZIP contents, set `TMDB_API_KEY` if your configuration uses TMDB, and deploy.

The included service uses:

```text
Build: npm install --ignore-scripts && npm run build
Start: npm start
Health: /api/health
```

## Environment variables

See `.env.example`.

- `TMDB_API_KEY` — optional/required depending on the metadata features you use.
- `PROXY_API_URL` — preserves the existing Vega metadata-proxy configuration.
- `ALLOW_PRIVATE_PROXY=false` — keep this false on public deployments. Setting it to true allows the proxy to reach localhost/private IP ranges and is intended only for controlled local development.
- `UPSTREAM_HEADER_TIMEOUT_MS=20000` — optional timeout for waiting on provider/media response headers. The timer is cleared after headers arrive, so long-running video bodies are not cut off by this setting.

## Browser compatibility

Modern Chromium browsers, Edge, Firefox, and Safari are the targets. HLS playback uses `hls.js` where Media Source Extensions are available and falls back to native browser media behavior when appropriate.

The web build includes a dedicated responsive layer for phones and tablets: the desktop sidebar becomes a six-item bottom navigation bar, dense grids collapse for narrow screens, dialogs become mobile-safe sheets, settings/actions stack, safe-area insets are respected, and the player switches to compact touch-friendly controls. The web player is used on Windows, Linux, macOS, Android browsers, and other normal web runtimes instead of the old external-player/native branch.

## Provider networking architecture

Provider code still runs inside Vega's worker sandbox. Its `fetch`/Axios calls are RPC'd back to the host and then sent through `/api/proxy`.

The production proxy:

- accepts HTTP/HTTPS only;
- rejects localhost and private-network destinations by default;
- validates redirects again before following them;
- strips hop-by-hop request headers;
- limits normal provider responses to 32 MB on the standalone Node server and 3 MB on Vercel to stay below the platform response ceiling after base64/JSON overhead;
- keeps large media on the streaming `/api/media` path instead of buffering it in memory.

The media route forwards byte-range requests and rewrites HLS master/media playlists, segment URLs, alternate-rendition URLs, and key/map `URI=` references back through the same media proxy. This is necessary for streams that require Referer/User-Agent/custom headers.

## Playback recovery policy

Vega Web does not repeatedly hammer a source that has already failed. Failures are normalized into categories and handled predictably:

- **401/403/WAF or interactive challenge** — no same-source retry; mark the host blocked and immediately try another stream/mirror when available.
- **404/410** — treat the URL as dead/expired and move on.
- **429, 5xx, timeout, general network failure** — one bounded retry, then fallback.
- **Fatal HLS network error** — one `hls.js` reload attempt, then fallback.
- **Fatal HLS media/decode or unsupported codec/format** — one media recovery where supported, otherwise fallback immediately.
- **30-second playback stall** — treat the current stream as timed out and try the next candidate.
- **Movies with multiple direct links** — after all streams from one link fail, Vega may try the next untried movie mirror.
- **Series** — Vega never uses an error to silently jump to another episode.

The player also exposes **Retry**, **Try next source**, and **Go Back** when automatic recovery has no remaining candidate.

## Native features that cannot have exact browser parity

A standard website cannot safely reproduce every desktop capability. These cases are handled explicitly instead of pretending they work:

1. **Torrent/magnet streaming** — the desktop build starts a local torrent engine. Normal browser JavaScript cannot do that, so torrent streams report an unsupported-browser error.
2. **Cloudflare/WAF cookie extraction** — browsers prevent one origin from reading another origin's cookies. Vega Web preserves normal provider cookies/redirect sessions in its server proxy and falls back to alternate sources after a protected-host rejection, but it does not defeat CAPTCHAs, DRM, logins/paywalls, or interactive anti-bot challenges. Providers that require that exact native WAF flow may still fail.
3. **Downloaded-file library access** — a website cannot reopen arbitrary files from the user's Downloads folder later without the user selecting/granting access to them again.
4. **HLS-to-file download/merging** — direct MP4/WebM downloads work through the browser. HLS playlist downloads are rejected instead of incorrectly saving only an `.m3u8` manifest as if it were the video.
5. **True MPV-only codecs/features** — playback is limited to codecs the browser/hls.js stack can decode. Native MPV supports a wider set.
6. **Multi-audio track switching** — HLS alternate-audio tracks are exposed through hls.js; direct MP4/container multi-audio still depends on browser audio-track API support.
7. **Desktop taskbar progress, window decorations, always-on-top, custom native PiP sizing, native app updater** — replaced by normal browser behavior or safe no-ops.

For provider compatibility, prefer direct HTTP(S) media sources and browser-decodable codecs (H.264/AAC is the broadest compatibility choice). Providers that require arbitrary native TLS fingerprints or cross-origin cookie extraction cannot be made fully equivalent inside an ordinary public browser page.

## Important files

```text
server/index.mjs              production static server + provider/media proxy
server/dev.mjs                starts API server + Vite dev server
src/web-shims/core.ts         browser implementation of Tauri invoke calls
src/web-shims/http.ts         browser implementation of Tauri HTTP fetch
src/web-shims/mpv.ts          HTML5/hls.js implementation of the MPV API surface
src/web-shims/window.ts       fullscreen/window compatibility layer
src/platform/waf.ts           browser-safe WAF behavior
render.yaml                   Render deployment blueprint
.env.example                  environment template
```

The original desktop README is kept as `README-DESKTOP.md` for reference.

## Console and global error handling

The browser build installs global `error` and `unhandledrejection` handlers before React mounts. Known playback/provider failures are normalized into one compact, deduplicated diagnostic (for example `[vega:stream:forbidden]`) instead of repeated full stack traces. Unexpected errors retain a diagnostic stack, surface a toast, and React render failures fall back to a recovery screen with Reload and Go Home actions. Sensitive query parameters such as tokens/API keys are redacted from compact diagnostics.

## v8 blocked-host handling

Vega Web groups repeated provider 401/403/WAF failures by upstream host. If the same provider is rejected by the same upstream host twice during movie extraction, Vega trips a short-lived circuit breaker, skips the remaining equivalent mirrors, and offers either global provider search or the Extensions page. This prevents dozens of repeated requests and console warnings when a cloud deployment is blocked by a host such as VCloud.
