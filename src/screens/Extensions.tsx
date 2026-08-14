import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import { useContentStore } from '../store/contentStore';
import { extensionStorage } from '../lib/extensionStorage';
import { extensionManager } from '../lib/extensionManager';
import { isAdminMode } from '../lib/serverProviderStorage';
import { createProviderSource } from '../lib/helpers';
import { socialLinks } from '../lib/constants';
import type { ProviderExtension, ProviderSource } from '../types';

const Extensions: React.FC = () => {
  const navigate = useNavigate();
  const { primary } = useThemeStore((s) => s);
  const { provider: activeProvider, setProvider: setActiveProvider, installedProviders, setInstalledProviders } = useContentStore((s) => s);
  const isAdmin = isAdminMode();

  const [activeTab, setActiveTab] = useState<'installed' | 'available'>('installed');
  const [availableProviders, setAvailableProviders] = useState<ProviderExtension[]>([]);
  const [installingProvider, setInstallingProvider] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sources, setSources] = useState<ProviderSource[]>([]);
  const [activeSourceAuthor, setActiveSourceAuthor] = useState('');
  const [showAddSource, setShowAddSource] = useState(false);
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
    const init = async () => {
      try {
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

  const currentData = activeTab === 'installed'
    ? installedProviders.filter((p) => p && p.value)
    : availableProviders.filter((p) => p && p.value);

  return (
    <div className="flex-1 min-h-screen bg-surface py-4 md:px-16 md:py-6 animate-fade-in">
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl text-sm font-medium text-white shadow-xl animate-fade-in-down ${
          toast.type === 'success' ? 'bg-success/90' : 'bg-error/90'
        }`} style={{ backdropFilter: 'blur(12px)' }}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate('/settings')}
          className="w-9 h-9 rounded-xl flex items-center justify-center glass-card hover:bg-white/5 transition-colors active:scale-95"
          aria-label="Go back">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-white text-lg font-semibold tracking-tight">Providers</h1>
        <button onClick={() => refreshProviders(activeSourceAuthor)}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 hover:bg-white/5 active:scale-95"
          style={{ backgroundColor: primary + '12' }}
          aria-label="Refresh providers">
          <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke={primary}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex glass-card rounded-xl p-1 mb-5">
        <button onClick={() => setActiveTab('installed')}
          className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200"
          style={{
            backgroundColor: activeTab === 'installed' ? primary : 'transparent',
            color: activeTab === 'installed' ? 'white' : 'rgba(255,255,255,0.35)',
            boxShadow: activeTab === 'installed' ? `0 2px 8px ${primary}30` : 'none',
          }}>
          Installed ({installedProviders.length})
        </button>
        <button onClick={() => setActiveTab('available')}
          className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200"
          style={{
            backgroundColor: activeTab === 'available' ? primary : 'transparent',
            color: activeTab === 'available' ? 'white' : 'rgba(255,255,255,0.35)',
            boxShadow: activeTab === 'available' ? `0 2px 8px ${primary}30` : 'none',
          }}>
          Available ({availableProviders.length})
        </button>
      </div>

      {/* Source Manager */}
      {activeTab === 'available' && (
        <div className="mb-5">
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-xl px-3 py-2.5 glass-card">
              <p className="text-white/30 text-[10px] font-semibold uppercase tracking-wider mb-1">Provider Source</p>
              <select
                value={activeSourceAuthor}
                onChange={(e) => {
                  const src = sources.find((s) => s.author === e.target.value);
                  if (src) handleSelectSource(src);
                }}
                className="bg-transparent text-white text-sm w-full outline-none"
              >
                {sources.length === 0 && <option value="">No sources configured</option>}
                {sources.map((s) => (
                  <option key={s.author} value={s.author} className="bg-elevated text-white">{s.author}</option>
                ))}
              </select>
            </div>
            <button onClick={() => setShowAddSource(true)}
              disabled={!isAdmin}
              className="w-11 h-11 rounded-xl flex items-center justify-center text-white transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
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
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setShowAddSource(false); setSourceInput(''); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white/60 glass-card hover:bg-white/5 transition-colors">
                Cancel
              </button>
              <button onClick={handleAddSource}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:scale-105 active:scale-95"
                style={{ backgroundColor: primary, boxShadow: `0 4px 12px ${primary}30` }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Provider List */}
      <div className="space-y-2.5">
        {currentData.map((item, i) => {
          const itemKey = `${item.source?.author}:${item.value}`;
          const isActive = activeProvider?.value === item.value && activeProvider?.source?.author === item.source?.author;
          const isInstalling = installingProvider === itemKey;

          return (
            <div key={itemKey}
              className="glass-card rounded-2xl p-4 transition-all duration-200 hover:bg-white/[0.02] animate-fade-in-up"
              style={{ animationDelay: `${i * 40}ms` }}>
              <div className="flex items-center gap-3.5">
                {item.icon ? (
                  <img src={item.icon} alt="" className="w-11 h-11 rounded-xl border border-white/10" />
                ) : (
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-lg font-bold glass-card"
                    style={{ color: primary }}>
                    {item.display_name?.[0] || '?'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-white text-sm font-semibold truncate">{item.display_name}</p>
                    <span className="text-white/25 text-[10px]">v{item.version}</span>
                  </div>
                  <p className="text-white/30 text-xs capitalize mt-0.5">{item.type}</p>
                </div>
                <div className="flex gap-2">
                  {activeTab === 'installed' ? (
                    <>
                      <button
                        onClick={() => setActiveProvider(item)}
                        className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95"
                        style={{
                          backgroundColor: isActive ? '#22c55e18' : 'rgba(255,255,255,0.04)',
                          border: `1.5px solid ${isActive ? '#22c55e' : 'rgba(255,255,255,0.08)'}`,
                        }}
                        aria-label={isActive ? 'Currently active' : 'Set as active'}
                      >
                        {isActive ? (
                          <svg className="w-4 h-4" fill="#22c55e" viewBox="0 0 24 24">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-white/25" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <circle cx="12" cy="12" r="9" strokeWidth="2" />
                          </svg>
                        )}
                      </button>
                      <button onClick={() => handleUninstallProvider(item)}
                        disabled={!isAdmin}
                        className="w-9 h-9 rounded-xl flex items-center justify-center bg-error/10 border border-error/20 transition-all duration-200 hover:bg-error/20 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="Uninstall provider">
                        <svg className="w-4 h-4 text-error/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleInstallProvider(item)}
                      disabled={isInstalling || !isAdmin}
                      className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: isInstalling ? 'rgba(255,255,255,0.06)' : primary,
                        boxShadow: isInstalling ? 'none' : `0 2px 8px ${primary}30`,
                      }}
                      aria-label="Install provider"
                    >
                      {isInstalling ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {currentData.length === 0 && (
        <div className="text-center py-20 animate-fade-in">
          <div className="w-20 h-20 mx-auto mb-5 rounded-2xl flex items-center justify-center glass-card">
            <svg className="w-10 h-10 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <p className="text-white/40 text-base">{activeTab === 'installed' ? 'No providers installed' : 'No providers available'}</p>
          <p className="text-white/20 text-sm mt-1">{activeTab === 'installed' ? 'Install from the Available tab' : 'Pull to refresh or add a source'}</p>
        </div>
      )}
    </div>
  );
};

export default Extensions;
