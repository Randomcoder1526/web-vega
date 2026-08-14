import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import { useContentStore } from '../store/contentStore';
import { extensionStorage } from '../lib/extensionStorage';
import { extensionManager } from '../lib/extensionManager';
import { setAdminMode } from '../lib/serverProviderStorage';
import { createProviderSource } from '../lib/helpers';
import { socialLinks } from '../lib/constants';
import type { ProviderExtension, ProviderSource } from '../types';

const Admin: React.FC = () => {
  const navigate = useNavigate();
  const { primary } = useThemeStore((s) => s);
  const { provider: activeProvider, setProvider: setActiveProvider, installedProviders, setInstalledProviders } = useContentStore((s) => s);

  const [activeSection, setActiveSection] = useState<'providers' | 'preferences'>('providers');

  const [activeTab, setActiveTab] = useState<'installed' | 'available'>('installed');
  const [availableProviders, setAvailableProviders] = useState<ProviderExtension[]>([]);
  const [installingProvider, setInstallingProvider] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sources, setSources] = useState<ProviderSource[]>([]);
  const [activeSourceAuthor, setActiveSourceAuthor] = useState('');
  const [showAddSource, setShowAddSource] = useState(false);
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [sourceInput, setSourceInput] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const reloadProviders = useCallback((author?: string) => {
    const selectedAuthor = author || extensionStorage.getProviderSource()?.author || '';
    setInstalledProviders(extensionStorage.getInstalledProviders());
    setAvailableProviders((selectedAuthor ? extensionStorage.getAvailableProviders(selectedAuthor) : []).filter((p) => p && !p.disabled));
    setActiveSourceAuthor(selectedAuthor);
  }, [setInstalledProviders]);

  useEffect(() => {
    setAdminMode(true);
    const init = async () => {
      try {
        await extensionStorage.syncSharedFromServer();
        await extensionManager.initialize();
        const source = extensionStorage.getProviderSource();
        const author = source?.author || '';
        setActiveSourceAuthor(author);
        reloadProviders(author);
        const currentSources = extensionStorage.getProviderSources();
        setSources(currentSources);
        if (author && availableProviders.length === 0) {
          await refreshProviders(author);
        }
      } catch {
        reloadProviders();
      }
    };
    init();
    return () => setAdminMode(false);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-source-dropdown]')) {
        setShowSourceDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const refreshProviders = async (sourceAuthor: string) => {
    setRefreshing(true);
    try {
      const source = extensionStorage.getProviderSources().find((s) => s.author === sourceAuthor);
      if (!source) { setAvailableProviders([]); return; }
      const providers = await extensionManager.fetchManifest(source, true);
      setAvailableProviders(providers);
      reloadProviders(sourceAuthor);
    } catch { showToast('Failed to refresh providers', 'error'); }
    finally { setRefreshing(false); }
  };

  const handleInstallProvider = async (provider: ProviderExtension) => {
    const key = `${provider.source?.author}:${provider.value}`;
    setInstallingProvider(key);
    try {
      await extensionManager.installProvider(provider);
      reloadProviders();
      showToast(`${provider.display_name} installed!`);
      setInstalledProviders(extensionStorage.getInstalledProviders());
      if (!activeProvider || activeProvider.value !== provider.value) {
        setActiveProvider(provider);
      }
    } catch { showToast('Failed to install provider', 'error'); }
    finally { setInstallingProvider(null); }
  };

  const handleUninstallProvider = (provider: ProviderExtension) => {
    if (!confirm(`Remove ${provider.display_name}?`)) return;
    extensionStorage.uninstallProvider(provider.value, provider.source?.author);
    reloadProviders();
    setInstalledProviders(extensionStorage.getInstalledProviders());
    if (activeProvider?.value === provider.value) {
      const remaining = extensionStorage.getInstalledProviders();
      if (remaining.length > 0) setActiveProvider(remaining[0]);
      else setActiveProvider({ value: '', display_name: '', source: { author: '', url: '' }, type: 'global', version: '', icon: '', disabled: false, installed: false });
    }
    showToast(`${provider.display_name} removed`);
  };

  const handleAddSource = async () => {
    try {
      const parsed = createProviderSource(sourceInput);
      extensionStorage.addProviderSources(parsed.author, parsed.url);
      extensionStorage.setDefaultProviderSource(parsed.author);
      setSourceInput('');
      setShowAddSource(false);
      setSources(extensionStorage.getProviderSources());
      setActiveSourceAuthor(parsed.author);
      reloadProviders(parsed.author);
      await refreshProviders(parsed.author);
      showToast(`Source "${parsed.author}" added!`);
    } catch { showToast('Invalid source URL or author', 'error'); }
  };

  const handleSelectSource = async (source: ProviderSource) => {
    extensionStorage.setDefaultProviderSource(source.author);
    setSources(extensionStorage.getProviderSources());
    setActiveSourceAuthor(source.author);
    reloadProviders(source.author);
    await refreshProviders(source.author);
  };

  const handleRemoveSource = (author: string) => {
    if (sources.length <= 1) { showToast('At least one source must remain', 'error'); return; }
    if (!confirm(`Remove source "${author}"?`)) return;
    extensionStorage.getInstalledProviders()
      .filter((p) => p.source?.author === author)
      .forEach((p) => extensionStorage.uninstallProvider(p.value, author));
    extensionStorage.removeProviderSource(author);
    setSources(extensionStorage.getProviderSources());
    const newDefault = extensionStorage.getProviderSource();
    setActiveSourceAuthor(newDefault?.author || '');
    reloadProviders(newDefault?.author);
  };

  const currentProviderData = activeTab === 'installed'
    ? installedProviders.filter((p) => p && p.value)
    : availableProviders.filter((p) => p && p.value).sort((a, b) => {
        const aInstalled = installedProviders.some((p) => p.value === a.value && p.source?.author === a.source?.author) ? 0 : 1;
        const bInstalled = installedProviders.some((p) => p.value === b.value && p.source?.author === b.source?.author) ? 0 : 1;
        return aInstalled - bInstalled;
      });

  const sections = [
    { key: 'providers', label: 'Providers', icon: '📦' },
    { key: 'preferences', label: 'Preferences', icon: '⚙️' },
  ] as const;

  return (
    <div className="flex-1 min-h-screen bg-surface py-4 px-4 md:py-6 animate-fade-in">
      <div className="max-w-4xl mx-auto">
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl text-sm font-medium text-white shadow-xl animate-fade-in-down ${
          toast.type === 'success' ? 'bg-success/90' : 'bg-error/90'
        }`} style={{ backdropFilter: 'blur(12px)' }}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-1 h-7 rounded-full" style={{ backgroundColor: primary }} />
        <h1 className="text-white text-2xl font-bold tracking-tight">Admin Panel</h1>
      </div>

      {/* Providers Section */}
      {activeSection === 'providers' && (
        <div className="space-y-5 animate-fade-in">
          {/* Tabs */}
          <div className="flex gap-2 w-fit">
            <button onClick={() => setActiveTab('installed')}
              className="px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200"
              style={{
                backgroundColor: activeTab === 'installed' ? primary : 'rgba(255,255,255,0.04)',
                color: activeTab === 'installed' ? 'white' : 'rgba(255,255,255,0.35)',
                boxShadow: activeTab === 'installed' ? `0 2px 8px ${primary}30` : 'none',
              }}>
              Installed ({installedProviders.length})
            </button>
            <button onClick={() => setActiveTab('available')}
              className="px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200"
              style={{
                backgroundColor: activeTab === 'available' ? primary : 'rgba(255,255,255,0.04)',
                color: activeTab === 'available' ? 'white' : 'rgba(255,255,255,0.35)',
                boxShadow: activeTab === 'available' ? `0 2px 8px ${primary}30` : 'none',
              }}>
              Available ({availableProviders.length})
            </button>
          </div>

          {/* Source Manager */}
          {activeTab === 'available' && (
            <div>
              <div className="flex items-center gap-2">
                <div className="flex-1 relative" data-source-dropdown>
                  <div className="rounded-xl px-3 py-2.5 glass-card">
                    <p className="text-white/30 text-[10px] font-semibold uppercase tracking-wider mb-1">Provider Source</p>
                    <button
                      onClick={() => setShowSourceDropdown(!showSourceDropdown)}
                      className="flex items-center justify-between w-full text-left"
                    >
                      <span className="text-white text-sm truncate">{activeSourceAuthor || 'Select source'}</span>
                      <svg className={`w-4 h-4 text-white/40 transition-transform duration-200 ${showSourceDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                  {showSourceDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 rounded-xl glass-card border border-white/10 z-50 overflow-hidden animate-fade-in">
                      {sources.length === 0 ? (
                        <div className="px-3 py-2.5 text-white/30 text-sm">No sources configured</div>
                      ) : (
                        sources.map((s) => (
                          <button
                            key={s.author}
                            onClick={() => {
                              handleSelectSource(s);
                              setShowSourceDropdown(false);
                            }}
                            className={`w-full px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/5 ${
                              activeSourceAuthor === s.author ? 'text-white bg-white/5' : 'text-white/70'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {activeSourceAuthor === s.author && (
                                <div className="w-1.5 h-1.5 rounded-full bg-success" />
                              )}
                              {s.author}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <button onClick={() => refreshProviders(activeSourceAuthor)}
                  className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-200 hover:bg-white/5 active:scale-95"
                  style={{ backgroundColor: primary + '12' }}
                  aria-label="Refresh providers">
                  <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke={primary}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
                {sources.length > 1 && (
                  <button onClick={() => handleRemoveSource(activeSourceAuthor)}
                    className="w-11 h-11 rounded-xl flex items-center justify-center bg-error/10 border border-error/20 transition-all duration-200 hover:bg-error/20 active:scale-95"
                    aria-label="Remove source">
                    <svg className="w-4 h-4 text-error/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
                <button onClick={() => setShowAddSource(true)}
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-white transition-all duration-200 hover:scale-105 active:scale-95"
                  style={{ backgroundColor: primary, boxShadow: `0 4px 12px ${primary}30` }}
                  aria-label="Add source">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Add Source Modal */}
          {showAddSource && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-fade-in"
              onClick={() => { setShowAddSource(false); setSourceInput(''); }}>
              <div className="glass-card rounded-2xl p-5 w-[90%] max-w-md animate-scale-in" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-bold">Add Source</h3>
                  <button onClick={() => { setShowAddSource(false); setSourceInput(''); }}
                    className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
                    aria-label="Close">
                    <svg className="w-4 h-4 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className="text-white/70 text-sm font-medium mb-1">Enter source name or URL</p>
                <p className="text-white/30 text-xs mb-3">
                  Check <a href={socialLinks.github + '#vega-app'} target="_blank" rel="noopener" className="text-info hover:underline">GitHub</a> or join <a href={socialLinks.discord} target="_blank" rel="noopener" className="text-info hover:underline">Discord</a>
                </p>
                <input
                  type="text"
                  value={sourceInput}
                  onChange={(e) => setSourceInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddSource()}
                  placeholder="GitHub author or URL"
                  className="w-full px-3.5 py-2.5 rounded-xl glass-card text-white text-sm placeholder-white/20 outline-none focus:ring-1 transition-all duration-200"
                  style={{ '--tw-ring-color': primary + '40' } as React.CSSProperties}
                  autoFocus
                />
                {sourceInput && sources.some((s) => s.author.toLowerCase() === sourceInput.trim().toLowerCase() || s.url.toLowerCase() === sourceInput.trim().toLowerCase()) && (
                  <div className="flex items-center gap-2 mt-2 text-success/80 text-xs">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                    </svg>
                    Already downloaded
                  </div>
                )}
                <div className="flex gap-2 mt-4">
                  <button onClick={() => { setShowAddSource(false); setSourceInput(''); }}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white/60 glass-card hover:bg-white/5 transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleAddSource}
                    disabled={!sourceInput.trim() || sources.some((s) => s.author.toLowerCase() === sourceInput.trim().toLowerCase() || s.url.toLowerCase() === sourceInput.trim().toLowerCase())}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                    style={{ backgroundColor: primary, boxShadow: `0 4px 12px ${primary}30` }}>
                    Confirm
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Provider List */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {currentProviderData.map((item, i) => {
              const itemKey = `${item.source?.author}:${item.value}`;
              const isActive = activeProvider?.value === item.value && activeProvider?.source?.author === item.source?.author;
              const isInstalling = installingProvider === itemKey;

              return (
                <div key={itemKey}
                  className="glass-card rounded-2xl p-4 transition-all duration-200 hover:bg-white/[0.02] animate-fade-in-up flex flex-col"
                  style={{ animationDelay: `${i * 40}ms` }}>
                  <div className="flex items-center gap-3 mb-3">
                    {item.icon ? (
                      <img src={item.icon} alt="" className="w-12 h-12 rounded-xl border border-white/10" />
                    ) : (
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold glass-card shrink-0"
                        style={{ color: primary }}>
                        {item.display_name?.[0] || '?'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-semibold truncate">{item.display_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-white/25 text-[10px]">v{item.version}</span>
                        <span className="text-white/20 text-[10px]">•</span>
                        <span className="text-white/30 text-[10px] capitalize">{item.type}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-auto">
                    {activeTab === 'installed' ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => setActiveProvider(item)}
                          className="flex-1 py-2 rounded-xl text-xs font-medium transition-all duration-200 hover:scale-[1.02] active:scale-95"
                          style={{
                            backgroundColor: isActive ? '#22c55e18' : 'rgba(255,255,255,0.04)',
                            border: `1.5px solid ${isActive ? '#22c55e' : 'rgba(255,255,255,0.08)'}`,
                            color: isActive ? '#22c55e' : 'rgba(255,255,255,0.5)',
                          }}
                        >
                          {isActive ? 'Active' : 'Set Active'}
                        </button>
                        <button onClick={() => handleUninstallProvider(item)}
                          className="w-9 h-9 rounded-xl flex items-center justify-center bg-error/10 border border-error/20 transition-all duration-200 hover:bg-error/20 active:scale-95"
                          aria-label="Uninstall provider">
                          <svg className="w-4 h-4 text-error/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      installedProviders.some((p) => p.value === item.value && p.source?.author === item.source?.author) ? (
                        <div className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-success/10 border border-success/20">
                          <svg className="w-3.5 h-3.5 text-success/80" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                          </svg>
                          <span className="text-success/80 text-xs font-medium">Installed</span>
                        </div>
                      ) : (
                      <button
                        onClick={() => handleInstallProvider(item)}
                        disabled={isInstalling}
                        className="w-full py-2 rounded-xl text-xs font-medium text-white transition-all duration-200 hover:scale-[1.02] active:scale-95"
                        style={{
                          backgroundColor: isInstalling ? 'rgba(255,255,255,0.06)' : primary,
                          boxShadow: isInstalling ? 'none' : `0 2px 8px ${primary}30`,
                        }}
                        aria-label="Install provider"
                      >
                        {isInstalling ? (
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
                        ) : (
                          'Install'
                        )}
                      </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {currentProviderData.length === 0 && (
            <div className="text-center py-16 animate-fade-in">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center glass-card">
                <svg className="w-8 h-8 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <p className="text-white/40 text-sm">{activeTab === 'installed' ? 'No providers installed' : 'No providers available'}</p>
              <p className="text-white/20 text-xs mt-1">{activeTab === 'installed' ? 'Install from the Available tab' : 'Pull to refresh or add a source'}</p>
            </div>
          )}
        </div>
      )}

      </div>
    </div>
  );
};

export default Admin;
