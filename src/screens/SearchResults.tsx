import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import { useContentStore } from '../store/contentStore';
import { providerManager } from '../lib/providerManager';
import SkeletonLoader from '../components/Skeleton';
import ScrollRow from '../components/ScrollRow';
import type { Post, ProviderExtension } from '../types';

interface SearchPost extends Post {
  providerName?: string;
  providerValue?: string;
}

const ResultPosterCard: React.FC<{ post: SearchPost; index: number; primary: string; onOpen: (link: string, providerValue?: string) => void }> = ({ post, index, primary, onOpen }) => (
  <div onClick={() => onOpen(post.link, post.providerValue)}
    className="cursor-pointer group animate-fade-in-up shrink-0 w-[31vw] sm:w-[22vw] md:w-[15.5vw] lg:w-[12vw] max-w-[160px]"
    style={{ animationDelay: `${index * 30}ms` }}>
    <div className="relative rounded-xl overflow-hidden glass-card group-hover:ring-1 transition-all duration-200"
      style={{ aspectRatio: '2/3', '--tw-ring-color': primary + '30' } as React.CSSProperties}>
      {post.image ? (
        <img src={post.image} alt="" className="w-full h-full object-cover group-hover:scale-105 transition duration-300" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white/15">
          <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
      )}
      {post.rating && (
        <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-lg"
          style={{ backgroundColor: 'rgba(234,179,8,0.2)', backdropFilter: 'blur(4px)' }}>
          <svg className="w-2.5 h-2.5" fill="#fbbf24" viewBox="0 0 24 24">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          <span className="text-yellow-400 text-[10px] font-bold">{post.rating}</span>
        </div>
      )}
      <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-lg text-white text-[9px] font-bold glass-panel">
        HD
      </div>
    </div>
    <p className="text-white text-xs font-medium mt-2 leading-tight" title={post.title}>{post.title}</p>
    {post.year && <p className="text-white/30 text-[10px] mt-0.5">{post.year}</p>}
  </div>
);

const SearchResults: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const { primary } = useThemeStore((s) => s);
  const { installedProviders } = useContentStore((s) => s);
  const [results, setResults] = useState<SearchPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchingProviders, setSearchingProviders] = useState<string[]>([]);
  const [failedProviders, setFailedProviders] = useState<string[]>([]);

  const searchAllProviders = useCallback(async () => {
    if (!query || installedProviders.length === 0) return;
    setLoading(true);
    setError('');
    setResults([]);
    setFailedProviders([]);
    setSearchingProviders(installedProviders.map(p => p.display_name));

    const allResults: SearchPost[] = [];
    const seenLinks = new Set<string>();
    let failedCount = 0;

    const searchPromises = installedProviders.map(async (prov: ProviderExtension) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const posts = await providerManager.getSearchPosts({
          searchQuery: query,
          page: 1,
          providerValue: prov.value,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (posts) {
          posts.forEach((post: Post) => {
            if (!seenLinks.has(post.link)) {
              seenLinks.add(post.link);
              allResults.push({ ...post, providerName: prov.display_name, providerValue: prov.value });
            }
          });
        }
      } catch {
        failedCount += 1;
        setFailedProviders(prev => prev.includes(prov.display_name) ? prev : [...prev, prov.display_name]);
      } finally {
        setSearchingProviders(prev => prev.filter(name => name !== prov.display_name));
      }
    });

    await Promise.allSettled(searchPromises);

    if (allResults.length === 0) {
      setError(failedCount === installedProviders.length ? 'Search is temporarily unavailable. Please try again.' : 'No results found for this search.');
    }
    setResults(allResults);
    setLoading(false);
  }, [query, installedProviders]);

  useEffect(() => {
    searchAllProviders();
  }, [searchAllProviders]);

  return (
    <div className="flex-1 min-h-screen bg-surface py-4 md:px-16 md:py-6 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-xl flex items-center justify-center glass-card hover:bg-white/5 transition-colors active:scale-95"
          aria-label="Go back">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-white text-xl font-bold tracking-tight">Search Results</h1>
          <p className="text-white/35 text-sm">for &ldquo;{query}&rdquo; {results.length > 0 && <span className="text-white/25">&bull; {results.length} results from {installedProviders.length} providers</span>}</p>
        </div>
      </div>

      {installedProviders.length === 0 ? (
        <div className="text-center py-16 animate-fade-in">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl flex items-center justify-center glass-card">
            <svg className="w-10 h-10 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <p className="text-white/50 text-base">No providers installed</p>
          <p className="text-white/45 text-sm mt-1">Set up a content source to start searching.</p>
          <button onClick={() => navigate('/extensions')} className="mt-5 px-5 py-2.5 rounded-xl text-xs font-semibold" style={{ backgroundColor: primary, color: '#000' }}>
            Set up content source
          </button>
        </div>
      ) : loading ? (
        <div>
          {searchingProviders.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {searchingProviders.map(name => (
                <span key={name} className="px-3 py-1 rounded-full text-xs font-medium glass-card flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: primary }} />
                  {name}
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 px-1">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="shrink-0 w-[31vw] sm:w-[22vw] md:w-[15.5vw] lg:w-[12vw] max-w-[160px]">
                <SkeletonLoader height={210} width="100%" borderRadius={12} />
                <SkeletonLoader height={12} width="80%" borderRadius={4} style={{ marginTop: 8 }} />
              </div>
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="text-center py-16 animate-fade-in">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl flex items-center justify-center glass-card">
            <svg className="w-10 h-10 text-error/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p className="text-white/70 text-base font-medium mb-1">{error}</p>
          <p className="text-white/45 text-sm mb-4">{failedProviders.length > 0 && failedProviders.length < installedProviders.length ? `${failedProviders.join(', ')} did not respond. Other sources may still be available.` : 'Check your connection or try again in a moment.'}</p>
          <button onClick={searchAllProviders}
            className="px-5 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 hover:scale-105 active:scale-95"
            style={{ backgroundColor: primary + '15', color: primary }}>
            Retry
          </button>
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-16 animate-fade-in">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl flex items-center justify-center glass-card">
            <svg className="w-10 h-10 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-white/50 text-base">No results found</p>
          <p className="text-white/25 text-sm mt-1">Try a different search term</p>
        </div>
      ) : (
        (() => {
          const groups = results.reduce((acc: Record<string, { name: string; value: string; items: SearchPost[] }>, post) => {
            const key = post.providerValue || post.providerName || 'other';
            if (!acc[key]) acc[key] = { name: post.providerName || 'Other', value: post.providerValue || '', items: [] };
            acc[key].items.push(post);
            return acc;
          }, {});

          return (
            <div className="space-y-7">
              {Object.values(groups).map((group) => (
                <ScrollRow
                  key={group.value || group.name}
                  title={group.name}
                  seeAllLabel="See All"
                  onSeeAll={() => navigate(`/scrolllist?title=${encodeURIComponent(group.name)}&filter=${encodeURIComponent(query)}&provider=${encodeURIComponent(group.value)}&isSearch=true`)}
                >
                  {group.items.map((post, i) => (
                    <ResultPosterCard key={`${post.link}-${i}`} post={post} index={i} primary={primary} onOpen={(link, pv) => navigate(`/info/${encodeURIComponent(link)}${pv ? `?provider=${encodeURIComponent(pv)}` : ''}`)} />
                  ))}
                </ScrollRow>
              ))}
            </div>
          );
        })()
      )}
    </div>
  );
};

export default SearchResults;
