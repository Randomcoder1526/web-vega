import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import { useWatchHistoryStore } from '../store/watchHistoryStore';
import { useWatchListStore } from '../store/watchListStore';

const Settings: React.FC = () => {
  const navigate = useNavigate();
  const { primary } = useThemeStore((s) => s);
  const { clearHistory } = useWatchHistoryStore((s) => s);
  const { clearList } = useWatchListStore((s) => s);
  const [tapCount, setTapCount] = useState(0);

  const handleVersionTap = () => {
    const newCount = tapCount + 1;
    setTapCount(newCount);
    if (newCount >= 5) {
      setTapCount(0);
      navigate('/admin');
    }
  };

  return (
    <div className="flex-1 min-h-screen bg-surface px-4 py-4 md:px-16 md:py-6 animate-fade-in">
      <h1 className="text-white text-2xl font-bold mb-8 tracking-tight">Settings</h1>

      {/* Navigation */}
      <section className="mb-8">
        <h2 className="text-white/50 text-xs font-semibold uppercase tracking-widest mb-3 px-1">Navigation</h2>
        <div className="glass-card rounded-2xl overflow-hidden divide-y divide-white/5">
          <SettingsRow
            icon={
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            label="Watch History"
            onClick={() => navigate('/watchhistory')}
          />
          <SettingsRow
            icon={
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
            }
            label="Watch List"
            onClick={() => navigate('/watchlist')}
            border={false}
          />
          <SettingsRow
            icon={
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v3m0 12v3M3 12h3m12 0h3M5.64 5.64l2.12 2.12m8.48 8.48l2.12 2.12m0-12.72l-2.12 2.12m-8.48 8.48l-2.12 2.12" />
              </svg>
            }
            label="Content Sources"
            onClick={() => navigate('/extensions')}
            border={false}
          />
        </div>
      </section>

      {/* Data */}
      <section className="mb-8">
        <h2 className="text-white/50 text-xs font-semibold uppercase tracking-widest mb-3 px-1">Data</h2>
        <div className="glass-card rounded-2xl overflow-hidden divide-y divide-white/5">
          <SettingsRow
            icon={
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            }
            label="Clear Cache"
            onClick={() => { if (confirm('Clear all cache?')) { const keys = Object.keys(localStorage); keys.forEach(k => { if (k.startsWith('vega_')) localStorage.removeItem(k); }); window.location.reload(); } }}
          />
          <SettingsRow
            icon={
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            }
            label="Clear Watch History"
            onClick={() => { if (confirm('Clear all watch history?')) clearHistory(); }}
            danger
          />
          <SettingsRow
            icon={
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
            }
            label="Clear Watch List"
            onClick={() => { if (confirm('Clear watch list?')) clearList(); }}
            danger
            border={false}
          />
        </div>
      </section>

      {/* Version (hidden admin access) */}
      <section className="mb-8">
        <div className="text-center">
          <p
            className="text-white/20 text-xs cursor-pointer select-none"
            onClick={handleVersionTap}
          >
            Vega v1.0.0
          </p>
        </div>
      </section>
    </div>
  );
};

const SettingsRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  border?: boolean;
}> = ({ icon, label, onClick, danger = false, border = true }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3.5 p-4 text-left transition-colors hover:bg-white/[0.03] ${border ? '' : ''}`}
  >
    <span className={danger ? 'text-error/70' : 'text-white/40'}>{icon}</span>
    <span className={`flex-1 text-sm font-medium ${danger ? 'text-error/80' : 'text-white/80'}`}>{label}</span>
    <svg className="w-4 h-4 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  </button>
);

export default Settings;
