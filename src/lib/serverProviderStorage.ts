import type { ProviderExtension, ProviderModule, ProviderSource } from '../types';

const SERVER_BASE = '/vega-server';

let adminMode = false;

export const setAdminMode = (value: boolean): void => {
  adminMode = value;
};

export const isAdminMode = (): boolean => adminMode;

async function request<T>(path: string, init?: RequestInit): Promise<T | undefined> {
  try {
    const res = await fetch(`${SERVER_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

export const serverProviderStorage = {
  async saveProviderModules(modules: ProviderModule): Promise<boolean> {
    if (!isAdminMode()) return false;
    const res = await request<{ ok: boolean }>('/provider', {
      method: 'POST',
      body: JSON.stringify(modules),
    });
    return !!res?.ok;
  },

  async deleteProviderModules(value: string, sourceAuthor?: string): Promise<void> {
    if (!isAdminMode()) return;
    const author = encodeURIComponent(sourceAuthor || 'default');
    const val = encodeURIComponent(value);
    await request(`/provider/${author}/${val}`, { method: 'DELETE' });
  },

  async loadProviderModules(value: string, sourceAuthor?: string): Promise<ProviderModule | undefined> {
    const author = encodeURIComponent(sourceAuthor || 'default');
    const val = encodeURIComponent(value);
    return request<ProviderModule>(`/provider/${author}/${val}`);
  },

  async getInstalledProviders(): Promise<ProviderExtension[] | undefined> {
    return request<ProviderExtension[]>('/installed');
  },

  async setInstalledProviders(installed: ProviderExtension[]): Promise<boolean> {
    if (!isAdminMode()) return false;
    const res = await request<{ ok: boolean }>('/installed', {
      method: 'POST',
      body: JSON.stringify({ installed }),
    });
    return !!res?.ok;
  },

  async getProviderSources(): Promise<ProviderSource[] | undefined> {
    return request<ProviderSource[]>('/sources');
  },

  async setProviderSources(sources: ProviderSource[]): Promise<boolean> {
    if (!isAdminMode()) return false;
    const res = await request<{ ok: boolean }>('/sources', {
      method: 'POST',
      body: JSON.stringify({ sources }),
    });
    return !!res?.ok;
  },
};
