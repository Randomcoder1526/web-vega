import { useQuery } from '@tanstack/react-query';
import { providerManager } from '../lib/providerManager';
import type { Info } from '../types';

const fetchCinemetaMeta = async (type: string, imdbId: string, signal: AbortSignal): Promise<any | null> => {
  try {
    const response = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`, { signal });
    const data = await response.json();
    return data?.meta || null;
  } catch {
    return null;
  }
};

const searchCinemeta = async (title: string, type: string, year: string | undefined, signal: AbortSignal): Promise<{ meta: any; type: string } | null> => {
  const types = type === 'series' ? ['series', 'movie'] : ['movie', 'series'];
  for (const t of types) {
    try {
      const response = await fetch(
        `https://v3-cinemeta.strem.io/catalog/${t}/top/search=${encodeURIComponent(title)}.json`,
        { signal },
      );
      const data = await response.json();
      const metas: any[] = data?.metas || [];
      if (!metas.length) continue;
      const match = year
        ? metas.find((m) => m.year && m.year.toString() === year.toString()) || metas[0]
        : metas[0];
      const full = await fetchCinemetaMeta(t, match.id, signal);
      if (full) return { meta: full, type: t };
    } catch {
      // try next type
    }
  }
  return null;
};

const applyCinemeta = (info: Info, meta: any): Info => ({
  ...info,
  name: meta.name || info.title,
  description: meta.description || info.synopsis,
  background: meta.background || info.image,
  poster: meta.poster || info.image,
  logo: meta.logo || '',
  imdbRating: meta.imdbRating || info.rating || '',
  year: meta.year?.toString() || info.year || '',
  runtime: meta.runtime || '',
  genres: meta.genres || info.tags || [],
  cast: meta.cast || info.cast || [],
  director: meta.director || '',
  trailers: meta.videos?.filter((v: any) => v.type === 'Trailer')?.slice(0, 3)?.map((v: any) => ({
    source: v.youtubeTrailerId || v.id || '',
    name: v.name || '',
  })) || [],
});

export const useContentInfo = (link: string, providerValue: string) => {
  return useQuery<Info>({
    queryKey: ['contentInfo', link, providerValue],
    queryFn: async ({ signal }) => {
      try {
        const info = await providerManager.getMetaData({ link, provider: providerValue });
        if (!info) return null as any;

        let meta: any = null;
        let resolvedType = info.type;

        if (info.imdbId) {
          meta = await fetchCinemetaMeta(info.type, info.imdbId, signal);
        }

        if (!meta) {
          const found = await searchCinemeta(info.title, info.type, info.year, signal);
          if (found) {
            meta = found.meta;
            resolvedType = found.type;
          }
        }

        if (meta) {
          return applyCinemeta({ ...info, type: resolvedType || info.type }, meta);
        }

        return info;
      } catch (e: any) {
        if (signal?.aborted || e?.name === 'AbortError') return null as any;
        throw e;
      }
    },
    enabled: !!link && !!providerValue,
    staleTime: 10 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error?.name === 'AbortError') return false;
      return failureCount < 2;
    },
  });
};
