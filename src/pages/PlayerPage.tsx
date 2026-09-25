import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMpvPlayer, type MpvTrack } from "../lib/hooks/useMpvPlayer";
import { useFallbackAudioStream, useStream } from "../lib/hooks/useStream";
import { usePlayerProgress } from "../lib/hooks/usePlayerSettings";
import { useMediaSession } from "../lib/hooks/useMediaSession";
import useContentStore from "../lib/zustand/contentStore";
import useWatchHistoryStore from "../lib/zustand/watchHistrory";
import { useDownloadStore } from "../lib/zustand/downloadStore";
import { cacheStorage, mainStorage } from "../lib/storage";
import { PlayerControls } from "./PlayerControls";
import { PlayerInitError } from "./PlayerInitError";
import type { Link, SkipInterval } from "../lib/providers/types";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import {
  FocusContext,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import { FocusableButton } from "../components/layout/FocusableButton";
import { AnimatedHourglass } from "../components/AnimatedHourglass";
import { syncFromSharedFolder } from "../lib/sync/syncService";
import { settingsStorage } from "../lib/storage/SettingsStorage";
import { useArtworkPalette } from "../lib/hooks/useArtworkPalette";
import {
  classifyPlaybackError,
  type PlaybackFailure,
} from "../lib/playback/playbackErrors";
import {
  buildMovieExtractionQueue,
  findFallbackAudioStream,
  findNextMovieMirror,
  findNextUntriedStream,
  streamCandidateKey,
} from "../lib/playback/sourceFallback";
import { describeWebStream, detectBrowserMediaCapabilities } from "../lib/playback/webMediaSupport";
import { providerManager } from "../lib/services/ProviderManager";
import {
  createHostBlockRegistry,
  extractBlockedHost,
} from "../lib/playback/hostBlockCircuit";

import {
  LuArrowLeft as ArrowLeft,
  LuChevronLeft as ChevronLeft,
  LuExternalLink as ExternalLink,
  LuList as ListIcon,
  LuPlay as Play,
  LuServer as Server,
  LuX as CloseIcon,
} from "react-icons/lu";
import "./PlayerPage.css";

interface PlayerLocationState {
  episodeList: any[];
  linkIndex: number;
  sourceGroups?: Link[];
  activeSourceIndex?: number;
  primaryTitle: string;
  secondaryTitle?: string;
  type: string;
  poster?: { poster?: string; logo?: string; background?: string };
  providerValue: string;
  infoUrl: string;
  doNotTrack?: boolean;
}

interface MediaTrackPreference {
  audioLang?: string;
  audioTitle?: string;
  audioLabel?: string;
  audioIndex?: number;
  subLang?: string;
  subTitle?: string;
  subLabel?: string;
  subIndex?: number;
  subOff?: boolean;
}

const getMediaPrefKey = (state?: PlayerLocationState | null) => {
  const rawId = state?.infoUrl || state?.primaryTitle || "";
  return `media_tracks_${rawId}`;
};

const getSavedTrackPreference = (
  state?: PlayerLocationState | null,
): MediaTrackPreference | null => {
  if (!state) return null;
  const key = getMediaPrefKey(state);
  return mainStorage.getObject<MediaTrackPreference>(key) || null;
};

const saveAudioPreference = (
  state: PlayerLocationState | undefined,
  track: MpvTrack,
  index?: number,
) => {
  if (!state) return;
  const key = getMediaPrefKey(state);
  const current = mainStorage.getObject<MediaTrackPreference>(key) || {};
  mainStorage.setObject<MediaTrackPreference>(key, {
    ...current,
    audioLang: track.lang?.trim() || undefined,
    audioTitle: track.title?.trim() || undefined,
    audioLabel: formatTrackLabel(track),
    audioIndex: index,
  });
};

const saveSubtitlePreference = (
  state: PlayerLocationState | undefined,
  trackOrOff: MpvTrack | "off",
  index?: number,
) => {
  if (!state) return;
  const key = getMediaPrefKey(state);
  const current = mainStorage.getObject<MediaTrackPreference>(key) || {};
  if (trackOrOff === "off") {
    mainStorage.setObject<MediaTrackPreference>(key, {
      ...current,
      subOff: true,
      subLang: undefined,
      subTitle: undefined,
      subLabel: undefined,
      subIndex: undefined,
    });
  } else {
    mainStorage.setObject<MediaTrackPreference>(key, {
      ...current,
      subOff: false,
      subLang: trackOrOff.lang?.trim() || undefined,
      subTitle: trackOrOff.title?.trim() || undefined,
      subLabel: formatTrackLabel(trackOrOff),
      subIndex: index,
    });
  }
};

function findBestMatchingAudioTrack(
  tracks: MpvTrack[],
  saved: MediaTrackPreference,
): MpvTrack | undefined {
  if (!tracks.length) return undefined;

  if (saved.audioLang) {
    const sl = saved.audioLang.trim().toLowerCase();
    const match = tracks.find((t) => {
      const l = t.lang?.trim().toLowerCase();
      if (!l) return false;
      if (l === sl) return true;
      if (l.length >= 2 && sl.length >= 2 && l.slice(0, 2) === sl.slice(0, 2)) {
        return true;
      }
      return false;
    });
    if (match) return match;
  }

  if (saved.audioLabel) {
    const match = tracks.find(
      (t) =>
        formatTrackLabel(t).toLowerCase() === saved.audioLabel!.toLowerCase(),
    );
    if (match) return match;
  }

  if (saved.audioTitle) {
    const st = saved.audioTitle.trim().toLowerCase();
    const match = tracks.find((t) => {
      const title = t.title?.trim().toLowerCase();
      if (!title) return false;
      return title === st || title.includes(st) || st.includes(title);
    });
    if (match) return match;
  }

  if (saved.audioLang) {
    const sl = saved.audioLang.trim().toLowerCase();
    const match = tracks.find((t) => {
      const title = t.title?.trim().toLowerCase();
      return Boolean(title && title.includes(sl));
    });
    if (match) return match;
  }

  if (
    saved.audioIndex !== undefined &&
    saved.audioIndex >= 0 &&
    saved.audioIndex < tracks.length
  ) {
    return tracks[saved.audioIndex];
  }

  return undefined;
}

function findBestMatchingSubtitleTrack(
  tracks: MpvTrack[],
  saved: MediaTrackPreference,
): MpvTrack | undefined {
  if (!tracks.length) return undefined;

  if (saved.subLang) {
    const sl = saved.subLang.trim().toLowerCase();
    const match = tracks.find((t) => {
      const l = t.lang?.trim().toLowerCase();
      if (!l) return false;
      if (l === sl) return true;
      if (l.length >= 2 && sl.length >= 2 && l.slice(0, 2) === sl.slice(0, 2)) {
        return true;
      }
      return false;
    });
    if (match) return match;
  }

  if (saved.subLabel) {
    const match = tracks.find(
      (t) =>
        formatTrackLabel(t).toLowerCase() === saved.subLabel!.toLowerCase(),
    );
    if (match) return match;
  }

  if (saved.subTitle) {
    const st = saved.subTitle.trim().toLowerCase();
    const match = tracks.find((t) => {
      const title = t.title?.trim().toLowerCase();
      if (!title) return false;
      return title === st || title.includes(st) || st.includes(title);
    });
    if (match) return match;
  }

  if (saved.subLang) {
    const sl = saved.subLang.trim().toLowerCase();
    const match = tracks.find((t) => {
      const title = t.title?.trim().toLowerCase();
      return Boolean(title && title.includes(sl));
    });
    if (match) return match;
  }

  if (
    saved.subIndex !== undefined &&
    saved.subIndex >= 0 &&
    saved.subIndex < tracks.length
  ) {
    return tracks[saved.subIndex];
  }

  const downloadedTrack = tracks.find((t) => {
    const title = t.title?.toLowerCase() || "";
    return title.includes("downloaded") || title.includes("local");
  });
  if (downloadedTrack) return downloadedTrack;

  return undefined;
}

const formatTrackLabel = (track: {
  id: number;
  title?: string;
  lang?: string;
}) => {
  const title = track.title?.trim();
  const language = track.lang?.trim();
  if (
    title &&
    language &&
    title.toLocaleLowerCase() !== language.toLocaleLowerCase()
  ) {
    return `${title} · ${language.toUpperCase()}`;
  }
  return title || language?.toUpperCase() || `Track ${track.id}`;
};

export const PlayerPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as PlayerLocationState | undefined;
  const [syncReady, setSyncReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    syncFromSharedFolder()
      .catch((error) => console.warn("[VegaSync] Player sync failed:", error))
      .finally(() => {
        if (mounted) setSyncReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (!state) {
    return (
      <div className="player-page">
        <div className="player-error">
          <p>No playback data provided.</p>
          <button onClick={() => navigate(-1)}>Go Back</button>
        </div>
      </div>
    );
  }

  if (!syncReady) {
    return (
      <div className="player-page">
        <div className="player-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return <PlayerInner key={state.infoUrl} state={state} />;
};

interface PlayerInnerProps {
  state: PlayerLocationState;
}

const PlayerInner: React.FC<PlayerInnerProps> = ({ state }) => {
  const { provider } = useContentStore();
  const [playbackEpisodeList, setPlaybackEpisodeList] = useState(state.episodeList);
  const [activeEpisodeIndex, setActiveEpisodeIndex] = useState(state.linkIndex);
  const [activeSourceIndex, setActiveSourceIndex] = useState(
    state.activeSourceIndex ?? 0,
  );
  const activeEpisode = playbackEpisodeList[activeEpisodeIndex];
  const playbackState = useMemo(
    () => ({
      ...state,
      episodeList: playbackEpisodeList,
      activeSourceIndex,
    }),
    [state, playbackEpisodeList, activeSourceIndex],
  );
  const dynamicInfoThemeEnabled =
    settingsStorage.isInfoPageDynamicThemeEnabled();
  const hourglassArtwork = dynamicInfoThemeEnabled
    ? state.poster?.poster || state.poster?.background
    : null;
  const artworkPalette = useArtworkPalette(hourglassArtwork);
  const hourglassSandColor = artworkPalette["--primary"] || "var(--primary)";

  const routeParams = useMemo(
    () => ({
      episodeList: playbackEpisodeList,
      linkIndex: activeEpisodeIndex,
      type: state.type,
      primaryTitle: state.primaryTitle,
      secondaryTitle: state.secondaryTitle,
      providerValue: state.providerValue,
      infoUrl: state.infoUrl,
      doNotTrack: state.doNotTrack,
      poster: state.poster,
    }),
    [state, playbackEpisodeList, activeEpisodeIndex],
  );

  const switchPlaybackSource = useCallback(
    async (sourceIndex: number) => {
      const sourceGroups = state.sourceGroups || [];
      const source = sourceGroups[sourceIndex];
      if (!source || sourceIndex === activeSourceIndex) return;

      if (state.type === "movie") {
        const selectedCandidate = source.directLinks?.[0];
        if (!selectedCandidate) return;
        const nextQueue = buildMovieExtractionQueue(
          sourceGroups,
          selectedCandidate,
        );
        if (!nextQueue.length) return;
        setPlaybackEpisodeList(nextQueue);
        setActiveEpisodeIndex(0);
        setActiveSourceIndex(sourceIndex);
        return;
      }

      let nextEpisodes = source.directLinks || [];
      if (!nextEpisodes.length && source.episodesLink) {
        nextEpisodes = await providerManager.getEpisodes({
          url: source.episodesLink,
          providerValue: state.providerValue,
        });
      }
      if (!nextEpisodes.length) return;

      setPlaybackEpisodeList(nextEpisodes);
      setActiveEpisodeIndex((currentIndex) =>
        Math.min(currentIndex, Math.max(nextEpisodes.length - 1, 0)),
      );
      setActiveSourceIndex(sourceIndex);
    },
    [state.sourceGroups, state.type, state.providerValue, activeSourceIndex],
  );

  const {
    streamData,
    selectedStream,
    setSelectedStream,
    externalSubs,
    isLoading: streamLoading,
    error: streamError,
    failure: streamFailure,
    retryCurrentExtraction,
  } = useStream({
    activeEpisode,
    routeParams,
    provider: state.providerValue || provider?.value || "",
  });

  const isAndroid = navigator.userAgent.toLowerCase().includes("android");
  const useExternalPlayer =
    isAndroid && settingsStorage.isExternalPlayerEnabled();
  const isWebRuntime = !(window as any).__TAURI_INTERNALS__;

  // Browsers always use the in-page HTML5/HLS player. The Android/Linux
  // external-player branch is only for native Tauri builds.
  if (isWebRuntime) {
    return (
      <DesktopPlayer
        state={playbackState}
        activeEpisode={activeEpisode}
        activeEpisodeIndex={activeEpisodeIndex}
        setActiveEpisodeIndex={setActiveEpisodeIndex}
        streamLoading={streamLoading}
        streamError={streamError}
        streamFailure={streamFailure}
        retryCurrentExtraction={retryCurrentExtraction}
        streamData={streamData}
        selectedStream={selectedStream}
        setSelectedStream={setSelectedStream}
        externalSubs={externalSubs}
        routeParams={routeParams}
        sourceGroups={state.sourceGroups || []}
        activeSourceIndex={activeSourceIndex}
        onSelectPlaybackSource={switchPlaybackSource}
        hourglassSandColor={hourglassSandColor}
      />
    );
  }

  if (isAndroid) {
    return (
      <TvPlayer
        state={playbackState}
        activeEpisode={activeEpisode}
        streamLoading={streamLoading}
        streamError={streamError}
        streamFailure={streamFailure}
        retryCurrentExtraction={retryCurrentExtraction}
        streamData={streamData}
        selectedStream={selectedStream}
        setSelectedStream={setSelectedStream}
        isAndroid={isAndroid}
        useExternalPlayer={useExternalPlayer}
        hourglassSandColor={hourglassSandColor}
      />
    );
  }
  return (
    <DesktopPlayer
      state={playbackState}
      activeEpisode={activeEpisode}
      activeEpisodeIndex={activeEpisodeIndex}
      setActiveEpisodeIndex={setActiveEpisodeIndex}
      streamLoading={streamLoading}
      streamError={streamError}
      streamFailure={streamFailure}
      retryCurrentExtraction={retryCurrentExtraction}
      streamData={streamData}
      selectedStream={selectedStream}
      setSelectedStream={setSelectedStream}
      externalSubs={externalSubs}
      routeParams={routeParams}
      sourceGroups={state.sourceGroups || []}
      activeSourceIndex={activeSourceIndex}
      onSelectPlaybackSource={switchPlaybackSource}
      hourglassSandColor={hourglassSandColor}
    />
  );
};

const TvPlayer: React.FC<any> = ({
  state,
  activeEpisode,
  streamLoading,
  streamError,
  streamData,
  selectedStream,
  setSelectedStream,
  isAndroid,
  useExternalPlayer,
  hourglassSandColor,
}) => {
  const navigate = useNavigate();
  const { addItem } = useWatchHistoryStore();
  const [isLaunching, setIsLaunching] = useState(false);

  const {
    ref: focusRef,
    focusKey,
    focusSelf,
  } = useFocusable({
    focusable: true,
    trackChildren: true,
    isFocusBoundary: true,
    preferredChildFocusKey: streamLoading
      ? "PLAYER_LOADING_BACK"
      : "TV_SERVER_0",
  });

  useEffect(() => {
    const timer = setTimeout(() => focusSelf(), 50);
    return () => clearTimeout(timer);
  }, [focusSelf, streamLoading, streamError]);

  useEffect(() => {
    // Save to watch history when opened
    if (state.primaryTitle && !state.doNotTrack) {
      addItem({
        id:
          activeEpisode?.sourceLink || activeEpisode?.id || activeEpisode?.link,
        title: state.primaryTitle,
        poster: state.poster?.poster || state.poster?.background || "",
        background: state.poster?.background,
        link: state.infoUrl || "",
        provider: state.providerValue || "",
        lastPlayed: Date.now(),
        playbackRate: 1,
        episodeTitle: state.secondaryTitle,
        episode: activeEpisode,
        type: state.type,
      });
    }
  }, [state, activeEpisode?.link, addItem]);

  const handlePlayNative = useCallback(
    async (stream: any) => {
      if (!stream?.link) return;
      setIsLaunching(true);
      try {
        let playUrl = stream.link;

        if (playUrl.startsWith("magnet:")) {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const apiPort = await invoke<number>("get_torrent_api_port");
            const addRes = await fetch(`http://127.0.0.1:${apiPort}/torrents`, {
              method: "POST",
              body: playUrl,
            });
            if (!addRes.ok) throw new Error("Failed to add torrent");
            const data = await addRes.json();
            const infoHash = data.details.info_hash;

            // Wait for torrent to become live
            const deadline = Date.now() + 60000;
            while (Date.now() < deadline) {
              const statsRes = await fetch(
                `http://127.0.0.1:${apiPort}/torrents/${infoHash}/stats/v1`,
              );
              if (statsRes.ok) {
                const stats = await statsRes.json();
                if (stats.state === "live" || stats.state === "paused") break;
              }
              await new Promise((r) => setTimeout(r, 500));
            }

            const torrentFiles = data.details.files || [];
            const rawName = torrentFiles[0]?.name || "";
            const fileName = rawName.substring(
              Math.max(rawName.lastIndexOf("/"), rawName.lastIndexOf("\\")) + 1,
            );
            const nameSuffix = fileName
              ? `/${encodeURIComponent(fileName)}`
              : "";
            playUrl = `http://127.0.0.1:${apiPort}/torrents/${infoHash}/stream/0${nameSuffix}`;
          } catch (e) {
            console.error(
              "Failed to resolve torrent stream for external player",
              e,
            );
          }
        }

        if (isAndroid) {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          const headers = stream.headers ? JSON.stringify(stream.headers) : "";
          const external = useExternalPlayer ? "&external=1" : "";
          const intentUrl = `vega://play?url=${encodeURIComponent(playUrl)}&headers=${encodeURIComponent(headers)}${external}`;
          await openUrl(intentUrl);
        }
      } catch (e) {
        console.error("Failed to open player", e);
      } finally {
        // Keep loader visible for a couple seconds to cover the external player's startup time
        setTimeout(() => setIsLaunching(false), 2000);
      }
    },
    [isAndroid, useExternalPlayer],
  );

  if (streamLoading) {
    return (
      <FocusContext.Provider value={focusKey}>
        <div
          ref={focusRef}
          className="player-page controls-visible"
          style={{
            backgroundImage: `url(${state.poster?.background})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div
            className="player-page-overlay"
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.92)",
            }}
          />
          <FocusableButton
            className="player-loading-back"
            focusKey="PLAYER_LOADING_BACK"
            onClick={() => navigate(-1)}
            aria-label="Go back"
          >
            <ArrowLeft size={23} />
          </FocusableButton>
          <div className="player-loading" style={{ background: "transparent" }}>
            <AnimatedHourglass sandColor={hourglassSandColor} />
            <span className="loading-text">Fetching Stream...</span>
          </div>
        </div>
      </FocusContext.Provider>
    );
  }

  if (streamError) {
    const bgUrl = state.poster?.background || state.poster?.poster;
    return (
      <FocusContext.Provider value={focusKey}>
      <div
        ref={focusRef}
        className="player-page controls-visible"
        style={{
          backgroundImage: bgUrl ? `url(${bgUrl})` : "none",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {bgUrl && (
          <div
            className="player-page-overlay"
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.85)",
            }}
          />
        )}
        <div
          className="player-error"
          style={{ background: bgUrl ? "transparent" : "#000", zIndex: 1 }}
        >
          <p>{streamError.message || "Failed to load stream"}</p>
          <FocusableButton
            className="action-btn primary-btn"
            onClick={() => navigate(-1)}
          >
            Go Back
          </FocusableButton>
        </div>
      </div>
      </FocusContext.Provider>
    );
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={focusRef}
        className="tv-server-selection"
        style={{
          backgroundImage: `url(${state.poster?.background || state.poster?.poster})`,
        }}
      >
        <div className="tv-server-backdrop" />

        <div className="tv-server-shell">
          <header className="tv-server-header">
            <FocusableButton
              focusKey="TV_SERVER_BACK"
              className="tv-server-back"
              onClick={() => navigate(-1)}
              aria-label="Go back"
            >
              <ArrowLeft size={24} />
            </FocusableButton>
            <div className="tv-server-title-copy">
              <span className="tv-server-eyebrow">
                {useExternalPlayer ? "Open in external player" : "Play in Vega"}
              </span>
              <h1>{state.primaryTitle}</h1>
              {activeEpisode?.title && <p>{activeEpisode.title}</p>}
            </div>
          </header>

          {isLaunching ? (
            <div className="tv-server-launching">
              <div className="loading-spinner" />
              <span>
                {useExternalPlayer ? "Opening app chooser…" : "Opening Vega player…"}
              </span>
            </div>
          ) : (
            <section className="tv-server-panel">
              <div className="tv-server-panel-heading">
                <div className="tv-server-panel-icon">
                  <Server size={21} />
                </div>
                <div>
                  <h2>Server</h2>
                  <p>{streamData?.length || 0} available</p>
                </div>
              </div>

              <div className="tv-server-list">
                {streamData?.map((stream: any, idx: number) => (
                  <FocusableButton
                    key={stream.link + "-" + idx}
                    focusKey={"TV_SERVER_" + idx}
                    className={
                      "tv-server-card " +
                      (selectedStream?.link === stream.link ? "selected" : "")
                    }
                    onClick={() => {
                      setSelectedStream(stream);
                      handlePlayNative(stream);
                    }}
                  >
                    <span className="tv-server-play">
                      <Play size={20} />
                    </span>
                    <span className="tv-server-name">
                      {stream.server || "Server " + (idx + 1)}
                    </span>
                    {stream.quality && (
                      <span className="tv-server-quality">
                        {stream.quality}
                      </span>
                    )}
                    <ExternalLink className="tv-server-open-icon" size={19} />
                  </FocusableButton>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </FocusContext.Provider>
  );
};

const SidebarEpisodeItem = React.memo<{
  episode: any;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  itemRef?: React.Ref<HTMLButtonElement>;
}>(({ episode, index, isActive, onSelect, itemRef }) => {
  const epNum = index + 1;
  const title = episode?.title || `Episode ${epNum}`;
  const description = episode?.description?.trim();
  const rawImage = episode?.image || episode?.poster || episode?.still_path;
  const source =
    rawImage?.trim() && /^https?:\/\//i.test(rawImage) ? rawImage : undefined;
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => setImgFailed(false), [source]);

  return (
    <button
      ref={itemRef}
      type="button"
      className={`player-episode-sidebar-item ${isActive ? "active" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <div
        className={`player-episode-sidebar-media ${source && !imgFailed ? "has-image" : ""}`}
      >
        {source && !imgFailed ? (
          <img
            src={source}
            alt=""
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="player-episode-sidebar-media-placeholder">
            {epNum}
          </span>
        )}
        <div className="player-episode-sidebar-media-overlay">
          <Play size={18} fill={isActive ? "var(--primary)" : "#ffffff"} />
        </div>
      </div>
      <div className="player-episode-sidebar-item-info">
        <strong className="player-episode-sidebar-item-title">{title}</strong>
        {description && (
          <small className="player-episode-sidebar-item-desc">
            {description}
          </small>
        )}
      </div>
    </button>
  );
});

const DesktopPlayer: React.FC<any> = ({
  state,
  activeEpisode,
  activeEpisodeIndex,
  setActiveEpisodeIndex,
  streamLoading,
  streamError,
  streamFailure,
  retryCurrentExtraction,
  streamData,
  selectedStream,
  setSelectedStream,
  externalSubs,
  routeParams,
  sourceGroups,
  activeSourceIndex,
  onSelectPlaybackSource,
  hourglassSandColor,
}) => {
  const navigate = useNavigate();
  const { history, addItem, updatePlaybackInfo } = useWatchHistoryStore();
  const { provider, installedProviders } = useContentStore();
  const isWebRuntime = !(window as any).__TAURI_INTERNALS__;

  const [showControls, setShowControls] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [isCropped, setIsCropped] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(() =>
    settingsStorage.getPlayerZoom(),
  );
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showEpisodeSidebar, setShowEpisodeSidebar] = useState(false);
  const activeEpisodeItemRef = useRef<HTMLButtonElement | null>(null);
  const showEpisodeSidebarSetting = settingsStorage.showPlayerEpisodeSidebar();
  const hasMultipleEpisodes =
    Array.isArray(state.episodeList) &&
    state.episodeList.length > 1 &&
    state.type !== "movie";
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const controlsTimerRef = useRef<number | null>(null);
  const isScrubbingRef = useRef(false);
  const prevStreamLinkRef = useRef<string | null>(null);
  const pendingResumePositionRef = useRef<number | null>(null);
  const pendingResumePausedRef = useRef<boolean | null>(null);
  const pendingResumeRateRef = useRef<number | null>(null);
  const capturePlaybackPositionRef = useRef<() => void>(() => {});
  const appliedAudioForStreamRef = useRef<string | null>(null);
  const appliedSubtitleForStreamRef = useRef<string | null>(null);
  const prePipStateRef = useRef<{ size: any; pos: any } | null>(null);
  const preFullscreenStateRef = useRef<{
    size: any;
    pos: any;
    maximized: boolean;
    alwaysOnTop: boolean;
  } | null>(null);
  const manualFullscreenRef = useRef(false);
  const isWindows = navigator.userAgent.toLowerCase().includes("windows");
  const attemptedStreamKeysRef = useRef<Set<string>>(new Set());
  const attemptedMirrorLinksRef = useRef<Set<string>>(new Set());
  const fallbackAudioAdvanceRef = useRef<() => void>(() => {});
  const hostBlockRegistryRef = useRef(
    createHostBlockRegistry({ threshold: 2, ttlMs: 5 * 60_000 }),
  );
  const [terminalPlaybackFailure, setTerminalPlaybackFailure] =
    useState<PlaybackFailure | null>(null);
  const [playbackReloadNonce, setPlaybackReloadNonce] = useState(0);

  const downloads = useDownloadStore((state) => state.downloads);

  const getCachedSkips = (keys: (string | undefined)[]): SkipInterval[] => {
    for (const key of keys) {
      if (!key) continue;
      try {
        const cached = cacheStorage.getString(`skips_${key}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch {}
    }
    return [];
  };

  const cacheSkips = (keys: (string | undefined)[], skips: SkipInterval[]) => {
    if (!skips || skips.length === 0) return;
    const serialized = JSON.stringify(skips);
    for (const key of keys) {
      if (!key) continue;
      try {
        cacheStorage.setString(`skips_${key}`, serialized);
      } catch {}
    }
  };

  const combinedSkips: SkipInterval[] = useMemo(() => {
    const list: SkipInterval[] = [];
    const addSkips = (items?: SkipInterval[]) => {
      if (!items || !Array.isArray(items)) return;
      for (const item of items) {
        if (
          item &&
          typeof item.from === "number" &&
          typeof item.to === "number" &&
          item.to > item.from &&
          item.from >= 0
        ) {
          const exists = list.some(
            (s) =>
              Math.abs(s.from - item.from) < 1 &&
              Math.abs(s.to - item.to) < 1,
          );
          if (!exists) {
            list.push({
              title: item.title || "Intro",
              from: item.from,
              to: item.to,
            });
          }
        }
      }
    };

    addSkips(activeEpisode?.skip);
    addSkips(activeEpisode?.skips);
    addSkips(selectedStream?.skip);
    addSkips(selectedStream?.skips);

    if (Array.isArray(state?.linkList)) {
      for (const linkGroup of state.linkList) {
        if (Array.isArray(linkGroup?.directLinks)) {
          const match = linkGroup.directLinks.find(
            (d: any) => d?.link === activeEpisode?.link,
          );
          if (match) {
            addSkips(match.skip);
          }
        }
      }
    }

    // Check downloadStore for matching download item with skip intervals
    const allDownloadsList = Object.values(downloads);
    const matchedDownload = allDownloadsList.find(
      (d) =>
        (activeEpisode?.id && d.id === activeEpisode.id) ||
        (activeEpisode?.link &&
          (d.filePath === activeEpisode.link ||
            d.url === activeEpisode.link ||
            d.sourceLink === activeEpisode.link)) ||
        (activeEpisode?.sourceLink &&
          (d.sourceLink === activeEpisode.sourceLink ||
            d.url === activeEpisode.sourceLink ||
            d.filePath === activeEpisode.sourceLink)) ||
        (selectedStream?.link &&
          (d.filePath === selectedStream.link ||
            d.url === selectedStream.link)),
    );
    if (matchedDownload?.skip) {
      addSkips(matchedDownload.skip);
    }

    // Check cacheStorage if no skips found yet
    const episodeCacheKey =
      activeEpisode?.link ||
      activeEpisode?.sourceLink ||
      activeEpisode?.id ||
      (state?.infoUrl && activeEpisode?.title
        ? `${state.infoUrl}:${activeEpisode.title}`
        : undefined);

    if (list.length === 0) {
      const cached = getCachedSkips([
        activeEpisode?.link,
        activeEpisode?.sourceLink,
        activeEpisode?.id,
        episodeCacheKey,
      ]);
      addSkips(cached);
    }

    const sorted = list.sort((a, b) => a.from - b.from);

    // Save to cache for future offline / download playback if skips exist
    if (sorted.length > 0) {
      cacheSkips(
        [
          activeEpisode?.link,
          activeEpisode?.sourceLink,
          activeEpisode?.id,
          episodeCacheKey,
        ],
        sorted,
      );
    }

    return sorted;
  }, [activeEpisode, downloads, selectedStream, state?.infoUrl, state?.linkList]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("player-window-fullscreen", isFullscreen);
    return () => document.body.classList.remove("player-window-fullscreen");
  }, [isFullscreen]);

  useEffect(() => {
    document.body.classList.toggle("player-window-pip", isPip);
    return () => document.body.classList.remove("player-window-pip");
  }, [isPip]);

  useEffect(() => {
    document.body.classList.toggle("player-controls-hidden", !showControls);
    return () => document.body.classList.remove("player-controls-hidden");
  }, [showControls]);

  const toast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 1600);
  }, []);

  const tryNextSource = useCallback(
    (failure?: PlaybackFailure): boolean => {
      capturePlaybackPositionRef.current();
      const currentKey = streamCandidateKey(selectedStream);
      if (currentKey) attemptedStreamKeysRef.current.add(currentKey);

      const nextStream = findNextUntriedStream(
        streamData || [],
        selectedStream,
        attemptedStreamKeysRef.current,
      );
      if (nextStream) {
        setTerminalPlaybackFailure(null);
        prevStreamLinkRef.current = null;
        setSelectedStream(nextStream);
        toast(`Source failed — trying ${nextStream.server || "another source"}`);
        return true;
      }

      if (state.type === "movie") {
        const currentMirror = activeEpisode?.sourceLink || activeEpisode?.link || "";
        if (currentMirror) attemptedMirrorLinksRef.current.add(currentMirror);
        const nextMirror = findNextMovieMirror(
          state.episodeList || [],
          activeEpisodeIndex,
          attemptedMirrorLinksRef.current,
          state.type,
        );
        if (nextMirror) {
          attemptedStreamKeysRef.current.clear();
          setTerminalPlaybackFailure(null);
          prevStreamLinkRef.current = null;
          setActiveEpisodeIndex(nextMirror.index);
          toast(`Host failed — trying ${nextMirror.episode.title || "another mirror"}`);
          return true;
        }
      }

      if (failure) setTerminalPlaybackFailure(failure);
      return false;
    },
    [
      activeEpisode,
      activeEpisodeIndex,
      selectedStream,
      setActiveEpisodeIndex,
      setSelectedStream,
      state.episodeList,
      state.type,
      streamData,
      toast,
    ],
  );

  const handlePlaybackFailure = useCallback(
    (failure: PlaybackFailure) => {
      if (!tryNextSource(failure)) {
        setTerminalPlaybackFailure(failure);
      }
    },
    [tryNextSource],
  );

  useEffect(() => {
    attemptedStreamKeysRef.current.clear();
    setTerminalPlaybackFailure(null);
  }, [activeEpisodeIndex]);

  // Extraction errors happen before a stream list exists. For movies only,
  // try another provider-supplied mirror. Never use this path to jump between
  // series episodes.
  useEffect(() => {
    if (!streamError) return;
    const failure =
      streamFailure || classifyPlaybackError(streamError);
    if (state.type === "movie") {
      const blockedHost =
        failure.category === "forbidden" ? extractBlockedHost(streamError) : null;
      if (blockedHost) {
        const hostState = hostBlockRegistryRef.current.record(
          state.providerValue || provider?.value || "unknown",
          blockedHost,
        );
        if (hostState.tripped) {
          setTerminalPlaybackFailure({
            ...failure,
            userMessage: `${blockedHost} repeatedly rejected this provider from the deployed server. Vega skipped the remaining equivalent mirrors.`,
          });
          toast(`Blocked host detected — skipped remaining ${blockedHost} mirrors`);
          return;
        }
      }

      const currentMirror = activeEpisode?.sourceLink || activeEpisode?.link || "";
      if (currentMirror) attemptedMirrorLinksRef.current.add(currentMirror);
      const nextMirror = findNextMovieMirror(
        state.episodeList || [],
        activeEpisodeIndex,
        attemptedMirrorLinksRef.current,
        state.type,
      );
      if (nextMirror) {
        capturePlaybackPositionRef.current();
        attemptedStreamKeysRef.current.clear();
        prevStreamLinkRef.current = null;
        setActiveEpisodeIndex(nextMirror.index);
        toast(`Extraction failed — trying ${nextMirror.episode.title || "another mirror"}`);
        return;
      }
    }
    setTerminalPlaybackFailure(failure);
  }, [
    activeEpisode,
    activeEpisodeIndex,
    setActiveEpisodeIndex,
    state.episodeList,
    state.type,
    state.providerValue,
    provider?.value,
    streamError,
    streamFailure,
    toast,
  ]);

  const copyStreamLink = useCallback(async () => {
    if (!selectedStream?.link) return;
    try {
      await navigator.clipboard.writeText(selectedStream.link);
      toast("Stream link copied");
    } catch (error) {
      console.error("Failed to copy stream link:", error);
      toast("Could not copy stream link");
    }
  }, [selectedStream?.link, toast]);

  const handleNextEpisode = useCallback(() => {
    if (activeEpisodeIndex < state.episodeList.length - 1) {
      capturePlaybackPositionRef.current();
      prevStreamLinkRef.current = null;
      appliedAudioForStreamRef.current = null;
      appliedSubtitleForStreamRef.current = null;
      setActiveEpisodeIndex((prev: number) => prev + 1);
      toast("Playing next episode");
    }
  }, [
    activeEpisodeIndex,
    state.episodeList.length,
    toast,
    setActiveEpisodeIndex,
  ]);

  const handlePrevEpisode = useCallback(() => {
    if (activeEpisodeIndex > 0) {
      capturePlaybackPositionRef.current();
      prevStreamLinkRef.current = null;
      appliedAudioForStreamRef.current = null;
      appliedSubtitleForStreamRef.current = null;
      setActiveEpisodeIndex((prev: number) => prev - 1);
      toast("Playing previous episode");
    }
  }, [activeEpisodeIndex, toast, setActiveEpisodeIndex]);

  const mpv = useMpvPlayer({
    onPlaybackFailure: handlePlaybackFailure,
    onFallbackAudioFailure: () => fallbackAudioAdvanceRef.current(),
    onFileLoaded: () => {
      setTerminalPlaybackFailure(null);
      const pendingPosition = pendingResumePositionRef.current;
      const pendingPaused = pendingResumePausedRef.current;
      const pendingRate = pendingResumeRateRef.current;
      pendingResumePositionRef.current = null;
      pendingResumePausedRef.current = null;
      pendingResumeRateRef.current = null;

      // A pending resume position means this load is a source/server/mirror
      // switch or a Retry, not a fresh episode. Continue exactly where the
      // playback left off instead of restarting from saved history.
      if (pendingPosition !== null && pendingPosition > 3) {
        mpv.seek(pendingPosition);
        if (pendingRate && pendingRate !== 1) {
          mpv.setPlaybackSpeed(pendingRate);
        }
        if (pendingPaused) {
          window.setTimeout(() => {
            void mpv
              .getProperty("pause")
              .then((isPaused) => {
                if (isPaused === false) void mpv.togglePause();
              })
              .catch(() => {});
          }, 1000);
        }
        const savedZoom = settingsStorage.getPlayerZoom();
        if (savedZoom !== 100) {
          mpv.setProperty("video-zoom", Math.log2(savedZoom / 100));
        }
        return;
      }

      const historyKey =
        activeEpisode?.sourceLink || activeEpisode?.id || activeEpisode?.link;
      const syncedProgress = history.find(
        (item) => item.id === historyKey,
      )?.progress;
      if (syncedProgress !== undefined) {
        if (syncedProgress > 5) mpv.seek(syncedProgress);
        return;
      }
      const uniqueEpisodeKey =
        activeEpisode?.id ||
        `resume_${routeParams?.primaryTitle}_${routeParams?.secondaryTitle}_${activeEpisodeIndex}`;
      const cached = cacheStorage.getString(uniqueEpisodeKey);
      if (cached) {
        try {
          const { position } = JSON.parse(cached);
          if (position > 5) mpv.seek(position);
        } catch {}
      }

      const savedZoom = settingsStorage.getPlayerZoom();
      if (savedZoom !== 100) {
        mpv.setProperty("video-zoom", Math.log2(savedZoom / 100));
      }
    },
  });

  // Reads the live mpv state each time failover/switch handlers run, so the
  // captured position is never stale even though mpv.currentTime changes on
  // every render.
  capturePlaybackPositionRef.current = () => {
    if (
      mpv.duration > 0 &&
      Number.isFinite(mpv.currentTime) &&
      mpv.currentTime > 1
    ) {
      pendingResumePositionRef.current = mpv.currentTime;
    } else {
      pendingResumePositionRef.current = null;
    }
    pendingResumePausedRef.current = mpv.isPaused;
    pendingResumeRateRef.current = playbackRate;
  };

  const fallbackAudioCandidate = useMemo(
    () =>
      state.type === "movie"
        ? findFallbackAudioStream(state.episodeList || [], activeEpisode)
        : null,
    [state.type, state.episodeList, activeEpisode],
  );

  const { streams: extractedFallbackAudioStreams } = useFallbackAudioStream({
    fallbackCandidate: fallbackAudioCandidate,
    routeParams,
    provider: state.providerValue || provider?.value || "",
    enabled: isWebRuntime && Boolean(fallbackAudioCandidate?.link),
  });

  const inlineFallbackAudioStream = useMemo(
    () => findFallbackAudioStream(streamData, selectedStream),
    [streamData, selectedStream],
  );
  const fallbackAudioStreams = useMemo(() => {
    const seen = new Set<string>();
    const candidates = [
      ...(extractedFallbackAudioStreams || []),
      ...(inlineFallbackAudioStream ? [inlineFallbackAudioStream] : []),
    ];
    const browserCapabilities = isWebRuntime ? detectBrowserMediaCapabilities() : null;
    return candidates.filter((stream) => {
      if (!stream?.link || !/^https?:\/\//i.test(stream.link)) return false;
      if (browserCapabilities && !describeWebStream(stream, browserCapabilities).playable) return false;
      if (stream.link === selectedStream?.link || seen.has(stream.link)) return false;
      const type = String(stream.type || "").toLowerCase();
      if (type === "torrent" || stream.link.startsWith("magnet:")) return false;
      seen.add(stream.link);
      return true;
    });
  }, [extractedFallbackAudioStreams, inlineFallbackAudioStream, selectedStream?.link, isWebRuntime]);
  const [fallbackAudioIndex, setFallbackAudioIndex] = useState(0);

  useEffect(() => {
    setFallbackAudioIndex(0);
  }, [fallbackAudioCandidate?.link, selectedStream?.link, activeEpisode?.link]);

  const fallbackAudioStream = fallbackAudioStreams[fallbackAudioIndex] || null;
  fallbackAudioAdvanceRef.current = () => {
    setFallbackAudioIndex((current) => {
      const next = current + 1;
      if (next < fallbackAudioStreams.length) {
        toast("Fallback audio failed — trying another audio server");
        return next;
      }
      if (fallbackAudioStreams.length > 0) {
        toast("Fallback audio unavailable — primary audio restored");
      }
      return fallbackAudioStreams.length;
    });
  };

  useEffect(() => {
    if (!isWebRuntime || !mpv.isInitialized) return;

    const applyFallbackAudio = async () => {
      await mpv.setProperty(
        "vega-backup-audio-type",
        fallbackAudioStream?.type || "",
      );
      await mpv.setProperty(
        "vega-backup-audio-label",
        fallbackAudioStream?.quality
          ? `Fallback Audio ${fallbackAudioStream.quality}p`
          : "Fallback Audio",
      );
      await mpv.setProperty(
        "vega-backup-audio-headers",
        JSON.stringify(fallbackAudioStream?.headers || {}),
      );
      await mpv.setProperty(
        "vega-backup-audio-url",
        fallbackAudioStream?.link || "",
      );
      await mpv.setProperty("vega-backup-audio-apply", "1");
    };

    void applyFallbackAudio();
  }, [
    isWebRuntime,
    mpv.isInitialized,
    fallbackAudioStream?.link,
    fallbackAudioStream?.type,
    fallbackAudioStream?.quality,
    fallbackAudioStream?.headers,
  ]);

  const { handleProgress } = usePlayerProgress({
    activeEpisode,
    routeParams,
    playbackRate,
    updatePlaybackInfo,
  });

  const mediaArtwork = useMemo(
    () =>
      [state.poster?.poster, state.poster?.background].filter(
        (source): source is string => Boolean(source),
      ),
    [state.poster?.background, state.poster?.poster],
  );
  const handleMediaSeekRelative = useCallback(
    (offset: number) => mpv.seek(offset, "relative"),
    [mpv.seek],
  );

  useMediaSession({
    enabled: mpv.isInitialized && Boolean(selectedStream?.link),
    title:
      state.type === "series"
        ? activeEpisode?.title || state.primaryTitle
        : state.primaryTitle,
    artist: state.type === "series" ? state.primaryTitle : "Vega",
    album: state.secondaryTitle,
    artwork: mediaArtwork,
    isPaused: mpv.isPaused,
    currentTime: mpv.currentTime,
    duration: mpv.duration,
    playbackRate,
    onTogglePause: mpv.togglePause,
    onSeek: mpv.seek,
    onSeekRelative: handleMediaSeekRelative,
    onNext:
      activeEpisodeIndex < state.episodeList.length - 1
        ? handleNextEpisode
        : undefined,
    onPrevious: activeEpisodeIndex > 0 ? handlePrevEpisode : undefined,
  });

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const root = document.getElementById("root");
    if (root) root.style.background = "transparent";
    return () => {
      document.documentElement.style.background = "";
      document.body.style.background = "";
      if (root) root.style.background = "";
      const win = getCurrentWindow();
      const previousState = preFullscreenStateRef.current;
      void (async () => {
        await win.setFullscreen(false).catch(() => {});
        if (previousState) {
          await win.setAlwaysOnTop(previousState.alwaysOnTop).catch(() => {});
          if (previousState.maximized) {
            await win.maximize().catch(() => {});
            await invoke("ensure_window_in_work_area", {
              maximized: true,
            }).catch(() => {});
          } else if (manualFullscreenRef.current) {
            await win.setPosition(previousState.pos).catch(() => {});
            await win.setSize(previousState.size).catch(() => {});
          }
        }
        manualFullscreenRef.current = false;
        preFullscreenStateRef.current = null;
      })();
    };
  }, []);

  useEffect(() => {
    mpv.initPlayer();
    return () => {
      mpv.destroyPlayer();
    };
  }, []);

  useEffect(() => {
    if (mpv.isInitialized) {
      mpv.updateSubtitleSettings();
      const savedZoom = settingsStorage.getPlayerZoom();
      if (savedZoom !== 100) {
        mpv.setProperty("video-zoom", Math.log2(savedZoom / 100));
      }
    }
  }, [mpv.isInitialized]);

  // Apply saved audio and subtitle track preferences once per new stream/episode
  useEffect(() => {
    if (!mpv.isInitialized || !selectedStream?.link) return;
    const streamLink = selectedStream.link;

    // 1. Audio track matching
    if (
      appliedAudioForStreamRef.current !== streamLink &&
      mpv.audioTracks.length > 0
    ) {
      const saved = getSavedTrackPreference(state);
      if (saved) {
        const targetAudio = findBestMatchingAudioTrack(mpv.audioTracks, saved);
        if (targetAudio) {
          appliedAudioForStreamRef.current = streamLink;
          if (!targetAudio.selected) {
            mpv.selectTrack("aid", targetAudio.id);
          }
        }
      }
    }

    // 2. Subtitle track matching
    if (
      appliedSubtitleForStreamRef.current !== streamLink &&
      mpv.subtitleTracks.length > 0
    ) {
      const saved = getSavedTrackPreference(state);
      if (saved) {
        if (saved.subOff) {
          appliedSubtitleForStreamRef.current = streamLink;
          const anySelected = mpv.subtitleTracks.some((t) => t.selected);
          if (anySelected) {
            mpv.selectTrack("sid", "no");
          }
        } else {
          const targetSub = findBestMatchingSubtitleTrack(
            mpv.subtitleTracks,
            saved,
          );
          if (targetSub) {
            appliedSubtitleForStreamRef.current = streamLink;
            if (!targetSub.selected) {
              mpv.selectTrack("sid", targetSub.id);
            }
          }
        }
      } else {
        const downloadedTrack = mpv.subtitleTracks.find((t) => {
          const title = t.title?.toLowerCase() || "";
          return title.includes("downloaded") || title.includes("local");
        });
        if (downloadedTrack) {
          appliedSubtitleForStreamRef.current = streamLink;
          if (!downloadedTrack.selected) {
            mpv.selectTrack("sid", downloadedTrack.id);
          }
        }
      }
    }
  }, [
    mpv.audioTracks,
    mpv.subtitleTracks,
    selectedStream?.link,
    mpv.isInitialized,
    state,
  ]);

  useEffect(() => {
    if (!mpv.isInitialized || !selectedStream?.link) return;
    if (prevStreamLinkRef.current === selectedStream.link) return;
    prevStreamLinkRef.current = selectedStream.link;

    (async () => {
      const allSubs = [
        ...(selectedStream.subtitles || []),
        ...(externalSubs || []),
      ];
      const seen = new Set<string>();
      const subs = allSubs.filter((sub) => {
        const url = sub.url || sub.uri;
        if (!url || seen.has(url)) return false;
        seen.add(url);
        return true;
      });
      await mpv.loadFile(
        selectedStream.link,
        selectedStream.headers,
        subs,
        selectedStream.type,
        selectedStream.localBaseDir,
        fallbackAudioStream?.link
          ? {
              url: fallbackAudioStream.link,
              headers: fallbackAudioStream.headers,
              type: fallbackAudioStream.type,
              quality: fallbackAudioStream.quality,
            }
          : undefined,
      );
    })();
  }, [
    mpv.isInitialized,
    selectedStream?.link,
    activeEpisode?.link,
    toast,
    externalSubs,
    playbackReloadNonce,
    fallbackAudioStream,
  ]);

  useEffect(() => {
    if (mpv.currentTime > 0 && mpv.duration > 0) {
      handleProgress({
        currentTime: mpv.currentTime,
        seekableDuration: mpv.duration,
      });
    }
  }, [Math.floor(mpv.currentTime)]);

  useEffect(() => {
    if (!state.primaryTitle || state.doNotTrack) return;
    addItem({
      id: activeEpisode?.sourceLink || activeEpisode?.id || activeEpisode?.link,
      title: state.primaryTitle,
      poster: state.poster?.poster || state.poster?.background || "",
      background: state.poster?.background,
      link: state.infoUrl || "",
      provider: state.providerValue || provider?.value || "",
      lastPlayed: Date.now(),
      playbackRate: 1,
      episodeTitle: activeEpisode?.title || state.secondaryTitle,
      episode: activeEpisode,
      type: state.type,
    });
  }, [
    state,
    activeEpisode?.id,
    activeEpisode?.link,
    activeEpisode?.title,
    addItem,
    provider?.value,
  ]);

  const hideControls = useCallback(() => {
    if (!showShortcuts && !showEpisodeSidebar && !isScrubbingRef.current) {
      setShowControls(false);
    }
  }, [showShortcuts, showEpisodeSidebar]);
  const scheduleHide = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = window.setTimeout(hideControls, 3500);
  }, [hideControls]);

  useEffect(() => {
    if (showEpisodeSidebar) {
      const timer = window.setTimeout(() => {
        activeEpisodeItemRef.current?.scrollIntoView({
          behavior: "auto",
          block: "nearest",
        });
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [showEpisodeSidebar]);

  const revealControls = useCallback(() => {
    setShowControls(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    if (showControls) scheduleHide();
  }, [showControls, scheduleHide]);

  const handleControlsInteraction = useCallback(
    (interacting: boolean) => {
      isScrubbingRef.current = interacting;
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
        controlsTimerRef.current = null;
      }
      setShowControls(true);
      if (!interacting) scheduleHide();
    },
    [scheduleHide],
  );

  const lastPointerPosRef = useRef<{ x: number; y: number } | null>(null);

  // Only wake the overlay on real pointer movement. Mouse/touchdrift from
  // trackpads and wireless mice emits sub-pixel events constantly; treating
  // every one as user activity would keep the inactivity timer forever
  // rescheduled and the controls permanently visible.
  const maybeRevealControls = useCallback(
    (x: number, y: number) => {
      const last = lastPointerPosRef.current;
      lastPointerPosRef.current = { x, y };
      if (!last) {
        revealControls();
        return;
      }
      if (Math.abs(x - last.x) + Math.abs(y - last.y) >= 6) revealControls();
    },
    [revealControls],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "touch" && event.pressure === 0) return;
      maybeRevealControls(event.clientX, event.clientY);
    },
    [maybeRevealControls],
  );
  const handleBackgroundClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      // Interactive children manage themselves; clicking them must not flip
      // the whole overlay's visibility.
      if (
        target?.closest(
          "button, a, input, select, textarea, [contenteditable='true'], .player-timeline, .timeline-track, .inline-menu, .inline-menu-container, .player-skip-btn, .player-episode-sidebar, .player-episode-sidebar-backdrop, .player-shortcuts-overlay, .player-shortcuts-dialog, .search-subtitles-modal, .search-subtitles-container",
        )
      ) {
        return;
      }
      if (showControls) {
        setShowControls(false);
        if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      } else {
        revealControls();
      }
    },
    [showControls, revealControls],
  );

  const applyZoom = useCallback(
    (newZoom: number) => {
      const clamped = Math.min(300, Math.max(50, Math.round(newZoom)));
      setZoomLevel(clamped);
      settingsStorage.setPlayerZoom(clamped);
      const mpvZoom = clamped === 100 ? 0.0 : Math.log2(clamped / 100);
      mpv.setProperty("video-zoom", mpvZoom);
      toast(`Zoom: ${clamped}%${clamped === 100 ? " (Default)" : ""}`);
    },
    [mpv, toast],
  );

  const handleZoomIn = useCallback(() => {
    applyZoom(zoomLevel + 10);
  }, [applyZoom, zoomLevel]);

  const handleZoomOut = useCallback(() => {
    applyZoom(zoomLevel - 10);
  }, [applyZoom, zoomLevel]);

  const handleResetZoom = useCallback(() => {
    applyZoom(100);
  }, [applyZoom]);

  useEffect(() => {
    import("@noriginmedia/norigin-spatial-navigation")
      .then(({ pause, resume }) => {
        pause();
        return () => resume();
      })
      .catch(() => {});

    const handleWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          ".inline-menu, .inline-menu-container, .player-shortcuts-overlay, .player-shortcuts-dialog, .search-subtitles-modal, .search-subtitles-container, .player-episode-sidebar, .player-episode-sidebar-list, [data-prevent-wheel-volume]",
        )
      ) {
        return;
      }
      revealControls();
      const newVol =
        e.deltaY < 0
          ? Math.min(200, mpv.volume + 5)
          : Math.max(0, mpv.volume - 5);
      mpv.setVolumeLevel(newVol);
      toast(`Volume: ${Math.round(newVol)}%`);
    };

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      switch (key) {
        case " ":
        case "k":
        case "enter":
          e.preventDefault();
          mpv.togglePause();
          break;
        case "arrowleft":
          e.preventDefault();
          mpv.seek(-10, "relative");
          break;
        case "arrowright":
          e.preventDefault();
          mpv.seek(10, "relative");
          break;
        case "arrowup":
          e.preventDefault();
          mpv.setVolumeLevel(Math.min(200, mpv.volume + 5));
          toast(`Volume: ${Math.min(200, Math.round(mpv.volume + 5))}%`);
          break;
        case "arrowdown":
          e.preventDefault();
          mpv.setVolumeLevel(Math.max(0, mpv.volume - 5));
          toast(`Volume: ${Math.max(0, Math.round(mpv.volume - 5))}%`);
          break;
        case "f":
          toggleFullscreen();
          break;
        case "escape":
          if (showEpisodeSidebar) setShowEpisodeSidebar(false);
          else if (showShortcuts) setShowShortcuts(false);
          else if (isFullscreen) toggleFullscreen();
          else navigate(-1);
          break;
        case "m":
          mpv.setVolumeLevel(mpv.volume > 0 ? 0 : 100);
          toast(mpv.volume > 0 ? "Muted" : "Unmuted");
          break;
        case "n":
          handleNextEpisode();
          break;
        case "a": {
          if (!mpv.audioTracks.length) break;
          e.preventDefault();
          appliedAudioForStreamRef.current = selectedStream?.link || null;
          const selectedIndex = mpv.audioTracks.findIndex(
            (track) => track.selected,
          );
          const nextIndex = (selectedIndex + 1) % mpv.audioTracks.length;
          const nextTrack = mpv.audioTracks[nextIndex];
          mpv.selectTrack("aid", nextTrack.id);
          saveAudioPreference(state, nextTrack, nextIndex);
          toast(`Audio: ${formatTrackLabel(nextTrack)}`);
          break;
        }
        case "t": {
          e.preventDefault();
          appliedSubtitleForStreamRef.current = selectedStream?.link || null;
          const selectedIndex = mpv.subtitleTracks.findIndex(
            (track) => track.selected,
          );
          if (
            !mpv.subtitleTracks.length ||
            selectedIndex === mpv.subtitleTracks.length - 1
          ) {
            mpv.selectTrack("sid", "no");
            saveSubtitlePreference(state, "off");
            toast("Subtitles: Off");
          } else {
            const nextIndex = selectedIndex + 1;
            const nextTrack = mpv.subtitleTracks[nextIndex];
            mpv.selectTrack("sid", nextTrack.id);
            saveSubtitlePreference(state, nextTrack, nextIndex);
            toast(`Subtitles: ${formatTrackLabel(nextTrack)}`);
          }
          break;
        }
        case "<":
        case ">": {
          e.preventDefault();
          const step = key === "<" ? -0.25 : 0.25;
          const nextRate = Math.min(
            4,
            Math.max(0.25, Math.round((playbackRate + step) * 100) / 100),
          );
          setPlaybackRate(nextRate);
          mpv.setPlaybackSpeed(nextRate);
          toast(`Speed: ${nextRate.toFixed(2)}x`);
          break;
        }
        case "s": {
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            const nextChapter = mpv.chapters.find(
              (chapter) => chapter.time > mpv.currentTime + 1,
            );
            if (nextChapter) {
              mpv.seek(nextChapter.time);
              toast(`Chapter: ${nextChapter.title || "Next"}`);
            } else {
              toast("No next chapter");
            }
          } else {
            const activeSkip = combinedSkips.find(
              (skip) => mpv.currentTime >= skip.from && mpv.currentTime < skip.to,
            );
            if (activeSkip) {
              mpv.seek(activeSkip.to);
              const title = activeSkip.title
                ? activeSkip.title.toLowerCase().startsWith("skip")
                  ? activeSkip.title
                  : `Skip ${activeSkip.title}`
                : "Intro";
              toast(`Skipped ${title}`);
            } else {
              toast("No intro to skip");
            }
          }
          break;
        }
        case "+":
        case "=":
          e.preventDefault();
          handleZoomIn();
          break;
        case "-":
        case "_":
          e.preventDefault();
          handleZoomOut();
          break;
        case "0":
          e.preventDefault();
          handleResetZoom();
          break;
        case "?":
          e.preventDefault();
          setShowShortcuts((current) => !current);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", handleWheel);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", handleWheel);
      import("@noriginmedia/norigin-spatial-navigation")
        .then(({ resume }) => resume())
        .catch(() => {});
    };
  }, [
    mpv,
    isFullscreen,
    handleNextEpisode,
    revealControls,
    toast,
    playbackRate,
    showShortcuts,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    combinedSkips,
  ]);

  const toggleFullscreen = async () => {
    if (!(window as any).__TAURI_INTERNALS__) {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
          setIsFullscreen(false);
          try {
            // Release the landscape lock so the device can rotate freely again.
            (screen as any).orientation?.unlock?.();
          } catch {}
        } else {
          const target = document.querySelector('.player-page') as HTMLElement | null;
          await (target || document.documentElement).requestFullscreen?.();
          // On phones/tablets rotate the display to landscape so the player
          // fills the screen while fullscreen is active.
          try {
            await (screen as any).orientation?.lock?.("landscape");
          } catch {}
          setIsFullscreen(Boolean(document.fullscreenElement));
        }
      } catch (error) {
        console.error('Browser fullscreen failed:', error);
      }
      return;
    }
    const win = getCurrentWindow();
    try {
      const nativeFullscreen = await win.isFullscreen();
      const currentlyFullscreen =
        nativeFullscreen || manualFullscreenRef.current;

      if (currentlyFullscreen) {
        const previousState = preFullscreenStateRef.current;
        if (nativeFullscreen) await win.setFullscreen(false);
        await win.setAlwaysOnTop(previousState?.alwaysOnTop ?? false);

        if (previousState?.maximized) {
          if (!(await win.isMaximized())) await win.maximize();
          await invoke("ensure_window_in_work_area", { maximized: true });
        } else if (manualFullscreenRef.current && previousState) {
          await win.setPosition(previousState.pos);
          await win.setSize(previousState.size);
        }

        manualFullscreenRef.current = false;
        preFullscreenStateRef.current = null;
        setIsFullscreen(false);
        return;
      }

      preFullscreenStateRef.current = {
        size: await win.outerSize(),
        pos: await win.outerPosition(),
        maximized: await win.isMaximized(),
        alwaysOnTop: await win.isAlwaysOnTop(),
      };

      if (isWindows) {
        await invoke("set_player_fullscreen", { fullscreen: true });
      } else {
        await win.setFullscreen(true);
      }

      const monitor = await currentMonitor();
      const actualFullscreen = await win.isFullscreen();

      if (!actualFullscreen) {
        // Windows-safe borderless fallback: use the monitor's full bounds,
        // not its taskbar-reduced work area.
        if (!monitor) throw new Error("Unable to determine the active monitor");
        if (await win.isMaximized()) await win.unmaximize();
        await win.setDecorations(false);
        await win.setPosition(monitor.position);
        await win.setSize(monitor.size);
        await win.setAlwaysOnTop(true);
        manualFullscreenRef.current = true;
      } else {
        // Keeps Windows' taskbar below the verified fullscreen window.
        await win.setAlwaysOnTop(true);
      }

      setIsFullscreen(true);
    } catch (e) {
      console.error(e);
      const previousState = preFullscreenStateRef.current;
      await win.setFullscreen(false).catch(() => {});
      await win
        .setAlwaysOnTop(previousState?.alwaysOnTop ?? false)
        .catch(() => {});
      if (previousState?.maximized) {
        await win.maximize().catch(() => {});
        await invoke("ensure_window_in_work_area", { maximized: true }).catch(
          () => {},
        );
      } else if (previousState) {
        await win.setPosition(previousState.pos).catch(() => {});
        await win.setSize(previousState.size).catch(() => {});
      }
      manualFullscreenRef.current = false;
      preFullscreenStateRef.current = null;
      setIsFullscreen(false);
    }
  };

  const togglePip = async () => {
    if (!(window as any).__TAURI_INTERNALS__) {
      try {
        const video = document.getElementById('vega-web-video') as HTMLVideoElement | null;
        if (!video || !(document as any).pictureInPictureEnabled || !(video as any).requestPictureInPicture) {
          toast('Picture-in-picture is not supported by this browser');
          return;
        }
        if ((document as any).pictureInPictureElement) {
          await (document as any).exitPictureInPicture();
          setIsPip(false);
        } else {
          await (video as any).requestPictureInPicture();
          setIsPip(true);
          video.addEventListener('leavepictureinpicture', () => setIsPip(false), { once: true });
        }
      } catch (error) {
        console.error('Browser picture-in-picture failed:', error);
        setIsPip(false);
      }
      return;
    }
    try {
      const win = getCurrentWindow();
      const currentPip = await win.isAlwaysOnTop();
      const nextPip = !currentPip;
      if (nextPip) {
        const size = await win.innerSize();
        const pos = await win.outerPosition();
        prePipStateRef.current = { size, pos };
      }
      await win.setAlwaysOnTop(nextPip);
      await win.setDecorations(false);
      setIsPip(nextPip);
      if (nextPip) {
        const monitor = await currentMonitor();
        await win.setSize(new LogicalSize(480, 270));
        if (monitor) {
          const pipSize = await win.outerSize();
          const margin = Math.round(16 * monitor.scaleFactor);
          await win.setPosition(
            new PhysicalPosition(
              Math.max(
                monitor.position.x,
                monitor.position.x +
                  monitor.size.width -
                  pipSize.width -
                  margin,
              ),
              Math.max(
                monitor.position.y,
                monitor.position.y +
                  monitor.size.height -
                  pipSize.height -
                  margin,
              ),
            ),
          );
          if (isWindows) {
            await invoke("ensure_window_in_work_area", { maximized: false });
          }
        }
      } else {
        if (prePipStateRef.current) {
          await win.setSize(prePipStateRef.current.size);
          await win.setPosition(prePipStateRef.current.pos);
        } else {
          await win.setSize(new LogicalSize(1280, 720));
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const toggleCrop = () => {
    const nextCrop = !isCropped;
    setIsCropped(nextCrop);
    mpv.setProperty("panscan", nextCrop ? 1.0 : 0.0);
  };

  const handleStreamSelect = useCallback(
    (stream: any) => {
      capturePlaybackPositionRef.current();
      prevStreamLinkRef.current = null;
      appliedAudioForStreamRef.current = null;
      appliedSubtitleForStreamRef.current = null;
      setSelectedStream(stream);
    },
    [setSelectedStream],
  );

  const handleSourceSelect = useCallback(
    (sourceIndex: number) => {
      capturePlaybackPositionRef.current();
      if (typeof onSelectPlaybackSource === "function") {
        onSelectPlaybackSource(sourceIndex);
      }
    },
    [onSelectPlaybackSource],
  );

  const showNextBtn = useMemo(() => {
    if (activeEpisodeIndex >= state.episodeList.length - 1) return false;
    if (mpv.duration <= 0) return false;
    return mpv.currentTime / mpv.duration > 0.8;
  }, [
    activeEpisodeIndex,
    mpv.currentTime,
    mpv.duration,
    state.episodeList.length,
  ]);
  const nextEpisodeTitle =
    state.episodeList[activeEpisodeIndex + 1]?.title ||
    (activeEpisodeIndex < state.episodeList.length - 1
      ? `Episode ${activeEpisodeIndex + 2}`
      : undefined);

  const retryPlayback = () => {
    capturePlaybackPositionRef.current();
    setTerminalPlaybackFailure(null);
    const key = streamCandidateKey(selectedStream);
    if (key) attemptedStreamKeysRef.current.delete(key);
    prevStreamLinkRef.current = null;
    setPlaybackReloadNonce((value) => value + 1);
  };

  const blockingFailure = terminalPlaybackFailure ||
    (streamError ? (streamFailure || classifyPlaybackError(streamError)) : null);

  if (streamLoading) {
    const bgUrl = state.poster?.background || state.poster?.poster;
    return (
      <div className="player-page controls-visible">
        {bgUrl && (
          <>
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: `url(${bgUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                zIndex: -2,
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundColor: "rgba(0,0,0,0.95)",
                zIndex: -1,
              }}
            />
          </>
        )}
        <FocusableButton
          className="player-loading-back"
          focusKey="PLAYER_LOADING_BACK"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <ArrowLeft size={23} />
        </FocusableButton>
        <div
          className="player-loading"
          style={{ background: bgUrl ? "transparent" : "#000" }}
        >
          <AnimatedHourglass sandColor={hourglassSandColor} />
          <span className="loading-text">Fetching stream...</span>
        </div>
      </div>
    );
  }

  if (blockingFailure) {
    const bgUrl = state.poster?.background || state.poster?.poster;
    const canTryAnother =
      (streamData?.length || 0) > 1 ||
      (state.type === "movie" && (state.episodeList?.length || 0) > 1);
    return (
      <div className="player-page controls-visible">
        {bgUrl && (
          <>
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: `url(${bgUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                zIndex: -2,
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundColor: "rgba(0,0,0,0.95)",
                zIndex: -1,
              }}
            />
          </>
        )}
        <div className="player-error" style={{ background: bgUrl ? "transparent" : "#000" }}>
          <p>{blockingFailure.userMessage}</p>
          {selectedStream?.server && <small>Source: {selectedStream.server}</small>}
          <div className="player-error-actions">
            <button onClick={() => {
              if (streamError) void retryCurrentExtraction?.();
              else retryPlayback();
            }}>Retry</button>
            {canTryAnother && (
              <button onClick={() => void tryNextSource(blockingFailure)}>Try next source</button>
            )}
            {blockingFailure.hostBlocked && installedProviders.length > 1 && (
              <button
                onClick={() =>
                  navigate(`/search?q=${encodeURIComponent(state.primaryTitle)}`)
                }
              >
                Search other providers
              </button>
            )}
            {blockingFailure.hostBlocked && installedProviders.length <= 1 && (
              <button onClick={() => navigate("/extensions")}>Install another provider</button>
            )}
            <button onClick={() => navigate(-1)}>Go Back</button>
          </div>
        </div>
      </div>
    );
  }

  if (mpv.initializationError) {
    return (
      <PlayerInitError
        error={mpv.initializationError}
        onBack={() => navigate(-1)}
      />
    );
  }

  return (
    <div
      className={`player-page ${showControls ? "controls-visible" : ""}`}
      onPointerMove={handlePointerMove}
      style={{ backgroundColor: mpv.currentTime > 0 ? "transparent" : "#000" }}
      {...(isPip ? { "data-tauri-drag-region": true } : {})}
    >
      <PlayerControls
        visible={showControls}
        isPaused={mpv.isPaused}
        isBuffering={mpv.isBuffering}
        currentTime={mpv.currentTime}
        duration={mpv.duration}
        cacheDuration={mpv.cacheDuration}
        primaryTitle={state.primaryTitle}
        secondaryTitle={activeEpisode?.title || state.secondaryTitle}
        nextEpisodeTitle={nextEpisodeTitle}
        showNextEpisode={showNextBtn}
        onBack={() => navigate(-1)}
        onTogglePause={() => {
          mpv.togglePause();
          revealControls();
        }}
        onSeek={(t) => {
          mpv.seek(t);
          revealControls();
        }}
        onRequestThumbnail={mpv.requestThumbnail}
        thumbnailKey={`${selectedStream?.link || ""}:${activeEpisodeIndex}`}
        onScrubbingChange={handleControlsInteraction}
        onNextEpisode={handleNextEpisode}
        onPrevEpisode={handlePrevEpisode}
        hasNextEpisode={activeEpisodeIndex < state.episodeList.length - 1}
        hasPrevEpisode={activeEpisodeIndex > 0}
        onToggleFullscreen={toggleFullscreen}
        isFullscreen={isFullscreen}
        onTogglePip={togglePip}
        isPip={isPip}
        onToggleCrop={toggleCrop}
        isCropped={isCropped}
        zoomLevel={zoomLevel}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetZoom={handleResetZoom}
        onSetZoom={applyZoom}
        onClickBackground={handleBackgroundClick}
        audioTracks={mpv.audioTracks}
        subtitleTracks={mpv.subtitleTracks}
        videoTracks={mpv.videoTracks}
        chapters={mpv.chapters}
        videoHeight={mpv.videoHeight}
        playbackRate={playbackRate}
        streamData={streamData}
        selectedStream={selectedStream}
        onSelectStream={handleStreamSelect}
        sourceData={sourceGroups}
        selectedSourceIndex={activeSourceIndex}
        onSelectSource={handleSourceSelect}
        onSelectAudioTrack={(id) => {
          appliedAudioForStreamRef.current = selectedStream?.link || null;
          mpv.selectTrack("aid", id);
          const index = mpv.audioTracks.findIndex((item) => item.id === id);
          const track = mpv.audioTracks[index];
          if (track) {
            saveAudioPreference(state, track, index >= 0 ? index : undefined);
          }
          toast(`Audio: ${track ? formatTrackLabel(track) : String(id)}`);
        }}
        onSelectSubtitleTrack={(id) => {
          appliedSubtitleForStreamRef.current = selectedStream?.link || null;
          mpv.selectTrack("sid", id);
          if (id === "no") {
            saveSubtitlePreference(state, "off");
            toast("Subtitles: Off");
          } else {
            const index = mpv.subtitleTracks.findIndex(
              (item) => item.id === id,
            );
            const track = mpv.subtitleTracks[index];
            if (track) {
              saveSubtitlePreference(
                state,
                track,
                index >= 0 ? index : undefined,
              );
            }
            toast(`Subtitles: ${track ? formatTrackLabel(track) : String(id)}`);
          }
        }}
        onSelectVideoTrack={(id) => {
          mpv.selectTrack("vid", id);
        }}
        onAddSubtitleFile={(path) => mpv.addSubtitleFile(path)}
        onPlaybackRateChange={(rate) => {
          setPlaybackRate(rate);
          mpv.setPlaybackSpeed(rate);
        }}
        showShortcuts={showShortcuts}
        onToggleShortcuts={() => setShowShortcuts((current) => !current)}
        onCopyLink={selectedStream?.link ? copyStreamLink : undefined}
        skips={combinedSkips}
      />
      {showEpisodeSidebarSetting && hasMultipleEpisodes && (
        <button
          className={`player-episode-sidebar-toggle ${showControls && !showEpisodeSidebar ? "visible" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setShowEpisodeSidebar((prev) => !prev);
            revealControls();
          }}
          title="Episodes"
          aria-label="Toggle episode list sidebar"
        >
          <ChevronLeft size={20} />
        </button>
      )}

      {showEpisodeSidebarSetting && hasMultipleEpisodes && (
        <>
          <div
            className={`player-episode-sidebar-backdrop ${showEpisodeSidebar ? "visible" : ""}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setShowEpisodeSidebar(false);
            }}
          />
          <aside
            className={`player-episode-sidebar ${showEpisodeSidebar ? "open" : ""}`}
            data-prevent-wheel-volume="true"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="player-episode-sidebar-header">
              <div className="player-episode-sidebar-title-group">
                <ListIcon size={18} className="player-episode-sidebar-icon" />
                <h3 className="player-episode-sidebar-title">Episodes</h3>
                <span className="player-episode-sidebar-count">
                  {state.episodeList.length}
                </span>
              </div>
              <button
                type="button"
                className="player-episode-sidebar-close"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowEpisodeSidebar(false);
                }}
                aria-label="Close episode list"
              >
                <CloseIcon size={18} />
              </button>
            </div>
            <div
              className="player-episode-sidebar-list"
              data-prevent-wheel-volume="true"
            >
              {state.episodeList.map((ep: any, index: number) => {
                const isActive = index === activeEpisodeIndex;
                const epNum = index + 1;
                const epTitle = ep?.title || `Episode ${epNum}`;
                return (
                  <SidebarEpisodeItem
                    key={ep?.id || ep?.link || index}
                    episode={ep}
                    index={index}
                    isActive={isActive}
                    itemRef={isActive ? activeEpisodeItemRef : undefined}
                    onSelect={() => {
                      if (index !== activeEpisodeIndex) {
                        prevStreamLinkRef.current = null;
                        appliedAudioForStreamRef.current = null;
                        appliedSubtitleForStreamRef.current = null;
                        setActiveEpisodeIndex(index);
                        toast(`Playing: ${epTitle}`);
                      }
                      setShowEpisodeSidebar(false);
                    }}
                  />
                );
              })}
            </div>
          </aside>
        </>
      )}

      {toastMessage && <div className="player-toast">{toastMessage}</div>}
    </div>
  );
};
