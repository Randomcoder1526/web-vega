import axios from 'axios';
import { extensionStorage } from './extensionStorage';
import { extensionManager } from './extensionManager';
import type { ProviderExtension } from '../types';

async function proxyGet(url: string, timeout = 10000) {
  if (/^https?:\/\//.test(url)) {
    return axios.get(`/vega-proxy?url=${encodeURIComponent(url)}`, { timeout });
  }
  return axios.get(url, { timeout });
}

export interface UpdateInfo {
  provider: ProviderExtension;
  currentVersion: string;
  latestVersion: string;
  sourceUrl: string;
}

const checkForUpdates = async (): Promise<UpdateInfo[]> => {
  const installed = extensionStorage.getInstalledProviders();
  const updates: UpdateInfo[] = [];

  for (const provider of installed) {
    if (!provider.source) continue;

    try {
      const manifestUrl = `${provider.source.url}/manifest.json`;
      const response = await proxyGet(manifestUrl, 10000);
      const manifest: ProviderExtension[] = response.data;

      const latest = manifest.find((m) => m.value === provider.value);
      if (!latest) continue;

      if (latest.version && latest.version !== provider.version) {
        updates.push({
          provider: latest,
          currentVersion: provider.version,
          latestVersion: latest.version,
          sourceUrl: provider.source.url,
        });
      }
    } catch {
      // Skip providers whose source is unreachable
    }
  }

  return updates;
};

const updateProviders = async (
  updates: UpdateInfo[],
  onProgress?: (completed: number, total: number, current: ProviderExtension) => void,
): Promise<{ success: ProviderExtension[]; failed: string[] }> => {
  const success: ProviderExtension[] = [];
  const failed: string[] = [];

  for (let i = 0; i < updates.length; i++) {
    const update = updates[i];
    onProgress?.(i, updates.length, update.provider);

    try {
      await extensionManager.updateProvider(update.provider);
      success.push(update.provider);
    } catch {
      failed.push(update.provider.display_name);
    }
  }

  return { success, failed };
};

export const updateProvidersService = {
  checkForUpdates,
  updateProviders,
};
