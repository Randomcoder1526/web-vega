import { mainStorage } from './storage';
import type { WatchListItem } from '../types';

export class WatchListStorage {
  getWatchList(): WatchListItem[] {
    return mainStorage.getArray<WatchListItem>('watchlist') || [];
  }

  addToWatchList(item: WatchListItem): WatchListItem[] {
    const list = this.getWatchList().filter(i => i.link !== item.link);
    list.push(item);
    mainStorage.setArray('watchlist', list);
    return list;
  }

  removeFromWatchList(link: string): WatchListItem[] {
    const list = this.getWatchList().filter(item => item.link !== link);
    mainStorage.setArray('watchlist', list);
    return list;
  }

  isInWatchList(link: string): boolean {
    return this.getWatchList().some(item => item.link === link);
  }

  clearWatchList(): void {
    mainStorage.setArray('watchlist', []);
  }
}

export const watchListStorage = new WatchListStorage();
