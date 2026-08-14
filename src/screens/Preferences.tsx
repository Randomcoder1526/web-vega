import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import { themes } from '../lib/constants';

const Preferences: React.FC = () => {
  const navigate = useNavigate();
  const { primary, setPrimary } = useThemeStore((s) => s);
  const [customColor, setCustomColor] = useState(() => localStorage.getItem('customColor') || '#FF6347');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const getSetting = (key: string, defaultVal: boolean = false): boolean => {
    try {
      const val = localStorage.getItem(`pref_${key}`);
      return val !== null ? JSON.parse(val) : defaultVal;
    } catch { return defaultVal; }
  };

  const setSetting = (key: string, value: boolean) => {
    localStorage.setItem(`pref_${key}`, JSON.stringify(value));
  };

  const [showMediaControls, setShowMediaControls] = useState(() => getSetting('showMediaControls', true));
  const [hideSeekButtons, setHideSeekButtons] = useState(() => getSetting('hideSeekButtons', false));
  const [enableSwipeGesture, setEnableSwipeGesture] = useState(() => getSetting('enableSwipeGesture', true));
  const [showTabBarLabels, setShowTabBarLabels] = useState(() => getSetting('showTabBarLabels', true));
  const [showHamburgerMenu, setShowHamburgerMenu] = useState(() => getSetting('showHamburgerMenu', true));
  const [showRecentlyWatched, setShowRecentlyWatched] = useState(() => getSetting('showRecentlyWatched', true));

  return (
    <div className="flex-1 min-h-screen bg-surface py-4 md:px-16 md:py-6 animate-fade-in">
      <div className="flex items-center gap-3 mb-8">
        <button onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-xl flex items-center justify-center glass-card hover:bg-white/5 transition-colors active:scale-95"
          aria-label="Go back">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-3">
          <div className="w-1 h-7 rounded-full" style={{ backgroundColor: primary }} />
          <h1 className="text-white text-2xl font-bold tracking-tight">Preferences</h1>
        </div>
      </div>

      {/* Appearance */}
      <section className="mb-6">
        <p className="text-white/30 text-[10px] font-semibold uppercase tracking-widest mb-2.5 px-1">Appearance</p>
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between p-4">
            <span className="text-white/80 text-sm flex-1">Theme</span>
            {showCustomInput ? (
              <div className="flex items-center gap-2">
                <input type="text" value={customColor} onChange={(e) => setCustomColor(e.target.value)}
                  onBlur={() => {
                    if (customColor.length >= 7) {
                      localStorage.setItem('customColor', customColor);
                      setPrimary(customColor);
                    }
                  }}
                  className="text-white text-sm rounded-lg px-2.5 py-1.5 w-24 outline-none glass-card focus:ring-1"
                  style={{ '--tw-ring-color': primary + '40' } as React.CSSProperties}
                  placeholder="#FF0000"
                />
                <button onClick={() => { setShowCustomInput(false); setPrimary('#FF6347'); }}
                  className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
                  aria-label="Cancel custom color">
                  <svg className="w-4 h-4 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <select value={primary}
                onChange={(e) => {
                  if (e.target.value === 'custom') { setShowCustomInput(true); return; }
                  setPrimary(e.target.value);
                }}
                className="text-white text-sm rounded-lg px-2.5 py-1.5 outline-none w-36 glass-card">
                {themes.map((theme) => (
                  <option key={theme.color} value={theme.color} className="bg-elevated text-white">{theme.name}</option>
                ))}
                <option value="custom" className="bg-elevated text-white">Custom</option>
              </select>
            )}
          </div>
        </div>
      </section>

      {/* Player */}
      <section className="mb-6">
        <p className="text-white/30 text-[10px] font-semibold uppercase tracking-widest mb-2.5 px-1">Player</p>
        <div className="glass-card rounded-2xl overflow-hidden divide-y divide-white/5">
          <ToggleRow label="Media Controls" value={showMediaControls}
            onValueChange={(v) => { setShowMediaControls(v); setSetting('showMediaControls', v); }} />
          <ToggleRow label="Hide Seek Buttons" value={hideSeekButtons}
            onValueChange={(v) => { setHideSeekButtons(v); setSetting('hideSeekButtons', v); }} />
          <ToggleRow label="Enable Swipe Gestures" value={enableSwipeGesture}
            onValueChange={(v) => { setEnableSwipeGesture(v); setSetting('enableSwipeGesture', v); }} border={false} />
        </div>
      </section>

      {/* UI */}
      <section className="mb-6">
        <p className="text-white/30 text-[10px] font-semibold uppercase tracking-widest mb-2.5 px-1">UI</p>
        <div className="glass-card rounded-2xl overflow-hidden divide-y divide-white/5">
          <ToggleRow label="Show Tab Bar Labels" value={showTabBarLabels}
            onValueChange={(v) => { setShowTabBarLabels(v); setSetting('showTabBarLabels', v); }} />
          <ToggleRow label="Show Hamburger Menu" value={showHamburgerMenu}
            onValueChange={(v) => { setShowHamburgerMenu(v); setSetting('showHamburgerMenu', v); }} />
          <ToggleRow label="Show Recently Watched" value={showRecentlyWatched}
            onValueChange={(v) => { setShowRecentlyWatched(v); setSetting('showRecentlyWatched', v); }} border={false} />
        </div>
      </section>
    </div>
  );
};

const ToggleRow: React.FC<{
  label: string;
  value: boolean;
  onValueChange: (val: boolean) => void;
  border?: boolean;
}> = ({ label, value, onValueChange, border = true }) => (
  <div className={`flex items-center justify-between p-4 ${border ? '' : ''}`}>
    <span className="text-white/80 text-sm flex-1">{label}</span>
    <button onClick={() => onValueChange(!value)}
      className="relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-200"
      style={{ backgroundColor: value ? primary : 'rgba(255,255,255,0.1)' }}
      aria-label={`${label} toggle`}
      role="switch"
      aria-checked={value}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 shadow-sm ${
        value ? 'translate-x-6' : 'translate-x-1'
      }`} />
    </button>
  </div>
);

export default Preferences;
