import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import SkeletonLoader from './Skeleton';
import type { Post } from '../types';

interface SliderProps {
  title: string;
  posts: Post[];
  filter: string;
  isLoading?: boolean;
  isSearch?: boolean;
  providerValue?: string;
  error?: string;
}

const QualityBadge: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md text-white text-[9px] font-bold tracking-wider"
    style={{ backgroundColor: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.2)' }}>
    {children}
  </div>
);

const Slider: React.FC<SliderProps> = ({ title, posts, filter, isLoading, isSearch, providerValue, error }) => {
  const navigate = useNavigate();
  const { primary } = useThemeStore((s) => s);

  const handleMorePress = useCallback(() => {
    const params = new URLSearchParams({
      title,
      filter,
      ...(providerValue && { provider: providerValue }),
      ...(isSearch && { isSearch: 'true' }),
    });
    navigate(`/scrolllist?${params.toString()}`);
  }, [navigate, title, filter, providerValue, isSearch]);

  const handleItemPress = useCallback((post: Post) => {
    navigate(`/info/${encodeURIComponent(post.link)}${providerValue ? `?provider=${encodeURIComponent(providerValue)}` : ''}`);
  }, [navigate, providerValue]);

  if (isLoading) {
    return (
      <div className="mt-5 px-3 md:px-6">
        <div className="flex items-center gap-2 px-1 mb-4">
          <div className="w-1 h-5 rounded-full" style={{ backgroundColor: primary }} />
          <div className="h-5 w-40 bg-white/10 rounded animate-pulse" />
        </div>
          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div className="gap-1.5" key={i}>
              <div className="aspect-[2/3]">
                <SkeletonLoader height="100%" width="100%" borderRadius={12} />
              </div>
              <SkeletonLoader height={10} width="80%" borderRadius={4} />
              <SkeletonLoader height={8} width="50%" borderRadius={4} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (posts.length === 0) return null;

  return (
    <div className="mt-5 px-3 md:px-6">
      <div className="flex items-center justify-between px-1 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded-full" style={{ backgroundColor: primary }} />
          <h2 className="text-white text-lg font-bold tracking-tight">{title}</h2>
        </div>
        {filter !== 'recent' && (
          <button
            onClick={handleMorePress}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium text-gray-400 hover:text-white transition"
            style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
          >
            See All
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

        <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {posts.map((post, i) => (
          <div
            key={`${post.link}-${i}`}
            onClick={() => handleItemPress(post)}
            className="cursor-pointer group/card"
          >
            <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-[#1a1a1a]">
              {post.image ? (
                <img
                  src={post.image}
                  alt={post.title}
                  className="w-full h-full object-cover rounded-xl group-hover/card:scale-105 transition duration-300"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-500 rounded-xl">
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
              )}

              <div className="absolute inset-0 rounded-xl" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.3) 100%)' }} />

              {post.rating && (
                <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md"
                  style={{ backgroundColor: 'rgba(234,179,8,0.25)' }}>
                  <svg className="w-2.5 h-2.5" fill="#fbbf24" viewBox="0 0 24 24">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  <span className="text-yellow-400 text-[10px] font-bold">{post.rating}</span>
                </div>
              )}

              <QualityBadge>HD</QualityBadge>
            </div>

            <p className="text-white text-xs font-medium mt-1.5 ml-0.5 leading-tight" title={post.title}>{post.title}</p>
            {post.year && (
              <p className="text-gray-500 text-[10px] ml-0.5">{post.year}</p>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mt-3 p-5 rounded-2xl text-center" style={{ backgroundColor: '#141414', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
    </div>
  );
};

export default React.memo(Slider);
