import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import { useContentStore } from '../store/contentStore';
import { providerManager } from '../lib/providerManager';
import SkeletonLoader from '../components/Skeleton';
import type { Post } from '../types';

const ScrollList: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const title = searchParams.get('title') || 'Content';
  const filter = searchParams.get('filter') || '';
  const providerValue = searchParams.get('provider') || '';
  const isSearch = searchParams.get('isSearch') === 'true';
  const { primary } = useThemeStore((s) => s);
  const { provider } = useContentStore((s) => s);

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(1);

  const effectiveProvider = providerValue || provider?.value;

  const loadContent = useCallback(async (pageNum: number = 1) => {
    if (!effectiveProvider) return;
    try {
      if (pageNum === 1) setLoading(true);
      else setLoadingMore(true);

      let newPosts: Post[] = [];
      const signal = AbortSignal.timeout(30000);
      if (isSearch && filter) {
        newPosts = await providerManager.getSearchPosts({ searchQuery: filter, page: pageNum, providerValue: effectiveProvider, signal });
      } else if (filter) {
        newPosts = await providerManager.getPosts({ filter, page: pageNum, providerValue: effectiveProvider, signal });
      } else {
        newPosts = await providerManager.getPosts({ filter: 'recent', page: pageNum, providerValue: effectiveProvider, signal });
      }

      if (pageNum === 1) {
        setPosts(newPosts || []);
      } else {
        setPosts(prev => [...prev, ...(newPosts || [])]);
      }
      setHasMore((newPosts?.length || 0) >= 20);
    } catch (e: any) {
      setError(e.message || 'Failed to load content');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [effectiveProvider, isSearch, filter]);

  useEffect(() => {
    pageRef.current = 1;
    loadContent(1);
  }, [loadContent]);

  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore && !loading) {
      pageRef.current += 1;
      loadContent(pageRef.current);
    }
  }, [loadingMore, hasMore, loading, loadContent]);

  useEffect(() => {
    const handleScroll = () => {
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
        loadMore();
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [loadMore]);

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
          <h1 className="text-white text-xl font-bold tracking-tight">{title}</h1>
          {filter && <p className="text-white/35 text-sm">{isSearch ? `Search: ${filter}` : `Filter: ${filter}`}</p>}
        </div>
      </div>

      {loading ? (
          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {Array.from({ length: 20 }).map((_, i) => (
            <div key={i}>
              <SkeletonLoader height={240} width="100%" borderRadius={12} />
              <SkeletonLoader height={12} width="80%" borderRadius={4} style={{ marginTop: 8 }} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-16 animate-fade-in">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl flex items-center justify-center glass-card">
            <svg className="w-10 h-10 text-error/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p className="text-white/50 text-sm mb-4">{error}</p>
          <button onClick={() => { pageRef.current = 1; loadContent(1); }}
            className="px-5 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 hover:scale-105 active:scale-95"
            style={{ backgroundColor: primary + '15', color: primary }}>
            Retry
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-16 animate-fade-in">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl flex items-center justify-center glass-card">
            <svg className="w-10 h-10 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <p className="text-white/40 text-base">No content found</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {posts.map((post, i) => (
              <div key={`${post.link}-${i}`} onClick={() => navigate(`/info/${encodeURIComponent(post.link)}${effectiveProvider ? `?provider=${encodeURIComponent(effectiveProvider)}` : ''}`)}
                className="cursor-pointer group animate-fade-in-up" style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}>
                <div className="relative rounded-xl overflow-hidden glass-card transition-all duration-200"
                  style={{ aspectRatio: '2/3' }}>
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
                    <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-lg glass-panel">
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
            ))}
          </div>
          {loadingMore && (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 border-2 rounded-full animate-spin"
                style={{ borderColor: primary + '30', borderTopColor: primary }} />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ScrollList;
