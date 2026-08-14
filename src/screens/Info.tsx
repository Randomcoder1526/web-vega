import React, { useCallback, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useContentInfo } from '../hooks/useContentInfo';
import { useEpisodes, useStream } from '../hooks/useStream';
import { useContentStore } from '../store/contentStore';
import { useThemeStore } from '../store/themeStore';
import { useWatchListStore } from '../store/watchListStore';
import { useWatchHistoryStore } from '../store/watchHistoryStore';
import type { Stream } from '../types';
import { QueryErrorBoundary } from '../components/ErrorBoundary';
import SkeletonLoader from '../components/Skeleton';

const Info: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const link = decodeURIComponent(id || '');
  const { provider: storeProvider, installedProviders } = useContentStore((s) => s);

  const providerValueFromUrl = searchParams.get('provider');
  const provider = useMemo(() => {
    if (providerValueFromUrl) {
      return installedProviders.find(p => p.value === providerValueFromUrl) || null;
    }
    return storeProvider;
  }, [providerValueFromUrl, installedProviders, storeProvider]);
  const { primary } = useThemeStore((s) => s);
  const { addItem: addToWatchList, isInWatchList, removeItem: removeFromWatchList } = useWatchListStore((s) => s);
  const { addItem: addToHistory } = useWatchHistoryStore((s) => s);

  const providerValue = provider?.value || '';
  const { data: info, isLoading, error, refetch } = useContentInfo(link, providerValue);

  const [readMore, setReadMore] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState(0);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloadTarget, setDownloadTarget] = useState<{ link: string; title: string } | null>(null);
  const [toastMessage, setToastMessage] = useState('');

  const selectedSource = info?.linkList?.[selectedSeason] || info?.linkList?.[0];
  const seasonNumber = useMemo(() => {
    if (!selectedSource?.title) return selectedSeason + 1;
    const match = selectedSource.title.match(/(\d+)/);
    return match ? parseInt(match[1]) : selectedSeason + 1;
  }, [selectedSource, selectedSeason]);
  const episodesLinkUrl = selectedSource?.episodesLink || '';
  const { data: fetchedEpisodes, isLoading: episodesLoading } = useEpisodes(episodesLinkUrl, providerValue);

  const { streams: downloadStreams, isLoading: downloadStreamsLoading } = useStream({
    episodeLink: downloadTarget?.link || '',
    providerValue,
  });

  const inWatchList = isInWatchList(link);

  const isSeries = useMemo(() => {
    if (!info?.linkList?.length) return false;
    return info.linkList.some(source => source.episodesLink || (source.directLinks && source.directLinks.length > 1));
  }, [info?.linkList]);

  const getFileExtension = (stream: Stream): string => {
    const fromLink = (stream.link.split('?')[0].match(/\.([a-z0-9]+)$/i) || [])[1];
    if (fromLink) return fromLink;
    if (stream.type && stream.type.includes('/')) return stream.type.split('/')[1] || 'mp4';
    return 'mp4';
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 2000);
  };

  const openDownload = (dlLink: string, dlTitle: string) => {
    if (!dlLink) return;
    setDownloadTarget({ link: dlLink, title: dlTitle || displayTitle });
    setShowDownloadModal(true);
  };

  const startDownload = (stream: Stream) => {
    const a = document.createElement('a');
    a.href = stream.link;
    a.download = `${(downloadTarget?.title || displayTitle || 'video').replace(/[\\/:*?"<>|]/g, '_')}.${getFileExtension(stream)}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Starting download...');
    setShowDownloadModal(false);
  };

  const firstSourceForDownload = info?.linkList?.[selectedSeason] || info?.linkList?.[0];
  const movieDownloadLink = firstSourceForDownload?.directLinks?.length
    ? firstSourceForDownload.directLinks[0].link
    : (firstSourceForDownload?.episodesLink || '');
  const firstEpisodeDownloadLink = (!firstSourceForDownload?.directLinks?.length && fetchedEpisodes?.length)
    ? fetchedEpisodes[0].link
    : '';
  const defaultDownloadLink = movieDownloadLink || firstEpisodeDownloadLink;

  const synopsis = useMemo(() => info?.description || info?.synopsis || 'No synopsis available', [info?.description, info?.synopsis]);
  const displayTitle = useMemo(() => info?.name || info?.title, [info?.name, info?.title]);
  const backgroundImage = useMemo(() => info?.background || info?.image || '', [info?.background, info?.image]);
  const rating = info?.imdbRating || info?.rating;
  const year = info?.year;
  const genres = info?.genres || [];

  const handlePlay = useCallback(async (epTitle?: string, epIndex?: number) => {
    if (!info?.linkList?.length) return;
    const firstSource = info.linkList[0];
    let playLink = '';
    if (firstSource.directLinks?.length) {
      playLink = firstSource.directLinks[0].link;
    } else if (firstSource.episodesLink) {
      playLink = firstSource.episodesLink;
    }
    if (playLink) {
      addToHistory({
        id: playLink,
        title: displayTitle || 'Unknown',
        poster: info?.poster || info?.image || '',
        link: playLink,
        infoLink: link,
        provider: providerValue,
        timestamp: Date.now(),
        episodeTitle: epTitle,
        episodeIndex: epIndex,
        seasonIndex: seasonNumber,
      });
      navigate(`/player/${encodeURIComponent(playLink)}${providerValue ? `?provider=${encodeURIComponent(providerValue)}` : ''}`, {
        state: { title: displayTitle, episodeTitle: epTitle, episodeIndex: epIndex, seasonIndex: seasonNumber, sourceVariants: info.linkList },
      });
    }
  }, [info, displayTitle, providerValue, navigate, addToHistory, seasonNumber, link]);

  const handlePlaySource = useCallback((playLink: string, epTitle?: string, epIndex?: number) => {
    addToHistory({
      id: playLink,
      title: displayTitle || 'Unknown',
      poster: info?.poster || info?.image || '',
      link: playLink,
      infoLink: link,
      provider: providerValue,
      timestamp: Date.now(),
      episodeTitle: epTitle,
      episodeIndex: epIndex,
      seasonIndex: seasonNumber,
    });
    navigate(`/player/${encodeURIComponent(playLink)}${providerValue ? `?provider=${encodeURIComponent(providerValue)}` : ''}`, {
      state: { title: displayTitle, episodeTitle: epTitle, episodeIndex: epIndex, seasonIndex: seasonNumber, sourceVariants: info.linkList },
    });
  }, [displayTitle, info?.poster, info?.image, providerValue, navigate, addToHistory, seasonNumber, link]);

  const handleToggleWatchList = useCallback(() => {
    if (inWatchList) {
      removeFromWatchList(link);
    } else {
      addToWatchList({
        title: displayTitle || 'Unknown',
        poster: info?.poster || info?.image || '',
        link,
        provider: providerValue,
      });
    }
  }, [inWatchList, link, displayTitle, info?.poster, info?.image, providerValue, addToWatchList, removeFromWatchList]);

  const handleEpisodes = useCallback(() => {
    if (info?.linkList?.length) {
      const firstSource = info.linkList[0];
      if (firstSource.episodesLink) {
        handlePlaySource(firstSource.episodesLink);
      }
    }
  }, [info, handlePlaySource]);

  if (providerValueFromUrl && !provider) {
    return (
      <div className="h-full w-full flex items-center justify-center p-6 bg-surface animate-fade-in">
        <div className="rounded-2xl p-8 items-center w-full max-w-sm glass-card text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3 mx-auto bg-error/10">
            <svg className="w-9 h-9 text-error/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-white/70 text-lg font-bold mt-2">Provider not found</p>
          <p className="text-white/30 text-sm mt-2">The provider for this content is not installed</p>
          <div className="flex gap-3 mt-6 justify-center">
            <button onClick={() => navigate(-1)}
              className="px-6 py-3 rounded-xl text-white/60 font-semibold text-sm glass-card hover:bg-white/5 transition-colors">
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full w-full flex items-center justify-center p-6 bg-surface animate-fade-in">
        <div className="rounded-2xl p-8 items-center w-full max-w-sm glass-card text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3 mx-auto bg-error/10">
            <svg className="w-9 h-9 text-error/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-white/70 text-lg font-bold mt-2">Failed to load content</p>
          <p className="text-white/30 text-sm mt-2">{error.message || 'An unexpected error occurred'}</p>
          <div className="flex gap-3 mt-6 justify-center">
            <button onClick={() => refetch()}
              className="px-6 py-3 rounded-xl text-white font-semibold text-sm transition-all duration-200 hover:scale-105 active:scale-95"
              style={{ backgroundColor: primary, boxShadow: `0 4px 16px ${primary}40` }}>
              Try Again
            </button>
            <button onClick={() => navigate(-1)}
              className="px-6 py-3 rounded-xl text-white/60 font-semibold text-sm glass-card hover:bg-white/5 transition-colors">
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <QueryErrorBoundary>
      <div className="min-h-screen bg-surface md:px-16">
        {/* Hero Section */}
        <div className="relative w-full h-[50vh] min-h-[380px] md:h-[70vh] md:min-h-[500px] max-h-[700px]">
          <SkeletonLoader show={isLoading} height="100%" width="100%" borderRadius={0}>
            {backgroundImage ? (
              <img src={backgroundImage} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-card" />
            )}
          </SkeletonLoader>

          {/* Gradient overlays */}
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(to right, rgba(10,10,10,0.7) 0%, rgba(10,10,10,0.3) 50%, rgba(10,10,10,0.1) 100%)'
          }} />
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(to top, var(--color-surface) 0%, rgba(10,10,10,0.4) 30%, rgba(10,10,10,0.1) 60%, transparent 100%)'
          }} />

          {/* Back button */}
          <button onClick={() => navigate(-1)}
            className="absolute top-4 left-4 z-20 w-10 h-10 rounded-full flex items-center justify-center text-white glass-panel hover:bg-white/10 transition-colors active:scale-95"
            aria-label="Go back">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Content positioned at bottom of hero */}
          <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6">
            {/* Title / Logo */}
            <div className="mb-4">
              {info?.logo && !logoError ? (
                <img src={info.logo} alt="" onError={() => setLogoError(true)}
                  className="h-16 md:h-20 lg:h-28 object-contain" style={{ maxWidth: 260 }} />
              ) : (
                <h1 className="text-white text-2xl sm:text-3xl md:text-5xl font-bold tracking-tight drop-shadow-lg">
                  {displayTitle}
                </h1>
              )}
            </div>

            {/* Metadata row */}
            <div className="flex items-center gap-2 flex-wrap mb-4 text-white/70 text-sm">
              {rating && (
                <>
                  <span className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="#fbbf24" viewBox="0 0 24 24">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                    <span className="text-white font-medium">{rating}</span>
                  </span>
                  <span className="text-white/30">·</span>
                </>
              )}
              {year && (
                <>
                  <span>{year}</span>
                  <span className="text-white/30">·</span>
                </>
              )}
              {genres.slice(0, 3).map((genre: string, index: number) => (
                <React.Fragment key={genre}>
                  <span>{genre}</span>
                  {index < Math.min(genres.length, 3) - 1 && <span className="text-white/30">·</span>}
                </React.Fragment>
              ))}
            </div>

            {/* Synopsis */}
            <SkeletonLoader show={isLoading} height={60} width="100%" borderRadius={8}>
              <div className="relative max-w-2xl">
                <p className={`text-white/60 text-sm leading-relaxed transition-all duration-300 ${!readMore ? 'line-clamp-3' : ''}`}>
                  {synopsis}
                </p>
                {!readMore && synopsis.length > 150 && (
                  <div className="relative mt-1">
                    <span
                      onClick={() => setReadMore(true)}
                      className="text-xs font-semibold cursor-pointer hover:underline"
                      style={{ color: primary }}>
                      read more
                    </span>
                  </div>
                )}
                {readMore && (
                  <div className="relative mt-1">
                    <span
                      onClick={() => setReadMore(false)}
                      className="text-xs font-semibold cursor-pointer hover:underline"
                      style={{ color: primary }}>
                      show less
                    </span>
                  </div>
                )}
              </div>
            </SkeletonLoader>

            {/* Action buttons */}
            <div className="flex items-center gap-2 sm:gap-3 mt-5 flex-wrap">
              <button
                onClick={() => handlePlay()}
                className="flex items-center gap-2 px-5 sm:px-6 py-2.5 rounded-full text-white font-semibold text-sm transition-all duration-200 hover:scale-105 active:scale-95"
                style={{ backgroundColor: primary, boxShadow: `0 4px 20px ${primary}50` }}>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span className="hidden sm:inline">Play</span>
              </button>

              <button
                onClick={handleToggleWatchList}
                className="w-10 h-10 rounded-full flex items-center justify-center text-white glass-panel hover:bg-white/10 transition-colors active:scale-95"
                aria-label={inWatchList ? 'Remove from watch list' : 'Add to watch list'}>
                <svg className="w-5 h-5" fill={inWatchList ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              </button>

              {isSeries && (
                <button
                  onClick={handleEpisodes}
                  className="flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-full text-white/70 text-sm font-medium glass-panel hover:bg-white/10 transition-colors active:scale-95">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  <span className="hidden sm:inline">Episodes</span>
                </button>
              )}

              {!isSeries && (
                <button
                  onClick={() => openDownload(defaultDownloadLink, displayTitle)}
                  disabled={!defaultDownloadLink}
                  className="flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-full text-white/70 text-sm font-medium glass-panel hover:bg-white/10 transition-colors active:scale-95 disabled:opacity-40 disabled:pointer-events-none">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 3v12m0 0l-4-4m4 4l4-4" />
                  </svg>
                  <span className="hidden sm:inline">Download</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Episodes Section */}
        <div className="px-4 md:px-0 pb-24">
          <div className="mt-6 mb-4 flex items-center gap-2">
            <div className="w-1 h-5 rounded-full" style={{ backgroundColor: primary }} />
            <h2 className="text-white text-xl font-bold">Episodes</h2>
          </div>

          <div className="flex items-center gap-3 mb-4">
            {/* Season dropdown */}
            <div className="relative">
              <select
                value={selectedSeason}
                onChange={(e) => setSelectedSeason(Number(e.target.value))}
                className="appearance-none bg-card text-white/70 text-xs sm:text-sm rounded-lg sm:rounded-xl px-3 sm:px-4 py-2 sm:py-2.5 pr-7 sm:pr-8 border border-white/10 focus:outline-none focus:border-white/20 transition-colors w-full max-w-[2000px] sm:max-w-[2000px] md:w-auto">
                {info?.linkList?.map((source, si) => (
                  <option key={si} value={si}>{source.title || `Season ${si + 1}`}</option>
                ))}
                {(!info?.linkList || info.linkList.length === 0) && <option value={0}>Season 1</option>}
              </select>
              <svg className="w-4 h-4 text-white/40 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          {/* Episodes list for selected season */}
          <SkeletonLoader show={isLoading || episodesLoading} height={200} width="100%" borderRadius={12}>
            {info?.linkList && info.linkList.length > 0 ? (
              (() => {
                const source = info.linkList[selectedSeason] || info.linkList[0];
                if (!source) return (
                  <div className="text-center py-12">
                    <p className="text-white/30 text-sm">No episodes available</p>
                  </div>
                );

                const episodesToShow = source.directLinks?.length
                  ? source.directLinks.map((dl) => ({ title: dl.title, link: dl.link }))
                  : fetchedEpisodes || [];

                if (episodesToShow.length === 0) return (
                  <div className="text-center py-12">
                    <p className="text-white/30 text-sm">
                      {episodesLoading ? 'Loading episodes...' : 'No episodes available'}
                    </p>
                  </div>
                );

                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {episodesToShow.map((ep, di) => (
                        <button
                          key={di}
                          onClick={() => handlePlaySource(ep.link, ep.title, di + 1)}
                        className="w-full text-left p-4 rounded-xl flex items-center justify-between transition-all duration-200 hover:bg-white/[0.05] bg-card border border-white/5">
                        <div className="flex items-center gap-3 min-w-0">
                          <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 24 24" style={{ color: primary }}>
                            <path d="M8 5v14l11-7z" />
                          </svg>
                          <span className="text-white/80 text-sm truncate">Episodes {di + 1}</span>
                        </div>
                        <div className="flex items-center shrink-0 ml-2">
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              openDownload(ep.link, `${displayTitle} - ${ep.title}`);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.stopPropagation();
                                openDownload(ep.link, `${displayTitle} - ${ep.title}`);
                              }
                            }}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors active:scale-95"
                            aria-label={`Download ${ep.title}`}>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 3v12m0 0l-4-4m4 4l4-4" />
                            </svg>
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })()
            ) : (
              <div className="text-center py-12">
                <p className="text-white/30 text-sm">No episodes available</p>
              </div>
            )}
          </SkeletonLoader>
        </div>
      </div>

      {/* Download quality picker modal */}
      {showDownloadModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center animate-fade-in"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowDownloadModal(false)}>
          <div className="w-full md:max-w-md rounded-t-2xl md:rounded-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid rgba(255,255,255,0.1)' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 3v12m0 0l-4-4m4 4l4-4" />
                </svg>
                <span className="text-white text-sm font-bold">Download</span>
              </div>
              <button onClick={() => setShowDownloadModal(false)}
                className="text-white/60 hover:text-white transition-colors"
                aria-label="Close">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-3">
              {downloadStreamsLoading ? (
                <p className="text-white/40 text-sm text-center py-8">Loading qualities...</p>
              ) : downloadStreams.length === 0 ? (
                <p className="text-white/40 text-sm text-center py-8">No download sources available</p>
              ) : (
                <div className="space-y-1">
                  {downloadStreams.map((stream, si) => (
                    <button key={si} onClick={() => startDownload(stream)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm transition-all hover:bg-white/5 bg-card border border-white/5">
                      <div className="flex flex-col items-start">
                        <span className="text-white/80 font-medium">{stream.server || `Source ${si + 1}`}</span>
                        {stream.quality && <span className="text-white/40 text-xs mt-0.5">{stream.quality}</span>}
                      </div>
                      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke={primary} strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 3v12m0 0l-4-4m4 4l4-4" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-xl text-sm font-medium text-white animate-fade-in-down"
          style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {toastMessage}
        </div>
      )}
    </QueryErrorBoundary>
  );
};

export default Info;
