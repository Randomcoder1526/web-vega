import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useWatchListStore } from '../store/watchListStore';
import { useThemeStore } from '../store/themeStore';

const WatchList: React.FC = () => {
  const navigate = useNavigate();
  const { primary } = useThemeStore((s) => s);
  const { watchList, removeItem } = useWatchListStore((s) => s);

  return (
    <div className="flex-1 min-h-screen bg-surface py-4 md:px-16 md:py-6 animate-fade-in">
      <h1 className="text-white text-2xl font-bold mb-6 tracking-tight">Watch List</h1>
      {watchList.length === 0 ? (
        <div className="text-center py-20 animate-fade-in">
          <div className="w-24 h-24 mx-auto mb-5 rounded-2xl flex items-center justify-center glass-card">
            <svg className="w-12 h-12 text-white/10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <p className="text-white/40 text-lg mb-2">Your watch list is empty</p>
          <p className="text-white/20 text-sm">Add movies and shows to your list</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4">
          {watchList.map((item, i) => (
            <div key={i} className="group relative animate-fade-in-up" style={{ animationDelay: `${i * 40}ms` }}>
              <div
                onClick={() => navigate(`/info/${encodeURIComponent(item.link)}${item.provider ? `?provider=${encodeURIComponent(item.provider)}` : ''}`)}
                className="cursor-pointer"
              >
                <div className="aspect-[2/3] rounded-xl overflow-hidden glass-card group-hover:ring-1 transition-all duration-200"
                  style={{ '--tw-ring-color': primary + '30' } as React.CSSProperties}>
                  {item.poster ? (
                    <img src={item.poster} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/15">
                      <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                </div>
                <p className="text-white text-xs font-medium mt-2 leading-tight" title={item.title}>{item.title}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeItem(item.link); }}
                className="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center glass-panel text-white/50 hover:text-error hover:bg-error/10 transition-all duration-200 opacity-0 group-hover:opacity-100"
                aria-label="Remove from watch list"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WatchList;
