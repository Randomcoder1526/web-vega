import { create } from 'zustand';
import { watchListStorage } from '../lib/watchListStorage';
import type { WatchListItem } from '../types';

interface WatchListStore {
  watchList: WatchListItem[];
  removeItem: (link: string) => void;
  addItem: (item: WatchListItem) => void;
  isInWatchList: (link: string) => boolean;
  clearList: () => void;
}

export const useWatchListStore = create<WatchListStore>()((set, get) => ({
  watchList: watchListStorage.getWatchList(),
  removeItem: (link) => {
    const newList = watchListStorage.removeFromWatchList(link);
    set({ watchList: newList });
  },
  addItem: (item) => {
    const newList = watchListStorage.addToWatchList(item);
    set({ watchList: newList });
  },
  isInWatchList: (link) => {
    return get().watchList.some((item) => item.link === link);
  },
  clearList: () => {
    watchListStorage.clearWatchList();
    set({ watchList: [] });
  },
}));
