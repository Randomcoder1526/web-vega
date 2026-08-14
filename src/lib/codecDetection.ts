/**
 * Progressive codec detection using MediaCapabilities.decodingInfo() and
 * HTMLMediaElement.canPlayType(). Falls back through multiple strategies
 * so the player never blocks the UI while probing.
 */

const codecCache = new Map<string, boolean>();

/** Known audio codecs that most browsers cannot decode natively. */
const UNSUPPORTED_AUDIO_CODECS = ['ac-3', 'ac3', 'ec-3', 'eac3', 'dts', 'dca', 'w00t'];

/**
 * Quick static check: returns `false` if the codec string is *known* to be
 * unsupported on typical browsers (Chrome, Firefox, Edge). This is the fast
 * path used before any async probing begins.
 */
export function isCodecLikelyUnsupported(codec?: string): boolean {
  if (!codec) return false;
  const c = codec.toLowerCase();
  return UNSUPPORTED_AUDIO_CODECS.some((u) => c.includes(u));
}

/**
 * Normalize codec string variants (e.g. "ac3" -> "ac-3", "eac3" -> "ec-3")
 * to a canonical form that matches the UNSUPPORTED_AUDIO_CODECS list.
 */
function normalizeCodecName(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower === 'ac3') return 'ac-3';
  if (lower === 'eac3') return 'ec-3';
  if (lower === 'dca') return 'dts';
  return lower;
}

/**
 * Extract the audio codec string from an HLS level object.
 * hls.js exposes codec info via `audioCodec` or inside `codecSet`.
 */
export function extractAudioCodec(level: any): string | undefined {
  if (level?.audioCodec) return level.audioCodec;
  if (level?.codecSet) {
    const parts = level.codecSet.split(',');
    for (const p of parts) {
      const n = normalizeCodecName(p);
      if (UNSUPPORTED_AUDIO_CODECS.some((u) => n.includes(u))) return p;
    }
  }
  return undefined;
}

/**
 * Probe whether a single audio codec can be decoded in the current browser.
 *
 * Strategy (progressive, never blocks):
 *  1. Check the in-memory cache.
 *  2. Try `navigator.mediaCapabilities.decodingInfo()` (most accurate).
 *  3. Fall back to `HTMLMediaElement.canPlayType()`.
 *  4. Fall back to `isCodecLikelyUnsupported()` static list.
 *
 * Returns `true` when the codec can be decoded, `false` otherwise.
 */
export async function probeAudioCodec(codec: string): Promise<boolean> {
  const normalized = normalizeCodecName(codec);
  const cacheKey = normalized;

  if (codecCache.has(cacheKey)) return codecCache.get(cacheKey)!;

  // Strategy 1 – MediaCapabilities.decodingInfo()
  const mcSupported = await probeViaMediaCapabilities(normalized);
  if (mcSupported !== null) {
    codecCache.set(cacheKey, mcSupported);
    return mcSupported;
  }

  // Strategy 2 – canPlayType() on a temporary <video> element
  const canPlay = probeViaCanPlayType(normalized);
  if (canPlay !== null) {
    codecCache.set(cacheKey, canPlay);
    return canPlay;
  }

  // Strategy 3 – static heuristic
  const heuristic = !isCodecLikelyUnsupported(normalized);
  codecCache.set(cacheKey, heuristic);
  return heuristic;
}

/**
 * Use `navigator.mediaCapabilities.decodingInfo()` for a precise check.
 * Returns `true`/`false` if the API is available, `null` otherwise.
 */
async function probeViaMediaCapabilities(codec: string): Promise<boolean | null> {
  if (!navigator.mediaCapabilities?.decodingInfo) return null;

  const mimeTypes = buildMimeTypes(codec);

  for (const mimeType of mimeTypes) {
    try {
      const result = await navigator.mediaCapabilities.decodingInfo({
        type: 'media-source',
        video: {
          contentType: 'video/mp4; codecs="avc1.4d401f"',
          width: 1920,
          height: 1080,
          bitrate: 5_000_000,
          framerate: '30',
        },
        audio: {
          contentType: mimeType,
          channels: '2',
          bitrate: 128_000,
          sampleRate: 48000,
        },
      } as any);

      if (result.supported) return true;
    } catch {
      // malformed codec string for this browser – skip
    }
  }

  return false;
}

/**
 * Build candidate MIME type strings for a given codec so we can probe
 * several container variants (mp4, mp2t, webm).
 */
function buildMimeTypes(codec: string): string[] {
  const mapped = normalizeCodecName(codec);
  const candidates: string[] = [];

  // Direct use (e.g. "audio/ac-3")
  candidates.push(`audio/${mapped}`);

  // Common containers
  candidates.push(`audio/mp4; codecs="${mapped}"`);
  candidates.push(`audio/mpeg; codecs="${mapped}"`);
  candidates.push(`video/mp4; codecs="avc1.4d401f,${mapped}"`);
  candidates.push(`video/mp2t; codecs="${mapped}"`);

  return candidates;
}

/**
 * Probe via `HTMLMediaElement.canPlayType()`. Returns `true`/`false` if
 * the browser gives a meaningful answer, `null` if the answer is ambiguous
 * (empty string).
 */
function probeViaCanPlayType(codec: string): boolean | null {
  if (typeof document === 'undefined') return null;

  const video = document.createElement('video');
  const mapped = normalizeCodecName(codec);

  const mimeTypes = [
    `video/mp4; codecs="avc1.4d401f,${mapped}"`,
    `video/mp2t; codecs="${mapped}"`,
    `audio/mp4; codecs="${mapped}"`,
    `audio/${mapped}`,
  ];

  for (const mt of mimeTypes) {
    const result = video.canPlayType(mt);
    if (result === 'probably') return true;
    if (result === 'maybe') return true; // "maybe" means the browser recognizes the codec
  }

  return null;
}

/**
 * Result object returned by `probeAllLevels`.
 */
export interface LevelProbeResult {
  /** Level index -> whether audio is decodable. */
  supported: Map<number, boolean>;
  /** Highest index whose audio is decodable (-1 if none). */
  highestSupportedIndex: number;
}

/**
 * Probe all HLS levels *in the background* without blocking the caller.
 *
 * Each level is probed independently so results stream in as they resolve.
 * The caller receives an `AbortController`-compatible promise that can be
 * cancelled if the user navigates away before probing completes.
 *
 * @param levels  Array of hls.js level objects
 * @param onProgress  Optional callback fired each time a level is probed
 * @returns  A promise that resolves with the full probe results
 */
export function probeAllLevels(
  levels: any[],
  onProgress?: (index: number, supported: boolean, currentHighest: number) => void,
): { promise: Promise<LevelProbeResult>; cancel: () => void } {
  let cancelled = false;
  const result = new Map<number, boolean>();
  let highestIndex = -1;

  const promise = new Promise<LevelProbeResult>((resolve) => {
    const probes = levels.map(async (level, index) => {
      const codec = extractAudioCodec(level);
      const supported = codec ? await probeAudioCodec(codec) : true;

      if (cancelled) return;

      result.set(index, supported);

      if (supported && index > highestIndex) {
        highestIndex = index;
      }

      onProgress?.(index, supported, highestIndex);
    });

    Promise.all(probes).then(() => {
      if (!cancelled) {
        resolve({ supported: result, highestSupportedIndex: highestIndex });
      }
    });
  });

  return {
    promise,
    cancel: () => { cancelled = true; },
  };
}

/**
 * Clear the internal codec support cache. Call this between test runs
 * or when you need to re-probe codecs (e.g. after a browser config change).
 */
export function clearCodecCache(): void {
  codecCache.clear();
}
