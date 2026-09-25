# Vega Web v2.1.0 — Playback and Provider UX improvements

This update implements the first **safe, testable** portion of the requested areas 2 (playback), 3 (new features) and 4 (release roadmap). It does not claim every enabled third-party extension works, nor that it is ready for an unrestricted public production launch.

## Playback updates
- Separate companion-video fallback audio now receives timeline correction that handles large seeks immediately and gently corrects smaller drift with a bounded 4% playback-speed adjustment.
- Fallback audio pauses while the primary video seeks/buffers and resumes from the primary timeline after actual playback resumes. The existing foreground synchronization is retained without duplicate document listeners.
- A fallback audio stream that ends prematurely now fails over instead of silently staying without sound. Volume and playback-speed controls still propagate to the companion.
- Browser media capability probing screens out known unsupported stream containers/codecs and torrent/magnet streams from the web playback queue. MP4/WebM codec hints are checked when supplied. HLS/DASH capabilities are checked conservatively; a "supported container" still requires real runtime playback testing.
- Mobile landscape/safe-area spacing and touch control hit areas have been improved.

## New user-facing features
- The Providers screen now has **Test** on installed providers and **Export report**. A test checks installed required modules, optional catalog and the first page of posts for the selected source, with a capped 15-second operation. It records the check time and a safe failure category. **Metadata, episodes, extracted streams and actual playback remain `unchecked`.** Only people who explicitly click Test initiate network checks.
- Downloadable provider health reports exclude full upstream URLs, module source, cookies and raw exceptions. A source or provider version change invalidates past checks.
- PWA: opt-in installation (where browsers support it), manual update prompt, offline status and an app-shell-only service worker. The worker never intercepts media, proxy, download requests, credentials, external sources or extension modules. **Offline video is NOT included.** Install/update UI is hidden during playback and automatic reloads are disabled.
- Browser console logs are preserved for debugging, and the app no longer logs whole module bundles on catalog failure.

## Release roadmap and remaining work
| Phase | Implemented | Remaining acceptance criteria |
| --- | --- | --- |
| 2.1 — core compatibility | Browser capability probes, shallow provider health UI, basic mobile refinements | Protect public proxy endpoints with authentication/allowlists/rate and bandwidth limits, complete dependency-backed build, production smoke tests |
| 2.2 — playback reliability | Sync nudging, pause/buffer/seek handling, format screening | Device-lab testing (Android Chrome and iOS Safari); HLS variant audio, DASH manifests, expired tokens, headers, codec change, stall recovery under real bandwidth |
| 2.3 — user experience | PWA shell, opt-in updates/install UI, safe health reports | End-to-end provider metadata/episode/stream tests for *authorized* sources; accessibility audit, cross-device history sync (if desired), user-facing health history filters |

## Local validation commands

```bash
npm ci
npm test
npm run build
npm run preview
```

Then perform these manual tests against authorized demo streams:
1. 1080p video lacking audio with lower-quality audio available: verify sound, pause, seek, 0.5×/1.5× playback speed, buffer/resume and moving between tabs.
2. Android Chrome and iPhone Safari: portrait, landscape, full-screen, notch/safe-area and control auto-hiding.
3. Browser media: valid HLS, DASH, MP4 and incompatible codec/magnet. A valid container alone does not guarantee playback.
4. Installed provider: select its source, click Test, check the result and export a privacy-safe report. A green posts test does NOT mean that playback works.
5. PWA on HTTPS production: install, navigate while online to populate the shell cache, disconnect network to check the shell, and confirm that `/api/*` and video requests are never cached.

**Release blocker:** The earlier proxy-security audit remains unresolved in this task. Put authentication, permitted-origin/domain rules, rate/bandwidth limits and redirect/DNS validation in place before operating as an open public proxy.

**Environment caveat:** Dependencies are not bundled. Unit tests and a TypeScript syntax parse can be executed in this sandbox; the full production build requires successful installation of `package-lock.json` dependencies on the developer's machine or CI.
