import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import Hls from 'hls.js';
import { useStream } from '../hooks/useStream';
import { providerManager } from '../lib/providerManager';
import type { Link as ContentLink, Stream } from '../types';
import { useContentStore } from '../store/contentStore';
import { useThemeStore } from '../store/themeStore';
import { useWatchHistoryStore } from '../store/watchHistoryStore';
import {
  probeAllLevels,
  extractAudioCodec,
  isCodecLikelyUnsupported,
} from '../lib/codecDetection';
import { settingsStorage } from '../lib/settingsStorage';

const playbacks = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2];
type DisplayMode = 'fit' | 'fill' | 'zoom';
const displayModes: DisplayMode[] = ['fit', 'fill', 'zoom'];

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?.*)?$/i.test(url) || url.includes('.m3u8');
}


function playbackUrl(stream: Stream): string {
  const url = stream?.link || '';
  if (!url || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('/')) return url;
  // Keep HLS manifests on the existing path because their child segments may
  // need manifest-level URL handling. Direct media gets the streaming proxy so
  // browsers can use Range/206 requests instead of buffering the whole file.
  if (isHlsUrl(url)) return url;
  const referer = stream?.headers?.referer || stream?.headers?.Referer;
  const suffix = referer ? `&referer=${encodeURIComponent(referer)}` : '';
  return `/vega-stream?url=${encodeURIComponent(url)}${suffix}`;
}

function proxiedTextTrackUrl(url: string): string {
  if (!url || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('/')) return url;
  return `/vega-proxy?url=${encodeURIComponent(url)}`;
}

function audioTrackLabel(track: any, index: number): string {
  const lang = track?.lang || track?.language;
  const name = track?.name || track?.label;
  const channels = track?.channels ? ` · ${track.channels}ch` : '';
  return name || (lang ? `${String(lang).toUpperCase()}${channels}` : `Track ${index + 1}${channels}`);
}

function isMobileDevice(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    ('ontouchstart' in window && navigator.maxTouchPoints > 0);
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}


function streamHeight(stream: any): number {
  const raw = String(stream?.quality || stream?.resolution || stream?.server || stream?.link || '');
  const match = raw.match(/(?:^|[^0-9])(2160|1440|1080|720|576|540|480|360|240)(?:p)?(?:[^0-9]|$)/i);
  return match ? Number(match[1]) : 0;
}

function qualityHeightFromLink(source: ContentLink | undefined): number {
  if (!source) return 0;
  const raw = `${source.quality || ''} ${source.title || ''}`;
  const match = raw.match(/(?:^|\\D)(2160|1440|1080|720|576|540|480|360|240)p?(?:\\D|$)/i);
  return match ? Number(match[1]) : 0;
}

function sourceContainsLink(source: ContentLink | undefined, episodeLink: string): boolean {
  if (!source) return false;
  return source.directLinks?.some((d) => d.link === episodeLink) || source.episodesLink === episodeLink;
}

function fallbackQualitySources(sources: ContentLink[], currentLink: string): ContentLink[] {
  const current = sources.find((s) => sourceContainsLink(s, currentLink));
  const currentHeight = qualityHeightFromLink(current);
  return sources
    .filter((s) => s && s !== current && (s.directLinks?.length || s.episodesLink))
    .filter((s) => {
      const h = qualityHeightFromLink(s);
      return currentHeight <= 0 || (h > 0 && h < currentHeight);
    })
    .sort((a, b) => qualityHeightFromLink(b) - qualityHeightFromLink(a));
}

function sourcePlayableLink(source: ContentLink): string {
  return source.directLinks?.[0]?.link || source.episodesLink || '';
}

function legacyBackupAudioCandidates(streams: Stream[], selected: Stream | null): Stream[] {
  if (!selected) return [];
  const selectedHeight = streamHeight(selected);
  return streams
    .filter((s) => s?.link && s.link !== selected.link)
    .map((s, index) => ({ stream: s, index, height: streamHeight(s) }))
    .filter((x) => selectedHeight <= 0 || x.height <= 0 || x.height < selectedHeight)
    .sort((a, b) => selectedHeight > 0 && a.height && b.height
      ? Math.abs(selectedHeight - a.height) - Math.abs(selectedHeight - b.height)
      : b.index - a.index)
    .map((x) => x.stream);
}

async function lockLandscape() {
  try {
    if (screen.orientation && 'lock' in screen.orientation) {
      await (screen.orientation as any).lock('landscape');
    }
  } catch { /* orientation lock not supported or denied */ }
}

async function unlockOrientation() {
  try {
    if (screen.orientation && 'unlock' in screen.orientation) {
      (screen.orientation as any).unlock();
    }
  } catch { /* orientation unlock not supported */ }
}

const Player: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const link = decodeURIComponent(id || '');
  const navState = location.state as {
    title?: string;
    episodeTitle?: string;
    episodeIndex?: number;
    seasonIndex?: number;
    sourceVariants?: ContentLink[];
  } | null;

  const { provider: storeProvider, installedProviders } = useContentStore((s) => s);
  const { primary } = useThemeStore((s) => s);
  const { addItem: addToHistory, updatePlaybackInfo, history } = useWatchHistoryStore((s) => s);

  const providerValueFromUrl = searchParams.get('provider');
  const providerValue = useMemo(() => {
    if (providerValueFromUrl) {
      return installedProviders.find(p => p.value === providerValueFromUrl)?.value || storeProvider.value;
    }
    return storeProvider.value;
  }, [providerValueFromUrl, installedProviders, storeProvider]);

  const historyItem = history.find((h) => h.link === link);
  const contentTitle = navState?.title || historyItem?.title || '';
  const episodeTitle = navState?.episodeTitle || historyItem?.episodeTitle || '';
  const episodeIndex = navState?.episodeIndex ?? historyItem?.episodeIndex;
  const seasonIndex = navState?.seasonIndex ?? historyItem?.seasonIndex;
  const sourceVariants = navState?.sourceVariants || [];

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Playback State ---
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showCenterPlay, setShowCenterPlay] = useState(false);
  const [centerPlayAnim, setCenterPlayAnim] = useState(false);

  // --- UI State ---
  const [showControls, setShowControls] = useState(true);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isPlayerLocked, setIsPlayerLocked] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'main' | 'speed' | 'quality' | 'subtitle' | 'audio' | 'server' | 'display' | 'videoinfo'
  >('main');

  // --- Display Mode ---
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => {
    const saved = settingsStorage.getFrameDisplayMode();
    return (saved === 'fit' || saved === 'fill' || saved === 'zoom') ? saved : 'fit';
  });
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  // --- Tracks / Quality ---
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<number>(-1);
  const [selectedTextTrack, setSelectedTextTrack] = useState<number>(-1);
  const [audioTracks, setAudioTracks] = useState<any[]>([]);
  const [textTracks, setTextTracks] = useState<any[]>([]);
  const [qualityLevels, setQualityLevels] = useState<any[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<number>(-1);
  const [currentLevel, setCurrentLevel] = useState<number>(-1);

  // --- Toast ---
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Seek Bar ---
  const seekBarDraggingRef = useRef(false);
  const seekBarPreviewRef = useRef<number | null>(null);
  const [seekBarPreview, setSeekBarPreview] = useState<number | null>(null);
  const [isSeekBarHovered, setIsSeekBarHovered] = useState(false);
  const [bufferedPercent, setBufferedPercent] = useState(0);

  // --- Touch Gesture ---
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const touchGestureRef = useRef<'none' | null>(null);

  // --- Double Tap (YouTube-style) ---
  const doubleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapTimeRef = useRef(0);
  const lastTapPosRef = useRef({ x: 0, y: 0 });
  const [doubleTapSide, setDoubleTapSide] = useState<'left' | 'right' | null>(null);
  const doubleTapSideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Zoom (Zoom mode) ---
  const lastTouchDistRef = useRef(0);
  const isDraggingRef = useRef(false);
  const lastDragRef = useRef({ x: 0, y: 0 });

  // --- Refs ---
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backupAudioRef = useRef<HTMLAudioElement | null>(null);
  const backupAudioCandidatesRef = useRef<any[]>([]);
  const backupAudioIndexRef = useRef(0);
  const backupAudioStreamRef = useRef<any | null>(null);
  const backupAudioActiveRef = useRef(false);
  const backupAudioPrimeRef = useRef(false);
  const backupAudioPausedForBufferRef = useRef(false);
  const isBufferingRef = useRef(false);
  const fallbackQualitySourcesRef = useRef<ContentLink[]>([]);
  const fallbackFetchedStreamsRef = useRef<Stream[]>([]);
  const fallbackFetchIndexRef = useRef(0);
  const playbackRateRef = useRef(playbackRate);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(isMuted);
  const [backupAudioLabel, setBackupAudioLabel] = useState<string | null>(null);
  const supportedTopRef = useRef(-1);
  const probeCancelRef = useRef<(() => void) | null>(null);
  const codecProbeResultRef = useRef<Map<number, boolean>>(new Map());
  const showControlsRef = useRef(true);
  const showSettingsRef = useRef(false);
  const isPlayerLockedRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { showControlsRef.current = showControls; }, [showControls]);
  useEffect(() => { isBufferingRef.current = isBuffering; }, [isBuffering]);
  useEffect(() => { showSettingsRef.current = showSettings; }, [showSettings]);
  useEffect(() => { isPlayerLockedRef.current = isPlayerLocked; }, [isPlayerLocked]);
  useEffect(() => { playbackRateRef.current = playbackRate; }, [playbackRate]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { mutedRef.current = isMuted; }, [isMuted]);

  const { streams, selectedStream, setSelectedStream, isLoading, error, refetch } = useStream({
    episodeLink: link,
    providerValue,
  });

  useEffect(() => {
    const audio = backupAudioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = !backupAudioActiveRef.current || isMuted || volume <= 0;
    audio.playbackRate = playbackRate;
  }, [isMuted, playbackRate, volume]);

  // ─── Derived ─────────────────────────────────────────────────────────────────
  const progressPercent = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
  const displayTime = seekBarPreview !== null ? seekBarPreview : currentTime;
  const displayPercent = duration > 0 ? Math.min((displayTime / duration) * 100, 100) : 0;

  const qualityOptions = useMemo(() => {
    if (qualityLevels.length === 0) return ['auto'];
    const levels = qualityLevels.map((l: any) => l.height?.toString()).filter(Boolean);
    const unique = [...new Set(levels)].sort((a, b) => Number(b) - Number(a));
    return ['auto', ...unique];
  }, [qualityLevels]);

  const formatQuality = useCallback((quality: string) => {
    if (quality === 'auto') return 'Auto';
    const num = Number(quality);
    if (num > 1080) return '4K';
    if (num > 720) return '1080p';
    if (num > 480) return '720p';
    if (num > 360) return '480p';
    if (num > 240) return '360p';
    return quality + 'p';
  }, []);

  const isAudioCodecSupported = useCallback((codec?: string): boolean => {
    if (!codec) return true;
    return !isCodecLikelyUnsupported(codec);
  }, []);

  const currentSubtitleLabel = selectedTextTrack >= 0
    ? (textTracks[selectedTextTrack]?.name || textTracks[selectedTextTrack]?.label ||
       textTracks[selectedTextTrack]?.language || 'EN')
    : 'Off';

  const currentQualityLabel = selectedQuality >= 0
    ? formatQuality(String(qualityLevels[selectedQuality]?.height || 'auto'))
    : currentLevel >= 0 && qualityLevels[currentLevel]
      ? `Auto (${formatQuality(String(qualityLevels[currentLevel]?.height || 'auto'))})`
      : 'Auto';

  const currentSpeedLabel = playbackRate === 1 ? 'Normal' : `${playbackRate}x`;

  // ─── Toast ───────────────────────────────────────────────────────────────────
  const showToastMessage = useCallback((msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setShowToast(false), 2000);
  }, []);

  // ─── Controls visibility ─────────────────────────────────────
  const scheduleHideControls = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (!showSettingsRef.current && !isPlayerLockedRef.current) {
        setShowControls(false);
      }
    }, 3000);
  }, []);

  const revealControls = useCallback(() => {
    setShowControls(true);
    scheduleHideControls();
  }, [scheduleHideControls]);

  // When settings open/close, manage timer
  useEffect(() => {
    if (showSettings) {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      setShowControls(true);
    } else {
      scheduleHideControls();
    }
  }, [showSettings, scheduleHideControls]);

  // When player locked, keep controls visible
  useEffect(() => {
    if (isPlayerLocked) {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      setShowControls(true);
    } else {
      scheduleHideControls();
    }
  }, [isPlayerLocked, scheduleHideControls]);

  // ─── Playback rate ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  // ─── Display mode ─────────────────────────────────────────────────────────────
  useEffect(() => {
    settingsStorage.setFrameDisplayMode(displayMode);
    if (displayMode !== 'zoom') {
      setZoomLevel(1);
      setPanOffset({ x: 0, y: 0 });
    }
  }, [displayMode]);

  // ─── Volume ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = isMuted ? 0 : Math.min(1, volume);
    }
  }, [volume, isMuted]);

  // ─── Fullscreen change ────────────────────────────────────────────────────────
  useEffect(() => {
    const handleFullscreenChange = () => {
      const fs = !!document.fullscreenElement;
      setIsFullScreen(fs);
      if (!fs) unlockOrientation();
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;
      // Don't block settings-panel keys unless it's Escape
      if (showSettingsRef.current && e.key !== 'Escape') return;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          handlePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleSkip(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleSkip(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(v => Math.min(1, v + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(v => Math.max(0, v - 0.1));
          break;
        case 'm':
          e.preventDefault();
          setIsMuted(prev => !prev);
          break;
        case 'f':
          e.preventDefault();
          handleToggleFullScreen();
          break;
        case 'Escape':
          if (showSettingsRef.current) {
            setShowSettings(false);
            setActiveTab('main');
          }
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Handlers ────────────────────────────────────────────────────────────────
  const triggerCenterPlayAnim = useCallback(() => {
    setCenterPlayAnim(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setCenterPlayAnim(true));
    });
    setTimeout(() => setCenterPlayAnim(false), 500);
  }, []);

  const destroyBackupAudio = useCallback(() => {
    const audio = backupAudioRef.current;
    if (audio) {
      try { audio.pause(); } catch {}
      audio.removeAttribute('src');
      try { audio.load(); } catch {}
      try { audio.remove(); } catch {}
    }
    backupAudioRef.current = null;
    backupAudioStreamRef.current = null;
    backupAudioActiveRef.current = false;
    backupAudioPrimeRef.current = false;
    backupAudioPausedForBufferRef.current = false;
    setBackupAudioLabel(null);
  }, []);

  const prepareBackupAudio = useCallback((candidate: Stream) => {
    if (!candidate?.link) return null;
    let audio = backupAudioRef.current;
    if (!audio) {
      audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.setAttribute('playsinline', '');
      audio.setAttribute('aria-hidden', 'true');
      audio.style.position = 'fixed';
      audio.style.width = '1px';
      audio.style.height = '1px';
      audio.style.opacity = '0';
      audio.style.pointerEvents = 'none';
      audio.style.left = '-10px';
      audio.style.bottom = '-10px';
      document.body.appendChild(audio);
      backupAudioRef.current = audio;
    }

    if (audio.src !== candidate.link) {
      audio.pause();
      audio.src = candidate.link;
      audio.load();
    }
    audio.playbackRate = playbackRateRef.current;
    audio.volume = volumeRef.current;
    audio.muted = true;

    if (!audio.dataset.backupErrorBound) {
      audio.addEventListener('error', () => {
        backupAudioActiveRef.current = false;
        setBackupAudioLabel(null);
      });
      audio.dataset.backupErrorBound = '1';
    }

    backupAudioStreamRef.current = candidate;
    return audio;
  }, []);

  const audioActuallyDecoding = useCallback((audio: HTMLAudioElement) => {
    const decoded = (audio as any).webkitAudioDecodedByteCount;
    if (typeof decoded === 'number') return decoded > 0;
    // Firefox/Safari may not expose decoded-byte counters. A moving currentTime
    // after a successful play is the strongest portable signal available here.
    return audio.currentTime > 0.05;
  }, []);

  const waitForBackupAudio = useCallback(async (audio: HTMLAudioElement, timeoutMs = 2500) => {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      if (audio.error) return false;
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA && audio.paused) {
        try { await audio.play(); } catch { return false; }
      }
      if (audioActuallyDecoding(audio)) return true;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return audioActuallyDecoding(audio);
  }, [audioActuallyDecoding]);

  const primeBackupAudio = useCallback(() => {
    // Keep the backup element alive across pause/resume and tab visibility
    // changes. A previous version returned early when `primeRef` was true,
    // which meant the audio stayed paused forever after the first pause.
    const audio = backupAudioRef.current;
    const video = videoRef.current;
    if (!audio || !video) return;

    backupAudioPrimeRef.current = true;
    try {
      const target = Number.isFinite(audio.duration)
        ? Math.min(video.currentTime, Math.max(0, audio.duration - 0.05))
        : video.currentTime;
      if (Number.isFinite(target)) audio.currentTime = Math.max(0, target);
    } catch {}

    // A muted play is generally allowed after the original user gesture.
    // Once the backup is known-good, restore the user's mute state.
    audio.muted = !backupAudioActiveRef.current || mutedRef.current || volumeRef.current <= 0;
    audio.volume = volumeRef.current;
    audio.playbackRate = playbackRateRef.current;
    audio.play().then(() => {
      if (backupAudioActiveRef.current) {
        audio.muted = mutedRef.current || volumeRef.current <= 0;
      }
    }).catch(() => {
      // If the browser suspended the element, retry muted. This is useful
      // after switching tabs/backgrounding on mobile browsers.
      audio.muted = true;
      audio.play().then(() => {
        if (backupAudioActiveRef.current) {
          audio.muted = mutedRef.current || volumeRef.current <= 0;
        }
      }).catch(() => {});
    });
  }, []);

  const fetchFallbackStreams = useCallback(async () => {
    if (fallbackFetchedStreamsRef.current.length > 0) return fallbackFetchedStreamsRef.current;
    const sources = fallbackQualitySourcesRef.current;
    if (!sources.length) return fallbackFetchedStreamsRef.current;

    // Fetch quality variants in parallel. These are provider metadata/stream
    // resolution requests, not media downloads. The old sequential loop could
    // make fallback audio take 20–30+ seconds when the first mirror was slow.
    const results = await Promise.all(sources.map(async (source) => {
      const sourceLink = sourcePlayableLink(source);
      if (!sourceLink) return [];
      try {
        const controller = new AbortController();
        const result = await providerManager.getStream({
          link: sourceLink,
          type: sourceLink.includes('/series/') || sourceLink.includes('/episode/') ? 'series' : 'movie',
          signal: controller.signal,
          providerValue,
        });
        return (result || []).map((stream) => ({
          ...stream,
          _fallbackQuality: source.quality || source.title || '',
          _fallbackHeight: qualityHeightFromLink(source),
        }));
      } catch {
        return [];
      }
    }));

    // Keep the quality ordering deterministic (best lower quality first).
    fallbackFetchedStreamsRef.current = results
      .flat()
      .sort((a, b) => (Number(b._fallbackHeight) || 0) - (Number(a._fallbackHeight) || 0));
    return fallbackFetchedStreamsRef.current;
  }, [providerValue]);

  const activateBackupAudio = useCallback(async () => {
    let candidates = fallbackFetchedStreamsRef.current;

    // Prefer genuinely different quality variants from Info.linkList.
    if (!candidates.length && fallbackQualitySourcesRef.current.length) {
      candidates = await fetchFallbackStreams();
    }

    // Legacy fallback only when navigation did not provide quality variants.
    if (!candidates.length) {
      candidates = legacyBackupAudioCandidates(streams, selectedStream);
    }

    if (!candidates.length) {
      showToastMessage('No separate lower-quality audio source is available');
      return false;
    }

    for (let i = fallbackFetchIndexRef.current; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const audio = prepareBackupAudio(candidate);
      if (!audio) continue;

      fallbackFetchIndexRef.current = i;
      const video = videoRef.current;
      if (video) {
        try {
          const target = isFinite(audio.duration)
            ? Math.min(video.currentTime, Math.max(0, audio.duration - 0.05))
            : video.currentTime;
          if (isFinite(target)) audio.currentTime = Math.max(0, target);
        } catch {}
      }

      audio.muted = true;
      audio.volume = volumeRef.current;
      audio.playbackRate = playbackRateRef.current;

      try {
        await audio.play();
        const works = await waitForBackupAudio(audio);
        if (!works) {
          try { audio.pause(); } catch {}
          continue;
        }

        audio.muted = mutedRef.current || volumeRef.current <= 0;
        backupAudioActiveRef.current = true;

        // Never let backup audio continue while the master video is buffering
        // or paused. It must follow the video's playback state exactly.
        const masterVideo = videoRef.current;
        if (isBufferingRef.current || masterVideo?.paused) {
          try { audio.pause(); } catch {}
          backupAudioPausedForBufferRef.current = isBufferingRef.current;
        }

        const sourceHeight = Number((candidate as any)?._fallbackHeight) || streamHeight(candidate);

        setBackupAudioLabel(sourceHeight ? `${sourceHeight}p` : 'Backup');
        showToastMessage(`Backup audio active${sourceHeight ? ` · ${sourceHeight}p` : ''}`);
        return true;
      } catch {
        try { audio.pause(); } catch {}
      }
    }

    backupAudioActiveRef.current = false;
    setBackupAudioLabel(null);
    showToastMessage('Lower-quality source has no playable audio');
    return false;
  }, [
    fetchFallbackStreams,
    prepareBackupAudio,
    providerValue,
    selectedStream,
    showToastMessage,
    streams,
    waitForBackupAudio,
  ]);

  const stopBackupAudio = useCallback(() => {
    const audio = backupAudioRef.current;
    if (!audio) return;
    try { audio.pause(); } catch {}
    audio.muted = true;
    backupAudioActiveRef.current = false;
    backupAudioPausedForBufferRef.current = false;
    setBackupAudioLabel(null);
  }, []);

  useEffect(() => {
    const candidates = fallbackQualitySources(sourceVariants, link);
    fallbackQualitySourcesRef.current = candidates;
    fallbackFetchedStreamsRef.current = [];
    fallbackFetchIndexRef.current = 0;
    backupAudioPrimeRef.current = false;
    stopBackupAudio();
    destroyBackupAudio();

    // Resolve fallback stream URLs immediately in the background. This does
    // not download the video/audio file itself; it only asks the provider for
    // the lower-quality stream links so that fallback can start quickly when
    // the high-quality source turns out to have no playable audio.
    if (candidates.length) {
      void fetchFallbackStreams();
    }
  }, [link, sourceVariants, destroyBackupAudio, stopBackupAudio, fetchFallbackStreams]);

  // The high-quality video is the master clock. The fallback audio is a
  // separate media element, so simply syncing on `timeupdate` is not enough:
  // two media elements have independent clocks and can drift between events.
  // Keep a lightweight controller running while fallback audio is active.
  useEffect(() => {
    const getAudioTarget = (video: HTMLVideoElement, audio: HTMLAudioElement) => {
      const target = video.currentTime;
      if (!Number.isFinite(target)) return 0;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        return Math.min(Math.max(0, target), Math.max(0, audio.duration - 0.05));
      }
      return Math.max(0, target);
    };

    const hardSync = (resume = false) => {
      const video = videoRef.current;
      const audio = backupAudioRef.current;
      if (!video || !audio || !backupAudioActiveRef.current) return;

      try {
        const target = getAudioTarget(video, audio);
        audio.currentTime = target;
        audio.playbackRate = video.playbackRate;
        if (resume && !video.paused) {
          void audio.play().catch(() => {});
        }
      } catch {}
    };

    const syncNow = () => {
      const video = videoRef.current;
      const audio = backupAudioRef.current;
      if (!video || !audio || !backupAudioActiveRef.current) return;

      if (video.paused) {
        if (!audio.paused) audio.pause();
        return;
      }

      if (audio.paused || audio.ended || audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        void audio.play().catch(() => {});
        return;
      }

      const drift = audio.currentTime - video.currentTime;
      const absDrift = Math.abs(drift);

      try {
        // Small drift: gently change the audio clock speed so the correction
        // is inaudible and the two timelines converge instead of repeatedly
        // jumping. The video remains the master clock.
        if (absDrift >= 0.05 && absDrift < 0.30) {
          const correction = drift > 0 ? 0.985 : 1.015;
          audio.playbackRate = video.playbackRate * correction;
        } else if (absDrift >= 0.30) {
          // Large drift: hard re-anchor once, then return to the normal rate.
          audio.currentTime = getAudioTarget(video, audio);
          audio.playbackRate = video.playbackRate;
        } else {
          audio.playbackRate = video.playbackRate;
        }
      } catch {}
    };

    const onPlay = () => {
      if (backupAudioActiveRef.current) {
        hardSync(true);
      }
    };
    const onPause = () => {
      const audio = backupAudioRef.current;
      if (audio) audio.pause();
    };
    const onSeeking = () => hardSync(false);
    const onSeeked = () => hardSync(true);
    const onRate = () => {
      const video = videoRef.current;
      const audio = backupAudioRef.current;
      if (video && audio && backupAudioActiveRef.current) {
        audio.playbackRate = video.playbackRate;
      }
    };

    videoRef.current?.addEventListener('play', onPlay);
    videoRef.current?.addEventListener('pause', onPause);
    videoRef.current?.addEventListener('seeking', onSeeking);
    videoRef.current?.addEventListener('seeked', onSeeked);
    videoRef.current?.addEventListener('ratechange', onRate);

    // 4 sync checks/second is enough to control drift without constantly
    // seeking the audio element. Browsers may throttle this in background tabs;
    // the visibility/focus recovery effect below performs a hard sync on return.
    const syncTimer = window.setInterval(syncNow, 250);

    return () => {
      window.clearInterval(syncTimer);
      videoRef.current?.removeEventListener('play', onPlay);
      videoRef.current?.removeEventListener('pause', onPause);
      videoRef.current?.removeEventListener('seeking', onSeeking);
      videoRef.current?.removeEventListener('seeked', onSeeked);
      videoRef.current?.removeEventListener('ratechange', onRate);
    };
  }, []);

  useEffect(() => {
    const resumeBackupIfNeeded = () => {
      const video = videoRef.current;
      const audio = backupAudioRef.current;
      if (!video || !audio || video.paused || !backupAudioActiveRef.current) return;
      primeBackupAudio();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Give the browser a frame to resume media after background throttling.
        requestAnimationFrame(resumeBackupIfNeeded);
      }
    };
    const onPageShow = () => requestAnimationFrame(resumeBackupIfNeeded);
    const onFocus = () => requestAnimationFrame(resumeBackupIfNeeded);

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
    };
  }, [primeBackupAudio]);

  useEffect(() => {
    const audio = backupAudioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = !backupAudioActiveRef.current || isMuted || volume <= 0;
    audio.playbackRate = playbackRate;
  }, [isMuted, playbackRate, volume]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      const audio = backupAudioRef.current;
      if (!video || !audio || !backupAudioActiveRef.current || video.paused) return;

      // Background tabs/mobile browsers can suspend the second media element
      // independently. Re-anchor and restart it if it silently stopped.
      if (audio.paused || audio.ended || audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        primeBackupAudio();
        return;
      }
      if (Math.abs(audio.currentTime - video.currentTime) > 0.4) {
        try {
          const target = Number.isFinite(audio.duration)
            ? Math.min(video.currentTime, Math.max(0, audio.duration - 0.05))
            : video.currentTime;
          audio.currentTime = Math.max(0, target);
        } catch {}
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [primeBackupAudio]);

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      primeBackupAudio();
      video.play().catch(() => {});
      setIsPlaying(true);
      setShowCenterPlay(false);
    } else {
      video.pause();
      backupAudioRef.current?.pause();
      setIsPlaying(false);
      setShowCenterPlay(true);
      triggerCenterPlayAnim();
    }
    revealControls();
  }, [primeBackupAudio, revealControls, triggerCenterPlayAnim]);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    const ct = videoRef.current.currentTime;
    const dur = videoRef.current.duration;
    setCurrentTime(ct);
    setDuration(dur || 0);
    if (backupAudioActiveRef.current && backupAudioRef.current) {
      const audio = backupAudioRef.current;
      if (isFinite(audio.duration) && Math.abs(audio.currentTime - ct) > 0.35) {
        try { audio.currentTime = Math.max(0, Math.min(ct, audio.duration)); } catch { /* ignore */ }
      }
    }
    updatePlaybackInfo(link, { currentTime: ct, duration: dur });
  }, [link, updatePlaybackInfo]);

  const handleToggleLock = useCallback(() => {
    setIsPlayerLocked(prev => {
      const next = !prev;
      showToastMessage(next ? 'Controls locked' : 'Controls unlocked');
      return next;
    });
  }, [showToastMessage]);

  const handleToggleFullScreen = useCallback(() => {
    if (isFullScreen) {
      if (document.fullscreenElement) {
        document.exitFullscreen().then(() => {
          setIsFullScreen(false);
          unlockOrientation();
        });
      } else {
        setIsFullScreen(false);
        unlockOrientation();
      }
      return;
    }
    const video = videoRef.current;
    if (isIOS() && video && typeof (video as any).webkitEnterFullscreen === 'function') {
      (video as any).webkitEnterFullscreen();
      setIsFullScreen(true);
      lockLandscape();
      return;
    }
    if (!document.fullscreenElement) {
      const target = containerRef.current || document.documentElement;
      target.requestFullscreen?.().then(() => {
        setIsFullScreen(true);
        if (isMobileDevice()) lockLandscape();
      }).catch(() => {
        showToastMessage('Fullscreen is not available on this device');
      });
    }
  }, [isFullScreen]);

  const handleToggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
  }, []);

  const handleVolumeChange = useCallback((newVol: number) => {
    const clamped = Math.max(0, Math.min(1, newVol));
    setVolume(clamped);
    if (clamped > 0) setIsMuted(false);
  }, []);

  const handleSkip = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(duration, video.currentTime + seconds));
    showToastMessage(seconds > 0 ? `+${seconds}s` : `${seconds}s`);
    revealControls();
  }, [duration, showToastMessage, revealControls]);

  const handleVideoError = useCallback(() => {
    showToastMessage('Stream failed to load');
  }, [showToastMessage]);

  const handleBackNavigation = useCallback(() => {
    // Stop/destroy the secondary audio BEFORE changing routes. Otherwise the
    // detached audio element can survive the navigation long enough to keep
    // playing after the player has disappeared.
    if (audioCheckTimerRef.current) {
      clearTimeout(audioCheckTimerRef.current);
      audioCheckTimerRef.current = null;
    }
    backupAudioPausedForBufferRef.current = false;
    stopBackupAudio();
    destroyBackupAudio();

    if (historyItem?.infoLink) {
      navigate(`/info/${encodeURIComponent(historyItem.infoLink)}`);
    } else {
      navigate(-1);
    }
  }, [destroyBackupAudio, historyItem?.infoLink, navigate, stopBackupAudio]);

  // Safety net for every exit path (back button, browser history, swipe-back,
  // route replacement, etc.). The secondary audio must never survive the
  // Player component after it unmounts.
  useEffect(() => {
    return () => {
      if (audioCheckTimerRef.current) {
        clearTimeout(audioCheckTimerRef.current);
        audioCheckTimerRef.current = null;
      }
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
        controlsTimerRef.current = null;
      }
      try { backupAudioRef.current?.pause(); } catch {}
      if (backupAudioRef.current) {
        backupAudioRef.current.removeAttribute('src');
        try { backupAudioRef.current.load(); } catch {}
        try { backupAudioRef.current.remove(); } catch {}
      }
      backupAudioRef.current = null;
      backupAudioActiveRef.current = false;
      backupAudioPausedForBufferRef.current = false;
    };
  }, []);

  const handlePiP = useCallback(async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (videoRef.current) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch {
      showToastMessage('PiP not supported');
    }
  }, [showToastMessage]);

  const handleBuffering = useCallback(() => {
    isBufferingRef.current = true;
    setIsBuffering(true);
    const audio = backupAudioRef.current;
    const video = videoRef.current;
    if (audio && backupAudioActiveRef.current && video && !video.paused) {
      try { audio.pause(); } catch {}
      backupAudioPausedForBufferRef.current = true;
    }
  }, []);

  const resumeBackupAfterBuffer = useCallback(() => {
    isBufferingRef.current = false;
    setIsBuffering(false);
    const video = videoRef.current;
    const audio = backupAudioRef.current;
    if (!video || !audio || !backupAudioActiveRef.current || video.paused) return;

    try {
      const target = Number.isFinite(audio.duration)
        ? Math.min(video.currentTime, Math.max(0, audio.duration - 0.05))
        : video.currentTime;
      if (Number.isFinite(target)) audio.currentTime = Math.max(0, target);
      audio.playbackRate = video.playbackRate;
      audio.volume = volumeRef.current;
      audio.muted = mutedRef.current || volumeRef.current <= 0;
    } catch {}

    backupAudioPausedForBufferRef.current = false;
    void audio.play().catch(() => {
      // The normal visibility/focus recovery path will retry if the browser
      // temporarily blocks a resumed hidden media element.
    });
  }, []);

  const handleCanPlay = useCallback(() => {
    resumeBackupAfterBuffer();
  }, [resumeBackupAfterBuffer]);

  const handleProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.buffered.length === 0) return;
    const end = v.buffered.end(v.buffered.length - 1);
    setBufferedPercent(duration > 0 ? (end / duration) * 100 : 0);
  }, [duration]);

  const handlePlaying = useCallback(() => {
    resumeBackupAfterBuffer();
    setIsPlaying(true);
    setShowCenterPlay(false);

    if (audioCheckTimerRef.current) clearTimeout(audioCheckTimerRef.current);
    audioCheckTimerRef.current = setTimeout(async () => {
      const v = videoRef.current;
      if (!v || !selectedStream || backupAudioActiveRef.current) return;

      const decoded = (v as any).webkitAudioDecodedByteCount;
      const nativeAudioTracks = (v as any).audioTracks;
      const mozHasAudio = (v as any).mozHasAudio;

      const hasDecodedAudio = typeof decoded === 'number' && decoded > 0;
      const explicitlyNoAudio =
        mozHasAudio === false ||
        (nativeAudioTracks && nativeAudioTracks.length === 0);

      // If Chrome/WebKit reports decoded audio, normal playback is good.
      // Firefox doesn't expose webkitAudioDecodedByteCount; don't incorrectly
      // claim audio is present when Firefox explicitly reports no audio.
      if (hasDecodedAudio || (!explicitlyNoAudio && typeof decoded !== 'number')) {
        return;
      }

      await activateBackupAudio();
    }, 2500);
  }, [activateBackupAudio, selectedStream, resumeBackupAfterBuffer]);

  // ─── Seek bar ─────────────────────────────────────────────────────────────────
  const seekToPercent = useCallback((clientX: number, rect: DOMRect) => {
    const x = clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    return percent * duration;
  }, [duration]);

  const handleSeekBarMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    e.stopPropagation();
    seekBarDraggingRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const time = seekToPercent(e.clientX, rect);
    seekBarPreviewRef.current = time;
    setSeekBarPreview(time);

    const handleMouseMove = (ev: MouseEvent) => {
      if (!seekBarDraggingRef.current) return;
      const t = seekToPercent(ev.clientX, rect);
      seekBarPreviewRef.current = t;
      setSeekBarPreview(t);
    };
    const handleMouseUp = () => {
      if (!seekBarDraggingRef.current) return;
      seekBarDraggingRef.current = false;
      if (seekBarPreviewRef.current !== null && videoRef.current) {
        videoRef.current.currentTime = seekBarPreviewRef.current;
      }
      seekBarPreviewRef.current = null;
      setSeekBarPreview(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [duration, seekToPercent]);

  const handleSeekBarTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!duration) return;
    seekBarDraggingRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const time = seekToPercent(e.touches[0].clientX, rect);
    seekBarPreviewRef.current = time;
    setSeekBarPreview(time);
  }, [duration, seekToPercent]);

  const handleSeekBarTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!seekBarDraggingRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const time = seekToPercent(e.touches[0].clientX, rect);
    seekBarPreviewRef.current = time;
    setSeekBarPreview(time);
  }, [duration, seekToPercent]);

  const handleSeekBarTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!seekBarDraggingRef.current || !videoRef.current) return;
    seekBarDraggingRef.current = false;
    if (seekBarPreviewRef.current !== null) {
      videoRef.current.currentTime = seekBarPreviewRef.current;
    }
    seekBarPreviewRef.current = null;
    setSeekBarPreview(null);
  }, []);

  // ─── Touch gestures (swipe seek/volume + double-tap) ────────────────────────
  const clampPan = useCallback((px: number, py: number, zl: number) => {
    if (zl <= 1) return { x: 0, y: 0 };
    const maxPanX = (window.innerWidth * (zl - 1)) / (2 * zl);
    const maxPanY = (window.innerHeight * (zl - 1)) / (2 * zl);
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, px)),
      y: Math.max(-maxPanY, Math.min(maxPanY, py)),
    };
  }, []);

  const getTouchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Ignore touches on seek bar (handled separately)
    if ((e.target as HTMLElement).closest('[data-seekbar]')) return;

    if (displayMode === 'zoom') {
      if (e.touches.length === 2) {
        lastTouchDistRef.current = getTouchDistance(e.touches);
      } else if (e.touches.length === 1) {
        if (zoomLevel > 1) {
          isDraggingRef.current = true;
          lastDragRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
      }
      return;
    }

    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
    touchGestureRef.current = null;
  }, [displayMode, zoomLevel]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('[data-seekbar]')) return;

    if (displayMode === 'zoom') {
      if (e.touches.length === 2) {
        const dist = getTouchDistance(e.touches);
        if (lastTouchDistRef.current > 0) {
          const ratio = dist / lastTouchDistRef.current;
          setZoomLevel(prev => {
            const next = Math.max(1, Math.min(5, prev * ratio));
            if (next <= 1) setPanOffset({ x: 0, y: 0 });
            return next;
          });
        }
        lastTouchDistRef.current = dist;
      } else if (e.touches.length === 1 && isDraggingRef.current && zoomLevel > 1) {
        const dx = e.touches[0].clientX - lastDragRef.current.x;
        const dy = e.touches[0].clientY - lastDragRef.current.y;
        lastDragRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        setPanOffset(prev => clampPan(prev.x + dx, prev.y + dy, zoomLevel));
      }
      return;
    }

    if (!touchStartRef.current || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;

    // Swipe seek disabled – only double-tap skip is active
    if (!touchGestureRef.current || touchGestureRef.current === null) {
      if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
        touchGestureRef.current = 'none';
      } else {
        return;
      }
    }
  }, [displayMode, zoomLevel]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('[data-seekbar]')) return;
    if ((e.target as HTMLElement).closest('[data-controls]')) return;

    if (displayMode === 'zoom') {
      lastTouchDistRef.current = 0;
      isDraggingRef.current = false;
      return;
    }

    // Swipe seek disabled – only double-tap skip is active
    touchStartRef.current = null;
    touchGestureRef.current = null;

    // Handle tap / double-tap
    const touch = e.changedTouches[0];
    const now = Date.now();
    const timeSinceLastTap = now - lastTapTimeRef.current;
    const dist = Math.sqrt(
      Math.pow(touch.clientX - lastTapPosRef.current.x, 2) +
      Math.pow(touch.clientY - lastTapPosRef.current.y, 2)
    );
    const isDoubleTap = timeSinceLastTap < 300 && dist < 40;

    if (isDoubleTap) {
      // Cancel pending single-tap
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      // YouTube-style: left side = -10s, right side = +10s
      const screenWidth = window.innerWidth;
      if (touch.clientX < screenWidth / 2) {
        handleSkip(-10);
        setDoubleTapSide('left');
      } else {
        handleSkip(10);
        setDoubleTapSide('right');
      }
      if (doubleTapSideTimerRef.current) clearTimeout(doubleTapSideTimerRef.current);
      doubleTapSideTimerRef.current = setTimeout(() => setDoubleTapSide(null), 600);
      lastTapTimeRef.current = 0;
    } else {
      lastTapTimeRef.current = now;
      lastTapPosRef.current = { x: touch.clientX, y: touch.clientY };
      // Delay single-tap to check for double-tap
      singleTapTimerRef.current = setTimeout(() => {
        singleTapTimerRef.current = null;
        if (isPlayerLockedRef.current || showSettingsRef.current) return;
        // Toggle controls visibility (YouTube behaviour)
        if (showControlsRef.current) {
          scheduleHideControls();
        } else {
          revealControls();
        }
      }, 220);
    }
  }, [displayMode, handleSkip, revealControls, scheduleHideControls]);

  // ─── Mouse interactions ───────────────────────────────────────────────────────
  const handleControlsMouseEnter = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
  }, []);

  const handleControlsMouseLeave = useCallback(() => {
    scheduleHideControls();
  }, [scheduleHideControls]);

  const handleMouseMove = useCallback(() => {
    revealControls();
  }, [revealControls]);

  // Click on video = toggle play/pause (only on desktop; mobile uses touch)
  const handleVideoClick = useCallback((e: React.MouseEvent) => {
    if (showSettingsRef.current) return;
    if ((e.target as HTMLElement).closest('[data-controls]')) return;
    if (isMobileDevice()) return; // handled by touch
    handlePlayPause();
  }, [handlePlayPause]);

  // Double-click on desktop = fullscreen
  const lastClickTimeRef = useRef(0);
  const handleVideoDoubleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-controls]')) return;
    if (isMobileDevice()) return;
    handleToggleFullScreen();
  }, [handleToggleFullScreen]);

  // ─── Subtitle / Audio / Quality handlers ─────────────────────────────────────
  const handleSelectSubtitle = useCallback((index: number) => {
    const hls = hlsRef.current;
    const video = videoRef.current;
    if (!video) return;

    if (index === -1) {
      setSelectedTextTrack(-1);
      if (hls && hls.subtitleTracks.length > 0) {
        hls.subtitleTrack = -1;
      } else {
        const tracks = video.textTracks;
        for (let i = 0; i < tracks.length; i++) tracks[i].mode = 'disabled';
      }
      showToastMessage('Subtitles: Off');
      return;
    }

    setSelectedTextTrack(index);
    const selected = textTracks[index];
    if (selected?._external && selected?._uri) {
      const tracks = video.textTracks;
      for (let i = 0; i < tracks.length; i++) tracks[i].mode = 'disabled';
      const matching = Array.from(video.querySelectorAll('track')).find((el) =>
        (el.getAttribute('src') || '') === proxiedTextTrackUrl(selected._uri)
      ) as HTMLTrackElement | undefined;
      if (matching?.track) matching.track.mode = 'showing';
    } else if (hls && hls.subtitleTracks.length > 0) {
      hls.subtitleTrack = index;
      hls.subtitleDisplay = true;
    } else if (selected?._uri) {
      const track = textTracks[index];
      const trackEl = document.createElement('track');
      trackEl.kind = 'subtitles';
      trackEl.label = track.label || track.language || `Track ${index + 1}`;
      trackEl.srclang = track.language || 'en';
      trackEl.src = proxiedTextTrackUrl(track._uri || track.uri || track.src);
      trackEl.default = true;
      video.appendChild(trackEl);
      trackEl.track.mode = 'showing';
    }
    const name = hls?.subtitleTracks[index]?.name || textTracks[index]?.label ||
      textTracks[index]?.language || `Track ${index + 1}`;
    showToastMessage(`Subtitle: ${name}`);
  }, [textTracks, showToastMessage]);

  const handleSelectAudioTrack = useCallback((index: number) => {
    const hls = hlsRef.current;
    const video = videoRef.current;
    if (!video) return;

    if (hls && hls.audioTracks.length > 0) {
      hls.audioTrack = index;
      setSelectedAudioTrack(index);
      showToastMessage(`Audio: ${audioTrackLabel(hls.audioTracks[index], index)}`);
      return;
    }
    const nativeTracks = (video as any).audioTracks;
    if (nativeTracks && nativeTracks.length > index) {
      for (let i = 0; i < nativeTracks.length; i++) {
        try { nativeTracks[i].enabled = i === index; } catch { /* unsupported */ }
      }
      setSelectedAudioTrack(index);
      showToastMessage(`Audio: ${audioTrackLabel(audioTracks[index], index)}`);
      return;
    }
    showToastMessage('This source has only one audio track in-browser');
  }, [showToastMessage, audioTracks]);

  const handleSelectQuality = useCallback((quality: string) => {
    const hls = hlsRef.current;
    if (!hls) return;

    const isLevelSupported = (levelIndex: number): boolean => {
      const cached = codecProbeResultRef.current.get(levelIndex);
      if (cached !== undefined) return cached;
      const codec = (hls.levels[levelIndex] as any)?.audioCodec;
      return isAudioCodecSupported(codec);
    };

    if (quality === 'auto') {
      hls.currentLevel = -1;
      hls.autoLevelCapping = supportedTopRef.current >= 0 ? supportedTopRef.current : -1;
      setSelectedQuality(-1);
      showToastMessage('Quality: Auto');
    } else {
      const height = Number(quality);
      const levelIndex = hls.levels.findIndex((l) => l.height === height);
      if (levelIndex !== -1) {
        const codecOk = isLevelSupported(levelIndex);
        const cap = supportedTopRef.current;
        if (!codecOk && cap >= 0 && cap < levelIndex) {
          hls.autoLevelCapping = cap;
          hls.currentLevel = cap;
          setSelectedQuality(cap);
          const requestedHeight = hls.levels[levelIndex]?.height;
          const actualHeight = hls.levels[cap]?.height;
          showToastMessage(
            `${formatQuality(String(requestedHeight))} unsupported audio → ${formatQuality(String(actualHeight))}`
          );
        } else {
          hls.autoLevelCapping = levelIndex;
          hls.currentLevel = levelIndex;
          setSelectedQuality(levelIndex);
          showToastMessage(`Quality: ${formatQuality(quality)}`);
        }
      }
    }
  }, [formatQuality, showToastMessage, isAudioCodecSupported]);

  // ─── HLS / Source setup ───────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedStream) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setAudioTracks([]);
    setTextTracks([]);
    setQualityLevels([]);
    setSelectedAudioTrack(-1);
    setSelectedTextTrack(-1);
    setSelectedQuality(-1);

    const url = playbackUrl(selectedStream);

    // Vega providers can expose subtitles separately from the HLS manifest.
    // Add them as native <track> elements so they work on both desktop and mobile.
    const externalTracks: HTMLTrackElement[] = [];
    const providerSubtitles = Array.isArray(selectedStream.subtitles) ? selectedStream.subtitles : [];
    providerSubtitles.forEach((track: any, index: number) => {
      const src = track?.uri || track?.url || track?.link;
      if (!src) return;
      const el = document.createElement('track');
      el.kind = 'subtitles';
      el.label = track?.title || track?.label || track?.language || `Subtitle ${index + 1}`;
      el.srclang = track?.language || 'en';
      el.src = proxiedTextTrackUrl(src);
      el.default = false;
      video.appendChild(el);
      externalTracks.push(el);
    });
    if (externalTracks.length > 0) {
      setTextTracks(providerSubtitles.map((track: any, index: number) => ({
        name: track?.title || track?.label || track?.language || `Subtitle ${index + 1}`,
        language: track?.language || 'en',
        _uri: track?.uri || track?.url || track?.link,
        _external: true,
      })));
    }

    const syncNativeAudio = () => {
      const nt = (video as any).audioTracks;
      if (nt && nt.length > 1 && (!hlsRef.current || hlsRef.current.audioTracks.length === 0)) {
        const native = Array.from(nt).map((t: any, i: number) => ({
          name: t.label || t.language || `Track ${i + 1}`,
          language: t.language,
          _native: true,
        }));
        setAudioTracks(native);
      }
    };
    video.addEventListener('loadedmetadata', syncNativeAudio);

    if (isHlsUrl(url) && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false, startLevel: -1 });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        const levels = data.levels || [];
        setQualityLevels(levels);
        setAudioTracks(hls.audioTracks || []);
        setTextTracks([...(hls.subtitleTracks || []), ...providerSubtitles.map((track: any, index: number) => ({
          name: track?.title || track?.label || track?.language || `Subtitle ${index + 1}`,
          language: track?.language || 'en',
          _uri: track?.uri || track?.url || track?.link,
          _external: true,
        }))]);

        const staticSupported = levels
          .map((l, i) => ({ i, ok: !isCodecLikelyUnsupported(extractAudioCodec(l)) }))
          .filter((x) => x.ok)
          .map((x) => x.i);
        supportedTopRef.current =
          staticSupported.length > 0 ? staticSupported[staticSupported.length - 1] : -1;
        if (supportedTopRef.current >= 0) hls.autoLevelCapping = supportedTopRef.current;

        if (probeCancelRef.current) probeCancelRef.current();
        const probe = probeAllLevels(levels, (_idx, supported, newHighest) => {
          supportedTopRef.current = newHighest;
          if (hls.autoLevelEnabled && newHighest >= 0) hls.autoLevelCapping = newHighest;
          if (!supported && hls.currentLevel >= 0 && hls.currentLevel === _idx && newHighest >= 0) {
            hls.currentLevel = newHighest;
            setSelectedQuality(newHighest);
            const to = hls.levels[newHighest]?.height;
            showToastMessage(`Audio codec unsupported → ${formatQuality(String(to || 'auto'))}`);
          }
        });
        probeCancelRef.current = probe.cancel;
        probe.promise.then(({ supported }) => { codecProbeResultRef.current = supported; });

        if (hls.subtitleTracks.length > 0) hls.subtitleTrack = -1;
        if (hls.audioTracks.length > 0 && hls.audioTrack < 0) {
          const preferred = hls.audioTracks.findIndex((t: any) => !isCodecLikelyUnsupported(t?.audioCodec || t?.codec));
          const first = preferred >= 0 ? preferred : 0;
          hls.audioTrack = first;
          setSelectedAudioTrack(first);
          if (preferred < 0) showToastMessage('Audio codec may not be supported by this browser');
        }
      });

      hls.on(Hls.Events.FRAG_BUFFERED, () => resumeBackupAfterBuffer());

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => setCurrentLevel(data.level));

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
        const tracks = data.audioTracks || [];
        setAudioTracks(tracks);
        if (tracks.length > 0 && hls.audioTrack < 0) {
          const preferred = tracks.findIndex((t: any) => !isCodecLikelyUnsupported(t?.audioCodec || t?.codec));
          const first = preferred >= 0 ? preferred : 0;
          hls.audioTrack = first;
          setSelectedAudioTrack(first);
        }
      });

      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
        setTextTracks([...(data.subtitleTracks || []), ...providerSubtitles.map((track: any, index: number) => ({
          name: track?.title || track?.label || track?.language || `Subtitle ${index + 1}`,
          language: track?.language || 'en',
          _uri: track?.uri || track?.url || track?.link,
          _external: true,
        }))]);
      });

      hls.on(Hls.Events.FRAG_LOADING, () => handleBuffering());

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (
          data.type === Hls.ErrorTypes.NETWORK_ERROR ||
          data.type === Hls.ErrorTypes.MEDIA_ERROR
        ) {
          if (!hls.autoLevelEnabled && hls.currentLevel > 0) {
            const lower = hls.currentLevel - 1;
            hls.currentLevel = lower;
            setSelectedQuality(lower);
            showToastMessage(
              `Quality failed → ${formatQuality(String(hls.levels[lower]?.height || 'auto'))}`
            );
            return;
          }
          if (hls.autoLevelEnabled && hls.levels.length > 1) {
            const cap = hls.autoLevelCapping;
            const newCap = cap > 0 ? cap - 1 : hls.levels.length - 2;
            if (newCap >= 0) {
              hls.autoLevelCapping = newCap;
              showToastMessage(
                `Quality issue → limited to ${formatQuality(String(hls.levels[newCap]?.height || 'auto'))}`
              );
              hls.startLoad();
              return;
            }
          }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else hls.recoverMediaError();
          return;
        }
        hls.destroy();
        handleVideoError();
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
    } else {
      video.src = url;
      const handleNativeMeta = () => {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (h > 0 && qualityLevels.length === 0) {
          setQualityLevels([{ height: h, width: w }]);
          setSelectedQuality(0);
        }
      };
      video.addEventListener('loadedmetadata', handleNativeMeta);
    }

    return () => {
      video.removeEventListener('loadedmetadata', syncNativeAudio);
      externalTracks.forEach((track) => {
        try { track.remove(); } catch { /* ignore */ }
      });
      if (probeCancelRef.current) { probeCancelRef.current(); probeCancelRef.current = null; }
      codecProbeResultRef.current.clear();
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (audioCheckTimerRef.current) { clearTimeout(audioCheckTimerRef.current); audioCheckTimerRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStream]);

  // ─── Loading / Error states ───────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex-1 min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div
            className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center"
            style={{ backgroundColor: primary + '12', border: `1.5px solid ${primary}25` }}
          >
            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke={primary}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-white/80 text-base font-medium">Preparing your stream...</p>
          <p className="text-white/30 text-xs mt-2">Fetching available sources</p>
        </div>
      </div>
    );
  }

  if (error || !selectedStream) {
    return (
      <div className="flex-1 min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center p-8">
          <div className="w-20 h-20 mx-auto mb-5 rounded-2xl flex items-center justify-center glass-card">
            <svg className="w-10 h-10 text-error/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p className="text-white/80 text-lg font-semibold mt-2">We couldn't start playback</p>
          <p className="text-white/50 text-sm mt-2 max-w-sm mx-auto">The content source didn't return a playable server. Try again or choose another source.</p>
          <div className="flex items-center justify-center gap-3 mt-6">
            <button
              onClick={() => refetch()}
              className="px-5 py-3 rounded-xl font-semibold text-sm transition hover:scale-[1.02] active:scale-[0.98]"
              style={{ backgroundColor: primary, color: '#000' }}
            >
              Try again
            </button>
            <button
              onClick={() => navigate('/extensions')}
              className="px-5 py-3 rounded-xl text-white/75 font-semibold text-sm glass-card hover:bg-white/5 transition-colors"
            >
              Change source
            </button>
          </div>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 px-4 py-2 text-white/45 hover:text-white text-sm transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="player-shell flex-1 min-h-[100dvh] bg-black relative select-none overflow-hidden"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { if (!showSettings && !isPlayerLocked) setShowControls(false); }}
      onClick={handleVideoClick}
      onDoubleClick={handleVideoDoubleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Video ── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="player-video w-full h-full min-h-[100dvh]"
        style={{
          objectFit: displayMode === 'fit' ? 'contain' : 'cover',
          transform:
            displayMode === 'zoom' && zoomLevel > 1
              ? `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`
              : undefined,
          transformOrigin: 'center center',
          transition: 'transform 0.1s ease-out',
        }}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={(e) => setDuration((e.target as HTMLVideoElement).duration || 0)}
        onError={() => { if (!hlsRef.current) handleVideoError(); }}
        onWaiting={handleBuffering}
        onPlaying={handlePlaying}
        onCanPlay={handleCanPlay}
        onProgress={handleProgress}
        onSeeking={() => {
          const a = backupAudioRef.current;
          if (a && backupAudioActiveRef.current) { try { a.pause(); } catch { /* ignore */ } }
        }}
        onPause={() => { backupAudioRef.current?.pause(); setIsPlaying(false); setShowCenterPlay(true); }}
        onPlay={() => { primeBackupAudio(); setIsPlaying(true); setShowCenterPlay(false); }}
      />

      {backupAudioLabel && showControls && !isPlayerLocked && (
        <div className="absolute left-4 top-4 z-40 rounded-full bg-black/65 backdrop-blur-md border border-white/10 px-3 py-1.5 text-xs text-white/85">
          Backup audio · {backupAudioLabel}
        </div>
      )}

      {/* ── Gradient overlays (always visible) ── */}
      <div
        className="absolute inset-x-0 top-0 h-28 pointer-events-none z-10 transition-opacity duration-300"
        style={{
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)',
          opacity: showControls && !isPlayerLocked ? 1 : 0,
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-36 pointer-events-none z-10 transition-opacity duration-300"
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)',
          opacity: showControls && !isPlayerLocked ? 1 : 0,
        }}
      />

      {/* ── Buffering spinner (always on top, no controls dependency) ── */}
      {isBuffering && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div
            className="w-14 h-14 rounded-full border-[3px] animate-spin"
            style={{
              borderColor: `${primary}33`,
              borderTopColor: primary,
            }}
          />
        </div>
      )}

      {/* ── Centre play/pause icon (YouTube-style flash) ── */}
      {centerPlayAnim && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(8px)',
              animation: 'yt-center-flash 0.4s ease-out forwards',
            }}
          >
            {isPlaying ? (
              // Was paused → now playing → show play icon
              <svg className="w-10 h-10 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
                <rect x="5" y="4" width="4" height="16" rx="1" />
                <rect x="15" y="4" width="4" height="16" rx="1" />
              </svg>
            )}
          </div>
        </div>
      )}

      {/* ── Double-tap ripple (YouTube-style) ── */}
      {doubleTapSide && (
        <div
          className="absolute inset-y-0 z-30 flex items-center justify-center pointer-events-none"
          style={{
            left: doubleTapSide === 'left' ? 0 : '50%',
            right: doubleTapSide === 'right' ? 0 : '50%',
            background:
              doubleTapSide === 'left'
                ? 'radial-gradient(ellipse at left center, rgba(255,255,255,0.15) 0%, transparent 70%)'
                : 'radial-gradient(ellipse at right center, rgba(255,255,255,0.15) 0%, transparent 70%)',
            animation: 'yt-doubletap-fade 0.6s ease-out forwards',
          }}
        >
          <div className="flex flex-col items-center gap-1" style={{ marginLeft: doubleTapSide === 'right' ? '20%' : undefined, marginRight: doubleTapSide === 'left' ? '20%' : undefined }}>
            <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
              {doubleTapSide === 'left' ? (
                <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
              ) : (
                <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
              )}
            </svg>
            <span className="text-white text-xs font-bold">
              {doubleTapSide === 'left' ? '-10s' : '+10s'}
            </span>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {showToast && (
        <div
          className="absolute top-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] left-1/2 -translate-x-1/2 z-[70] px-4 py-2 rounded-xl text-sm font-medium text-white pointer-events-none max-w-[calc(100vw-2rem)] truncate"
          style={{
            backgroundColor: 'rgba(0,0,0,0.78)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.08)',
            animation: 'yt-toast 0.2s ease-out',
          }}
        >
          {toastMessage}
        </div>
      )}



      {/* ─────────────────────────────────────────────────────────────────────────
          CONTROLS (shown/hidden like YouTube)
      ───────────────────────────────────────────────────────────────────────── */}
      <div
        data-controls
        className="absolute inset-0 z-40 pointer-events-none"
        style={{
          opacity: showControls && !isPlayerLocked ? 1 : 0,
          transition: 'opacity 0.25s ease',
        }}
      >
        {/* ── Back button ── */}
        <div
          className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 sm:left-4 pointer-events-auto"
          onMouseEnter={handleControlsMouseEnter}
          onMouseLeave={handleControlsMouseLeave}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleBackNavigation();
            }}
            className="w-11 h-11 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-all active:scale-95"
            style={{ backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }}
            aria-label="Go back"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* ── Title ── */}
        {contentTitle && (
          <div className="absolute top-[max(0.85rem,env(safe-area-inset-top))] left-14 sm:left-16 right-14 sm:right-16 pointer-events-none">
            <p className="text-white font-semibold text-sm truncate drop-shadow">{contentTitle}</p>
            {episodeTitle && (
              <p className="text-white/60 text-xs truncate mt-0.5">{episodeTitle}</p>
            )}
          </div>
        )}

        {/* ── Centre skip buttons ── */}
        <div className="absolute inset-0 flex items-center justify-between px-[12%] pointer-events-none">
          <button
            onClick={(e) => { e.stopPropagation(); handleSkip(-10); }}
            className="flex flex-col items-center gap-1 opacity-80 hover:opacity-100 transition-opacity active:scale-95 pointer-events-auto"
            aria-label="Rewind 10 seconds"
            onMouseEnter={handleControlsMouseEnter}
            onMouseLeave={handleControlsMouseLeave}
          >
            <svg className="w-10 h-10 text-white drop-shadow-lg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.5 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7V7l-4-4 4-4v3.05c.17-.02.34-.05.5-.05z"/>
              <text x="8.5" y="14.5" fontSize="6" fontWeight="bold" fill="white" fontFamily="sans-serif">10</text>
            </svg>
            <span className="text-white text-xs font-semibold drop-shadow">10s</span>
          </button>

          {/* Centre play/pause button */}
          <button
            onClick={(e) => { e.stopPropagation(); handlePlayPause(); }}
            className="w-16 h-16 rounded-full flex items-center justify-center text-white transition-all active:scale-90 hover:scale-105 pointer-events-auto"
            style={{ backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            onMouseEnter={handleControlsMouseEnter}
            onMouseLeave={handleControlsMouseLeave}
          >
            {isPlaying ? (
              <svg className="w-9 h-9" fill="currentColor" viewBox="0 0 24 24">
                <rect x="5" y="4" width="4" height="16" rx="1" />
                <rect x="15" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg className="w-9 h-9 ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); handleSkip(10); }}
            className="flex flex-col items-center gap-1 opacity-80 hover:opacity-100 transition-opacity active:scale-95 pointer-events-auto"
            aria-label="Forward 10 seconds"
            onMouseEnter={handleControlsMouseEnter}
            onMouseLeave={handleControlsMouseLeave}
          >
            <svg className="w-10 h-10 text-white drop-shadow-lg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.5 3a9 9 0 1 1-9 9h2a7 7 0 1 0 7-7V7l4-4-4-4v3.05c-.17-.02-.34-.05-.5-.05z"/>
              <text x="8.5" y="14.5" fontSize="6" fontWeight="bold" fill="white" fontFamily="sans-serif">10</text>
            </svg>
            <span className="text-white text-xs font-semibold drop-shadow">10s</span>
          </button>
        </div>

        {/* ── Bottom bar ── */}
        <div
          className="absolute bottom-0 left-0 right-0 pointer-events-auto px-4 pb-4 pt-2"
          onMouseEnter={handleControlsMouseEnter}
          onMouseLeave={handleControlsMouseLeave}
        >
          {/* Progress / seek bar */}
          <div
            data-seekbar
            className="relative w-full mb-3 cursor-pointer group"
            style={{ paddingTop: 12, paddingBottom: 12 }}
            onMouseDown={handleSeekBarMouseDown}
            onMouseEnter={() => setIsSeekBarHovered(true)}
            onMouseLeave={() => setIsSeekBarHovered(false)}
            onTouchStart={handleSeekBarTouchStart}
            onTouchMove={handleSeekBarTouchMove}
            onTouchEnd={handleSeekBarTouchEnd}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Track */}
            <div
              className="absolute left-0 right-0 rounded-full overflow-hidden transition-all duration-150"
              style={{
                height: isSeekBarHovered || seekBarDraggingRef.current ? 5 : 3,
                top: '50%',
                transform: 'translateY(-50%)',
                backgroundColor: 'rgba(255,255,255,0.2)',
              }}
            >
              {/* Buffered */}
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${bufferedPercent}%`,
                  backgroundColor: 'rgba(255,255,255,0.35)',
                }}
              />
              {/* Played */}
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${displayPercent}%`,
                  backgroundColor: primary,
                  transition: seekBarDraggingRef.current ? 'none' : 'width 0.1s linear',
                }}
              />
            </div>

            {/* Thumb */}
            <div
              className="absolute rounded-full shadow-lg transition-all duration-150 pointer-events-none"
              style={{
                width: isSeekBarHovered || seekBarDraggingRef.current ? 14 : 0,
                height: isSeekBarHovered || seekBarDraggingRef.current ? 14 : 0,
                top: '50%',
                left: `${displayPercent}%`,
                transform: 'translate(-50%, -50%)',
                backgroundColor: primary,
                opacity: isSeekBarHovered || seekBarDraggingRef.current ? 1 : 0,
              }}
            />

            {/* Time tooltip */}
            {seekBarPreview !== null && (
              <div
                className="absolute -top-9 px-2 py-1 rounded-lg text-xs font-medium text-white pointer-events-none"
                style={{
                  left: `${(seekBarPreview / duration) * 100}%`,
                  transform: 'translateX(-50%)',
                  backgroundColor: 'rgba(0,0,0,0.85)',
                  backdropFilter: 'blur(8px)',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatTime(seekBarPreview)}
              </div>
            )}
          </div>

          {/* Controls row */}
          <div className="flex items-center justify-between">
            {/* Left controls */}
            <div className="flex items-center gap-3">
              {/* Play/Pause */}
              <button
                onClick={(e) => { e.stopPropagation(); handlePlayPause(); }}
                className="text-white hover:text-white/80 transition-colors active:scale-95"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="5" y="4" width="4" height="16" rx="1" />
                    <rect x="15" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              {/* Volume */}
              <div className="relative group/vol flex items-center">
                <button
                  onClick={(e) => { e.stopPropagation(); handleToggleMute(); }}
                  className="text-white hover:text-white/80 transition-colors active:scale-95"
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    {isMuted || volume === 0 ? (
                      <>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                      </>
                    ) : (
                      <>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728" />
                      </>
                    )}
                  </svg>
                </button>

                {/* Volume slider (hover) */}
                <div
                  className="
                    absolute bottom-full left-1/2 -translate-x-1/2 mb-2
                    px-3 pt-2 pb-3 rounded-xl
                    opacity-0 pointer-events-none
                    group-hover/vol:opacity-100 group-hover/vol:pointer-events-auto
                    transition-opacity duration-150
                  "
                  style={{
                    backgroundColor: 'rgba(20,20,20,0.92)',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => handleVolumeChange(Number(e.target.value))}
                    className="vega-volume cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, ${primary} ${(isMuted ? 0 : volume) * 100}%, rgba(255,255,255,0.15) ${(isMuted ? 0 : volume) * 100}%)`,
                    }}
                    aria-label="Volume"
                  />
                </div>
              </div>

              {/* Time */}
              <span className="text-white/85 text-sm font-medium tabular-nums select-none">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-3">
              {/* Lock */}
              <button
                onClick={(e) => { e.stopPropagation(); handleToggleLock(); }}
                className="text-white hover:text-white/80 transition-colors active:scale-95"
                aria-label="Lock controls"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M8 11V7a4 4 0 118 0v4m-9 8h10a2 2 0 002-2v-5a2 2 0 00-2-2H7a2 2 0 00-2 2v5a2 2 0 002 2z" />
                </svg>
              </button>

              {/* Servers */}
              <button
                onClick={(e) => { e.stopPropagation(); setActiveTab('server'); setShowSettings(true); }}
                className="text-white hover:text-white/80 transition-colors active:scale-95 flex items-center gap-1"
                aria-label="Select server"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M5 12h14M5 12a2 2 0 11-4 0 2 2 0 014 0zm14 0a2 2 0 11-4 0 2 2 0 014 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M7 12V7a2 2 0 012-2h6a2 2 0 012 2v5m-8 0v5a2 2 0 002 2h4a2 2 0 002-2v-5" />
                </svg>
                {streams.length > 1 && (
                  <span className="text-xs font-bold">{streams.length}</span>
                )}
              </button>

              {/* Settings */}
              <button
                onClick={(e) => { e.stopPropagation(); setActiveTab('main'); setShowSettings(s => !s); }}
                className="text-white hover:text-white/80 transition-colors active:scale-95"
                aria-label="Settings"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

              {/* PiP */}
              <button
                onClick={(e) => { e.stopPropagation(); handlePiP(); }}
                className="text-white hover:text-white/80 transition-colors active:scale-95 hidden sm:block"
                aria-label="Picture in Picture"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M4 8V6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2h-3" />
                  <rect x="2" y="12" width="10" height="7" rx="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {/* Fullscreen */}
              <button
                onClick={(e) => { e.stopPropagation(); handleToggleFullScreen(); }}
                className="text-white hover:text-white/80 transition-colors active:scale-95"
                aria-label={isFullScreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  {isFullScreen ? (
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M9 4H4v5M15 4h5v5M9 20H4v-5M20 15v5h-5" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Locked overlay ── */}
      {isPlayerLocked && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleToggleLock}
            className="w-16 h-16 rounded-2xl flex items-center justify-center transition-all active:scale-95 hover:scale-105"
            style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(12px)', border: '1.5px solid rgba(255,255,255,0.15)' }}
            aria-label="Unlock controls"
          >
            <svg className="w-7 h-7 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Settings panel ── */}
      {showSettings && (
        <>
          {/* Backdrop */}
          <div
            className="absolute inset-0 z-40"
            onClick={() => { setShowSettings(false); setActiveTab('main'); }}
          />

          {/* Panel */}
          <div
            className="absolute bottom-[max(1rem,env(safe-area-inset-bottom)+0.75rem)] right-3 sm:right-4 z-[60] w-[min(22rem,calc(100vw-1.5rem))] max-h-[min(78dvh,38rem)] max-md:left-3 max-md:right-3 max-md:w-auto max-md:bottom-[max(0.75rem,env(safe-area-inset-bottom)+0.5rem)] rounded-2xl overflow-hidden"
            style={{
              backgroundColor: 'rgba(18,18,18,0.97)',
              backdropFilter: 'blur(24px)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
              animation: 'yt-panel-in 0.2s ease-out',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07]">
              {activeTab !== 'main' ? (
                <button
                  onClick={() => setActiveTab('main')}
                  className="text-white/60 hover:text-white transition-colors"
                  aria-label="Back"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              ) : (
                <svg className="w-4 h-4 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
              <span className="text-white/80 text-xs font-bold tracking-widest uppercase">
                {activeTab === 'main' ? 'Settings'
                  : activeTab === 'speed' ? 'Playback Speed'
                  : activeTab === 'quality' ? 'Quality'
                  : activeTab === 'subtitle' ? 'Subtitles / CC'
                  : activeTab === 'audio' ? 'Audio Track'
                  : activeTab === 'server' ? 'Server'
                  : activeTab === 'display' ? 'Frame Display'
                  : 'Video Info'}
              </span>
              <button
                onClick={() => { setShowSettings(false); setActiveTab('main'); }}
                className="text-white/40 hover:text-white transition-colors"
                aria-label="Close settings"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="overflow-y-auto overscroll-contain" style={{ maxHeight: 'calc(min(70dvh, 34rem) - 52px)' }}>
              {/* ── Main menu ── */}
              {activeTab === 'main' && (
                <div className="py-1">
                  {[
                    { label: 'Playback Speed', value: currentSpeedLabel, tab: 'speed' as const },
                    { label: 'Quality', value: currentQualityLabel, tab: 'quality' as const },
                    { label: 'Subtitles / CC', value: currentSubtitleLabel, tab: 'subtitle' as const },
                    { label: 'Audio Track', value: audioTracks.length > 0 ? `${audioTracks.length} tracks` : '—', tab: 'audio' as const },
                    { label: 'Frame Display', value: displayMode === 'fit' ? 'Fit' : displayMode === 'fill' ? 'Fill' : 'Zoom', tab: 'display' as const },
                    { label: 'Server', value: `${selectedStream?.server || '—'}${streams.length > 1 ? ` (${streams.length})` : ''}`, tab: 'server' as const },
                    { label: 'Video Info', value: '', tab: 'videoinfo' as const },
                  ].map(({ label, value, tab }) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.06] transition-colors"
                    >
                      <span className="text-white text-sm">{label}</span>
                      <div className="flex items-center gap-1.5 text-white/45 text-sm">
                        {value && <span>{value}</span>}
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>
                  ))}
                  <div className="border-t border-white/[0.06] my-1" />
                  <button
                    onClick={() => { handlePiP(); setShowSettings(false); }}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.06] transition-colors"
                  >
                    <span className="text-white text-sm">Picture in Picture</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const video = videoRef.current;
                      if (!video || !video.src) return;
                      const a = document.createElement('a');
                      a.href = video.src;
                      a.download = `${contentTitle || 'video'}.mp4`;
                      a.click();
                      showToastMessage('Starting download...');
                      setShowSettings(false);
                    }}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.06] transition-colors"
                  >
                    <span className="text-white text-sm">Download</span>
                  </button>
                </div>
              )}

              {/* ── Speed ── */}
              {activeTab === 'speed' && (
                <div className="py-1">
                  {playbacks.map((rate) => (
                    <button
                      key={rate}
                      onClick={() => { setPlaybackRate(rate); setShowSettings(false); setActiveTab('main'); }}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.06] transition-colors"
                    >
                      <span className={playbackRate === rate ? 'text-white font-semibold text-sm' : 'text-white/70 text-sm'}>
                        {rate === 1 ? 'Normal' : `${rate}x`}
                      </span>
                      {playbackRate === rate && (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke={primary} strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* ── Quality ── */}
              {activeTab === 'quality' && (
                <div className="py-1">
                  {qualityOptions.map((q) => {
                    const isActive = (q === 'auto' && selectedQuality === -1) ||
                      (q !== 'auto' && qualityLevels[selectedQuality]?.height?.toString() === q);
                    const level = q !== 'auto' ? qualityLevels.find((l: any) => String(l.height) === q) : undefined;
                    const levelIdx = level ? qualityLevels.indexOf(level) : -1;
                    const noAudio = level
                      ? !(codecProbeResultRef.current.get(levelIdx) ?? isAudioCodecSupported((level as any).audioCodec))
                      : false;
                    return (
                      <button
                        key={q}
                        onClick={() => { handleSelectQuality(q); setShowSettings(false); setActiveTab('main'); }}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.06] transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <span className={isActive ? 'text-white font-semibold text-sm' : 'text-white/70 text-sm'}>
                            {formatQuality(q)}
                          </span>
                          {noAudio && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-semibold">
                              no audio
                            </span>
                          )}
                        </span>
                        {isActive && (
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke={primary} strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* ── Subtitles ── */}
              {activeTab === 'subtitle' && (
                <div className="py-1">
                  <button
                    onClick={() => { handleSelectSubtitle(-1); setShowSettings(false); setActiveTab('main'); }}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.06] transition-colors"
                  >
                    <span className={selectedTextTrack === -1 ? 'text-white font-semibold text-sm' : 'text-white/70 text-sm'}>Off</span>
                    {selectedTextTrack === -1 && (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke={primary} strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  {textTracks.map((track: any, i: number) => (
                    <button
                      key={i}
                      onClick={() => { handleSelectSubtitle(i); setShowSettings(false); setActiveTab('main'); }}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.06] transition-colors"
                    >
                      <span className={selectedTextTrack === i ? 'text-white font-semibold text-sm' : 'text-white/70 text-sm'}>
                        {track.name || track.lang || track.language || track.label || `Track ${i + 1}`}
                      </span>
                      {selectedTextTrack === i && (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke={primary} strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                  {textTracks.length === 0 && (
                    <p className="text-white/35 text-sm text-center py-8">No subtitles available</p>
                  )}
                </div>
              )}

              {/* ── Audio ── */}
              {activeTab === 'audio' && (
                <div className="py-1">
                  {audioTracks.map((track: any, i: number) => (
                    <button
                      key={i}
                      onClick={() => { handleSelectAudioTrack(i); setShowSettings(false); setActiveTab('main'); }}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.06] transition-colors"
                    >
                      <span className={selectedAudioTrack === i ? 'text-white font-semibold text-sm' : 'text-white/70 text-sm'}>
                        {track.name || track.lang || track.language || `Track ${i + 1}`}
                      </span>
                      {selectedAudioTrack === i && (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke={primary} strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                  {audioTracks.length === 0 && (
                    <p className="text-white/35 text-sm text-center py-8">No audio tracks available</p>
                  )}
                </div>
              )}

              {/* ── Server ── */}
              {activeTab === 'server' && (
                <div className="py-1">
                  {streams.map((stream: any, i: number) => (
                    <button
                      key={i}
                      onClick={() => { setSelectedStream(stream); setShowSettings(false); setActiveTab('main'); }}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.06] transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <span className={selectedStream?.link === stream.link ? 'text-white font-semibold text-sm' : 'text-white/70 text-sm'}>
                          {stream.server || `Server ${i + 1}`}
                          <span className="ml-2 text-[10px] text-white/35">
                            {stream.quality || stream.type || 'source'}
                          </span>
                        </span>
                        {stream.quality && (
                          <span className="text-white/35 text-xs">{stream.quality}</span>
                        )}
                      </span>
                      {selectedStream?.link === stream.link && (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke={primary} strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                  {streams.length === 0 && (
                    <p className="text-white/35 text-sm text-center py-8">No servers available</p>
                  )}
                </div>
              )}

              {/* ── Display ── */}
              {activeTab === 'display' && (
                <div className="py-1">
                  {displayModes.map((mode) => (
                    <button
                      key={mode}
                      onClick={() => {
                        setDisplayMode(mode);
                        if (mode !== 'zoom') { setShowSettings(false); setActiveTab('main'); }
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.06] transition-colors"
                    >
                      <div className="flex flex-col items-start gap-0.5">
                        <span className={displayMode === mode ? 'text-white font-semibold text-sm' : 'text-white/70 text-sm'}>
                          {mode === 'fit' ? 'Fit (Contain)' : mode === 'fill' ? 'Fill (Cover)' : 'Zoom'}
                        </span>
                        <span className="text-white/30 text-[11px]">
                          {mode === 'fit'
                            ? 'Show entire frame, letterboxed'
                            : mode === 'fill'
                            ? 'Fill screen, may crop edges'
                            : 'Pinch/scroll to zoom, double-tap to toggle'}
                        </span>
                      </div>
                      {displayMode === mode && (
                        <svg className="w-5 h-5 shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke={primary} strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                  {displayMode === 'zoom' && (
                    <div className="px-4 pb-4 pt-2">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white/50 text-xs font-medium">Zoom Level</span>
                        <span className="text-white text-xs font-bold tabular-nums">{zoomLevel.toFixed(1)}×</span>
                      </div>
                      <input
                        type="range" min={1} max={5} step={0.1} value={zoomLevel}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setZoomLevel(val);
                          if (val <= 1) setPanOffset({ x: 0, y: 0 });
                        }}
                        className="w-full h-1 rounded-full appearance-none cursor-pointer"
                        style={{
                          background: `linear-gradient(to right, ${primary} ${((zoomLevel - 1) / 4) * 100}%, rgba(255,255,255,0.15) ${((zoomLevel - 1) / 4) * 100}%)`,
                        }}
                      />
                      {zoomLevel > 1 && (
                        <button
                          onClick={() => { setZoomLevel(1); setPanOffset({ x: 0, y: 0 }); }}
                          className="mt-3 w-full py-1.5 text-xs text-white/50 hover:text-white/80 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
                        >
                          Reset Zoom
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Video Info ── */}
              {activeTab === 'videoinfo' && (
                <div className="py-2 px-2">
                  {[
                    { label: 'Title', value: contentTitle || 'Unknown' },
                    { label: 'Type', value: seasonIndex != null ? 'Series' : 'Movie' },
                    { label: 'Quality', value: currentQualityLabel },
                    {
                      label: 'Audio',
                      value: selectedQuality >= 0 && qualityLevels[selectedQuality]
                        ? ((codecProbeResultRef.current.get(selectedQuality) ??
                            isAudioCodecSupported((qualityLevels[selectedQuality] as any).audioCodec))
                            ? 'Supported'
                            : 'Unsupported codec')
                        : 'Auto (highest with sound)',
                    },
                    { label: 'Server', value: selectedStream?.server || '—' },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between px-2 py-2.5 border-b border-white/[0.05] last:border-0">
                      <span className="text-white/45 text-sm">{label}</span>
                      <span className="text-white text-sm font-medium text-right max-w-[60%] truncate">{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── CSS animations (injected inline to avoid requiring a CSS file edit) ── */}
      <style>{`
        @keyframes yt-center-flash {
          0%   { opacity: 1; transform: scale(1); }
          60%  { opacity: 0.8; transform: scale(1.15); }
          100% { opacity: 0; transform: scale(1.3); }
        }
        @keyframes yt-doubletap-fade {
          0%   { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes yt-panel-in {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes yt-toast {
          from { opacity: 0; transform: translateX(-50%) translateY(-6px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default Player;