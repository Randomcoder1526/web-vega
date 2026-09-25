import Hls from "hls.js";
import { MediaPlayer } from "dashjs";
import { mediaProxyUrl } from "./runtime";
import { planBackupAudioSync } from "../lib/playback/audioSync";

export type MpvObservableProperty = readonly [string, string, ...(string[])];
type PropertyCallback = (change: { name: string; data: any }) => void;
type EventCallback = (event: any) => void;

let video: HTMLVideoElement | null = null;
let hls: any = null;
let dashPlayer: any = null;
let backupAudio: HTMLVideoElement | null = null;
let backupHls: any = null;
let backupDashPlayer: any = null;
let backupAudioUrl = "";
let backupAudioType = "";
let backupAudioLabel = "Fallback Audio";
let backupAudioHeaders: Record<string, string> = {};
let backupAudioLoadedKey = "";
let backupAudioConfirmed = false;
let backupAudioFailureEmitted = false;
let backupAudioConfirmTimer: ReturnType<typeof setTimeout> | null = null;
let backupAudioConfirmStartedAt = 0;
let primaryHlsAudioDetected = false;
let backupHlsAudioDetected = false;
let primaryBuffering = true;
const BACKUP_AUDIO_CONFIRM_INTERVAL_MS = 160;
const BACKUP_AUDIO_TRUST_GRACE_MS = 1200;
const BACKUP_AUDIO_CONFIRM_TIMEOUT_MS = 5000;
let propertyCallbacks = new Set<PropertyCallback>();
let eventCallbacks = new Set<EventCallback>();
let currentHeaders: Record<string, string> = {};
let logicalVolume = 100;
let speed = 1;
let currentStreamType = "";
let subtitleCounter = 10;
let subtitleBlobUrls: string[] = [];
let hlsNetworkRecoveryCount = 0;
let hlsMediaRecoveryCount = 0;
let stallTimer: ReturnType<typeof setTimeout> | null = null;
let fatalEmitted = false;
const PLAYBACK_STALL_TIMEOUT_MS = 30000;

function clearStallTimer() {
  if (stallTimer) clearTimeout(stallTimer);
  stallTimer = null;
}
function emitPlaybackFailure(text: string, category = "unknown", status?: number) {
  if (fatalEmitted) return;
  fatalEmitted = true;
  clearStallTimer();
  emitEvent({ event: "web-playback-error", text, category: category, status });
}
function armStallTimer() {
  clearStallTimer();
  if (!video || video.paused || video.ended) return;
  stallTimer = setTimeout(() => {
    emitPlaybackFailure("Playback stalled for 30 seconds", "timeout");
  }, PLAYBACK_STALL_TIMEOUT_MS);
}

function emitEvent(event: any) { eventCallbacks.forEach((cb) => { try { cb(event); } catch {} }); }
function emitProperty(name: string, data: any) { propertyCallbacks.forEach((cb) => { try { cb({ name, data }); } catch {} }); }
function parseHeaderFields(value: string) {
  const out: Record<string, string> = {};
  if (!value) return out;
  const parts = value.match(/(?:"(?:\\.|[^"])*"|[^,])+/g) || [];
  for (let part of parts) {
    part = part.trim().replace(/^"|"$/g, "").replace(/\\"/g, '"');
    const idx = part.indexOf(":"); if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}
function isDashSource(url: string, type: string) {
  return type === "mpd" || type === "dash" || /\.mpd(?:$|\?)/i.test(url);
}
function configureDashProxy(player: any, headers: Record<string, string>) {
  player.addRequestInterceptor((request: any) => {
    const requestUrl = String(request?.url || "");
    if (/^https?:/i.test(requestUrl)) request.url = mediaProxyUrl(requestUrl, headers);
    return Promise.resolve(request);
  });
}
function clearBackupAudioConfirmation() {
  if (backupAudioConfirmTimer) clearTimeout(backupAudioConfirmTimer);
  backupAudioConfirmTimer = null;
  backupAudioConfirmStartedAt = 0;
}
function restorePrimaryAudio() {
  if (video) video.muted = false;
}
function hlsInstanceHasAudio(instance: any, decodedAudioDetected = false): boolean {
  if (!instance) return false;
  if (decodedAudioDetected) return true;
  if (Number(instance.audioTracks?.length || 0) > 0) return true;
  const levels = Array.isArray(instance.levels) ? instance.levels : [];
  return levels.some((level: any) => {
    if (level?.audioCodec) return true;
    const codecs = String(level?.attrs?.CODECS || level?.codecs || "");
    return /(?:mp4a|aac|ac-3|ec-3|opus|vorbis)/i.test(codecs);
  });
}
function hlsHasNativeAudio(): boolean {
  return Boolean(
    hls &&
    currentStreamType === "m3u8" &&
    hlsInstanceHasAudio(hls, primaryHlsAudioDetected),
  );
}
function primaryHasDecodedAudio(): boolean {
  if (!video) return false;
  if (hlsHasNativeAudio()) return true;
  try {
    const dashAudioTracks = dashPlayer?.getTracksFor?.("audio");
    if (Array.isArray(dashAudioTracks) && dashAudioTracks.length > 0) return true;
  } catch {}
  const media = video as HTMLVideoElement & {
    mozHasAudio?: boolean;
    webkitAudioDecodedByteCount?: number;
    audioTracks?: { length?: number };
  };
  if (media.mozHasAudio === true) return true;
  if (Number(media.webkitAudioDecodedByteCount || 0) > 0) return true;
  return Number(media.audioTracks?.length || 0) > 0;
}
function shouldUseExternalFallback(): boolean {
  return !primaryHasDecodedAudio();
}
function emitBackupAudioFailure(reason: string) {
  if (backupAudioFailureEmitted) return;
  backupAudioFailureEmitted = true;
  clearBackupAudioConfirmation();
  backupAudioConfirmed = false;
  restorePrimaryAudio();
  pauseBackupAudio();
  emitProperty("track-list/count", getTracks().length);
  emitEvent({ event: "web-backup-audio-failure", reason });
}
function backupHasDecodedAudio() {
  if (!backupAudio) return false;
  const media = backupAudio as HTMLVideoElement & {
    mozHasAudio?: boolean;
    webkitAudioDecodedByteCount?: number;
    audioTracks?: { length?: number };
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };

  if (media.mozHasAudio === true) return true;
  if (Number(media.webkitAudioDecodedByteCount || 0) > 0) return true;
  if (Number(media.audioTracks?.length || 0) > 0) return true;
  if (hlsInstanceHasAudio(backupHls, backupHlsAudioDetected)) return true;
  try {
    const dashAudioTracks = backupDashPlayer?.getTracksFor?.("audio");
    if (Array.isArray(dashAudioTracks) && dashAudioTracks.length > 0) return true;
  } catch {}

  const capture = media.captureStream || media.mozCaptureStream;
  if (typeof capture === "function" && media.readyState >= HTMLMediaElement.HAVE_METADATA) {
    try {
      const captured = capture.call(media);
      const hasAudio = captured.getAudioTracks().length > 0;
      captured.getTracks().forEach((track) => track.stop());
      if (hasAudio) return true;
    } catch {}
  }
  return false;
}
function backupAudioInspectionAvailable(): boolean {
  if (!backupAudio) return false;
  if (backupHls || backupDashPlayer) return true;
  const media = backupAudio as HTMLVideoElement & {
    mozHasAudio?: boolean;
    webkitAudioDecodedByteCount?: number;
    audioTracks?: { length?: number };
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  return (
    typeof media.mozHasAudio === "boolean" ||
    "webkitAudioDecodedByteCount" in media ||
    "audioTracks" in media ||
    typeof media.captureStream === "function" ||
    typeof media.mozCaptureStream === "function"
  );
}
function activateBackupAudio() {
  if (!video || !backupAudio || !backupAudioUrl || primaryBuffering) return;
  if (!shouldUseExternalFallback()) {
    stopBackupAudio(false);
    return;
  }
  const wasConfirmed = backupAudioConfirmed;
  backupAudioConfirmed = true;
  backupAudioConfirmStartedAt = 0;
  syncBackupAudio(true);
  video.muted = true;
  if (!wasConfirmed) emitProperty("track-list/count", getTracks().length);
}
function confirmBackupAudioReady() {
  if (backupAudioConfirmTimer) clearTimeout(backupAudioConfirmTimer);
  backupAudioConfirmTimer = null;
  if (!video || !backupAudio || !backupAudioUrl || backupAudio.paused || backupAudio.ended || primaryBuffering) {
    return;
  }

  if (backupHasDecodedAudio()) {
    activateBackupAudio();
    return;
  }

  if (!backupAudioConfirmStartedAt) backupAudioConfirmStartedAt = Date.now();
  const elapsed = Date.now() - backupAudioConfirmStartedAt;
  if (
    !backupAudioInspectionAvailable() &&
    elapsed >= BACKUP_AUDIO_TRUST_GRACE_MS &&
    backupAudio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
  ) {
    activateBackupAudio();
    return;
  }
  if (elapsed >= BACKUP_AUDIO_CONFIRM_TIMEOUT_MS) {
    console.warn("Fallback media played but no decoded audio was detected; keeping primary audio enabled");
    emitBackupAudioFailure("no-audio-detected");
    return;
  }

  backupAudioConfirmTimer = setTimeout(
    confirmBackupAudioReady,
    BACKUP_AUDIO_CONFIRM_INTERVAL_MS,
  );
}

function ensureBackupAudio() {
  if (backupAudio?.isConnected) return backupAudio;

  // The fallback candidate is normally a complete lower-quality VIDEO source,
  // not an audio-only URL. Use a hidden <video> element so the browser uses
  // the exact same demux/codec path that succeeds when that 480p/720p source
  // is selected as the primary stream. We only consume its audio output.
  backupAudio = document.createElement("video");
  backupAudio.id = "vega-web-backup-audio";
  backupAudio.playsInline = true;
  backupAudio.preload = "auto";
  backupAudio.autoplay = false;
  backupAudio.controls = false;
  backupAudio.disablePictureInPicture = true;
  backupAudio.tabIndex = -1;
  backupAudio.setAttribute("aria-hidden", "true");
  Object.assign(backupAudio.style, {
    position: "fixed",
    width: "1px",
    height: "1px",
    left: "-10000px",
    top: "-10000px",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(backupAudio);
  backupAudio.addEventListener("playing", () => {
    // A playing event only proves the fallback VIDEO is advancing. Keep the
    // primary source audible until the browser confirms an actual audio track.
    confirmBackupAudioReady();
  });
  backupAudio.addEventListener("error", () => {
    clearBackupAudioConfirmation();
    console.warn("Fallback media failed; restoring primary audio", backupAudio?.error);
    emitBackupAudioFailure("media-error");
  });
  backupAudio.addEventListener("loadedmetadata", () => {
    syncBackupAudio(true);
    if (video && !video.paused && !video.ended) void resumeBackupAudio();
  });
  backupAudio.addEventListener("canplay", () => {
    if (!backupAudio?.paused) confirmBackupAudioReady();
  });
  backupAudio.addEventListener("seeked", () => {
    if (!video || !backupAudioUrl) return;
    syncBackupAudio(false);
    if (!video.paused && !video.ended && !primaryBuffering) void resumeBackupAudio();
  });
  backupAudio.addEventListener("ended", () => {
    if (video && !video.paused && !video.ended) emitBackupAudioFailure("backup-ended");
  });
  return backupAudio;
}
function pauseBackupAudio() {
  if (!backupAudio) return;
  try { backupAudio.pause(); } catch {}
}
function syncBackupAudio(force = false) {
  if (!video || !backupAudio || !backupAudioUrl) return;
  const target = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0;
  backupAudio.volume = Math.min(1, logicalVolume / 100);
  if (backupAudio.readyState < HTMLMediaElement.HAVE_METADATA) return;
  const correction = planBackupAudioSync({
    primaryTime: target,
    backupTime: backupAudio.currentTime,
    primaryRate: video.playbackRate || speed,
    backupDuration: backupAudio.duration,
    force,
  });
  // Changing rate every timeupdate is less disruptive than frequent seeks.
  backupAudio.playbackRate = correction.playbackRate;
  if (correction.seekTo !== null) {
    try { backupAudio.currentTime = correction.seekTo; } catch {}
  }
}
async function resumeBackupAudio(_forceStart = false) {
  if (!video || !backupAudio || !backupAudioUrl || video.ended) return;
  if (video.paused || video.seeking || primaryBuffering ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  syncBackupAudio();
  if (!backupAudio.paused) {
    if (!backupAudioConfirmed) confirmBackupAudioReady();
    return;
  }
  try {
    await backupAudio.play();
    if (backupAudioConfirmed) {
      if (shouldUseExternalFallback()) {
        video.muted = true;
      } else {
        stopBackupAudio(false);
      }
    } else {
      confirmBackupAudioReady();
    }
  } catch (error) {
    console.warn("Fallback media play was blocked or unsupported", error);
    emitBackupAudioFailure("play-rejected");
  }
}

function retryFallbackOnUserGesture() {
  if (!backupAudioUrl || !backupAudio || !video || video.paused || video.ended || primaryBuffering) return;
  if (!backupAudio.paused) {
    if (!backupAudioConfirmed) confirmBackupAudioReady();
    return;
  }
  void resumeBackupAudio(true);
}
function stopBackupAudio(clearConfiguration = false) {
  clearBackupAudioConfirmation();
  backupAudioConfirmed = false;
  backupAudioFailureEmitted = false;
  try { backupHls?.destroy?.(); } catch {}
  backupHls = null;
  backupHlsAudioDetected = false;
  try { backupDashPlayer?.reset?.(); } catch {}
  backupDashPlayer = null;
  if (backupAudio) {
    pauseBackupAudio();
    backupAudio.removeAttribute("src");
    try { backupAudio.load(); } catch {}
  }
  backupAudioLoadedKey = "";
  if (video) video.muted = false;
  if (clearConfiguration) {
    backupAudioUrl = "";
    backupAudioType = "";
    backupAudioLabel = "Fallback Audio";
    backupAudioHeaders = {};
  }
}
function loadBackupAudioSource() {
  if (!backupAudioUrl) {
    stopBackupAudio(false);
    return;
  }
  const nextKey = `${backupAudioType}|${backupAudioUrl}|${JSON.stringify(backupAudioHeaders)}`;
  if (backupAudioLoadedKey === nextKey && backupAudio) return;
  stopBackupAudio(false);
  backupAudioLoadedKey = nextKey;
  const audio = ensureBackupAudio();
  const source = mediaProxyUrl(backupAudioUrl, backupAudioHeaders);
  const isHls = backupAudioType === "m3u8" || /\.m3u8(?:$|\?)/i.test(backupAudioUrl);
  const isDash = isDashSource(backupAudioUrl, backupAudioType);
  audio.playbackRate = video?.playbackRate || speed;
  audio.volume = Math.min(1, logicalVolume / 100);

  if (isDash) {
    backupDashPlayer = MediaPlayer().create();
    configureDashProxy(backupDashPlayer, backupAudioHeaders);
    const dashEvents = (MediaPlayer as any).events;
    if (dashEvents?.ERROR) {
      backupDashPlayer.on(dashEvents.ERROR, () => emitBackupAudioFailure("dash-error"));
    }
    backupDashPlayer.initialize(audio, source, false);
  } else if (isHls && Hls.isSupported()) {
    backupHls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 30 });
    backupHls.attachMedia(audio);
    backupHls.on(Hls.Events.MEDIA_ATTACHED, () => backupHls?.loadSource(source));
    backupHls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (!audio.paused) confirmBackupAudioReady();
    });
    backupHls.on(Hls.Events.BUFFER_CODECS, (_event: any, data: any) => {
      if (data?.audio || data?.audiovideo || data?.tracks?.audio || data?.tracks?.audiovideo) {
        backupHlsAudioDetected = true;
      }
      if (!audio.paused) confirmBackupAudioReady();
    });
    backupHls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
      if (!audio.paused) confirmBackupAudioReady();
    });
    backupHls.on(Hls.Events.ERROR, (_evt: any, data: any) => {
      if (data?.fatal) {
        console.warn("Fallback HLS audio failed", data);
        emitBackupAudioFailure("hls-error");
      }
    });
  } else {
    audio.src = source;
    audio.load();
  }
}
function addCueStyle() {
  if (document.getElementById("vega-web-cue-style")) return;
  const style = document.createElement("style"); style.id = "vega-web-cue-style";
  style.textContent = `#vega-web-video::cue{color:#fff;background:transparent;text-shadow:0 1px 2px #000,0 0 3px #000;font-family:var(--vega-sub-font,sans-serif);font-size:var(--vega-sub-size,22px)}`;
  document.head.appendChild(style);
}
function ensureVideo() {
  if (video?.isConnected) return video;
  video = document.createElement("video");
  video.id = "vega-web-video"; video.playsInline = true; video.preload = "auto"; video.autoplay = true; video.controls = false;
  Object.assign(video.style, { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain", background: "#000", zIndex: "0" });
  (document.querySelector(".player-page") || document.body).prepend(video); addCueStyle();
  video.addEventListener("play", () => { emitProperty("pause", false); void resumeBackupAudio(); });
  video.addEventListener("pause", () => { emitProperty("pause", true); pauseBackupAudio(); });
  video.addEventListener("timeupdate", () => { emitProperty("time-pos", video?.currentTime || 0); syncBackupAudio(); });
  video.addEventListener("durationchange", () => emitProperty("duration", Number.isFinite(video?.duration || NaN) ? video!.duration : 0));
  video.addEventListener("volumechange", () => { emitProperty("volume", logicalVolume); if (backupAudio) backupAudio.volume = Math.min(1, logicalVolume / 100); });
  video.addEventListener("ratechange", () => { emitProperty("speed", video?.playbackRate || 1); if (backupAudio) backupAudio.playbackRate = video?.playbackRate || 1; });
  video.addEventListener("waiting", () => { primaryBuffering = true; pauseBackupAudio(); emitProperty("paused-for-cache", true); emitEvent({ event: "seek" }); armStallTimer(); });
  video.addEventListener("seeking", () => { primaryBuffering = true; pauseBackupAudio(); syncBackupAudio(true); emitEvent({ event: "seek" }); });
  video.addEventListener("seeked", () => { syncBackupAudio(true); /* Resume on actual playing, not while buffering after seek. */ });
  video.addEventListener("playing", () => { primaryBuffering = false; syncBackupAudio(true); void resumeBackupAudio(); emitProperty("paused-for-cache", false); clearStallTimer(); emitEvent({ event: "playback-restart" }); });
  video.addEventListener("canplay", () => { emitProperty("paused-for-cache", false); clearStallTimer(); });
  video.addEventListener("loadedmetadata", () => { emitProperty("duration", Number.isFinite(video?.duration || NaN) ? video!.duration : 0); emitProperty("video-params/h", video?.videoHeight || 0); emitProperty("track-list/count", getTracks().length); emitEvent({ event: "file-loaded" }); });
  video.addEventListener("ended", () => { pauseBackupAudio(); emitProperty("eof-reached", true); emitEvent({ event: "end-file" }); });
  video.addEventListener("error", () => { const code = video?.error?.code || 0; const text = video?.error?.message || "The browser rejected this media source or codec."; const category = code === MediaError.MEDIA_ERR_DECODE ? "decode" : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? "unsupported" : "network"; emitEvent({ event: "log-message", level: "error", text }); emitPlaybackFailure(text, category); });
  return video;
}
function cleanupSource() {
  primaryBuffering = true;
  clearStallTimer();
  try { hls?.destroy?.(); } catch {} hls = null;
  primaryHlsAudioDetected = false;
  try { dashPlayer?.reset?.(); } catch {} dashPlayer = null;
  stopBackupAudio(false);
  subtitleBlobUrls.forEach((u) => URL.revokeObjectURL(u)); subtitleBlobUrls = [];
}
function getTracks() {
  const v = ensureVideo(); const tracks: any[] = [];
  if (v.videoWidth || v.currentSrc) tracks.push({ id: 1, type: "video", title: "Video", lang: "", codec: "browser", selected: true, external: false, demuxW: v.videoWidth || undefined, demuxH: v.videoHeight || undefined });
  const hlsAudioTracks = hls?.audioTracks;
  if (hlsAudioTracks?.length) {
    for (let index = 0; index < hlsAudioTracks.length; index += 1) {
      const track = hlsAudioTracks[index];
      tracks.push({
        id: 100 + index,
        type: "audio",
        title: track.name || track.lang || `Audio ${index + 1}`,
        lang: track.lang || "",
        codec: track.audioCodec || "hls",
        selected: Number(hls.audioTrack) === index,
        external: false,
      });
    }
  } else {
    const audioTracks = (v as any).audioTracks;
    if (audioTracks?.length) {
      for (let index = 0; index < audioTracks.length; index += 1) {
        const track = audioTracks[index];
        tracks.push({ id: 100 + index, type: "audio", title: track.label || `Audio ${index + 1}`, lang: track.language || "", codec: "browser", selected: Boolean(track.enabled), external: false });
      }
    } else if (backupAudioUrl && backupAudioConfirmed) {
      tracks.push({ id: 200, type: "audio", title: backupAudioLabel, lang: "", codec: "fallback", selected: true, external: true });
    } else if (v.currentSrc) {
      tracks.push({ id: 2, type: "audio", title: "Default", lang: "", codec: "browser", selected: true, external: false });
    }
  }
  Array.from(v.textTracks).forEach((track, index) => tracks.push({ id: 10 + index, type: "sub", title: track.label || `Subtitle ${index + 1}`, lang: track.language || "", codec: "vtt", selected: track.mode === "showing", external: true }));
  return tracks;
}
function srtToVtt(input: string) { return "WEBVTT\n\n" + input.replace(/^\uFEFF/, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2"); }
async function addSubtitle(url: string, title = "External") {
  const v = ensureVideo(); let src = url;
  try {
    if (/^(https?:|blob:)/i.test(url)) {
      const fetchUrl = /^https?:/i.test(url) ? mediaProxyUrl(url, currentHeaders) : url;
      const res = await fetch(fetchUrl); let text = await res.text();
      if (/\.srt(?:$|\?)/i.test(url) || !/^WEBVTT/m.test(text)) text = srtToVtt(text);
      src = URL.createObjectURL(new Blob([text], { type: "text/vtt" })); subtitleBlobUrls.push(src);
    }
  } catch (error) { console.warn("Subtitle conversion failed; falling back to original URL", error); }
  const track = document.createElement("track"); track.kind = "subtitles"; track.label = title; track.srclang = "und"; track.src = src; track.dataset.vegaId = String(subtitleCounter++); v.appendChild(track);
  track.addEventListener("load", () => emitProperty("track-list/count", getTracks().length));
}
async function loadSource(original: string) {
  const v = ensureVideo();
  cleanupSource();
  hlsNetworkRecoveryCount = 0;
  hlsMediaRecoveryCount = 0;
  fatalEmitted = false;
  const source = mediaProxyUrl(original, currentHeaders);
  const isHls = currentStreamType === "m3u8" || /\.m3u8(?:$|\?)/i.test(original);
  const isDash = currentStreamType === "mpd" || currentStreamType === "dash" || /\.mpd(?:$|\?)/i.test(original);
  // DASH/direct sources use the external lower-quality mirror up front. HLS
  // streams usually carry their own audio groups, so the decision is deferred
  // to AUDIO_TRACKS_UPDATED once the variant playlist is parsed.
  if (!isHls) loadBackupAudioSource();
  emitProperty("paused-for-cache", true);
  if (isDash) {
    dashPlayer = MediaPlayer().create();
    configureDashProxy(dashPlayer, currentHeaders);
    const dashEvents = (MediaPlayer as any).events;
    if (dashEvents?.ERROR) {
      dashPlayer.on(dashEvents.ERROR, (event: any) => {
        const text = `dash: ${event?.error?.message || event?.event?.message || event?.message || "playback error"}`;
        emitEvent({ event: "log-message", level: "error", text });
        if (event?.error || event?.fatal) emitPlaybackFailure(text, "dash");
      });
    }
    dashPlayer.initialize(v, source, false);
  } else if (isHls && Hls.isSupported()) {
    hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 90 });
    hls.attachMedia(v);
    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls?.loadSource(source));
    const reconcileHlsAudio = () => {
      if (hlsHasNativeAudio()) {
        stopBackupAudio(false);
      } else if (backupAudioUrl) {
        loadBackupAudioSource();
      }
      emitProperty("track-list/count", getTracks().length);
    };
    hls.on(Hls.Events.MANIFEST_PARSED, reconcileHlsAudio);
    hls.on(Hls.Events.BUFFER_CODECS, (_event: any, data: any) => {
      if (data?.audio || data?.audiovideo || data?.tracks?.audio || data?.tracks?.audiovideo) {
        primaryHlsAudioDetected = true;
      }
      reconcileHlsAudio();
    });
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, reconcileHlsAudio);
    hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => emitProperty("track-list/count", getTracks().length));
    hls.on(Hls.Events.ERROR, (_evt: any, data: any) => {
      const text = `${data?.type || "hls"}: ${data?.details || "unknown error"}`;
      emitEvent({ event: "log-message", level: data?.fatal ? "error" : "warn", text });
      if (data?.fatal && data?.type === Hls.ErrorTypes.NETWORK_ERROR) {
        if (hlsNetworkRecoveryCount < 1) {
          hlsNetworkRecoveryCount += 1;
          hls?.startLoad?.();
        } else {
          const status = Number(data?.response?.code || data?.networkDetails?.status || 0) || undefined;
          emitPlaybackFailure(text, "hls_network", status);
        }
      } else if (data?.fatal && data?.type === Hls.ErrorTypes.MEDIA_ERROR) {
        if (hlsMediaRecoveryCount < 1) {
          hlsMediaRecoveryCount += 1;
          hls?.recoverMediaError?.();
        } else {
          emitPlaybackFailure(text, "hls_media");
        }
      } else if (data?.fatal) {
        emitPlaybackFailure(text, "unknown");
      }
    });
  } else { v.src = source; v.load(); }
  try {
    const primaryPlay = v.play();
    const fallbackPlay = resumeBackupAudio(true);
    await primaryPlay;
    await fallbackPlay;
  } catch {
    pauseBackupAudio();
    emitProperty("pause", true);
  }
}

export interface MpvInitOptions {
  initialOptions?: Record<string, string>;
  observedProperties?: readonly unknown[];
}

const onVisibilityChange = () => {
  if (document.visibilityState !== "visible" || !video) return;
  // After a background tab is restored, timers and the sync loop may have been
  // throttled. Force the fallback audio back onto the primary stream position
  // so the two output paths cannot drift apart silently.
  syncBackupAudio(true);
  emitProperty("time-pos", video.currentTime || 0);
  if (!video.paused && !video.ended) void resumeBackupAudio();
};

export async function init(_options?: MpvInitOptions) {
  ensureVideo();
  document.addEventListener("pointerdown", retryFallbackOnUserGesture, true);
  document.addEventListener("keydown", retryFallbackOnUserGesture, true);
  document.addEventListener("visibilitychange", onVisibilityChange);
}
export async function destroy() {
  document.removeEventListener("pointerdown", retryFallbackOnUserGesture, true);
  document.removeEventListener("keydown", retryFallbackOnUserGesture, true);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  cleanupSource();
  stopBackupAudio(true);
  if (backupAudio) { backupAudio.remove(); backupAudio = null; }
  if (video) { video.pause(); video.removeAttribute("src"); video.load(); video.remove(); }
  video = null;
}
export async function observeProperties(_properties: readonly any[], callback: PropertyCallback) {
  propertyCallbacks.add(callback); const v = ensureVideo();
  queueMicrotask(() => { callback({ name: "pause", data: v.paused }); callback({ name: "time-pos", data: v.currentTime || 0 }); callback({ name: "duration", data: Number.isFinite(v.duration) ? v.duration : 0 }); callback({ name: "volume", data: logicalVolume }); callback({ name: "speed", data: speed }); callback({ name: "paused-for-cache", data: v.readyState < 3 }); callback({ name: "track-list/count", data: getTracks().length }); callback({ name: "chapter-list/count", data: 0 }); callback({ name: "video-params/h", data: v.videoHeight || 0 }); });
  return () => propertyCallbacks.delete(callback);
}
function seekTo(targetSeconds: number) {
  // Single deterministic seek path used by buttons, keyboard shortcuts, the
  // timeline and mobile scrubbing. Clamps to the known duration and keeps the
  // fallback audio locked to the primary stream for the whole operation.
  if (!video) return;
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const clamped =
    duration > 0
      ? Math.min(Math.max(0, targetSeconds), Math.max(0, duration - 0.05))
      : Math.max(0, targetSeconds);
  pauseBackupAudio();
  try {
    video.currentTime = clamped;
  } catch {}
  emitEvent({ event: "seek" });
  syncBackupAudio(true);
}
export async function listenEvents(callback: EventCallback) { eventCallbacks.add(callback); return () => eventCallbacks.delete(callback); }
export async function command(name: string, args: any[] = []) {
  const v = ensureVideo();
  if (name === "loadfile") return loadSource(String(args[0] || ""));
  if (name === "stop") { cleanupSource(); v.pause(); v.removeAttribute("src"); v.load(); return; }
  if (name === "cycle" && args[0] === "pause") {
    if (v.paused) {
      const fallbackPlay = resumeBackupAudio(true);
      await v.play().catch(() => {});
      await fallbackPlay;
      if (v.paused) pauseBackupAudio();
    } else {
      v.pause();
    }
    return;
  }
  if (name === "seek") {
    const amount = Number(args[0]) || 0;
    const target = args[1] === "relative" ? (v.currentTime || 0) + amount : amount;
    seekTo(target);
    return;
  }
  if (name === "sub-add") return addSubtitle(String(args[0]), String(args[2] || "External"));
}
export async function setProperty(name: string, value: any) {
  const v = ensureVideo();
  if (name === "vega-stream-type") { currentStreamType = String(value || "").toLowerCase(); return; }
  if (name === "vega-backup-audio-url") { backupAudioUrl = String(value || ""); return; }
  if (name === "vega-backup-audio-type") { backupAudioType = String(value || "").toLowerCase(); return; }
  if (name === "vega-backup-audio-label") { backupAudioLabel = String(value || "Fallback Audio"); return; }
  if (name === "vega-backup-audio-headers") { try { backupAudioHeaders = value ? JSON.parse(String(value)) : {}; } catch { backupAudioHeaders = {}; } return; }
  if (name === "vega-backup-audio-apply") {
    if (!hlsHasNativeAudio()) loadBackupAudioSource();
    emitProperty("track-list/count", getTracks().length);
    if (video && !video.paused && !video.ended && backupAudioUrl) {
      void resumeBackupAudio(true);
    }
    return;
  }
  if (name === "http-header-fields") { currentHeaders = parseHeaderFields(String(value || "")); return; }
  if (name === "referrer") { if (value) currentHeaders.Referer = String(value); else delete currentHeaders.Referer; return; }
  if (name === "user-agent") { if (value) currentHeaders["User-Agent"] = String(value); return; }
  if (name === "volume") { logicalVolume = Math.max(0, Math.min(200, Number(value) || 0)); v.volume = Math.min(1, logicalVolume / 100); if (backupAudio) backupAudio.volume = Math.min(1, logicalVolume / 100); emitProperty("volume", logicalVolume); return; }
  if (name === "speed") { speed = Math.max(0.25, Math.min(4, Number(value) || 1)); v.playbackRate = speed; if (backupAudio) backupAudio.playbackRate = speed; return; }
  if (name === "aid") {
    const wanted = Number(value);
    if (hls?.audioTracks?.length && Number.isFinite(wanted)) {
      const index = wanted - 100;
      if (index >= 0 && index < hls.audioTracks.length) hls.audioTrack = index;
      emitProperty("track-list/count", getTracks().length);
      return;
    }
    const audioTracks = (v as any).audioTracks;
    if (audioTracks?.length) {
      for (let index = 0; index < audioTracks.length; index += 1) audioTracks[index].enabled = wanted === 100 + index;
      emitProperty("track-list/count", getTracks().length);
    }
    return;
  }
  if (name === "sid") { const wanted = value === "no" ? -1 : Number(value); Array.from(v.textTracks).forEach((track, idx) => track.mode = wanted === 10 + idx ? "showing" : "disabled"); emitProperty("track-list/count", getTracks().length); return; }
  if (name === "panscan") { v.style.objectFit = Number(value) > 0 ? "cover" : "contain"; return; }
  if (name === "video-zoom") { const scale = Math.pow(2, Number(value) || 0); v.style.transform = `scale(${Math.max(0.5, Math.min(3, scale))})`; return; }
  if (name === "sub-font-size") { document.documentElement.style.setProperty("--vega-sub-size", `${Number(value) || 22}px`); return; }
  if (name === "sub-font") { document.documentElement.style.setProperty("--vega-sub-font", String(value || "sans-serif")); return; }
}
export async function getProperty(name: string, _type?: string): Promise<any> {
  const v = ensureVideo();
  if (name === "pause") return v.paused; if (name === "time-pos") return v.currentTime || 0; if (name === "duration") return Number.isFinite(v.duration) ? v.duration : 0; if (name === "volume") return logicalVolume; if (name === "speed") return v.playbackRate || speed; if (name === "paused-for-cache") return v.readyState < 3; if (name === "demuxer-cache-duration") return 0; if (name === "video-params/h") return v.videoHeight || 0; if (name === "track-list/count") return getTracks().length; if (name === "chapter-list/count") return 0;
  const m = name.match(/^track-list\/(\d+)\/(.+)$/); if (m) { const track = getTracks()[Number(m[1])]; const map: Record<string,string> = { type:"type",id:"id",title:"title",lang:"lang",codec:"codec",selected:"selected",external:"external","demux-w":"demuxW","demux-h":"demuxH" }; const key = m[2]; return track?.[map[key] || key] ?? (key === "selected" || key === "external" ? false : ""); }
  if (name.startsWith("chapter-list/")) return name.endsWith("/time") ? 0 : ""; return undefined;
}

