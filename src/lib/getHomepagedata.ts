import { providerManager } from './providerManager';
import type { ProviderExtension, Post } from '../types';

export interface HomePageData {
  title: string;
  Posts: Post[];
  filter: string;
  error?: string;
}

export const getHomePageData = async (
  provider: ProviderExtension,
  signal?: AbortSignal,
): Promise<HomePageData[]> => {
  if (!provider?.value) return [];

  const catalogs = providerManager.getCatalog({ providerValue: provider.value });
  if (catalogs.length === 0) return [];

  const fetchPromises = catalogs.map(async (item) => {
    try {
      const data = await providerManager.getPosts({
        filter: item.filter,
        page: 1,
        providerValue: provider.value,
        signal: signal || new AbortController().signal,
      });
      return { title: item.title, Posts: data || [], filter: item.filter };
    } catch (error: any) {
      if (signal?.aborted || error?.name === 'AbortError') {
        return { title: item.title, Posts: [], filter: item.filter };
      }
      console.error(`Failed to fetch ${item.title}:`, error);
      return {
        title: item.title,
        Posts: [],
        filter: item.filter,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  const results = await Promise.allSettled(fetchPromises);
  const homePageData: HomePageData[] = [];
  let successCount = 0;

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      homePageData.push(result.value);
      if (result.value.Posts.length > 0) successCount++;
    } else {
      homePageData.push({
        title: catalogs[index].title,
        Posts: [],
        filter: catalogs[index].filter,
        error: result.reason?.message || 'Failed to load',
      });
    }
  });

  if (successCount === 0 && homePageData.length > 0) {
    if (signal?.aborted) return [];
    const firstError = homePageData.find((d) => d.error);
    if (firstError?.error) throw new Error(firstError.error);
  }

  return homePageData;
};

const heroSelectionCache = new Map<string, number>();

export const getRandomHeroPost = (homeData: HomePageData[], providerValue?: string) => {
  if (!homeData || homeData.length === 0) return null;
  const lastCategory = homeData[homeData.length - 1];
  if (!lastCategory.Posts || lastCategory.Posts.length === 0) return null;

  const cacheKey = providerValue || 'default';
  const cached = heroSelectionCache.get(cacheKey);
  if (cached !== undefined && cached < lastCategory.Posts.length) {
    return lastCategory.Posts[cached];
  }

  const idx = Math.floor(Math.random() * lastCategory.Posts.length);
  heroSelectionCache.set(cacheKey, idx);
  return lastCategory.Posts[idx];
};

export const clearHeroCache = (providerValue?: string) => {
  if (providerValue) heroSelectionCache.delete(providerValue);
  else heroSelectionCache.clear();
};
