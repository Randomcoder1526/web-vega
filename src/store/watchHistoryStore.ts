import { create } from 'zustand';
import { watchHistoryStorage } from '../lib/watchHistoryStorage';
import type { WatchHistoryItem } from '../types';

interface HistoryStore {
  history: WatchHistoryItem[];
  addItem: (item: WatchHistoryItem) => void;
  updatePlaybackInfo: (link: string, info: Partial<WatchHistoryItem>) => void;
  clearHistory: () => void;
  removeItem: (link: string) => void;
  updateItemWithInfo: (link: string, infoData: any) => void;
}

export const useWatchHistoryStore = create<HistoryStore>()((set) => ({
  history: watchHistoryStorage.getWatchHistory(),

  addItem: (item) => {
    const storageItem: WatchHistoryItem = {
      id: item.link || item.title,
      title: item.title,
      poster: item.poster,
      provider: item.provider,
      link: item.link,
      infoLink: item.infoLink,
      timestamp: Date.now(),
      duration: item.duration,
      progress: item.currentTime,
      episodeTitle: item.episodeTitle,
      seasonIndex: item.seasonIndex,
      episodeIndex: item.episodeIndex,
      cachedInfoData: item.cachedInfoData,
    };
    watchHistoryStorage.addToWatchHistory(storageItem);
    set({ history: watchHistoryStorage.getWatchHistory() });
  },

  updatePlaybackInfo: (link, info) => {
    const history = watchHistoryStorage.getWatchHistory();
    const existing = history.find((item) => item.link === link);
    if (existing) {
      watchHistoryStorage.addToWatchHistory({
        ...existing,
        progress: info.currentTime,
        duration: info.duration || existing.duration,
        timestamp: Date.now(),
      });
    }
    set({ history: watchHistoryStorage.getWatchHistory() });
  },

  removeItem: (link) => {
    watchHistoryStorage.removeFromWatchHistory(link);
    set({ history: watchHistoryStorage.getWatchHistory() });
  },

  clearHistory: () => {
    watchHistoryStorage.clearWatchHistory();
    set({ history: [] });
  },

  updateItemWithInfo: (link, infoData) => {
    const history = watchHistoryStorage.getWatchHistory();
    const existing = history.find((item) => item.link === link);
    if (existing) {
      watchHistoryStorage.addToWatchHistory({
        ...existing,
        cachedInfoData: infoData,
      });
    }
    set({ history: watchHistoryStorage.getWatchHistory() });
  },
}));
