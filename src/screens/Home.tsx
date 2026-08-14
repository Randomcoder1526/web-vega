import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useHomePageData } from '../hooks/useHomePageData';
import { getRandomHeroPost, clearHeroCache } from '../lib/getHomepagedata';
import { useContentStore } from '../store/contentStore';
import { useHeroStore } from '../store/herostore';
import { useThemeStore } from '../store/themeStore';
import Slider from '../components/Slider';
import ContinueWatching from '../components/ContinueWatching';
import { QueryErrorBoundary } from '../components/ErrorBoundary';
import type { Post } from '../types';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { primary } = useThemeStore((s) => s);
  const { provider, installedProviders } = useContentStore((s) => s);
  const { setHero } = useHeroStore((s) => s);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const { data: homeData = [], isLoading, error, refetch } = useHomePageData({
    provider: provider,
    enabled: !!installedProviders?.length && !!provider?.value,
  });

  const heroPost = useMemo(() => {
    if (!homeData || homeData.length === 0) return null;
    return getRandomHeroPost(homeData, provider?.value);
  }, [homeData, provider?.value]);

  useEffect(() => {
    if (heroPost) setHero(heroPost);
  }, [heroPost, setHero]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    clearHeroCache(provider?.value);
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['heroMetadata'] });
    setRefreshing(false);
  }, [refetch, provider?.value, queryClient]);

  const loadingSliders = useMemo(() => {
    if (!provider?.value) return [];
    return Array.from({ length: 3 }).map((_, i) => (
      <Slider isLoading key={`load-${i}`} title={`Loading ${i + 1}`} posts={[]} filter="recent" />
    ));
  }, [provider?.value]);

  const categories = useMemo(
    () => homeData.map((item) => ({ title: item.title, filter: item.filter })),
    [homeData],
  );

  const visibleSliders = useMemo(() => {
    const sliders = activeCategory
      ? homeData.filter((item) => item.filter === activeCategory)
      : homeData;
    return sliders.map((item, i) => (
      <Slider isLoading={false} key={`content-${i}`} title={item.title} posts={item.Posts} filter={item.filter} providerValue={provider?.value} />
    ));
  }, [homeData, activeCategory]);

  if (!installedProviders || installedProviders.length === 0 || !provider?.value) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center animate-fade-in">
        <div className="text-center p-8">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center glass-card">
            <svg className="w-10 h-10 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
          <h1 className="text-white text-2xl font-bold mb-2 tracking-tight">Set up your content source</h1>
          <p className="text-white/55 text-sm max-w-sm mx-auto leading-relaxed">Choose a content source to start browsing movies and shows. You can change it later from Settings.</p>
          <button
            onClick={() => navigate('/extensions')}
            className="mt-6 px-5 py-3 rounded-xl text-sm font-semibold transition hover:scale-[1.02] active:scale-[0.98]"
            style={{ backgroundColor: primary, color: '#000' }}
          >
            Set up content source
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="block mx-auto mt-3 px-4 py-2 text-sm text-white/60 hover:text-white transition"
          >
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <QueryErrorBoundary>
      <div className="flex-1 overflow-y-auto min-h-screen bg-surface md:px-16">
        <HeroSection
          heroPost={heroPost}
          provider={provider}
          primary={primary}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          onNavigate={(link) => navigate(`/info/${encodeURIComponent(link)}${provider?.value ? `?provider=${encodeURIComponent(provider.value)}` : ''}`)}
        />
        <ContinueWatching />
        {!isLoading && categories.length > 0 && (
          <div className="relative z-20 px-4 md:px-16 mt-6">
            <CategoryBar
              categories={categories}
              activeCategory={activeCategory}
              primary={primary}
              onSelect={setActiveCategory}
            />
          </div>
        )}

        <div className="relative z-20">
          {isLoading ? loadingSliders : visibleSliders}
          {error && (
            <div className="mx-4 mt-4 p-5 rounded-2xl text-center glass-card">
              <p className="text-red-400 font-medium text-sm">{error.message || 'Failed to load content'}</p>
              <button onClick={handleRefresh} className="mt-3 px-4 py-2 rounded-xl text-xs font-medium transition hover:bg-white/5"
                style={{ backgroundColor: primary + '15', color: primary }}>
                Retry
              </button>
            </div>
          )}
        </div>
        <div className="h-24" />
      </div>
    </QueryErrorBoundary>
  );
};

const HeroSection: React.FC<{
  heroPost: Post | null;
  provider: { value: string; display_name?: string };
  primary: string;
  onRefresh: () => void;
  refreshing: boolean;
  onNavigate: (link: string) => void;
}> = ({ heroPost, provider, primary, onRefresh, refreshing, onNavigate }) => {
  const title = heroPost?.title || 'Featured';
  const image = heroPost?.image || '';
  const [slideIndex, setSlideIndex] = useState(0);

  return (
    <div className="relative mt-6 mx-auto" style={{ maxWidth: '1400px' }}>
      <div className="relative rounded-2xl overflow-hidden bg-card" style={{ height: 'clamp(360px, 50vw, 480px)' }}>
        {image ? (
          <img src={image} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 w-full h-full bg-card" />
        )}

        {/* Dark overlay */}
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(to right, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.2) 100%)'
        }} />
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 40%)'
        }} />

        {/* Type badge - top left */}
        <div className="absolute top-3 left-4 sm:top-5 sm:left-6 z-20">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider text-white"
            style={{ backgroundColor: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
            </svg>
            MOVIE
          </div>
        </div>

        {/* Rating - top right */}
        {heroPost?.rating && (
          <div className="absolute top-3 right-4 sm:top-5 sm:right-6 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}>
            <svg className="w-4 h-4" fill="#facc15" viewBox="0 0 24 24">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <span className="text-white text-sm font-bold">{heroPost.rating}</span>
          </div>
        )}

        {/* Left navigation arrow */}
        <button className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full items-center justify-center transition-all hover:scale-110"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { e.stopPropagation(); setSlideIndex((p) => Math.max(0, p - 1)); }}>
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Right navigation arrow */}
        <button className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full items-center justify-center transition-all hover:scale-110"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { e.stopPropagation(); setSlideIndex((p) => p + 1); }}>
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Content - left side */}
        <div className="absolute bottom-0 left-0 right-0 z-20 p-4 sm:p-6 md:p-8">
          {heroPost ? (
            <div className="space-y-3 animate-fade-in-up max-w-xl">
              <h1 className="text-white text-1xl md:text-3xl font-bold tracking-tight drop-shadow-lg leading-tight">{title}</h1>

              {heroPost.year && (
                <div className="flex items-center gap-1.5 text-white/60 text-sm">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {heroPost.year}
                </div>
              )}

              <p className="text-white/50 text-sm leading-relaxed line-clamp-2 max-w-lg">
                The fan favorite champions—now joined by Johnny Cage himself—are pitted against one another in the ultimate, no-holds barred, gory battle to defeat the dark rule of Shao Kahn that threatens the very existence of the Earthrealm and its defenders.
              </p>

              <button
                onClick={() => onNavigate(heroPost.link)}
                className="flex items-center gap-2.5 px-6 py-3 rounded-xl font-bold text-white text-sm transition-all duration-200 hover:scale-105 active:scale-95"
                style={{ backgroundColor: primary, boxShadow: `0 4px 24px ${primary}50` }}
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                Watch Now
              </button>
            </div>
          ) : (
            <div className="space-y-3 animate-fade-in">
              <div className="h-8 w-48 bg-white/5 rounded-lg animate-pulse" />
              <div className="h-4 w-32 bg-white/5 rounded-lg animate-pulse" />
              <div className="h-4 w-64 bg-white/5 rounded-lg animate-pulse" />
              <div className="h-12 w-40 bg-white/5 rounded-xl animate-pulse" />
            </div>
          )}
        </div>

        {/* Quality badge - bottom right */}
        <div className="hidden sm:block absolute bottom-6 right-6 z-20">
          <div className="px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider text-white"
            style={{ backgroundColor: 'rgba(220,38,38,0.85)', backdropFilter: 'blur(4px)' }}>
            4K SDR
          </div>
        </div>
      </div>

      {/* Refresh indicator */}
      {refreshing && (
        <div className="absolute top-4 right-4 z-30 animate-scale-in">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center glass-panel">
            <svg className="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
};

const CategoryBar: React.FC<{
  categories: { title: string; filter: string }[];
  activeCategory: string | null;
  primary: string;
  onSelect: (filter: string | null) => void;
}> = ({ categories, activeCategory, primary, onSelect }) => {
  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
      <button
        onClick={() => onSelect(null)}
        className="shrink-0 px-4 py-2 rounded-full text-xs font-semibold tracking-wide transition"
        style={{
          backgroundColor: activeCategory === null ? primary : 'rgba(255,255,255,0.06)',
          color: activeCategory === null ? '#fff' : 'rgba(255,255,255,0.7)',
        }}
      >
        All
      </button>
      {categories.map((cat) => {
        const isActive = activeCategory === cat.filter;
        return (
          <button
            key={cat.filter}
            onClick={() => onSelect(cat.filter)}
            className="shrink-0 px-4 py-2 rounded-full text-xs font-semibold tracking-wide transition hover:bg-white/10"
            style={{
              backgroundColor: isActive ? primary : 'rgba(255,255,255,0.06)',
              color: isActive ? '#fff' : 'rgba(255,255,255,0.7)',
            }}
          >
            {cat.title}
          </button>
        );
      })}
    </div>
  );
};

export default Home;
