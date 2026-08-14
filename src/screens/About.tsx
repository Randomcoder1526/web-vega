import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import { socialLinks } from '../lib/constants';

const About: React.FC = () => {
  const navigate = useNavigate();
  const { primary } = useThemeStore((s) => s);

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
        <h1 className="text-white text-2xl font-bold tracking-tight">About</h1>
      </div>

      <div className="space-y-4">
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold"
              style={{ backgroundColor: primary, color: 'white', boxShadow: `0 4px 16px ${primary}30` }}>
              V
            </div>
            <div>
              <h2 className="text-white text-xl font-bold">Vega</h2>
              <p className="text-white/35 text-sm">Streaming Media App</p>
            </div>
          </div>
          <div className="space-y-0">
            <div className="flex justify-between py-3 border-b border-white/5">
              <span className="text-white/40 text-sm">Version</span>
              <span className="text-white/80 text-sm font-medium">1.0.0 (Web)</span>
            </div>
            <div className="flex justify-between py-3 border-b border-white/5">
              <span className="text-white/40 text-sm">Platform</span>
              <span className="text-white/80 text-sm font-medium">Web Browser</span>
            </div>
            <div className="flex justify-between py-3">
              <span className="text-white/40 text-sm">Framework</span>
              <span className="text-white/80 text-sm font-medium">React + Vite</span>
            </div>
          </div>
        </div>

        <div className="glass-card rounded-2xl overflow-hidden">
          <a href={socialLinks.github} target="_blank" rel="noopener"
            className="flex items-center justify-between p-4 hover:bg-white/[0.03] transition-colors border-b border-white/5">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-white/70" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              <span className="text-white/80 text-sm font-medium">GitHub Repository</span>
            </div>
            <svg className="w-4 h-4 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
          <a href={socialLinks.discord} target="_blank" rel="noopener"
            className="flex items-center justify-between p-4 hover:bg-white/[0.03] transition-colors">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-[#5865F2]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z" />
              </svg>
              <span className="text-white/80 text-sm font-medium">Discord Community</span>
            </div>
            <svg className="w-4 h-4 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>

        <p className="text-white/20 text-xs text-center mt-6">
          Vega is an open-source streaming media app.
          <br />All content is provided by third-party extensions.
        </p>
      </div>
    </div>
  );
};

export default About;
