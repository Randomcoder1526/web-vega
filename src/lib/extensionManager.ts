import axios from 'axios';
import { extensionStorage } from './extensionStorage';
import { serverProviderStorage } from './serverProviderStorage';
import type { ProviderExtension, ProviderModule, ProviderSource } from '../types';

async function proxyGet(url: string, timeout = 10000) {
  if (/^https?:\/\//.test(url)) {
    return axios.get(`/vega-proxy?url=${encodeURIComponent(url)}`, { timeout });
  }
  return axios.get(url, { timeout });
}

class ExtensionManager {
  private static instance: ExtensionManager;

  private getActiveSource(source?: ProviderSource): ProviderSource | undefined {
    return source || extensionStorage.getProviderSource();
  }

  static getInstance(): ExtensionManager {
    if (!ExtensionManager.instance) {
      ExtensionManager.instance = new ExtensionManager();
    }
    return ExtensionManager.instance;
  }

  async fetchManifest(sourceOrForce?: ProviderSource | boolean, force = false): Promise<ProviderExtension[]> {
    const source = sourceOrForce && typeof sourceOrForce === 'object' ? sourceOrForce : undefined;
    const shouldForce = typeof sourceOrForce === 'boolean' ? sourceOrForce : force;
    const activeSource = this.getActiveSource(source);

    if (!activeSource) throw new Error('No provider source configured');

    try {
      if (!shouldForce && !extensionStorage.isManifestCacheExpired(activeSource.author)) {
        const cached = extensionStorage.getManifestCache(activeSource.author);
        if (cached.length > 0) return cached;
      }

      const manifestUrl = `${activeSource.url}/manifest.json`;
      console.log('Fetching manifest from:', manifestUrl);
      const response = await proxyGet(manifestUrl, 10000);

      if (!response.data || !Array.isArray(response.data)) {
        throw new Error('Invalid manifest format');
      }

      const providers: ProviderExtension[] = response.data.map((item: any) => ({
        value: item.value,
        display_name: item.display_name,
        disabled: item.disabled || false,
        source: activeSource,
        version: item.version,
        icon: item.icon || '',
        type: item.type || 'global',
        installed: false,
      }));

      extensionStorage.setManifestCache(providers, activeSource.author);
      extensionStorage.setAvailableProviders(activeSource.author, providers);
      return providers;
    } catch (error) {
      console.error('Failed to fetch manifest:', error);
      const cached = extensionStorage.getManifestCache(activeSource.author);
      if (cached.length > 0) return cached;
      throw error;
    }
  }

  async downloadProviderModules(
    sourceUrl: string,
    sourceAuthor: string,
    providerValue: string,
    version: string,
  ): Promise<ProviderModule> {
    const requiredFiles = ['posts', 'meta', 'stream', 'catalog'];
    const optionalFiles = ['episodes'];
    const allFiles = [...requiredFiles, ...optionalFiles];
    const modules: Record<string, string> = {};

    const downloadPromises = allFiles.map(async (fileName) => {
      try {
        const url = `${sourceUrl}/dist/${providerValue}/${fileName}.js`;
        console.log(`Downloading: ${url}`);
        const response = await proxyGet(url, 15000);
        if (response.data) modules[fileName] = response.data;
      } catch (error) {
        if (requiredFiles.includes(fileName)) throw error;
      }
    });

    await Promise.all(downloadPromises);

    const missingRequired = requiredFiles.filter((file) => !modules[file]);
    if (missingRequired.length > 0) {
      throw new Error(`Missing required files: ${missingRequired.join(', ')}`);
    }

    const providerModule: ProviderModule = {
      value: providerValue,
      sourceAuthor,
      version,
      modules: {
        posts: modules.posts,
        meta: modules.meta,
        stream: modules.stream,
        catalog: modules.catalog,
        episodes: modules.episodes,
      },
      cachedAt: Date.now(),
    };

    extensionStorage.cacheProviderModules(providerModule);
    return providerModule;
  }

  async installProvider(provider: ProviderExtension): Promise<void> {
    await this.downloadProviderModules(
      provider.source.url,
      provider.source.author,
      provider.value,
      provider.version,
    );
    extensionStorage.installProvider(provider);
    console.log(`Installed provider: ${provider.display_name}`);
  }

  async updateProvider(provider: ProviderExtension): Promise<void> {
    await this.downloadProviderModules(
      provider.source.url,
      provider.source.author,
      provider.value,
      provider.version,
    );
    extensionStorage.installProvider(provider);
    console.log(`Updated provider: ${provider.display_name}`);
  }

  async initialize(): Promise<void> {
    await extensionStorage.syncSharedFromServer();

    const source = this.getActiveSource();
    if (!source) return;

    if (extensionStorage.isManifestCacheExpired(source.author)) {
      try { await this.fetchManifest(source, false); } catch { /* ignore */ }
    }

    const installed = extensionStorage.getInstalledProviders();
    await Promise.all(
      installed.map(async (provider) => {
        try {
          const modules = await serverProviderStorage.loadProviderModules(
            provider.value,
            provider.source?.author,
          );
          if (modules) extensionStorage.cacheProviderModules(modules);
        } catch { /* ignore unavailable server */ }
      }),
    );
  }
}

export const extensionManager = ExtensionManager.getInstance();
