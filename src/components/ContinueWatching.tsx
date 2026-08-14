import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import { useWatchHistoryStore } from '../store/watchHistoryStore';
import type { WatchHistoryItem } from '../types';

const CARD_WIDTH = 110;
const CARD_HEIGHT = 165;

const ContinueWatching: React.FC = () => {
  const { primary } = useThemeStore((s) => s);
  const navigate = useNavigate();
  const { history, removeItem } = useWatchHistoryStore((s) => s);
  const [progressData, setProgressData] = useState<Record<string, number>>({});
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);

  const recentItems = useMemo(() => {
    const seen = new Set();
    return history
      .filter((item: WatchHistoryItem) => {
        if (seen.has(item.link)) return false;
        seen.add(item.link);
        return true;
      })
      .slice(0, 10);
  }, [history]);

  useEffect(() => {
    const loadProgressData = () => {
      const progressMap: Record<string, number> = {};
      recentItems.forEach((item: WatchHistoryItem) => {
        try {
          const historyKey = item.link;
          const historyProgressKey = `watch_history_progress_${historyKey}`;
          const storedProgress = localStorage.getItem(historyProgressKey);
          if (storedProgress) {
            const parsed = JSON.parse(storedProgress);
            if (parsed.percentage) {
              progressMap[item.link] = Math.min(Math.max(parsed.percentage, 0), 100);
            } else if (parsed.currentTime && parsed.duration) {
              const percentage = (parsed.currentTime / parsed.duration) * 100;
              progressMap[item.link] = Math.min(Math.max(percentage, 0), 100);
            }
          } else if (item.currentTime && item.duration) {
            const percentage = (item.currentTime / item.duration) * 100;
            progressMap[item.link] = Math.min(Math.max(percentage, 0), 100);
          }
        } catch (e) {
          console.error('Error processing progress for item:', item.title, e);
        }
      });
      setProgressData(progressMap);
    };
    loadProgressData();
  }, [recentItems]);

  const handleNavigateToInfo = useCallback((item: WatchHistoryItem) => {
    try {
      let linkData = item.infoLink || item.link;
      if (typeof linkData === 'string' && linkData.startsWith('{')) {
        try {
          const parsed = JSON.parse(linkData);
          if (typeof parsed === 'string') linkData = parsed;
        } catch {}
      }
      navigate(`/info/${encodeURIComponent(linkData)}${item.provider ? `?provider=${encodeURIComponent(item.provider)}` : ''}`);
    } catch {
      // navigation failed silently
    }
  }, [navigate]);

  const toggleItemSelection = useCallback((link: string) => {
    setSelectedItems(prev => {
      const newSelected = new Set(prev);
      newSelected.has(link) ? newSelected.delete(link) : newSelected.add(link);
      if (newSelected.size === 0) setSelectionMode(false);
      return newSelected;
    });
  }, []);

  const handleLongPressStart = useCallback((link: string) => {
    const timer = setTimeout(() => {
      if (!selectionMode) setSelectionMode(true);
      toggleItemSelection(link);
    }, 500);
    setLongPressTimer(timer);
  }, [selectionMode, toggleItemSelection]);

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  }, [longPressTimer]);

  const handlePress = useCallback((item: WatchHistoryItem) => {
    selectionMode ? toggleItemSelection(item.link) : handleNavigateToInfo(item);
  }, [selectionMode, toggleItemSelection, handleNavigateToInfo]);

  const deleteSelectedItems = useCallback(() => {
    recentItems.forEach((item: WatchHistoryItem) => {
      if (selectedItems.has(item.link)) removeItem(item.link);
    });
    setSelectedItems(new Set());
    setSelectionMode(false);
  }, [recentItems, selectedItems, removeItem]);

  const exitSelectionMode = useCallback(() => {
    setSelectedItems(new Set());
    setSelectionMode(false);
  }, []);

  if (recentItems.length === 0) return null;

  return (
    <div onClick={() => selectionMode && exitSelectionMode()}>
      <div className="flex justify-between items-center px-4 mb-3 mt-2">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded-full" style={{ backgroundColor: primary }} />
          <h2 className="text-white text-lg font-bold tracking-tight">Continue Watching</h2>
        </div>
        {selectionMode && selectedItems.size > 0 && (
          <div className="flex items-center gap-2 animate-fade-in">
            <span className="text-white/40 text-xs font-medium">{selectedItems.size} selected</span>
            <button onClick={deleteSelectedItems}
              className="rounded-lg p-2 glass-panel hover:bg-error/10 transition-colors"
              aria-label="Delete selected">
              <svg className="w-4 h-4 text-error/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="flex overflow-x-auto px-4 gap-2 scrollbar-hide">
        {recentItems.map((item: WatchHistoryItem) => {
          const progress = progressData[item.link] || 0;
          const isSelected = selectedItems.has(item.link);
          return (
            <div
              key={item.link}
              className="flex-shrink-0 cursor-pointer relative"
              onClick={() => handlePress(item)}
              onMouseDown={() => handleLongPressStart(item.link)}
              onMouseUp={handleLongPressEnd}
              onMouseLeave={handleLongPressEnd}
              onTouchStart={() => handleLongPressStart(item.link)}
              onTouchEnd={handleLongPressEnd}
            >
              <div className="relative rounded-xl overflow-hidden glass-card transition-all duration-200"
                style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}>
                {item.poster ? (
                  <img src={item.poster} alt="" className="w-full h-full rounded-xl object-cover" />
                ) : (
                  <div className="w-full h-full rounded-xl bg-elevated" />
                )}

                {/* Selection indicator */}
                {selectionMode && (
                  <div className="absolute top-2 right-2 z-50">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 transition-all duration-200 ${
                      isSelected ? '' : 'border-white/30'
                    }`} style={{ backgroundColor: isSelected ? primary : 'rgba(0,0,0,0.4)' }}>
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </div>
                )}
                {isSelected && <div className="absolute inset-0 rounded-xl bg-black/40" />}

                {/* Progress bar */}
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
                  <div className="h-full transition-all duration-300" style={{ width: `${progress}%`, backgroundColor: primary }} />
                </div>
              </div>
              <p className="text-white text-[11px] font-medium mt-1.5 truncate" style={{ width: CARD_WIDTH }}>
                {item.title}
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke={primary}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-[9px] font-semibold" style={{ color: primary }}>{Math.round(progress)}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ContinueWatching;
