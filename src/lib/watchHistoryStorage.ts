import { mainStorage } from './storage';
import type { WatchHistoryItem } from '../types';

export enum WatchHistoryKeys {
  WATCH_HISTORY = 'watchHistory',
  SERIES_EPISODES = 'seriesEpisodes',
}

export class WatchHistoryStorage {
  getWatchHistory(): WatchHistoryItem[] {
    return mainStorage.getArray<WatchHistoryItem>(WatchHistoryKeys.WATCH_HISTORY) || [];
  }

  addToWatchHistory(item: WatchHistoryItem): void {
    const history = this.getWatchHistory();
    const existingIndex = history.findIndex(i => i.id === item.id);
    if (existingIndex !== -1) {
      history[existingIndex] = { ...history[existingIndex], ...item, timestamp: Date.now() };
    } else {
      history.unshift({ ...item, timestamp: Date.now() });
    }
    mainStorage.setArray(WatchHistoryKeys.WATCH_HISTORY, history.slice(0, 100));
  }

  removeFromWatchHistory(id: string): void {
    const history = this.getWatchHistory();
    mainStorage.setArray(WatchHistoryKeys.WATCH_HISTORY, history.filter(item => item.id !== id));
  }

  clearWatchHistory(): void {
    mainStorage.setArray(WatchHistoryKeys.WATCH_HISTORY, []);
  }

  updateProgress(id: string, progress: number, duration?: number): void {
    const history = this.getWatchHistory();
    const idx = history.findIndex(i => i.id === id);
    if (idx !== -1) {
      history[idx] = { ...history[idx], progress, duration, timestamp: Date.now() };
      mainStorage.setArray(WatchHistoryKeys.WATCH_HISTORY, history);
    }
  }
}

export const watchHistoryStorage = new WatchHistoryStorage();
