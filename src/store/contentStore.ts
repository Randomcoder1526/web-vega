import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { extensionStorage } from '../lib/extensionStorage';
import type { ProviderExtension } from '../types';

interface Content {
  provider: ProviderExtension;
  setProvider: (provider: ProviderExtension) => void;
  installedProviders: ProviderExtension[];
  availableProviders: ProviderExtension[];
  setInstalledProviders: (providers: ProviderExtension[]) => void;
  setAvailableProviders: (providers: ProviderExtension[]) => void;
}

const defaultProvider: ProviderExtension = {
  value: '',
  display_name: '',
  type: 'global',
  installed: false,
  disabled: false,
  version: '0.0.1',
  icon: '',
  source: { author: '', url: '' },
};

export const useContentStore = create<Content>()(
  persist(
    (set) => ({
      provider: defaultProvider,
      installedProviders: extensionStorage
        .getInstalledProviders()
        .sort((a, b) => a.display_name.localeCompare(b.display_name)),
      availableProviders: [],
      setProvider: (provider: ProviderExtension) => set({ provider }),
      setInstalledProviders: (providers: ProviderExtension[]) =>
        set({
          installedProviders: providers.sort((a, b) =>
            a.display_name.localeCompare(b.display_name),
          ),
        }),
      setAvailableProviders: (providers: ProviderExtension[]) =>
        set({ availableProviders: providers }),
    }),
    {
      name: 'content-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        provider: state.provider,
      }),
    },
  ),
);
