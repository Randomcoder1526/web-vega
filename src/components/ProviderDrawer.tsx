import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useContentStore } from '../store/contentStore';
import { useThemeStore } from '../store/themeStore';
import type { ProviderExtension } from '../types';

interface ProviderDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProvider: (provider: ProviderExtension) => void;
}

const ProviderDrawer: React.FC<ProviderDrawerProps> = ({ isOpen, onClose, onSelectProvider }) => {
  const navigate = useNavigate();
  const { primary } = useThemeStore((s) => s);
  const { installedProviders, provider: activeProvider, setProvider: setActiveProvider } = useContentStore((s) => s);

  const handleSelect = (p: ProviderExtension) => {
    setActiveProvider(p);
    onSelectProvider(p);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity animate-fade-in"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 left-0 bottom-0 z-50 w-72 bg-surface border-r border-white/5 shadow-2xl animate-slide-in-from-left">
        {/* Header */}
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-white font-semibold text-lg tracking-tight">Providers</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
              aria-label="Close drawer"
            >
              <svg className="w-4 h-4 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-white/30 text-xs">Select a provider to browse</p>
        </div>

        {/* Provider List */}
        <div className="overflow-y-auto flex-1 p-2" style={{ maxHeight: 'calc(100vh - 140px)' }}>
          {installedProviders.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center glass-card">
                <svg className="w-8 h-8 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <p className="text-white/40 text-sm">No providers installed</p>
              <button
                onClick={() => { navigate('/extensions'); onClose(); }}
                className="mt-3 px-4 py-2 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:scale-105 active:scale-95"
                style={{ backgroundColor: primary, boxShadow: `0 4px 12px ${primary}30` }}
              >
                Install Provider
              </button>
            </div>
          ) : (
            <div className="space-y-0.5">
              {installedProviders.map((p) => {
                const isActive = activeProvider?.value === p.value && activeProvider?.source?.author === p.source?.author;
                return (
                  <button
                    key={`${p.source?.author}:${p.value}`}
                    onClick={() => handleSelect(p)}
                    className={`w-full text-left px-3 py-3 rounded-xl flex items-center gap-3 transition-all duration-200 ${
                      isActive ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    {p.icon ? (
                      <img src={p.icon} alt="" className="w-9 h-9 rounded-lg border border-white/8 object-cover" />
                    ) : (
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold border border-white/8"
                        style={{ backgroundColor: isActive ? primary + '20' : 'rgba(255,255,255,0.04)', color: isActive ? primary : 'rgba(255,255,255,0.3)' }}
                      >
                        {p.display_name?.[0] || '?'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${isActive ? 'text-white' : 'text-white/60'}`}>
                        {p.display_name}
                      </p>
                      <p className="text-white/25 text-xs capitalize">{p.type || 'global'}</p>
                    </div>
                    {isActive && (
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: primary }} />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-white/5 bg-surface">
          <button
            onClick={() => { navigate('/extensions'); onClose(); }}
            className="w-full py-2.5 rounded-xl text-sm font-medium glass-card hover:bg-white/[0.03] transition-colors flex items-center justify-center gap-2 text-white/50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Manage Providers
          </button>
        </div>
      </div>
    </>
  );
};

export default ProviderDrawer;
