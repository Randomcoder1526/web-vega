import { extensionStorage } from './extensionStorage';
import type { Catalog, EpisodeLink, Info, Post, Stream } from '../types';
import { providerContext } from './providerContext';

export class ProviderError extends Error {
  code: string;
  status?: number;
  provider: string;
  constructor(message: string, provider: string, code = 'PROVIDER_ERROR', status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
    this.provider = provider;
  }
}

function classifyProviderError(error: any, provider: string, operation: string): ProviderError {
  if (error instanceof ProviderError) return error;
  const status = Number(error?.response?.status || error?.status || 0) || undefined;
  const message = String(error?.message || 'Unknown provider error');
  if (error?.name === 'AbortError') return new ProviderError('Request cancelled.', provider, 'ABORTED', status);
  if (status === 403) return new ProviderError('Provider denied the request (403).', provider, 'HTTP_403', status);
  if (status === 404) return new ProviderError('Provider resource was not found (404).', provider, 'HTTP_404', status);
  if (status === 429) return new ProviderError('Provider is rate limiting requests (429).', provider, 'HTTP_429', status);
  if (status >= 500) return new ProviderError(`Provider server error (${status}).`, provider, `HTTP_${status}`, status);
  if (/timeout|timed out/i.test(message)) return new ProviderError(`${operation} timed out.`, provider, 'TIMEOUT', status);
  if (/network|fetch|socket|ECONN|ENOTFOUND/i.test(message)) return new ProviderError(`Provider network request failed.`, provider, 'NETWORK_ERROR', status);
  return new ProviderError(message || `${operation} failed.`, provider, 'PROVIDER_ERROR', status);
}

function normalizeStreams(raw: unknown, provider: string): Stream[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.map((item: any) => ({
    server: String(item?.server || item?.name || provider),
    link: String(item?.link || item?.url || '').trim(),
    type: String(item?.type || 'direct'),
    quality: item?.quality != null ? String(item.quality) : undefined,
    subtitles: Array.isArray(item?.subtitles) ? item.subtitles : undefined,
    headers: item?.headers && typeof item.headers === 'object' ? item.headers : undefined,
  })).filter((stream) => {
    if (!/^https?:\/\//i.test(stream.link)) return false;
    const key = stream.link;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createProxiedFetch() {
  const originalFetch = window.fetch;
  const BYPASS_DOMAINS: string[] = [];
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/^https?:\/\//.test(url)) {
      try {
        const parsed = new URL(url);
        if (!BYPASS_DOMAINS.includes(parsed.hostname)) {
          url = `/vega-proxy?url=${encodeURIComponent(url)}`;
        }
      } catch { /* ignore parse errors, will proxy */ }
    }
    return originalFetch.call(window, url, init);
  };
}

class ProviderManager {
  private createExecutionContext() {
    const proxiedFetch = createProxiedFetch();
    return {
      exports: {} as any,
      require: () => ({}),
      module: { exports: {} },
      console,
      Promise,
      fetch: proxiedFetch,
      __awaiter: (thisArg: any, _arguments: any, P: any, generator: any) => {
        function adopt(value: any) {
          return value instanceof P
            ? value
            : new P(function (resolve: any) { resolve(value); });
        }
        return new (P || (P = Promise))(function (resolve: any, reject: any) {
          function fulfilled(value: any) {
            try { step(generator.next(value)); } catch (e) { reject(e); }
          }
          function rejected(value: any) {
            try { step(generator.throw(value)); } catch (e) { reject(e); }
          }
          function step(result: any) {
            result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
          }
          step((generator = generator.apply(thisArg, _arguments || [])).next());
        });
      },
      Object,
    };
  }

  private executeModule(moduleCode: string, ...args: any[]): any {
    const context = this.createExecutionContext();
    const executeModule = new Function(
      'context',
      ...Array.from({ length: args.length }, (_, i) => `arg${i}`),
      `
      const exports = context.exports;
      const __awaiter = context.__awaiter;
      const Object = context.Object;
      const console = context.console;
      const Promise = context.Promise;
      const fetch = context.fetch;
      ${moduleCode}
      return exports;
      `,
    );
    return executeModule(context, ...args);
  }

  getCatalog = ({ providerValue }: { providerValue: string }): Catalog[] => {
    const catalogModule = extensionStorage.getProviderModules(providerValue)?.modules.catalog;
    if (!catalogModule) {
      console.warn(`[providerManager] No catalog module loaded for "${providerValue}".`);
      return [];
    }
    try {
      const moduleExports = this.executeModule(catalogModule);
      return moduleExports.catalog || [];
    } catch (error) {
      console.error(`[providerManager] ${providerValue}.getCatalog failed:`, error);
      return [];
    }
  };

  getGenres = ({ providerValue }: { providerValue: string }): Catalog[] => {
    const catalogModule = extensionStorage.getProviderModules(providerValue)?.modules.catalog;
    if (!catalogModule) {
      console.warn(`[providerManager] No catalog module loaded for "${providerValue}".`);
      return [];
    }
    try {
      const moduleExports = this.executeModule(catalogModule);
      return moduleExports.genres || [];
    } catch (error) {
      console.error(`[providerManager] ${providerValue}.getGenres failed:`, error);
      return [];
    }
  };

  getPosts = async ({
    filter, page, providerValue, signal,
  }: {
    filter: string;
    page: number;
    providerValue: string;
    signal: AbortSignal;
  }): Promise<Post[]> => {
    if (signal?.aborted) return [];
    const module = extensionStorage.getProviderModules(providerValue)?.modules.posts;
    if (!module) {
      throw new Error(`Content source "${providerValue}" is not installed or unavailable.`);
    }
    try {
      const moduleExports = this.executeModule(module, filter, page, providerValue, signal, providerContext);
      return await moduleExports.getPosts({ filter, page, providerValue, signal, providerContext });
    } catch (error: any) {
      if (signal?.aborted || error?.name === 'AbortError') return [];
      console.error(`[providerManager] ${providerValue}.getPosts failed:`, error?.message || error);
      if (error?.stack) console.error(`[providerManager] stack:`, error.stack);
      throw error instanceof Error ? error : new Error('Content source failed to load.');
    }
  };

  getSearchPosts = async ({
    searchQuery, page, providerValue, signal,
  }: {
    searchQuery: string;
    page: number;
    providerValue: string;
    signal: AbortSignal;
  }): Promise<Post[]> => {
    if (signal?.aborted) return [];
    const module = extensionStorage.getProviderModules(providerValue)?.modules.posts;
    if (!module) {
      throw new Error(`Content source "${providerValue}" is not installed or unavailable.`);
    }
    try {
      const moduleExports = this.executeModule(module, searchQuery, page, providerValue, signal, providerContext);
      return await moduleExports.getSearchPosts({ searchQuery, page, providerValue, signal, providerContext });
    } catch (error: any) {
      if (signal?.aborted || error?.name === 'AbortError') return [];
      console.error(`[providerManager] ${providerValue}.getSearchPosts failed:`, error?.message || error);
      if (error?.stack) console.error(`[providerManager] stack:`, error.stack);
      throw error instanceof Error ? error : new Error('Search is temporarily unavailable.');
    }
  };

  getMetaData = async ({ link, provider }: { link: string; provider: string }): Promise<Info> => {
    const module = extensionStorage.getProviderModules(provider)?.modules.meta;
    if (!module) {
      console.warn(`[providerManager] No meta module loaded for "${provider}". Provider may not be installed.`);
      return {} as Info;
    }
    try {
      const moduleExports = this.executeModule(module, link, provider, providerContext);
      return await moduleExports.getMeta({ link, provider, providerContext });
    } catch (error: any) {
      console.error(`[providerManager] ${provider}.getMetaData failed:`, error?.message || error);
      if (error?.stack) console.error(`[providerManager] stack:`, error.stack);
      return {} as Info;
    }
  };

  getStream = async ({
    link, type, signal, providerValue,
  }: {
    link: string;
    type: string;
    signal: AbortSignal;
    providerValue: string;
  }): Promise<Stream[]> => {
    if (signal?.aborted) return [];
    const module = extensionStorage.getProviderModules(providerValue)?.modules.stream;
    if (!module) {
      throw new Error(`The selected content source is unavailable. Please choose another source.`);
    }
    try {
      const moduleExports = this.executeModule(module, link, type, signal, providerContext);
      const rawStreams = await moduleExports.getStream({ link, type, signal, providerContext });
      return normalizeStreams(rawStreams, providerValue);
    } catch (error: any) {
      if (signal?.aborted || error?.name === 'AbortError') return [];
      const normalized = classifyProviderError(error, providerValue, 'Stream extraction');
      console.error(`[providerManager] ${providerValue}.getStream failed [${normalized.code}]:`, error?.message || error);
      if (error?.stack) console.error(`[providerManager] stack:`, error.stack);
      throw normalized;
    }
  };

  getEpisodes = async ({
    url, providerValue, signal,
  }: {
    url: string;
    providerValue: string;
    signal?: AbortSignal;
  }): Promise<EpisodeLink[]> => {
    if (signal?.aborted) return [];
    const module = extensionStorage.getProviderModules(providerValue)?.modules.episodes;
    if (!module) {
      console.warn(`[providerManager] No episodes module loaded for "${providerValue}". Provider may not be installed.`);
      return [];
    }
    try {
      const moduleExports = this.executeModule(module, url, providerContext);
      return await moduleExports.getEpisodes({ url, providerContext, signal });
    } catch (error: any) {
      if (signal?.aborted || error?.name === 'AbortError') return [];
      const normalized = classifyProviderError(error, providerValue, 'Episode extraction');
      console.error(`[providerManager] ${providerValue}.getEpisodes failed [${normalized.code}]:`, error?.message || error);
      if (error?.stack) console.error(`[providerManager] stack:`, error.stack);
      return [];
    }
  };
}

export const providerManager = new ProviderManager();
