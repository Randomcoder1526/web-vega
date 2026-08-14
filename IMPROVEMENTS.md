# Vega provider/runtime improvements

This build focuses on the provider/network reliability layer and safe playback transport.

## Added

- `/vega-health` health endpoint for Render/server checks.
- `/vega-stream` streaming proxy for direct media with Range/206 support.
- Upstream redirect handling for proxy and stream requests.
- Upstream timeout and response-size protection.
- Basic SSRF protection for localhost/private-network targets.
- CORS expose headers for media range playback.
- Optional stream Referer forwarding from provider stream metadata.
- Provider stream normalization and URL validation.
- Provider error classification for 403/404/429/5xx, timeout, and network failures.
- Episode request cancellation via AbortSignal.
- Player direct-media routing through the streaming proxy while leaving HLS manifest handling unchanged.
- Retry suppression for permanent provider errors (403/404/429).

## Important limitations

- This does not bypass Cloudflare, bot protection, CAPTCHA, or access controls.
- Provider-specific cookies/session state should not be hardcoded into provider source.
- HLS manifests whose segment URLs require special headers may still need a provider-specific HLS strategy.
- The repository snapshot already contained unrelated TypeScript errors in `ContinueWatching.tsx`, `Preferences.tsx`, and `Search.tsx`; these were not introduced by this change.
- The local `node_modules` snapshot is missing Vite/Rolldown's native optional binding, so a clean `npm install` is required before building locally.

## Render

Use the existing Node start command:

`npm run build && npm start`

or configure Render to build with `npm install && npm run build` and start with `npm start`.

After deployment, verify:

`/vega-health`

A successful response should contain `{"ok":true,"service":"vega-server",...}`.
