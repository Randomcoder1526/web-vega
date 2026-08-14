import { mainStorage } from './storage';
import { serverProviderStorage, isAdminMode } from './serverProviderStorage';
import type { ProviderExtension, ProviderModule, ProviderSource } from '../types';

export enum ExtensionKeys {
  INSTALLED_PROVIDERS = 'installedProviders',
  AVAILABLE_PROVIDERS = 'availableProviders',
  PROVIDER_SOURCES = 'providerSources',
  PROVIDER_MODULES = 'providerModules',
  MANIFEST_CACHE = 'manifestCache',
  LAST_MANIFEST_FETCH = 'lastManifestFetch',
}

export class ExtensionStorage {
  private moduleCache = new Map<string, ProviderModule>();
  private installedCache: ProviderExtension[] | null = null;
  private sourcesCache: ProviderSource[] | null = null;

  private normalizeUrl(url: string): string {
    return url.trim().replace(/\/+$/, '');
  }

  private scopedKey(baseKey: string, author?: string): string {
    return author ? `${baseKey}_${author}` : baseKey;
  }

  private moduleKey(value: string, sourceAuthor?: string): string {
    return `${sourceAuthor || ''}:${value}`;
  }

  addProviderSources(author: string, url: string): void {
    const normalizedAuthor = author.trim();
    const normalizedUrl = this.normalizeUrl(url);
    if (!normalizedAuthor || !normalizedUrl) return;

    const sources = this.getProviderSources();
    const existingIndex = sources.findIndex(s => s.author === normalizedAuthor);
    if (existingIndex >= 0) {
      sources[existingIndex] = { ...sources[existingIndex], url: normalizedUrl };
    } else {
      sources.push({ author: normalizedAuthor, url: normalizedUrl, isDefault: sources.length === 0 });
    }

    if (!sources.some(s => s.isDefault) && sources.length > 0) {
      sources[0].isDefault = true;
    }
    this.setProviderSources(sources);
  }

  getProviderSource(getDefault = true): ProviderSource | undefined {
    const sources = this.getProviderSources();
    if (sources.length === 0) return undefined;
    return getDefault ? sources.find(s => s.isDefault) || sources[0] : sources[0];
  }

  getProviderSources(): ProviderSource[] {
    if (this.sourcesCache) return this.sourcesCache;
    return mainStorage.getArray<ProviderSource>(ExtensionKeys.PROVIDER_SOURCES) || [];
  }

  setProviderSources(sources: ProviderSource[]): void {
    this.sourcesCache = sources;
    mainStorage.setArray(ExtensionKeys.PROVIDER_SOURCES, sources);
    void serverProviderStorage.setProviderSources(sources);
  }

  removeProviderSource(author: string): void {
    const sources = this.getProviderSources();
    const removedDefault = sources.find(s => s.author === author)?.isDefault;
    const filtered = sources.filter(s => s.author !== author);
    if (filtered.length > 0 && (removedDefault || !filtered.some(s => s.isDefault))) {
      filtered[0] = { ...filtered[0], isDefault: true };
      for (let i = 1; i < filtered.length; i++) {
        filtered[i] = { ...filtered[i], isDefault: false };
      }
    }
    this.setProviderSources(filtered);
  }

  setDefaultProviderSource(author: string): void {
    const sources = this.getProviderSources();
    if (!sources.some(s => s.author === author)) return;
    this.setProviderSources(sources.map(s => ({ ...s, isDefault: s.author === author })));
  }

  getInstalledProviders(): ProviderExtension[] {
    if (this.installedCache) return this.installedCache;
    return mainStorage.getArray<ProviderExtension>(ExtensionKeys.INSTALLED_PROVIDERS) || [];
  }

  setInstalledProviders(providers: ProviderExtension[]): void {
    this.installedCache = providers;
    mainStorage.setArray(ExtensionKeys.INSTALLED_PROVIDERS, providers);
    void serverProviderStorage.setInstalledProviders(providers);
  }

  getAvailableProviders(author = ''): ProviderExtension[] {
    return mainStorage.getArray<ProviderExtension>(this.scopedKey(ExtensionKeys.AVAILABLE_PROVIDERS, author)) || [];
  }

  setAvailableProviders(author: string, providers: ProviderExtension[]): void {
    mainStorage.setArray(this.scopedKey(ExtensionKeys.AVAILABLE_PROVIDERS, author), providers);
  }

  installProvider(provider: ProviderExtension): void {
    const installed = this.getInstalledProviders();
    const existing = installed.find(p => p.value === provider.value && p.source?.author === provider.source?.author);
    if (existing) {
      existing.version = provider.version;
      existing.source = provider.source;
      existing.lastUpdated = Date.now();
    } else {
      installed.push({ ...provider, installed: true, installedAt: Date.now() });
    }
    this.setInstalledProviders(installed);
  }

  uninstallProvider(providerValue: string, sourceAuthor?: string): void {
    const installed = this.getInstalledProviders();
    this.setInstalledProviders(
      installed.filter(p => {
        if (p.value !== providerValue) return true;
        if (sourceAuthor && p.source?.author !== sourceAuthor) return true;
        return false;
      })
    );
    this.removeProviderModules(providerValue, sourceAuthor);
  }

  getProviderModules(providerValue: string, sourceAuthor?: string): ProviderModule | undefined {
    const fromCache = (author?: string): ProviderModule | undefined => {
      if (author) {
        const exact = this.moduleCache.get(this.moduleKey(providerValue, author));
        if (exact) return exact;
        const unscoped = this.moduleCache.get(this.moduleKey(providerValue));
        if (unscoped && !sourceAuthor) return unscoped;
        return undefined;
      }
      const activeAuthor = this.getProviderSource()?.author;
      if (activeAuthor) {
        const active = this.moduleCache.get(this.moduleKey(providerValue, activeAuthor));
        if (active) return active;
      }
      const scoped = [...this.moduleCache.values()].filter(m => m.value === providerValue);
      if (scoped.length > 0) return scoped.reduce((a, b) => (b.cachedAt > a.cachedAt ? b : a));
      return undefined;
    };

    const cached = fromCache(sourceAuthor);
    if (cached) return cached;

    const allModules = mainStorage.getArray<ProviderModule>(ExtensionKeys.PROVIDER_MODULES) || [];
    const matches = allModules.filter(m => m.value === providerValue);
    if (matches.length === 0) return undefined;

    if (sourceAuthor) {
      const exact = matches.find(m => m.sourceAuthor === sourceAuthor);
      if (exact) return exact;
      return matches.find(m => !m.sourceAuthor);
    }

    const activeAuthor = this.getProviderSource()?.author;
    if (activeAuthor) {
      const activeMatch = matches.find(m => m.sourceAuthor === activeAuthor);
      if (activeMatch) return activeMatch;
    }

    const scoped = matches.filter(m => !!m.sourceAuthor);
    if (scoped.length > 0) return scoped.reduce((a, b) => (b.cachedAt > a.cachedAt ? b : a));
    return matches.reduce((a, b) => (b.cachedAt > a.cachedAt ? b : a));
  }

  cacheProviderModules(modules: ProviderModule): void {
    this.moduleCache.set(this.moduleKey(modules.value, modules.sourceAuthor), modules);
    const allModules = mainStorage.getArray<ProviderModule>(ExtensionKeys.PROVIDER_MODULES) || [];
    const idx = allModules.findIndex(m => m.value === modules.value && (m.sourceAuthor || '') === (modules.sourceAuthor || ''));
    if (idx >= 0) {
      allModules[idx] = modules;
    } else {
      allModules.push(modules);
    }
    mainStorage.setArray(ExtensionKeys.PROVIDER_MODULES, allModules);
    void serverProviderStorage.saveProviderModules(modules);
  }

  removeProviderModules(providerValue: string, sourceAuthor?: string): void {
    for (const [key, mod] of this.moduleCache.entries()) {
      if (mod.value !== providerValue) continue;
      if (sourceAuthor && mod.sourceAuthor !== sourceAuthor) continue;
      this.moduleCache.delete(key);
    }
    const allModules = mainStorage.getArray<ProviderModule>(ExtensionKeys.PROVIDER_MODULES) || [];
    mainStorage.setArray(
      ExtensionKeys.PROVIDER_MODULES,
      allModules.filter(m => {
        if (m.value !== providerValue) return true;
        if (sourceAuthor && m.sourceAuthor !== sourceAuthor) return true;
        return false;
      })
    );
    void serverProviderStorage.deleteProviderModules(providerValue, sourceAuthor);
  }

  async syncSharedFromServer(): Promise<void> {
    await this.syncSharedList(
      () => serverProviderStorage.getInstalledProviders(),
      (list) => serverProviderStorage.setInstalledProviders(list),
      () => mainStorage.getArray<ProviderExtension>(ExtensionKeys.INSTALLED_PROVIDERS) || [],
      (list) => {
        this.installedCache = list;
        mainStorage.setArray(ExtensionKeys.INSTALLED_PROVIDERS, list);
      },
    );

    await this.syncSharedList(
      () => serverProviderStorage.getProviderSources(),
      (list) => serverProviderStorage.setProviderSources(list),
      () => mainStorage.getArray<ProviderSource>(ExtensionKeys.PROVIDER_SOURCES) || [],
      (list) => {
        this.sourcesCache = list;
        mainStorage.setArray(ExtensionKeys.PROVIDER_SOURCES, list);
      },
    );
  }

  private async syncSharedList<T>(
    getServer: () => Promise<T[] | undefined>,
    setServer: (list: T[]) => Promise<boolean>,
    getLocal: () => T[],
    adopt: (list: T[]) => void,
  ): Promise<void> {
    let server: T[] | undefined;
    try {
      server = await getServer();
    } catch {
      server = undefined;
    }

    if (server === undefined) {
      if (!isAdminMode()) return;
      const local = getLocal();
      if (local.length > 0) {
        try { await setServer(local); } catch { /* ignore */ }
      }
      return;
    }

    adopt(server);
  }

  getManifestCache(author?: string): ProviderExtension[] {
    return mainStorage.getArray<ProviderExtension>(this.scopedKey(ExtensionKeys.MANIFEST_CACHE, author)) || [];
  }

  setManifestCache(manifest: ProviderExtension[], author?: string): void {
    mainStorage.setArray(this.scopedKey(ExtensionKeys.MANIFEST_CACHE, author), manifest);
    mainStorage.setNumber(this.scopedKey(ExtensionKeys.LAST_MANIFEST_FETCH, author), Date.now());
  }

  getLastManifestFetch(author?: string): number {
    return mainStorage.getNumber(this.scopedKey(ExtensionKeys.LAST_MANIFEST_FETCH, author)) || 0;
  }

  isManifestCacheExpired(author?: string): boolean {
    return Date.now() - this.getLastManifestFetch(author) > 24 * 60 * 60 * 1000;
  }

  clearAll(): void {
    this.installedCache = null;
    this.sourcesCache = null;
    this.moduleCache.clear();
    mainStorage.delete(ExtensionKeys.INSTALLED_PROVIDERS);
    mainStorage.delete(ExtensionKeys.AVAILABLE_PROVIDERS);
    mainStorage.delete(ExtensionKeys.PROVIDER_MODULES);
    mainStorage.delete(ExtensionKeys.MANIFEST_CACHE);
    mainStorage.delete(ExtensionKeys.LAST_MANIFEST_FETCH);
    mainStorage.delete(ExtensionKeys.PROVIDER_SOURCES);
  }
}

export const extensionStorage = new ExtensionStorage();
