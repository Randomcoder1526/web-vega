import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import { useContentStore } from '../store/contentStore';
import ScrollRow from '../components/ScrollRow';
import axios from 'axios';

interface OMDBResult {
  Title: string;
  Year: string;
  imdbID: string;
  Type: string;
  Poster: string;
}

const MAX_VISIBLE_RESULTS = 15;
const MAX_HISTORY_ITEMS = 30;

const HistoryItem: React.FC<{ search: string; onPress: (text: string) => void; onRemove: (text: string) => void; primary: string }> = ({ search, onPress, onRemove, primary }) => (
  <div className="flex items-center gap-3.5 py-3 px-5 hover:bg-white/[0.03] transition-colors">
    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: primary + '12' }}>
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke={primary}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </div>
    <p className="text-white/70 text-sm flex-1 truncate cursor-pointer hover:text-white transition-colors" onClick={() => onPress(search)}>{search}</p>
    <button onClick={(e) => { e.stopPropagation(); onRemove(search); }}
      className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/5 transition-colors shrink-0"
      aria-label="Remove search history">
      <svg className="w-3 h-3 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </div>
);

const SearchPosterCard: React.FC<{ item: OMDBResult; onPress: (title: string) => void }> = ({ item, onPress }) => (
  <div onClick={() => onPress(item.Title)}
    className="shrink-0 w-[110px] cursor-pointer group animate-fade-in-up">
    <div className="relative rounded-xl overflow-hidden glass-card aspect-[2/3] group-hover:ring-1 transition-all duration-200"
      style={{ '--tw-ring-color': 'rgba(255,255,255,0.2)' } as React.CSSProperties}>
      {item.Poster && item.Poster !== 'N/A' ? (
        <img src={item.Poster} alt="" className="w-full h-full object-cover group-hover:scale-105 transition duration-300" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white/15">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
      )}
    </div>
    <p className="text-white text-xs font-medium mt-1.5 leading-tight" title={item.Title}>{item.Title}</p>
    <p className="text-white/35 text-[10px] mt-0.5">{item.Type === 'series' ? 'TV Show' : 'Movie'} &bull; {item.Year}</p>
  </div>
);

const ProviderSearchRow: React.FC<{ query: string; navigate: (path: string) => void; installedCount: number }> = ({ query, navigate, installedCount }) => (
  <div className="px-4 mt-2">
    <ScrollRow title="Providers" accent="#FF6347">
      <div onClick={() => navigate(`/searchresults?q=${encodeURIComponent(query)}`)}
        className="shrink-0 w-[160px] h-[120px] rounded-2xl glass-card p-4 flex flex-col justify-between cursor-pointer hover:bg-white/[0.04] transition-colors group">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center glass-card group-hover:scale-105 transition">
          <svg className="w-4 h-4 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <div>
          <p className="text-white text-sm font-semibold">Search installed providers</p>
          <p className="text-white/30 text-[11px] mt-0.5">{installedCount} installed</p>
        </div>
      </div>
      <div onClick={() => navigate('/extensions')}
        className="shrink-0 w-[160px] h-[120px] rounded-2xl glass-card p-4 flex flex-col justify-between cursor-pointer hover:bg-white/[0.04] transition-colors group">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center glass-card group-hover:scale-105 transition">
          <svg className="w-4 h-4 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
        <div>
          <p className="text-white text-sm font-semibold">Install providers</p>
          <p className="text-white/30 text-[11px] mt-0.5">Add more sources</p>
        </div>
      </div>
    </ScrollRow>
  </div>
);

const Search: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { primary } = useThemeStore((s) => s);
  const { installedProviders } = useContentStore((s) => s);
  const [searchText, setSearchText] = useState(searchParams.get('q') || '');
  const [isFocused, setIsFocused] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('searchHistory') || '[]'); } catch { return []; }
  });
  const [searchResults, setSearchResults] = useState<OMDBResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (searchParams.get('q')) {
      setSearchText(searchParams.get('q') || '');
    }
  }, [searchParams]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (searchText.length >= 2) {
      setLoading(true);
      debounceRef.current = setTimeout(async () => {
        try {
          const response = await axios.get(`https://www.omdbapi.com/?s=${encodeURIComponent(searchText)}&apikey=trilogy`, { timeout: 5000 });
          if (response.data?.Search) {
            const uniqueResults = response.data.Search.reduce((acc: OMDBResult[], current: OMDBResult) => {
              const x = acc.find((item) => item.imdbID === current.imdbID);
              return x ? acc : acc.concat([current]);
            }, [] as OMDBResult[]);
            setSearchResults(uniqueResults.slice(0, MAX_VISIBLE_RESULTS));
          } else {
            setSearchResults([]);
          }
        } catch {
          setSearchResults([]);
        } finally {
          setLoading(false);
        }
      }, 300);
    } else {
      setSearchResults([]);
      setLoading(false);
    }

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchText]);

  const handleSearch = useCallback((text: string) => {
    if (text.trim()) {
      const prevSearches = JSON.parse(localStorage.getItem('searchHistory') || '[]') as string[];
      if (!prevSearches.includes(text.trim())) {
        const newSearches = [text.trim(), ...prevSearches].slice(0, MAX_HISTORY_ITEMS);
        localStorage.setItem('searchHistory', JSON.stringify(newSearches));
        setSearchHistory(newSearches);
      }
      navigate(`/searchresults?q=${encodeURIComponent(text.trim())}`);
    }
  }, [navigate]);

  const removeHistoryItem = useCallback((search: string) => {
    const newSearches = searchHistory.filter(item => item !== search);
    localStorage.setItem('searchHistory', JSON.stringify(newSearches));
    setSearchHistory(newSearches);
  }, [searchHistory]);

  const clearHistory = useCallback(() => {
    localStorage.setItem('searchHistory', '[]');
    setSearchHistory([]);
  }, []);

  return (
    <div className="flex-1 min-h-screen bg-surface md:px-16">
      <div className="px-4 pt-4 pb-2 animate-fade-in-down">
        <h1 className="text-white text-[28px] font-bold mb-4 tracking-tight">Search</h1>
        <div className="rounded-2xl px-4 flex items-center glass-card transition-all duration-200"
          style={{
            borderColor: isFocused ? primary + '40' : undefined,
            boxShadow: isFocused ? `0 0 0 1px ${primary}20` : 'none',
          }}>
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke={isFocused ? primary : 'rgba(255,255,255,0.25)'}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(searchText)}
            placeholder="Search movies, series..."
            className="flex-1 text-white text-sm ml-3 h-12 bg-transparent outline-none placeholder-white/25"
          />
          {searchText.length > 0 && (
            <button onClick={() => setSearchText('')}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/5 transition-colors shrink-0"
              aria-label="Clear search">
              <svg className="w-3.5 h-3.5 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 animate-fade-in">
        {searchResults.length > 0 ? (
          <div className="py-2">
            <ScrollRow title="Suggestions" accent={primary}>
              {searchResults.map((item) => (
                <SearchPosterCard key={item.imdbID} item={item} onPress={handleSearch} />
              ))}
            </ScrollRow>
          </div>
        ) : searchHistory.length > 0 ? (
          <div>
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-white/40 text-xs font-semibold uppercase tracking-wider">Recent Searches</span>
              <button onClick={clearHistory}
                className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
                style={{ backgroundColor: primary + '10', color: primary }}>
                Clear All
              </button>
            </div>
            {searchHistory.map((search, index) => (
              <HistoryItem key={`history-${index}`} search={search} onPress={handleSearch} onRemove={removeHistoryItem} primary={primary} />
            ))}
          </div>
        ) : !loading ? (
          <div className="items-center justify-center flex flex-col px-8 pt-20 animate-fade-in">
            <div className="w-24 h-24 rounded-2xl flex items-center justify-center glass-card">
              <svg className="w-9 h-9 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <p className="text-white/40 text-base text-center mt-5">Search for your favorite content</p>
            <p className="text-white/20 text-sm text-center mt-1">Recent searches will appear here</p>
          </div>
        ) : null}

        {loading && (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-2 rounded-full animate-spin"
              style={{ borderColor: primary + '30', borderTopColor: primary }} />
          </div>
        )}

        {searchText.length >= 2 && (
          <ProviderSearchRow query={searchText} navigate={navigate} installedCount={installedProviders.length} />
        )}
      </div>
    </div>
  );
};

export default Search;
