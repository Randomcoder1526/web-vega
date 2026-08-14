import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useWatchHistoryStore } from '../store/watchHistoryStore';
import { useThemeStore } from '../store/themeStore';

const WatchHistory: React.FC = () => {
  const navigate = useNavigate();
  const { primary } = useThemeStore((s) => s);
  const { history, removeItem, clearHistory } = useWatchHistoryStore((s) => s);

  const formatTime = (seconds?: number) => {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div className="flex-1 min-h-screen bg-surface py-4 md:px-16 md:py-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-white text-2xl font-bold tracking-tight">Watch History</h1>
        {history.length > 0 && (
          <button onClick={clearHistory}
            className="rounded-full px-4 py-2 text-xs font-medium transition-all duration-200 hover:bg-white/5 active:scale-95"
            style={{ backgroundColor: primary + '10', color: primary }}>
            Clear All
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="text-center py-20 animate-fade-in">
          <div className="w-24 h-24 mx-auto mb-5 rounded-2xl flex items-center justify-center glass-card">
            <svg className="w-12 h-12 text-white/10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-white/40 text-lg font-medium">No watch history yet</p>
          <p className="text-white/20 text-sm mt-1">Start watching to see your history</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {history.map((item, i) => {
            const progress = item.duration && item.currentTime ? (item.currentTime / item.duration) * 100 : 0;
            const isComplete = progress > 95;
            return (
              <div key={`${item.link}-${i}`}
                className="cursor-pointer group animate-fade-in-up"
                style={{ animationDelay: `${i * 30}ms` }}
                onClick={() => navigate(`/info/${encodeURIComponent(item.infoLink || item.link)}${item.provider ? `?provider=${encodeURIComponent(item.provider)}` : ''}`)}>
                <div className="relative rounded-xl overflow-hidden glass-card transition-all duration-200"
                  style={{ aspectRatio: '2/3' }}>
                  {item.poster ? (
                    <img src={item.poster} alt="" className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/15">
                      <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}

                  {/* Gradient overlay */}
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 40%)' }} />

                  {/* Progress bar */}
                  {progress > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
                      <div className="h-full transition-all duration-300"
                        style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: isComplete ? '#22c55e' : primary }} />
                    </div>
                  )}

                  {/* Complete badge */}
                  {isComplete && (
                    <div className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center bg-success shadow-lg">
                      <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}

                  {/* Progress percentage */}
                  {progress > 0 && (
                    <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white glass-panel">
                      {Math.round(progress)}%
                    </div>
                  )}

                  {/* Remove button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); removeItem(item.link); }}
                    className="absolute top-2 left-2 w-6 h-6 rounded-lg flex items-center justify-center glass-panel opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-error/20"
                    aria-label="Remove from history">
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <p className="text-white text-xs font-medium mt-2 leading-tight" title={item.title}>{item.title}</p>
                {item.episodeTitle && (
                  <p className="text-white/30 text-[10px] line-clamp-1 mt-0.5">{item.episodeTitle}</p>
                )}
                {item.duration && (
                  <p className="text-white/25 text-[10px] mt-0.5">{formatTime(item.currentTime)} / {formatTime(item.duration)}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WatchHistory;
