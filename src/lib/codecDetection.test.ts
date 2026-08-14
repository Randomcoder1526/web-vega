import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isCodecLikelyUnsupported,
  extractAudioCodec,
  probeAudioCodec,
  probeAllLevels,
  clearCodecCache,
} from './codecDetection';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let originalMediaCapabilities: any;

function mockMediaCapabilities(supported: boolean) {
  const mock = { decodingInfo: vi.fn().mockResolvedValue({ supported }) };
  originalMediaCapabilities = (navigator as any).mediaCapabilities;
  Object.defineProperty(navigator, 'mediaCapabilities', { value: mock, configurable: true });
}

function mockMediaCapabilitiesForCodecs(codecMap: Record<string, boolean>) {
  const mock = {
    decodingInfo: vi.fn().mockImplementation((config: any) => {
      const codec = (config?.audio?.contentType ?? '').toLowerCase();
      const sortedKeys = Object.keys(codecMap).sort((a, b) => b.length - a.length);
      for (const key of sortedKeys) {
        const k = key.toLowerCase();
        const identifiers = codec.split(/[,;/"=\s]+/).filter(Boolean);
        if (identifiers.some(id => id.startsWith(k) || id === k)) {
          return Promise.resolve({ supported: codecMap[key] });
        }
      }
      return Promise.resolve({ supported: false });
    }),
  };
  originalMediaCapabilities = (navigator as any).mediaCapabilities;
  Object.defineProperty(navigator, 'mediaCapabilities', { value: mock, configurable: true });
}

function removeMediaCapabilities() {
  originalMediaCapabilities = (navigator as any).mediaCapabilities;
  Object.defineProperty(navigator, 'mediaCapabilities', { value: undefined, configurable: true });
}

// ---------------------------------------------------------------------------
// Tests: isCodecLikelyUnsupported (static heuristic)
// ---------------------------------------------------------------------------

describe('isCodecLikelyUnsupported', () => {
  it('returns false for undefined', () => {
    expect(isCodecLikelyUnsupported(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isCodecLikelyUnsupported('')).toBe(false);
  });

  it('detects ac-3', () => {
    expect(isCodecLikelyUnsupported('ac-3')).toBe(true);
  });

  it('detects ac3 (no hyphen)', () => {
    expect(isCodecLikelyUnsupported('ac3')).toBe(true);
  });

  it('detects ec-3', () => {
    expect(isCodecLikelyUnsupported('ec-3')).toBe(true);
  });

  it('detects eac3', () => {
    expect(isCodecLikelyUnsupported('eac3')).toBe(true);
  });

  it('detects dts', () => {
    expect(isCodecLikelyUnsupported('dts')).toBe(true);
  });

  it('detects w00t', () => {
    expect(isCodecLikelyUnsupported('w00t')).toBe(true);
  });

  it('returns false for aac', () => {
    expect(isCodecLikelyUnsupported('mp4a.40.2')).toBe(false);
  });

  it('returns false for opus', () => {
    expect(isCodecLikelyUnsupported('opus')).toBe(false);
  });

  it('returns false for mp3', () => {
    expect(isCodecLikelyUnsupported('mp3')).toBe(false);
  });

  it('detects ac-3 in a compound codec string', () => {
    expect(isCodecLikelyUnsupported('avc1.640028,ac-3')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: extractAudioCodec
// ---------------------------------------------------------------------------

describe('extractAudioCodec', () => {
  it('returns audioCodec from level', () => {
    expect(extractAudioCodec({ audioCodec: 'ac-3' })).toBe('ac-3');
  });

  it('extracts unsupported codec from codecSet', () => {
    expect(extractAudioCodec({ codecSet: 'avc1.640028,ac-3' })).toBe('ac-3');
  });

  it('returns undefined when no codec info', () => {
    expect(extractAudioCodec({})).toBeUndefined();
  });

  it('returns undefined when codecSet has no unsupported codec', () => {
    expect(extractAudioCodec({ codecSet: 'avc1.640028,mp4a.40.2' })).toBeUndefined();
  });

  it('prefers audioCodec over codecSet', () => {
    expect(extractAudioCodec({ audioCodec: 'dts', codecSet: 'avc1.640028,ac-3' })).toBe('dts');
  });
});

// ---------------------------------------------------------------------------
// Tests: probeAudioCodec
// ---------------------------------------------------------------------------

describe('probeAudioCodec', () => {
  beforeEach(() => {
    clearCodecCache();
    originalMediaCapabilities = (navigator as any).mediaCapabilities;
  });

  afterEach(() => {
    if (originalMediaCapabilities !== undefined) {
      Object.defineProperty(navigator, 'mediaCapabilities', { value: originalMediaCapabilities, configurable: true });
    }
    vi.restoreAllMocks();
  });

  it('returns false for ac-3 when MediaCapabilities says unsupported', async () => {
    mockMediaCapabilities(false);
    const result = await probeAudioCodec('ac-3');
    expect(result).toBe(false);
  });

  it('returns true for ac-3 when MediaCapabilities says supported', async () => {
    mockMediaCapabilities(true);
    const result = await probeAudioCodec('ac-3');
    expect(result).toBe(true);
  });

  it('returns false for dts when no API available (static heuristic)', async () => {
    removeMediaCapabilities();
    const result = await probeAudioCodec('dts');
    expect(result).toBe(false);
  });

  it('returns true for aac when no API available (static heuristic)', async () => {
    removeMediaCapabilities();
    const result = await probeAudioCodec('mp4a.40.2');
    expect(result).toBe(true);
  });

  it('returns false for eac3 when MediaCapabilities says unsupported', async () => {
    mockMediaCapabilities(false);
    const result = await probeAudioCodec('eac3');
    expect(result).toBe(false);
  });

  it('returns true for aac when MediaCapabilities says supported', async () => {
    mockMediaCapabilities(true);
    const result = await probeAudioCodec('mp4a.40.2');
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: probeAllLevels
// ---------------------------------------------------------------------------

describe('probeAllLevels', () => {
  beforeEach(() => {
    clearCodecCache();
    originalMediaCapabilities = (navigator as any).mediaCapabilities;
  });

  afterEach(() => {
    if (originalMediaCapabilities !== undefined) {
      Object.defineProperty(navigator, 'mediaCapabilities', { value: originalMediaCapabilities, configurable: true });
    }
    vi.restoreAllMocks();
  });

  const makeLevel = (height: number, audioCodec?: string) => ({
    height,
    width: Math.round(height * 16 / 9),
    audioCodec,
  });

  it('identifies highest supported level', async () => {
    mockMediaCapabilitiesForCodecs({ 'mp4a': true, 'ac-3': false });

    const levels = [
      makeLevel(1080, 'ac-3'),
      makeLevel(720, 'mp4a.40.2'),
      makeLevel(480, 'mp4a.40.2'),
    ];

    const { promise } = probeAllLevels(levels);
    const result = await promise;

    expect(result.supported.get(0)).toBe(false); // ac-3
    expect(result.supported.get(1)).toBe(true);  // aac
    expect(result.supported.get(2)).toBe(true);  // aac
    expect(result.highestSupportedIndex).toBe(2);
  });

  it('reports -1 when no level is supported', async () => {
    mockMediaCapabilitiesForCodecs({ 'ac-3': false, 'ec-3': false, 'dts': false });

    const levels = [
      makeLevel(1080, 'ac-3'),
      makeLevel(720, 'dts'),
      makeLevel(480, 'ec-3'),
    ];

    const { promise } = probeAllLevels(levels);
    const result = await promise;

    expect(result.highestSupportedIndex).toBe(-1);
  });

  it('reports all levels supported when codecs are compatible', async () => {
    mockMediaCapabilities(true);

    const levels = [
      makeLevel(1080, 'ac-3'),
      makeLevel(720, 'mp4a.40.2'),
    ];

    const { promise } = probeAllLevels(levels);
    const result = await promise;

    expect(result.supported.get(0)).toBe(true);
    expect(result.supported.get(1)).toBe(true);
    expect(result.highestSupportedIndex).toBe(1);
  });

  it('fires onProgress for each level', async () => {
    mockMediaCapabilitiesForCodecs({ 'mp4a': true, 'ac-3': false });

    const levels = [
      makeLevel(1080, 'ac-3'),
      makeLevel(720, 'mp4a.40.2'),
    ];

    const onProgress = vi.fn();
    const { promise } = probeAllLevels(levels, onProgress);
    await promise;

    expect(onProgress).toHaveBeenCalledTimes(2);

    const calls = onProgress.mock.calls.map(([idx, sup]: [number, boolean, number]) => ({ idx, sup }));
    const ac3Call = calls.find(c => c.idx === 0);
    const aacCall = calls.find(c => c.idx === 1);

    expect(ac3Call).toBeDefined();
    expect(ac3Call!.sup).toBe(false);
    expect(aacCall).toBeDefined();
    expect(aacCall!.sup).toBe(true);
  });

  it('cancel prevents onProgress from firing', async () => {
    mockMediaCapabilities(false);

    const levels = [
      makeLevel(1080, 'ac-3'),
      makeLevel(720, 'mp4a.40.2'),
    ];

    const onProgress = vi.fn();
    const { promise, cancel } = probeAllLevels(levels, onProgress);
    cancel();

    let resolved = false;
    promise.then(() => { resolved = true; });
    await new Promise((r) => setTimeout(r, 50));

    expect(resolved).toBe(false);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('handles levels without codec info (assumes supported)', async () => {
    mockMediaCapabilities(false);

    const levels = [
      makeLevel(1080), // no audioCodec
      makeLevel(720, 'ac-3'),
    ];

    const { promise } = probeAllLevels(levels);
    const result = await promise;

    expect(result.supported.get(0)).toBe(true);
    expect(result.supported.get(1)).toBe(false);
    expect(result.highestSupportedIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: HLS manifest fallback scenario
// ---------------------------------------------------------------------------

describe('HLS manifest with AC3 fallback', () => {
  beforeEach(() => {
    clearCodecCache();
    originalMediaCapabilities = (navigator as any).mediaCapabilities;
  });

  afterEach(() => {
    if (originalMediaCapabilities !== undefined) {
      Object.defineProperty(navigator, 'mediaCapabilities', { value: originalMediaCapabilities, configurable: true });
    }
    vi.restoreAllMocks();
  });

  it('auto-selects highest compatible level when AC3 is unsupported', async () => {
    mockMediaCapabilitiesForCodecs({ 'mp4a': true, 'ac-3': false });

    const levels = [
      { height: 2160, width: 3840, audioCodec: 'ac-3' },
      { height: 1080, width: 1920, audioCodec: 'ac-3' },
      { height: 720, width: 1280, audioCodec: 'mp4a.40.2' },
      { height: 480, width: 854, audioCodec: 'mp4a.40.2' },
    ];

    const { promise } = probeAllLevels(levels);
    const result = await promise;

    // Levels 0,1 (AC3) are unsupported; levels 2,3 (AAC) are supported.
    // highestSupportedIndex is the highest INDEX that is supported.
    expect(result.highestSupportedIndex).toBe(3);
    expect(result.supported.get(0)).toBe(false);
    expect(result.supported.get(1)).toBe(false);
    expect(result.supported.get(2)).toBe(true);
    expect(result.supported.get(3)).toBe(true);
  });

  it('reports no fallback needed when all levels have compatible codecs', async () => {
    mockMediaCapabilities(true);

    const levels = [
      { height: 1080, width: 1920, audioCodec: 'mp4a.40.2' },
      { height: 720, width: 1280, audioCodec: 'mp4a.40.2' },
    ];

    const { promise } = probeAllLevels(levels);
    const result = await promise;

    expect(result.highestSupportedIndex).toBe(1);
    expect(result.supported.get(0)).toBe(true);
    expect(result.supported.get(1)).toBe(true);
  });

  it('handles mixed AC3/EAC3/DTS manifest (Dolby Atmos style)', async () => {
    mockMediaCapabilitiesForCodecs({ 'mp4a': true, 'ac-3': false, 'ec-3': false });

    const levels = [
      { height: 2160, width: 3840, audioCodec: 'ec-3' },
      { height: 1080, width: 1920, audioCodec: 'ac-3' },
      { height: 720, width: 1280, audioCodec: 'ac-3' },
      { height: 480, width: 854, audioCodec: 'mp4a.40.2' },
    ];

    const { promise } = probeAllLevels(levels);
    const result = await promise;

    expect(result.highestSupportedIndex).toBe(3);
  });

  it('simulates Chrome fallback: 4K AC3 -> 1080p AC3 -> 720p AAC', async () => {
    mockMediaCapabilitiesForCodecs({ 'mp4a': true, 'ac-3': false });

    const levels = [
      { height: 2160, width: 3840, audioCodec: 'ac-3' },
      { height: 1080, width: 1920, audioCodec: 'ac-3' },
      { height: 720, width: 1280, audioCodec: 'mp4a.40.2' },
    ];

    const { promise } = probeAllLevels(levels);
    const result = await promise;

    expect(result.supported.get(0)).toBe(false);
    expect(result.supported.get(1)).toBe(false);
    expect(result.supported.get(2)).toBe(true);
    expect(result.highestSupportedIndex).toBe(2);
  });

  it('simulates Safari fallback: all levels supported', async () => {
    mockMediaCapabilities(true);

    const levels = [
      { height: 2160, width: 3840, audioCodec: 'ac-3' },
      { height: 1080, width: 1920, audioCodec: 'ec-3' },
      { height: 720, width: 1280, audioCodec: 'ac-3' },
    ];

    const { promise } = probeAllLevels(levels);
    const result = await promise;

    expect(result.highestSupportedIndex).toBe(2);
    expect(result.supported.get(0)).toBe(true);
    expect(result.supported.get(1)).toBe(true);
    expect(result.supported.get(2)).toBe(true);
  });
});
