import { useQuery } from '@tanstack/react-query';
import { getHomePageData, type HomePageData } from '../lib/getHomepagedata';
import { providerManager } from '../lib/providerManager';
import type { ProviderExtension } from '../types';

interface UseHomePageDataOptions {
  provider: ProviderExtension;
  enabled?: boolean;
}

export const useHomePageData = ({ provider, enabled = true }: UseHomePageDataOptions) => {
  return useQuery<HomePageData[], Error>({
    queryKey: ['homePageData', provider.value],
    queryFn: async ({ signal }) => {
      try {
        return await getHomePageData(provider, signal);
      } catch (e: any) {
        if (signal?.aborted || e?.name === 'AbortError') return [];
        throw e;
      }
    },
    enabled: enabled && !!provider?.value,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error?.name === 'AbortError') return false;
      return failureCount < 3;
    },
    retryDelay: (i) => Math.min(1000 * 2 ** i, 30000),
  });
};

export const useHeroMetadata = (heroLink: string, providerValue: string) => {
  return useQuery({
    queryKey: ['heroMetadata', heroLink, providerValue],
    queryFn: async ({ signal }) => {
      try {
        const info = await providerManager.getMetaData({
          link: heroLink,
          provider: providerValue,
        });
        if (info.imdbId) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const mergedSignal = signal
              ? new AbortController()
              : controller;
            if (signal) {
              signal.addEventListener('abort', () => mergedSignal.abort());
            }
            const response = await fetch(
              `https://v3-cinemeta.strem.io/meta/${info.type}/${info.imdbId}.json`,
              { signal: signal || controller.signal },
            );
            clearTimeout(timeoutId);
            const data = await response.json();
            return data?.meta || info;
          } catch {
            return info;
          }
        }
        return info;
      } catch (e: any) {
        if (signal?.aborted || e?.name === 'AbortError') return null;
        throw e;
      }
    },
    enabled: !!heroLink && !!providerValue,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error?.name === 'AbortError') return false;
      return failureCount < 2;
    },
  });
};
