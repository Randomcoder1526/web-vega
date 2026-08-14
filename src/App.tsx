import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Home from './screens/Home';
import Search from './screens/Search';
import SearchResults from './screens/SearchResults';
import ScrollList from './screens/ScrollList';
import WatchList from './screens/WatchList';
import WatchHistory from './screens/WatchHistory';
import Settings from './screens/Settings';
import Admin from './screens/Admin';
import About from './screens/About';
import Info from './screens/Info';
import Player from './screens/Player';
import Extensions from './screens/Extensions';
import TabBar from './components/TabBar';
import { extensionManager } from './lib/extensionManager';
import { extensionStorage } from './lib/extensionStorage';
import { useContentStore } from './store/contentStore';
import { useThemeStore } from './store/themeStore';
import { OFFICIAL_VEGA_PROVIDER } from './lib/providerConfig';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
});

function AppLayout() {
  const location = useLocation();
  const isPlayer = location.pathname.startsWith('/player');

  return (
    <div className="flex flex-col h-screen bg-surface text-white overflow-hidden">
      {!isPlayer && <TabBar />}
      <main className={`flex-1 overflow-y-auto ${isPlayer ? '' : 'pt-12 pb-14 md:pt-16 md:pb-0'}`}>
        <Routes>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/searchresults" element={<SearchResults />} />
          <Route path="/scrolllist" element={<ScrollList />} />
          <Route path="/watchlist" element={<WatchList />} />
          <Route path="/watchhistory" element={<WatchHistory />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/extensions" element={<Extensions />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/about" element={<About />} />
          <Route path="/info/:id" element={<Info />} />
          <Route path="/player/:id" element={<Player />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  const [ready, setReady] = useState(false);
  const { primary } = useThemeStore.getState();

  useEffect(() => {
    const ensureOfficialProvider = async () => {
      await extensionManager.initialize();

      const officialSource = {
        author: OFFICIAL_VEGA_PROVIDER.sourceAuthor,
        url: OFFICIAL_VEGA_PROVIDER.sourceUrl,
        isDefault: true,
      };

      // Keep the app aligned with the official provider source rather than
      // leaving an older fork in shared/local storage.
      const installed = extensionStorage.getInstalledProviders();
      const existing = installed.find(
        (p) => p.value === OFFICIAL_VEGA_PROVIDER.value && p.source?.author === OFFICIAL_VEGA_PROVIDER.sourceAuthor,
      );

      if (!existing || existing.version !== OFFICIAL_VEGA_PROVIDER.version || existing.source?.url !== officialSource.url) {
        try {
          const manifest = await extensionManager.fetchManifest(officialSource, true);
          const manifestProvider = manifest.find((p) => p.value === OFFICIAL_VEGA_PROVIDER.value);
          if (manifestProvider && manifestProvider.version === OFFICIAL_VEGA_PROVIDER.version) {
            await extensionManager.installProvider(manifestProvider);
          } else {
            throw new Error(`Official Vega provider ${OFFICIAL_VEGA_PROVIDER.version} is not available.`);
          }
        } catch (error) {
          console.error('[App] Failed to install/update official Vega provider:', error);
          if (!existing) throw error;
        }
      }

      // Remove stale copies of the same provider value from other sources.
      for (const item of extensionStorage.getInstalledProviders()) {
        if (item.value === OFFICIAL_VEGA_PROVIDER.value && item.source?.author !== OFFICIAL_VEGA_PROVIDER.sourceAuthor) {
          extensionStorage.uninstallProvider(item.value, item.source?.author);
        }
      }

      const finalInstalled = extensionStorage.getInstalledProviders();
      useContentStore.getState().setInstalledProviders(finalInstalled);

      const current = useContentStore.getState().provider;
      const stillInstalled = current?.value
        && finalInstalled.some(
            (p) => p.value === current.value && (p.source?.author || '') === (current.source?.author || ''),
          );
      if (!stillInstalled && finalInstalled.length > 0) {
        const official = finalInstalled.find(
          (p) => p.value === OFFICIAL_VEGA_PROVIDER.value && p.source?.author === OFFICIAL_VEGA_PROVIDER.sourceAuthor,
        );
        useContentStore.getState().setProvider(official || finalInstalled[0]);
      }
    };

    ensureOfficialProvider()
      .catch((error) => console.error('[App] Provider initialization failed:', error))
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <QueryClientProvider client={queryClient}>
        <div className="flex items-center justify-center h-screen bg-surface">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 border-3 border-white/20 border-t-white rounded-full animate-spin"
              style={{ borderColor: `${primary}30`, borderTopColor: primary }} />
            <p className="text-white/40 text-sm">Loading providers...</p>
          </div>
        </div>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppLayout />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;