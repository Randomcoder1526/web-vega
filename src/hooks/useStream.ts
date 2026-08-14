import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { providerManager, ProviderError } from '../lib/providerManager';
import type { Stream, EpisodeLink } from '../types';

export const useStream = ({
  episodeLink,
  providerValue,
}: {
  episodeLink: string;
  providerValue: string;
}) => {
  const [selectedStream, setSelectedStream] = useState<Stream | null>(null);

  const { data: streams, isLoading, error, refetch } = useQuery<Stream[]>({
    queryKey: ['stream', episodeLink, providerValue],
    queryFn: async ({ signal }) => {
      try {
        return await providerManager.getStream({
          link: episodeLink,
          type: episodeLink.includes('/series/') || episodeLink.includes('/episode/') ? 'series' : 'movie',
          signal,
          providerValue,
        });
      } catch (e: any) {
        if (signal?.aborted || e?.name === 'AbortError') return [];
        throw e;
      }
    },
    enabled: !!episodeLink && !!providerValue,
    retry: (failureCount, error) => {
      if (error?.name === 'AbortError') return false;
      if (error instanceof ProviderError && ['HTTP_403', 'HTTP_404', 'HTTP_429'].includes(error.code)) return false;
      return failureCount < 1;
    },
  });

  const selectStream = useCallback((stream: Stream) => {
    setSelectedStream(stream);
  }, []);

  const getDefaultStream = useCallback((list: Stream[]) => {
    const cfStream = list.find(s => /cf|cloudflare|storage/i.test(s.server || ''));
    return cfStream || list[0] || null;
  }, []);

  return {
    streams: streams || [],
    selectedStream: selectedStream || getDefaultStream(streams || []),
    setSelectedStream: selectStream,
    isLoading,
    error,
    refetch,
  };
};

export const useEpisodes = (url: string, providerValue: string) => {
  return useQuery<EpisodeLink[]>({
    queryKey: ['episodes', url, providerValue],
    queryFn: async ({ signal }) => {
      try {
        return await providerManager.getEpisodes({ url, providerValue, signal });
      } catch (e: any) {
        if (signal?.aborted || e?.name === 'AbortError') return [];
        throw e;
      }
    },
    enabled: !!url && !!providerValue,
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error?.name === 'AbortError') return false;
      if (error instanceof ProviderError && ['HTTP_403', 'HTTP_404', 'HTTP_429'].includes(error.code)) return false;
      return failureCount < 1;
    },
  });
};
