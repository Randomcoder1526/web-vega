import React, { useCallback, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';

const navItems = [
  { to: '/home', label: 'Home', icon: 'home' },
  { to: '/search', label: 'Search', icon: 'search' },
  { to: '/watchlist', label: 'Watchlist', icon: 'bookmark' },
  { to: '/watchhistory', label: 'History', icon: 'history' },
] as const;

const NavIcon: React.FC<{ icon: string; size?: number }> = ({ icon, size = 18 }) => {
  const s = { width: size, height: size };
  const icons: Record<string, React.ReactNode> = {
    home: (
      <svg style={s} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
    search: (
      <svg style={s} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
    bookmark: (
      <svg style={s} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
      </svg>
    ),
    history: (
      <svg style={s} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12a9 9 0 109-9 9.5 9.5 0 00-6.36 2.47L3 8" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 3v5h5M12 7v5l3 2" />
      </svg>
    ),
    user: (
      <svg style={s} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  };

  return <>{icons[icon]}</>;
};

const TabBar: React.FC = () => {
  const { primary } = useThemeStore((s) => s);
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  const handleSearchSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
      setSearchFocused(false);
    }
  }, [searchQuery, navigate]);

  return (
    <>
      {/* ===== MOBILE TOP BAR ===== */}
      <nav
        className="md:hidden fixed top-0 left-0 right-0 z-50"
        role="navigation"
        aria-label="Main navigation"
      >
        <div
          className="flex items-center justify-between px-4 h-12"
          style={{
            backgroundColor: 'rgba(10, 10, 10, 0.95)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          {/* Logo */}
          <NavLink to="/home" className="flex items-center gap-1.5 shrink-0" aria-label="Vega Home">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill={primary}>
              <path d="M8 5v14l11-7z" />
            </svg>
            <span className="text-white text-base font-bold tracking-tight">Vega</span>
          </NavLink>

          {/* Right icons */}
          <div className="flex items-center gap-3">
            <NavLink
              to="/search"
              className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-400 hover:text-white transition-colors"
              aria-label="Search"
            >
              <NavIcon icon="search" size={20} />
            </NavLink>
          </div>
        </div>
      </nav>

      {/* ===== MOBILE BOTTOM TAB BAR ===== */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50"
        role="navigation"
        aria-label="Bottom navigation"
      >
        <div
          className="flex items-center justify-around px-2 h-14"
          style={{
            backgroundColor: 'rgba(10, 10, 10, 0.95)',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          {navItems.slice(0, 3).map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all duration-200 ${
                  isActive ? '' : 'text-gray-500'
                }`
              }
              aria-label={label}
            >
              {({ isActive }) => (
                <>
                  <span style={{ color: isActive ? primary : undefined }}>
                    <NavIcon icon={icon} size={20} />
                  </span>
                  <span
                    className="text-[10px] font-medium leading-none"
                    style={{ color: isActive ? primary : undefined }}
                  >
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
          <NavLink
            to="/watchhistory"
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all duration-200 ${
                isActive ? '' : 'text-gray-500'
              }`
            }
            aria-label="History"
          >
            {({ isActive }) => (
              <>
                <span style={{ color: isActive ? primary : undefined }}><NavIcon icon="history" size={20} /></span>
                <span className="text-[10px] font-medium leading-none" style={{ color: isActive ? primary : undefined }}>History</span>
              </>
            )}
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all duration-200 ${
                isActive ? '' : 'text-gray-500'
              }`
            }
            aria-label="Settings"
          >
            {({ isActive }) => (
              <>
                <span style={{ color: isActive ? primary : undefined }}>
                  <NavIcon icon="user" size={20} />
                </span>
                <span
                  className="text-[10px] font-medium leading-none"
                  style={{ color: isActive ? primary : undefined }}
                >
                  Settings
                </span>
              </>
            )}
          </NavLink>
        </div>
      </nav>

      {/* ===== DESKTOP TOP BAR ===== */}
      <nav
        className="hidden md:flex fixed top-3 left-4 right-4 z-50 h-14 items-center justify-between px-4 lg:px-6 rounded-2xl border border-white/[0.08] bg-black/80 backdrop-blur-xl shadow-2xl"
        role="navigation"
        aria-label="Main navigation"
        style={{ boxShadow: '0 10px 40px rgba(0,0,0,0.35)' }}
      >
        {/* Logo - far left */}
        <NavLink to="/home" className="flex items-center gap-2 shrink-0 group" aria-label="Vega Home">
          <svg className="w-6 h-6 transition-transform duration-200 group-hover:scale-110" viewBox="0 0 24 24" fill={primary}>
            <path d="M8 5v14l11-7z" />
          </svg>
          <span className="text-white text-lg font-bold tracking-tight">
            Vega
          </span>
        </NavLink>

        {/* Center nav items */}
        <div className="flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
          <div
            className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04]"
          >
            {navItems.map(({ to, label, icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `relative flex items-center gap-2 px-3 lg:px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? 'text-black bg-white'
                      : 'text-white hover:bg-white/10'
                  }`
                }
                aria-label={label}
              >
                <NavIcon icon={icon} />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        </div>

        {/* Right icons - far right */}
        <div className="flex items-center gap-2">
          <NavLink
            to="/search"
            className="w-9 h-9 rounded-full flex items-center justify-center text-white hover:bg-white/10 transition-all duration-200"
            aria-label="Search"
          >
            <NavIcon icon="search" size={20} />
          </NavLink>
          <NavLink
            to="/settings"
            className="w-9 h-9 rounded-full flex items-center justify-center text-white hover:bg-white/10 transition-all duration-200"
            aria-label="Settings"
          >
            <NavIcon icon="user" size={20} />
          </NavLink>
        </div>
      </nav>
    </>
  );
};

export default TabBar;
